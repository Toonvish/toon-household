import { z } from "zod";
import { IdSchema, IsoDateSchema } from "../../../core/schemas/common.ts";
import { CentsSchema } from "./common.ts";
import { BalanceResponseSchema } from "./balance.ts";
import { TransactionResponseSchema } from "./transactions.ts";

export const CreateSettlementRequestSchema = z.object({
  /** REQUIRED — the balance the client displayed. A mismatch answers `409 balance_stale`. */
  expectedBalanceCents: CentsSchema,
  /** Defaults to `Math.abs(balance)` server-side; must be > 0 when given. */
  amountCents: z.number().int().positive().optional(),
  note: z.string().trim().max(200).optional(),
  bookedAt: IsoDateSchema.optional(),
  mutationId: IdSchema.optional(),
});
export type CreateSettlementRequest = z.infer<typeof CreateSettlementRequestSchema>;

export const SettlementResponseSchema = z.object({
  transaction: TransactionResponseSchema,
  balance: BalanceResponseSchema,
});
export type SettlementResponse = z.infer<typeof SettlementResponseSchema>;
