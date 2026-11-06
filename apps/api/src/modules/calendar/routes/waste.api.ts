/** The calendar's waste schedule; served at /api/households/:householdId/calendar/waste (docs/API.md "Calendar module", "Waste"). */
import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { chain, householdModuleApi, RequireVerifiedEmail } from "../../../http/middleware.ts";

const params = { householdId: Schema.String };

export const CalendarWasteGroup = HttpApiGroup.make("calendar.waste")
  .add(
    /** GET /api/households/:householdId/calendar/waste?from= — settings, imports, the next pickup per type. */
    HttpApiEndpoint.get("overview", "/", { params }),
    /** PUT /api/households/:householdId/calendar/waste/settings — provider, tour, assignee rule (re-assigns from `today`). */
    HttpApiEndpoint.put("putSettings", "/settings", { params }),
    /** POST /api/households/:householdId/calendar/waste/preview — JSON `{ url, tour }` or multipart `file` + `tour`; writes nothing. */
    HttpApiEndpoint.post("preview", "/preview", { params }),
    /** POST /api/households/:householdId/calendar/waste/import — as preview; replaces the import of that year. */
    HttpApiEndpoint.post("import", "/import", { params }),
    /** DELETE /api/households/:householdId/calendar/waste/imports/:importId — the import and its entries. */
    HttpApiEndpoint.delete("removeImport", "/imports/:importId", {
      params: { householdId: Schema.String, importId: Schema.String },
    }),
  )
  .prefix("/waste")
  .pipe(chain(RequireVerifiedEmail));

export const CalendarWasteApi = householdModuleApi("calendar", HttpApi.make("calendar.waste").add(CalendarWasteGroup));
