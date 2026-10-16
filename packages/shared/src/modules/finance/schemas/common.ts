import { Effect, Schema, SchemaTransformation, type Types } from "effect";
import { Bool, CoercedInt, Int, Lit, OneOf, Str, keyed, max, min, wireIssue } from "../../../core/schemas/checks.ts";

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
function isPeriodString(value: string): boolean {
  return PERIOD_RE.test(value);
}

/**
 * The earliest and latest month the API accepts anywhere a period is input
 * (toon-finance 1715207). `YYYY` alone admits `0001-01`, and every plan path
 * walks `periodsInclusive(from, now)`: a household whose `startPeriod` is year 1
 * makes the boot catch-up loop ~24 000 months inside ONE write transaction
 * before the server accepts traffic. A cash book for two has no month before
 * 2000 and none after 2100.
 */
export const MIN_PERIOD = "2000-01";
export const MAX_PERIOD = "2100-12";

/** A calendar month, `'YYYY-MM'` (docs/ledger-spec.md §0), inside `[MIN_PERIOD, MAX_PERIOD]`. */
export const PeriodSchema = Str.check(
  keyed(isPeriodString, "server.validation.periodFormat"),
  keyed((value: string) => value >= MIN_PERIOD && value <= MAX_PERIOD, "server.validation.periodBounds"),
);
export type PeriodValue = Types.DeepMutable<typeof PeriodSchema.Type>;

/** Signed integer cents — the only money representation on the wire. Never a float, never a decimal string. */
export const CentsSchema = Int;

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
export const PositiveCentsSchema = CentsSchema.check(keyed((value: number) => value > 0, "server.validation.amountPositive"));

/**
 * Query params for a paginated list endpoint. `limit` defaults to 50, max
 * 200 — higher than toon-recipe's 24/100 (docs/spec.md §8.2 #12): a
 * transaction list is a dense row listing, not a card grid, and a month has
 * roughly 60 rows.
 */
export const FinancePaginationQuerySchema = Schema.Struct({
  limit: CoercedInt.check(min(1), max(200)).pipe(Schema.withDecodingDefault(Effect.succeed(50))),
  offset: CoercedInt.check(min(0)).pipe(Schema.withDecodingDefault(Effect.succeed(0))),
});
export type FinancePaginationQuery = Types.DeepMutable<typeof FinancePaginationQuerySchema.Type>;

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
export const BooleanQuerySchema = OneOf([Bool, Str]).pipe(
  Schema.decodeTo(
    Bool,
    SchemaTransformation.transformEffect<boolean, boolean | string>({
      decode: (value) => {
        if (typeof value === "boolean") return Effect.succeed(value);
        const normalized = BOOLEAN_QUERY_VALUES[value.toLowerCase()];
        // A custom issue without a key: the resolver ladder falls to `server.zod.fallback`, as zod's `ctx.addIssue` did.
        return normalized === undefined ? Effect.fail(wireIssue({ code: "custom" })) : Effect.succeed(normalized);
      },
      encode: (value) => Effect.succeed(value),
    }),
  ),
);

/** `household_members.member_slot` — exactly two seats, enforced by the DB (docs/spec.md §2.4). */
export const MemberSlotSchema = OneOf([Lit(1), Lit(2)]);
export type MemberSlot = Types.DeepMutable<typeof MemberSlotSchema.Type>;
