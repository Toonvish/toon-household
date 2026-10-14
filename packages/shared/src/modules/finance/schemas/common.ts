import { z } from "zod";
import { refineKey } from "../../../core/i18n/zod.ts";

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
function isPeriodString(value: string): boolean {
  return PERIOD_RE.test(value);
}

/** A calendar month, `'YYYY-MM'` (docs/ledger-spec.md §0). */
export const PeriodSchema = z.string().refine(isPeriodString, refineKey("server.validation.periodFormat"));
export type PeriodValue = z.infer<typeof PeriodSchema>;

/** Signed integer cents — the only money representation on the wire. Never a float, never a decimal string. */
export const CentsSchema = z.number().int();

/**
 * There is deliberately NO `NonZeroCentsSchema` here. `amountCents === 0` is
 * the only forbidden transaction amount (docs/spec.md §3.6), but a Zod
 * `.refine()` on it would always surface as generic `422 validation_failed`
 * (`lib/errors.ts`), never as the dedicated `transaction_amount_zero` code
 * the wire contract promises — every Zod issue maps to that one code
 * regardless of which refinement failed. That check is thrown directly as an
 * `ApiError` in `transactions.service.ts` instead (review finding: a schema
 * refinement here would be a code path nobody could ever reach through the
 * HTTP API).
 */

/** `CentsSchema`, additionally requiring a positive value (fixed-cost items, incomes, settlement amounts). */
export const PositiveCentsSchema = CentsSchema.refine(
  (value) => value > 0,
  refineKey("server.validation.amountPositive"),
);

/**
 * Query params for a paginated list endpoint. `limit` defaults to 50, max
 * 200 — higher than toon-recipe's 24/100 (docs/spec.md §8.2 #12): a
 * transaction list is a dense row listing, not a card grid, and a month has
 * roughly 60 rows.
 */
export const FinancePaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type FinancePaginationQuery = z.infer<typeof FinancePaginationQuerySchema>;

const BOOLEAN_QUERY_VALUES: Record<string, boolean> = {
  true: true,
  "1": true,
  false: false,
  "0": false,
};

/**
 * A boolean query-string flag (`?includeAggregates=false`). Deliberately NOT
 * `z.coerce.boolean()`: that coerces via `Boolean(value)`, so the STRING
 * `"false"` — truthy as a string — would parse to `true`. This accepts an
 * actual boolean (already-parsed JSON bodies) or the literal strings
 * `"true"/"false"/"1"/"0"` and rejects anything else.
 */
export const BooleanQuerySchema = z.union([z.boolean(), z.string()]).transform((value, ctx) => {
  if (typeof value === "boolean") return value;
  const normalized = BOOLEAN_QUERY_VALUES[value.toLowerCase()];
  if (normalized === undefined) {
    ctx.addIssue({ code: "custom", message: "invalid boolean" });
    return z.NEVER;
  }
  return normalized;
});

/** `household_members.member_slot` — exactly two seats, enforced by the DB (docs/spec.md §2.4). */
export const MemberSlotSchema = z.union([z.literal(1), z.literal(2)]);
export type MemberSlot = z.infer<typeof MemberSlotSchema>;
