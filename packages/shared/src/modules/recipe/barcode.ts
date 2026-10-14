/**
 * Barcode encoders for saved cards — pure, dependency-free, no DOM.
 *
 * These turn a card's stored value into a run of dark/light MODULES. Drawing is
 * somebody else's job (apps/web/src/features/cards/components/BarcodeImage.tsx
 * builds an SVG from this), and so is decoding a camera frame (zxing-wasm, lazy,
 * online, at add time only) — see the header of ./qr.ts for why the display path
 * deliberately owns no dependency at all.
 *
 * ## Which symbologies, and why exactly these
 *
 * The set is chosen from what German loyalty and membership cards actually
 * carry, not from what a barcode library can produce:
 *
 *  - `ean13`   Payback, DeutschlandCard, most supermarket cards
 *  - `ean8`    small-format cards
 *  - `upca`    12-digit cards; encoded as EAN-13 with a leading zero, which is
 *              literally what UPC-A is
 *  - `code128` variable-length alphanumeric, common on staff and gym cards
 *  - `code39`  older membership cards, libraries, some clubs
 *  - `itf`     Interleaved 2 of 5, still found on cardboard/outer-pack style cards
 *  - `qr`      Lidl Plus, fuel-station apps, anything app-generated (./qr.ts)
 *
 * A card whose symbology is NOT in this list cannot be saved: the form offers
 * this list and nothing else. That is a deliberate limit, not an oversight —
 * PDF417/Aztec/Data Matrix would each need their own encoder on the offline
 * display path, and no test could tell us it was right without a real card.
 *
 * ## Two-stage validation, because a wrong digit is invisible
 *
 * {@link normalizeBarcodeValue} is forgiving — it strips the spaces and dashes a
 * card prints for legibility and COMPLETES a missing check digit for the EAN/UPC
 * family, so typing the 12 digits under a Payback barcode works. Then
 * {@link checkBarcodeValue} is strict, check digit included: a card that scans as
 * "no such member" at a till is worse than one the app refused to save, and the
 * check digit is the only evidence we have at save time that the number was read
 * correctly.
 */

/** Every symbology a card may be saved as. Wire values — never renamed. */
export const BARCODE_FORMATS = ["qr", "ean13", "ean8", "upca", "code128", "code39", "itf"] as const;
export type BarcodeFormat = (typeof BARCODE_FORMATS)[number];

/** Formats drawn as a square matrix rather than a row of bars. */
export function isMatrixBarcode(format: BarcodeFormat): format is "qr" {
  return format === "qr";
}

/** Longest value each format accepts, after normalisation. */
const MAX_LENGTH: Readonly<Record<BarcodeFormat, number>> = {
  qr: 512,
  ean13: 13,
  ean8: 8,
  upca: 12,
  code128: 48,
  code39: 48,
  itf: 30,
};

/**
 * Why a value cannot be encoded. A machine-readable reason rather than a
 * sentence: the API turns it into a keyed validation issue and the web form
 * renders it in the viewer's language (see the i18n rules in CLAUDE.md).
 */
export type BarcodeValueReason =
  | "empty"
  | "too_long"
  | "digits_only"
  | "wrong_length"
  | "odd_length"
  | "charset"
  | "check_digit";

/** Thrown by {@link encodeBarcode} for a value that never passed validation. */
export class BarcodeValueError extends Error {
  readonly reason: BarcodeValueReason;
  readonly format: BarcodeFormat;

  constructor(format: BarcodeFormat, reason: BarcodeValueReason) {
    super(`${format}: ${reason}`);
    this.name = "BarcodeValueError";
    this.reason = reason;
    this.format = format;
  }
}

/** A linear symbol: one boolean per narrow module, `true` = dark bar. */
export interface LinearBarcode {
  readonly modules: readonly boolean[];
  /** Human-readable text printed under the bars (empty when there is none). */
  readonly text: string;
  /** Quiet zone in modules that must stay light on each side. */
  readonly quietZone: number;
}

/* -------------------------------------------------------------------------- */
/* normalisation + validation                                                 */
/* -------------------------------------------------------------------------- */

const DIGIT_FORMATS = new Set<BarcodeFormat>(["ean13", "ean8", "upca", "itf"]);

/** GS1 mod-10 check digit over `digits` (the value WITHOUT its check digit). */
export function gs1CheckDigit(digits: string): number {
  let sum = 0;
  // Weights alternate 3,1 counted from the RIGHT of the finished code, i.e. the
  // rightmost payload digit always carries the 3.
  for (let index = digits.length - 1, weight = 3; index >= 0; index -= 1, weight = weight === 3 ? 1 : 3) {
    sum += Number(digits[index]) * weight;
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * Cleans up what a user typed or a scanner returned.
 *
 * Digit formats lose every separator; `code39` is upper-cased because the
 * symbology has no lower case at all; everything else is only trimmed. For
 * `ean13`/`ean8`/`upca` a value that is exactly one digit short GAINS its check
 * digit, which is what makes the number printed under the bars usable as-is.
 */
export function normalizeBarcodeValue(format: BarcodeFormat, raw: string): string {
  if (format === "qr") return raw.trim();
  if (format === "code128") return raw.trim();
  if (format === "code39") return raw.trim().toUpperCase();

  const digits = raw.replace(/[^0-9]/g, "");
  if (format === "ean13" && digits.length === 12) return digits + String(gs1CheckDigit(digits));
  if (format === "ean8" && digits.length === 7) return digits + String(gs1CheckDigit(digits));
  if (format === "upca" && digits.length === 11) return digits + String(gs1CheckDigit(digits));
  // ITF encodes digit PAIRS, so an odd count is completed with a leading zero —
  // the same thing a label printer does.
  if (format === "itf" && digits.length % 2 === 1) return `0${digits}`;
  return digits;
}

const CODE39_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%";

/** The reason `value` cannot be encoded as `format`, or `null` when it can. */
export function checkBarcodeValue(format: BarcodeFormat, value: string): BarcodeValueReason | null {
  if (value.length === 0) return "empty";
  if (value.length > MAX_LENGTH[format]) return "too_long";

  if (DIGIT_FORMATS.has(format) && !/^[0-9]+$/.test(value)) return "digits_only";

  switch (format) {
    case "qr":
      return null;
    case "ean13":
    case "ean8":
    case "upca": {
      const expected = format === "ean13" ? 13 : format === "ean8" ? 8 : 12;
      if (value.length !== expected) return "wrong_length";
      const payload = value.slice(0, -1);
      return Number(value.at(-1)) === gs1CheckDigit(payload) ? null : "check_digit";
    }
    case "itf":
      // No check digit is enforced: a card prints the digits it prints, and
      // ITF-14's check digit is part of those digits rather than added by us.
      return value.length % 2 === 0 ? null : "odd_length";
    case "code39":
      return [...value].every((char) => CODE39_CHARS.includes(char)) ? null : "charset";
    case "code128":
      // Code 128 sets A/B/C between them cover printable ASCII; control
      // characters are legal in the symbology but never on a card.
      return [...value].every((char) => {
        const code = char.charCodeAt(0);
        return code >= 32 && code <= 126;
      })
        ? null
        : "charset";
  }
}

/* -------------------------------------------------------------------------- */
/* EAN-13 / EAN-8 / UPC-A                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The "L" (odd-parity) digit patterns. The other two sets are DERIVED rather
 * than transcribed, which removes two tables' worth of typo risk:
 * `R = complement(L)` and `G = reverse(R)`.
 */
const EAN_L = [
  "0001101",
  "0011001",
  "0010011",
  "0111101",
  "0100011",
  "0110001",
  "0101111",
  "0111011",
  "0110111",
  "0001011",
] as const;

/** Which of L/G encodes each of the six left-hand digits, by first digit. */
const EAN13_PARITY = [
  "LLLLLL",
  "LLGLGG",
  "LLGGLG",
  "LLGGGL",
  "LGLLGG",
  "LGGLLG",
  "LGGGLL",
  "LGLGLG",
  "LGLGGL",
  "LGGLGL",
] as const;

const GUARD = "101";
const CENTRE = "01010";

function patternToModules(pattern: string): boolean[] {
  return [...pattern].map((bit) => bit === "1");
}

function eanR(digit: number): string {
  return [...(EAN_L[digit] as string)].map((bit) => (bit === "1" ? "0" : "1")).join("");
}

function eanG(digit: number): string {
  return [...eanR(digit)].reverse().join("");
}

/** EAN-13 bars, 95 modules. UPC-A is this with a leading zero (see below). */
function encodeEan13(value: string): boolean[] {
  const digits = [...value].map(Number);
  const parity = EAN13_PARITY[digits[0] as number] as string;
  let bits = GUARD;
  for (let index = 1; index <= 6; index += 1) {
    const digit = digits[index] as number;
    bits += parity[index - 1] === "L" ? (EAN_L[digit] as string) : eanG(digit);
  }
  bits += CENTRE;
  for (let index = 7; index <= 12; index += 1) {
    bits += eanR(digits[index] as number);
  }
  bits += GUARD;
  return patternToModules(bits);
}

/** EAN-8 bars, 67 modules: four L digits, centre, four R digits. */
function encodeEan8(value: string): boolean[] {
  const digits = [...value].map(Number);
  let bits = GUARD;
  for (let index = 0; index < 4; index += 1) bits += EAN_L[digits[index] as number] as string;
  bits += CENTRE;
  for (let index = 4; index < 8; index += 1) bits += eanR(digits[index] as number);
  bits += GUARD;
  return patternToModules(bits);
}

/* -------------------------------------------------------------------------- */
/* Code 39                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Nine elements per character — bar, space, bar, … starting and ending with a
 * bar — as narrow (1) / wide (2) widths. Three of the nine are always wide.
 */
const CODE39_PATTERNS: Readonly<Record<string, string>> = {
  "0": "111221211",
  "1": "211211112",
  "2": "112211112",
  "3": "212211111",
  "4": "111221112",
  "5": "211221111",
  "6": "112221111",
  "7": "111211212",
  "8": "211211211",
  "9": "112211211",
  A: "211112112",
  B: "112112112",
  C: "212112111",
  D: "111122112",
  E: "211122111",
  F: "112122111",
  G: "111112212",
  H: "211112211",
  I: "112112211",
  J: "111122211",
  K: "211111122",
  L: "112111122",
  M: "212111121",
  N: "111121122",
  O: "211121121",
  P: "112121121",
  Q: "111111222",
  R: "211111221",
  S: "112111221",
  T: "111121221",
  U: "221111112",
  V: "122111112",
  W: "222111111",
  X: "121121112",
  Y: "221121111",
  Z: "122121111",
  "-": "121111212",
  ".": "221111211",
  " ": "122111211",
  $: "121212111",
  "/": "121211121",
  "+": "121112121",
  "%": "111212121",
  /** The start/stop character, never part of the data. */
  "*": "121121211",
};

/** Widths of one Code 39 character, expanded to modules (wide = 2 narrow). */
function code39Character(char: string): boolean[] {
  const pattern = CODE39_PATTERNS[char];
  if (pattern === undefined) throw new BarcodeValueError("code39", "charset");
  const modules: boolean[] = [];
  for (let index = 0; index < pattern.length; index += 1) {
    const width = Number(pattern[index]);
    const dark = index % 2 === 0;
    for (let repeat = 0; repeat < width; repeat += 1) modules.push(dark);
  }
  return modules;
}

function encodeCode39(value: string): boolean[] {
  const modules: boolean[] = [];
  for (const char of `*${value}*`) {
    if (modules.length > 0) modules.push(false); // narrow inter-character gap
    modules.push(...code39Character(char));
  }
  return modules;
}

/* -------------------------------------------------------------------------- */
/* Code 128                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The 107 element-width patterns, indexed by symbol value: six widths each
 * (bar, space, bar, space, bar, space), except the stop symbol's seven.
 */
const CODE128_PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
] as const;

const CODE128_START_B = 104;
const CODE128_START_C = 105;
const CODE128_CODE_B = 100;
const CODE128_CODE_C = 99;
const CODE128_STOP = 106;

/** How many digits start at `index` — the switch to code set C only pays at 4+. */
function digitRunLength(value: string, index: number): number {
  let run = 0;
  while (index + run < value.length && /[0-9]/.test(value[index + run] as string)) run += 1;
  return run;
}

/**
 * Symbol values for `value`, switching between code set B (printable ASCII) and
 * code set C (digit pairs, half the width).
 *
 * Code set A is not used: it exists for control characters, which cannot appear
 * in a validated value, and leaving it out removes a whole class of state.
 */
function code128Symbols(value: string): number[] {
  const symbols: number[] = [];
  // Start in C when the value opens with an even run of at least four digits —
  // the usual case for a numeric card — otherwise in B.
  const openingRun = digitRunLength(value, 0);
  let inC = openingRun >= 4 || (openingRun === value.length && openingRun % 2 === 0);
  symbols.push(inC ? CODE128_START_C : CODE128_START_B);

  let index = 0;
  while (index < value.length) {
    const run = digitRunLength(value, index);
    if (inC) {
      if (run >= 2) {
        symbols.push(Number(value.slice(index, index + 2)));
        index += 2;
        continue;
      }
      symbols.push(CODE128_CODE_B);
      inC = false;
      continue;
    }
    // In B: a digit run long enough to pay for the switch symbol goes to C. An
    // odd run leaves its last digit behind, which the `run < 2` branch above
    // then hands back to B — so no special case is needed for it here.
    if (run - (run % 2) >= 4) {
      symbols.push(CODE128_CODE_C);
      inC = true;
      continue;
    }
    symbols.push(value.charCodeAt(index) - 32);
    index += 1;
  }
  return symbols;
}

function encodeCode128(value: string): boolean[] {
  const symbols = code128Symbols(value);
  // Checksum: start value + each data symbol times its 1-based position, mod 103.
  let checksum = symbols[0] as number;
  for (let index = 1; index < symbols.length; index += 1) {
    checksum += (symbols[index] as number) * index;
  }
  symbols.push(checksum % 103, CODE128_STOP);

  const modules: boolean[] = [];
  for (const symbol of symbols) {
    const pattern = CODE128_PATTERNS[symbol] as string;
    for (let index = 0; index < pattern.length; index += 1) {
      const width = Number(pattern[index]);
      const dark = index % 2 === 0;
      for (let repeat = 0; repeat < width; repeat += 1) modules.push(dark);
    }
  }
  return modules;
}

/* -------------------------------------------------------------------------- */
/* Interleaved 2 of 5                                                         */
/* -------------------------------------------------------------------------- */

/** Five element widths per digit, two of them wide. */
const ITF_PATTERNS = [
  "11221",
  "21112",
  "12112",
  "22111",
  "11212",
  "21211",
  "12211",
  "11122",
  "21121",
  "12121",
] as const;

/**
 * ITF interleaves two digits at a time: the first digit's five widths are BARS,
 * the second's are the SPACES between them.
 */
function encodeItf(value: string): boolean[] {
  const modules: boolean[] = [];
  const push = (width: number, dark: boolean): void => {
    for (let repeat = 0; repeat < width; repeat += 1) modules.push(dark);
  };

  // Start: narrow bar, narrow space, narrow bar, narrow space.
  push(1, true);
  push(1, false);
  push(1, true);
  push(1, false);

  for (let index = 0; index < value.length; index += 2) {
    const bars = ITF_PATTERNS[Number(value[index])] as string;
    const spaces = ITF_PATTERNS[Number(value[index + 1])] as string;
    for (let element = 0; element < 5; element += 1) {
      push(Number(bars[element]), true);
      push(Number(spaces[element]), false);
    }
  }

  // Stop: wide bar, narrow space, narrow bar.
  push(2, true);
  push(1, false);
  push(1, true);
  return modules;
}

/* -------------------------------------------------------------------------- */
/* public API                                                                 */
/* -------------------------------------------------------------------------- */

/** Quiet zone per format, in modules, as the symbology requires. */
const QUIET_ZONE: Readonly<Record<Exclude<BarcodeFormat, "qr">, number>> = {
  ean13: 9,
  ean8: 7,
  upca: 9,
  code128: 10,
  code39: 10,
  itf: 10,
};

/**
 * Encodes `value` as a linear symbol.
 *
 * `value` must already be normalised and valid — pass it through
 * {@link normalizeBarcodeValue} and {@link checkBarcodeValue} first (the API's
 * schema does, so a stored card is always encodable). A stored row that predates
 * a validation change still throws {@link BarcodeValueError} rather than drawing
 * a symbol that scans as the wrong number.
 */
export function encodeBarcode(format: BarcodeFormat, value: string): LinearBarcode {
  if (isMatrixBarcode(format)) {
    throw new BarcodeValueError(format, "charset");
  }
  const reason = checkBarcodeValue(format, value);
  if (reason !== null) throw new BarcodeValueError(format, reason);

  const quietZone = QUIET_ZONE[format];
  switch (format) {
    case "ean13":
      return { modules: encodeEan13(value), text: value, quietZone };
    case "ean8":
      return { modules: encodeEan8(value), text: value, quietZone };
    case "upca":
      // UPC-A *is* EAN-13 with a leading zero; only the printed text differs.
      return { modules: encodeEan13(`0${value}`), text: value, quietZone };
    case "code39":
      return { modules: encodeCode39(value), text: value, quietZone };
    case "code128":
      return { modules: encodeCode128(value), text: value, quietZone };
    case "itf":
      return { modules: encodeItf(value), text: value, quietZone };
  }
}
