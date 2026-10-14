import { describe, expect, test } from "bun:test";
import { resolveWireKey, serverText, SERVER_CATALOGS } from "../src/core/i18n/catalogs/index.ts";
import { resolveZodIssue } from "../src/core/i18n/zod.ts";
import type { $ZodIssue } from "zod/v4/core";

// M3 (T01): the locale negotiation, interpolate and createTranslator cases of F's
// i18n.test.ts are the core's runtime and are covered by packages/shared/test/i18n.test.ts.
// What stays here is the finance server-catalog and Zod-resolution behaviour.

describe("resolveWireKey / serverText — the server catalogs", () => {
  test("resolves a known server key in both locales", () => {
    expect(resolveWireKey("de", "server.error.notFound")).toBe("Nicht gefunden");
    expect(resolveWireKey("en", "server.error.notFound")).toBe("Not found");
  });

  test("returns undefined (never the raw key) for an unknown wire key", () => {
    expect(resolveWireKey("de", "server.does.not.exist")).toBeUndefined();
  });

  test("serverText renders a bare ServerKey or a {key, values} pair", () => {
    expect(serverText("de", "server.error.notFound")).toBe("Nicht gefunden");
    expect(serverText("de", { key: "server.error.tooManyAttempts", values: { seconds: 30 } })).toBe(
      "Zu viele Versuche. Bitte in 30 Sekunden erneut probieren.",
    );
  });

  test("every de key has a matching en key and vice versa", () => {
    const deKeys = Object.keys(SERVER_CATALOGS.de).sort();
    const enKeys = Object.keys(SERVER_CATALOGS.en).sort();
    expect(enKeys).toEqual(deKeys);
  });

  test("the finance tag rule renders F's wording in both locales", () => {
    expect(resolveWireKey("de", "server.tag.nameTaken")).toBe("Diesen Tag gibt es bereits.");
    expect(resolveWireKey("en", "server.tag.nameTaken")).toBe("This tag already exists.");
  });
});

describe("resolveZodIssue — the field/code/facet resolution ladder", () => {
  function issue(partial: Partial<$ZodIssue> & Pick<$ZodIssue, "code">): $ZodIssue {
    return { path: [], message: "unused", input: undefined, ...partial } as $ZodIssue;
  }

  test("falls back to server.zod.fallback for a completely generic issue", () => {
    const resolved = resolveZodIssue(issue({ code: "custom" } as $ZodIssue), "de");
    expect(resolved.key).toBe("server.zod.fallback");
  });

  test("a field-specific candidate wins over the generic one", () => {
    const resolved = resolveZodIssue(
      issue({ code: "invalid_format", path: ["email"], format: "email", input: "not-an-email" } as never),
      "de",
    );
    expect(resolved.key).toBe("server.zod.field.email.invalid_format");
  });

  // H: the core has no `server.zod.invalid_format.uuid` (F's generic key is not ported, ADR 0002), and
  // `url` has a field key in the core, so the path is a field with no key of its own.
  test("without a field-specific key, falls back to code.facet", () => {
    const resolved = resolveZodIssue(
      issue({ code: "invalid_format", path: ["note"], format: "uuid", input: "nope" } as never),
      "de",
    );
    expect(resolved.key).toBe("server.zod.invalid_format");
    expect(resolved.message).toBe("Ungültiges Format");
  });

  test("an explicit refineKey on a custom issue always wins", () => {
    const resolved = resolveZodIssue(
      issue({ code: "custom", params: { i18n: "server.validation.periodFormat" } } as never),
      "de",
    );
    expect(resolved.key).toBe("server.validation.periodFormat");
    expect(resolved.message).toBe("Bitte gib einen Monat im Format JJJJ-MM an.");
  });

  test("too_small on the description resolves to its field-specific key (bound 1)", () => {
    const resolved = resolveZodIssue(
      issue({ code: "too_small", path: ["description"], origin: "string", minimum: 1, input: "" } as never),
      "de",
    );
    expect(resolved.key).toBe("server.zod.field.description.too_small.1");
    expect(resolved.message).toBe("Bitte beschreib die Buchung kurz.");
  });

  test("too_big on the description renders its bound (200)", () => {
    const de = resolveZodIssue(
      issue({ code: "too_big", path: ["description"], origin: "string", maximum: 200, input: "x" } as never),
      "de",
    );
    expect(de.key).toBe("server.zod.field.description.too_big.200");
    expect(de.message).toBe("Die Beschreibung ist zu lang (höchstens 200 Zeichen).");

    const en = resolveZodIssue(
      issue({ code: "too_big", path: ["description"], origin: "string", maximum: 200, input: "x" } as never),
      "en",
    );
    expect(en.message).toBe("The description is too long (at most 200 characters).");
  });
});
