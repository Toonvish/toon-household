/**
 * NATIVE-Tesseract-backed `OcrEngine` — the `tesseract` binary in a subprocess.
 *
 * WHY NOT tesseract.js (which this replaced): it is Tesseract 5 compiled to WASM,
 * so it runs the same models at a fraction of the speed and several times the peak
 * memory, and it has to load a ~15 MB `.traineddata` blob into the API process
 * itself. On a small self-hosted box that footprint was the single reason the
 * deployment needed 2 GB of RAM. The native binary reads its language data from
 * `/usr/share/tesseract-ocr` (an OS package, `tesseract-ocr-deu`), so:
 *
 *   - there is no download, no `cachePath`, no seeded volume and no prefetch step,
 *   - the work happens in ANOTHER PROCESS, so it stops competing with the event
 *     loop — a WASM worker inside the process does,
 *   - `options.signal` is finally REAL: aborting kills the child. tesseract.js
 *     ignored the signal entirely, which is why `withOcrTimeout` had to be a
 *     `Promise.race` (it still is — `unpdf` remains cooperative-only).
 *
 * Accuracy is unchanged: same engine, same models.
 *
 * ONE INVOCATION PRODUCES TWO FILES, and that is deliberate. `txt` is the text we
 * hand downstream, because only the txt renderer honours
 * `preserve_interword_spaces` — which is what keeps the column spacing of an
 * ingredient table ("250 g   Mehl") intact. `tsv` is the only output that carries
 * per-word CONFIDENCE, which `OcrResult.confidence` and the review UI need.
 * Reconstructing the text from the tsv word boxes instead would collapse every run
 * of spaces to one, so we ask for both in a single run rather than parsing one and
 * losing the other. Writing to stdout can only ever emit ONE format, hence the
 * temp directory.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "../../../../env.ts";
import { ApiError } from "../../../../lib/errors.ts";
import type { OcrBlock, OcrEngine, OcrOptions, OcrResult } from "./types.ts";

/** Page segmentation modes, keyed by our layout hint. */
const PSM_BY_LAYOUT: Record<NonNullable<OcrOptions["layout"]>, string> = {
  page: "3", // fully automatic, no OSD
  block: "6", // a single uniform block of text
  line: "7", // a single text line
  sparse: "11", // sparse text, find as much as possible
};

export class TesseractEngine implements OcrEngine {
  readonly name = "tesseract-native";

  private readonly langs: string;
  private readonly bin: string;

  constructor(langs: string = env.TESSERACT_LANGS, bin: string = env.TESSERACT_BIN) {
    this.langs = normalizeLangs(langs);
    this.bin = bin;
  }

  /**
   * Recognises text in preprocessed image bytes.
   *
   * No warm worker and no internal queue any more: every call is its own process,
   * so concurrent calls cannot corrupt each other the way one shared tesseract.js
   * worker could. `withOcrSlot()` (MAX_CONCURRENT_OCR) is now the only thing
   * bounding how many run at once, which is what keeps peak memory predictable.
   *
   * Unlike the tesseract.js engine, `options.langs` is honoured — it silently
   * could not be before, because the languages were fixed when the worker was
   * created.
   */
  async recognize(input: Uint8Array, options: OcrOptions = {}): Promise<OcrResult> {
    options.signal?.throwIfAborted();

    const langs = options.langs === undefined ? this.langs : normalizeLangs(options.langs);
    const psm = PSM_BY_LAYOUT[options.layout ?? "page"];
    const directory = await mkdtemp(join(tmpdir(), "toon-ocr-"));

    try {
      const base = join(directory, "page");
      await this.run(input, base, langs, psm, options.signal);
      options.signal?.throwIfAborted();

      const [txt, tsv] = await Promise.all([
        readFile(`${base}.txt`, "utf8").catch(() => ""),
        readFile(`${base}.tsv`, "utf8").catch(() => ""),
      ]);
      const parsed = parseTesseractOutput(txt, tsv);

      return {
        text: parsed.text,
        confidence: parsed.confidence,
        engine: this.name,
        langs,
        ...(parsed.blocks.length > 0 ? { blocks: parsed.blocks } : {}),
      };
    } finally {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** Spawns the binary and waits for it, killing the child if `signal` aborts. */
  private async run(
    input: Uint8Array,
    base: string,
    langs: string,
    psm: string,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    // The output configs (`txt`, `tsv`) MUST come last — tesseract reads every
    // trailing bare word as a config name.
    const args = [
      "-",
      base,
      "-l",
      langs,
      "--psm",
      psm,
      "-c",
      "preserve_interword_spaces=1",
      "txt",
      "tsv",
    ];

    let child: ReturnType<typeof Bun.spawn>;
    try {
      child = Bun.spawn([this.bin, ...args], { stdin: input, stdout: "ignore", stderr: "pipe" });
    } catch (error) {
      // ENOENT: the binary is not installed at all.
      throw unavailableError(error, this.bin);
    }

    const abort = () => {
      child.kill();
    };
    signal?.addEventListener("abort", abort, { once: true });

    try {
      const [exitCode, stderr] = await Promise.all([
        child.exited,
        new Response(child.stderr as ReadableStream<Uint8Array>).text(),
      ]);
      // A kill() shows up as a non-zero exit; report the abort, not a fake OCR
      // failure, or a timeout would be blamed on the image.
      signal?.throwIfAborted();
      if (exitCode !== 0) throw failedError(stderr, exitCode, langs);
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }

  /** Nothing to release — every recognise call is its own process. */
  async shutdown(): Promise<void> {
    // Intentionally empty: kept so `OcrEngine` stays uniform across engines.
  }
}

function unavailableError(error: unknown, bin: string): ApiError {
  return new ApiError(422, "ocr_failed", "server.ocr.recognitionUnavailable", {
    reason: "tesseract_unavailable",
    bin,
    cause: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
  });
}

function failedError(stderr: string, exitCode: number, langs: string): ApiError {
  const detail = stderr.trim().split("\n").slice(-3).join(" ").slice(0, 200);
  // The one failure worth naming precisely: the binary is there but the language
  // package is not (`apt install tesseract-ocr-deu`). Everything else is an image
  // problem the user can act on by uploading a better photo.
  const missingLanguage = /failed loading language|could not initialize tesseract/i.test(stderr);
  return new ApiError(
    422,
    "ocr_failed",
    missingLanguage ? "server.ocr.languageDataMissing" : "server.ocr.recognitionFailed",
    {
      ...(missingLanguage ? { reason: "language_data_missing" } : {}),
      exitCode,
      langs,
      ...(detail.length > 0 ? { cause: detail } : {}),
    },
  );
}

/* ------------------------------ output parsing ----------------------------- */

export interface ParsedTesseractOutput {
  text: string;
  /** 0..1, mean over recognised words. */
  confidence: number;
  blocks: OcrBlock[];
}

/** Column order of `tesseract … tsv`, which has a header row we skip. */
const TSV_COLUMNS = 12;
const TSV_WORD_LEVEL = 5;

/**
 * Turns one tesseract run's `txt` + `tsv` output into an `OcrResult` payload.
 *
 * PURE ON PURPOSE: it is the only part of the native engine with real logic, and
 * this way `bun test` covers it from a fixture string on a machine that has no
 * `tesseract` binary installed at all (which includes most dev machines — the
 * binary only ships in the Docker image).
 */
export function parseTesseractOutput(txt: string, tsv: string): ParsedTesseractOutput {
  const words = parseTsvWords(tsv);

  const confidences = words.map((word) => word.confidence);
  const confidence =
    confidences.length === 0
      ? 0
      : Math.min(1, Math.max(0, confidences.reduce((sum, value) => sum + value, 0) / confidences.length / 100));

  // The txt renderer is the source of truth for text (it keeps interword spacing);
  // reconstructing from the word boxes is the fallback for a build that emitted no
  // txt file, so an odd tesseract packaging degrades instead of returning "".
  const fromTxt = cleanTesseractText(txt);
  const text = fromTxt.length > 0 ? fromTxt : reconstructText(words);

  return { text, confidence, blocks: toBlocks(words) };
}

interface TsvWord {
  block: number;
  line: number;
  text: string;
  /** 0..100, as tesseract reports it. */
  confidence: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

function parseTsvWords(tsv: string): TsvWord[] {
  const out: TsvWord[] = [];
  for (const rawLine of tsv.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line.length === 0) continue;
    const fields = line.split("\t");
    if (fields.length < TSV_COLUMNS) continue;
    // Header row.
    if (fields[0] === "level") continue;

    const level = Number(fields[0]);
    if (level !== TSV_WORD_LEVEL) continue; // only word rows carry text + conf

    const text = (fields[11] ?? "").trim();
    if (text.length === 0) continue;
    const confidence = Number(fields[10]);
    // -1 marks a row tesseract did not score; averaging it in would drag the page
    // confidence down for no reason.
    if (!Number.isFinite(confidence) || confidence < 0) continue;

    out.push({
      block: toInt(fields[2]),
      line: toInt(fields[4]),
      text,
      confidence,
      left: toInt(fields[6]),
      top: toInt(fields[7]),
      width: toInt(fields[8]),
      height: toInt(fields[9]),
    });
  }
  return out;
}

function toInt(raw: string | undefined): number {
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

/**
 * The txt renderer separates pages with a form feed and pads the tail with blank
 * lines. Interior spacing is left ALONE — that is the whole reason we read this
 * file rather than rebuilding the text from the tsv.
 */
function cleanTesseractText(txt: string): string {
  return txt.replace(/\r\n?/g, "\n").replace(/\f/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Fallback text: words joined per line, lines per block. */
function reconstructText(words: TsvWord[]): string {
  const lines = new Map<string, string[]>();
  const order: string[] = [];
  for (const word of words) {
    const key = `${word.block}:${word.line}`;
    let bucket = lines.get(key);
    if (bucket === undefined) {
      bucket = [];
      lines.set(key, bucket);
      order.push(key);
    }
    bucket.push(word.text);
  }
  return order
    .map((key) => (lines.get(key) ?? []).join(" "))
    .join("\n")
    .trim();
}

/** One `OcrBlock` per tesseract block, with the union of its word boxes. */
function toBlocks(words: TsvWord[]): OcrBlock[] {
  const grouped = new Map<number, TsvWord[]>();
  const order: number[] = [];
  for (const word of words) {
    let bucket = grouped.get(word.block);
    if (bucket === undefined) {
      bucket = [];
      grouped.set(word.block, bucket);
      order.push(word.block);
    }
    bucket.push(word);
  }

  const out: OcrBlock[] = [];
  for (const block of order) {
    const bucket = grouped.get(block) ?? [];
    if (bucket.length === 0) continue;
    const text = reconstructText(bucket);
    if (text.length === 0) continue;
    out.push({
      text,
      confidence: bucket.reduce((sum, word) => sum + word.confidence, 0) / bucket.length,
      bbox: {
        x0: Math.min(...bucket.map((word) => word.left)),
        y0: Math.min(...bucket.map((word) => word.top)),
        x1: Math.max(...bucket.map((word) => word.left + word.width)),
        y1: Math.max(...bucket.map((word) => word.top + word.height)),
      },
    });
  }
  return out;
}

/* -------------------------------- languages ------------------------------- */

/** "deu + eng", "de,en" -> "deu+eng"; guarantees a non-empty language string. */
export function normalizeLangs(raw: string | undefined): string {
  const parts = (raw ?? "")
    .split(/[+,\s]+/)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0)
    .map((part) => LANG_ALIASES[part] ?? part);
  const unique = [...new Set(parts)];
  return unique.length > 0 ? unique.join("+") : "deu+eng";
}

/** Two-letter codes people put in .env, mapped to tesseract's three-letter ones. */
const LANG_ALIASES: Record<string, string> = {
  de: "deu",
  german: "deu",
  en: "eng",
  english: "eng",
  fr: "fra",
  it: "ita",
  es: "spa",
  nl: "nld",
  pl: "pol",
  tr: "tur",
};
