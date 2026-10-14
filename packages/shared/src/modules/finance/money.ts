/**
 * Cent arithmetic and German amount formatting/parsing (docs/ledger-spec.md
 * §3). All money in this app is a signed integer number of EUR cents. No
 * float, no `parseFloat` on user input, no decimal string ever crosses
 * `@toon/shared`'s boundary as money. `formatCents` is the one exception —
 * display-only, and even `apps/web` wraps its own locale-aware
 * `formatCurrency` around the same `Intl` call rather than parsing a string
 * back out of it.
 */

export const CENTS_PER_EURO = 100;

/**
 * The non-payer's share of an equally split amount. The payer bears the odd
 * cent, in BOTH sign directions (docs/ledger-spec.md §3.2):
 * `halfForOther(-101)` is `-50`, never `-51`. JS `%` truncates toward zero
 * (it takes the sign of the dividend), which is exactly the rounding this
 * needs. Never `Math.floor(cents / 2)` (floors negatives the wrong way),
 * never `Math.round(cents / 2)` (sign-inconsistent on odd negatives), never
 * `cents >> 1` (silently wrong above 2^31).
 */
export function halfForOther(cents: number): number {
  return (cents - (cents % 2)) / 2;
}

/**
 * The payer's own share — always the complement of {@link halfForOther}, so
 * the two shares reconstruct the total exactly for every `cents`, including
 * negative ones.
 */
export function halfForPayer(cents: number): number {
  return cents - halfForOther(cents);
}

/**
 * `round(n / d)`, half away from zero, using integers only
 * (docs/ledger-spec.md §3.4). `d` must be a positive integer. This is the
 * ONLY rounding step in the fixed-cost plan's income-proportional share —
 * never a float division, never a second rounding call on the complement.
 */
export function divRoundHalfAwayFromZero(n: number, d: number): number {
  const q = (2 * Math.abs(n) + d) / (2 * d);
  return Math.sign(n) * Math.floor(q);
}

/**
 * Parses a German-formatted amount string into signed integer cents, or
 * `null` if the string is not a recognisable amount. Accepts:
 *
 *  - `"1.234,56"` — thousands dot, decimal comma (the primary de-DE form)
 *  - `"1234,56"`  — decimal comma, no thousands separator
 *  - `"1234.56"`  — a plain decimal dot, so a pasted English/US-formatted
 *    number still parses
 *  - a leading `-`, surrounding whitespace, and a trailing `€`
 *
 * This is the general-purpose UI parser behind `AmountInput`. It is
 * deliberately more permissive than `import/amounts.ts`'s cell parser, which
 * only ever sees a handful of literal sheet cells and rejects anything it
 * cannot parse loudly instead of guessing (docs/ledger-spec.md §6.2).
 */
export function parseGermanAmount(input: string): number | null {
  const trimmed = input.trim().replace(/\s+/g, "").replace(/€$/u, "");
  if (trimmed === "") return null;

  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  if (unsigned === "" || unsigned.startsWith("-") || unsigned.startsWith("+")) return null;

  const hasComma = unsigned.includes(",");
  const hasDot = unsigned.includes(".");

  let integerPart: string;
  let fractionPart: string;

  if (hasComma) {
    // A comma is always the decimal separator here; any dot before it is a
    // thousands separator ("1.234,56").
    const commaIndex = unsigned.lastIndexOf(",");
    integerPart = unsigned.slice(0, commaIndex).replaceAll(".", "");
    fractionPart = unsigned.slice(commaIndex + 1);
  } else if (hasDot) {
    // No comma: a single dot followed by 1-2 digits is read as a decimal
    // point ("1234.56"); anything else (several dots, or 3 trailing digits)
    // is a thousands grouping with no cents given ("1.234" == 1234,00).
    const dotIndex = unsigned.lastIndexOf(".");
    const afterLastDot = unsigned.slice(dotIndex + 1);
    const singleDot = unsigned.indexOf(".") === dotIndex;
    if (singleDot && afterLastDot.length > 0 && afterLastDot.length <= 2) {
      integerPart = unsigned.slice(0, dotIndex);
      fractionPart = afterLastDot;
    } else {
      integerPart = unsigned.replaceAll(".", "");
      fractionPart = "";
    }
  } else {
    integerPart = unsigned;
    fractionPart = "";
  }

  if (integerPart === "") integerPart = "0";
  if (!/^\d+$/.test(integerPart)) return null;
  if (fractionPart !== "" && !/^\d{1,2}$/.test(fractionPart)) return null;

  const cents = Number(integerPart) * CENTS_PER_EURO + Number(fractionPart.padEnd(2, "0"));
  return negative ? -cents : cents;
}

/**
 * Formats signed integer cents as a `de-DE` currency string, e.g.
 * `"-12,50 €"`. Used by ops-facing output (the import report) that must
 * render dead-simple, locale-fixed money without pulling in a UI dependency.
 * `apps/web`'s `formatCurrency` wraps the same `Intl.NumberFormat` call with
 * the viewer's own locale — this function is not a substitute for it.
 */
export function formatCents(cents: number): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(cents / CENTS_PER_EURO);
}
