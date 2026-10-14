// FIRST import, on purpose (plan m2-recipe-module §1 decision 15): the manifest is evaluated
// before the registry (`@/modules`). If anything in its static import graph reached the
// registry or the shell, `modules/index.ts` would read `recipeModule` in its temporal dead
// zone and this file would die with a `ReferenceError` before a single test ran.
import { recipeModule } from "./index";
/**
 * The recipe manifest (SPEC §2, D6, D9; R/CLAUDE.md "Navigation"): its tabs, its sidebar-only
 * items and their phone routes, its route tree, its outbox registration and the strict
 * registered route tree for raw `<Link>`s.
 */
import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import type { AnyRoute, LinkProps } from "@tanstack/react-router";
// Type-only: brings `router.tsx`'s `Register` augmentation into this program for the
// strict-tree check below; erased at runtime, so the import order above still holds.
import type { router } from "@/router";
import { PROFILE_NAV_ITEM, primaryNavItems, secondaryNavItems } from "@/components/layout/nav-items";
import { SHOPPING_MUTATION_KEYS } from "./features/shopping/lib/offline";
import { PlanNewTrailing, RecipeCountTrailing, ShoppingCountTrailing } from "./nav-trailing";

/** Every full path of the module's route tree (router-core joins them the same way at init). */
function fullPaths(route: AnyRoute, prefix = ""): string[] {
  const own = (route.options as { path?: string }).path ?? "";
  const joined = `${prefix}/${own}`.replace(/\/+/g, "/").replace(/(.)\/$/, "$1");
  return [joined, ...childrenOf(route).flatMap((child) => fullPaths(child, joined))];
}

/** A route's children, widened (the concrete tuple type is not assignable to `AnyRoute[]`). */
function childrenOf(route: AnyRoute): readonly AnyRoute[] {
  return (route.children ?? []) as readonly AnyRoute[];
}

const context = { modules: [recipeModule], enabledModuleIds: ["recipe"] } as const;

describe("recipeModule — identity", () => {
  test("id, base path and module name", () => {
    expect(recipeModule.id).toBe("recipe");
    expect(recipeModule.basePath).toBe("/recipe");
    expect(recipeModule.nameKey).toBe("common.nav.recipes");
  });

  test("the registry lists it (imported AFTER the manifest — no TDZ either way)", async () => {
    const { WEB_MODULES } = await import("@/modules");
    expect(WEB_MODULES).toContain(recipeModule);
  });
});

describe("recipeModule — navigation (R/CLAUDE.md 'Navigation')", () => {
  test("inside the module: Rezepte · Plan · Einkauf, then the shell's Profil", () => {
    const items = primaryNavItems({ ...context, pathname: "/recipe/plan" });
    expect(items.map((item) => item.to)).toEqual(["/recipe", "/recipe/plan", "/recipe/shopping", "/settings"]);
    expect(items.map((item) => item.labelKey)).toEqual([
      "common.nav.recipes",
      "common.nav.plan",
      "common.nav.shopping",
      "common.nav.profile",
    ]);
    expect(items.at(-1)).toBe(PROFILE_NAV_ITEM);
  });

  test("only the library tab matches exactly", () => {
    expect(recipeModule.navItems.map((item) => item.exact)).toEqual([true, false, false]);
  });

  test("sidebar-only: Sammlungen, Tags, Gruppen — in that order (the order is copy)", () => {
    const items = secondaryNavItems({ ...context, pathname: "/recipe" });
    expect(items.map((item) => item.labelKey)).toEqual([
      "common.nav.collections",
      "common.nav.tags",
      "common.nav.groups",
    ]);
    expect(items.map((item) => item.to)).toEqual(["/recipe/collections", "/recipe/tags", "/households"]);
  });

  test("sidebar trailing slots (plan m4-design-pass §1 decision 6): count · Neu · count on the tabs only", () => {
    expect(recipeModule.navItems.map((item) => item.trailing)).toEqual([
      RecipeCountTrailing,
      PlanNewTrailing,
      ShoppingCountTrailing,
    ]);
    for (const item of recipeModule.secondaryNavItems) {
      expect("trailing" in item).toBe(false);
    }
    // The shell passes them through untouched.
    const items = primaryNavItems({ ...context, pathname: "/recipe" });
    expect(items.slice(0, 3).map((item) => item.trailing)).toEqual([
      RecipeCountTrailing,
      PlanNewTrailing,
      ShoppingCountTrailing,
    ]);
  });

  test("Import is not a tab (Plan took its slot) and Search is not a destination", () => {
    const all = [...recipeModule.navItems, ...recipeModule.secondaryNavItems].map((item) => item.to as string);
    expect(all).not.toContain("/recipe/import");
    expect(all).not.toContain("/recipe/search");
  });
});

describe("recipeModule — route tree", () => {
  const paths = fullPaths(recipeModule.route);

  test("the layout sits at the base path", () => {
    expect(paths[0]).toBe("/recipe");
  });

  test("every sidebar-only destination and the wallet have a route (their phone routes link there)", () => {
    for (const path of ["/recipe/collections", "/recipe/tags", "/recipe/shopping/cards"]) {
      expect(paths).toContain(path);
    }
  });

  test("every R route, under /recipe (decision 6)", () => {
    expect([...paths].sort()).toEqual(
      [
        "/recipe",
        "/recipe",
        "/recipe/search",
        "/recipe/recipes/new",
        "/recipe/recipes/$recipeId",
        "/recipe/recipes/$recipeId/edit",
        "/recipe/import",
        "/recipe/import/$draftId",
        "/recipe/collections",
        "/recipe/collections/$collectionId",
        "/recipe/shopping",
        "/recipe/shopping/cards",
        "/recipe/shopping/history",
        "/recipe/shopping/$listId",
        "/recipe/tags",
        "/recipe/plan",
      ].sort(),
    );
  });

  test("/recipe and /recipe/search keep the same filter params (R gotcha)", () => {
    const children = childrenOf(recipeModule.route);
    const search = { q: "suppe", tags: "a,b", collectionId: "c1", maxMinutes: "30", difficulty: "einfach", sort: "title", x: "drop" };
    const byPath = (path: string) =>
      children.find((child) => (child.options as { path?: string }).path === path)?.options as {
        validateSearch: (raw: Record<string, unknown>) => Record<string, unknown>;
      };
    const { x: _dropped, ...kept } = search;
    expect(byPath("/").validateSearch(search)).toEqual(kept);
    expect(byPath("search").validateSearch(search)).toEqual(kept);
  });

  test("every screen is lazy (`lazyRouteComponent` carries `.preload`)", () => {
    const children = childrenOf(recipeModule.route);
    const screens = children.filter((child) => (child.options as { path?: string }).path !== "search");
    expect(screens).toHaveLength(14);
    for (const child of screens) {
      const component = (child.options as { component?: { preload?: unknown } }).component;
      expect(typeof component?.preload).toBe("function");
    }
  });
});

describe("recipeModule — offline outbox (SPEC D9)", () => {
  test("mutationDefaults registers a default for every shopping mutation key", () => {
    const client = new QueryClient();
    recipeModule.mutationDefaults(client);
    for (const key of Object.values(SHOPPING_MUTATION_KEYS)) {
      expect(typeof client.getMutationDefaults(key).mutationFn).toBe("function");
    }
  });

  test("every shopping mutation key lives in the declared namespace", () => {
    const namespace = recipeModule.persistMutationNamespaces[0] ?? [];
    expect(namespace).toEqual(["recipe", "shopping"]);
    for (const key of Object.values(SHOPPING_MUTATION_KEYS)) {
      expect(key.slice(1, 1 + namespace.length).join("/")).toBe(namespace.join("/"));
    }
  });
});

/*
 * The STRICT registered tree (plan §1 decision 10). This checks a raw `<Link to>` /
 * `useNavigate()` only — recipe screens use the string-typed `AppLink` / `useAppNavigate`,
 * whose targets the plan's `LINKS` grep checks instead.
 */
type AppRouter = typeof router;
const registered: AppRouter["routeTree"] | undefined = undefined;
const good: LinkProps["to"] = "/recipe/plan";
// @ts-expect-error unknown route
const bad: LinkProps["to"] = "/recipe/does-not-exist";
void registered;
void good;
void bad;
