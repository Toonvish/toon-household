/** Finance categories (`label` is rendered server-side in the NEGOTIATED request locale, never `households.defaultLocale`); served at /api/households/:householdId/finance/categories (docs/API.md "Finance module"). */
import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { chain, householdModuleApi, RequireVerifiedEmail } from "../../../http/middleware.ts";
import { RequireFinanceParticipant } from "../http.ts";

const params = { householdId: Schema.String };

export const FinanceCategoriesGroup = HttpApiGroup.make("finance.categories")
  .add(
    /** GET /api/households/:householdId/finance/categories */
    HttpApiEndpoint.get("get", "/", { params }),
    /** POST /api/households/:householdId/finance/categories */
    HttpApiEndpoint.post("post", "/", { params }),
    /** PATCH /api/households/:householdId/finance/categories/:categoryId */
    HttpApiEndpoint.patch("patchByCategoryId", "/:categoryId", {
      params: { householdId: Schema.String, categoryId: Schema.String },
    }),
    /** DELETE /api/households/:householdId/finance/categories/:categoryId */
    HttpApiEndpoint.delete("deleteByCategoryId", "/:categoryId", {
      params: { householdId: Schema.String, categoryId: Schema.String },
    }),
  )
  .prefix("/categories")
  .pipe(chain(RequireVerifiedEmail, RequireFinanceParticipant));

export const FinanceCategoriesApi = householdModuleApi(
  "finance",
  HttpApi.make("finance.categories").add(FinanceCategoriesGroup),
);
