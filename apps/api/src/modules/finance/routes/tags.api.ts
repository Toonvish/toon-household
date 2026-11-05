/** Finance tags (reads, rename and delete only; a tag is created solely as a side effect of attaching it to a transaction); served at /api/households/:householdId/finance/tags (docs/API.md "Finance module"). */
import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { chain, householdModuleApi, RequireVerifiedEmail } from "../../../http/middleware.ts";
import { RequireFinanceParticipant } from "../http.ts";

const params = { householdId: Schema.String };

export const FinanceTagsGroup = HttpApiGroup.make("finance.tags")
  .add(
    /** GET /api/households/:householdId/finance/tags */
    HttpApiEndpoint.get("get", "/", { params }),
    /** PATCH /api/households/:householdId/finance/tags/:tagId */
    HttpApiEndpoint.patch("patchByTagId", "/:tagId", {
      params: { householdId: Schema.String, tagId: Schema.String },
    }),
    /** DELETE /api/households/:householdId/finance/tags/:tagId */
    HttpApiEndpoint.delete("deleteByTagId", "/:tagId", {
      params: { householdId: Schema.String, tagId: Schema.String },
    }),
  )
  .prefix("/tags")
  .pipe(chain(RequireVerifiedEmail, RequireFinanceParticipant));

export const FinanceTagsApi = householdModuleApi("finance", HttpApi.make("finance.tags").add(FinanceTagsGroup));
