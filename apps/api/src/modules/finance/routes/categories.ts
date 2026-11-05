/**
 * Mounted at /api/households/:householdId/finance/categories (see src/index.ts).
 * `label` is rendered server-side in the NEGOTIATED request locale
 * (`requestLocale(c)`) — never `households.defaultLocale` (docs/spec.md
 * §3.10).
 */
import { Effect } from "effect";
import { runtime } from "../../../runtime.ts";
import { type CategoryListResponse, CreateCategoryRequestSchema, UpdateCategoryRequestSchema } from "@toon/shared";
import { Hono } from "hono";
import { created, json, noContent } from "../../../lib/http.ts";
import { requestLocale } from "../../../lib/locale.ts";
import type { AppEnv } from "../../../lib/types.ts";
import { requireFinanceParticipant, currentFinanceParticipant } from "../middleware.ts";
import { validate } from "../../../lib/validate.ts";
import { requireVerifiedEmail } from "../../../middleware/verifiedEmail.ts";
import { FinanceCategories } from "../services/categories/categories.service.ts";

export const categoryRoutes = new Hono<AppEnv>();

categoryRoutes.use("*", requireVerifiedEmail());
categoryRoutes.use("*", requireFinanceParticipant());

/** GET /?includeHidden= — sorted by position. */
categoryRoutes.get("/", (c) =>
runtime.runPromise(
Effect.gen(function* () {
  const categoriesService = yield* FinanceCategories;
  const household = yield* currentFinanceParticipant(c);
  const includeHidden = ["true", "1"].includes(c.req.query("includeHidden") ?? "");
  const payload: CategoryListResponse = {
    items: yield* categoriesService.listCategories(household.householdId, requestLocale(c), includeHidden),
  };
  return json(c, payload);
}),
),
);

/** POST / — `slug = "custom-" + id.slice(0, 8)`, always a household-owned (non-system) row. */
categoryRoutes.post("/", validate("json", CreateCategoryRequestSchema), (c) =>
runtime.runPromise(
Effect.gen(function* () {
  const categoriesService = yield* FinanceCategories;
  const household = yield* currentFinanceParticipant(c);
  const category = yield* categoriesService.createCategory(household.householdId, requestLocale(c), c.req.valid("json"));
  return created(c, category);
}),
),
);

/** PATCH /:categoryId — `409 category_system` if `label` is set on `fixkosten`. */
categoryRoutes.patch("/:categoryId", validate("json", UpdateCategoryRequestSchema), (c) =>
runtime.runPromise(
Effect.gen(function* () {
  const categoriesService = yield* FinanceCategories;
  const household = yield* currentFinanceParticipant(c);
  const category = yield* categoriesService.updateCategory(household.householdId, requestLocale(c), c.req.param("categoryId"), c.req.valid("json"));
  return json(c, category);
}),
),
);

/** DELETE /:categoryId?reassignTo= — `409 category_system` for `fixkosten`, `409 category_in_use` without `reassignTo`. */
categoryRoutes.delete("/:categoryId", (c) =>
runtime.runPromise(
Effect.gen(function* () {
  const categoriesService = yield* FinanceCategories;
  const household = yield* currentFinanceParticipant(c);
  const reassignTo = c.req.query("reassignTo");
  yield* categoriesService.deleteCategory(household.householdId, c.req.param("categoryId"), reassignTo && reassignTo.length > 0 ? reassignTo : undefined);
  return noContent(c);
}),
),
);

export default categoryRoutes;
