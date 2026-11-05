/** OWNER: plan agent; served at /api/households/:householdId/recipe/plan (docs/API.md "Meal plan"). */
import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { chain, householdModuleApi, RequireVerifiedEmail } from "../../../http/middleware.ts";

export const RecipePlanGroup = HttpApiGroup.make("recipe.plan")
  .add(
    /** GET /api/households/:householdId/recipe/plan */
    HttpApiEndpoint.get("get", "/", { params: { householdId: Schema.String } }),
    /** GET /api/households/:householdId/recipe/plan/last-planned */
    HttpApiEndpoint.get("getLastPlanned", "/last-planned", { params: { householdId: Schema.String } }),
    /** POST /api/households/:householdId/recipe/plan */
    HttpApiEndpoint.post("post", "/", { params: { householdId: Schema.String } }),
    /** PATCH /api/households/:householdId/recipe/plan/:entryId */
    HttpApiEndpoint.patch("patchByEntryId", "/:entryId", {
      params: { householdId: Schema.String, entryId: Schema.String },
    }),
    /** DELETE /api/households/:householdId/recipe/plan/:entryId */
    HttpApiEndpoint.delete("deleteByEntryId", "/:entryId", {
      params: { householdId: Schema.String, entryId: Schema.String },
    }),
  )
  .prefix("/plan")
  .pipe(chain(RequireVerifiedEmail));

export const RecipePlanApi = householdModuleApi("recipe", HttpApi.make("recipe.plan").add(RecipePlanGroup));
