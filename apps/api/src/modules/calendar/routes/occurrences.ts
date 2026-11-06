/**
 * Served at /api/households/:householdId/calendar/occurrences and …/entries/:entryId/occurrences/:date (see
 * ./core.index.ts; plan m8 section 5.2, P4, P9a, P10, P12). The household comes from `:householdId` only (D8).
 */
import { CalendarOccurrenceQuerySchema, SetCalendarOccurrenceStatusRequestSchema } from "@toon/shared";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { CurrentMembership } from "../../../http/context.ts";
import { UNINTERRUPTIBLE } from "../../../http/middleware.ts";
import { jsonBody, queryParams } from "../../../http/request.ts";
import { json } from "../../../http/response.ts";
import { CalendarOccurrences } from "../services/entries/occurrences.service.ts";
import { CalendarOccurrencesApi } from "./occurrences.api.ts";

export const calendarOccurrencesHandlers = HttpApiBuilder.group(CalendarOccurrencesApi, "calendar.occurrences", (handlers) =>
  handlers
    /** GET /occurrences?from=&to=[&memberId=][&kind=] — `{ items, members }` (P9a). */
    .handle(
      "list",
      Effect.fn("calendar.occurrences.list")(function* () {
        const query = yield* queryParams(CalendarOccurrenceQuerySchema);
        const occurrences = yield* CalendarOccurrences;
        const membership = yield* CurrentMembership;
        return json(yield* occurrences.list(membership.householdId, query));
      }),
      UNINTERRUPTIBLE,
    )
    /** PUT /entries/:entryId/occurrences/:date — `{ status: "done" | "skipped" | null }` (P12). */
    .handle(
      "setStatus",
      Effect.fn("calendar.occurrences.setStatus")(function* ({ params }) {
        const body = yield* jsonBody(SetCalendarOccurrenceStatusRequestSchema);
        const occurrences = yield* CalendarOccurrences;
        const membership = yield* CurrentMembership;
        return json(
          yield* occurrences.setStatus(membership.householdId, params.entryId, params.date, body.status, membership.userId),
        );
      }),
      UNINTERRUPTIBLE,
    ),
);
