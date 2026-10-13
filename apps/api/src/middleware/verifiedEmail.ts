/**
 * OWNER: auth agent.
 *
 * `requireVerifiedEmail()` — the third auth middleware, after `requireSession()`
 * and `requireHouseholdRole()`. It answers 403 `email_unverified` when the session's
 * address has never been confirmed and this deployment gates writes on that (see
 * services/auth/verifiedEmail.ts for when it does, and why it follows the mailer
 * instead of an env variable).
 *
 * IT ONLY EVER BLOCKS A WRITE. GET/HEAD/OPTIONS pass through untouched, which is
 * what makes "read-only" true rather than "locked out": an unconfirmed account
 * browses every record in its households, and the read-only PWA keeps working. That
 * check lives HERE and not at each call site so a router can mount it once —
 *
 *   exampleRoutes.use("*", requireVerifiedEmail());
 *
 * — and a route added to that router later is gated by default. Routers whose
 * writes are not uniformly gated (core household routes, where accepting an invite and
 * leaving a household must stay open) apply it per route instead; mounting it with
 * `use("*")` there would silently swallow the one escape hatch an unconfirmed
 * user has.
 *
 * ORDER: after `requireSession()`, because it needs `c.get("user")`. Before or
 * after `requireHouseholdRole()` is a judgement call and it is mounted AFTER: a
 * non-member should be told they are a non-member (404/403 `forbidden`) rather
 * than being handed a confirmation prompt for a household they cannot see anyway.
 */
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../lib/types.ts";
import { requireUser } from "../lib/types.ts";
import { assertEmailVerified } from "../core/services/auth/verifiedEmail.ts";

/** Methods that never change anything, so the gate lets them past. */
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * 403 `email_unverified` on a write from an account with an unconfirmed address.
 * A no-op on this deployment when no mail transport is configured.
 */
export function requireVerifiedEmail(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!READ_METHODS.has(c.req.method)) {
      assertEmailVerified(requireUser(c));
    }
    await next();
  };
}
