// FIRST import, on purpose (CLAUDE.md "A module owns its layout route and its static import graph stays
// shell-free"): the manifest is evaluated before the registry (`@/modules`). If anything in its static import
// graph reached the registry or the shell, `modules/index.ts` would read `calendarModule` in its temporal dead
// zone and this file would die with a `ReferenceError` before a single test ran.
import { calendarModule } from "./index";
/**
 * The calendar manifest (SPEC §2, D6, D9; docs/modules/calendar.md §4.1; ADR 0016; plan m8 section 5.5): its
 * identity, its tabs and sidebar-only items, every route lazy at its path, the registry order, the phone tab bar
 * outside a module, and the strict registered route tree for raw `<Link>`s.
 */
import { describe, expect, test } from "bun:test";
import type { AnyRoute, LinkProps } from "@tanstack/react-router";
// Type-only: brings `router.tsx`'s `Register` augmentation into this program for the strict-tree check below;
// erased at runtime, so the import order above still holds.
import type { router } from "@/router";
import { HOUSEHOLDS_NAV_ITEM, PROFILE_NAV_ITEM, primaryNavItems, secondaryNavItems } from "@/components/layout/nav-items";
import { CALENDAR_MONTH_PARAMS, CALENDAR_NEW_PARAMS, CALENDAR_OCCURRENCE_PARAMS } from "./routes";

/** Every full path of the module's route tree (router-core joins them the same way at init). */
function fullPaths(route: AnyRoute, prefix = ""): string[] {
  const own = (route.options as { path?: string }).path ?? "";
  const joined = `${prefix}/${own}`.replace(/\/+/g, "/").replace(/(.)\/$/, "$1");
  return [joined, ...childrenOf(route).flatMap((child) => fullPaths(child, joined))];
}

function childrenOf(route: AnyRoute): readonly AnyRoute[] {
  return (route.children ?? []) as readonly AnyRoute[];
}

const context = { modules: [calendarModule], enabledModuleIds: ["calendar"] } as const;

describe("calendarModule — identity", () => {
  test("id, base path, module name and icon", () => {
    expect(calendarModule.id).toBe("calendar");
    expect(calendarModule.basePath).toBe("/calendar");
    expect(calendarModule.nameKey).toBe("calendar.module.name");
    expect(calendarModule.catalogs.de["calendar.module.name"]).toBe("Kalender");
    expect(calendarModule.catalogs.en["calendar.module.name"]).toBe("Calendar");
  });

  test("the registry lists it third, after recipe and finance", async () => {
    const { WEB_MODULES } = await import("@/modules");
    expect(WEB_MODULES).toContain(calendarModule);
    expect(WEB_MODULES.map((module) => module.id)).toEqual(["recipe", "finance", "calendar"]);
  });

  test("no outbox and no core hooks: writes are online only, the module needs no setup", () => {
    expect("persistMutationNamespaces" in calendarModule).toBe(false);
    expect("mutationDefaults" in calendarModule).toBe(false);
    expect("enableDialog" in calendarModule).toBe(false);
    expect("settingsSections" in calendarModule).toBe(false);
  });
});

describe("calendarModule — navigation (design §4.1, D6)", () => {
  test("inside the module: Übersicht · Monat · Aufgaben, then the shell's Profil", () => {
    const items = primaryNavItems({ ...context, pathname: "/calendar/month" });
    expect(items.map((item) => item.to)).toEqual(["/calendar", "/calendar/month", "/calendar/tasks", "/settings"]);
    expect(items.map((item) => item.labelKey)).toEqual([
      "calendar.nav.overview",
      "calendar.nav.month",
      "calendar.nav.tasks",
      PROFILE_NAV_ITEM.labelKey,
    ]);
  });

  test("only the overview tab matches exactly", () => {
    expect(calendarModule.navItems.map((item) => item.exact)).toEqual([true, false, false]);
  });

  test("sidebar-only: Autos, Müllabfuhr, Kalender-Abo (plan m9 P16), then the shell's Gruppen", () => {
    const items = secondaryNavItems({ ...context, pathname: "/calendar" });
    expect(items.map((item) => item.labelKey)).toEqual([
      "calendar.nav.cars",
      "calendar.nav.waste",
      "calendar.nav.feed",
      HOUSEHOLDS_NAV_ITEM.labelKey,
    ]);
    expect(items.map((item) => item.to)).toEqual(["/calendar/cars", "/calendar/waste", "/calendar/feed", "/households"]);
    expect(calendarModule.secondaryNavItems).toHaveLength(3);
    expect(calendarModule.catalogs.de["calendar.nav.feed"]).toBe("Kalender-Abo");
  });

  test("outside a module the phone tab bar shows Home · Rezepte · Finanzen · Kalender · Profil (ADR 0016)", async () => {
    const { WEB_MODULES } = await import("@/modules");
    const items = primaryNavItems({ pathname: "/", modules: WEB_MODULES, enabledModuleIds: ["recipe", "finance", "calendar"] });
    const moduleTabs = ["recipe", "finance", "calendar"].map((id) => `/${id}`);
    expect(items.map((item): string => item.to)).toEqual(["/", ...moduleTabs, "/settings"]);
  });

  test("every navigation target of the module is under /calendar", () => {
    const all = [...calendarModule.navItems, ...calendarModule.secondaryNavItems].map((item) => item.to as string);
    expect(all.every((to) => to === "/calendar" || to.startsWith("/calendar/"))).toBe(true);
  });
});

describe("calendarModule — route tree (plan m8 section 5.5)", () => {
  const paths = fullPaths(calendarModule.route);

  test("the layout at the base path and every screen below it", () => {
    expect(paths[0]).toBe("/calendar");
    expect([...paths].sort()).toEqual(
      [
        "/calendar", // layout
        "/calendar", // Übersicht
        "/calendar/month",
        "/calendar/tasks",
        "/calendar/new",
        "/calendar/entries/$entryId",
        "/calendar/entries/$entryId/edit",
        "/calendar/cars",
        "/calendar/waste",
        "/calendar/feed",
      ].sort(),
    );
  });

  test("every screen is lazy (`lazyRouteComponent` carries `.preload`)", () => {
    const screens = childrenOf(calendarModule.route);
    expect(screens).toHaveLength(9);
    for (const route of screens) {
      const component = (route.options as { component?: { preload?: unknown } }).component;
      expect(typeof component?.preload).toBe("function");
    }
  });

  test("the search params each screen keeps", () => {
    const keep = (path: string, search: Record<string, unknown>) => {
      const route = childrenOf(calendarModule.route).find((child) => (child.options as { path?: string }).path === path);
      const validate = (route?.options as { validateSearch: (raw: Record<string, unknown>) => Record<string, unknown> }).validateSearch;
      return validate(search);
    };
    expect(keep("month", { month: "2027-01", day: "2027-01-04", x: "drop" })).toEqual({ month: "2027-01", day: "2027-01-04" });
    expect(keep("new", { kind: "car", date: "2027-01-04", x: "drop" })).toEqual({ kind: "car", date: "2027-01-04" });
    expect(keep("entries/$entryId", { date: "2027-01-04", x: "drop" })).toEqual({ date: "2027-01-04" });
    expect([...CALENDAR_MONTH_PARAMS, ...CALENDAR_NEW_PARAMS, ...CALENDAR_OCCURRENCE_PARAMS]).toEqual(["month", "day", "kind", "date", "date"]);
  });
});

/*
 * The STRICT registered tree: a raw `<Link to>` is checked by tsc. Calendar screens use the string-typed `AppLink`
 * / `useAppNavigate`, whose targets the module's LINKS grep checks instead (plan m8 M8-T17).
 */
type AppRouter = typeof router;
const registered: AppRouter["routeTree"] | undefined = undefined;
const good: LinkProps["to"] = "/calendar/waste";
const goodFeed: LinkProps["to"] = "/calendar/feed";
const goodDetail: LinkProps["to"] = "/calendar/entries/$entryId/edit";
// @ts-expect-error unknown route
const bad: LinkProps["to"] = "/calendar/does-not-exist";
// @ts-expect-error an unprefixed module path is not a route
const unprefixed: LinkProps["to"] = "/overview";
void registered;
void good;
void goodFeed;
void goodDetail;
void bad;
void unprefixed;
