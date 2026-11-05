/** OWNER: import/OCR agent; served at /api/households/:householdId/recipe/imports (docs/API.md "Imports"). */
import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { chain, householdModuleApi, RequireVerifiedEmail } from "../../../http/middleware.ts";

export const RecipeImportsGroup = HttpApiGroup.make("recipe.imports")
  .add(
    /** POST /api/households/:householdId/recipe/imports/url */
    HttpApiEndpoint.post("postUrl", "/url", { params: { householdId: Schema.String } }),
    /** POST /api/households/:householdId/recipe/imports/image — multipart `file`, image/* only. */
    HttpApiEndpoint.post("postImage", "/image", { params: { householdId: Schema.String } }),
    /** POST /api/households/:householdId/recipe/imports/pdf — multipart `file`, application/pdf only. */
    HttpApiEndpoint.post("postPdf", "/pdf", { params: { householdId: Schema.String } }),
    /** POST /api/households/:householdId/recipe/imports/file — one input for photos and PDFs; the kind is sniffed. */
    HttpApiEndpoint.post("postFile", "/file", { params: { householdId: Schema.String } }),
    /** POST /api/households/:householdId/recipe/imports/text */
    HttpApiEndpoint.post("postText", "/text", { params: { householdId: Schema.String } }),
    /** GET /api/households/:householdId/recipe/imports?status=pending */
    HttpApiEndpoint.get("get", "/", { params: { householdId: Schema.String } }),
    /** GET /api/households/:householdId/recipe/imports/:draftId */
    HttpApiEndpoint.get("getByDraftId", "/:draftId", {
      params: { householdId: Schema.String, draftId: Schema.String },
    }),
    /** GET /api/households/:householdId/recipe/imports/:draftId/source — the uploaded photo/PDF this draft came from. */
    HttpApiEndpoint.get("getByDraftIdSource", "/:draftId/source", {
      params: { householdId: Schema.String, draftId: Schema.String },
    }),
    /** PATCH /api/households/:householdId/recipe/imports/:draftId */
    HttpApiEndpoint.patch("patchByDraftId", "/:draftId", {
      params: { householdId: Schema.String, draftId: Schema.String },
    }),
    /** POST /api/households/:householdId/recipe/imports/:draftId/commit */
    HttpApiEndpoint.post("postByDraftIdCommit", "/:draftId/commit", {
      params: { householdId: Schema.String, draftId: Schema.String },
    }),
    /** DELETE /api/households/:householdId/recipe/imports/:draftId */
    HttpApiEndpoint.delete("deleteByDraftId", "/:draftId", {
      params: { householdId: Schema.String, draftId: Schema.String },
    }),
  )
  .prefix("/imports")
  // Importing is the loudest write in the app — it fetches, OCRs and then creates
  // rows — so an account whose address was never confirmed gets 403
  // `email_unverified` on every non-GET here (drafts stay READABLE). This is the
  // anti-spam gate, not a capability: see services/auth/verifiedEmail.ts.
  .pipe(chain(RequireVerifiedEmail));

export const RecipeImportsApi = householdModuleApi("recipe", HttpApi.make("recipe.imports").add(RecipeImportsGroup));
