/** Calendar resources (the household's cars; plan m8 section 5.2, P13); served at /api/households/:householdId/calendar/resources (docs/API.md "Calendar module"). */
import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { chain, householdModuleApi, RequireVerifiedEmail } from "../../../http/middleware.ts";

const params = { householdId: Schema.String };
const byId = { householdId: Schema.String, resourceId: Schema.String };

export const CalendarResourcesGroup = HttpApiGroup.make("calendar.resources")
  .add(
    /** GET /api/households/:householdId/calendar/resources */
    HttpApiEndpoint.get("list", "/", { params }),
    /** POST /api/households/:householdId/calendar/resources */
    HttpApiEndpoint.post("create", "/", { params }),
    /** PATCH /api/households/:householdId/calendar/resources/:resourceId */
    HttpApiEndpoint.patch("update", "/:resourceId", { params: byId }),
    /** DELETE /api/households/:householdId/calendar/resources/:resourceId */
    HttpApiEndpoint.delete("remove", "/:resourceId", { params: byId }),
  )
  .prefix("/resources")
  .pipe(chain(RequireVerifiedEmail));

export const CalendarResourcesApi = householdModuleApi(
  "calendar",
  HttpApi.make("calendar.resources").add(CalendarResourcesGroup),
);
