/**
 * Shopping lists ("Einkaufslisten").
 *
 * Mounted at /api/households/:householdId/recipe/shopping-lists (see modules/recipe/routes/index.ts), BEFORE the
 * catch-all recipes router — same reason imports is mounted before it.
 *
 * **`GET /bought` is registered BEFORE `GET /:listId`** — the pre-E7 Hono
 * router matched in registration order, so a static `/bought` declared after the dynamic
 * `/:listId` would be read as a request for the list whose id is the literal
 * string "bought". Same trap as `/invites/:token` before `/:householdId` in
 * core/routes/households.ts.
 *
 * Auth: the module chain (modules/mount.ts) runs `requireSession()` + `requireHouseholdRole("member")` +
 * `requireModule("recipe")` as router-level middleware, so no handler checks membership itself.
 * This router adds `requireVerifiedEmail()` on top. The household comes from `:householdId`,
 * which every path here carries. Deleting a whole list additionally
 * requires creator-or-admin, enforced in the service.
 *
 * ## Every mutation answers with the WHOLE list
 *
 * Not with the changed item. The web client replaces its cache entry with the payload
 * instead of patching it, which is what keeps an optimistic offline edit from drifting
 * away from the server — and merging means one added line can change a different one.
 *
 * Endpoint contract: docs/API.md ("Shopping lists").
 */
import { Clock, Effect, Option } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import {
  AddRecipeToShoppingListRequestSchema,
  AddShoppingItemsRequestSchema,
  CheckShoppingItemRequestSchema,
  CreateShoppingListRequestSchema,
  IsoDateSchema,
  MealPlanRangeQuerySchema,
  ShoppingBoughtListQuerySchema,
  ShoppingCatalogListQuerySchema,
  UpdateShoppingCatalogEntryRequestSchema,
  UpdateShoppingItemRequestSchema,
  UpdateShoppingListRequestSchema,
} from "@toon/shared";
import { CurrentMembership, CurrentUser } from "../../../http/context.ts";
import { UNINTERRUPTIBLE } from "../../../http/middleware.ts";
import { jsonBody, queryParam, queryParams } from "../../../http/request.ts";
import { created, json, noContent } from "../../../http/response.ts";
import { decodeOption } from "../../../lib/validate.ts";
import { ShoppingBought } from "../services/shopping/bought.service.ts";
import { ShoppingFromPlan } from "../services/shopping/fromPlan.service.ts";
import { ShoppingItems } from "../services/shopping/items.service.ts";
import { ShoppingLists } from "../services/shopping/lists.service.ts";
import { RecipeShoppingApi } from "./shopping.api.ts";

/**
 * `?since=<ISO>` on the list index (A03 § 2.1): the client's calendar-day
 * boundary, sent as an INSTANT — the server never derives a day from it, only
 * compares. A bad or missing value must not blank the whole overview screen, so
 * this IGNORES a parse failure rather than 422ing (unlike the `from`/`to` on
 * `from-plan`, which is a screen's own deliberate request). Clamped to
 * `[now - 7d, now]` so a wrong device clock cannot produce a nonsense count.
 */
function parseSinceQuery(raw: string | undefined, now: number): number | undefined {
  if (!raw) return undefined;
  const parsed = decodeOption(IsoDateSchema, raw);
  if (Option.isNone(parsed)) return undefined;
  const value = Date.parse(parsed.value);
  if (Number.isNaN(value)) return undefined;
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  return Math.min(Math.max(value, now - sevenDaysMs), now);
}

export const shoppingHandlers = HttpApiBuilder.group(RecipeShoppingApi, "recipe.shopping", (handlers) =>
  handlers
    /* -------------------------------------------------------------------------- */
    /* lists                                                                      */
    /* -------------------------------------------------------------------------- */

    /**
     * GET /?since — all lists of the household with their open-item counts plus the
     * overview-card extras: `boughtCount`, `boughtClearedAt`, `previewItems`.
     */
    .handle(
      "get",
      Effect.fn("recipe.shopping.get")(function* () {
        const listService = yield* ShoppingLists;
        const membership = yield* CurrentMembership;
        const since = parseSinceQuery(yield* queryParam("since"), yield* Clock.currentTimeMillis);
        return json({ items: yield* listService.listShoppingLists(membership.householdId, since) });
      }),
      UNINTERRUPTIBLE,
    )

    /**
     * GET /bought — the household-wide "Bought today" / history feed (A03 § 2.2c).
     * Registered BEFORE `GET /:listId` — see the file header. The watermark is
     * IGNORED here on purpose: `Clear bought` only moves what a list's own DETAIL
     * section shows, never what this archive answers.
     */
    .handle(
      "getBought",
      Effect.fn("recipe.shopping.getBought")(function* () {
        const query = yield* queryParams(ShoppingBoughtListQuerySchema);
        const boughtService = yield* ShoppingBought;
        const membership = yield* CurrentMembership;
        const { listId, limit, offset } = query;
        return json(yield* boughtService.listBoughtItems(membership.householdId, { listId, limit, offset }));
      }),
      UNINTERRUPTIBLE,
    )

    /** POST / — create a named list. */
    .handle(
      "post",
      Effect.fn("recipe.shopping.post")(function* () {
        const body = yield* jsonBody(CreateShoppingListRequestSchema);
        const listService = yield* ShoppingLists;
        const membership = yield* CurrentMembership;
        const user = yield* CurrentUser;
        const list = yield* listService.createShoppingList(
          membership.householdId,
          user.id,
          body,
        );
        return created(
          { list },
          `/api/households/${membership.householdId}/recipe/shopping-lists/${list.id}`,
        );
      }),
      UNINTERRUPTIBLE,
    )

    /** GET /:listId — list + open items + "Häufig gekauft" suggestions. */
    .handle(
      "getByListId",
      Effect.fn("recipe.shopping.getByListId")(function* ({ params }) {
        const listService = yield* ShoppingLists;
        const membership = yield* CurrentMembership;
        return json(yield* listService.getShoppingListDetail(membership.householdId, params.listId));
      }),
      UNINTERRUPTIBLE,
    )

    /** PATCH /:listId — rename. Any member: the list is shared property. */
    .handle(
      "patchByListId",
      Effect.fn("recipe.shopping.patchByListId")(function* ({ params }) {
        const body = yield* jsonBody(UpdateShoppingListRequestSchema);
        const listService = yield* ShoppingLists;
        const membership = yield* CurrentMembership;
        const list = yield* listService.updateShoppingList(
          membership.householdId,
          params.listId,
          body,
        );
        return json({ list });
      }),
      UNINTERRUPTIBLE,
    )

    /** DELETE /:listId — creator or admin+; items, catalog and ledger cascade. */
    .handle(
      "deleteByListId",
      Effect.fn("recipe.shopping.deleteByListId")(function* ({ params }) {
        const listService = yield* ShoppingLists;
        const membership = yield* CurrentMembership;
        yield* listService.deleteShoppingList(membership, params.listId);
        return noContent();
      }),
      UNINTERRUPTIBLE,
    )

    /* -------------------------------------------------------------------------- */
    /* items                                                                      */
    /* -------------------------------------------------------------------------- */

    /**
     * POST /:listId/items — add hand-entered lines. Merges into existing lines by name +
     * unit, so posting "200 g Mehl" onto a list that already has 200 g yields one 400 g
     * line. Pass `mutationId` to make an offline replay safe.
     */
    .handle(
      "postByListIdItems",
      Effect.fn("recipe.shopping.postByListIdItems")(function* ({ params }) {
        const body = yield* jsonBody(AddShoppingItemsRequestSchema);
        const itemService = yield* ShoppingItems;
        const membership = yield* CurrentMembership;
        return json(
          yield* itemService.addShoppingItems(
            membership.householdId,
            params.listId,
            body,
          ),
        );
      }),
      UNINTERRUPTIBLE,
    )

    /** DELETE /:listId/items — empty the list. Nothing counts as bought. */
    .handle(
      "deleteByListIdItems",
      Effect.fn("recipe.shopping.deleteByListIdItems")(function* ({ params }) {
        const itemService = yield* ShoppingItems;
        const membership = yield* CurrentMembership;
        return json(yield* itemService.clearShoppingList(membership.householdId, params.listId));
      }),
      UNINTERRUPTIBLE,
    )

    /** PATCH /:listId/items/:itemId — edit amount/unit/name/note. */
    .handle(
      "patchByListIdItemsByItemId",
      Effect.fn("recipe.shopping.patchByListIdItemsByItemId")(function* ({ params }) {
        const body = yield* jsonBody(UpdateShoppingItemRequestSchema);
        const itemService = yield* ShoppingItems;
        const membership = yield* CurrentMembership;
        return json(
          yield* itemService.updateShoppingItem(
            membership.householdId,
            params.listId,
            params.itemId,
            body,
          ),
        );
      }),
      UNINTERRUPTIBLE,
    )

    /** DELETE /:listId/items/:itemId — remove without counting it as bought. Idempotent. */
    .handle(
      "deleteByListIdItemsByItemId",
      Effect.fn("recipe.shopping.deleteByListIdItemsByItemId")(function* ({ params }) {
        const itemService = yield* ShoppingItems;
        const membership = yield* CurrentMembership;
        return json(
          yield* itemService.deleteShoppingItem(
            membership.householdId,
            params.listId,
            params.itemId,
          ),
        );
      }),
      UNINTERRUPTIBLE,
    )

    /**
     * POST /:listId/items/:itemId/check — check off.
     *
     * The item leaves the list, its "Häufig gekauft" entry is bumped, and one row is
     * appended to the bought log (`items.service.ts#checkShoppingItem`) — the checking
     * user's id is recorded on that log row. Idempotent by construction (a checked
     * item is gone), so a replay is harmless even without a `mutationId`. The body is
     * optional so the client can send `{}`.
     */
    .handle(
      "postByListIdItemsByItemIdCheck",
      Effect.fn("recipe.shopping.postByListIdItemsByItemIdCheck")(function* ({ params }) {
        const body = yield* jsonBody(CheckShoppingItemRequestSchema);
        const itemService = yield* ShoppingItems;
        const membership = yield* CurrentMembership;
        const user = yield* CurrentUser;
        return json(
          yield* itemService.checkShoppingItem(
            membership.householdId,
            params.listId,
            params.itemId,
            user.id,
            body?.mutationId,
          ),
        );
      }),
      UNINTERRUPTIBLE,
    )

    /* -------------------------------------------------------------------------- */
    /* "Bought today" + history                                                   */
    /* -------------------------------------------------------------------------- */

    /**
     * POST /:listId/bought/clear — moves the `Clear bought` watermark to now.
     * The log itself is untouched (S1) — `GET /bought` still returns every row.
     * Idempotent, so no `mutationId`: "set the watermark to now" cannot disagree
     * with itself, the same reasoning `DELETE /:listId/items` uses for "alles löschen".
     */
    .handle(
      "postByListIdBoughtClear",
      Effect.fn("recipe.shopping.postByListIdBoughtClear")(function* ({ params }) {
        const boughtService = yield* ShoppingBought;
        const membership = yield* CurrentMembership;
        return json(yield* boughtService.clearBoughtSection(membership.householdId, params.listId));
      }),
      UNINTERRUPTIBLE,
    )

    /**
     * POST /:listId/bought/:boughtId/undo — "Zurück auf die Liste".
     *
     * Deletes the log row and re-adds its amount through the SAME merge every other
     * add goes through, so it folds into whatever is on the list now rather than
     * creating a second line. `use_count` is decremented, floored at 0. Idempotent:
     * an unknown/already-undone id is a 200 no-op.
     */
    .handle(
      "postByListIdBoughtByBoughtIdUndo",
      Effect.fn("recipe.shopping.postByListIdBoughtByBoughtIdUndo")(function* ({ params }) {
        const body = yield* jsonBody(CheckShoppingItemRequestSchema);
        const boughtService = yield* ShoppingBought;
        const membership = yield* CurrentMembership;
        return json(
          yield* boughtService.undoBoughtItem(
            membership.householdId,
            params.listId,
            params.boughtId,
            body?.mutationId,
          ),
        );
      }),
      UNINTERRUPTIBLE,
    )

    /* -------------------------------------------------------------------------- */
    /* recipes -> list                                                            */
    /* -------------------------------------------------------------------------- */

    /**
     * POST /:listId/recipes — put a recipe on the list, scaled to `servings`.
     *
     * Scaling uses the same `scaleIngredients` as the recipe screen, so the amounts match
     * what the cook saw. Omit `servings` to take the recipe's own portion count.
     * Also upserts the "Recipes on this list" rail row (`recipe_shopping_list_recipes`) —
     * re-adding at a different portion count is the newest intent.
     */
    .handle(
      "postByListIdRecipes",
      Effect.fn("recipe.shopping.postByListIdRecipes")(function* ({ params }) {
        const body = yield* jsonBody(AddRecipeToShoppingListRequestSchema);
        const itemService = yield* ShoppingItems;
        const membership = yield* CurrentMembership;
        const user = yield* CurrentUser;
        return json(
          yield* itemService.addRecipeToShoppingList(
            membership.householdId,
            params.listId,
            user.id,
            body,
          ),
        );
      }),
      UNINTERRUPTIBLE,
    )

    /**
     * DELETE /:listId/recipes/:recipeId — removes the recipe from the rail.
     *
     * Deletes lines whose ENTIRE provenance was this recipe; a shared line keeps its
     * quantity UNCHANGED (A03 § 4.3 — the merge is not reversible). Online-only: the
     * web client does not queue this in the offline outbox (a bulk delete replayed
     * hours later against a list the user can no longer see is exactly the class
     * `persist.ts` excludes). Idempotent: an unknown recipe id is a 200 no-op.
     */
    .handle(
      "deleteByListIdRecipesByRecipeId",
      Effect.fn("recipe.shopping.deleteByListIdRecipesByRecipeId")(function* ({ params }) {
        const itemService = yield* ShoppingItems;
        const membership = yield* CurrentMembership;
        return json(
          yield* itemService.removeRecipeFromList(
            membership.householdId,
            params.listId,
            params.recipeId,
          ),
        );
      }),
      UNINTERRUPTIBLE,
    )

    /**
     * GET /:listId/from-plan?from&to — "From this week's plan" (SPEC § 4.5 / A03 § 5).
     * Both bounds REQUIRED (R21): the server must not guess where a week starts. An
     * invalid or inverted range is 422 via the shared `MealPlanRangeQuerySchema` — the
     * same schema `GET /plan` validates against, since the range rules (`from <= to`,
     * under `PLAN_LIMITS.rangeDays`) are identical.
     */
    .handle(
      "getByListIdFromPlan",
      Effect.fn("recipe.shopping.getByListIdFromPlan")(function* ({ params }) {
        const query = yield* queryParams(MealPlanRangeQuerySchema);
        const fromPlanService = yield* ShoppingFromPlan;
        const membership = yield* CurrentMembership;
        const { from, to } = query;
        return json(yield* fromPlanService.planShoppingPreview(membership.householdId, params.listId, { from, to }));
      }),
      UNINTERRUPTIBLE,
    )

    /* -------------------------------------------------------------------------- */
    /* "Häufig gekauft"                                                           */
    /* -------------------------------------------------------------------------- */

    /**
     * GET /:listId/catalog?includeHidden&limit&offset — the "Show all" sheet's unhide
     * surface (R20). The detail payload's own `catalog` already covers the common,
     * offline-capable path; this is reached only from the "Ausgeblendete anzeigen"
     * toggle on that sheet, is online-only and is never persisted.
     */
    .handle(
      "getByListIdCatalog",
      Effect.fn("recipe.shopping.getByListIdCatalog")(function* ({ params }) {
        const query = yield* queryParams(ShoppingCatalogListQuerySchema);
        const itemService = yield* ShoppingItems;
        const membership = yield* CurrentMembership;
        const { includeHidden, limit, offset } = query;
        return json(
          yield* itemService.listShoppingCatalog(membership.householdId, params.listId, {
            includeHidden: includeHidden ?? false,
            limit,
            offset,
          }),
        );
      }),
      UNINTERRUPTIBLE,
    )

    /**
     * PATCH /:listId/catalog/:entryId — hide/unhide a suggestion WITHOUT losing its
     * `useCount` (SPEC § 4.6). Replaces the redesigned UI's per-chip `×`; the older
     * `DELETE` below is kept (a wire contract is never renamed) but the new UI no
     * longer calls it, because deleting throws the count away.
     */
    .handle(
      "patchByListIdCatalogByEntryId",
      Effect.fn("recipe.shopping.patchByListIdCatalogByEntryId")(function* ({ params }) {
        const body = yield* jsonBody(UpdateShoppingCatalogEntryRequestSchema);
        const itemService = yield* ShoppingItems;
        const membership = yield* CurrentMembership;
        return json(
          yield* itemService.setCatalogEntryHidden(
            membership.householdId,
            params.listId,
            params.entryId,
            body.hidden,
          ),
        );
      }),
      UNINTERRUPTIBLE,
    )

    /** POST /:listId/catalog/:entryId — re-add a suggestion, without an amount. */
    .handle(
      "postByListIdCatalogByEntryId",
      Effect.fn("recipe.shopping.postByListIdCatalogByEntryId")(function* ({ params }) {
        const body = yield* jsonBody(CheckShoppingItemRequestSchema);
        const itemService = yield* ShoppingItems;
        const membership = yield* CurrentMembership;
        return json(
          yield* itemService.addCatalogEntryToList(
            membership.householdId,
            params.listId,
            params.entryId,
            body?.mutationId,
          ),
        );
      }),
      UNINTERRUPTIBLE,
    )

    /** DELETE /:listId/catalog/:entryId — "nicht mehr vorschlagen". Idempotent. */
    .handle(
      "deleteByListIdCatalogByEntryId",
      Effect.fn("recipe.shopping.deleteByListIdCatalogByEntryId")(function* ({ params }) {
        const itemService = yield* ShoppingItems;
        const membership = yield* CurrentMembership;
        yield* itemService.deleteCatalogEntry(
          membership.householdId,
          params.listId,
          params.entryId,
        );
        return noContent();
      }),
      UNINTERRUPTIBLE,
    ),
);
