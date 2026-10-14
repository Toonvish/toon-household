import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  createTranslator,
  hasKey,
  interpolate,
  negotiateLocale,
  resolveWireKey,
  resolveZodIssue,
  SERVER_CATALOGS,
  toValidationIssues,
} from "../src/core/i18n/index.ts";
import { refineKey } from "../src/core/i18n/zod.ts";

describe("negotiateLocale", () => {
  test("picks the first supported tag", () => {
    expect(negotiateLocale("en-GB,en;q=0.9,de;q=0.8")).toBe("en");
    expect(negotiateLocale("de-DE,de;q=0.9")).toBe("de");
  });

  test("falls back when nothing matches or the header is missing", () => {
    expect(negotiateLocale("fr-FR,fr;q=0.9")).toBe("de");
    expect(negotiateLocale(undefined)).toBe("de");
    expect(negotiateLocale(null, "en")).toBe("en");
  });

  test("skips an unsupported tag before an supported one", () => {
    expect(negotiateLocale("fr-FR,en;q=0.5")).toBe("en");
  });
});

describe("interpolate", () => {
  test("substitutes named placeholders", () => {
    expect(interpolate("Remove {name}", { name: "Milch" })).toBe("Remove Milch");
  });

  test("leaves an unmatched placeholder untouched", () => {
    expect(interpolate("Hi {name}", {})).toBe("Hi {name}");
  });

  test("passes a template through unchanged with no values", () => {
    expect(interpolate("No placeholders here")).toBe("No placeholders here");
  });
});

describe("createTranslator — plurals", () => {
  const catalog = {
    "test.items": { one: "{count} item", other: "{count} items" },
    "test.plain": "Hello",
  } as const;

  test("selects the plural category via Intl.PluralRules", () => {
    const t = createTranslator(catalog, "en");
    expect(t("test.items", { count: 1 })).toBe("1 item");
    expect(t("test.items", { count: 0 })).toBe("0 items");
    expect(t("test.items", { count: 7 })).toBe("7 items");
  });

  test("a plain string entry needs no values", () => {
    const t = createTranslator(catalog, "en");
    expect(t("test.plain")).toBe("Hello");
  });

  test("a missing key resolves to the key itself, never throws", () => {
    const t = createTranslator(catalog, "en");
    // @ts-expect-error deliberately not a key of `catalog`
    expect(t("test.nope")).toBe("test.nope");
  });
});

describe("hasKey / resolveWireKey", () => {
  test("a real server key resolves in both locales", () => {
    expect(hasKey(SERVER_CATALOGS.de, "server.error.notFound")).toBe(true);
    expect(resolveWireKey("de", "server.error.notFound")).toBe("Nicht gefunden");
    expect(resolveWireKey("en", "server.error.notFound")).toBe("Not found");
  });

  test("an unknown key (version skew) resolves to undefined, not the key", () => {
    expect(resolveWireKey("de", "server.does.not.exist")).toBeUndefined();
  });

  test("de and en never lose parity — every de key exists in en and vice versa", () => {
    const deKeys = Object.keys(SERVER_CATALOGS.de).sort();
    const enKeys = Object.keys(SERVER_CATALOGS.en).sort();
    expect(enKeys).toEqual(deKeys);
  });
});

describe("Zod issue resolution", () => {
  test("a stripped .min(1) on a `name` field resolves to the field-specific German key", () => {
    const schema = z.object({ name: z.string().min(1) });
    const result = schema.safeParse({ name: "" });
    expect(result.success).toBe(false);
    const resolved = resolveZodIssue(result.error!.issues[0]! as never, "de");
    expect(resolved.key).toBe("server.zod.field.name.too_small.1");
    expect(resolved.message).toBe("Name fehlt");
  });

  test("the same issue resolves in English when asked", () => {
    const schema = z.object({ name: z.string().min(1) });
    const result = schema.safeParse({ name: "" });
    const resolved = resolveZodIssue(result.error!.issues[0]! as never, "en");
    expect(resolved.message).toBe("Name is required");
  });

  test("an unnamed generic constraint falls through to a generic key", () => {
    const schema = z.object({ bio: z.string().min(5) });
    const result = schema.safeParse({ bio: "hi" });
    const resolved = resolveZodIssue(result.error!.issues[0]! as never, "de");
    expect(resolved.key).toBe("server.zod.too_small.string");
    expect(resolved.message).toBe("Muss mindestens 5 Zeichen lang sein");
  });

  test("an explicit refineKey on a custom refinement wins over inference", () => {
    const schema = z
      .object({ a: z.string().optional(), b: z.string().optional() })
      .refine((v) => Boolean(v.a || v.b), refineKey("server.validation.noChanges"));
    const result = schema.safeParse({});
    const resolved = resolveZodIssue(result.error!.issues[0]! as never, "de");
    expect(resolved.key).toBe("server.validation.noChanges");
    expect(resolved.message).toBe("Keine Änderungen übergeben");
  });

  test("toValidationIssues renders every issue with its i18n key attached", () => {
    const schema = z.object({ title: z.string().min(1) });
    const result = schema.safeParse({ title: "" });
    const issues = toValidationIssues(result.error!, "de");
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      path: "title",
      message: "Titel fehlt",
      i18n: { key: "server.zod.field.title.too_small.1" },
    });
  });
});

describe("formatDuration — locale-aware, byte-identical German default", () => {
  test("renders German by default", async () => {
    const { formatDuration } = await import("../src/modules/recipe/duration.ts");
    expect(formatDuration(95)).toBe("1 Std. 35 Min.");
    expect(formatDuration(0)).toBe("0 Min.");
  });

  test("renders English when asked", async () => {
    const { formatDuration } = await import("../src/modules/recipe/duration.ts");
    expect(formatDuration(95, "en")).toBe("1 hr 35 min");
    expect(formatDuration(0, "en")).toBe("0 min");
  });

  test("pluralises days correctly in both locales", async () => {
    const { formatDuration } = await import("../src/modules/recipe/duration.ts");
    expect(formatDuration(1440, "de")).toBe("1 Tag");
    expect(formatDuration(2880, "de")).toBe("2 Tage");
    expect(formatDuration(1440, "en")).toBe("1 day");
    expect(formatDuration(2880, "en")).toBe("2 days");
  });
});
