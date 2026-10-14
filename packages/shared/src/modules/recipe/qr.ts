/**
 * QR code encoder — pure, dependency-free, no DOM, no network.
 *
 * WHY HAND-ROLLED, when the app already bundles zxing-wasm for the camera:
 * this is the DISPLAY path. A saved card is shown at a till, which is exactly
 * where a phone has no signal and no patience — so the thing that turns a card
 * number into a matrix has to be a few kilobytes of synchronous JavaScript that
 * the precached bundle already contains, not a 1.1 MB WebAssembly module fetched
 * on demand. zxing is only ever used to DECODE a camera frame while adding a
 * card, which happens once, at home, online (see apps/web/src/features/cards).
 *
 * Model 2 QR, versions 1–40, ECC levels L/M/Q/H, numeric/alphanumeric/byte mode
 * with automatic mode + version selection. Structurally a compact port of the
 * ISO/IEC 18004 encoding steps, in the order the standard states them:
 *
 *   1. pick a mode for the text and the smallest version that holds it,
 *   2. write mode indicator + character count + data bits, pad to capacity,
 *   3. split into blocks, append Reed–Solomon codewords, interleave,
 *   4. draw function patterns, lay the codewords in the zig-zag,
 *   5. try all eight masks and keep the one with the lowest penalty score.
 *
 * The two lookup tables (ECC codewords per block, blocks per version) are spec
 * data with no closed form. They are verified the only way that actually proves
 * anything: `apps/web/src/features/cards/lib/roundtrip.test.ts` encodes with this
 * file and DECODES with zxing across versions and levels, so a mistranscribed
 * entry fails a test instead of shipping a card nobody can scan.
 */

/** Error-correction level. Higher tolerates more damage and holds less data. */
export type QrEccLevel = "L" | "M" | "Q" | "H";

/** The eight ECC levels' format-info values, in spec order. */
const ECC_FORMAT_BITS: Readonly<Record<QrEccLevel, number>> = { L: 1, M: 0, Q: 3, H: 2 };

/** A finished QR symbol: a square bitmap of dark/light modules. */
export interface QrMatrix {
  /** Modules per side, `17 + 4 * version`. */
  readonly size: number;
  readonly version: number;
  readonly ecc: QrEccLevel;
  /** Row-major, `modules[y][x]`, `true` = dark. Excludes the quiet zone. */
  readonly modules: readonly boolean[][];
}

/** Thrown when the text cannot be encoded at all (too long for version 40). */
export class QrTooLongError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QrTooLongError";
  }
}

/* -------------------------------------------------------------------------- */
/* spec tables                                                                */
/* -------------------------------------------------------------------------- */

/** ECC codewords per block, indexed by level then version (index 0 unused). */
const ECC_CODEWORDS_PER_BLOCK: Readonly<Record<QrEccLevel, readonly number[]>> = {
  L: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
};

/** Error-correction blocks, indexed by level then version (index 0 unused). */
const ECC_BLOCKS: Readonly<Record<QrEccLevel, readonly number[]>> = {
  L: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
};

const MIN_VERSION = 1;
const MAX_VERSION = 40;

/** The alphanumeric mode's 45-character alphabet, index = its code value. */
const ALPHANUMERIC = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

type QrMode = "numeric" | "alphanumeric" | "byte";

const MODE_INDICATOR: Readonly<Record<QrMode, number>> = {
  numeric: 0b0001,
  alphanumeric: 0b0010,
  byte: 0b0100,
};

/** Character-count-indicator width per mode, by version group (1–9, 10–26, 27–40). */
const COUNT_BITS: Readonly<Record<QrMode, readonly [number, number, number]>> = {
  numeric: [10, 12, 14],
  alphanumeric: [9, 11, 13],
  byte: [8, 16, 16],
};

function countBits(mode: QrMode, version: number): number {
  const group = version <= 9 ? 0 : version <= 26 ? 1 : 2;
  return COUNT_BITS[mode][group] as number;
}

/* -------------------------------------------------------------------------- */
/* capacity arithmetic                                                        */
/* -------------------------------------------------------------------------- */

/** Alignment-pattern centre coordinates for `version`, ascending. */
function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const result = [6];
  for (let pos = version * 4 + 10; result.length < count; pos -= step) result.splice(1, 0, pos);
  return result;
}

/** Modules available for data+ECC before function patterns are removed. */
function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const alignCount = Math.floor(version / 7) + 2;
    result -= (25 * alignCount - 10) * alignCount - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

/** Total codewords (data + ECC) of `version`. */
function rawCodewords(version: number): number {
  return Math.floor(rawDataModules(version) / 8);
}

/** Data codewords of `version` at `ecc` — the payload budget. */
function dataCodewords(version: number, ecc: QrEccLevel): number {
  const blocks = ECC_BLOCKS[ecc][version] as number;
  const perBlock = ECC_CODEWORDS_PER_BLOCK[ecc][version] as number;
  return rawCodewords(version) - perBlock * blocks;
}

/* -------------------------------------------------------------------------- */
/* mode selection                                                             */
/* -------------------------------------------------------------------------- */

function isNumeric(text: string): boolean {
  return text.length > 0 && /^[0-9]+$/.test(text);
}

function isAlphanumeric(text: string): boolean {
  return text.length > 0 && [...text].every((char) => ALPHANUMERIC.includes(char));
}

/**
 * The most compact mode that can carry `text`.
 *
 * Deliberately ONE mode for the whole string rather than an optimal split into
 * segments: a card number is either all digits or a short URL, and a mixed
 * optimum would save a handful of modules on inputs this app does not produce.
 */
function pickMode(text: string): QrMode {
  if (isNumeric(text)) return "numeric";
  if (isAlphanumeric(text)) return "alphanumeric";
  return "byte";
}

/** Payload bit count of `text` in `mode`, excluding header and count field. */
function dataBitLength(text: string, mode: QrMode, bytes: Uint8Array): number {
  if (mode === "numeric") {
    const groups = Math.floor(text.length / 3);
    const remainder = text.length % 3;
    return groups * 10 + (remainder === 0 ? 0 : remainder === 1 ? 4 : 7);
  }
  if (mode === "alphanumeric") {
    return Math.floor(text.length / 2) * 11 + (text.length % 2) * 6;
  }
  return bytes.length * 8;
}

/** Characters counted by the character-count indicator. */
function charCount(text: string, mode: QrMode, bytes: Uint8Array): number {
  return mode === "byte" ? bytes.length : text.length;
}

/* -------------------------------------------------------------------------- */
/* bit writing                                                                */
/* -------------------------------------------------------------------------- */

class BitBuffer {
  private readonly bits: number[] = [];

  append(value: number, width: number): void {
    for (let index = width - 1; index >= 0; index -= 1) {
      this.bits.push((value >>> index) & 1);
    }
  }

  get length(): number {
    return this.bits.length;
  }

  /** Zero-padded to a whole number of bytes. */
  toBytes(): number[] {
    const bytes: number[] = [];
    for (let index = 0; index < this.bits.length; index += 8) {
      let byte = 0;
      for (let offset = 0; offset < 8; offset += 1) {
        byte = (byte << 1) | (this.bits[index + offset] ?? 0);
      }
      bytes.push(byte);
    }
    return bytes;
  }
}

function writePayload(buffer: BitBuffer, text: string, mode: QrMode, bytes: Uint8Array): void {
  if (mode === "numeric") {
    for (let index = 0; index < text.length; index += 3) {
      const chunk = text.slice(index, index + 3);
      buffer.append(Number.parseInt(chunk, 10), chunk.length * 3 + 1);
    }
    return;
  }
  if (mode === "alphanumeric") {
    for (let index = 0; index < text.length; index += 2) {
      const first = ALPHANUMERIC.indexOf(text[index] as string);
      const second = index + 1 < text.length ? ALPHANUMERIC.indexOf(text[index + 1] as string) : -1;
      if (second < 0) buffer.append(first, 6);
      else buffer.append(first * 45 + second, 11);
    }
    return;
  }
  for (const byte of bytes) buffer.append(byte, 8);
}

/* -------------------------------------------------------------------------- */
/* Reed–Solomon over GF(2^8), primitive polynomial 0x11D                      */
/* -------------------------------------------------------------------------- */

function gfMultiply(a: number, b: number): number {
  let result = 0;
  let left = a;
  let right = b;
  while (right > 0) {
    if ((right & 1) !== 0) result ^= left;
    left <<= 1;
    if ((left & 0x100) !== 0) left ^= 0x11d;
    right >>= 1;
  }
  return result;
}

/** Generator polynomial of degree `degree`, coefficients high-to-low, monic. */
function generatorPolynomial(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1; // the polynomial x^0 == 1, stored without its leading term
  let root = 1;
  for (let step = 0; step < degree; step += 1) {
    for (let index = 0; index < degree; index += 1) {
      result[index] = gfMultiply(result[index] as number, root);
      if (index + 1 < degree) {
        result[index] = (result[index] as number) ^ (result[index + 1] as number);
      }
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

/** The `degree` ECC codewords for one block. */
function eccCodewords(data: readonly number[], degree: number): number[] {
  const generator = generatorPolynomial(degree);
  const result = new Array<number>(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ (result.shift() as number);
    result.push(0);
    for (let index = 0; index < degree; index += 1) {
      result[index] = (result[index] as number) ^ gfMultiply(generator[index] as number, factor);
    }
  }
  return result;
}

/** Splits into blocks, appends ECC, interleaves — the spec's codeword order. */
function addEccAndInterleave(
  data: readonly number[],
  version: number,
  ecc: QrEccLevel,
): number[] {
  const blockCount = ECC_BLOCKS[ecc][version] as number;
  const eccPerBlock = ECC_CODEWORDS_PER_BLOCK[ecc][version] as number;
  const total = rawCodewords(version);
  const shortBlockCount = blockCount - (total % blockCount);
  const shortBlockLength = Math.floor(total / blockCount);

  const blocks: number[][] = [];
  const eccBlocks: number[][] = [];
  let offset = 0;
  for (let index = 0; index < blockCount; index += 1) {
    const dataLength = shortBlockLength - eccPerBlock + (index < shortBlockCount ? 0 : 1);
    const block = data.slice(offset, offset + dataLength);
    offset += dataLength;
    blocks.push([...block]);
    eccBlocks.push(eccCodewords(block, eccPerBlock));
  }

  const result: number[] = [];
  const longestData = shortBlockLength - eccPerBlock + 1;
  for (let index = 0; index < longestData; index += 1) {
    for (let block = 0; block < blockCount; block += 1) {
      const codeword = (blocks[block] as number[])[index];
      if (codeword !== undefined) result.push(codeword);
    }
  }
  for (let index = 0; index < eccPerBlock; index += 1) {
    for (let block = 0; block < blockCount; block += 1) {
      result.push((eccBlocks[block] as number[])[index] as number);
    }
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/* drawing                                                                    */
/* -------------------------------------------------------------------------- */

/** Mutable drawing surface: the modules plus which of them are reserved. */
interface Canvas {
  size: number;
  modules: boolean[][];
  /** True where a function pattern lives, so masking and data skip it. */
  reserved: boolean[][];
}

function createCanvas(size: number): Canvas {
  const grid = (): boolean[][] =>
    Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  return { size, modules: grid(), reserved: grid() };
}

function setFunctionModule(canvas: Canvas, x: number, y: number, dark: boolean): void {
  (canvas.modules[y] as boolean[])[x] = dark;
  (canvas.reserved[y] as boolean[])[x] = true;
}

function drawFinder(canvas: Canvas, centerX: number, centerY: number): void {
  for (let dy = -4; dy <= 4; dy += 1) {
    for (let dx = -4; dx <= 4; dx += 1) {
      const x = centerX + dx;
      const y = centerY + dy;
      if (x < 0 || x >= canvas.size || y < 0 || y >= canvas.size) continue;
      const distance = Math.max(Math.abs(dx), Math.abs(dy));
      setFunctionModule(canvas, x, y, distance !== 2 && distance !== 4);
    }
  }
}

function drawAlignment(canvas: Canvas, centerX: number, centerY: number): void {
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      setFunctionModule(
        canvas,
        centerX + dx,
        centerY + dy,
        Math.max(Math.abs(dx), Math.abs(dy)) !== 1,
      );
    }
  }
}

/** Format information: 5 data bits + BCH(15,5), XOR 0x5412, written twice. */
function drawFormatBits(canvas: Canvas, ecc: QrEccLevel, mask: number): void {
  const data = ((ECC_FORMAT_BITS[ecc] << 3) | mask) & 0x1f;
  let remainder = data;
  for (let index = 0; index < 10; index += 1) {
    remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  }
  const bits = ((data << 10) | remainder) ^ 0x5412;

  const bitAt = (index: number): boolean => ((bits >>> index) & 1) !== 0;

  // Copy 1, around the top-left finder.
  for (let index = 0; index <= 5; index += 1) setFunctionModule(canvas, 8, index, bitAt(index));
  setFunctionModule(canvas, 8, 7, bitAt(6));
  setFunctionModule(canvas, 8, 8, bitAt(7));
  setFunctionModule(canvas, 7, 8, bitAt(8));
  for (let index = 9; index < 15; index += 1) {
    setFunctionModule(canvas, 14 - index, 8, bitAt(index));
  }

  // Copy 2, split between the other two finders.
  for (let index = 0; index < 8; index += 1) {
    setFunctionModule(canvas, canvas.size - 1 - index, 8, bitAt(index));
  }
  for (let index = 8; index < 15; index += 1) {
    setFunctionModule(canvas, 8, canvas.size - 15 + index, bitAt(index));
  }
  setFunctionModule(canvas, 8, canvas.size - 8, true); // the always-dark module
}

/** Version information: 6 data bits + BCH(18,6). Versions 7 and up only. */
function drawVersionBits(canvas: Canvas, version: number): void {
  if (version < 7) return;
  let remainder = version;
  for (let index = 0; index < 12; index += 1) {
    remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
  }
  const bits = (version << 12) | remainder;
  for (let index = 0; index < 18; index += 1) {
    const dark = ((bits >>> index) & 1) !== 0;
    const a = canvas.size - 11 + (index % 3);
    const b = Math.floor(index / 3);
    setFunctionModule(canvas, a, b, dark);
    setFunctionModule(canvas, b, a, dark);
  }
}

function drawFunctionPatterns(canvas: Canvas, version: number, ecc: QrEccLevel): void {
  const size = canvas.size;

  // Timing patterns.
  for (let index = 0; index < size; index += 1) {
    setFunctionModule(canvas, 6, index, index % 2 === 0);
    setFunctionModule(canvas, index, 6, index % 2 === 0);
  }

  drawFinder(canvas, 3, 3);
  drawFinder(canvas, size - 4, 3);
  drawFinder(canvas, 3, size - 4);

  const positions = alignmentPositions(version);
  for (let i = 0; i < positions.length; i += 1) {
    for (let j = 0; j < positions.length; j += 1) {
      // The three finder corners have no alignment pattern.
      const corner =
        (i === 0 && j === 0) ||
        (i === 0 && j === positions.length - 1) ||
        (i === positions.length - 1 && j === 0);
      if (corner) continue;
      drawAlignment(canvas, positions[i] as number, positions[j] as number);
    }
  }

  drawFormatBits(canvas, ecc, 0);
  drawVersionBits(canvas, version);
}

/** Lays the interleaved codewords along the two-module-wide zig-zag. */
function drawCodewords(canvas: Canvas, codewords: readonly number[]): void {
  let bitIndex = 0;
  const size = canvas.size;
  for (let right = size - 1; right >= 1; right -= 2) {
    // The vertical timing pattern owns column 6, so the pair that would have
    // started there starts at 5 instead — and the NEXT pair is 3, not 4, which
    // is why this reassigns the loop variable rather than a local copy.
    if (right === 6) right = 5;
    for (let step = 0; step < size; step += 1) {
      for (let offset = 0; offset < 2; offset += 1) {
        const x = right - offset;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - step : step;
        if ((canvas.reserved[y] as boolean[])[x] === true) continue;
        if (bitIndex < codewords.length * 8) {
          const byte = codewords[bitIndex >>> 3] as number;
          (canvas.modules[y] as boolean[])[x] = ((byte >>> (7 - (bitIndex & 7))) & 1) !== 0;
          bitIndex += 1;
        }
        // Remaining modules stay light — the spec's "remainder bits".
      }
    }
  }
}

function maskBit(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

/** XORs the mask over every non-function module. Applying twice undoes it. */
function applyMask(canvas: Canvas, mask: number): void {
  for (let y = 0; y < canvas.size; y += 1) {
    for (let x = 0; x < canvas.size; x += 1) {
      if ((canvas.reserved[y] as boolean[])[x] === true) continue;
      if (maskBit(mask, x, y)) {
        (canvas.modules[y] as boolean[])[x] = !((canvas.modules[y] as boolean[])[x] as boolean);
      }
    }
  }
}

/** The spec's four penalty rules; lower is better. */
function penaltyScore(canvas: Canvas): number {
  const size = canvas.size;
  const dark = (x: number, y: number): boolean => (canvas.modules[y] as boolean[])[x] as boolean;
  let score = 0;

  // Rule 1 — runs of five or more same-coloured modules in a row or column.
  const runScore = (run: number): number => (run >= 5 ? 3 + (run - 5) : 0);
  for (let y = 0; y < size; y += 1) {
    let run = 1;
    for (let x = 1; x < size; x += 1) {
      if (dark(x, y) === dark(x - 1, y)) run += 1;
      else {
        score += runScore(run);
        run = 1;
      }
    }
    score += runScore(run);
  }
  for (let x = 0; x < size; x += 1) {
    let run = 1;
    for (let y = 1; y < size; y += 1) {
      if (dark(x, y) === dark(x, y - 1)) run += 1;
      else {
        score += runScore(run);
        run = 1;
      }
    }
    score += runScore(run);
  }

  // Rule 2 — every 2x2 block of one colour.
  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const value = dark(x, y);
      if (value === dark(x + 1, y) && value === dark(x, y + 1) && value === dark(x + 1, y + 1)) {
        score += 3;
      }
    }
  }

  // Rule 3 — the finder-like 1:1:3:1:1 pattern with four light modules on one
  // side of it. Out-of-bounds reads count as light (the quiet zone).
  const FINDER = [true, false, true, true, true, false, true];
  const matchesFinder = (read: (index: number) => boolean, start: number): boolean => {
    for (let index = 0; index < FINDER.length; index += 1) {
      if (read(start + index) !== FINDER[index]) return false;
    }
    const clearBefore = [-4, -3, -2, -1].every((delta) => !read(start + delta));
    const clearAfter = [7, 8, 9, 10].every((delta) => !read(start + delta));
    return clearBefore || clearAfter;
  };
  for (let y = 0; y < size; y += 1) {
    const read = (index: number): boolean => (index < 0 || index >= size ? false : dark(index, y));
    for (let x = 0; x <= size - FINDER.length; x += 1) {
      if (matchesFinder(read, x)) score += 40;
    }
  }
  for (let x = 0; x < size; x += 1) {
    const read = (index: number): boolean => (index < 0 || index >= size ? false : dark(x, index));
    for (let y = 0; y <= size - FINDER.length; y += 1) {
      if (matchesFinder(read, y)) score += 40;
    }
  }

  // Rule 4 — deviation of the dark-module share from 50%.
  let darkCount = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) if (dark(x, y)) darkCount += 1;
  }
  const total = size * size;
  const percent = Math.floor((Math.abs(darkCount * 20 - total * 10) * 10) / total);
  score += percent * 10;

  return score;
}

/* -------------------------------------------------------------------------- */
/* public API                                                                 */
/* -------------------------------------------------------------------------- */

export interface EncodeQrOptions {
  /** Defaults to "M" — the level printed on most loyalty cards. */
  ecc?: QrEccLevel;
  /** Lower bound for the version, e.g. to keep a matrix from being tiny. */
  minVersion?: number;
}

/**
 * Encodes `text` as a QR matrix.
 *
 * Throws {@link QrTooLongError} when even version 40 at the chosen ECC level
 * cannot hold the text — the caller's schema should have rejected it first
 * (`CARD_LIMITS.valueMax`), so this is a guard, not a code path.
 */
export function encodeQr(text: string, options: EncodeQrOptions = {}): QrMatrix {
  const ecc = options.ecc ?? "M";
  const mode = pickMode(text);
  const bytes = new TextEncoder().encode(text);
  const payloadBits = dataBitLength(text, mode, bytes);
  const count = charCount(text, mode, bytes);

  let version = Math.max(MIN_VERSION, options.minVersion ?? MIN_VERSION);
  for (; version <= MAX_VERSION; version += 1) {
    const capacityBits = dataCodewords(version, ecc) * 8;
    if (4 + countBits(mode, version) + payloadBits <= capacityBits) break;
  }
  if (version > MAX_VERSION) {
    throw new QrTooLongError(`text of ${text.length} characters does not fit a QR code`);
  }

  // Steps 2 + 3: header, payload, terminator, pad bytes, ECC, interleave.
  const buffer = new BitBuffer();
  buffer.append(MODE_INDICATOR[mode], 4);
  buffer.append(count, countBits(mode, version));
  writePayload(buffer, text, mode, bytes);

  const capacityBits = dataCodewords(version, ecc) * 8;
  const terminator = Math.min(4, capacityBits - buffer.length);
  buffer.append(0, terminator);
  buffer.append(0, (8 - (buffer.length % 8)) % 8);
  const data = buffer.toBytes();
  for (let pad = 0xec; data.length * 8 < capacityBits; pad ^= 0xec ^ 0x11) data.push(pad);

  const codewords = addEccAndInterleave(data, version, ecc);

  // Steps 4 + 5: draw, then keep the least-penalised of the eight masks.
  const canvas = createCanvas(17 + 4 * version);
  drawFunctionPatterns(canvas, version, ecc);
  drawCodewords(canvas, codewords);

  let bestMask = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 8; mask += 1) {
    applyMask(canvas, mask);
    drawFormatBits(canvas, ecc, mask);
    const score = penaltyScore(canvas);
    if (score < bestScore) {
      bestScore = score;
      bestMask = mask;
    }
    applyMask(canvas, mask); // undo
  }
  applyMask(canvas, bestMask);
  drawFormatBits(canvas, ecc, bestMask);

  return { size: canvas.size, version, ecc, modules: canvas.modules };
}
