/**
 * The fixed-cost plan's pure math: the income-proportional share of the
 * month's fixed costs (docs/ledger-spec.md §4). This is the reason the app
 * exists — everything here is deterministic given `period`, the active items
 * and the effective incomes; no I/O, no clock, no database.
 */
import { divRoundHalfAwayFromZero } from "./money.ts";
import { comparePeriods, type Period } from "./period.ts";

export interface FixedCostItem {
  amountCents: number;
  activeFrom: Period;
  activeTo: Period | null;
}

export interface IncomeEntry {
  personId: string;
  amountCents: number;
  validFrom: Period;
  validTo: Period | null;
}

/** The fixed-cost items whose `[activeFrom, activeTo]` range covers `period`, inclusive on both ends. */
export function activeItemsIn<T extends Pick<FixedCostItem, "activeFrom" | "activeTo">>(
  items: readonly T[],
  period: Period,
): T[] {
  return items.filter(
    (item) => comparePeriods(item.activeFrom, period) <= 0 && (item.activeTo === null || comparePeriods(period, item.activeTo) <= 0),
  );
}

/**
 * The income row for `personId` effective in `period`, or `null` if none
 * covers it. If more than one candidate overlaps (the two-overlap case the
 * service is responsible for rejecting as `plan_incomplete` —
 * docs/spec.md §3.7), the one with the latest `validFrom` wins; this
 * function never throws.
 */
export function incomeIn<T extends Pick<IncomeEntry, "personId" | "validFrom" | "validTo">>(
  incomes: readonly T[],
  personId: string,
  period: Period,
): T | null {
  let latest: T | null = null;
  for (const income of incomes) {
    if (income.personId !== personId) continue;
    if (comparePeriods(income.validFrom, period) > 0) continue;
    if (income.validTo !== null && comparePeriods(period, income.validTo) > 0) continue;
    if (!latest || comparePeriods(income.validFrom, latest.validFrom) > 0) latest = income;
  }
  return latest;
}

export interface PlanShare {
  personId: string;
  incomeCents: number;
  shareCents: number;
}

export interface PlanComputation {
  period: Period;
  costTotalCents: number;
  incomeTotalCents: number;
  /** = costTotalCents — the quote stays a fraction, never a float, until rendered. */
  quoteNumerator: number;
  /** = incomeTotalCents */
  quoteDenominator: number;
  shares: PlanShare[];
  payerId: string;
  /** The non-payer's share — the amount that becomes a transaction. */
  bookableCents: number;
}

export interface ComputePlanForPeriodInput {
  period: Period;
  items: readonly FixedCostItem[];
  incomes: readonly IncomeEntry[];
  /** Who fronts the fixed costs (`fixed_cost_plans.payer_id`). */
  payerId: string;
  /** The other household member — whose share gets booked, as `OTHER_ONLY`. */
  otherId: string;
}

/**
 * Derives one period's plan computation (docs/ledger-spec.md §4.2):
 *
 * ```
 * costTotal(p)   = Σ item.amountCents        for items active in p
 * incomeTotal(p) = Σ income.amountCents      for the income row effective in p, per person
 * share(other,p) = divRoundHalfAwayFromZero(income(other,p) × costTotal(p), incomeTotal(p))
 * payerShare(p)  = costTotal(p) − share(other,p)     -- the complement, never a second rounding
 * bookable(p)    = share(other,p)
 * ```
 *
 * Only the non-payer's share is ever rounded; the payer's share is *defined*
 * as the complement, so the two numbers always reconstruct `costTotalCents`
 * exactly and the residual cent always lands on the payer.
 */
export function computePlanForPeriod(input: ComputePlanForPeriodInput): PlanComputation {
  const { period, items, incomes, payerId, otherId } = input;

  const costTotalCents = activeItemsIn(items, period).reduce((sum, item) => sum + item.amountCents, 0);

  const payerIncomeCents = incomeIn(incomes, payerId, period)?.amountCents ?? 0;
  const otherIncomeCents = incomeIn(incomes, otherId, period)?.amountCents ?? 0;
  const incomeTotalCents = payerIncomeCents + otherIncomeCents;

  const otherShareCents =
    incomeTotalCents > 0 ? divRoundHalfAwayFromZero(otherIncomeCents * costTotalCents, incomeTotalCents) : 0;
  const payerShareCents = costTotalCents - otherShareCents;

  return {
    period,
    costTotalCents,
    incomeTotalCents,
    quoteNumerator: costTotalCents,
    quoteDenominator: incomeTotalCents,
    shares: [
      { personId: payerId, incomeCents: payerIncomeCents, shareCents: payerShareCents },
      { personId: otherId, incomeCents: otherIncomeCents, shareCents: otherShareCents },
    ],
    payerId,
    bookableCents: otherShareCents,
  };
}

/**
 * Formats a `costTotal/incomeTotal` fraction as a de-DE (or en-GB) percentage,
 * e.g. `"23,75 %"`. Display-only — never used as an intermediate
 * multiplicand (docs/ledger-spec.md §4.2).
 */
export function formatQuote(numerator: number, denominator: number, locale: "de-DE" | "en-GB" = "de-DE"): string {
  const ratio = denominator === 0 ? 0 : numerator / denominator;
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 2 }).format(ratio);
}
