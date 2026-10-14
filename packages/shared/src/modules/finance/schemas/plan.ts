import { z } from "zod";
import { IdSchema, IsoDateSchema, listResponse } from "../../../core/schemas/common.ts";
import { CentsSchema, PeriodSchema, PositiveCentsSchema } from "./common.ts";
import { TransactionResponseSchema } from "./transactions.ts";

/** `GET …/plan/preview?period=YYYY-MM` (docs/spec.md §3.7). */
export const PlanPreviewQuerySchema = z.object({ period: PeriodSchema });
export type PlanPreviewQuery = z.infer<typeof PlanPreviewQuerySchema>;

export const UpdatePlanRequestSchema = z.object({
  enabled: z.boolean().optional(),
  payerId: IdSchema.optional(),
  startPeriod: PeriodSchema.optional(),
});
export type UpdatePlanRequest = z.infer<typeof UpdatePlanRequestSchema>;

const ItemLabelSchema = z.string().trim().min(1).max(80);

export const FixedCostItemResponseSchema = z.object({
  id: IdSchema,
  label: z.string(),
  amountCents: PositiveCentsSchema,
  activeFrom: PeriodSchema,
  activeTo: PeriodSchema.nullable(),
  position: z.number().int(),
});
export type FixedCostItemResponse = z.infer<typeof FixedCostItemResponseSchema>;

export const IncomeResponseSchema = z.object({
  id: IdSchema,
  personId: IdSchema,
  amountCents: PositiveCentsSchema,
  validFrom: PeriodSchema,
  validTo: PeriodSchema.nullable(),
});
export type IncomeResponse = z.infer<typeof IncomeResponseSchema>;

export const CreateFixedCostItemRequestSchema = z.object({
  label: ItemLabelSchema,
  amountCents: PositiveCentsSchema,
  activeFrom: PeriodSchema,
  activeTo: PeriodSchema.nullish(),
  position: z.number().int().optional(),
});
export type CreateFixedCostItemRequest = z.infer<typeof CreateFixedCostItemRequestSchema>;

export const UpdateFixedCostItemRequestSchema = CreateFixedCostItemRequestSchema.partial();
export type UpdateFixedCostItemRequest = z.infer<typeof UpdateFixedCostItemRequestSchema>;

export const CreateIncomeRequestSchema = z.object({
  personId: IdSchema,
  amountCents: PositiveCentsSchema,
  validFrom: PeriodSchema,
  validTo: PeriodSchema.nullish(),
});
export type CreateIncomeRequest = z.infer<typeof CreateIncomeRequestSchema>;

export const UpdateIncomeRequestSchema = CreateIncomeRequestSchema.partial();
export type UpdateIncomeRequest = z.infer<typeof UpdateIncomeRequestSchema>;

export const PlanShareResponseSchema = z.object({
  personId: IdSchema,
  incomeCents: CentsSchema,
  shareCents: CentsSchema,
});

export const PlanComputationResponseSchema = z.object({
  period: PeriodSchema,
  costTotalCents: CentsSchema,
  incomeTotalCents: CentsSchema,
  /** = costTotalCents — the quote stays a fraction, never a float, on the wire. */
  quoteNumerator: z.number().int(),
  /** = incomeTotalCents */
  quoteDenominator: z.number().int(),
  shares: z.array(PlanShareResponseSchema),
  payerId: IdSchema,
  /** The non-paying person's share. */
  bookableCents: CentsSchema,
  booked: z.boolean(),
});
export type PlanComputationResponse = z.infer<typeof PlanComputationResponseSchema>;

export const AccrualRunResponseSchema = z.object({
  id: IdSchema,
  trigger: z.enum(["boot", "interval", "manual", "import"]),
  fromPeriod: PeriodSchema.nullable(),
  toPeriod: PeriodSchema.nullable(),
  periodsBooked: z.number().int().nonnegative(),
  periodsSkipped: z.number().int().nonnegative(),
  bookedCents: CentsSchema,
  /** English ops text, or null on success — never rendered through the i18n catalog. */
  error: z.string().nullable(),
  startedAt: IsoDateSchema,
  finishedAt: IsoDateSchema,
});
export type AccrualRunResponse = z.infer<typeof AccrualRunResponseSchema>;

export const AccrualRunListResponseSchema = listResponse(AccrualRunResponseSchema);
export type AccrualRunListResponse = z.infer<typeof AccrualRunListResponseSchema>;

export const PlanResponseSchema = z.object({
  plan: z.object({
    enabled: z.boolean(),
    payerId: IdSchema,
    startPeriod: PeriodSchema,
    lastBookedPeriod: PeriodSchema.nullable(),
  }),
  items: z.array(FixedCostItemResponseSchema),
  incomes: z.array(IncomeResponseSchema),
  /** `null` when the plan is `plan_incomplete` for the current period. */
  current: PlanComputationResponseSchema.nullable(),
  lastRun: AccrualRunResponseSchema.nullable(),
  /** What a run would book right now. */
  pendingPeriods: z.array(PeriodSchema),
});
export type PlanResponse = z.infer<typeof PlanResponseSchema>;

export const RunPlanRequestSchema = z.object({ through: PeriodSchema.optional() });
export type RunPlanRequest = z.infer<typeof RunPlanRequestSchema>;

export const RunPlanResponseSchema = z.object({
  bookedPeriods: z.array(PeriodSchema),
  skippedPeriods: z.array(PeriodSchema),
  bookedCents: CentsSchema,
  run: AccrualRunResponseSchema,
});
export type RunPlanResponse = z.infer<typeof RunPlanResponseSchema>;

export const RecalculatePlanRequestSchema = z.object({ dryRun: z.boolean() });
export type RecalculatePlanRequest = z.infer<typeof RecalculatePlanRequestSchema>;

export const RecalculationLineSchema = z.object({
  period: PeriodSchema,
  bookedCents: CentsSchema,
  recomputedCents: CentsSchema,
  deltaCents: CentsSchema,
});

export const RecalculatePlanResponseSchema = z.object({
  items: z.array(RecalculationLineSchema),
  totalDeltaCents: CentsSchema,
  applied: z.boolean(),
  /** Empty when `dryRun` was true. */
  adjustments: z.array(TransactionResponseSchema),
});
export type RecalculatePlanResponse = z.infer<typeof RecalculatePlanResponseSchema>;
