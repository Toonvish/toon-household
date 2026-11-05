/**
 * Mounted at /api/households/:householdId/finance/categories (see src/index.ts).
 * `label` is rendered server-side in the NEGOTIATED request locale
 * (`requestLocale(c)`) — never `households.defaultLocale` (docs/spec.md
 * §3.10).
 */
import { type CategoryListResponse, CreateCategoryRequestSchema, UpdateCategoryRequestSchema } from "@toon/shared";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { UNINTERRUPTIBLE } from "../../../http/middleware.ts";
import { jsonBody, queryParam, requestLocale } from "../../../http/request.ts";
import { created, json, noContent } from "../../../http/response.ts";
import { CurrentFinanceParticipant } from "../http.ts";
import { FinanceCategories } from "../services/categories/categories.service.ts";
import { FinanceCategoriesApi } from "./categories.api.ts";

export const categoriesHandlers = HttpApiBuilder.group(FinanceCategoriesApi, "finance.categories", (handlers) =>
  handlers
    /** GET /?includeHidden= — sorted by position. */
    .handle(
      "get",
      Effect.fn("finance.categories.get")(function* () {
        const categoriesService = yield* FinanceCategories;
        const household = yield* CurrentFinanceParticipant;
        const includeHidden = ["true", "1"].includes((yield* queryParam("includeHidden")) ?? "");
        const payload: CategoryListResponse = {
          items: yield* categoriesService.listCategories(household.householdId, yield* requestLocale, includeHidden),
        };
        return json(payload);
      }),
      UNINTERRUPTIBLE,
    )
    /** POST / — `slug = "custom-" + id.slice(0, 8)`, always a household-owned (non-system) row. */
    .handle(
      "post",
      Effect.fn("finance.categories.post")(function* () {
        const body = yield* jsonBody(CreateCategoryRequestSchema);
        const categoriesService = yield* FinanceCategories;
        const household = yield* CurrentFinanceParticipant;
        const category = yield* categoriesService.createCategory(household.householdId, yield* requestLocale, body);
        return created(category);
      }),
      UNINTERRUPTIBLE,
    )
    /** PATCH /:categoryId — `409 category_system` if `label` is set on `fixkosten`. */
    .handle(
      "patchByCategoryId",
      Effect.fn("finance.categories.patchByCategoryId")(function* ({ params }) {
        const body = yield* jsonBody(UpdateCategoryRequestSchema);
        const categoriesService = yield* FinanceCategories;
        const household = yield* CurrentFinanceParticipant;
        const category = yield* categoriesService.updateCategory(household.householdId, yield* requestLocale, params.categoryId, body);
        return json(category);
      }),
      UNINTERRUPTIBLE,
    )
    /** DELETE /:categoryId?reassignTo= — `409 category_system` for `fixkosten`, `409 category_in_use` without `reassignTo`. */
    .handle(
      "deleteByCategoryId",
      Effect.fn("finance.categories.deleteByCategoryId")(function* ({ params }) {
        const categoriesService = yield* FinanceCategories;
        const household = yield* CurrentFinanceParticipant;
        const reassignTo = yield* queryParam("reassignTo");
        yield* categoriesService.deleteCategory(household.householdId, params.categoryId, reassignTo && reassignTo.length > 0 ? reassignTo : undefined);
        return noContent();
      }),
      UNINTERRUPTIBLE,
    ),
);
