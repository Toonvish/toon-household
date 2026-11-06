import { describe, expect, test } from "bun:test";
import type { ShoppingBoughtItem } from "@toon/shared";
import { boughtToday, isBoughtToday, startOfLocalDayIso } from "./bought-today";

/** Local wall-clock times, so the tests hold in every TZ the runner uses. */
const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);

function entry(id: string, at: Date): ShoppingBoughtItem {
  return {
    id,
    listId: "l1",
    name: id,
    quantity: null,
    unit: null,
    note: null,
    boughtBy: null,
    boughtByName: null,
    boughtAt: at.toISOString(),
    sourceRecipeIds: [],
  };
}

describe("bought today", () => {
  const now = local(2026, 11, 6, 15, 30);

  test("startOfLocalDayIso is local midnight of the day", () => {
    expect(startOfLocalDayIso(now)).toBe(local(2026, 11, 6).toISOString());
  });

  test("isBoughtToday compares local calendar days", () => {
    expect(isBoughtToday(local(2026, 11, 6, 0, 0).toISOString(), now)).toBe(true);
    expect(isBoughtToday(local(2026, 11, 6, 23, 59).toISOString(), now)).toBe(true);
    expect(isBoughtToday(local(2026, 11, 5, 23, 59).toISOString(), now)).toBe(false);
    expect(isBoughtToday(local(2026, 10, 6, 12).toISOString(), now)).toBe(false);
    expect(isBoughtToday("not a date", now)).toBe(false);
  });

  test("boughtToday keeps today's entries in their order and drops older ones", () => {
    const rows = [
      entry("a", local(2026, 11, 6, 14)),
      entry("b", local(2026, 11, 6, 9)),
      entry("c", local(2026, 11, 5, 18)),
      entry("d", local(2026, 11, 2, 10)),
    ];
    expect(boughtToday(rows, now).map((row) => row.id)).toEqual(["a", "b"]);
  });
});
