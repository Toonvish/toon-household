import { z } from "zod";
import { IdSchema, IsoDateSchema, listResponse } from "../../../core/schemas/common.ts";
import { BooleanQuerySchema, CentsSchema, FinancePaginationQuerySchema, PeriodSchema } from "./common.ts";
import { TagNameSchema } from "./tags.ts";

/** The four kinds the create/edit flow and the list filter offer (docs/ledger-spec.md §2.2). */
export const TxKindSchema = z.enum(["MINE_SPLIT", "THEIRS_SPLIT", "FOR_THEM", "TRANSFER"]);
export type TxKindValue = z.infer<typeof TxKindSchema>;

export const SplitModeSchema = z.enum(["SPLIT_EQUAL", "OTHER_ONLY", "SETTLEMENT"]);
export type SplitModeValue = z.infer<typeof SplitModeSchema>;

export const TransactionOriginSchema = z.enum(["manual", "fixed_plan", "fixed_plan_adjustment", "import"]);
export type TransactionOriginValue = z.infer<typeof TransactionOriginSchema>;

export const DateSourceSchema = z.enum(["exact", "day", "month", "estimated"]);
export type DateSourceValue = z.infer<typeof DateSourceSchema>;

export const TagRefSchema = z.object({ id: IdSchema, name: z.string() });
export type TagRef = z.infer<typeof TagRefSchema>;

export const TransactionDescriptionSchema = z.string().trim().min(1).max(200);

/**
 * `amountCents` is plain `CentsSchema` here, NOT the schema-level "forbid 0"
 * refinement it might look like it wants — that refinement's error would
 * always surface as generic `422 validation_failed` (every Zod issue does,
 * `lib/errors.ts`'s `toApiError`), never as the dedicated `transaction_
 * amount_zero` docs/spec.md §3.2/§3.6 promises API consumers can branch on.
 * The zero check instead lives in `transactions.service.ts`, which throws
 * `ApiError` directly with that exact code (review finding: a dead wire
 * contract nobody ever produced).
 */
export const CreateTransactionRequestSchema = z.object({
  kind: TxKindSchema,
  amountCents: CentsSchema,
  description: TransactionDescriptionSchema,
  categoryId: IdSchema.nullish(),
  /** Tag NAMES, not ids — unknown ones are created (docs/spec.md §3.6); at most 20 per row (one INSERT each, inside the create transaction). */
  tags: z.array(TagNameSchema).max(20).optional(),
  bookedAt: IsoDateSchema.optional(),
  mutationId: IdSchema.optional(),
});
export type CreateTransactionRequest = z.infer<typeof CreateTransactionRequestSchema>;

/** Replace-all-when-present: `tags` present in the body replaces every link; absent leaves them untouched. */
export const UpdateTransactionRequestSchema = CreateTransactionRequestSchema.partial();
export type UpdateTransactionRequest = z.infer<typeof UpdateTransactionRequestSchema>;

export const TransactionResponseSchema = z.object({
  id: IdSchema,
  householdId: IdSchema,
  payerId: IdSchema,
  splitMode: SplitModeSchema,
  amountCents: CentsSchema,
  description: z.string(),
  categoryId: IdSchema.nullable(),
  categorySlug: z.string().nullable(),
  tags: z.array(TagRefSchema),
  bookedAt: IsoDateSchema,
  dateSource: DateSourceSchema,
  origin: TransactionOriginSchema,
  planPeriod: PeriodSchema.nullable(),
  createdBy: IdSchema.nullable(),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
  /** What the NON-paying person bears — derived server-side so the client never re-derives it. */
  otherShareCents: CentsSchema,
  /** The complement, exact. */
  payerShareCents: CentsSchema,
  /** This row's signed contribution to the balance, from `member_slot 1`'s perspective. */
  balanceDeltaCents: CentsSchema,
  /** `splitMode !== "SETTLEMENT"`. */
  isExpense: z.boolean(),
});
export type TransactionResponse = z.infer<typeof TransactionResponseSchema>;

export const TransactionListResponseSchema = listResponse(TransactionResponseSchema);
export type TransactionListResponse = z.infer<typeof TransactionListResponseSchema>;

export const TransactionSortSchema = z.enum(["bookedAt", "-bookedAt", "amount", "-amount"]);

export const TransactionListQuerySchema = FinancePaginationQuerySchema.extend({
  /** ISO date or `'YYYY-MM'` — both are accepted, so this stays a plain string. */
  from: z.string().optional(),
  to: z.string().optional(),
  /** A projection onto the viewer, resolved server-side against `(payerId, splitMode)`. */
  kind: TxKindSchema.optional(),
  splitMode: SplitModeSchema.optional(),
  payerId: IdSchema.optional(),
  categoryId: IdSchema.optional(),
  /** Comma-separated tag ids — a transaction must carry ALL of them. */
  tagIds: z.string().max(400).optional(),
  origin: TransactionOriginSchema.optional(),
  /** Case-insensitive `LIKE` on `description`. No FTS. */
  q: z.string().max(100).optional(),
  /** Default true; false hides rows tagged `sammelbuchung`. */
  includeAggregates: BooleanQuerySchema.default(true),
  sort: TransactionSortSchema.default("-bookedAt"),
});
export type TransactionListQuery = z.infer<typeof TransactionListQuerySchema>;

export const TransactionSummaryQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  includeAggregates: BooleanQuerySchema.default(true),
});
export type TransactionSummaryQuery = z.infer<typeof TransactionSummaryQuerySchema>;

export const CategorySpendSchema = z.object({
  categoryId: IdSchema.nullable(),
  categorySlug: z.string().nullable(),
  totalCents: CentsSchema,
  count: z.number().int().nonnegative(),
});

export const MonthSpendSchema = z.object({
  period: PeriodSchema,
  totalCents: CentsSchema,
  balanceDeltaCents: CentsSchema,
});

export const TransactionSummaryResponseSchema = z.object({
  from: z.string(),
  to: z.string(),
  /** Sum of every `isExpense` row. Settlements are excluded. */
  totalExpenseCents: CentsSchema,
  byCategory: z.array(CategorySpendSchema),
  byMonth: z.array(MonthSpendSchema),
  settlementTotalCents: CentsSchema,
});
export type TransactionSummaryResponse = z.infer<typeof TransactionSummaryResponseSchema>;
