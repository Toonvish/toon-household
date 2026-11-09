/** The member's own calendar subscription link (plan m9 P13, ADR 0017); served at /api/households/:householdId/calendar/feed (docs/API.md "Calendar module", "Subscription feed"). */
import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { chain, householdModuleApi, RequireVerifiedEmail } from "../../../http/middleware.ts";

const params = { householdId: Schema.String };

export const CalendarFeedGroup = HttpApiGroup.make("calendar.feed")
  .add(
    /** GET /api/households/:householdId/calendar/feed */
    HttpApiEndpoint.get("get", "/", { params }),
    /** POST /api/households/:householdId/calendar/feed */
    HttpApiEndpoint.post("create", "/", { params }),
    /** PATCH /api/households/:householdId/calendar/feed */
    HttpApiEndpoint.patch("update", "/", { params }),
    /** DELETE /api/households/:householdId/calendar/feed */
    HttpApiEndpoint.delete("remove", "/", { params }),
  )
  .prefix("/feed")
  .pipe(chain(RequireVerifiedEmail));

export const CalendarFeedApi = householdModuleApi("calendar", HttpApi.make("calendar.feed").add(CalendarFeedGroup));
