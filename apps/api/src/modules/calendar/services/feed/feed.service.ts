/**
 * `CalendarFeed` (plan `docs/plans/m9-calendar-feed.md` P6, P8, P9, P10, P12): renders a resolved link
 * (`CalendarFeedTokens.resolve`) as the iCalendar body of the subscription feed, with its strong ETag.
 *
 * - **The window, and the server's today (P8, the one exception to the module's "the server never decides today").**
 *   A subscribed calendar has no client that could send a date, so today is the Clock's date in Europe/Berlin
 *   (`DateTime.now` zoned, as the seed does); the window is `[today - 30 days, today + 365 days]` (396 days, under the
 *   400-day cap). One entry yields at most 396 occurrences in it, so `calendar_range_too_large` cannot occur; should it,
 *   the feed dies (`Effect.orDie`: a 500 that logs).
 * - **The occurrences (P9)** are `CalendarOccurrences.expand` over that window, the same items `GET …/occurrences`
 *   answers: scope `all` everything, scope `mine` with `memberId` = the link's user (the P10 rule: an occurrence naming
 *   nobody is for everybody; else the user is an attendee, the car booking's person or the assignee of THAT occurrence).
 *   Skipped occurrences are dropped; done ones are marked by the mapper.
 * - **The words (P10)** are the link user's `users.locale` when it is a supported locale, else `AppConfig.defaultLocale`.
 * - **The ETag (P6)** is `"` + the SHA-256 hex of the body + `"`: the body depends only on the data and the window (each
 *   `DTSTAMP` is the entry's `updated_at`), so an unchanged calendar keeps its ETag until the window moves at midnight.
 *
 * Over `Database`, `AppConfig`, `CalendarOccurrences` and `CalendarResources`, yielded inside the layer's generator.
 */
import { CALENDAR_FEED_LIMITS, addCalendarDays, isLocale } from "@toon/shared";
import { eq } from "drizzle-orm";
import { Context, DateTime, Effect, Layer } from "effect";
import { AppConfig } from "../../../../config.ts";
import { Database } from "../../../../db/database.ts";
import { households, users } from "../../../../db/schema.ts";
import type { DatabaseError } from "../../../../lib/errors.ts";
import { CalendarOccurrences } from "../entries/occurrences.service.ts";
import { CalendarResources } from "../entries/resources.service.ts";
import { icsCalendar } from "./ics.ts";
import type { ResolvedFeed } from "./tokens.service.ts";
import { feedCalendarName, feedEvent } from "./vevent.ts";

/** What the feed route sends: the body and its strong ETag (quotes included). */
export interface RenderedFeed {
  readonly body: string;
  readonly etag: string;
}

/** The feed's window around `today` (P8): `[today - 30, today + 365]`, both inclusive. */
export function feedWindow(today: string): { readonly from: string; readonly to: string } {
  return {
    from: addCalendarDays(today, -CALENDAR_FEED_LIMITS.pastDays),
    to: addCalendarDays(today, CALENDAR_FEED_LIMITS.futureDays),
  };
}

/** The strong ETag of a body: its SHA-256 hex in quotes. */
export function feedEtag(body: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(body);
  return `"${hasher.digest("hex")}"`;
}

export class CalendarFeed extends Context.Service<
  CalendarFeed,
  {
    /** The iCalendar body of `feed` and its ETag. */
    readonly render: (feed: ResolvedFeed) => Effect.Effect<RenderedFeed, DatabaseError>;
  }
>()("toon/api/modules/calendar/services/feed/feed.service/CalendarFeed") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const database = yield* Database;
      const config = yield* AppConfig;
      const occurrences = yield* CalendarOccurrences;
      const resources = yield* CalendarResources;

      const render = Effect.fn("CalendarFeed.render")(function* (feed: ResolvedFeed) {
        const now = yield* DateTime.now;
        const today = DateTime.formatIsoDate(DateTime.makeZonedUnsafe(now, { timeZone: CALENDAR_FEED_LIMITS.timeZone }));
        const { from, to } = feedWindow(today);

        const expanded = yield* Effect.orDie(
          occurrences.expand(
            feed.householdId,
            feed.scope === "mine" ? { from, to, memberId: feed.userId } : { from, to },
          ),
        );
        const cars = yield* resources.list(feed.householdId, true);
        const [household] = yield* database.use((db) =>
          db.select({ name: households.name }).from(households).where(eq(households.id, feed.householdId)).limit(1),
        );
        const [user] = yield* database.use((db) =>
          db.select({ locale: users.locale }).from(users).where(eq(users.id, feed.userId)).limit(1),
        );
        const locale = isLocale(user?.locale) ? user.locale : config.defaultLocale;

        const names = {
          members: new Map(expanded.members.map((member) => [member.userId, member.name])),
          cars: new Map(cars.map((car) => [car.id, car.name])),
        };
        const events = expanded.items
          .filter(({ occurrence }) => occurrence.status !== "skipped")
          .map(({ occurrence, entry }) =>
            feedEvent({ occurrence, notes: entry.row.notes, updatedAt: entry.row.updatedAt }, names, locale),
          );
        const body = icsCalendar({ name: feedCalendarName(household?.name ?? "", feed.scope, locale), events });
        return { body, etag: feedEtag(body) };
      });

      return CalendarFeed.of({ render });
    }),
  );
}
