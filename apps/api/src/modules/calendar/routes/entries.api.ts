/** Calendar entries (the series; plan m8 section 5.2); served at /api/households/:householdId/calendar/entries (docs/API.md "Calendar module"). */
import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { chain, householdModuleApi, RequireVerifiedEmail } from "../../../http/middleware.ts";

const params = { householdId: Schema.String };
const byId = { householdId: Schema.String, entryId: Schema.String };

export const CalendarEntriesGroup = HttpApiGroup.make("calendar.entries")
  .add(
    /** GET /api/households/:householdId/calendar/entries */
    HttpApiEndpoint.get("list", "/", { params }),
    /** GET /api/households/:householdId/calendar/entries/:entryId */
    HttpApiEndpoint.get("get", "/:entryId", { params: byId }),
    /** POST /api/households/:householdId/calendar/entries */
    HttpApiEndpoint.post("create", "/", { params }),
    /** PATCH /api/households/:householdId/calendar/entries/:entryId */
    HttpApiEndpoint.patch("update", "/:entryId", { params: byId }),
    /** DELETE /api/households/:householdId/calendar/entries/:entryId */
    HttpApiEndpoint.delete("remove", "/:entryId", { params: byId }),
  )
  .prefix("/entries")
  .pipe(chain(RequireVerifiedEmail));

export const CalendarEntriesApi = householdModuleApi("calendar", HttpApi.make("calendar.entries").add(CalendarEntriesGroup));
