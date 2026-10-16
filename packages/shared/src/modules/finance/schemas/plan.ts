import { Schema, type Types } from "effect";
import { IdSchema, IsoDateSchema, listResponse } from "../../../core/schemas/common.ts";
import { Bool, Enum, Int, Str, maxLength, minLength, nonnegative, partial, trim } from "../../../core/schemas/checks.ts";
import { CentsSchema, PeriodSchema, PositiveCentsSchema } from "./common.ts";
import { TransactionResponseSchema } from "./transactions.ts";

/** `GET …/plan/preview?period=YYYY-MM` (docs/spec.md §3.7). */
export const PlanPreviewQuerySchema = Schema.Struct({ period: PeriodSchema });
export type PlanPreviewQuery = Types.DeepMutable<typeof PlanPreviewQuerySchema.Type>;

export const UpdatePlanRequestSchema = Schema.Struct({
  enabled: Schema.optional(Bool),
  payerId: Schema.optional(IdSchema),
  startPeriod: Schema.optional(PeriodSchema),
});
export type UpdatePlanRequest = Types.DeepMutable<typeof UpdatePlanRequestSchema.Type>;

const ItemLabelSchema = Str.pipe(trim).check(minLength(1), maxLength(80));

export const FixedCostItemResponseSchema = Schema.Struct({
  id: IdSchema,
  label: Str,
  amountCents: PositiveCentsSchema,
  activeFrom: PeriodSchema,
  activeTo: Schema.NullOr(PeriodSchema),
  position: Int,
});
export type FixedCostItemResponse = Types.DeepMutable<typeof FixedCostItemResponseSchema.Type>;

export const IncomeResponseSchema = Schema.Struct({
  id: IdSchema,
  personId: IdSchema,
  amountCents: PositiveCentsSchema,
  validFrom: PeriodSchema,
  validTo: Schema.NullOr(PeriodSchema),
});
export type IncomeResponse = Types.DeepMutable<typeof IncomeResponseSchema.Type>;

export const CreateFixedCostItemRequestSchema = Schema.Struct({
  label: ItemLabelSchema,
  amountCents: PositiveCentsSchema,
  activeFrom: PeriodSchema,
  activeTo: Schema.optional(Schema.NullOr(PeriodSchema)),
  position: Schema.optional(Int),
});
export type CreateFixedCostItemRequest = Types.DeepMutable<typeof CreateFixedCostItemRequestSchema.Type>;

export const UpdateFixedCostItemRequestSchema = partial(CreateFixedCostItemRequestSchema);
export type UpdateFixedCostItemRequest = Types.DeepMutable<typeof UpdateFixedCostItemRequestSchema.Type>;

export const CreateIncomeRequestSchema = Schema.Struct({
  personId: IdSchema,
  amountCents: PositiveCentsSchema,
  validFrom: PeriodSchema,
  validTo: Schema.optional(Schema.NullOr(PeriodSchema)),
});
export type CreateIncomeRequest = Types.DeepMutable<typeof CreateIncomeRequestSchema.Type>;

export const UpdateIncomeRequestSchema = partial(CreateIncomeRequestSchema);
export type UpdateIncomeRequest = Types.DeepMutable<typeof UpdateIncomeRequestSchema.Type>;

export const PlanShareResponseSchema = Schema.Struct({
  personId: IdSchema,
  incomeCents: CentsSchema,
  shareCents: CentsSchema,
});

export const PlanComputationResponseSchema = Schema.Struct({
  period: PeriodSchema,
  costTotalCents: CentsSchema,
  incomeTotalCents: CentsSchema,
  /** = costTotalCents — the quote stays a fraction, never a float, on the wire. */
  quoteNumerator: Int,
  /** = incomeTotalCents */
  quoteDenominator: Int,
  shares: Schema.Array(PlanShareResponseSchema),
  payerId: IdSchema,
  /** The non-paying person's share. */
  bookableCents: CentsSchema,
  booked: Bool,
});
export type PlanComputationResponse = Types.DeepMutable<typeof PlanComputationResponseSchema.Type>;

export const AccrualRunResponseSchema = Schema.Struct({
  id: IdSchema,
  trigger: Enum(["boot", "interval", "manual", "import"]),
  fromPeriod: Schema.NullOr(PeriodSchema),
  toPeriod: Schema.NullOr(PeriodSchema),
  periodsBooked: Int.check(nonnegative()),
  periodsSkipped: Int.check(nonnegative()),
  bookedCents: CentsSchema,
  /** English ops text, or null on success — never rendered through the i18n catalog. */
  error: Schema.NullOr(Str),
  startedAt: IsoDateSchema,
  finishedAt: IsoDateSchema,
});
export type AccrualRunResponse = Types.DeepMutable<typeof AccrualRunResponseSchema.Type>;

export const AccrualRunListResponseSchema = listResponse(AccrualRunResponseSchema);
export type AccrualRunListResponse = Types.DeepMutable<typeof AccrualRunListResponseSchema.Type>;

export const PlanResponseSchema = Schema.Struct({
  plan: Schema.Struct({
    enabled: Bool,
    payerId: IdSchema,
    startPeriod: PeriodSchema,
    lastBookedPeriod: Schema.NullOr(PeriodSchema),
  }),
  items: Schema.Array(FixedCostItemResponseSchema),
  incomes: Schema.Array(IncomeResponseSchema),
  /** `null` when the plan is `plan_incomplete` for the current period. */
  current: Schema.NullOr(PlanComputationResponseSchema),
  lastRun: Schema.NullOr(AccrualRunResponseSchema),
  /** What a run would book right now. */
  pendingPeriods: Schema.Array(PeriodSchema),
});
export type PlanResponse = Types.DeepMutable<typeof PlanResponseSchema.Type>;

export const RunPlanRequestSchema = Schema.Struct({ through: Schema.optional(PeriodSchema) });
export type RunPlanRequest = Types.DeepMutable<typeof RunPlanRequestSchema.Type>;

export const RunPlanResponseSchema = Schema.Struct({
  bookedPeriods: Schema.Array(PeriodSchema),
  skippedPeriods: Schema.Array(PeriodSchema),
  bookedCents: CentsSchema,
  run: AccrualRunResponseSchema,
});
export type RunPlanResponse = Types.DeepMutable<typeof RunPlanResponseSchema.Type>;

export const RecalculatePlanRequestSchema = Schema.Struct({ dryRun: Bool });
export type RecalculatePlanRequest = Types.DeepMutable<typeof RecalculatePlanRequestSchema.Type>;

export const RecalculationLineSchema = Schema.Struct({
  period: PeriodSchema,
  bookedCents: CentsSchema,
  recomputedCents: CentsSchema,
  deltaCents: CentsSchema,
});

export const RecalculatePlanResponseSchema = Schema.Struct({
  items: Schema.Array(RecalculationLineSchema),
  totalDeltaCents: CentsSchema,
  applied: Bool,
  /** Empty when `dryRun` was true. */
  adjustments: Schema.Array(TransactionResponseSchema),
});
export type RecalculatePlanResponse = Types.DeepMutable<typeof RecalculatePlanResponseSchema.Type>;
