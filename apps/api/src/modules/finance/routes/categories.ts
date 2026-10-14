/**
 * Mounted at /api/households/:householdId/finance/categories (see src/index.ts).
 * `label` is rendered server-side in the NEGOTIATED request locale
 * (`requestLocale(c)`) — never `households.defaultLocale` (docs/spec.md
 * §3.10).
 */
import { zValidator } from "@hono/zod-validator";
import { type CategoryListResponse, CreateCategoryRequestSchema, UpdateCategoryRequestSchema } from "@toon/shared";
import { Hono } from "hono";
import { db } from "../../../db/client.ts";
import { created, json, noContent } from "../../../lib/http.ts";
import { requestLocale } from "../../../lib/locale.ts";
import type { AppEnv } from "../../../lib/types.ts";
import { requireFinanceParticipant, requireFinanceParticipantContext as requireHouseholdContext } from "../middleware.ts";
import { onValidationError } from "../../../core/services/households/validation.ts";
import { requireVerifiedEmail } from "../../../middleware/verifiedEmail.ts";
import { createCategory, deleteCategory, listCategories, updateCategory } from "../services/categories/categories.service.ts";

export const categoryRoutes = new Hono<AppEnv>();

categoryRoutes.use("*", requireVerifiedEmail());
categoryRoutes.use("*", requireFinanceParticipant());

/** GET /?includeHidden= — sorted by position. */
categoryRoutes.get("/", async (c) => {
  const household = requireHouseholdContext(c);
  const includeHidden = ["true", "1"].includes(c.req.query("includeHidden") ?? "");
  const payload: CategoryListResponse = {
    items: await listCategories(db, household.householdId, requestLocale(c), includeHidden),
  };
  return json(c, payload);
});

/** POST / — `slug = "custom-" + id.slice(0, 8)`, always a household-owned (non-system) row. */
categoryRoutes.post("/", zValidator("json", CreateCategoryRequestSchema, onValidationError), async (c) => {
  const household = requireHouseholdContext(c);
  const category = await createCategory(db, household.householdId, requestLocale(c), c.req.valid("json"));
  return created(c, category);
});

/** PATCH /:categoryId — `409 category_system` if `label` is set on `fixkosten`. */
categoryRoutes.patch("/:categoryId", zValidator("json", UpdateCategoryRequestSchema, onValidationError), async (c) => {
  const household = requireHouseholdContext(c);
  const category = await updateCategory(db, household.householdId, requestLocale(c), c.req.param("categoryId"), c.req.valid("json"));
  return json(c, category);
});

/** DELETE /:categoryId?reassignTo= — `409 category_system` for `fixkosten`, `409 category_in_use` without `reassignTo`. */
categoryRoutes.delete("/:categoryId", async (c) => {
  const household = requireHouseholdContext(c);
  const reassignTo = c.req.query("reassignTo");
  await deleteCategory(db, household.householdId, c.req.param("categoryId"), reassignTo && reassignTo.length > 0 ? reassignTo : undefined);
  return noContent(c);
});

export default categoryRoutes;
