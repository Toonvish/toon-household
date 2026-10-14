/**
 * Guard for the M3 review obligation (plan m3 §9.11, SPEC D6/§5): the TopBar is gone, so every
 * screen the recipe route tree lazy-loads must render the shell's `PhoneHeaderRow` (household +
 * module chips on phones), the way finance's `phone-header.test.ts` guards its screens. There is
 * no DOM in `bun test`, so this reads the sources; the screen list comes from `routes.tsx` itself,
 * so a new screen is covered without editing here.
 *
 * The one exemption is the recipe detail: artboard 1f lets the hero own the top edge, and print.css
 * relies on that layout. Its scrim back control leads to /recipe, which has the chips.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = import.meta.dir;
const read = (rel: string) => readFileSync(join(dir, rel), "utf8");

const EXEMPT: Record<string, string> = {
  "./features/recipes/RecipeDetailPage.tsx":
    "artboard 1f: the hero owns the top edge; its scrim back control leads to /recipe, which has the chips; print.css relies on this layout",
};

const routeSource = read("routes.tsx");
const screens = [...routeSource.matchAll(/import\(\s*"(\.\/features\/[^"]+)"\s*\)/g)].map((m) => `${m[1]}.tsx`);

describe("recipe phone header row", () => {
  test("routes.tsx lazy-loads the screens this test expects", () => {
    expect(screens.length).toBeGreaterThanOrEqual(14);
    expect(screens).toContain("./features/recipes/RecipeListPage.tsx");
    expect(screens).toContain("./features/shopping/ShoppingListDetailPage.tsx");
  });

  for (const screen of screens) {
    if (screen in EXEMPT) continue;
    test(`${screen} renders <PhoneHeaderRow>`, () => {
      expect(read(screen)).toMatch(/<PhoneHeaderRow[\s/>]/);
    });
  }

  test("the exemption list is exactly the recipe detail, and its file exists", () => {
    expect(Object.keys(EXEMPT)).toEqual(["./features/recipes/RecipeDetailPage.tsx"]);
    for (const [file, reason] of Object.entries(EXEMPT)) {
      expect(existsSync(join(dir, file))).toBe(true);
      expect(screens).toContain(file);
      expect(reason.length).toBeGreaterThan(0);
    }
  });
});
