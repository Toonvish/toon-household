/**
 * Guard for the M3 review finding "no household/module chips on the finance landing and
 * Fixkosten screens on phones": the TopBar is gone, so EVERY screen the finance route tree
 * lazy-loads (and the participant gate's loading/error states) must render the shell's
 * `PhoneHeaderRow`, either directly or through the module `PageHeader`. The headless checks do
 * not look for the chips, and there is no DOM in `bun test`, so this reads the sources: the
 * screen list comes from `routes.tsx` itself, so a new screen is covered without editing here.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dir = import.meta.dir;
const read = (rel: string) => readFileSync(join(dir, rel), "utf8");

const routeSource = read("routes.tsx");
const screens = [...routeSource.matchAll(/import\(\s*"(\.\/features\/[^"]+)"\s*\)/g)].map((m) => `${m[1]}.tsx`);

describe("finance phone header row", () => {
  test("routes.tsx lazy-loads the screens this test expects", () => {
    expect(screens.length).toBeGreaterThanOrEqual(8);
    expect(screens).toContain("./features/overview/OverviewPage.tsx");
    expect(screens).toContain("./features/plan/PlanPage.tsx");
  });

  for (const screen of screens) {
    test(`${screen} renders <PageHeader> or <PhoneHeaderRow>`, () => {
      expect(read(screen)).toMatch(/<(PageHeader|PhoneHeaderRow)[\s/>]/);
    });
  }

  test("OverviewPage and PlanPage render the row directly, also in their loading/error states", () => {
    const overview = read("features/overview/OverviewPage.tsx");
    expect(overview.match(/<PhoneHeaderRow \/>/g)?.length).toBe(2);
    const plan = read("features/plan/PlanPage.tsx");
    expect(plan.match(/<PhoneHeaderRow \/>/g)?.length).toBe(3);
  });

  test("the participant gate keeps the row in its loading and error states", () => {
    expect(read("features/participants/FinanceGate.tsx").match(/<PhoneHeaderRow \/>/g)?.length).toBe(2);
  });

  test("the participant gate renders PendingSyncNote inside a Fragment, never a wrapper element", () => {
    const gate = read("features/participants/FinanceGate.tsx");
    expect(gate).toMatch(/<>\s*<PendingSyncNote \/>\s*<Outlet \/>\s*<\/>/);
  });

  test("PageHeader renders the row", () => {
    expect(read("components/PageHeader.tsx")).toMatch(/<PhoneHeaderRow action=\{actions\} \/>/);
  });
});
