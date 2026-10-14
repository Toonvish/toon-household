/**
 * The computed tab set (SPEC D6, §5; plan m1-core §1 decision 8, M1-T10 work 2). Pure
 * functions fed FAKE module slices, so the rules are pinned without a real module or a DOM.
 */
import { describe, expect, test } from "bun:test";
import { createRootRoute } from "@tanstack/react-router";
import { BookOpen, CalendarDays, Receipt, ShoppingBasket, Tag, Wallet } from "lucide-react";
import type { WebModule } from "@/modules/types";
import {
  HOME_NAV_ITEM,
  HOUSEHOLDS_NAV_ITEM,
  PROFILE_NAV_ITEM,
  activeModule,
  primaryNavItems,
  secondaryNavItems,
  type NavItem,
} from "./nav-items";

/** A stand-in for a module's layout route (`WebModule.route`); these rules never read it. */
const fakeRoute = createRootRoute();

function fakeModule(id: "recipe" | "finance", navItems: NavItem[], secondary: NavItem[] = []): WebModule {
  return {
    id,
    nameKey: "home.title",
    icon: id === "recipe" ? BookOpen : Receipt,
    basePath: `/${id}`,
    route: fakeRoute,
    navItems,
    secondaryNavItems: secondary,
    homeCard: () => null,
    persistQueryAllowList: [],
    catalogs: { de: {}, en: {} },
  };
}

/**
 * A third, hypothetical module for the "at most two tabs" rule. `MODULE_IDS` has two ids
 * today, so the id is cast — `primaryNavItems` only compares `id` with the enabled ids.
 */
function extraModule(id: string): WebModule {
  return { ...fakeModule("finance", []), id, basePath: `/${id}` } as unknown as WebModule;
}

const recipeTabs: NavItem[] = [
  { to: "/recipe", labelKey: "common.nav.recipes", icon: BookOpen, exact: true },
  { to: "/recipe/plan", labelKey: "common.nav.plan", icon: CalendarDays, exact: false },
  { to: "/recipe/shopping", labelKey: "common.nav.shopping", icon: ShoppingBasket, exact: false },
];
const recipeSecondary: NavItem[] = [{ to: "/recipe/tags", labelKey: "common.nav.tags", icon: Tag, exact: false }];
const financeTabs: NavItem[] = [{ to: "/finance", labelKey: "home.title", icon: Wallet, exact: true }];
const modules = [fakeModule("recipe", recipeTabs, recipeSecondary), fakeModule("finance", financeTabs)];

const paths = (items: readonly NavItem[]) => items.map((item) => item.to);

describe("core nav items", () => {
  test("Home is '/', labelled by home.nav.label, matched exactly", () => {
    expect(HOME_NAV_ITEM.to).toBe("/");
    expect(HOME_NAV_ITEM.labelKey).toBe("home.nav.label");
    expect(HOME_NAV_ITEM.exact).toBe(true);
  });

  test("Profil is /settings, common.nav.profile, subtree match", () => {
    expect(PROFILE_NAV_ITEM).toMatchObject({ to: "/settings", labelKey: "common.nav.profile", exact: false });
  });

  test("Gruppen is /households, common.nav.groups, subtree match", () => {
    expect(HOUSEHOLDS_NAV_ITEM).toMatchObject({ to: "/households", labelKey: "common.nav.groups", exact: false });
  });
});

describe("primaryNavItems", () => {
  test("outside a module with no modules: Home, Profil", () => {
    expect(primaryNavItems({ pathname: "/", modules: [], enabledModuleIds: [] })).toEqual([
      HOME_NAV_ITEM,
      PROFILE_NAV_ITEM,
    ]);
  });

  test("outside a module with build modules but none enabled: Home, Profil", () => {
    expect(paths(primaryNavItems({ pathname: "/", modules, enabledModuleIds: [] }))).toEqual(["/", "/settings"]);
  });

  test("outside a module: Home · the ENABLED modules only · Profil", () => {
    const items = primaryNavItems({ pathname: "/", modules, enabledModuleIds: ["finance"] });
    expect(paths(items)).toEqual(["/", "/finance", "/settings"]);
  });

  test("two enabled + one disabled build module: Home, A, B, Profil; unknown ids ignored", () => {
    const items = primaryNavItems({
      pathname: "/settings",
      modules: [...modules, extraModule("garden")],
      enabledModuleIds: ["recipe", "finance", "pantry"],
    });
    expect(paths(items)).toEqual(["/", "/recipe", "/finance", "/settings"]);
  });

  test("three enabled modules: only two module tabs, in registry order", () => {
    const items = primaryNavItems({
      pathname: "/",
      modules: [...modules, extraModule("garden")],
      enabledModuleIds: ["garden", "finance", "recipe"],
    });
    expect(paths(items)).toEqual(["/", "/recipe", "/finance", "/settings"]);
  });

  test("the module tab carries the module's name key and icon", () => {
    const [, tab] = primaryNavItems({ pathname: "/", modules, enabledModuleIds: ["recipe"] });
    expect(tab).toMatchObject({ to: "/recipe", labelKey: "home.title", icon: BookOpen, exact: false });
  });

  test("inside a module: its three items · Profil", () => {
    expect(primaryNavItems({ pathname: "/recipe/plan", modules, enabledModuleIds: [] })).toEqual([
      ...recipeTabs,
      PROFILE_NAV_ITEM,
    ]);
    expect(paths(primaryNavItems({ pathname: "/recipe", modules, enabledModuleIds: ["recipe"] }))).toEqual([
      "/recipe",
      "/recipe/plan",
      "/recipe/shopping",
      "/settings",
    ]);
  });

  test("a path that merely starts with a module id is not inside it", () => {
    expect(activeModule("/recipes", modules)).toBeUndefined();
    expect(activeModule("/recipe/x", modules)?.id).toBe("recipe");
  });
});

describe("secondaryNavItems", () => {
  test("inside a module: its secondary items, then Gruppen", () => {
    expect(secondaryNavItems({ pathname: "/recipe", modules, enabledModuleIds: [] })).toEqual([
      ...recipeSecondary,
      HOUSEHOLDS_NAV_ITEM,
    ]);
  });

  test("outside a module (or a module without secondaries): Gruppen alone", () => {
    expect(secondaryNavItems({ pathname: "/", modules, enabledModuleIds: [] })).toEqual([HOUSEHOLDS_NAV_ITEM]);
    expect(secondaryNavItems({ pathname: "/settings", modules: [], enabledModuleIds: [] })).toEqual([
      HOUSEHOLDS_NAV_ITEM,
    ]);
    expect(secondaryNavItems({ pathname: "/finance", modules, enabledModuleIds: [] })).toEqual([HOUSEHOLDS_NAV_ITEM]);
  });

  test("always ends with the households item", () => {
    for (const pathname of ["/", "/recipe", "/recipe/tags", "/finance", "/households", "/settings"]) {
      const items = secondaryNavItems({ pathname, modules, enabledModuleIds: [] });
      expect(items.at(-1)).toBe(HOUSEHOLDS_NAV_ITEM);
    }
  });
});

/*
 * The REAL build's tab sets (plan m4-design-pass M4-T02 work 6; SPEC D6, §5): the registry's
 * own manifests, so a manifest change that breaks the module-less or in-module tab bar fails
 * here. Labels are pinned by key and by their German value (D10 byte-identity).
 */
describe("primaryNavItems — the build's modules (SPEC §5)", () => {
  const setup = async () => {
    const { WEB_MODULES } = await import("@/modules");
    const { setLocaleForTest, translate } = await import("@/lib/i18n/store");
    setLocaleForTest("de");
    const tabs = (pathname: string, enabledModuleIds: readonly string[]) =>
      primaryNavItems({ pathname, modules: WEB_MODULES, enabledModuleIds }).map((item) => ({
        to: item.to,
        labelKey: item.labelKey,
        label: translate(item.labelKey),
      }));
    return { tabs, translate, WEB_MODULES };
  };

  test("outside a module, recipe + finance enabled: Start · Rezepte · Finanzen · Profil", async () => {
    const { tabs } = await setup();
    for (const pathname of ["/", "/settings", "/households"]) {
      expect(tabs(pathname, ["recipe", "finance"])).toEqual([
        { to: "/", labelKey: "home.nav.label", label: "Start" },
        { to: "/recipe", labelKey: "common.nav.recipes", label: "Rezepte" },
        { to: "/finance", labelKey: "finance.module.name", label: "Finanzen" },
        { to: "/settings", labelKey: "common.nav.profile", label: "Profil" },
      ]);
    }
  });

  test("outside a module, recipe only: Start · Rezepte · Profil", async () => {
    const { tabs } = await setup();
    expect(tabs("/", ["recipe"]).map((tab) => tab.label)).toEqual(["Start", "Rezepte", "Profil"]);
    expect(tabs("/", ["recipe"]).map((tab) => tab.to)).toEqual(["/", "/recipe", "/settings"]);
  });

  test("outside a module, none enabled: Start · Profil", async () => {
    const { tabs } = await setup();
    expect(tabs("/", []).map((tab) => tab.to)).toEqual(["/", "/settings"]);
    expect(tabs("/settings", []).map((tab) => tab.labelKey)).toEqual(["home.nav.label", "common.nav.profile"]);
  });

  test("inside /finance/transactions: the three finance items · Profil", async () => {
    const { tabs, translate } = await setup();
    expect(tabs("/finance/transactions", ["recipe", "finance"])).toEqual([
      { to: "/finance", labelKey: "finance.nav.overview", label: translate("finance.nav.overview") },
      { to: "/finance/transactions", labelKey: "finance.nav.transactions", label: translate("finance.nav.transactions") },
      { to: "/finance/new", labelKey: "finance.nav.create", label: translate("finance.nav.create") },
      { to: "/settings", labelKey: "common.nav.profile", label: "Profil" },
    ]);
  });

  test("inside /recipe/plan: the three recipe items · Profil", async () => {
    const { tabs } = await setup();
    expect(tabs("/recipe/plan", ["recipe", "finance"]).map((tab) => [tab.to, tab.labelKey])).toEqual([
      ["/recipe", "common.nav.recipes"],
      ["/recipe/plan", "common.nav.plan"],
      ["/recipe/shopping", "common.nav.shopping"],
      ["/settings", "common.nav.profile"],
    ]);
  });

  test("a module item's `trailing` survives primaryNavItems; core items carry none", async () => {
    const { WEB_MODULES } = await setup();
    const inside = primaryNavItems({ pathname: "/recipe", modules: WEB_MODULES, enabledModuleIds: ["recipe"] });
    const recipe = WEB_MODULES.find((module) => module.id === "recipe");
    expect(inside.slice(0, 3).map((item) => item.trailing)).toEqual(
      (recipe?.navItems ?? []).map((item: NavItem) => item.trailing),
    );
    expect(inside.slice(0, 3).every((item) => typeof item.trailing === "function")).toBe(true);
    expect(inside.at(-1)?.trailing).toBeUndefined();
    const outside = primaryNavItems({ pathname: "/", modules: WEB_MODULES, enabledModuleIds: ["recipe", "finance"] });
    expect(outside.every((item) => item.trailing === undefined)).toBe(true);
  });

  test("a fake module's trailing component is passed through by identity", () => {
    const Trailing = () => null;
    const withTrailing: NavItem[] = [{ ...recipeTabs[0]!, trailing: Trailing }, ...recipeTabs.slice(1)];
    const items = primaryNavItems({
      pathname: "/recipe",
      modules: [fakeModule("recipe", withTrailing)],
      enabledModuleIds: [],
    });
    expect(items[0]?.trailing).toBe(Trailing);
  });
});
