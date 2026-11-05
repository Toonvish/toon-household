/**
 * Mounted at /api/households/:householdId/finance/tags (see src/index.ts). Reads +
 * rename + delete only — there is no `POST /tags` (docs/spec.md §3.10): a tag
 * is created solely as a side effect of attaching it to a transaction.
 */
import { type FinanceTagListResponse as TagListResponse, FinanceUpdateTagRequestSchema as UpdateTagRequestSchema, TagQuerySchema } from "@toon/shared";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { UNINTERRUPTIBLE } from "../../../http/middleware.ts";
import { jsonBody, queryParams } from "../../../http/request.ts";
import { json, noContent } from "../../../http/response.ts";
import { CurrentFinanceParticipant } from "../http.ts";
import { FinanceTags } from "../services/tags/tags.service.ts";
import { FinanceTagsApi } from "./tags.api.ts";

export const financeTagsHandlers = HttpApiBuilder.group(FinanceTagsApi, "finance.tags", (handlers) =>
  handlers
    /** GET / — without `q`: the most-used tags (the create flow's suggestions). With `q`: a prefix match. */
    .handle(
      "get",
      Effect.fn("finance.tags.get")(function* () {
        const query = yield* queryParams(TagQuerySchema);
        const tagsService = yield* FinanceTags;
        const household = yield* CurrentFinanceParticipant;
        const payload: TagListResponse = { items: yield* tagsService.listTags(household.householdId, query.q, query.limit) };
        return json(payload);
      }),
      UNINTERRUPTIBLE,
    )
    /** PATCH /:tagId — rename. */
    .handle(
      "patchByTagId",
      Effect.fn("finance.tags.patchByTagId")(function* ({ params }) {
        const body = yield* jsonBody(UpdateTagRequestSchema);
        const tagsService = yield* FinanceTags;
        const household = yield* CurrentFinanceParticipant;
        const tag = yield* tagsService.updateTag(household.householdId, params.tagId, body.name);
        return json(tag);
      }),
      UNINTERRUPTIBLE,
    )
    /** DELETE /:tagId — drops the tag and its links; transactions themselves are untouched. */
    .handle(
      "deleteByTagId",
      Effect.fn("finance.tags.deleteByTagId")(function* ({ params }) {
        const tagsService = yield* FinanceTags;
        const household = yield* CurrentFinanceParticipant;
        yield* tagsService.deleteTag(household.householdId, params.tagId);
        return noContent();
      }),
      UNINTERRUPTIBLE,
    ),
);
