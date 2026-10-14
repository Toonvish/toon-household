/**
 * [IMPORT] A minimal, dependency-free `.xlsx` reader — just enough to read
 * `Haushalt.xlsx`'s `Kostenrechnung` sheet (docs/ledger-spec.md §1.1).
 *
 * An `.xlsx` is a ZIP archive of XML parts. `openpyxl` is not installed and
 * must not become a dependency (docs/spec.md task brief); this module reads
 * the ZIP central directory itself and inflates the two parts it needs
 * (`xl/sharedStrings.xml`, `xl/worksheets/sheetN.xml`) with Node's built-in
 * `node:zlib` (`inflateRawSync` — raw DEFLATE, ZIP's compression method 8).
 * That is a Node/Bun built-in, not an npm dependency, so it satisfies the
 * "no package if avoidable" rule without hand-rolling an inflate algorithm.
 *
 * Cell/row extraction below is a small tolerant regex scan, not a real XML
 * DOM parser — acceptable because this reads exactly one vendor (Excel's own
 * OOXML writer), whose output is flat, single-line, and has no nested `<row>`
 * or `<c>` elements. It would not be a safe approach for arbitrary XML.
 */
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  data: Buffer;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;

/** Scans backward from the end of the file for the End Of Central Directory record. */
function findEndOfCentralDirectory(buf: Buffer): number {
  const maxCommentLength = 65535;
  const minScan = Math.max(0, buf.length - (22 + maxCommentLength));
  for (let i = buf.length - 22; i >= minScan; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  throw new Error("xlsx-reader: not a ZIP file (no End Of Central Directory record found)");
}

/** Reads every entry's local-header-relative bytes, decompressing store(0)/deflate(8). */
function readZipEntries(buf: Buffer, wanted: ReadonlySet<string>): Map<string, Buffer> {
  const eocdOffset = findEndOfCentralDirectory(buf);
  const entryCount = buf.readUInt16LE(eocdOffset + 10);
  let centralDirOffset = buf.readUInt32LE(eocdOffset + 16);

  const found = new Map<string, Buffer>();
  let offset = centralDirOffset;
  for (let i = 0; i < entryCount && found.size < wanted.size; i++) {
    if (buf.readUInt32LE(offset) !== CENTRAL_DIR_SIGNATURE) {
      throw new Error(`xlsx-reader: malformed central directory entry at byte ${offset}`);
    }
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const localHeaderOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString("utf8", offset + 46, offset + 46 + nameLength);

    if (wanted.has(name)) {
      found.set(name, readLocalEntry(buf, localHeaderOffset, method, compressedSize));
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }
  return found;
}

function readLocalEntry(buf: Buffer, localHeaderOffset: number, method: number, compressedSize: number): Buffer {
  if (buf.readUInt32LE(localHeaderOffset) !== LOCAL_HEADER_SIGNATURE) {
    throw new Error(`xlsx-reader: malformed local file header at byte ${localHeaderOffset}`);
  }
  const nameLength = buf.readUInt16LE(localHeaderOffset + 26);
  const extraLength = buf.readUInt16LE(localHeaderOffset + 28);
  const dataStart = localHeaderOffset + 30 + nameLength + extraLength;
  const compressed = buf.subarray(dataStart, dataStart + compressedSize);
  if (method === 0) return Buffer.from(compressed);
  if (method === 8) return inflateRawSync(compressed);
  throw new Error(`xlsx-reader: unsupported ZIP compression method ${method}`);
}

/** One `<c>` cell, keyed by its `r="B56"` reference. */
export interface XlsxCell {
  ref: string;
  col: string;
  row: number;
  /** `t="…"` attribute: `"s"` shared string, `"str"` formula-string result, `"b"` boolean, absent = numeric. */
  type?: string;
  /** Raw `<v>` text, if present. */
  value?: string;
  /** Raw `<f>` text, if present — the importer never re-evaluates this, only reads the cached `<v>`. */
  formula?: string;
}

export interface XlsxWorkbook {
  sharedStrings: string[];
  /** `cellRef -> cell`, for the one sheet part read (`Kostenrechnung` = `sheet1.xml`). */
  cells: Map<string, XlsxCell>;
  /** Highest row number seen, for iteration bounds. */
  maxRow: number;
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** `xl/sharedStrings.xml` -> the flat string table cells reference by index. */
export function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  const siRe = /<si>([\s\S]*?)<\/si>/g;
  const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
  for (const siMatch of xml.matchAll(siRe)) {
    const block = siMatch[1] ?? "";
    let text = "";
    for (const tMatch of block.matchAll(tRe)) text += tMatch[1] ?? "";
    strings.push(decodeXmlEntities(text));
  }
  return strings;
}

const CELL_REF_RE = /^([A-Z]+)(\d+)$/;

/** `xl/worksheets/sheetN.xml` -> every `<c>` cell across every `<row>`. */
export function parseSheetCells(xml: string): { cells: Map<string, XlsxCell>; maxRow: number } {
  const cells = new Map<string, XlsxCell>();
  let maxRow = 0;
  const rowRe = /<row [^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  const cellRe = /<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;

  for (const rowMatch of xml.matchAll(rowRe)) {
    const rowNumber = Number(rowMatch[1]);
    if (rowNumber > maxRow) maxRow = rowNumber;
    const rowContent = rowMatch[2] ?? "";

    for (const cellMatch of rowContent.matchAll(cellRe)) {
      const ref = cellMatch[1]!;
      const attrs = cellMatch[2] ?? "";
      const content = cellMatch[3];
      const refMatch = CELL_REF_RE.exec(ref);
      if (!refMatch) continue;
      const col = refMatch[1]!;
      const row = Number(refMatch[2]);

      const typeMatch = /\bt="([a-zA-Z]+)"/.exec(attrs);
      const cell: XlsxCell = { ref, col, row, type: typeMatch?.[1] };

      if (content !== undefined) {
        const formulaMatch = /<f[^>]*>([\s\S]*?)<\/f>/.exec(content);
        if (formulaMatch) cell.formula = decodeXmlEntities(formulaMatch[1] ?? "");

        const valueMatch = /<v>([\s\S]*?)<\/v>/.exec(content);
        if (valueMatch) cell.value = decodeXmlEntities(valueMatch[1] ?? "");

        if (cell.value === undefined) {
          // inline string (`t="inlineStr"`): <is><t>…</t></is>
          const inlineMatch = /<is>([\s\S]*?)<\/is>/.exec(content);
          if (inlineMatch) {
            let text = "";
            for (const tMatch of (inlineMatch[1] ?? "").matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) text += tMatch[1] ?? "";
            cell.value = decodeXmlEntities(text);
          }
        }
      }

      cells.set(ref, cell);
    }
  }

  return { cells, maxRow };
}

/** Reads `Haushalt.xlsx` (or any workbook with the same two parts) from disk. */
export function readWorkbook(filePath: string): XlsxWorkbook {
  const buf = readFileSync(filePath);
  const parts = readZipEntries(buf, new Set(["xl/sharedStrings.xml", "xl/worksheets/sheet1.xml"]));

  const sharedStringsXml = parts.get("xl/sharedStrings.xml");
  const sheetXml = parts.get("xl/worksheets/sheet1.xml");
  if (!sheetXml) throw new Error("xlsx-reader: xl/worksheets/sheet1.xml (Kostenrechnung) not found in workbook");

  const sharedStrings = sharedStringsXml ? parseSharedStrings(sharedStringsXml.toString("utf8")) : [];
  const { cells, maxRow } = parseSheetCells(sheetXml.toString("utf8"));
  return { sharedStrings, cells, maxRow };
}

/** The cell's resolved text, resolving a shared-string index against the table. `undefined` for an empty cell. */
export function cellText(cell: XlsxCell | undefined, sharedStrings: readonly string[]): string | undefined {
  if (!cell) return undefined;
  if (cell.type === "s") {
    const idx = Number(cell.value);
    return sharedStrings[idx];
  }
  return cell.value;
}
