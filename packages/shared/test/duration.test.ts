import { describe, expect, test } from "bun:test";
import { formatDuration, formatServings, parseDuration, parseServings } from "../src/modules/recipe/duration.ts";

describe("parseDuration — ISO-8601", () => {
  test.each([
    ["PT30M", 30],
    ["PT1H", 60],
    ["PT1H15M", 75],
    ["PT2H30M", 150],
    ["P0DT0H45M", 45],
    ["PT90S", 2],
    ["P1D", 1440],
    ["PT1H0M", 60],
  ])("%s -> %i min", (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });
});

describe("parseDuration — German text", () => {
  test.each([
    ["30 Minuten", 30],
    ["30 Min.", 30],
    ["45 min", 45],
    ["1 Std. 15 Min.", 75],
    ["1 Stunde 30 Minuten", 90],
    ["1½ Stunden", 90],
    ["1,5 Stunden", 90],
    ["2 Stunden", 120],
    ["eine halbe Stunde", 30],
    ["anderthalb Stunden", 90],
    ["20-25 Minuten", 25],
    ["20 bis 25 Minuten", 25],
    ["ca. 40 Minuten", 40],
    ["Zubereitungszeit: 25 Minuten", 25],
    ["1 Tag", 1440],
    ["30", 30],
    ["2 h", 120],
  ])("%s -> %i min", (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });

  test.each(["45 minutes", "1 hour 30 min", "2 hours"])("English: %s", (input) => {
    expect(parseDuration(input)).toBeGreaterThan(0);
  });

  test("returns undefined for unusable input", () => {
    expect(parseDuration("")).toBeUndefined();
    expect(parseDuration("über Nacht")).toBeUndefined();
    expect(parseDuration(null)).toBeUndefined();
    expect(parseDuration(undefined)).toBeUndefined();
    expect(parseDuration("keine Angabe")).toBeUndefined();
  });

  test("accepts numbers as minutes", () => {
    expect(parseDuration(45)).toBe(45);
    expect(parseDuration(-1)).toBeUndefined();
  });

  test("does not mistake servings for a duration", () => {
    expect(parseDuration("4 Portionen")).toBeUndefined();
  });
});

describe("formatDuration", () => {
  test.each([
    [30, "30 Min."],
    [60, "1 Std."],
    [95, "1 Std. 35 Min."],
    [1440, "1 Tag"],
    [0, "0 Min."],
  ])("%i -> %s", (input, expected) => {
    expect(formatDuration(input)).toBe(expected);
  });

  test("empty for nullish", () => {
    expect(formatDuration(undefined)).toBe("");
    expect(formatDuration(null)).toBe("");
  });
});

describe("parseServings", () => {
  test.each<[string, number, string]>([
    ["4 Portionen", 4, "Portionen"],
    ["1 Portion", 1, "Portionen"],
    ["12 Stück", 12, "Stück"],
    ["für 4 Personen", 4, "Personen"],
    ["4-6 Portionen", 6, "Portionen"],
    ["2 bis 3 Portionen", 3, "Portionen"],
    ["24 Muffins", 24, "Muffins"],
    ["ca. 20 Kekse", 20, "Kekse"],
    ["1 Blech", 1, "Blech"],
    ["Portionen: 4", 4, "Portionen"],
    ["serves 4", 4, "Portionen"],
    ["4 servings", 4, "Portionen"],
    ["4", 4, "Portionen"],
    ["12 Stk", 12, "Stück"],
  ])("%s -> %i %s", (input, amount, unit) => {
    expect(parseServings(input)).toEqual({ amount, unit });
  });

  test("returns undefined without a number", () => {
    expect(parseServings("Portionen")).toBeUndefined();
    expect(parseServings("")).toBeUndefined();
    expect(parseServings(null)).toBeUndefined();
  });

  test("a weight yield is not a servings count", () => {
    expect(parseServings("500 g")).toBeUndefined();
    expect(parseServings("1 kg")).toBeUndefined();
  });

  test("accepts plain numbers", () => {
    expect(parseServings(6)).toEqual({ amount: 6, unit: "Portionen" });
    expect(parseServings(0)).toBeUndefined();
  });
});

describe("formatServings", () => {
  test("renders", () => {
    expect(formatServings({ amount: 4, unit: "Portionen" })).toBe("4 Portionen");
    expect(formatServings(undefined)).toBe("");
  });
});
