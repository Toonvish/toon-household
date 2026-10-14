/**
 * Catalog integrity + the store's pure-function surface.
 *
 * `bun test` has no DOM/localStorage/network (see the bun-test shim note in
 * CLAUDE.md), so this file touches ONLY `setLocaleForTest` (no side effects)
 * and `translate()` (pure, ambient-locale). `setLocalePreference()`/`initLocale()` are
 * exercised by hand — see docs/i18n.md §11's manual pass.
 *
 * `setLocaleForTest` obeys the `setMailer` handback rule: `afterAll` resets it
 * to DEFAULT_LOCALE, or every later file in this one-process test run inherits
 * whatever locale the last describe block left behind.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { DEFAULT_LOCALE, LOCALES } from "@toon/shared";
import { CATALOGS, type MessageKey } from "./catalogs/index.ts";
import { MODULE_CATALOGS_DE, MODULE_CATALOGS_EN } from "../../modules/catalogs.ts";
import { readLocalePreference, resolveDeviceLocale, resolveSystemLocale } from "./locale.ts";
import { getLocale, setLocaleForTest, translate } from "./store.ts";

describe("catalog integrity", () => {
  test("every namespace's keys are prefixed and prefixes never collide", () => {
    const prefixes = ["common.", "home.", "auth.", "household.", "recipe."];
    for (const key of Object.keys(CATALOGS.de)) {
      const matches = prefixes.filter((prefix) => key.startsWith(prefix));
      expect(matches.length).toBe(1);
    }
  });

  test("ADR 0001: household copy carries no recipe count (the core cannot count recipes)", () => {
    const keys = Object.keys(CATALOGS.de);
    expect(keys).not.toContain("household.count.recipes");
    expect(CATALOGS.de["household.detail.meta"]).toBe("{members} · angelegt am {date}");
    expect(CATALOGS.en["household.detail.meta"]).toBe("{members} · created on {date}");
    expect(CATALOGS.de["household.danger.warning"]).toBe(
      "Alle Inhalte und Einladungen dieser Gruppe werden endgültig gelöscht. Das kann nicht rückgängig gemacht werden.",
    );
    expect(typeof CATALOGS.de["household.danger.warning"]).toBe("string");
    expect(typeof CATALOGS.en["household.danger.warning"]).toBe("string");
  });

  test("MessageKey is a literal union (D10)", () => {
    // Compile-time guard: one index-signature catalog in the merge (e.g. a module
    // registry typed `Record<string, …>`) widens `MessageKey` to `string`, this line
    // stops compiling, and `bun run typecheck` fails. The runtime assertion only
    // makes the guard visible in the test report.
    const literalKeys: string extends MessageKey ? false : true = true;
    expect(literalKeys).toBe(true);
    // @ts-expect-error a key no catalog defines is not a MessageKey
    const fake: MessageKey = "home.does.not.exist";
    expect(Object.keys(CATALOGS.de)).not.toContain(fake);
  });

  test("the home namespace renders in both locales", () => {
    expect(CATALOGS.de["home.nav.label"]).toBe("Start");
    expect(CATALOGS.en["home.nav.label"]).toBe("Home");
  });

  test("the household namespace renders in German", () => {
    expect(CATALOGS.de["household.role.owner"]).toBe("Eigentümer:in");
  });

  test("de and en list exactly the same keys", () => {
    expect(Object.keys(CATALOGS.en).sort()).toEqual(Object.keys(CATALOGS.de).sort());
  });

  test("the module catalogs (recipe) list exactly the same keys in de and en", () => {
    expect(Object.keys(MODULE_CATALOGS_EN).sort()).toEqual(Object.keys(MODULE_CATALOGS_DE).sort());
  });

  test("every plural entry carries an `other` form, in both locales", () => {
    for (const locale of ["de", "en"] as const) {
      for (const entry of Object.values(CATALOGS[locale]) as Array<string | { other?: string }>) {
        if (typeof entry !== "string") {
          expect(entry.other).toBeDefined();
        }
      }
    }
  });

  test("the placeholder set of every key is identical in de and en", () => {
    const placeholdersOf = (entry: unknown): string[] => {
      const text = typeof entry === "string" ? entry : (entry as { other: string }).other;
      return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
    };
    for (const key of Object.keys(CATALOGS.de) as MessageKey[]) {
      expect(placeholdersOf(CATALOGS.en[key])).toEqual(placeholdersOf(CATALOGS.de[key]));
    }
  });
});

describe("translate() — ambient locale, outside React", () => {
  afterAll(() => setLocaleForTest(DEFAULT_LOCALE));

  test("renders in the current ambient locale", () => {
    setLocaleForTest("de");
    expect(translate("common.time.justNow")).toBe("gerade eben");
    setLocaleForTest("en");
    expect(translate("common.time.justNow")).toBe("just now");
  });

  test("interpolates values", () => {
    setLocaleForTest("de");
    expect(translate("common.upload.tooLarge", { filename: "foto.jpg", size: "17.0" })).toBe(
      '"foto.jpg" ist 17.0 MB groß. Maximal 15 MB sind erlaubt.',
    );
  });

  test("a missing key resolves to the key itself, never throws", () => {
    setLocaleForTest("de");
    // @ts-expect-error deliberately not a real key
    expect(translate("common.does.not.exist")).toBe("common.does.not.exist");
  });

  test("getLocale reflects setLocaleForTest", () => {
    setLocaleForTest("en");
    expect(getLocale()).toBe("en");
    setLocaleForTest("de");
    expect(getLocale()).toBe("de");
  });
});

/**
 * The read-only half of the locale-preference layer.
 *
 * `setLocalePreference()` is deliberately NOT exercised here: it writes
 * `localStorage`, touches `document.documentElement` and fires a PATCH, none of
 * which exist under `bun test`. What IS testable is that the resolvers degrade
 * safely when the browser is absent — which is also exactly what they must do in
 * private-mode Safari, where `localStorage` access throws.
 */
describe("locale preference", () => {
  test("no browser at all resolves to the default, never to undefined", () => {
    // `readStorage` swallows the missing-`window` throw and `resolveSystemLocale`
    // guards `typeof navigator`, so both must still answer.
    expect(resolveSystemLocale()).toBe(DEFAULT_LOCALE);
    expect(resolveDeviceLocale()).toBe(DEFAULT_LOCALE);
  });

  test('an unset preference reads as "system", not as the default locale', () => {
    // These are different states. Collapsing them is what would make the picker
    // show "Deutsch" to someone who has never chosen anything.
    expect(readLocalePreference()).toBe("system");
    expect(LOCALES as readonly string[]).not.toContain("system");
  });

  test("every locale has a picker label, in every catalog", () => {
    // The label for a locale must exist in the OTHER locale's catalog too, or a
    // user who switched to a language they cannot read has no way back.
    for (const locale of LOCALES) {
      for (const catalogLocale of LOCALES) {
        const key = `auth.settings.language.${locale}`;
        expect(Object.hasOwn(CATALOGS[catalogLocale], key), `${key} missing from ${catalogLocale}`).toBe(true);
      }
    }
  });

  test("language names are autonyms — identical across catalogs", () => {
    for (const locale of LOCALES) {
      const key = `auth.settings.language.${locale}` as MessageKey;
      expect(CATALOGS.en[key]).toBe(CATALOGS.de[key]);
    }
  });
});
