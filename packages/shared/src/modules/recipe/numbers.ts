/**
 * Number parsing/formatting helpers shared by the ingredient, duration and
 * servings parsers. Pure functions only.
 */

/** Unicode vulgar fractions -> decimal value. */
export const UNICODE_FRACTIONS: Record<string, number> = {
  "¼": 0.25,
  "½": 0.5,
  "¾": 0.75,
  "⅐": 1 / 7,
  "⅑": 1 / 9,
  "⅒": 0.1,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "⅕": 0.2,
  "⅖": 0.4,
  "⅗": 0.6,
  "⅘": 0.8,
  "⅙": 1 / 6,
  "⅚": 5 / 6,
  "⅛": 0.125,
  "⅜": 0.375,
  "⅝": 0.625,
  "⅞": 0.875,
};

const FRACTION_CHARS = Object.keys(UNICODE_FRACTIONS).join("");

/** Decimal value -> nicest unicode fraction, used by formatQuantity. */
const FRACTION_OUTPUT: ReadonlyArray<readonly [number, string]> = [
  [0.125, "⅛"],
  [0.25, "¼"],
  [1 / 3, "⅓"],
  [0.375, "⅜"],
  [0.5, "½"],
  [0.625, "⅝"],
  [2 / 3, "⅔"],
  [0.75, "¾"],
  [0.875, "⅞"],
];

/**
 * Matches one quantity at the start of a string:
 * "250", "1,5", "1.5", "1/2", "1 1/2", "½", "1½", "2-3", "2 – 3", "2 bis 3".
 * Capture 1 = whole quantity text.
 */
export const QUANTITY_TOKEN = `(?:\\d+(?:[.,]\\d+)?\\s*[${FRACTION_CHARS}]|\\d+\\s+\\d+\\s*/\\s*\\d+|\\d+\\s*/\\s*\\d+|[${FRACTION_CHARS}]|\\d+(?:[.,]\\d+)?)`;

const SINGLE_RE = new RegExp(`^${QUANTITY_TOKEN}$`, "u");

/**
 * Parses a single numeric token (no ranges): "1,5" -> 1.5, "1 1/2" -> 1.5,
 * "1½" -> 1.5, "¾" -> 0.75. Returns undefined when the token is not numeric.
 */
export function parseNumberToken(raw: string): number | undefined {
  const token = raw.trim().replace(/\s+/g, " ");
  if (token.length === 0 || !SINGLE_RE.test(token)) return undefined;

  // integer/decimal + unicode fraction, e.g. "1½"
  const mixedUnicode = new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*([${FRACTION_CHARS}])$`, "u").exec(token);
  if (mixedUnicode) {
    const whole = Number(mixedUnicode[1]!.replace(",", "."));
    return whole + (UNICODE_FRACTIONS[mixedUnicode[2]!] ?? 0);
  }

  // bare unicode fraction
  const bare = UNICODE_FRACTIONS[token];
  if (bare !== undefined) return bare;

  // mixed ascii fraction "1 1/2"
  const mixed = /^(\d+)\s+(\d+)\s*\/\s*(\d+)$/.exec(token);
  if (mixed) {
    const denominator = Number(mixed[3]);
    if (denominator === 0) return undefined;
    return Number(mixed[1]) + Number(mixed[2]) / denominator;
  }

  // plain fraction "3/4"
  const fraction = /^(\d+)\s*\/\s*(\d+)$/.exec(token);
  if (fraction) {
    const denominator = Number(fraction[2]);
    if (denominator === 0) return undefined;
    return Number(fraction[1]) / denominator;
  }

  // decimal with German comma or dot
  const value = Number(token.replace(",", "."));
  return Number.isFinite(value) ? value : undefined;
}

export interface QuantityRange {
  /** Lower bound (or the only value). */
  value: number;
  /** Upper bound when the source expressed a range ("2-3 Eier"). */
  max?: number;
}

/**
 * Parses a quantity that may be a range: "2-3", "2 bis 3", "2–3", "1/2 - 1".
 * Returns undefined when nothing numeric is found.
 */
export function parseQuantityRange(raw: string): QuantityRange | undefined {
  const token = raw.trim().replace(/\s+/g, " ");
  const rangeRe = new RegExp(`^(${QUANTITY_TOKEN})\\s*(?:-|–|—|bis|to)\\s*(${QUANTITY_TOKEN})$`, "iu");
  const range = rangeRe.exec(token);
  if (range) {
    const low = parseNumberToken(range[1]!);
    const high = parseNumberToken(range[2]!);
    if (low !== undefined && high !== undefined) {
      return high > low ? { value: low, max: high } : { value: low };
    }
  }
  const single = parseNumberToken(token);
  return single === undefined ? undefined : { value: single };
}

/** Rounds to at most `digits` decimals, killing float noise (0.30000000000000004). */
export function roundTo(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Rounds a scaled quantity to something a human would write:
 * snaps close-to-fraction values onto the fraction, keeps large values whole.
 */
export function roundQuantity(value: number): number {
  if (!Number.isFinite(value)) return value;
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  if (abs >= 100) return sign * Math.round(abs);
  if (abs >= 10) return sign * roundTo(abs, 1);

  const whole = Math.floor(abs);
  const rest = abs - whole;
  if (rest < 0.02) return sign * whole;
  if (rest > 0.98) return sign * (whole + 1);
  for (const [fractionValue] of FRACTION_OUTPUT) {
    if (Math.abs(rest - fractionValue) <= 0.021) return sign * roundTo(whole + fractionValue, 3);
  }
  return sign * roundTo(abs, 2);
}

/**
 * Renders a quantity the German way: unicode fractions where they fit,
 * decimal comma otherwise. `formatQuantity(1.5) === "1½"`, `formatQuantity(0.75) === "¾"`.
 */
export function formatQuantity(value: number): string {
  if (!Number.isFinite(value)) return "";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const whole = Math.floor(abs + 1e-9);
  const rest = abs - whole;
  if (rest < 1e-9) return `${sign}${whole}`;
  for (const [fractionValue, glyph] of FRACTION_OUTPUT) {
    if (Math.abs(rest - fractionValue) < 0.005) {
      return whole === 0 ? `${sign}${glyph}` : `${sign}${whole}${glyph}`;
    }
  }
  return `${sign}${roundTo(abs, 2).toString().replace(".", ",")}`;
}
