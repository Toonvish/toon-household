/**
 * Shopping lists ("Einkaufslisten").
 *
 * Mounted at /api/households/:householdId/recipe/shopping-lists (see modules/recipe/routes/index.ts), BEFORE the
 * catch-all recipes router — same reason imports is mounted before it.
 *
 * **`GET /bought` is registered BEFORE `GET /:listId`** — Hono matches in
 * registration order, so a static `/bought` declared after the dynamic
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
import { Effect, Option } from "effect";
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
import { Hono } from "hono";
import { created, json, noContent } from "../../../lib/http.ts";
import type { AppEnv } from "../../../lib/types.ts";
import { currentMembership, currentUser } from "../../../lib/types.ts";
import { requireVerifiedEmail } from "../../../middleware/verifiedEmail.ts";
import { decodeOption, validate } from "../../../lib/validate.ts";
import { runtime } from "../../../runtime.ts";
import { ShoppingBought } from "../services/shopping/bought.service.ts";
import { ShoppingFromPlan } from "../services/shopping/fromPlan.service.ts";
import { ShoppingItems } from "../services/shopping/items.service.ts";
import { ShoppingLists } from "../services/shopping/lists.service.ts";

/**
 * `?since=<ISO>` on the list index (A03 § 2.1): the client's calendar-day
 * boundary, sent as an INSTANT — the server never derives a day from it, only
 * compares. A bad or missing value must not blank the whole overview screen, so
 * this IGNORES a parse failure rather than 422ing (unlike the `from`/`to` on
 * `from-plan`, which is a screen's own deliberate request). Clamped to
 * `[now - 7d, now]` so a wrong device clock cannot produce a nonsense count.
 */
function parseSinceQuery(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const parsed = decodeOption(IsoDateSchema, raw);
  if (Option.isNone(parsed)) return undefined;
  const value = Date.parse(parsed.value);
  if (Number.isNaN(value)) return undefined;
  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  return Math.min(Math.max(value, now - sevenDaysMs), now);
}

export const shoppingRoutes = new Hono<AppEnv>();

// Writes need a confirmed address (middleware/verifiedEmail.ts). Note what
// this does to the offline outbox: a queued mutation replayed by an unconfirmed
// account gets a 403, which `networkMode: "offlineFirst"` treats as a real
// failure rather than a pause — correct, since retrying cannot help until the
// address is confirmed. The web client keeps such an account out of the outbox
// in the first place by disabling the write UI.
shoppingRoutes.use("*", requireVerifiedEmail());

/* -------------------------------------------------------------------------- */
/* lists                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * GET /?since — all lists of the household with their open-item counts plus the
 * overview-card extras: `boughtCount`, `boughtClearedAt`, `previewItems`.
 */
shoppingRoutes.get("/", (c) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const listService = yield* ShoppingLists;
      const membership = yield* currentMembership(c);
      const since = parseSinceQuery(c.req.query("since"));
      return json(c, { items: yield* listService.listShoppingLists(membership.householdId, since) });
    }),
  ),
);

/**
 * GET /bought — the household-wide "Bought today" / history feed (A03 § 2.2c).
 * Registered BEFORE `GET /:listId` — see the file header. The watermark is
 * IGNORED here on purpose: `Clear bought` only moves what a list's own DETAIL
 * section shows, never what this archive answers.
 */
shoppingRoutes.get("/bought", validate("query", ShoppingBoughtListQuerySchema), (c) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const boughtService = yield* ShoppingBought;
      const membership = yield* currentMembership(c);
      const { listId, limit, offset } = c.req.valid("query");
      return json(
        c,
        yield* boughtService.listBoughtItems(membership.householdId, { listId, limit, offset }),
      );
    }),
  ),
);

/** POST / — create a named list. */
shoppingRoutes.post("/", validate("json", CreateShoppingListRequestSchema), (c) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const listService = yield* ShoppingLists;
      const membership = yield* currentMembership(c);
      const user = yield* currentUser(c);
      const list = yield* listService.createShoppingList(
        membership.householdId,
        user.id,
        c.req.valid("json"),
      );
      return created(
        c,
        { list },
        `/api/households/${membership.householdId}/recipe/shopping-lists/${list.id}`,
      );
    }),
  ),
);

/** GET /:listId — list + open items + "Häufig gekauft" suggestions. */
shoppingRoutes.get("/:listId", (c) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const listService = yield* ShoppingLists;
      const membership = yield* currentMembership(c);
      return json(
        c,
        yield* listService.getShoppingListDetail(membership.householdId, c.req.param("listId")),
      );
    }),
  ),
);

/** PATCH /:listId — rename. Any member: the list is shared property. */
shoppingRoutes.patch("/:listId", validate("json", UpdateShoppingListRequestSchema), (c) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const listService = yield* ShoppingLists;
      const membership = yield* currentMembership(c);
      const list = yield* listService.updateShoppingList(
        membership.householdId,
        c.req.param("listId"),
        c.req.valid("json"),
      );
      return json(c, { list });
    }),
  ),
);

/** DELETE /:listId — creator or admin+; items, catalog and ledger cascade. */
shoppingRoutes.delete("/:listId", (c) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const listService = yield* ShoppingLists;
      const membership = yield* currentMembership(c);
      yield* listService.deleteShoppingList(membership, c.req.param("listId"));
      return noContent(c);
    }),
  ),
);

/* -------------------------------------------------------------------------- */
/* items                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * POST /:listId/items — add hand-entered lines. Merges into existing lines by name +
 * unit, so posting "200 g Mehl" onto a list that already has 200 g yields one 400 g
 * line. Pass `mutationId` to make an offline replay safe.
 */
shoppingRoutes.post("/:listId/items", validate("json", AddShoppingItemsRequestSchema), (c) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const itemService = yield* ShoppingItems;
      const membership = yield* currentMembership(c);
      return json(
        c,
        yield* itemService.addShoppingItems(
          membership.householdId,
          c.req.param("listId"),
          c.req.valid("json"),
        ),
      );
    }),
  ),
);

/** DELETE /:listId/items — empty the list. Nothing counts as bought. */
shoppingRoutes.delete("/:listId/items", (c) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const itemService = yield* ShoppingItems;
      const membership = yield* currentMembership(c);
      return json(c, yield* itemService.clearShoppingList(membership.householdId, c.req.param("listId")));
    }),
  ),
);

/** PATCH /:listId/items/:itemId — edit amount/unit/name/note. */
shoppingRoutes.patch("/:listId/items/:itemId", validate("json", UpdateShoppingItemRequestSchema), (c) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const itemService = yield* ShoppingItems;
      const membership = yield* currentMembership(c);
      return json(
        c,
        yield* itemService.updateShoppingItem(
          membership.householdId,
          c.req.param("listId"),
          c.req.param("itemId"),
          c.req.valid("json"),
        ),
      );
    }),
  ),
);

/** DELETE /:listId/items/:itemId — remove without counting it as bought. Idempotent. */
shoppingRoutes.delete("/:listId/items/:itemId", (c) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const itemService = yield* ShoppingItems;
      const membership = yield* currentMembership(c);
      return json(
        c,
        yield* itemService.deleteShoppingItem(
          membership.householdId,
          c.req.param("listId"),
          c.req.param("itemId"),
        ),
      );
    }),
  ),
);

/**
 * POST /:listId/items/:itemId/check — check off.
 *
 * The item leaves the list, its "Häufig gekauft" entry is bumped, and one row is
 * appended to the bought log (`items.service.ts#checkShoppingItem`) — the checking
 * user's id is recorded on that log row. Idempotent by construction (a checked
 * item is gone), so a replay is harmless even without a `mutationId`. The body is
 * optional so the client can send `{}`.
 */
shoppingRoutes.post("/:listId/items/:itemId/check", validate("json", CheckShoppingItemRequestSchema), (c) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const itemService = yield* ShoppingItems;
      const membership = yield* currentMembership(c);
      const user = yield* currentUser(c);
      return json(
        c,
        yield* itemService.checkShoppingItem(
          membership.householdId,
          c.req.param("listId"),
          c.req.param("itemId"),
          user.id,
          c.req.valid("json")?.mutationId,
        ),
      );
    }),
  ),
);

/* -------------------------------------------------------------------------- */
/* "Bought today" + history                                                   */
/* -------------------------------------------------------------------------- */

/**
 * POST /:listId/bought/clear — moves the `Clear bought` watermark to now.
 * The log itself is untouched (S1) — `GET /bought` still returns every row.
 * Idempotent, so no `mutationId`: "set the watermark to now" cannot disagree
 * with itself, the same reasoning `DELETE /:listId/items` uses for "alles löschen".
 */
shoppingRoutes.post("/:listId/bought/clear", (c) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const boughtService = yield* ShoppingBought;
      const membership = yield* currentMembership(c);
      return json(c, yield* boughtService.clearBoughtSection(membership.householdId, c.req.param("listId")));
    }),
  ),
);

/**
 * POST /:listId/bought/:boughtId/undo — "Zurück auf die Liste".
 *
 * Deletes the log row and re-adds its amount through the SAME merge every other
 * add goes through, so it folds into whatever is on the list now rather than
 * creating a second line. `use_count` is decremented, floored at 0. Idempotent:
 * an unknown/already-undone id is a 200 no-op.
 */
shoppingRoutes.post("/:listId/bought/:boughtId/undo", validate("json", CheckShoppingItemRequestSchema), (c) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const boughtService = yield* ShoppingBought;
      const membership = yield* currentMembership(c);
      return json(
        c,
        yield* boughtService.undoBoughtItem(
          membership.householdId,
          c.req.param("listId"),
          c.req.param("boughtId"),
          c.req.valid("json")?.mutationId,
        ),
      );
    }),
  ),
);

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
shoppingRoutes.post("/:listId/recipes", validate("json", AddRecipeToShoppingListRequestSchema), (c) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const itemService = yield* ShoppingItems;
      const membership = yield* currentMembership(c);
      const user = yield* currentUser(c);
      return json(
        c,
        yield* itemService.addRecipeToShoppingList(
          membership.householdId,
          c.req.param("listId"),
          user.id,
          c.req.valid("json"),
        ),
      );
    }),
  ),
);

/**
 * DELETE /:listId/recipes/:recipeId — removes the recipe from the rail.
 *
 * Deletes lines whose ENTIRE provenance was this recipe; a shared line keeps its
 * quantity UNCHANGED (A03 § 4.3 — the merge is not reversible). Online-only: the
 * web client does not queue this in the offline outbox (a bulk delete replayed
 * hours later against a list the user can no longer see is exactly the class
 * `persist.ts` excludes). Idempotent: an unknown recipe id is a 200 no-op.
 */
shoppingRoutes.delete("/:listId/recipes/:recipeId", (c) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const itemService = yield* ShoppingItems;
      const membership = yield* currentMembership(c);
      return json(
        c,
        yield* itemService.removeRecipeFromList(
          membership.householdId,
          c.req.param("listId"),
          c.req.param("recipeId"),
        ),
      );
    }),
  ),
);

/**
 * GET /:listId/from-plan?from&to — "From this week's plan" (SPEC § 4.5 / A03 § 5).
 * Both bounds REQUIRED (R21): the server must not guess where a week starts. An
 * invalid or inverted range is 422 via the shared `MealPlanRangeQuerySchema` — the
 * same schema `GET /plan` validates against, since the range rules (`from <= to`,
 * under `PLAN_LIMITS.rangeDays`) are identical.
 */
shoppingRoutes.get("/:listId/from-plan", validate("query", MealPlanRangeQuerySchema), (c) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const fromPlanService = yield* ShoppingFromPlan;
      const membership = yield* currentMembership(c);
      const { from, to } = c.req.valid("query");
      return json(
        c,
        yield* fromPlanService.planShoppingPreview(membership.householdId, c.req.param("listId"), { from, to }),
      );
    }),
  ),
);

/* -------------------------------------------------------------------------- */
/* "Häufig gekauft"                                                           */
/* -------------------------------------------------------------------------- */

/**
 * GET /:listId/catalog?includeHidden&limit&offset — the "Show all" sheet's unhide
 * surface (R20). The detail payload's own `catalog` already covers the common,
 * offline-capable path; this is reached only from the "Ausgeblendete anzeigen"
 * toggle on that sheet, is online-only and is never persisted.
 */
shoppingRoutes.get("/:listId/catalog", validate("query", ShoppingCatalogListQuerySchema), (c) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const itemService = yield* ShoppingItems;
      const membership = yield* currentMembership(c);
      const { includeHidden, limit, offset } = c.req.valid("query");
      return json(
        c,
        yield* itemService.listShoppingCatalog(membership.householdId, c.req.param("listId"), {
          includeHidden: includeHidden ?? false,
          limit,
          offset,
        }),
      );
    }),
  ),
);

/**
 * PATCH /:listId/catalog/:entryId — hide/unhide a suggestion WITHOUT losing its
 * `useCount` (SPEC § 4.6). Replaces the redesigned UI's per-chip `×`; the older
 * `DELETE` below is kept (a wire contract is never renamed) but the new UI no
 * longer calls it, because deleting throws the count away.
 */
shoppingRoutes.patch(
  "/:listId/catalog/:entryId",
  validate("json", UpdateShoppingCatalogEntryRequestSchema),
  (c) =>
    runtime.runPromise(
      Effect.gen(function* () {
        const itemService = yield* ShoppingItems;
        const membership = yield* currentMembership(c);
        return json(
          c,
          yield* itemService.setCatalogEntryHidden(
            membership.householdId,
            c.req.param("listId"),
            c.req.param("entryId"),
            c.req.valid("json").hidden,
          ),
        );
      }),
    ),
);

/** POST /:listId/catalog/:entryId — re-add a suggestion, without an amount. */
shoppingRoutes.post("/:listId/catalog/:entryId", validate("json", CheckShoppingItemRequestSchema), (c) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const itemService = yield* ShoppingItems;
      const membership = yield* currentMembership(c);
      return json(
        c,
        yield* itemService.addCatalogEntryToList(
          membership.householdId,
          c.req.param("listId"),
          c.req.param("entryId"),
          c.req.valid("json")?.mutationId,
        ),
      );
    }),
  ),
);

/** DELETE /:listId/catalog/:entryId — "nicht mehr vorschlagen". Idempotent. */
shoppingRoutes.delete("/:listId/catalog/:entryId", (c) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const itemService = yield* ShoppingItems;
      const membership = yield* currentMembership(c);
      yield* itemService.deleteCatalogEntry(
        membership.householdId,
        c.req.param("listId"),
        c.req.param("entryId"),
      );
      return noContent(c);
    }),
  ),
);

export default shoppingRoutes;
