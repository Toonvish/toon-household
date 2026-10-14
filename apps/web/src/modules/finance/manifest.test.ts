// FIRST import, on purpose (H/CLAUDE.md "A module owns its layout route and its static import
// graph stays shell-free"): the manifest is evaluated before the registry (`@/modules`). If
// anything in its static import graph reached the registry or the shell, `modules/index.ts`
// would read `financeModule` in its temporal dead zone and this file would die with a
// `ReferenceError` before a single test ran.
import { financeModule } from "./index";
/**
 * The finance manifest (SPEC §2, D3, D6, D9; F/CLAUDE.md "Navigation"; docs/plans/
 * m3-finance-module.md §1 decisions 4, 7, 12, 13): its tabs, its sidebar-only items, its route
 * tree behind the participant gate, its outbox registration, the core hooks (settings section,
 * enable dialog) and the strict registered route tree for raw `<Link>`s.
 */
import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import type { AnyRoute, LinkProps } from "@tanstack/react-router";
// Type-only: brings `router.tsx`'s `Register` augmentation into this program for the
// strict-tree check below; erased at runtime, so the import order above still holds.
import type { router } from "@/router";
import {
  HOUSEHOLDS_NAV_ITEM,
  PROFILE_NAV_ITEM,
  primaryNavItems,
  secondaryNavItems,
} from "@/components/layout/nav-items";
import { EnableFinanceDialog } from "./features/participants/EnableFinanceDialog";
import { ParticipantsSection } from "./features/participants/ParticipantsSection";
import { TX_MUTATION_KEYS } from "./features/transactions/lib/offline";
import { TX_FILTER_PARAMS } from "./routes";

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

const context = { modules: [financeModule], enabledModuleIds: ["finance"] } as const;

describe("financeModule — identity", () => {
  test("id, base path and module name", () => {
    expect(financeModule.id).toBe("finance");
    expect(financeModule.basePath).toBe("/finance");
    expect(financeModule.nameKey).toBe("finance.module.name");
    expect(financeModule.catalogs.de["finance.module.name"]).toBe("Finanzen");
  });

  test("the registry lists it after recipe (imported AFTER the manifest — no TDZ either way)", async () => {
    const { WEB_MODULES } = await import("@/modules");
    expect(WEB_MODULES).toContain(financeModule);
    expect(WEB_MODULES.map((module) => module.id)).toEqual(["recipe", "finance"]);
  });
});

describe("financeModule — navigation (F/CLAUDE.md 'Navigation')", () => {
  test("inside the module: Übersicht · Buchungen · Erfassen, then the shell's Profil", () => {
    const items = primaryNavItems({ ...context, pathname: "/finance/transactions" });
    expect(items.map((item) => item.to)).toEqual([
      "/finance",
      "/finance/transactions",
      "/finance/new",
      "/settings",
    ]);
    expect(items.map((item) => item.labelKey)).toEqual([
      "finance.nav.overview",
      "finance.nav.transactions",
      "finance.nav.create",
      PROFILE_NAV_ITEM.labelKey,
    ]);
    expect(items.at(-1)).toBe(PROFILE_NAV_ITEM);
  });

  test("only the overview tab matches exactly (F: only `/` is exact)", () => {
    expect(financeModule.navItems.map((item) => item.exact)).toEqual([true, false, false]);
  });

  test("sidebar-only: Fixkosten, Kategorien, Gruppen — in that order (the order is copy)", () => {
    const items = secondaryNavItems({ ...context, pathname: "/finance" });
    expect(items.map((item) => item.labelKey)).toEqual([
      "finance.nav.plan",
      "finance.nav.categories",
      HOUSEHOLDS_NAV_ITEM.labelKey,
    ]);
    expect(items.map((item) => item.to)).toEqual(["/finance/plan", "/finance/categories", "/households"]);
  });

  test("Erfassen is a tab, not a FAB; F's Haushalt item is not the module's (the core's Gruppen)", () => {
    expect(financeModule.navItems.map((item) => item.to as string)).toContain("/finance/new");
    const all = [...financeModule.navItems, ...financeModule.secondaryNavItems].map((item) => item.to as string);
    expect(all).not.toContain("/finance/household");
    expect(all.every((to) => to === "/finance" || to.startsWith("/finance/"))).toBe(true);
  });

  test("outside a module, Home · Rezepte · Finanzen · Profil with both enabled", async () => {
    const { WEB_MODULES } = await import("@/modules");
    const items = primaryNavItems({ pathname: "/", modules: WEB_MODULES, enabledModuleIds: ["recipe", "finance"] });
    expect(items.map((item) => item.to)).toEqual(["/", "/recipe", "/finance", "/settings"]);
  });
});

describe("financeModule — route tree (decision 13)", () => {
  const paths = fullPaths(financeModule.route);

  test("the layout sits at the base path", () => {
    expect(paths[0]).toBe("/finance");
  });

  test("every F screen, under /finance, behind the pathless gate", () => {
    expect([...paths].sort()).toEqual(
      [
        "/finance", // layout
        "/finance", // participant gate (pathless)
        "/finance", // Übersicht
        "/finance/transactions",
        "/finance/transactions/$transactionId",
        "/finance/transactions/$transactionId/edit",
        "/finance/new",
        "/finance/plan",
        "/finance/categories",
      ].sort(),
    );
  });

  test("every sidebar-only destination has a route (their phone routes link there)", () => {
    for (const path of ["/finance/plan", "/finance/categories", "/finance/new", "/finance/transactions/$transactionId/edit"]) {
      expect(paths).toContain(path);
    }
  });

  test("the layout's only child is the participant gate; every screen is its child", () => {
    const [gate, ...rest] = childrenOf(financeModule.route);
    expect(rest).toHaveLength(0);
    expect((gate?.options as { id?: string }).id).toBe("participant-gate");
    expect((gate?.options as { path?: string }).path).toBeUndefined();
    expect(childrenOf(gate as AnyRoute)).toHaveLength(7);
  });

  test("the gate and every screen are lazy (`lazyRouteComponent` carries `.preload`)", () => {
    const gate = childrenOf(financeModule.route)[0] as AnyRoute;
    for (const route of [gate, ...childrenOf(gate)]) {
      const component = (route.options as { component?: { preload?: unknown } }).component;
      expect(typeof component?.preload).toBe("function");
    }
  });

  test("/finance/transactions keeps exactly the TX_FILTER_PARAMS (F router.tsx)", () => {
    const gate = childrenOf(financeModule.route)[0] as AnyRoute;
    const list = childrenOf(gate).find((child) => (child.options as { path?: string }).path === "transactions");
    const validate = (list?.options as { validateSearch: (raw: Record<string, unknown>) => Record<string, unknown> })
      .validateSearch;
    const search = {
      from: "2026-01-01",
      to: "2026-01-31",
      kind: "MINE_SPLIT",
      categoryId: "c1",
      tagIds: "t1,t2",
      origin: "manual",
      q: "rewe",
      sort: "-amount",
      x: "drop",
      empty: "",
    };
    const { x: _dropped, empty: _empty, ...kept } = search;
    expect(validate(search)).toEqual(kept);
    expect([...TX_FILTER_PARAMS]).toEqual(["from", "to", "kind", "categoryId", "tagIds", "origin", "q", "sort"]);
  });
});

describe("financeModule — offline outbox (SPEC D9, decision 12)", () => {
  test("mutationDefaults registers a default for each of the three TX_MUTATION_KEYS", () => {
    const client = new QueryClient();
    financeModule.mutationDefaults(client);
    const keys = Object.values(TX_MUTATION_KEYS);
    expect(keys).toHaveLength(3);
    for (const key of keys) {
      expect(typeof client.getMutationDefaults(key).mutationFn).toBe("function");
    }
  });

  test("every transaction mutation key lives in the declared namespace", () => {
    const namespace = financeModule.persistMutationNamespaces[0] ?? [];
    expect(financeModule.persistMutationNamespaces).toHaveLength(1);
    expect(namespace).toEqual(["finance", "tx"]);
    for (const key of Object.values(TX_MUTATION_KEYS)) {
      expect(key.slice(1, 1 + namespace.length).join("/")).toBe(namespace.join("/"));
    }
  });
});

describe("financeModule — core hooks (decisions 4 and 7)", () => {
  test("/settings renders the participants section", () => {
    expect(financeModule.settingsSections).toEqual([ParticipantsSection]);
  });

  test("'Aktivieren' opens the module's enable dialog (two participants, D3)", () => {
    expect(financeModule.enableDialog).toBe(EnableFinanceDialog);
  });
});

/*
 * The STRICT registered tree. This checks a raw `<Link to>` / `useNavigate()` only — finance
 * screens use the string-typed `AppLink` / `useAppNavigate`, whose targets the plan's
 * `LINKS_FIN` grep checks instead.
 */
type AppRouter = typeof router;
const registered: AppRouter["routeTree"] | undefined = undefined;
const good: LinkProps["to"] = "/finance/plan";
const goodEdit: LinkProps["to"] = "/finance/transactions/$transactionId/edit";
// @ts-expect-error unknown route
const bad: LinkProps["to"] = "/finance/does-not-exist";
// @ts-expect-error F's unprefixed path (Table G) is not a route here
const unprefixed: LinkProps["to"] = "/transactions";
void registered;
void good;
void goodEdit;
void bad;
void unprefixed;
