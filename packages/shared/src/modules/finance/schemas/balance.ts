import { Effect, Schema, type Types } from "effect";
import { IdSchema, IsoDateSchema } from "../../../core/schemas/common.ts";
import { Int, Str, nonnegative } from "../../../core/schemas/checks.ts";
import { BooleanQuerySchema, CentsSchema, PeriodSchema } from "./common.ts";

/** Mirrors `BalanceBreakdown` from `ledger.ts` — same field names, same sign convention. */
export const BalanceBreakdownSchema = Schema.Struct({
  splitOtherCents: CentsSchema,
  forOtherCents: CentsSchema,
  settledCents: CentsSchema,
  transactionCount: Int.check(nonnegative()),
});
export type BalanceBreakdownResponse = Types.DeepMutable<typeof BalanceBreakdownSchema.Type>;

/**
 * **Positive `balanceCents` = `member_slot 2` owes `member_slot 1`.** One
 * convention, chosen once (docs/ledger-spec.md §5.1). The UI never shows a
 * raw sign — it renders `viewerBalanceCents` through the three
 * `balance.owesYou` / `balance.youOwe` / `balance.settled` catalog keys.
 */
export const BalanceResponseSchema = Schema.Struct({
  balanceCents: CentsSchema,
  /** The person at `member_slot 1` — the perspective `balanceCents` is expressed for. */
  perspectiveUserId: IdSchema,
  viewerUserId: IdSchema,
  /** `balanceCents`, negated when the viewer is `member_slot 2`. */
  viewerBalanceCents: CentsSchema,
  asOf: IsoDateSchema,
  breakdown: BalanceBreakdownSchema,
});
export type BalanceResponse = Types.DeepMutable<typeof BalanceResponseSchema.Type>;

export const BalanceQuerySchema = Schema.Struct({
  includeAggregates: BooleanQuerySchema.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
});
export type BalanceQuery = Types.DeepMutable<typeof BalanceQuerySchema.Type>;

export const BalanceHistoryQuerySchema = Schema.Struct({
  from: Schema.optional(Str),
  to: Schema.optional(Str),
  includeAggregates: BooleanQuerySchema.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
});
export type BalanceHistoryQuery = Types.DeepMutable<typeof BalanceHistoryQuerySchema.Type>;

export const BalanceHistoryPointSchema = Schema.Struct({
  period: PeriodSchema,
  deltaCents: CentsSchema,
  balanceCents: CentsSchema,
});

export const BalanceHistoryResponseSchema = Schema.Struct({ items: Schema.Array(BalanceHistoryPointSchema) });
export type BalanceHistoryResponse = Types.DeepMutable<typeof BalanceHistoryResponseSchema.Type>;
