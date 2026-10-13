/**
 * The computed tab set (SPEC D6, §5; plan M0-T11 Work 3). Pure functions fed FAKE
 * module slices, so the rules are pinned without a real module or a DOM.
 */
import { describe, expect, test } from "bun:test";
import { BookOpen, CalendarDays, Receipt, Tag } from "lucide-react";
import type { WebModule } from "@/modules/types";
import { HOME_NAV_ITEM, activeModule, primaryNavItems, secondaryNavItems, type NavItem } from "./nav-items";

function fakeModule(id: "recipe" | "finance", navItems: NavItem[], secondary: NavItem[] = []): WebModule {
  return {
    id,
    nameKey: "home.title",
    icon: id === "recipe" ? BookOpen : Receipt,
    basePath: `/${id}`,
    routes: [],
    navItems,
    secondaryNavItems: secondary,
    homeCard: () => null,
    persistQueryAllowList: [],
    catalogs: { de: {}, en: {} },
  };
}

const recipeTabs: NavItem[] = [
  { to: "/recipe", labelKey: "common.nav.recipes", icon: BookOpen, exact: true },
  { to: "/recipe/plan", labelKey: "common.nav.plan", icon: CalendarDays, exact: false },
];
const recipeSecondary: NavItem[] = [{ to: "/recipe/tags", labelKey: "common.nav.tags", icon: Tag, exact: false }];
const modules = [fakeModule("recipe", recipeTabs, recipeSecondary), fakeModule("finance", [])];

describe("primaryNavItems", () => {
  test("M0: no modules, no session — Home alone", () => {
    expect(primaryNavItems({ pathname: "/", modules: [], enabledModuleIds: [] })).toEqual([HOME_NAV_ITEM]);
  });

  test("Home is '/', labelled by home.nav.label, matched exactly", () => {
    expect(HOME_NAV_ITEM.to).toBe("/");
    expect(HOME_NAV_ITEM.labelKey).toBe("home.nav.label");
    expect(HOME_NAV_ITEM.exact).toBe(true);
  });

  test("outside a module: Home plus the ENABLED modules only", () => {
    const items = primaryNavItems({ pathname: "/", modules, enabledModuleIds: ["finance"] });
    expect(items.map((item) => item.to)).toEqual(["/", "/finance"]);
  });

  test("outside a module: at most two module tabs, unknown ids ignored", () => {
    const items = primaryNavItems({
      pathname: "/settings",
      modules,
      enabledModuleIds: ["recipe", "finance", "garden"],
    });
    expect(items.map((item) => item.to)).toEqual(["/", "/recipe", "/finance"]);
  });

  test("inside a module: that module's own tabs", () => {
    expect(primaryNavItems({ pathname: "/recipe/plan", modules, enabledModuleIds: [] })).toBe(recipeTabs);
    expect(primaryNavItems({ pathname: "/recipe", modules, enabledModuleIds: [] })).toBe(recipeTabs);
  });

  test("a path that merely starts with a module id is not inside it", () => {
    expect(activeModule("/recipes", modules)).toBeUndefined();
  });
});

describe("secondaryNavItems", () => {
  test("only inside a module", () => {
    expect(secondaryNavItems({ pathname: "/recipe", modules, enabledModuleIds: [] })).toBe(recipeSecondary);
    expect(secondaryNavItems({ pathname: "/", modules, enabledModuleIds: [] })).toEqual([]);
  });
});
