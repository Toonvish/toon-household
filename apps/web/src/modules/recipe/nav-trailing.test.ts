/**
 * The Einkauf count's rule (R `SideNav.tsx` `shoppingCount`; plan m4-design-pass M4-T02):
 * any list without `itemCount` makes the total unknown, so the sidebar draws nothing
 * instead of a misleading `0`.
 */
import { describe, expect, test } from "bun:test";
import { sumItemCounts } from "./nav-trailing";

describe("sumItemCounts", () => {
  test("no lists: a known 0", () => {
    expect(sumItemCounts([])).toBe(0);
  });

  test("every list carries itemCount: their sum", () => {
    expect(sumItemCounts([{ itemCount: 3 }, { itemCount: 0 }, { itemCount: 4 }])).toBe(7);
  });

  test("one list lacks itemCount: undefined (rendered as nothing)", () => {
    expect(sumItemCounts([{ itemCount: 3 }, {}, { itemCount: 4 }])).toBeUndefined();
    expect(sumItemCounts([{ itemCount: 3 }, { itemCount: undefined }])).toBeUndefined();
  });
});
