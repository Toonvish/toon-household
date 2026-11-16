import { describe, expect, test } from "bun:test";
import { joinableSectionAbove } from "./format";

describe("joinableSectionAbove", () => {
  const rows = [
    { section: "Kartoffeln" },
    { section: "" },
    { section: "" },
    { section: "Soße" },
    { section: null },
  ];

  test("an unsectioned row below a section can join it", () => {
    expect(joinableSectionAbove(rows, 1)).toBe("Kartoffeln");
    expect(joinableSectionAbove(rows, 4)).toBe("Soße");
  });

  test("nothing to join below an unsectioned row, on the first row or on a sectioned row", () => {
    expect(joinableSectionAbove(rows, 2)).toBeUndefined();
    expect(joinableSectionAbove(rows, 0)).toBeUndefined();
    expect(joinableSectionAbove(rows, 3)).toBeUndefined();
  });

  test("the name is trimmed and whitespace counts as no section", () => {
    expect(joinableSectionAbove([{ section: " Teig " }, { section: "  " }], 1)).toBe("Teig");
  });
});
