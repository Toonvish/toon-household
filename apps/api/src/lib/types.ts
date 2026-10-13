/**
 * The Hono environment shared by ALL routers. Every sub-router is declared as
 * `new Hono<AppEnv>()` so that context variables set by middleware are typed.
 *
 * Contract between the agents:
 * - the auth middleware sets `user` + `sessionId` (requireSession)
 * - the household middleware sets `membership` (requireHouseholdRole)
 * Handlers read them with c.get("user") / c.get("membership"); the non-optional
 * getters below throw a 401/403-shaped ApiError if the middleware was forgotten.
 */
import type { HouseholdRole, Locale, User } from "@toon/shared";
import type { Context } from "hono";
import { ApiError } from "./errors.ts";

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

/** Returns the authenticated user or throws 401. */
export function requireUser(c: AppContext): User {
  const user = c.get("user");
  if (!user) throw ApiError.unauthorized();
  return user;
}

/** Returns the verified household membership or throws 403. */
export function requireMembership(c: AppContext): Membership {
  const membership = c.get("membership");
  if (!membership) throw ApiError.forbidden("server.group.noAccess");
  return membership;
}
