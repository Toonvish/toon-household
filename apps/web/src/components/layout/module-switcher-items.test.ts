/**
 * The module switcher's entries (SPEC D6, §5; plan M1-T11 Work 1). Pure functions fed
 * FAKE module slices, so the rules are pinned without a real module or a DOM.
 */
import { describe, expect, test } from "bun:test";
import { createRootRoute } from "@tanstack/react-router";
import { BookOpen, House, Receipt } from "lucide-react";
import type { WebModule } from "@/modules/types";
import { activeSwitcherItem, moduleSwitcherItems } from "./module-switcher-items";

/** A stand-in for a module's layout route (`WebModule.route`); these rules never read it. */
const fakeRoute = createRootRoute();

function fakeModule(id: "recipe" | "finance"): WebModule {
  return {
    id,
    nameKey: id === "recipe" ? "common.nav.recipes" : "home.title",
    icon: id === "recipe" ? BookOpen : Receipt,
    basePath: `/${id}`,
    route: fakeRoute,
    navItems: [],
    secondaryNavItems: [],
    homeCard: () => null,
    persistQueryAllowList: [],
    catalogs: { de: {}, en: {} },
  };
}

const modules = [fakeModule("recipe"), fakeModule("finance")];

describe("moduleSwitcherItems", () => {
  test("M1: no build module — no entries, so no switcher", () => {
    expect(moduleSwitcherItems([], [])).toEqual([]);
    expect(moduleSwitcherItems([], ["recipe", "finance"])).toEqual([]);
  });

  test("build modules, none enabled — no entries", () => {
    expect(moduleSwitcherItems(modules, [])).toEqual([]);
  });

  test("an unknown enabled id reads as disabled", () => {
    expect(moduleSwitcherItems(modules, ["calendar"])).toEqual([]);
  });

  test("one enabled module — Home first, then the module from its manifest", () => {
    expect(moduleSwitcherItems(modules, ["finance"])).toEqual([
      { to: "/", labelKey: "home.nav.label", icon: House },
      { to: "/finance", labelKey: "home.title", icon: Receipt },
    ]);
  });

  test("registry order, not the order of the enabled ids", () => {
    const items = moduleSwitcherItems(modules, ["finance", "recipe"]);
    expect(items.map((item) => item.to)).toEqual(["/", "/recipe", "/finance"]);
    expect(items[1]?.labelKey).toBe("common.nav.recipes");
  });

  test("only ENABLED modules get an entry", () => {
    expect(moduleSwitcherItems(modules, ["recipe"]).map((item) => item.to)).toEqual(["/", "/recipe"]);
  });
});

describe("activeSwitcherItem", () => {
  const items = moduleSwitcherItems(modules, ["recipe", "finance"]);

  test("Home on '/'", () => {
    expect(activeSwitcherItem(items, "/")?.to).toBe("/");
  });

  test("a module on its base path and anywhere below it", () => {
    expect(activeSwitcherItem(items, "/recipe")?.to).toBe("/recipe");
    expect(activeSwitcherItem(items, "/recipe/plan")?.to).toBe("/recipe");
    expect(activeSwitcherItem(items, "/finance/transactions")?.to).toBe("/finance");
  });

  test("module-less screens (Settings, households) belong to Home", () => {
    expect(activeSwitcherItem(items, "/settings")?.to).toBe("/");
    expect(activeSwitcherItem(items, "/households/abc")?.to).toBe("/");
  });

  test("a path that only shares a prefix is not the module", () => {
    expect(activeSwitcherItem(items, "/recipes")?.to).toBe("/");
  });

  test("no entries — nothing is active", () => {
    expect(activeSwitcherItem([], "/recipe")).toBeUndefined();
  });
});
