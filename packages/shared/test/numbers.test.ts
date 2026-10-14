import { describe, expect, test } from "bun:test";
import { formatQuantity, parseNumberToken, parseQuantityRange, roundQuantity } from "../src/modules/recipe/numbers.ts";

describe("parseNumberToken", () => {
  test.each<[string, number | undefined]>([
    ["250", 250],
    ["1,5", 1.5],
    ["1.5", 1.5],
    ["1/2", 0.5],
    ["3/4", 0.75],
    ["1 1/2", 1.5],
    ["½", 0.5],
    ["¼", 0.25],
    ["⅓", 1 / 3],
    ["1½", 1.5],
    ["Mehl", undefined],
    ["", undefined],
    ["1/0", undefined],
  ])("%s", (input, expected) => {
    expect(parseNumberToken(input)).toBe(expected as number);
  });
});

describe("parseQuantityRange", () => {
  test("single value", () => {
    expect(parseQuantityRange("2")).toEqual({ value: 2 });
  });

  test("dash range", () => {
    expect(parseQuantityRange("2-3")).toEqual({ value: 2, max: 3 });
  });

  test("en dash and bis", () => {
    expect(parseQuantityRange("2 – 3")).toEqual({ value: 2, max: 3 });
    expect(parseQuantityRange("2 bis 4")).toEqual({ value: 2, max: 4 });
  });

  test("fraction range", () => {
    expect(parseQuantityRange("1/2 - 1")).toEqual({ value: 0.5, max: 1 });
  });

  test("junk", () => {
    expect(parseQuantityRange("Salz")).toBeUndefined();
  });
});

describe("roundQuantity", () => {
  test("snaps to human fractions", () => {
    expect(roundQuantity(0.3333333333)).toBeCloseTo(1 / 3, 2);
    expect(roundQuantity(0.4999999)).toBe(0.5);
    expect(roundQuantity(2.0000001)).toBe(2);
  });

  test("rounds big numbers whole", () => {
    expect(roundQuantity(333.4)).toBe(333);
    expect(roundQuantity(12.34)).toBe(12.3);
  });
});

describe("formatQuantity", () => {
  test.each<[number, string]>([
    [250, "250"],
    [1.5, "1½"],
    [0.5, "½"],
    [0.75, "¾"],
    [0.25, "¼"],
    [2.25, "2¼"],
    [1.2, "1,2"],
  ])("%d -> %s", (input, expected) => {
    expect(formatQuantity(input)).toBe(expected);
  });
});
