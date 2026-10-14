import { z } from "zod";
import { IdSchema, IsoDateSchema } from "../../../core/schemas/common.ts";
import { BooleanQuerySchema, CentsSchema, PeriodSchema } from "./common.ts";

/** Mirrors `BalanceBreakdown` from `ledger.ts` — same field names, same sign convention. */
export const BalanceBreakdownSchema = z.object({
  splitOtherCents: CentsSchema,
  forOtherCents: CentsSchema,
  settledCents: CentsSchema,
  transactionCount: z.number().int().nonnegative(),
});
export type BalanceBreakdownResponse = z.infer<typeof BalanceBreakdownSchema>;

/**
 * **Positive `balanceCents` = `member_slot 2` owes `member_slot 1`.** One
 * convention, chosen once (docs/ledger-spec.md §5.1). The UI never shows a
 * raw sign — it renders `viewerBalanceCents` through the three
 * `balance.owesYou` / `balance.youOwe` / `balance.settled` catalog keys.
 */
export const BalanceResponseSchema = z.object({
  balanceCents: CentsSchema,
  /** The person at `member_slot 1` — the perspective `balanceCents` is expressed for. */
  perspectiveUserId: IdSchema,
  viewerUserId: IdSchema,
  /** `balanceCents`, negated when the viewer is `member_slot 2`. */
  viewerBalanceCents: CentsSchema,
  asOf: IsoDateSchema,
  breakdown: BalanceBreakdownSchema,
});
export type BalanceResponse = z.infer<typeof BalanceResponseSchema>;

export const BalanceQuerySchema = z.object({
  includeAggregates: BooleanQuerySchema.default(true),
});
export type BalanceQuery = z.infer<typeof BalanceQuerySchema>;

export const BalanceHistoryQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  includeAggregates: BooleanQuerySchema.default(true),
});
export type BalanceHistoryQuery = z.infer<typeof BalanceHistoryQuerySchema>;

export const BalanceHistoryPointSchema = z.object({
  period: PeriodSchema,
  deltaCents: CentsSchema,
  balanceCents: CentsSchema,
});

export const BalanceHistoryResponseSchema = z.object({ items: z.array(BalanceHistoryPointSchema) });
export type BalanceHistoryResponse = z.infer<typeof BalanceHistoryResponseSchema>;
