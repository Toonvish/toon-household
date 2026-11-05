/**
 * The core `HttpApiMiddleware` implementations as one layer (docs/EFFECT.md E8; plan `docs/plans/e7-http-api.md` P5,
 * P13, P15).
 *
 * `httpMiddlewareLayer()` merges `ApiErrorBoundaryLayer` (`apps/api/src/http/response.ts`) with the session, household,
 * module and verified-e-mail layers of `apps/api/src/middleware/*.ts`. What it requires (`Sessions`, `Database`,
 * `VerifiedEmail`) comes from the one `AppLayer`: every in-memory handler (`inMemoryHandler`, the bridges of
 * `apps/api/src/http/bridge.ts`, `testHttpApp`) provides it with `Layer.provideMerge` under the route layer, so the
 * middlewares are in the context when `HttpApiBuilder.layer` builds the routes. Finance's `RequireFinanceParticipant`
 * is not core and is provided by the finance module (E7-T09).
 *
 * A hoisted function (P15): this file imports the middleware files, which sit in the API's import cycle; the layer
 * constants are read when the function is called (the first request of a handler), never at import.
 */
import { Layer } from "effect";
import { RequireHouseholdAdminLayer, RequireHouseholdMemberLayer, RequireHouseholdOwnerLayer } from "../middleware/household.ts";
import { RequireModuleLayer } from "../middleware/module.ts";
import { OptionalSessionLayer, RequireSessionLayer } from "../middleware/session.ts";
import { RequireVerifiedEmailLayer } from "../middleware/verifiedEmail.ts";
import { ApiErrorBoundaryLayer } from "./response.ts";

/** Every core middleware implementation: `ApiErrorBoundary`, the session, household, module and verified-e-mail tags. */
export function httpMiddlewareLayer() {
  return Layer.mergeAll(
    ApiErrorBoundaryLayer,
    RequireSessionLayer,
    OptionalSessionLayer,
    RequireHouseholdMemberLayer,
    RequireHouseholdAdminLayer,
    RequireHouseholdOwnerLayer,
    RequireModuleLayer,
    RequireVerifiedEmailLayer,
  );
}
