import { describe, expect, test } from "bun:test";
import { recipeEyebrow } from "../src/modules/recipe/tags.ts";

describe("recipeEyebrow", () => {
  test("course + first free tag", () => {
    expect(
      recipeEyebrow([
        { name: "Hauptspeise", kind: "course" },
        { name: "Pasta", kind: "free" },
        { name: "Vegetarisch", kind: "free" },
      ]),
    ).toEqual({ course: "Hauptspeise", detail: "Pasta" });
  });

  test("course only", () => {
    expect(recipeEyebrow([{ name: "Beilage", kind: "course" }])).toEqual({
      course: "Beilage",
      detail: null,
    });
  });

  test("no course tag -> { course: null }, never an empty placeholder", () => {
    expect(
      recipeEyebrow([
        { name: "Pasta", kind: "free" },
        { name: "Vegetarisch", kind: "free" },
      ]),
    ).toEqual({ course: null, detail: "Pasta" });
  });

  test("two course tags: input is already asc(tags.name)-ordered, so the alphabetically first wins", () => {
    // "Beilage" sorts before "Dessert" — the caller is responsible for that order,
    // this function just takes the first match.
    expect(
      recipeEyebrow([
        { name: "Beilage", kind: "course" },
        { name: "Dessert", kind: "course" },
      ]),
    ).toEqual({ course: "Beilage", detail: null });
  });

  test("empty array", () => {
    expect(recipeEyebrow([])).toEqual({ course: null, detail: null });
  });
});
