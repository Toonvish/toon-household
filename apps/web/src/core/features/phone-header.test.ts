/**
 * Guard for the core screens' phone header row (plan m4-design-pass M4-T09 chrome check, SPEC D6/§5):
 * `TopBar` is gone, so every shell screen carries the household and module chips through its own
 * `PhoneHeaderRow`. The module screens have their own guards (`modules/recipe/phone-header.test.ts`,
 * `modules/finance/phone-header.test.ts`); this one covers Home and the three core screens the
 * Profil tab leads to. There is no DOM in `bun test`, so it reads the sources.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dir = import.meta.dir;
const SCREENS = [
  "home/HomePage.tsx",
  "settings/SettingsPage.tsx",
  "households/HouseholdsPage.tsx",
  "households/HouseholdDetailPage.tsx",
];

describe("core phone header row", () => {
  for (const screen of SCREENS) {
    test(`${screen} renders <PhoneHeaderRow>`, () => {
      expect(readFileSync(join(dir, screen), "utf8")).toMatch(/<PhoneHeaderRow[\s/>]/);
    });
  }
});
