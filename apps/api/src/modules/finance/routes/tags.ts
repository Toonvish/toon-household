/**
 * Mounted at /api/households/:householdId/finance/tags (see src/index.ts). Reads +
 * rename + delete only — there is no `POST /tags` (docs/spec.md §3.10): a tag
 * is created solely as a side effect of attaching it to a transaction.
 */
import { zValidator } from "@hono/zod-validator";
import { type FinanceTagListResponse as TagListResponse, FinanceUpdateTagRequestSchema as UpdateTagRequestSchema, TagQuerySchema } from "@toon/shared";
import { Hono } from "hono";
import { db } from "../../../db/client.ts";
import { json, noContent } from "../../../lib/http.ts";
import type { AppEnv } from "../../../lib/types.ts";
import { requireFinanceParticipant, requireFinanceParticipantContext as requireHouseholdContext } from "../middleware.ts";
import { onValidationError } from "../../../core/services/households/validation.ts";
import { requireVerifiedEmail } from "../../../middleware/verifiedEmail.ts";
import { deleteTag, listTags, updateTag } from "../services/tags/tags.service.ts";

export const tagRoutes = new Hono<AppEnv>();

tagRoutes.use("*", requireVerifiedEmail());
tagRoutes.use("*", requireFinanceParticipant());

/** GET / — without `q`: the most-used tags (the create flow's suggestions). With `q`: a prefix match. */
tagRoutes.get("/", zValidator("query", TagQuerySchema, onValidationError), async (c) => {
  const household = requireHouseholdContext(c);
  const query = c.req.valid("query");
  const payload: TagListResponse = { items: await listTags(db, household.householdId, query.q, query.limit) };
  return json(c, payload);
});

/** PATCH /:tagId — rename. */
tagRoutes.patch("/:tagId", zValidator("json", UpdateTagRequestSchema, onValidationError), async (c) => {
  const household = requireHouseholdContext(c);
  const tag = await updateTag(db, household.householdId, c.req.param("tagId"), c.req.valid("json").name);
  return json(c, tag);
});

/** DELETE /:tagId — drops the tag and its links; transactions themselves are untouched. */
tagRoutes.delete("/:tagId", async (c) => {
  const household = requireHouseholdContext(c);
  await deleteTag(db, household.householdId, c.req.param("tagId"));
  return noContent(c);
});

export default tagRoutes;
