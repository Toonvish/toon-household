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
import { ApiError } from "./api";
import { apiFieldErrors } from "./validation";

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
