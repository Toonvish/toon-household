/**
 * Resources (cars) — wire contract (design §1.2, plan m8 P13). A car is archived, never deleted while a booking
 * references it.
 */
import { Schema, type Types } from "effect";
import { IdSchema, IsoDateSchema } from "../../../core/schemas/common.ts";
import { Bool, Enum, Lit, Str, keyed, maxLength, minLength, trim } from "../../../core/schemas/checks.ts";
import { hasNoControlChars } from "../../../core/schemas/user.ts";
import { CALENDAR_LIMITS } from "../limits.ts";

const ResourceNameSchema = Str.pipe(trim).check(
  minLength(1),
  maxLength(CALENDAR_LIMITS.resourceNameMax),
  // A name is shown in one line: no control characters or line breaks (the core's display-name rule).
  keyed(hasNoControlChars, "server.validation.noControlChars"),
);

export const CalendarResourceSchema = Schema.Struct({
  id: IdSchema,
  kind: Lit("car"),
  name: Str,
  archived: Bool,
  archivedAt: Schema.NullOr(IsoDateSchema),
  createdAt: IsoDateSchema,
});
export type CalendarResource = Types.DeepMutable<typeof CalendarResourceSchema.Type>;

/** GET `/resources?includeArchived=true`: archived cars are left out unless asked for. */
export const CalendarResourceListQuerySchema = Schema.Struct({
  includeArchived: Schema.optional(Enum(["true", "false"])),
});
export type CalendarResourceListQuery = Types.DeepMutable<typeof CalendarResourceListQuerySchema.Type>;

export const CalendarResourceListResponseSchema = Schema.Struct({ items: Schema.Array(CalendarResourceSchema) });
export type CalendarResourceListResponse = Types.DeepMutable<typeof CalendarResourceListResponseSchema.Type>;

export const CreateCalendarResourceRequestSchema = Schema.Struct({ name: ResourceNameSchema });
export type CreateCalendarResourceRequest = Types.DeepMutable<typeof CreateCalendarResourceRequestSchema.Type>;

/** PATCH: rename, archive (`true`) or restore (`false`). */
export const UpdateCalendarResourceRequestSchema = Schema.Struct({
  name: Schema.optional(ResourceNameSchema),
  archived: Schema.optional(Bool),
});
export type UpdateCalendarResourceRequest = Types.DeepMutable<typeof UpdateCalendarResourceRequestSchema.Type>;
