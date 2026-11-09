/**
 * `CalendarFeedTokens` (plan `docs/plans/m9-calendar-feed.md` P3, P4, P5, P7, P13; ADR 0017): a member's subscription
 * link, one per member and household (`calendar_feed_tokens`).
 *
 * - The token is 32 random bytes from `crypto.getRandomValues` in base64url (43 characters, `generateOpaqueToken` of the
 *   core); only its SHA-256 hex (`hashToken`) is stored, the lookup is by hash (a unique index). The token leaves the
 *   server ONCE: in the url of `create`'s answer (`<first WEB_ORIGIN>/api/calendar/feed/<token>.ics`, the claim links'
 *   origin rule).
 * - `get`, `create` (create or REPLACE in ONE upsert on `(household_id, user_id)`: a new id, hash, scope, `created_at`
 *   from the Clock and `last_used_at` NULL; the old token stops resolving at once), `updateScope` (`404 not_found`
 *   without a link), `remove` (idempotent): the caller's OWN link, by `(householdId, userId)` of the membership.
 * - `resolve(file)`, the feed route's checks in P4 order: `file` against `CALENDAR_FEED_FILE_PATTERN` -> the hash -> the
 *   rate limit (P5: 60 per token hash and hour through `RateLimiter.check`, always on; `429 rate_limited` with
 *   `Retry-After`; before the lookup, so an unknown token spends its bucket too) -> the row by hash -> the row's user is
 *   still a member of the row's household -> the household has the calendar enabled. EVERY refusal is the same
 *   `new NotFound()`.
 * - `touch(feed)` (P7): writes `last_used_at` when it is NULL or at least an hour older than the Clock's now; never once
 *   per fetch.
 *
 * Over `Database`, `AppConfig`, `RateLimiter` and `HouseholdModules`, all yielded inside the layer's generator; time
 * is read in each method (a `TestClock` reaches it).
 */
import {
  CALENDAR_FEED_FILE_PATTERN,
  CALENDAR_FEED_LIMITS,
  CALENDAR_FEED_PATH_PREFIX,
  type CalendarFeed,
  type CalendarFeedCreatedResponse,
  type CalendarFeedScope,
} from "@toon/shared";
import { and, eq } from "drizzle-orm";
import { Clock, Context, Effect, Layer } from "effect";
import { AppConfig } from "../../../../config.ts";
import type { RateLimitRule } from "../../../../core/services/auth/rateLimit.ts";
import { RateLimiter } from "../../../../core/services/auth/rateLimit.ts";
import { generateOpaqueToken, hashToken } from "../../../../core/services/auth/tokens.ts";
import { HouseholdModules } from "../../../../core/services/households/modules.ts";
import { Database } from "../../../../db/database.ts";
import { householdMembers } from "../../../../db/schema.ts";
import { type DatabaseError, NotFound, RateLimited } from "../../../../lib/errors.ts";
import { toIso } from "../../../../lib/http.ts";
import { type CalendarFeedTokenRow, calendarFeedTokens } from "../../schema.ts";

/** P5: fetches per token hash and hour. */
export const CALENDAR_FEED_RULE: RateLimitRule = { limit: CALENDAR_FEED_LIMITS.fetchesPerHour, windowMs: 60 * 60_000 };

/** The rate-limit bucket of a token hash (P5). */
export function feedRateLimitKey(tokenHash: string): string {
  return `calendar-feed:${tokenHash}`;
}

/** A link the feed route resolved (P4): whose it is, which household, which scope. */
export interface ResolvedFeed {
  readonly id: string;
  readonly householdId: string;
  readonly userId: string;
  readonly scope: CalendarFeedScope;
  readonly lastUsedAt: number | null;
}

function scopeOf(stored: string): CalendarFeedScope {
  return stored === "mine" ? "mine" : "all";
}

function toFeedDto(row: Pick<CalendarFeedTokenRow, "scope" | "createdAt" | "lastUsedAt">): CalendarFeed {
  return {
    scope: scopeOf(row.scope),
    createdAt: toIso(row.createdAt),
    lastUsedAt: row.lastUsedAt === null ? null : toIso(row.lastUsedAt),
  };
}

export class CalendarFeedTokens extends Context.Service<
  CalendarFeedTokens,
  {
    /** The caller's link in the household, or `null` (never the token). */
    readonly get: (householdId: string, userId: string) => Effect.Effect<CalendarFeed | null, DatabaseError>;
    /** Creates the caller's link, or replaces it (the old token dies at once); the answer carries the url. */
    readonly create: (
      householdId: string,
      userId: string,
      scope: CalendarFeedScope,
    ) => Effect.Effect<CalendarFeedCreatedResponse, DatabaseError>;
    /** Changes the scope (the token stays); `404 not_found` without a link. */
    readonly updateScope: (
      householdId: string,
      userId: string,
      scope: CalendarFeedScope,
    ) => Effect.Effect<CalendarFeed, NotFound | DatabaseError>;
    /** Ends the caller's link; nothing to end is fine. */
    readonly remove: (householdId: string, userId: string) => Effect.Effect<void, DatabaseError>;
    /** The feed route's `:file` -> the link, or the one `404 not_found` (P4), or `429 rate_limited` (P5). */
    readonly resolve: (file: string) => Effect.Effect<ResolvedFeed, NotFound | RateLimited | DatabaseError>;
    /** Records a fetch at most once per hour (P7). */
    readonly touch: (feed: ResolvedFeed) => Effect.Effect<void, DatabaseError>;
  }
>()("toon/api/modules/calendar/services/feed/tokens.service/CalendarFeedTokens") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const database = yield* Database;
      const config = yield* AppConfig;
      const rateLimiter = yield* RateLimiter;
      const modules = yield* HouseholdModules;

      const ownRow = (householdId: string, userId: string) =>
        and(eq(calendarFeedTokens.householdId, householdId), eq(calendarFeedTokens.userId, userId));

      const get = Effect.fn("CalendarFeedTokens.get")(function* (householdId: string, userId: string) {
        const [row] = yield* database.use((db) =>
          db.select().from(calendarFeedTokens).where(ownRow(householdId, userId)).limit(1),
        );
        return row === undefined ? null : toFeedDto(row);
      });

      const create = Effect.fn("CalendarFeedTokens.create")(function* (
        householdId: string,
        userId: string,
        scope: CalendarFeedScope,
      ) {
        const token = generateOpaqueToken();
        const now = yield* Clock.currentTimeMillis;
        const fresh = { id: crypto.randomUUID(), tokenHash: hashToken(token), scope, createdAt: now, lastUsedAt: null };
        yield* database.use((db) =>
          db
            .insert(calendarFeedTokens)
            .values({ ...fresh, householdId, userId })
            .onConflictDoUpdate({ target: [calendarFeedTokens.householdId, calendarFeedTokens.userId], set: fresh }),
        );
        const origin = (config.webOrigins[0] ?? "").replace(/\/+$/, "");
        return {
          url: `${origin}${CALENDAR_FEED_PATH_PREFIX}${token}.ics`,
          scope,
          createdAt: toIso(now),
          lastUsedAt: null,
        };
      });

      const updateScope = Effect.fn("CalendarFeedTokens.updateScope")(function* (
        householdId: string,
        userId: string,
        scope: CalendarFeedScope,
      ) {
        const [row] = yield* database.use((db) =>
          db.update(calendarFeedTokens).set({ scope }).where(ownRow(householdId, userId)).returning(),
        );
        if (row === undefined) return yield* new NotFound();
        return toFeedDto(row);
      });

      const remove = Effect.fn("CalendarFeedTokens.remove")(function* (householdId: string, userId: string) {
        yield* database.use((db) => db.delete(calendarFeedTokens).where(ownRow(householdId, userId)));
      });

      const resolve = Effect.fn("CalendarFeedTokens.resolve")(function* (file: string) {
        const match = CALENDAR_FEED_FILE_PATTERN.exec(file);
        const token = match?.[1];
        if (token === undefined) return yield* new NotFound();
        const tokenHash = hashToken(token);

        const limit = yield* rateLimiter.check(feedRateLimitKey(tokenHash), CALENDAR_FEED_RULE);
        if (!limit.allowed) return yield* new RateLimited({ retryAfterSeconds: limit.retryAfterSeconds });

        const [row] = yield* database.use((db) =>
          db.select().from(calendarFeedTokens).where(eq(calendarFeedTokens.tokenHash, tokenHash)).limit(1),
        );
        if (row === undefined) return yield* new NotFound();
        const membership = yield* database.use((db) =>
          db
            .select({ id: householdMembers.id })
            .from(householdMembers)
            .where(and(eq(householdMembers.householdId, row.householdId), eq(householdMembers.userId, row.userId)))
            .limit(1),
        );
        if (membership.length === 0) return yield* new NotFound();
        const enabled = (yield* modules.enabledModulesFor([row.householdId])).get(row.householdId) ?? [];
        if (!enabled.includes("calendar")) return yield* new NotFound();
        return {
          id: row.id,
          householdId: row.householdId,
          userId: row.userId,
          scope: scopeOf(row.scope),
          lastUsedAt: row.lastUsedAt,
        };
      });

      const touch = Effect.fn("CalendarFeedTokens.touch")(function* (feed: ResolvedFeed) {
        const now = yield* Clock.currentTimeMillis;
        if (feed.lastUsedAt !== null && now - feed.lastUsedAt < CALENDAR_FEED_LIMITS.lastUsedResolutionMs) return;
        yield* database.use((db) =>
          db.update(calendarFeedTokens).set({ lastUsedAt: now }).where(eq(calendarFeedTokens.id, feed.id)),
        );
      });

      return CalendarFeedTokens.of({ get, create, updateScope, remove, resolve, touch });
    }),
  );
}
