/**
 * Mounted at /api/households/:householdId/finance/tags (see src/index.ts). Reads +
 * rename + delete only — there is no `POST /tags` (docs/spec.md §3.10): a tag
 * is created solely as a side effect of attaching it to a transaction.
 */
import { Effect } from "effect";
import { runtime } from "../../../runtime.ts";
import { type FinanceTagListResponse as TagListResponse, FinanceUpdateTagRequestSchema as UpdateTagRequestSchema, TagQuerySchema } from "@toon/shared";
import { Hono } from "hono";
import { json, noContent } from "../../../lib/http.ts";
import type { AppEnv } from "../../../lib/types.ts";
import { requireFinanceParticipant, currentFinanceParticipant } from "../middleware.ts";
import { validate } from "../../../lib/validate.ts";
import { requireVerifiedEmail } from "../../../middleware/verifiedEmail.ts";
import { FinanceTags } from "../services/tags/tags.service.ts";

export const tagRoutes = new Hono<AppEnv>();

tagRoutes.use("*", requireVerifiedEmail());
tagRoutes.use("*", requireFinanceParticipant());

/** GET / — without `q`: the most-used tags (the create flow's suggestions). With `q`: a prefix match. */
tagRoutes.get("/", validate("query", TagQuerySchema), (c) =>
runtime.runPromise(
Effect.gen(function* () {
  const tagsService = yield* FinanceTags;
  const household = yield* currentFinanceParticipant(c);
  const query = c.req.valid("query");
  const payload: TagListResponse = { items: yield* tagsService.listTags(household.householdId, query.q, query.limit) };
  return json(c, payload);
}),
),
);

/** PATCH /:tagId — rename. */
tagRoutes.patch("/:tagId", validate("json", UpdateTagRequestSchema), (c) =>
runtime.runPromise(
Effect.gen(function* () {
  const tagsService = yield* FinanceTags;
  const household = yield* currentFinanceParticipant(c);
  const tag = yield* tagsService.updateTag(household.householdId, c.req.param("tagId"), c.req.valid("json").name);
  return json(c, tag);
}),
),
);

/** DELETE /:tagId — drops the tag and its links; transactions themselves are untouched. */
tagRoutes.delete("/:tagId", (c) =>
runtime.runPromise(
Effect.gen(function* () {
  const tagsService = yield* FinanceTags;
  const household = yield* currentFinanceParticipant(c);
  yield* tagsService.deleteTag(household.householdId, c.req.param("tagId"));
  return noContent(c);
}),
),
);

export default tagRoutes;
