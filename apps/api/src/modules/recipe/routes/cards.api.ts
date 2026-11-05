/** Saved cards ("Karten") — the user's own loyalty barcodes; served at /api/recipe/cards (docs/API.md "Saved cards"). */
import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { chain, RequireSession, RequireVerifiedEmail, userModuleApi } from "../../../http/middleware.ts";

export const RecipeCardsGroup = HttpApiGroup.make("recipe.cards")
  .add(
    /** GET /api/recipe/cards */
    HttpApiEndpoint.get("get", "/"),
    /** POST /api/recipe/cards */
    HttpApiEndpoint.post("post", "/"),
    /** PATCH /api/recipe/cards/:cardId */
    HttpApiEndpoint.patch("patchByCardId", "/:cardId", { params: { cardId: Schema.String } }),
    /** DELETE /api/recipe/cards/:cardId */
    HttpApiEndpoint.delete("deleteByCardId", "/:cardId", { params: { cardId: Schema.String } }),
    /** POST /api/recipe/cards/:cardId/used */
    HttpApiEndpoint.post("postByCardIdUsed", "/:cardId/used", { params: { cardId: Schema.String } }),
  )
  .prefix("/cards")
  .pipe(chain(RequireSession, RequireVerifiedEmail));

export const RecipeCardsApi = userModuleApi("recipe", HttpApi.make("recipe.cards").add(RecipeCardsGroup));
