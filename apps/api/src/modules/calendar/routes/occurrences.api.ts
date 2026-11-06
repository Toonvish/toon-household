/** Calendar occurrences (the expanded calendar and the done/skipped marks; plan m8 section 5.2); served at /api/households/:householdId/calendar/occurrences and …/entries/:entryId/occurrences/:date (docs/API.md "Calendar module"). */
import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { chain, householdModuleApi, RequireVerifiedEmail } from "../../../http/middleware.ts";

export const CalendarOccurrencesGroup = HttpApiGroup.make("calendar.occurrences")
  .add(
    /** GET /api/households/:householdId/calendar/occurrences */
    HttpApiEndpoint.get("list", "/occurrences", { params: { householdId: Schema.String } }),
    /** PUT /api/households/:householdId/calendar/entries/:entryId/occurrences/:date */
    HttpApiEndpoint.put("setStatus", "/entries/:entryId/occurrences/:date", {
      params: { householdId: Schema.String, entryId: Schema.String, date: Schema.String },
    }),
  )
  .pipe(chain(RequireVerifiedEmail));

export const CalendarOccurrencesApi = householdModuleApi(
  "calendar",
  HttpApi.make("calendar.occurrences").add(CalendarOccurrencesGroup),
);
