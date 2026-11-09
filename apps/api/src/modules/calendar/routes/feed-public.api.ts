/** The calendar subscription feed itself (plan m9 P2-P6, ADR 0017): a PUBLIC route, no session, the token in the URL is the credential; served at /api/calendar/feed/:file (docs/API.md "Calendar module", "Subscription feed"). */
import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { publicModuleApi } from "../../../http/middleware.ts";

export const CalendarFeedPublicGroup = HttpApiGroup.make("calendar.feedPublic").add(
  /** GET /api/calendar/feed/:file (`:file` = `<token>.ics`; HEAD through the router's fallback) */
  HttpApiEndpoint.get("feed", "/feed/:file", { params: { file: Schema.String } }),
);

export const CalendarFeedPublicApi = publicModuleApi(
  "calendar",
  HttpApi.make("calendar.feedPublic").add(CalendarFeedPublicGroup),
);
