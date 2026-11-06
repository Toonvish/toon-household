/**
 * The request-scoped shapes the routers share.
 *
 * `Membership` lives in `apps/api/src/http/context.ts` (the `CurrentMembership` service of the Effect HTTP layer, plan
 * `docs/plans/e7-http-api.md` P5) and is re-exported here for the services and tests that import it from this file.
 *
 * The request-scoped values a handler reads (`CurrentUser`, `CurrentSession`, `MaybeSession`, `CurrentMembership`) are
 * services of `apps/api/src/http/context.ts`, provided by the `HttpApiMiddleware`s of `apps/api/src/middleware/`; the
 * pre-E7 Hono app kept them in a context environment (`c.get("user")`) that this file used to declare.
 *
 * Import cycle (plan e2 P12): this file imports neither `runtime.ts` nor a service.
 */
import type { Membership } from "../http/context.ts";

export type { Membership };
