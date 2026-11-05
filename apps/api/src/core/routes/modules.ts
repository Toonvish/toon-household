/**
 * Module enabling per household (SPEC D2, D3, D8, §2; docs/plans/m1-core.md decision 3).
 *
 * Registered on `householdRoutes` by households.ts:
 *
 *   POST   /api/households/:householdId/modules/:moduleId   body `{ settings?: object }` (optional)
 *          -> 200 { household: HouseholdWithRole }   (its `modules` lists the new state)
 *   DELETE /api/households/:householdId/modules/:moduleId   -> 204, idempotent
 *
 * GATING: owner/admin AND a verified e-mail on both. Enabling or disabling a module is a
 * household-wide settings write, gated exactly like PATCH /:householdId. Membership is verified
 * by `requireHouseholdRole(...)` only — no inline check here.
 *
 * Any id in `MODULE_IDS` is accepted (else 404 `not_found`), whether or not this build contains
 * the module. The build module's `onEnable` hook may refuse with an `ApiError`, in which case
 * nothing is written (services/households/modules.ts).
 *
 * DISABLE KEEPS THE DATA: only the `household_modules` row goes; the module's household-scoped
 * rows stay in its tables, so enabling again brings them back unchanged.
 */
import { EnableModuleRequestSchema, isModuleId, type ModuleId } from "@toon/shared";
import { Effect, Schema } from "effect";
import { HttpServerRequest } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { NotFound, ValidationFailed } from "../../lib/errors.ts";
import { CurrentMembership } from "../../http/context.ts";
import { UNINTERRUPTIBLE } from "../../http/middleware.ts";
import { rawText } from "../../http/request.ts";
import { json, noContent } from "../../http/response.ts";
import { decode } from "../../lib/validate.ts";
import { Households } from "../services/households/households.service.ts";
import { HouseholdModules } from "../services/households/modules.ts";
import { HouseholdsApi } from "./households.api.ts";

/** The `:moduleId` param as a `ModuleId`, or 404 `not_found`. */
const moduleIdParam = Effect.fnUntraced(function* (moduleId: string | undefined): Effect.fn.Return<ModuleId, NotFound> {
  if (!moduleId || !isModuleId(moduleId)) return yield* new NotFound();
  return moduleId;
});

/**
 * The optional JSON body. An empty body means `{}`; anything else goes through
 * `EnableModuleRequestSchema` and answers 422 `validation_failed` like every validate() here.
 */
const enableBody = Effect.fnUntraced(function* (): Effect.fn.Return<
  { settings?: Record<string, unknown> },
  ValidationFailed | Schema.SchemaError,
  HttpServerRequest.HttpServerRequest
> {
  const text = yield* rawText;
  if (text.trim() === "") return {};
  const raw = yield* Effect.try({
    try: (): unknown => JSON.parse(text),
    catch: () => new ValidationFailed({ details: undefined }),
  });
  return yield* decode(EnableModuleRequestSchema, raw);
});

export const modulesHandlers = HttpApiBuilder.group(HouseholdsApi, "modules", (handlers) =>
  handlers
    /** POST /api/households/:householdId/modules/:moduleId — enable (admin+, verified e-mail). */
    .handle(
      "postByHouseholdIdModulesByModuleId",
      Effect.fn("modules.postByHouseholdIdModulesByModuleId")(function* ({ params }) {
        const households = yield* Households;
        const modules = yield* HouseholdModules;
        const membership = yield* CurrentMembership;
        const moduleId = yield* moduleIdParam(params.moduleId);
        const { settings } = yield* enableBody();
        yield* modules.enableModule(membership.householdId, moduleId, settings);
        return json({
          household: yield* households.getHouseholdWithRole(membership.householdId, membership.role),
        });
      }),
      UNINTERRUPTIBLE,
    )
    /** DELETE /api/households/:householdId/modules/:moduleId — disable (admin+, verified e-mail). */
    .handle(
      "deleteByHouseholdIdModulesByModuleId",
      Effect.fn("modules.deleteByHouseholdIdModulesByModuleId")(function* ({ params }) {
        const modules = yield* HouseholdModules;
        const membership = yield* CurrentMembership;
        const moduleId = yield* moduleIdParam(params.moduleId);
        yield* modules.disableModule(membership.householdId, moduleId);
        return noContent();
      }),
      UNINTERRUPTIBLE,
    ),
);
