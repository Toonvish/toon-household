/**
 * `TransactionListQuery.from`/`.to` (and the summary/balance-history queries)
 * accept EITHER an ISO date/datetime or a `'YYYY-MM'` period (docs/spec.md
 * §3.6). One parser, shared by every reader that offers the two filters, so
 * "what does an out-of-range or garbled value do" has one answer.
 */
import { isPeriod, nextPeriod, periodStartMs } from "@toon/shared";
import { ApiError } from "../../../../lib/errors.ts";

/** A query-string date/period bound -> a unix-ms edge, inclusive on both sides of the range. */
export function parseRangeBound(value: string, edge: "from" | "to"): number {
  if (isPeriod(value)) {
    return edge === "from" ? periodStartMs(value) : periodStartMs(nextPeriod(value)) - 1;
  }
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw ApiError.validationFailed([{ path: edge, code: "invalid_date", message: `"${edge}" is not a valid date or period` }]);
  }
  return ms;
}
