/**
 * Served at /api/households/:householdId/calendar/feed (see ./feed.index.ts; plan m9 P13, ADR 0017): the caller's OWN
 * subscription link in the household, by the membership's `householdId` and `userId` (D8). Reads pass, writes need a
 * confirmed account (`RequireVerifiedEmail` on the group). The token appears only in the `201` of `POST`.
 */
import {
  type CalendarFeedResponse,
  CreateCalendarFeedRequestSchema,
  UpdateCalendarFeedRequestSchema,
} from "@toon/shared";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { CurrentMembership } from "../../../http/context.ts";
import { UNINTERRUPTIBLE } from "../../../http/middleware.ts";
import { jsonBody } from "../../../http/request.ts";
import { created, json, noContent } from "../../../http/response.ts";
import { CalendarFeedTokens } from "../services/feed/tokens.service.ts";
import { CalendarFeedApi } from "./feed.api.ts";

export const calendarFeedGroupHandlers = HttpApiBuilder.group(CalendarFeedApi, "calendar.feed", (handlers) =>
  handlers
    /** GET / — `{ feed: null | { scope, createdAt, lastUsedAt } }`, never the token. */
    .handle(
      "get",
      Effect.fn("calendar.feed.get")(function* () {
        const tokens = yield* CalendarFeedTokens;
        const membership = yield* CurrentMembership;
        const payload: CalendarFeedResponse = { feed: yield* tokens.get(membership.householdId, membership.userId) };
        return json(payload);
      }),
      UNINTERRUPTIBLE,
    )
    /** POST / — `{ scope }`: creates the link or REPLACES it (the old token dies at once); 201 with the url. */
    .handle(
      "create",
      Effect.fn("calendar.feed.create")(function* () {
        const body = yield* jsonBody(CreateCalendarFeedRequestSchema);
        const tokens = yield* CalendarFeedTokens;
        const membership = yield* CurrentMembership;
        return created(yield* tokens.create(membership.householdId, membership.userId, body.scope));
      }),
      UNINTERRUPTIBLE,
    )
    /** PATCH / — `{ scope }`: the token stays; `404 not_found` without a link. */
    .handle(
      "update",
      Effect.fn("calendar.feed.update")(function* () {
        const body = yield* jsonBody(UpdateCalendarFeedRequestSchema);
        const tokens = yield* CalendarFeedTokens;
        const membership = yield* CurrentMembership;
        const payload: CalendarFeedResponse = {
          feed: yield* tokens.updateScope(membership.householdId, membership.userId, body.scope),
        };
        return json(payload);
      }),
      UNINTERRUPTIBLE,
    )
    /** DELETE / — 204, also without a link. */
    .handle(
      "remove",
      Effect.fn("calendar.feed.remove")(function* () {
        const tokens = yield* CalendarFeedTokens;
        const membership = yield* CurrentMembership;
        yield* tokens.remove(membership.householdId, membership.userId);
        return noContent();
      }),
      UNINTERRUPTIBLE,
    ),
);
