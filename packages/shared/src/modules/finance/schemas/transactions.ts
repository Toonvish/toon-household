import { Effect, Schema, type Types } from "effect";
import { IdSchema, IsoDateSchema, listResponse } from "../../../core/schemas/common.ts";
import { Bool, Enum, Int, Str, maxItems, maxLength, minLength, nonnegative, partial, trim } from "../../../core/schemas/checks.ts";
import { BooleanQuerySchema, CentsSchema, FinancePaginationQuerySchema, PeriodSchema } from "./common.ts";
import { TagNameSchema } from "./tags.ts";

/** The four kinds the create/edit flow and the list filter offer (docs/ledger-spec.md §2.2). */
export const TxKindSchema = Enum(["MINE_SPLIT", "THEIRS_SPLIT", "FOR_THEM", "TRANSFER"]);
export type TxKindValue = Types.DeepMutable<typeof TxKindSchema.Type>;

export const SplitModeSchema = Enum(["SPLIT_EQUAL", "OTHER_ONLY", "SETTLEMENT"]);
export type SplitModeValue = Types.DeepMutable<typeof SplitModeSchema.Type>;

export const TransactionOriginSchema = Enum(["manual", "fixed_plan", "fixed_plan_adjustment", "import"]);
export type TransactionOriginValue = Types.DeepMutable<typeof TransactionOriginSchema.Type>;

export const DateSourceSchema = Enum(["exact", "day", "month", "estimated"]);
export type DateSourceValue = Types.DeepMutable<typeof DateSourceSchema.Type>;

export const TagRefSchema = Schema.Struct({ id: IdSchema, name: Str });
export type TagRef = Types.DeepMutable<typeof TagRefSchema.Type>;

export const TransactionDescriptionSchema = Str.pipe(trim).check(minLength(1), maxLength(200));

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
export const CreateTransactionRequestSchema = Schema.Struct({
  kind: TxKindSchema,
  amountCents: CentsSchema,
  description: TransactionDescriptionSchema,
  categoryId: Schema.optional(Schema.NullOr(IdSchema)),
  /** Tag NAMES, not ids — unknown ones are created (docs/spec.md §3.6); at most 20 per row (one INSERT each, inside the create transaction). */
  tags: Schema.optional(Schema.Array(TagNameSchema).check(maxItems(20))),
  bookedAt: Schema.optional(IsoDateSchema),
  mutationId: Schema.optional(IdSchema),
});
export type CreateTransactionRequest = Types.DeepMutable<typeof CreateTransactionRequestSchema.Type>;

/** Replace-all-when-present: `tags` present in the body replaces every link; absent leaves them untouched. */
export const UpdateTransactionRequestSchema = partial(CreateTransactionRequestSchema);
export type UpdateTransactionRequest = Types.DeepMutable<typeof UpdateTransactionRequestSchema.Type>;

export const TransactionResponseSchema = Schema.Struct({
  id: IdSchema,
  householdId: IdSchema,
  payerId: IdSchema,
  splitMode: SplitModeSchema,
  amountCents: CentsSchema,
  description: Str,
  categoryId: Schema.NullOr(IdSchema),
  categorySlug: Schema.NullOr(Str),
  tags: Schema.Array(TagRefSchema),
  bookedAt: IsoDateSchema,
  dateSource: DateSourceSchema,
  origin: TransactionOriginSchema,
  planPeriod: Schema.NullOr(PeriodSchema),
  createdBy: Schema.NullOr(IdSchema),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
  /** What the NON-paying person bears — derived server-side so the client never re-derives it. */
  otherShareCents: CentsSchema,
  /** The complement, exact. */
  payerShareCents: CentsSchema,
  /** This row's signed contribution to the balance, from `member_slot 1`'s perspective. */
  balanceDeltaCents: CentsSchema,
  /** `splitMode !== "SETTLEMENT"`. */
  isExpense: Bool,
});
export type TransactionResponse = Types.DeepMutable<typeof TransactionResponseSchema.Type>;

export const TransactionListResponseSchema = listResponse(TransactionResponseSchema);
export type TransactionListResponse = Types.DeepMutable<typeof TransactionListResponseSchema.Type>;

export const TransactionSortSchema = Enum(["bookedAt", "-bookedAt", "amount", "-amount"]);

export const TransactionListQuerySchema = Schema.Struct({
  ...FinancePaginationQuerySchema.fields,
  /** ISO date or `'YYYY-MM'` — both are accepted, so this stays a plain string. */
  from: Schema.optional(Str),
  to: Schema.optional(Str),
  /** A projection onto the viewer, resolved server-side against `(payerId, splitMode)`. */
  kind: Schema.optional(TxKindSchema),
  splitMode: Schema.optional(SplitModeSchema),
  payerId: Schema.optional(IdSchema),
  categoryId: Schema.optional(IdSchema),
  /** Comma-separated tag ids — a transaction must carry ALL of them. */
  tagIds: Schema.optional(Str.check(maxLength(400))),
  origin: Schema.optional(TransactionOriginSchema),
  /** Case-insensitive `LIKE` on `description`. No FTS. */
  q: Schema.optional(Str.check(maxLength(100))),
  /** Default true; false hides rows tagged `sammelbuchung`. */
  includeAggregates: BooleanQuerySchema.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  sort: TransactionSortSchema.pipe(Schema.withDecodingDefault(Effect.succeed("-bookedAt" as const))),
});
export type TransactionListQuery = Types.DeepMutable<typeof TransactionListQuerySchema.Type>;

export const TransactionSummaryQuerySchema = Schema.Struct({
  from: Schema.optional(Str),
  to: Schema.optional(Str),
  includeAggregates: BooleanQuerySchema.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
});
export type TransactionSummaryQuery = Types.DeepMutable<typeof TransactionSummaryQuerySchema.Type>;

export const CategorySpendSchema = Schema.Struct({
  categoryId: Schema.NullOr(IdSchema),
  categorySlug: Schema.NullOr(Str),
  totalCents: CentsSchema,
  count: Int.check(nonnegative()),
});

export const MonthSpendSchema = Schema.Struct({
  period: PeriodSchema,
  totalCents: CentsSchema,
  balanceDeltaCents: CentsSchema,
});

export const TransactionSummaryResponseSchema = Schema.Struct({
  from: Str,
  to: Str,
  /** Sum of every `isExpense` row. Settlements are excluded. */
  totalExpenseCents: CentsSchema,
  byCategory: Schema.Array(CategorySpendSchema),
  byMonth: Schema.Array(MonthSpendSchema),
  settlementTotalCents: CentsSchema,
});
export type TransactionSummaryResponse = Types.DeepMutable<typeof TransactionSummaryResponseSchema.Type>;
