/**
 * `apiFieldErrors` — the glue that turns a thrown value into per-field form errors.
 *
 * The case worth pinning is the ABSENCE of an error: TanStack reports `error: null`
 * on an idle mutation, and a form that maps that to `{ _form: … }` shows a red
 * "Etwas ist schiefgelaufen / Unbekannter Fehler." panel above a blank form. That is
 * what /recipes/new did to anyone who reached it, and it is invisible in a type check
 * because `unknown` happily accepts `null`.
 *
 * Pure functions only — `bun:test` types come from apps/web/tsconfig.test.json, which
 * is the project that type-checks this file; apps/web/tsconfig.json excludes it.
 */
import { describe, expect, test } from "bun:test";
import { Email, Str, keyed, lowercase, minLength, trim } from "@toon/shared";
import { Schema } from "effect";
import { ApiError } from "./api";
import { initLocale } from "./i18n/store.ts";
import { apiFieldErrors, validate } from "./validation";

describe("apiFieldErrors", () => {
  test("no error means no field errors", () => {
    expect(apiFieldErrors(null)).toEqual({});
    expect(apiFieldErrors(undefined)).toEqual({});
  });

  test("a plain Error keeps its message on the form", () => {
    expect(apiFieldErrors(new Error("Netzwerk weg"))).toEqual({ _form: "Netzwerk weg" });
  });

  test("a non-Error throw still says something", () => {
    expect(apiFieldErrors("kaputt")).toEqual({ _form: "Unbekannter Fehler." });
  });

  test("server Zod issues land on their fields", () => {
    const error = new ApiError({
      code: "validation_failed",
      message: "Ungültige Eingabe",
      status: 422,
      details: { issues: [{ path: ["title"], message: "Titel ist Pflicht" }] },
    });
    expect(apiFieldErrors(error)).toEqual({ title: "Titel ist Pflicht" });
  });

  test("fieldErrors maps are read too, first message per field", () => {
    const error = new ApiError({
      code: "validation_failed",
      message: "Ungültige Eingabe",
      status: 422,
      details: { fieldErrors: { servingsAmount: ["Muss eine Zahl sein", "zweit"] } },
    });
    expect(apiFieldErrors(error)).toEqual({ servingsAmount: "Muss eine Zahl sein" });
  });

  test("an ApiError without usable details falls back to its message", () => {
    const error = new ApiError({ code: "forbidden", message: "Kein Zugriff", status: 403 });
    expect(apiFieldErrors(error)).toEqual({ _form: "Kein Zugriff" });
  });
});

/*
 * `validate` on Effect schemas built from the shared vocabulary only (plan e1 P20: no zod import here).
 * The names mirror the real forms' fields so the catalog's per-field German is what gets resolved.
 */
describe("validate (Effect schemas, German messages)", () => {
  initLocale("de");

  const Login = Schema.Struct({
    email: Str.pipe(trim, lowercase, Schema.decodeTo(Email)),
    password: Str.check(minLength(8)),
  });
  const Named = Schema.Struct({ name: Str.check(minLength(1)) });

  test("an invalid e-mail address lands on its field in German", () => {
    const result = validate(Login, { email: "x", password: "langgenug" });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual({ email: "Bitte eine gültige E-Mail-Adresse angeben" });
    expect(result.data).toBeNull();
  });

  test("an empty name says the name is missing", () => {
    expect(validate(Named, { name: "" }).errors).toEqual({ name: "Name fehlt" });
  });

  test("a short password names the minimum", () => {
    const result = validate(Login, { email: "a@b.de", password: "kurz" });
    expect(result.errors).toEqual({ password: "Passwort muss mindestens 8 Zeichen haben" });
  });

  test("every failing field is reported once", () => {
    const result = validate(Login, { email: "x", password: "kurz" });
    expect(result.errors).toEqual({
      email: "Bitte eine gültige E-Mail-Adresse angeben",
      password: "Passwort muss mindestens 8 Zeichen haben",
    });
  });

  test("only the first message of a field is kept", () => {
    const Twice = Schema.Struct({ name: Str.check(minLength(3), minLength(5)) });
    const result = validate(Twice, { name: "a" });
    expect(Object.keys(result.errors ?? {})).toEqual(["name"]);
  });

  test("a keyed refinement on the root is reported under _form", () => {
    const Root = Schema.Struct({ title: Schema.optional(Str), name: Schema.optional(Str) }).check(
      keyed((value) => Boolean(value.title || value.name), "server.validation.noChanges"),
    );
    expect(validate(Root, {}).errors).toEqual({ _form: "Keine Änderungen übergeben" });
    expect(validate(Root, { name: "x" }).ok).toBe(true);
  });

  test("a missing key fails like a wrong type", () => {
    const result = validate(Named, {});
    expect(result.ok).toBe(false);
    expect(Object.keys(result.errors ?? {})).toEqual(["name"]);
  });

  test("success returns the decoded value, trimmed and lower-cased", () => {
    const result = validate(Login, { email: "  Kim@Toon.LOCAL ", password: "langgenug" });
    expect(result).toEqual({
      ok: true,
      data: { email: "kim@toon.local", password: "langgenug" },
      errors: null,
    });
  });
});
