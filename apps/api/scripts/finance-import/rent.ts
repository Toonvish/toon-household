/**
 * [IMPORT] Rent-series expansion (docs/ledger-spec.md §6.5): the 14
 * `(amountCents, months)` pairs read from `M23:M36`/`N23:N36` become one
 * `OTHER_ONLY` transaction per month, contiguous, starting at the named
 * constant `2022-06` (the only anchor for the series' start — `O16`'s label
 * `"Robin Miete ab 01.06.2022"`, docs/ledger-spec.md §1.7 point 3).
 */
import { nextPeriod, type Period } from "@toon/shared";

/** The rent series' first booked period — not stored anywhere in the sheet, so it is a named constant, not a buried literal. */
export const RENT_SERIES_START: Period = "2022-06";

/**
 * `(amountCents, months)`, as read straight off `M23:M36`/`N23:N36` — a
 * tuple, not an object, so this lines up byte-for-byte with
 * `packages/shared/test/fixtures/haushalt-xlsx.ts`'s `RENT_SERIES`
 * (`ReadonlyArray<readonly [amountCents, months]>`), which every test in
 * this repo that touches the rent series imports from.
 */
export type RentSeriesPair = readonly [amountCents: number, months: number];

export interface RentBooking {
  period: Period;
  amountCents: number;
}

/** One booking per month, in order, starting at `startPeriod`. No rounding: every amount is whole cents times an integer month count. */
export function expandRentSeries(pairs: readonly RentSeriesPair[], startPeriod: Period = RENT_SERIES_START): RentBooking[] {
  const bookings: RentBooking[] = [];
  let period = startPeriod;
  for (const [amountCents, months] of pairs) {
    for (let i = 0; i < months; i++) {
      bookings.push({ period, amountCents });
      period = nextPeriod(period);
    }
  }
  return bookings;
}
