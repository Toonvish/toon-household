/**
 * The recipe module's web manifest (SPEC §2, D2, D6, D9; plan m2-recipe-module §1 decisions
 * 6, 8, 10, 15). Listed in `modules/index.ts`; nothing outside this directory knows the
 * module's routes, screens, query keys or catalogs except through this object.
 *
 * LITERAL-TYPED ON PURPOSE: no type annotation, only `satisfies WebModule<"recipe">`, so
 * `WEB_MODULES = [recipeModule] as const` keeps the concrete route tree type and the
 * registered router tree stays strict (decision 10), and so the catalog objects keep their
 * literal keys (H gotcha "`MessageKey` must stay a literal union").
 *
 * STATIC IMPORT GRAPH (decision 15): this file, `routes.tsx`, `HomeCard.tsx`, the catalogs and
 * `features/shopping/lib/offline.ts` never import the module registry or the shell (the
 * layout components: the app shell, the tab bar, `use-nav-items`…). The registry evaluates
 * `WEB_MODULES = [recipeModule]`; a path back into it from here would read `recipeModule`
 * in its temporal dead zone the moment anything imports this manifest first — which
 * `manifest.test.ts` and `persist.test.ts` do on purpose. Screens are lazy (`routes.tsx`).
 *
 * Navigation (R/CLAUDE.md "Navigation"): tabs Rezepte · Plan · Einkauf (the shell appends
 * Profil); sidebar-only Sammlungen · Tags in that order (the shell appends Gruppen). Each
 * sidebar-only item has a phone route from a tab screen: the "Sammlungen verwalten" /
 * "Tags verwalten" links in the library's filter surfaces; the wallet
 * (`/recipe/shopping/cards`) is reached from the `CardsCard` panel on `/recipe/shopping`;
 * import and new recipe from the library's `+` sheet. Search is not a destination:
 * `/recipe/search` redirects to `/recipe`.
 */
import { BookOpen, CalendarDays, Folder, ShoppingBasket, Tag } from "lucide-react";
import type { WebModule } from "@/modules/types";
import { recipeDe, recipeEn } from "./catalogs/index.ts";
import { registerShoppingMutationDefaults } from "./features/shopping/lib/offline";
import { RecipeHomeCard } from "./HomeCard";
import { recipeRouteTree } from "./routes";

export const recipeModule = {
  id: "recipe",
  nameKey: "common.nav.recipes",
  icon: BookOpen,
  basePath: "/recipe",
  route: recipeRouteTree,
  navItems: [
    { to: "/recipe", labelKey: "common.nav.recipes", icon: BookOpen, exact: true },
    { to: "/recipe/plan", labelKey: "common.nav.plan", icon: CalendarDays, exact: false },
    { to: "/recipe/shopping", labelKey: "common.nav.shopping", icon: ShoppingBasket, exact: false },
  ],
  secondaryNavItems: [
    { to: "/recipe/collections", labelKey: "common.nav.collections", icon: Folder, exact: false },
    { to: "/recipe/tags", labelKey: "common.nav.tags", icon: Tag, exact: false },
  ],
  homeCard: RecipeHomeCard,
  /**
   * What is persisted for offline reading (SPEC D9; R `lib/persist.ts`
   * `PERSISTED_GROUP_SEGMENTS` minus the core `detail`, plus R's `isCardsKey`). Keys are
   * `["toon","household",<id>,"recipe",<segment>,…]`. Deliberately absent: `imports` /
   * `import` / `import-draft` (mid-edit state must come from the server), `plan-shopping`
   * (a live server diff against one list — stale offline is worse than absent) and
   * `shopping-catalog` (the "Häufig gekauft" feed has no offline use case).
   */
  persistQueryAllowList: [
    { scope: "household", path: ["recipe", "recipes"] },
    { scope: "household", path: ["recipe", "recipe"] },
    { scope: "household", path: ["recipe", "tags"] },
    { scope: "household", path: ["recipe", "collections"] },
    { scope: "household", path: ["recipe", "collection"] },
    // The shopping list is the one screen that is EDITED offline (in a supermarket
    // basement), so both the overview and the open list have to survive a cold start.
    { scope: "household", path: ["recipe", "shopping-lists"] },
    { scope: "household", path: ["recipe", "shopping-list"] },
    // The meal planner and the "Bought today" / history feed — read-only offline.
    { scope: "household", path: ["recipe", "plan"] },
    { scope: "household", path: ["recipe", "shopping-bought"] },
    // The user's saved cards — a loyalty barcode is shown at a till, where there is no
    // signal. The wallet key itself only, nothing below it (a card number is worth money;
    // the blob is still keyed per user and purged on account change).
    { scope: "user", path: ["recipe", "cards"], exact: true },
  ],
  /** The shopping outbox (`["toon","recipe","shopping",<op>]`), replay-safe by `mutationId`. */
  persistMutationNamespaces: [["recipe", "shopping"]],
  /** Registered by `app.tsx` before the persister restores (a restored mutation has no fn). */
  mutationDefaults: registerShoppingMutationDefaults,
  catalogs: { de: recipeDe, en: recipeEn },
} satisfies WebModule<"recipe">;
