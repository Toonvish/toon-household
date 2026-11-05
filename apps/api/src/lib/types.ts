/**
 * The Hono environment shared by ALL routers. Every sub-router is declared as
 * `new Hono<AppEnv>()` so that context variables set by middleware are typed.
 *
 * Contract between the agents:
 * - the auth middleware sets `user` + `sessionId` (requireSession)
 * - the household middleware sets `membership` (requireHouseholdRole)
 * Handlers read them with c.get("user") / c.get("membership"); the non-optional
 * getters below fail with `Unauthorized` (401) / `Forbidden` (403) if the
 * middleware was forgotten: `currentUser(c)` / `currentMembership(c)` as Effects
 * (plan e2 P19), `requireUser(c)` / `requireMembership(c)` as their synchronous
 * bridges for the recipe and finance modules (plan e2 P1).
 *
 * Import cycle (plan e2 P12): this file imports neither `runtime.ts` nor a service.
 */
import type { HouseholdRole, Locale, User } from "@toon/shared";
import { Effect } from "effect";
import type { Context } from "hono";
import { Forbidden, Unauthorized } from "./errors.ts";

export interface Membership {
  householdId: string;
  userId: string;
  role: HouseholdRole;
}

export interface AppVariables {
  /** Set by requireSession (and by optionalSession when a cookie is present). */
  user?: User;
  /** Session id (cookie value) of the current request. */
  sessionId?: string;
  /** Set by requireHouseholdRole for every /api/households/:householdId/* route. */
  membership?: Membership;
  /**
   * Set by `localeMiddleware` (lib/locale.ts). OPTIONAL on purpose:
   * `onError`/`notFound` can fire before an `app.use("*")` middleware has run,
   * so `requestLocale(c)`'s `?? env.defaultLocale` is load-bearing — do not
   * type this as required, it would read as dead code.
   */
  locale?: Locale;
}

export type AppEnv = { Variables: AppVariables };

export type AppContext = Context<AppEnv>;

/** The authenticated user, or `Unauthorized` (401) when `requireSession` did not run. */
export const currentUser = Effect.fnUntraced(function* (c: AppContext): Effect.fn.Return<User, Unauthorized> {
  const user = c.get("user");
  if (!user) return yield* new Unauthorized();
  return user;
});

/** The verified household membership, or `Forbidden` (403) when `requireHouseholdRole` did not run. */
export const currentMembership = Effect.fnUntraced(function* (
  c: AppContext,
): Effect.fn.Return<Membership, Forbidden> {
  const membership = c.get("membership");
  if (!membership) return yield* new Forbidden({ text: "server.group.noAccess" });
  return membership;
});

/* legacy bridges: callers listed; E3 (recipe), E4 (finance), E5 (scripts) remove them */

/** Returns the authenticated user or throws `Unauthorized` (401). Callers: the finance routes (E4). Synchronous. */
export function requireUser(c: AppContext): User {
  return Effect.runSync(currentUser(c));
}

/** Returns the verified household membership or throws `Forbidden` (403). Callers: the finance routes and `finance/middleware.ts` (E4), `apps/api/test/{modules,middleware}.test.ts`.
 * Synchronous. */
export function requireMembership(c: AppContext): Membership {
  return Effect.runSync(currentMembership(c));
}
