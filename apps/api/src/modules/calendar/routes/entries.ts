/**
 * Served at /api/households/:householdId/calendar/entries (see ./core.index.ts; plan m8 section 5.2, P6-P9b, P11).
 * The household comes from `:householdId` only (`CurrentMembership`, D8); any member may write.
 */
import {
  type CalendarEntryListResponse,
  CalendarEntryListQuerySchema,
  CreateCalendarEntryRequestSchema,
  UpdateCalendarEntryRequestSchema,
} from "@toon/shared";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { CurrentMembership } from "../../../http/context.ts";
import { UNINTERRUPTIBLE } from "../../../http/middleware.ts";
import { jsonBody, queryParams } from "../../../http/request.ts";
import { created, json, noContent } from "../../../http/response.ts";
import { CalendarEntries } from "../services/entries/entries.service.ts";
import { CalendarEntriesApi } from "./entries.api.ts";

export const calendarEntriesHandlers = HttpApiBuilder.group(CalendarEntriesApi, "calendar.entries", (handlers) =>
  handlers
    /** GET / — the household's non-waste series (P9b), `?kind=&recurring=`. */
    .handle(
      "list",
      Effect.fn("calendar.entries.list")(function* () {
        const query = yield* queryParams(CalendarEntryListQuerySchema);
        const entries = yield* CalendarEntries;
        const membership = yield* CurrentMembership;
        const payload: CalendarEntryListResponse = { items: yield* entries.list(membership.householdId, query) };
        return json(payload);
      }),
      UNINTERRUPTIBLE,
    )
    /** GET /:entryId — one series with its members. */
    .handle(
      "get",
      Effect.fn("calendar.entries.get")(function* ({ params }) {
        const entries = yield* CalendarEntries;
        const membership = yield* CurrentMembership;
        return json(yield* entries.get(membership.householdId, params.entryId));
      }),
      UNINTERRUPTIBLE,
    )
    /** POST / — 201 with the series; `409 calendar_car_conflict` unless `allowConflict`. */
    .handle(
      "create",
      Effect.fn("calendar.entries.create")(function* () {
        const body = yield* jsonBody(CreateCalendarEntryRequestSchema);
        const entries = yield* CalendarEntries;
        const membership = yield* CurrentMembership;
        const entry = yield* entries.create(membership.householdId, membership.userId, body);
        return created(entry, `/api/households/${membership.householdId}/calendar/entries/${entry.id}`);
      }),
      UNINTERRUPTIBLE,
    )
    /** PATCH /:entryId — merge-then-validate (P7); a waste entry takes notes and assignees only (P8). */
    .handle(
      "update",
      Effect.fn("calendar.entries.update")(function* ({ params }) {
        const body = yield* jsonBody(UpdateCalendarEntryRequestSchema);
        const entries = yield* CalendarEntries;
        const membership = yield* CurrentMembership;
        return json(yield* entries.update(membership.householdId, params.entryId, body));
      }),
      UNINTERRUPTIBLE,
    )
    /** DELETE /:entryId — the series with its states; `409 calendar_entry_imported` for a waste entry. */
    .handle(
      "remove",
      Effect.fn("calendar.entries.remove")(function* ({ params }) {
        const entries = yield* CalendarEntries;
        const membership = yield* CurrentMembership;
        yield* entries.remove(membership.householdId, params.entryId);
        return noContent();
      }),
      UNINTERRUPTIBLE,
    ),
);
