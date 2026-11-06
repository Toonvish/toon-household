/**
 * The waste schedule — wire contract (design §5, plan m8 P15-P17, P20). The overview's `from` and the settings'
 * `today` are the CLIENT's today: the server never decides it (design §1.2).
 */
import { Schema, type Types } from "effect";
import { IdSchema, IsoDateSchema } from "../../../core/schemas/common.ts";
import {
  CoercedInt,
  Enum,
  Int,
  Str,
  Url,
  keyedIssue,
  max,
  maxItems,
  maxLength,
  min,
  nonnegative,
} from "../../../core/schemas/checks.ts";
import { CALENDAR_LIMITS } from "../limits.ts";
import {
  CalendarAssigneeModeSchema,
  CalendarDateSchema,
  CalendarWasteCategorySchema,
  CalendarWasteDetailSchema,
  CalendarWasteProviderSchema,
} from "./common.ts";

/** A tour ("Bezirk") of the flyer: 1-9. */
const TourSchema = Int.check(min(1), max(9));

export const CalendarWasteSettingsSchema = Schema.Struct({
  provider: CalendarWasteProviderSchema,
  tour: TourSchema,
  /** The last URL an import fetched; null after an upload-only setup. */
  sourceUrl: Schema.NullOr(Str),
  assigneeMode: CalendarAssigneeModeSchema,
  /** In rotation order (P15: the pickup days of an import go round this list). */
  assigneeIds: Schema.Array(IdSchema),
  updatedAt: IsoDateSchema,
});
export type CalendarWasteSettings = Types.DeepMutable<typeof CalendarWasteSettingsSchema.Type>;

type AssigneeRule = { readonly assigneeMode: "none" | "fixed" | "rotate"; readonly assigneeIds: ReadonlyArray<string> };

/** PUT `/waste/settings` (P15): re-assigns every waste entry dated on or after `today`. */
export const PutCalendarWasteSettingsRequestSchema = Schema.Struct({
  provider: CalendarWasteProviderSchema,
  tour: TourSchema,
  assigneeMode: CalendarAssigneeModeSchema,
  assigneeIds: Schema.Array(IdSchema).check(maxItems(CALENDAR_LIMITS.rotationMax)),
  today: CalendarDateSchema,
}).check(
  Schema.makeFilter((body: AssigneeRule) => {
    const issues: Array<Schema.FilterIssue> = [];
    const ids = body.assigneeIds;
    if (new Set(ids).size !== ids.length) issues.push(keyedIssue("server.calendar.duplicateIds", ["assigneeIds"]));
    if (body.assigneeMode === "none" && ids.length > 0) issues.push(keyedIssue("server.calendar.assigneesForNone", ["assigneeIds"]));
    if (body.assigneeMode === "fixed" && ids.length !== 1) issues.push(keyedIssue("server.calendar.fixedNeedsOne", ["assigneeIds"]));
    if (body.assigneeMode === "rotate" && ids.length < 2) issues.push(keyedIssue("server.calendar.rotateNeedsTwo", ["assigneeIds"]));
    return issues.length === 0 ? undefined : issues;
  }, { expected: "a consistent assignee rule" }),
);
export type PutCalendarWasteSettingsRequest = Types.DeepMutable<typeof PutCalendarWasteSettingsRequestSchema.Type>;

export const CalendarWasteImportSchema = Schema.Struct({
  id: IdSchema,
  provider: CalendarWasteProviderSchema,
  year: Int,
  tour: TourSchema,
  source: Enum(["url", "upload"]),
  /** The URL, or the uploaded file's name. */
  sourceName: Str,
  entryCount: Int.check(nonnegative()),
  importedAt: IsoDateSchema,
  importedBy: Schema.NullOr(IdSchema),
});
export type CalendarWasteImport = Types.DeepMutable<typeof CalendarWasteImportSchema.Type>;

/** One pickup: a waste type on a date; `detail` `bio_cleaning` is a Biotonne pickup with cleaning. */
export const CalendarWastePickupSchema = Schema.Struct({
  category: CalendarWasteCategorySchema,
  date: CalendarDateSchema,
  detail: Schema.NullOr(CalendarWasteDetailSchema),
});
export type CalendarWastePickup = Types.DeepMutable<typeof CalendarWastePickupSchema.Type>;

/** GET `/waste?from=` (P16): `from` is the client's today. */
export const CalendarWasteOverviewQuerySchema = Schema.Struct({ from: CalendarDateSchema });
export type CalendarWasteOverviewQuery = Types.DeepMutable<typeof CalendarWasteOverviewQuerySchema.Type>;

/** P16: the settings (null before the first setup), the imports newest year first, the next pickup per type. */
export const CalendarWasteOverviewResponseSchema = Schema.Struct({
  settings: Schema.NullOr(CalendarWasteSettingsSchema),
  imports: Schema.Array(CalendarWasteImportSchema),
  next: Schema.Array(CalendarWastePickupSchema),
});
export type CalendarWasteOverviewResponse = Types.DeepMutable<typeof CalendarWasteOverviewResponseSchema.Type>;

/** POST `/waste/preview` and `/waste/import` as JSON: fetch the flyer from `url` (P17; provider default `hattingen`). */
export const CalendarWasteSourceRequestSchema = Schema.Struct({
  provider: Schema.optional(CalendarWasteProviderSchema),
  tour: TourSchema,
  url: Url.check(maxLength(2000)),
});
export type CalendarWasteSourceRequest = Types.DeepMutable<typeof CalendarWasteSourceRequestSchema.Type>;

/** The same two routes as `multipart/form-data`: the `file` part plus `tour` as a numeric string. */
export const CalendarWasteUploadFieldsSchema = Schema.Struct({
  tour: CoercedInt.check(min(1), max(9)),
});
export type CalendarWasteUploadFields = Types.DeepMutable<typeof CalendarWasteUploadFieldsSchema.Type>;

const CountSchema = Int.check(nonnegative());

/** What an import would write (nothing is written by a preview). */
export const CalendarWastePreviewSchema = Schema.Struct({
  provider: CalendarWasteProviderSchema,
  year: Int,
  tour: TourSchema,
  /** Pickups per waste type for the tour. */
  counts: Schema.Struct({
    waste_rest: CountSchema,
    waste_yellow: CountSchema,
    waste_bio: CountSchema,
    waste_paper: CountSchema,
    waste_tree: CountSchema,
  }),
  dates: Schema.Array(CalendarWastePickupSchema),
  /** Non-fatal findings of the parser (`date` null when a warning names no day). */
  warnings: Schema.Array(Schema.Struct({ code: Str, date: Schema.NullOr(CalendarDateSchema) })),
});
export type CalendarWastePreview = Types.DeepMutable<typeof CalendarWastePreviewSchema.Type>;

/** 201 of POST `/waste/import`. */
export const CalendarWasteImportResponseSchema = Schema.Struct({
  import: CalendarWasteImportSchema,
  entryCount: CountSchema,
});
export type CalendarWasteImportResponse = Types.DeepMutable<typeof CalendarWasteImportResponseSchema.Type>;
