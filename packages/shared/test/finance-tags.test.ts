import { describe, expect, test } from "bun:test";
import { normalizeTagName, SAMMELBUCHUNG_TAG, TAG_MAX_LENGTH } from "../src/modules/finance/tags.ts";

describe("normalizeTagName", () => {
  test.each([
    ["Amazon", "amazon"],
    ["amazon", "amazon"],
    [" Amazon ", "amazon"],
    ["  Urlaub   2024 ", "urlaub 2024"],
  ])("normalizeTagName(%j) === %j", (input, expected) => {
    expect(normalizeTagName(input)).toBe(expected);
  });
});

test("TAG_MAX_LENGTH is a sane positive bound", () => {
  expect(TAG_MAX_LENGTH).toBeGreaterThan(0);
  expect(Number.isInteger(TAG_MAX_LENGTH)).toBe(true);
});

test("SAMMELBUCHUNG_TAG is the tag charts filter on to hide aggregate bookings", () => {
  expect(SAMMELBUCHUNG_TAG).toBe("sammelbuchung");
});
