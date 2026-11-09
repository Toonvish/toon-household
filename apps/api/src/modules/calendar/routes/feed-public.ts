/**
 * Served at /api/calendar/feed/:file (see ./feed.index.ts; plan m9 P2-P7, ADR 0017): the subscription feed. NO session
 * and no cookie: the token in `:file` (`<token>.ics`) is the credential, checked by `CalendarFeedTokens.resolve`
 * (pattern -> hash -> rate limit -> row -> membership -> module enabled; every refusal the same `404 not_found`, the rate
 * limit `429 rate_limited` with `Retry-After`).
 *
 * The answer (P6): `200` `text/calendar; charset=utf-8`, `Content-Disposition: inline; filename="haushalt.ics"`,
 * `Cache-Control: private, max-age=300` and the strong `ETag` of the body; an `If-None-Match` that names it (or `*`)
 * answers `304` with `ETag` and `Cache-Control` and no body. Both are a use (`touch`, at most once an hour). `HEAD`
 * reaches this handler through the router's `HEAD` -> `GET` fallback; the server sends no body then. The log lines
 * show the path as `/api/calendar/feed/<redacted>.ics` (`logPathOf`).
 */
import { CALENDAR_FEED_LIMITS } from "@toon/shared";
import { Effect } from "effect";
import { HttpServerResponse } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { UNINTERRUPTIBLE } from "../../../http/middleware.ts";
import { header } from "../../../http/request.ts";
import { CalendarFeed } from "../services/feed/feed.service.ts";
import { CalendarFeedTokens } from "../services/feed/tokens.service.ts";
import { CalendarFeedPublicApi } from "./feed-public.api.ts";

/** `true` when an `If-None-Match` value (a comma list of entity tags, or `*`) names `etag` (weak comparison, RFC 9110). */
export function ifNoneMatchHits(value: string | undefined, etag: string): boolean {
  if (value === undefined) return false;
  return value
    .split(",")
    .map((tag) => tag.trim())
    .some((tag) => tag === "*" || (tag.startsWith("W/") ? tag.slice(2) : tag) === etag);
}

export const calendarFeedPublicGroupHandlers = HttpApiBuilder.group(
  CalendarFeedPublicApi,
  "calendar.feedPublic",
  (handlers) =>
    handlers
      /** GET /feed/:file — the iCalendar body, or 304, or the one 404. */
      .handle(
        "feed",
        Effect.fn("calendar.feedPublic.feed")(function* ({ params }) {
          const tokens = yield* CalendarFeedTokens;
          const calendar = yield* CalendarFeed;
          const feed = yield* tokens.resolve(params.file);
          const rendered = yield* calendar.render(feed);
          yield* tokens.touch(feed);
          const caching = {
            etag: rendered.etag,
            "cache-control": `private, max-age=${CALENDAR_FEED_LIMITS.maxAgeSeconds}`,
          };
          if (ifNoneMatchHits(yield* header("if-none-match"), rendered.etag)) {
            return HttpServerResponse.empty({ status: 304, headers: caching });
          }
          return HttpServerResponse.text(rendered.body, {
            status: 200,
            contentType: "text/calendar; charset=utf-8",
            headers: { ...caching, "content-disposition": 'inline; filename="haushalt.ics"' },
          });
        }),
        UNINTERRUPTIBLE,
      ),
);
