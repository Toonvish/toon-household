/**
 * The request-scoped shapes the routers share.
 *
 * `Membership` lives in `apps/api/src/http/context.ts` (the `CurrentMembership` service of the Effect HTTP layer, plan
 * `docs/plans/e7-http-api.md` P5) and is re-exported here for the services and tests that import it from this file.
 *
 * The Hono section below (until E7-T12 deletes it) is the Hono environment shared by ALL Hono routers. Every
 * sub-router is declared as `new Hono<AppEnv>()` so that context variables set by middleware are typed.
 *
 * Contract between the agents:
 * - the auth middleware sets `user` + `sessionId` (requireSession)
 * - the household middleware sets `membership` (requireHouseholdRole)
 * Handlers read them with c.get("user") / c.get("membership"); the non-optional
 * getters below fail with `Unauthorized` (401) / `Forbidden` (403) if the
 * middleware was forgotten: `currentUser(c)` / `currentMembership(c)` as Effects
 * (plan e2 P19), `requireUser(c)` / `requireMembership(c)` as their synchronous
 * bridges: no module route calls them any more (plan e4 P16), the tests keep them until E8.
 *
 * Import cycle (plan e2 P12): this file imports neither `runtime.ts` nor a service.
 */
import type { Membership } from "../http/context.ts";

export type { Membership };
