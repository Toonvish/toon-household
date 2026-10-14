/**
 * OCR confusion repair — applied ONLY in a quantity/unit context.
 *
 * Tesseract reliably confuses O/0, l/I/1, S/5 and the decimal separator. Fixing
 * those globally would destroy ingredient NAMES ("Salz" -> "5alz", "Olivenöl" ->
 * "0livenöl"), so the repair is scoped to the leading amount token of a line and
 * to the unit token that follows it — the only place where a digit is expected.
 *
 * Rules (deliberately conservative — a missed fix is fine, a corrupted name is not):
 *   - the amount token is repaired when it already contains an ASCII digit,
 *     e.g. "25O g" -> "250 g", "1,S kg" -> "1,5 kg", "l00 ml" (has no digit but
 *     is all-confusable, see below);
 *   - a token made *entirely* of confusable glyphs is repaired only when it is
 *     at most two characters long and a known unit follows: "l EL" -> "1 EL";
 *   - the unit token is repaired from a small alias table, and only when the
 *     amount token really is numeric: "250 9 Mehl" -> "250 g Mehl";
 *   - EVERYTHING after the unit is returned byte-for-byte unchanged.
 */
import { isKnownUnit, parseNumberToken } from "@toon/shared";

/** Glyphs Tesseract swaps for digits, and what they should have been. */
const DIGIT_CONFUSIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/[OoQ]/g, "0"],
  [/[IlĮ|!\]\[]/g, "1"],
  [/[Ss]/g, "5"],
  [/[B]/g, "8"],
  [/[Zz]/g, "2"],
];

/** Characters that may appear in an amount token before repair. */
const AMOUNT_CHARS = "0-9OoQIlĮ|!\\[\\]SsBZz.,'`´/\\-–—½¼¾⅓⅔⅛";
const AMOUNT_PREFIX_RE = new RegExp(`^([${AMOUNT_CHARS}]+)(.*)$`, "u");
const ALL_CONFUSABLE_RE = /^[OoQIlĮ|!\][SsBZz]+$/u;

/**
 * Unit tokens OCR gets wrong. Keys are matched case-sensitively first, then
 * case-insensitively, and only ever when the preceding token is a number.
 */
const UNIT_CONFUSIONS: Record<string, string> = {
  "9": "g",
  q: "g",
  "9r": "g",
  gr: "g",
  "g.": "g",
  kq: "kg",
  k9: "kg",
  mI: "ml",
  rnl: "ml",
  rn1: "ml",
  m1: "ml",
  rng: "mg",
  m9: "mg",
  TI: "TL",
  T1: "TL",
  "T[": "TL",
  // NOTE: "EI" is deliberately ABSENT — in a German recipe "EI"/"Ei" is an egg,
  // not a tablespoon, so mapping it to "EL" would corrupt real ingredients.
  E1: "EL",
  "E[": "EL",
  Prlse: "Prise",
  Pck: "Pck.",
  Stk: "Stück",
  Msp: "Msp.",
};

/** Repairs digit confusions inside a token that is meant to be a number. */
function repairDigits(token: string): string {
  let out = token;
  for (const [pattern, replacement] of DIGIT_CONFUSIONS) out = out.replace(pattern, replacement);
  // Unify decimal/thousand separators: "1.5"/"1'5" -> "1,5", "1 , 5" -> "1,5".
  out = out.replace(/(\d)\s*['`´.,]\s*(\d)/g, "$1,$2");
  // "1/2" style fractions keep their slash; strip stray leading/trailing noise.
  return out.replace(/^[,.'`´-]+/, "").replace(/[,.'`´]+$/, "");
}

/** Repairs a unit token, returning it unchanged when nothing is known to be wrong. */
export function repairUnitToken(token: string): string {
  if (token.length === 0) return token;
  const exact = UNIT_CONFUSIONS[token];
  if (exact !== undefined) return exact;
  const stripped = token.replace(/[.,;:]+$/, "");
  const strippedFix = UNIT_CONFUSIONS[stripped];
  if (strippedFix !== undefined) return strippedFix;
  return token;
}

/**
 * Repairs OCR digit/unit confusions at the START of an ingredient line.
 * The ingredient name is never modified.
 */
export function repairIngredientLine(line: string): string {
  const leading = /^\s*/.exec(line)?.[0] ?? "";
  const body = line.slice(leading.length);
  if (body.length === 0) return line;

  // Keep bullets/dashes out of the token analysis but preserve them verbatim.
  const bulletMatch = /^[-–—•*▪◦‣·+>»]+\s*/u.exec(body);
  const bullet = bulletMatch?.[0] ?? "";
  const rest = body.slice(bullet.length);
  if (rest.length === 0) return line;

  const tokens = rest.split(/(\s+)/); // keeps separators, so joining is lossless
  const wordIndexes: number[] = [];
  for (const [index, token] of tokens.entries()) {
    if (token.trim().length > 0) wordIndexes.push(index);
  }
  if (wordIndexes.length === 0) return line;

  const firstIndex = wordIndexes[0]!;
  const secondIndex = wordIndexes[1];
  const first = tokens[firstIndex]!;
  const second = secondIndex === undefined ? "" : tokens[secondIndex]!;

  const match = AMOUNT_PREFIX_RE.exec(first);
  if (!match) return line;
  const amountPart = match[1]!;
  const gluedSuffix = match[2] ?? "";

  const hasDigit = /[0-9]/.test(amountPart);
  const allConfusable = ALL_CONFUSABLE_RE.test(amountPart);
  const gluedUnitOk = gluedSuffix.length === 0 || isKnownUnit(gluedSuffix) || isKnownUnit(repairUnitToken(gluedSuffix));
  const nextIsUnit = second.length > 0 && (isKnownUnit(second) || isKnownUnit(repairUnitToken(second)));

  // Refuse to touch anything that is not clearly an amount ("Salz", "Stück").
  const isAmountContext = hasDigit
    ? gluedUnitOk || gluedSuffix.length === 0 || /^[\p{L}]{1,6}\.?$/u.test(gluedSuffix)
    : allConfusable && amountPart.length <= 2 && (gluedUnitOk || nextIsUnit);
  if (!isAmountContext) return line;

  const repairedAmount = repairDigits(amountPart);
  // Only accept the repair when it actually yields a parseable number.
  const numeric =
    parseNumberToken(repairedAmount) !== undefined ||
    /^\d+\s*[-–—]\s*\d+$/.test(repairedAmount) ||
    /^\d+\/\d+$/.test(repairedAmount);
  if (!numeric) return line;

  tokens[firstIndex] = repairedAmount + (gluedSuffix.length > 0 ? repairUnitToken(gluedSuffix) : "");

  // The unit token only when there is something after it (else "250 9" could be
  // a quantity range typo rather than "250 g").
  if (secondIndex !== undefined && wordIndexes.length >= 3) {
    tokens[secondIndex] = repairUnitToken(second);
  } else if (secondIndex !== undefined && UNIT_CONFUSIONS[second] !== undefined) {
    tokens[secondIndex] = repairUnitToken(second);
  }

  return leading + bullet + tokens.join("");
}

/** Ligatures and glyph noise that are safe to fix anywhere in the text. */
const GLOBAL_SAFE_FIXES: ReadonlyArray<readonly [RegExp, string]> = [
  [/ﬁ/g, "fi"],
  [/ﬂ/g, "fl"],
  [/ﬀ/g, "ff"],
  [/ﬃ/g, "ffi"],
  [/ﬄ/g, "ffl"],
  [/ß/g, "ß"],
  [/[“”„»«]/g, '"'],
  [/[‘’‚]/g, "'"],
  [/\u00ad/g, ""],
  // "°C" often comes out as "0C" / "oC" right after a temperature.
  [/(\d{2,3})\s*[°o0]\s*C\b/g, "$1 °C"],
  // Degree sign mangled to "*" or "^".
  [/(\d{2,3})\s*[*^]\s*C\b/g, "$1 °C"],
  // Stray spaces before punctuation.
  [/\s+([,.;:!?])/g, "$1"],
];

/**
 * Whole-text cleanups that cannot change the meaning of a word: ligatures,
 * quote glyphs, soft hyphens, degree signs. Applied before segmentation.
 */
export function repairOcrText(text: string): string {
  let out = text.replace(/\r\n?/g, "\n");
  for (const [pattern, replacement] of GLOBAL_SAFE_FIXES) out = out.replace(pattern, replacement);
  return out;
}
