import { Schema, type Types } from "effect";
import { IdSchema, IsoDateSchema } from "../../../core/schemas/common.ts";
import { Str, maxLength, positive, trim } from "../../../core/schemas/checks.ts";
import { CentsSchema } from "./common.ts";
import { BalanceResponseSchema } from "./balance.ts";
import { TransactionResponseSchema } from "./transactions.ts";

export const CreateSettlementRequestSchema = Schema.Struct({
  /** REQUIRED — the balance the client displayed. A mismatch answers `409 balance_stale`. */
  expectedBalanceCents: CentsSchema,
  /** Defaults to `Math.abs(balance)` server-side; must be > 0 when given. */
  amountCents: Schema.optional(CentsSchema.check(positive())),
  note: Schema.optional(Str.pipe(trim).check(maxLength(200))),
  bookedAt: Schema.optional(IsoDateSchema),
  mutationId: Schema.optional(IdSchema),
});
export type CreateSettlementRequest = Types.DeepMutable<typeof CreateSettlementRequestSchema.Type>;

export const SettlementResponseSchema = Schema.Struct({
  transaction: TransactionResponseSchema,
  balance: BalanceResponseSchema,
});
export type SettlementResponse = Types.DeepMutable<typeof SettlementResponseSchema.Type>;
