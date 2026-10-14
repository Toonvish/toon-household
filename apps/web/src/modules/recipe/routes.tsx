/**
 * The recipe module's route tree (SPEC D6, §2; plan m2-recipe-module §1 decisions 6, 10, 15),
 * ported from toon-recipe's `apps/web/src/router.tsx` (helpers/params lines 50–95, recipe
 * routes lines 205–350) with every path under the module's base path `/recipe`.
 *
 * Route map (all below `householdScopedRoute`, so an active household is guaranteed):
 *   /recipe                      layout: moduleLayoutComponent("recipe") (RequireModule)
 *     /                          library (index; RECIPE_FILTER_PARAMS)
 *     /search                    redirect -> /recipe (same params; old links keep working)
 *     /recipes/new  /recipes/$recipeId  /recipes/$recipeId/edit
 *     /import  /import/$draftId
 *     /collections  /collections/$collectionId  /tags
 *     /shopping  /shopping/cards  /shopping/history  /shopping/$listId
 *     /plan                      (`week` normalised to its Monday)
 *
 * SCREENS ARE CODE-SPLIT WITH `lazyRouteComponent` (see the header of `router.tsx`): a
 * hand-rolled lazy wrapper hides `.preload` from the router and kills intent preloading.
 * It is also what keeps this file's static import graph clear of the shell (decision 15):
 * the screens import `PhoneHeaderRow` from the layout barrel, which reaches the registry
 * (`@/modules`) — a static screen import here would make the manifest re-enter the
 * registry while it is still evaluating. So: never a static screen import, never an
 * import from the layout components, never the module registry in this file.
 *
 * Export every screen as its module's DEFAULT export.
 */
import { createRoute, lazyRouteComponent, redirect } from "@tanstack/react-router";
import { isPlanDate, startOfPlanWeek, todayPlanDate } from "@toon/shared";
import { moduleLayoutComponent } from "@/modules/layout";
import { householdScopedRoute, pick } from "@/route-roots";
import type { RecipeSearchParams } from "./features/recipes/lib/url-filters";

/* -------------------------------------------------------------------------- */
/* search params                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Filter/search params of the recipe list. `useUrlRecipeFilters`
 * (features/recipes/lib/url-filters.ts) is the single owner of that state, and `pick()`
 * drops anything not listed here — so a new filter needs a line in this array.
 *
 * `/search` declares the SAME keys even though it only redirects: `validateSearch` runs
 * first, so anything missing here would be stripped before the redirect forwards it.
 */
export const RECIPE_FILTER_PARAMS = [
  "q",
  "tags",
  "collectionId",
  "maxMinutes",
  "difficulty",
  "sort",
] as const satisfies readonly (keyof RecipeSearchParams)[];

/** The meal planner's one search param — the Monday of the week on screen. */
const PLAN_SEARCH_PARAMS = ["week"] as const;

/** The bought/history feed's params: an optional list filter and an offset page. */
const SHOPPING_HISTORY_PARAMS = ["listId", "offset"] as const;

/* -------------------------------------------------------------------------- */
/* module layout                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The module's layout route at its base path (SPEC §2 `WebModule.route`). Its component is
 * the module-enabled guard: a household without the recipe module is sent Home with a
 * toast before any recipe chunk loads (SPEC §5).
 */
export const recipeLayoutRoute = createRoute({
  getParentRoute: () => householdScopedRoute,
  path: "/recipe",
  component: moduleLayoutComponent("recipe"),
});

/* -------------------------------------------------------------------------- */
/* recipes                                                                    */
/* -------------------------------------------------------------------------- */

const recipeListRoute = createRoute({
  getParentRoute: () => recipeLayoutRoute,
  path: "/",
  validateSearch: (search: Record<string, unknown>) => pick(search, RECIPE_FILTER_PARAMS),
  component: lazyRouteComponent(() => import("./features/recipes/RecipeListPage")),
});

/**
 * `/recipe/search` is a REDIRECT to `/recipe`, not a screen.
 *
 * Searching moved into the recipe list (always-visible field + "Erweiterte Suche"
 * panel), so a second screen that also listed recipes had no reason to exist. The route
 * stays because `/search?q=…&tags=…` links were shareable and bookmarkable and must keep
 * working — it still declares `RECIPE_FILTER_PARAMS`, because `validateSearch` runs
 * BEFORE the redirect and `pick()` would otherwise drop the very params being forwarded.
 */
const searchRoute = createRoute({
  getParentRoute: () => recipeLayoutRoute,
  path: "search",
  validateSearch: (search: Record<string, unknown>) => pick(search, RECIPE_FILTER_PARAMS),
  beforeLoad: ({ search }): never => {
    throw redirect({ to: "/recipe", search, replace: true });
  },
});

const recipeNewRoute = createRoute({
  getParentRoute: () => recipeLayoutRoute,
  path: "recipes/new",
  component: lazyRouteComponent(() => import("./features/recipes/RecipeNewPage")),
});

const recipeDetailRoute = createRoute({
  getParentRoute: () => recipeLayoutRoute,
  path: "recipes/$recipeId",
  component: lazyRouteComponent(() => import("./features/recipes/RecipeDetailPage")),
});

const recipeEditRoute = createRoute({
  getParentRoute: () => recipeLayoutRoute,
  path: "recipes/$recipeId/edit",
  component: lazyRouteComponent(() => import("./features/recipes/RecipeEditPage")),
});

/* -------------------------------------------------------------------------- */
/* import                                                                     */
/* -------------------------------------------------------------------------- */

const importRoute = createRoute({
  getParentRoute: () => recipeLayoutRoute,
  path: "import",
  component: lazyRouteComponent(() => import("./features/import/ImportPage")),
});

const importReviewRoute = createRoute({
  getParentRoute: () => recipeLayoutRoute,
  path: "import/$draftId",
  component: lazyRouteComponent(() => import("./features/import/ImportReviewPage")),
});

/* -------------------------------------------------------------------------- */
/* organise                                                                   */
/* -------------------------------------------------------------------------- */

const collectionsRoute = createRoute({
  getParentRoute: () => recipeLayoutRoute,
  path: "collections",
  component: lazyRouteComponent(() => import("./features/collections/CollectionsPage")),
});

const collectionDetailRoute = createRoute({
  getParentRoute: () => recipeLayoutRoute,
  path: "collections/$collectionId",
  component: lazyRouteComponent(() => import("./features/collections/CollectionDetailPage")),
});

const tagsRoute = createRoute({
  getParentRoute: () => recipeLayoutRoute,
  path: "tags",
  component: lazyRouteComponent(() => import("./features/tags/TagsPage")),
});

/* -------------------------------------------------------------------------- */
/* shopping                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Shopping lists. `/recipe/shopping/$listId` is the screen used IN a supermarket, so it is
 * household-scoped like the recipe screens and its data is persisted for offline use
 * (the manifest's `persistQueryAllowList`, `./index.ts`).
 */
const shoppingRoute = createRoute({
  getParentRoute: () => recipeLayoutRoute,
  path: "shopping",
  component: lazyRouteComponent(() => import("./features/shopping/ShoppingListsPage")),
});

/**
 * The user's saved loyalty cards. Sits UNDER /recipe/shopping because that is where it is
 * used and reached from (the tab bar is full — see the manifest's `navItems`), but the
 * data is NOT household-scoped: a card belongs to the user (see
 * packages/shared/src/modules/recipe/schemas/card.ts). It is still a child of the module
 * layout so the screen renders inside the same shell as the list it was opened from.
 *
 * Registered BEFORE `shopping/$listId`. TanStack ranks a static segment above a
 * param regardless of order, so this is documentation rather than load-bearing —
 * but reading the file top to bottom, `cards` has to appear as the more specific
 * route or the next person will wonder whether `$listId` swallows it.
 */
const cardsRoute = createRoute({
  getParentRoute: () => recipeLayoutRoute,
  path: "shopping/cards",
  component: lazyRouteComponent(() => import("./features/cards/CardsPage")),
});

/**
 * The cross-list "Bought today" / history feed. `listId` filters to one list
 * (omitted = the whole household), `offset` pages it — both sanitised here rather than
 * trusted raw, since a URL is user input: an unparsable `offset` must not become
 * `NaN` and reach the API as the literal string "NaN".
 */
const shoppingHistoryRoute = createRoute({
  getParentRoute: () => recipeLayoutRoute,
  path: "shopping/history",
  validateSearch: (search: Record<string, unknown>): { listId?: string; offset: number } => {
    const picked = pick(search, SHOPPING_HISTORY_PARAMS);
    const offset = Number.parseInt(picked.offset ?? "", 10);
    return { listId: picked.listId, offset: Number.isNaN(offset) ? 0 : offset };
  },
  component: lazyRouteComponent(() => import("./features/shopping/ShoppingHistoryPage")),
});

const shoppingListRoute = createRoute({
  getParentRoute: () => recipeLayoutRoute,
  path: "shopping/$listId",
  component: lazyRouteComponent(() => import("./features/shopping/ShoppingListDetailPage")),
});

/* -------------------------------------------------------------------------- */
/* plan                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The meal planner. `week` is normalised to the MONDAY of its week here rather
 * than left to the page: a URL is user input, and `?week=2026-02-15` (a Sunday)
 * or a garbage string must not desync the strip from the day cards it renders.
 * Falls back to the current week when the param is missing or unparsable.
 */
const planRoute = createRoute({
  getParentRoute: () => recipeLayoutRoute,
  path: "plan",
  validateSearch: (search: Record<string, unknown>): { week: string } => {
    const raw = pick(search, PLAN_SEARCH_PARAMS).week;
    return { week: startOfPlanWeek(raw !== undefined && isPlanDate(raw) ? raw : todayPlanDate()) };
  },
  component: lazyRouteComponent(() => import("./features/plan/PlanPage")),
});

/* -------------------------------------------------------------------------- */
/* tree                                                                       */
/* -------------------------------------------------------------------------- */

/** The module's layout route with its children: the manifest's `route` (SPEC §2). */
export const recipeRouteTree = recipeLayoutRoute.addChildren([
  recipeListRoute,
  searchRoute,
  recipeNewRoute,
  recipeDetailRoute,
  recipeEditRoute,
  importRoute,
  importReviewRoute,
  collectionsRoute,
  collectionDetailRoute,
  shoppingRoute,
  cardsRoute,
  shoppingHistoryRoute,
  shoppingListRoute,
  tagsRoute,
  planRoute,
]);
