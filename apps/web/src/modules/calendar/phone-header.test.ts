/**
 * Every calendar screen renders the shell's `PhoneHeaderRow` (ADR 0010: no global top bar), directly or through
 * `CalendarPageHeader`, and the manifest's static graph stays shell-free (CLAUDE.md "A module owns its layout
 * route and its static import graph stays shell-free"). There is no DOM in `bun test`, so this reads the sources;
 * the screen list comes from `routes.tsx` itself, so a new screen is covered without editing here.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dir = import.meta.dir;
const read = (rel: string) => readFileSync(join(dir, rel), "utf8");

const routeSource = read("routes.tsx");
const screens = [...routeSource.matchAll(/import\(\s*"(\.\/features\/[^"]+)"\s*\)/g)].map((m) => `${m[1]}.tsx`);

describe("calendar phone header row", () => {
  test("routes.tsx lazy-loads the eight screens of plan m8 section 5.5 and the feed screen of plan m9 P16", () => {
    expect([...screens].sort()).toEqual(
      [
        "./features/agenda/AgendaPage.tsx",
        "./features/month/MonthPage.tsx",
        "./features/tasks/TasksPage.tsx",
        "./features/entries/NewEntryPage.tsx",
        "./features/entries/OccurrenceDetailPage.tsx",
        "./features/entries/EditEntryPage.tsx",
        "./features/cars/CarsPage.tsx",
        "./features/waste/WastePage.tsx",
        "./features/feed/FeedPage.tsx",
      ].sort(),
    );
  });

  for (const screen of screens) {
    test(`${screen} renders <CalendarPageHeader> or <PhoneHeaderRow>`, () => {
      expect(read(screen)).toMatch(/<(CalendarPageHeader|PhoneHeaderRow)[\s/>]/);
    });
  }

  test("CalendarPageHeader renders the row with its one action", () => {
    expect(read("components/CalendarPageHeader.tsx")).toMatch(/<PhoneHeaderRow action=\{actions\} \/>/);
  });

  test("the manifest's static graph never reaches the shell, the registry or the page header", () => {
    for (const file of ["index.ts", "routes.tsx", "HomeCard.tsx", "catalogs/index.ts"]) {
      const source = read(file);
      expect(source).not.toMatch(/from "@\/components\/layout/);
      expect(source).not.toMatch(/from "@\/modules"/);
      expect(source).not.toMatch(/from "[^"]*use-nav-items"/);
      expect(source).not.toMatch(/from "[^"]*CalendarPageHeader"/);
    }
  });
});

describe("the feed screen (plan m9 P16)", () => {
  test("renders CalendarPageHeader without a header action", () => {
    const source = read("features/feed/FeedPage.tsx");
    const headers = [...source.matchAll(/<CalendarPageHeader\b[^>]*\/>/g)].map((m) => m[0]);
    expect(headers.length).toBeGreaterThan(0);
    for (const header of headers) expect(header).not.toContain("actions=");
  });
});

describe("calendar header actions fit the phone header row (M8-T19)", () => {
  test("every header action label is short in both locales", async () => {
    const { calendarDe, calendarEn } = await import("./catalogs/index.ts");
    // The phone row also carries the household and module chips; "Abfallkalender importieren" squeezed them at 390.
    for (const key of ["calendar.common.new", "calendar.waste.import.action"] as const) {
      for (const catalog of [calendarDe, calendarEn]) {
        const value = (catalog as Record<string, unknown>)[key];
        expect(typeof value, key).toBe("string");
        expect((value as string).length, `${key}: ${value as string}`).toBeLessThanOrEqual(12);
      }
    }
    expect(read("features/waste/WastePage.tsx")).toContain('t("calendar.waste.import.action")');
  });
});

describe("long header actions show their icon alone on phones (M8 UI check)", () => {
  // "Bearbeiten" and "Importieren" beside the household and module chips cut "Familie" to "Fa…" / "F…" at 390;
  // below `lg` their label is screen-reader text only (it stays the accessible name), from `lg` it shows.
  test.each([
    ["features/entries/OccurrenceDetailPage.tsx", 'calendar.common.edit'],
    ["features/waste/WastePage.tsx", 'calendar.waste.import.action'],
  ])("%s wraps %s in max-lg:sr-only", (file, key) => {
    expect(read(file)).toContain(`<span className="max-lg:sr-only">{t("${key}")}</span>`);
  });
});
