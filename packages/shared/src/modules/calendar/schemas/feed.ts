/**
 * The calendar subscription feed — wire contract of the management routes (plan m9 P2, P13; ADR 0017). A member
 * subscribes their phone calendar to `GET /api/calendar/feed/<token>.ics` (no session: the token is the credential);
 * these schemas cover the four household-scoped routes `…/calendar/feed` that create, read, change and end the
 * member's OWN link. The token appears ONLY in `CalendarFeedCreatedResponse.url`, the answer of the POST that
 * creates (or replaces) the link; `GET` and `PATCH` never carry it.
 */
import { Schema, type Types } from "effect";
import { IsoDateSchema } from "../../../core/schemas/common.ts";
import { Enum, Str } from "../../../core/schemas/checks.ts";

/** `all`: every entry of the household. `mine`: the entries for everybody plus the ones naming the member (P9). */
export const CalendarFeedScopeSchema = Enum(["all", "mine"]);
export type CalendarFeedScope = Types.DeepMutable<typeof CalendarFeedScopeSchema.Type>;

/** The member's link as `GET` and `PATCH` show it: never the token or the URL. */
export const CalendarFeedSchema = Schema.Struct({
  scope: CalendarFeedScopeSchema,
  createdAt: IsoDateSchema,
  /** The last fetch by a subscribed calendar, at most hourly precision (P7); `null` until the first fetch. */
  lastUsedAt: Schema.NullOr(IsoDateSchema),
});
export type CalendarFeed = Types.DeepMutable<typeof CalendarFeedSchema.Type>;

/** `GET …/calendar/feed` (`feed: null` without a link) and `PATCH …/calendar/feed` (the changed link). */
export const CalendarFeedResponseSchema = Schema.Struct({ feed: Schema.NullOr(CalendarFeedSchema) });
export type CalendarFeedResponse = Types.DeepMutable<typeof CalendarFeedResponseSchema.Type>;

/** `POST …/calendar/feed`: create the link, or replace the existing one (the old token stops working at once). */
export const CreateCalendarFeedRequestSchema = Schema.Struct({ scope: CalendarFeedScopeSchema });
export type CreateCalendarFeedRequest = Types.DeepMutable<typeof CreateCalendarFeedRequestSchema.Type>;

/** `PATCH …/calendar/feed`: change the scope; the token stays. */
export const UpdateCalendarFeedRequestSchema = Schema.Struct({ scope: CalendarFeedScopeSchema });
export type UpdateCalendarFeedRequest = Types.DeepMutable<typeof UpdateCalendarFeedRequestSchema.Type>;

/**
 * `201` of `POST …/calendar/feed`: `url` is `<first WEB_ORIGIN>/api/calendar/feed/<token>.ics` (the claim links' origin
 * rule), the only place the token ever appears; `lastUsedAt` is always `null` here (a new token has never been fetched).
 */
export const CalendarFeedCreatedResponseSchema = Schema.Struct({
  url: Str,
  scope: CalendarFeedScopeSchema,
  createdAt: IsoDateSchema,
  lastUsedAt: Schema.NullOr(IsoDateSchema),
});
export type CalendarFeedCreatedResponse = Types.DeepMutable<typeof CalendarFeedCreatedResponseSchema.Type>;
