/**
 * The import feature's error mapping now yields catalog KEYS rather than
 * sentences, so the thing worth pinning is that every key it can produce
 * actually exists — in BOTH locales.
 *
 * That is not something `tsc` fully covers: `MessageKey` proves a key is in the
 * merged catalog, but the `{ text }` pass-through variant is untyped by design,
 * and a `describeError` branch that returns the wrong *shape* (a bare string,
 * say) used to be invisible. These tests walk every status/code branch instead.
 *
 * No DOM, no locale mutation, no `setMailer`-style seam to hand back — this file
 * only reads.
 */
import { describe, expect, test } from "bun:test";
import { LOCALES } from "@toon/shared";
import { CATALOGS } from "@/lib/i18n/catalogs/index.ts";
import { describeError, toImportApiError, type ImportErrorText } from "./importApi";

/** Every (status, code) pair `toImportApiError` branches on, one per branch. */
const BRANCHES: ReadonlyArray<{ status: number; code?: string }> = [
  { status: 0 },
  { status: 401 },
  { status: 200, code: "unauthorized" },
  { status: 403 },
  { status: 200, code: "forbidden" },
  { status: 404 },
  { status: 200, code: "not_found" },
  { status: 413 },
  { status: 200, code: "payload_too_large" },
  { status: 415 },
  { status: 200, code: "unsupported_media_type" },
  { status: 200, code: "pdf_no_text_layer" },
  { status: 200, code: "ocr_failed" },
  { status: 200, code: "parse_failed" },
  { status: 200, code: "fetch_failed" },
  { status: 504 },
  { status: 408 },
  { status: 200, code: "timeout" },
  { status: 429 },
  { status: 200, code: "rate_limited" },
  { status: 422 },
  { status: 400 },
  { status: 200, code: "validation_failed" },
  { status: 500 },
  { status: 503 },
  { status: 418 },
];

function body(code?: string, message?: string): unknown {
  if (code === undefined && message === undefined) return undefined;
  return { error: { ...(code === undefined ? {} : { code }), ...(message === undefined ? {} : { message }) } };
}

/** Asserts a text is either a real key in every locale, or a pass-through string. */
function expectResolvable(text: ImportErrorText, label: string): void {
  if ("text" in text) {
    expect(text.text.length, `${label}: pass-through text must not be empty`).toBeGreaterThan(0);
    return;
  }
  for (const locale of LOCALES) {
    // `Object.hasOwn`, not `toHaveProperty`: our keys are FLAT and dotted, and
    // `toHaveProperty("recipe.import.error.x")` would read the dots as a nested path
    // and never match.
    expect(
      Object.hasOwn(CATALOGS[locale], text.key),
      `${label}: key "${text.key}" missing from "${locale}"`,
    ).toBe(true);
  }
}

describe("toImportApiError", () => {
  test("every branch yields a title and hint resolvable in every locale", () => {
    for (const branch of BRANCHES) {
      const error = toImportApiError(branch.status, body(branch.code));
      const label = `status=${branch.status} code=${branch.code ?? "-"}`;
      expectResolvable(error.title, `${label} title`);
      expectResolvable(error.hint, `${label} hint`);
    }
  });

  test("carries the wire code and status through unchanged", () => {
    const error = toImportApiError(413, body("payload_too_large"));
    expect(error.code).toBe("payload_too_large");
    expect(error.status).toBe(413);
    expect(error.kind).toBe("too_large");
  });

  test("Error.message is the KEY, never a translation", () => {
    // A translated message in a log is unsearchable and depends on whoever
    // happened to be looking at the screen when it was thrown.
    const error = toImportApiError(0, undefined);
    expect(error.message).toBe("recipe.import.error.network.title");
  });

  test("passes the server's own message through — it is already localised", () => {
    const error = toImportApiError(422, body("validation_failed", "Titel fehlt"));
    expect(error.title).toEqual({ text: "Titel fehlt" });
  });

  test("an EMPTY server message falls back to our key, not to a blank headline", () => {
    // `describeError` hands this function `message: ""` for a shell ApiError
    // that carries none.
    expect(toImportApiError(422, body("validation_failed", "")).title).toEqual({
      key: "recipe.import.error.validation.title",
    });
    expect(toImportApiError(418, body("weird", "")).title).toEqual({ key: "recipe.import.error.unknown.title" });
  });
});

describe("describeError", () => {
  test("maps a shell ApiError by its code/status pair", () => {
    const described = describeError({ status: 404, code: "not_found", message: "" });
    expect(described.title).toEqual({ key: "recipe.import.error.notFound.title" });
    expect(described.retryable).toBe(false);
  });

  test("recognises an aborted operation", () => {
    const described = describeError(new DOMException("Upload aborted", "AbortError"));
    expect(described.title).toEqual({ key: "recipe.import.error.aborted.title" });
    expect(described.retryable).toBe(true);
  });

  test("recognises the no_files sentinel", () => {
    const described = describeError(new Error("no_files"));
    expect(described.title).toEqual({ key: "recipe.import.error.noFiles.title" });
  });

  test("passes a raw Error.message through as the hint, since it has no key", () => {
    const described = describeError(new Error("socket hang up"));
    expect(described.title).toEqual({ key: "recipe.import.error.unknown.title" });
    expect(described.hint).toEqual({ text: "socket hang up" });
  });

  test("falls back to a key when there is no message at all", () => {
    expect(describeError(new Error("")).hint).toEqual({ key: "recipe.import.error.unexpected.hint" });
    expect(describeError(undefined).hint).toEqual({ key: "recipe.import.error.unexpected.hint" });
  });

  test("never returns copy that cannot be resolved", () => {
    for (const error of [undefined, null, 42, "boom", {}, new Error("x"), new DOMException("y", "AbortError")]) {
      const described = describeError(error);
      expectResolvable(described.title, "title");
      expectResolvable(described.hint, "hint");
    }
  });
});
