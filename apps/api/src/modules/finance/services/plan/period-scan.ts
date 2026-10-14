/**
 * The pure "which periods, and are they computable" half of the fixed-cost
 * plan (docs/spec.md §3.7, ledger-spec.md §4.5). Shared by `plan.service.ts`
 * (preview, `pendingPeriods`) and `accrual.service.ts` (the actual catch-up
 * booking loop) so the two never compute two different answers to "is period
 * p ready to book" or "what range would a run cover right now".
 */
import { activeItemsIn, comparePeriods, type FixedCostItem, type IncomeEntry, nextPeriod, type Period, previousPeriod } from "@toon/shared";

/** The chronologically later of two periods. */
export function maxPeriod(a: Period, b: Period): Period {
  return comparePeriods(a, b) >= 0 ? a : b;
}

/**
 * `[from, to]` a catch-up run covers right now (ledger-spec.md §4.5):
 * `from` picks up right after `lastBookedPeriod` (or `startPeriod` itself, on
 * a plan that never booked anything), clamped to never start before
 * `startPeriod`. `to` is `through` (default: the current period), clamped so
 * a run NEVER books the future.
 */
export function catchUpRange(
  startPeriod: Period,
  lastBookedPeriod: Period | null,
  nowPeriod: Period,
  through?: Period,
): { from: Period; to: Period } {
  const from = maxPeriod(startPeriod, nextPeriod(lastBookedPeriod ?? previousPeriod(startPeriod)));
  const to = through && comparePeriods(through, nowPeriod) < 0 ? through : nowPeriod;
  return { from, to };
}

function incomeCandidateCount<T extends Pick<IncomeEntry, "personId" | "validFrom" | "validTo">>(
  incomes: readonly T[],
  personId: string,
  period: Period,
): number {
  return incomes.filter(
    (income) =>
      income.personId === personId &&
      comparePeriods(income.validFrom, period) <= 0 &&
      (income.validTo === null || comparePeriods(period, income.validTo) <= 0),
  ).length;
}

/**
 * `plan_incomplete` (docs/spec.md §3.7): no fixed-cost item active in `period`,
 * or either person has zero or MORE THAN ONE income row covering it. The DB
 * only rejects two incomes with the exact same `validFrom` (docs/spec.md
 * §2.11); a genuine overlap across different `validFrom`s is caught here,
 * at compute time, rather than by silently picking one via `incomeIn`'s
 * latest-wins tie-break.
 */
export function isPlanComputable<
  Item extends Pick<FixedCostItem, "activeFrom" | "activeTo">,
  Income extends Pick<IncomeEntry, "personId" | "validFrom" | "validTo">,
>(items: readonly Item[], incomes: readonly Income[], period: Period, payerId: string, otherId: string): boolean {
  if (activeItemsIn(items, period).length === 0) return false;
  if (incomeCandidateCount(incomes, payerId, period) !== 1) return false;
  if (incomeCandidateCount(incomes, otherId, period) !== 1) return false;
  return true;
}

/** `'YYYY-MM'` -> `'MM/YYYY'`, the format the booking/adjustment description templates interpolate. */
export function periodAsMonthSlashYear(period: Period): string {
  const [year, month] = period.split("-");
  return `${month}/${year}`;
}
