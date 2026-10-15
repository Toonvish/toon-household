import { describe, expect, test } from "bun:test";
import type { TransactionResponse } from "@toon/shared";
import { dayKey, groupByDay, joinMetaParts } from "./group-by-day";

function tx(id: string, bookedAt: string, amountCents: number): TransactionResponse {
  return { id, bookedAt, amountCents } as TransactionResponse;
}

describe("groupByDay", () => {
  test("no items, no groups", () => {
    expect(groupByDay([])).toEqual([]);
  });

  test("groups by calendar day in first-seen order and sums integer cents", () => {
    const groups = groupByDay([
      tx("a", "2026-08-21T18:00:00.000Z", -1250),
      tx("b", "2026-08-21T09:00:00.000Z", -349),
      tx("c", "2026-08-20T12:00:00.000Z", 10000),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["2026-08-21", "2026-08-20"]);
    expect(groups[0]?.items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(groups[0]?.totalCents).toBe(-1599);
    expect(groups[1]?.totalCents).toBe(10000);
  });

  test("the sum is exact where floats are not (0.1 + 0.2 as cents)", () => {
    const [group] = groupByDay([tx("a", "2026-08-21T10:00:00.000Z", 10), tx("b", "2026-08-21T11:00:00.000Z", 20)]);
    expect(group?.totalCents).toBe(30);
  });

  test("a refund and its purchase cancel to zero, settlements count too", () => {
    const [group] = groupByDay([tx("a", "2026-08-21T10:00:00.000Z", -500), tx("b", "2026-08-21T11:00:00.000Z", 500)]);
    expect(group?.totalCents).toBe(0);
  });

  test("a day that reappears later (unsorted input) stays one group", () => {
    const groups = groupByDay([
      tx("a", "2026-08-21T10:00:00.000Z", 1),
      tx("b", "2026-08-20T10:00:00.000Z", 2),
      tx("c", "2026-08-21T11:00:00.000Z", 4),
    ]);
    expect(groups.map((g) => [g.key, g.totalCents])).toEqual([
      ["2026-08-21", 5],
      ["2026-08-20", 2],
    ]);
  });

  test("dayKey is the ISO date part", () => {
    expect(dayKey("2026-08-21T23:59:59.000Z")).toBe("2026-08-21");
  });
});

describe("joinMetaParts", () => {
  const render = (parts: ReturnType<typeof joinMetaParts<string>>) =>
    parts.map((p) => (p.kind === "separator" ? "·" : p.node));

  test("nothing, nothing", () => {
    expect(joinMetaParts([])).toEqual([]);
  });

  test("one part has no separator, so a phone row never ends on a lone interpunct (gotcha 64)", () => {
    expect(render(joinMetaParts([{ key: "date", node: "~ 21.08.2026" }]))).toEqual(["~ 21.08.2026"]);
  });

  test("separators sit between parts only", () => {
    const joined = joinMetaParts([
      { key: "date", node: "~ 21.08.2026" },
      { key: "category", node: "Lebensmittel" },
      { key: "share", node: "Dein Anteil 13,50" },
    ]);
    expect(render(joined)).toEqual(["~ 21.08.2026", "·", "Lebensmittel", "·", "Dein Anteil 13,50"]);
    expect(joined[0]?.kind).toBe("part");
    expect(joined[joined.length - 1]?.kind).toBe("part");
    expect(new Set(joined.map((p) => p.key)).size).toBe(joined.length);
  });
});
