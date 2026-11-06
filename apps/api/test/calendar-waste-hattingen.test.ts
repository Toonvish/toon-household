/**
 * The Stadt Hattingen flyer parser (plan m8 P19, M8-T10; design §5.3, §5.4), TEST-FIRST over the recorded text items of
 * the committed 2027 flyer (`apps/api/test/fixtures/calendar/hattingen-2027.items.json`, made by `record-items.ts` from
 * `hattingen-abfall-2027.pdf`).
 *
 * - The golden spot checks of design §5.4 (read off the rendered flyer at 200 dpi, verified by eye), every row: the tour
 *   per type on that day, an empty type ABSENT from the day's record, the Biotonne cleaning detail on 03-19, 07-01, 10-18.
 * - Whole-year properties: 365 dates, the three cleaning ranges, determinism (twice, and on shuffled input), `selectTour`
 *   for tours 1, 4 and 9, the tour-4 Restmüll count.
 * - The traps of design §5.3 as mutations of the recorded items: a block whose weekday column is shifted is DISCARDED
 *   (the other copy carries the month), two valid blocks that disagree fail `consensus` with the date and both readings,
 *   a missing month fails `months`, a missing title fails `year`, a tour on a Sunday fails `sundays`, a `0` fails `values`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { WasteCategory } from "@toon/shared";
import { type HattingenParse, parseHattingenFlyer, selectTour } from "../src/modules/calendar/services/waste/hattingen.ts";
import type { WasteTextItem } from "../src/modules/calendar/services/waste/pdf-text.ts";
import { FLYER_ITEMS } from "./fixtures/calendar/record-items.ts";

const ITEMS: ReadonlyArray<WasteTextItem> = JSON.parse(readFileSync(FLYER_ITEMS, "utf8"));

type Row = { R?: number; G?: number; B?: number; P?: number; T?: number };
const KEY: Record<keyof Row, WasteCategory> = {
  R: "waste_rest",
  G: "waste_yellow",
  B: "waste_bio",
  P: "waste_paper",
  T: "waste_tree",
};

/** Design §5.4, verbatim: [date, R, G, B, P, T] with `null` for "–"; `cleaning` marks "(cleaning)" on B. */
const GOLDEN: ReadonlyArray<readonly [string, number | null, number | null, number | null, number | null, number | null, boolean?]> = [
  ["2027-01-01", null, null, null, null, null],
  ["2027-01-04", 9, 9, 4, 4, 4],
  ["2027-01-05", 1, 1, 5, 5, 5],
  ["2027-01-08", 4, 4, 8, 8, 8],
  ["2027-01-11", 5, 5, 9, 9, 9],
  ["2027-01-12", 6, 6, 1, null, 1],
  ["2027-01-15", 9, 9, 4, null, null],
  ["2027-01-22", null, null, 9, null, null],
  ["2027-01-25", 5, 5, 1, 1, null],
  ["2027-02-01", 1, 1, 5, 5, null],
  ["2027-02-05", null, null, 9, 9, null],
  ["2027-02-26", 9, 9, null, null, null],
  ["2027-03-19", 5, 5, 9, null, null, true],
  ["2027-03-26", null, null, null, null, null],
  ["2027-03-31", 2, 2, 6, 6, null],
  ["2027-04-05", 5, 5, 9, 9, null],
  ["2027-05-01", null, null, null, null, null],
  ["2027-06-14", 5, 5, 1, 1, null],
  ["2027-07-01", 8, 8, 4, null, null, true],
  ["2027-07-02", 9, 9, null, null, null],
  ["2027-07-12", 5, 5, 1, 1, null],
  ["2027-08-20", null, null, 9, 9, null],
  ["2027-08-31", 2, 2, 6, null, null],
  ["2027-10-18", 5, 5, 1, null, null, true],
  ["2027-11-01", null, null, null, null, null],
  ["2027-11-02", 6, 6, 1, 1, null],
  ["2027-11-12", null, null, 9, 9, null],
  ["2027-12-17", 9, 9, 5, null, null],
  ["2027-12-20", 1, 1, 6, null, null],
  ["2027-12-23", 4, 4, 9, null, null],
  ["2027-12-24", null, null, null, null, null],
  ["2027-12-25", null, null, null, null, null],
  ["2027-12-26", null, null, null, null, null],
  ["2027-12-31", null, null, null, null, null],
  ["2027-12-27", 5, 5, 1, 1, null],
  ["2027-12-30", 8, 8, 4, 4, null],
];

function expected(row: (typeof GOLDEN)[number]): Partial<Record<WasteCategory, number>> {
  const [, R, G, B, P, T] = row;
  const out: Partial<Record<WasteCategory, number>> = {};
  const values: Row = {};
  if (R !== null) values.R = R;
  if (G !== null) values.G = G;
  if (B !== null) values.B = B;
  if (P !== null) values.P = P;
  if (T !== null) values.T = T;
  for (const [letter, tour] of Object.entries(values) as Array<[keyof Row, number]>) out[KEY[letter]] = tour;
  return out;
}

function parsed(items: ReadonlyArray<WasteTextItem> = ITEMS): Extract<HattingenParse, { ok: true }> {
  const result = parseHattingenFlyer(items);
  if (!result.ok) throw new Error(`the flyer did not parse: ${JSON.stringify(result)}`);
  return result;
}

/* ------------------------------- mutation helpers ------------------------------ */

/** The sections (page 2) that carry a month-name item `month`, left to right. */
function sectionsWithMonth(month: string): number[] {
  return ITEMS.filter((item) => item.page === 2 && item.section > 0 && item.str === month)
    .sort((a, b) => a.x - b.x)
    .map((item) => item.section);
}

/** The month block of `month` in `section`: its name item, its `R` header and its day items by day number. */
function block(section: number, month: string) {
  const name = ITEMS.find((item) => item.section === section && item.str === month)!;
  const headerR = ITEMS.filter(
    (item) => item.section === section && item.str === "R" && item.y < name.y && name.y - item.y < 25 && Math.abs(item.x - name.x) < 25,
  ).sort((a, b) => Math.abs(a.x - name.x) - Math.abs(b.x - name.x))[0]!;
  const days = new Map<number, WasteTextItem>();
  for (const item of ITEMS) {
    if (item.section !== section || !/^\d\d$/.test(item.str) || item.y >= headerR.y) continue;
    if (item.x < headerR.x - 60 || item.x > headerR.x - 20) continue;
    days.set(Number(item.str), item);
  }
  return { name, headerR, days };
}

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

/** Items with every weekday item of the block shifted by one day (Mo -> Di, …, So -> Mo): a stale-year copy. */
function shiftWeekdays(items: ReadonlyArray<WasteTextItem>, section: number, month: string): WasteTextItem[] {
  const { headerR, days } = block(section, month);
  const rows = [...days.values()];
  return items.map((item) => {
    if (item.section !== section || !WEEKDAYS.includes(item.str)) return item;
    const sameRow = rows.some((day) => Math.abs(day.y - item.y) < 2 && item.x > day.x && item.x < headerR.x);
    if (!sameRow) return item;
    return { ...item, str: WEEKDAYS[(WEEKDAYS.indexOf(item.str) + 1) % 7]! };
  });
}

/** The tour digit items of one row of a block (single digits right of the R header, within the row). */
function rowDigits(items: ReadonlyArray<WasteTextItem>, section: number, month: string, day: number): WasteTextItem[] {
  const { headerR, days } = block(section, month);
  const dayItem = days.get(day)!;
  return items.filter(
    (item) =>
      item.section === section &&
      /^\d$/.test(item.str) &&
      Math.abs(item.y - dayItem.y) < 4 &&
      item.x >= headerR.x - 1 &&
      item.x < headerR.x + 75,
  );
}

/** A digit item placed in the R column of `day`'s row of a block (where the flyer prints one). */
function digitInR(section: number, month: string, day: number, str: string): WasteTextItem {
  const { headerR, days } = block(section, month);
  const dayItem = days.get(day)!;
  return { str, x: headerR.x + 1.3, y: dayItem.y + 1.3, width: 5.3, page: 2, section };
}

/* ------------------------------------ tests ------------------------------------ */

describe("parseHattingenFlyer: the golden spot checks of design §5.4", () => {
  const result = parsed();

  test("the year comes from the four quarter titles", () => {
    expect(result.year).toBe(2027);
  });

  for (const row of GOLDEN) {
    test(`${row[0]}: ${JSON.stringify(expected(row))}`, () => {
      expect(result.days.has(row[0])).toBe(true);
      expect(result.days.get(row[0])).toEqual(expected(row));
    });
  }

  test("the Biotonne cleaning ranges come from the footers", () => {
    expect(result.cleaning).toEqual([
      { from: "2027-03-08", to: "2027-03-19" },
      { from: "2027-06-28", to: "2027-07-09" },
      { from: "2027-10-18", to: "2027-10-29" },
    ]);
  });

  test("the cleaning days of the golden table carry `bio_cleaning` for their tour (03-19 tour 9, 07-01 tour 4, 10-18 tour 1)", () => {
    for (const row of GOLDEN.filter((r) => r[6] === true)) {
      const tour = row[3]!;
      const pickups = selectTour(result, tour).filter((pickup) => pickup.date === row[0]);
      expect(pickups.find((pickup) => pickup.category === "waste_bio")?.detail).toBe("bio_cleaning");
      expect(pickups.filter((pickup) => pickup.category !== "waste_bio").every((pickup) => pickup.detail === null)).toBe(true);
    }
  });
});

describe("parseHattingenFlyer: whole-year properties", () => {
  const result = parsed();

  test("every one of the 365 dates of 2027 is covered", () => {
    expect(result.days.size).toBe(365);
    expect([...result.days.keys()].every((date) => date.startsWith("2027-"))).toBe(true);
  });

  test("every value is a tour 1-9, Sundays carry nothing", () => {
    for (const [, record] of result.days) {
      for (const tour of Object.values(record)) expect(tour! >= 1 && tour! <= 9).toBe(true);
    }
    expect(result.days.get("2027-01-03")).toEqual({});
    expect(result.days.get("2027-12-26")).toEqual({});
  });

  test("deterministic: the same input twice, and the same input shuffled, give the same parse", () => {
    expect(parsed()).toEqual(result);
    let seed = 42;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const shuffled = [...ITEMS];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    expect(parsed(shuffled)).toEqual(result);
  });

  test("tour 4 has Restmüll every second week (at least 20 dates, at most one per 13 days)", () => {
    const dates = selectTour(result, 4)
      .filter((pickup) => pickup.category === "waste_rest")
      .map((pickup) => pickup.date);
    expect(dates.length).toBeGreaterThanOrEqual(20);
    for (let i = 1; i < dates.length; i += 1) {
      const gap = (Date.parse(`${dates[i]}T00:00:00Z`) - Date.parse(`${dates[i - 1]}T00:00:00Z`)) / 86_400_000;
      expect(gap).toBeGreaterThanOrEqual(12);
    }
  });
});

describe("selectTour", () => {
  const result = parsed();

  for (const tour of [1, 4, 9]) {
    test(`tour ${tour}: exactly the golden pickups of that tour on the golden days, sorted by date then type`, () => {
      const pickups = selectTour(result, tour);
      expect(pickups.length).toBeGreaterThan(50);
      const sorted = [...pickups].sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          ["waste_rest", "waste_yellow", "waste_bio", "waste_paper", "waste_tree"].indexOf(a.category) -
            ["waste_rest", "waste_yellow", "waste_bio", "waste_paper", "waste_tree"].indexOf(b.category),
      );
      expect(pickups).toEqual(sorted);
      for (const row of GOLDEN) {
        const want = Object.entries(expected(row))
          .filter(([, value]) => value === tour)
          .map(([category]) => category)
          .sort();
        const got = pickups
          .filter((pickup) => pickup.date === row[0])
          .map((pickup) => pickup.category)
          .sort();
        expect(got).toEqual(want);
      }
      for (const pickup of pickups) expect(result.days.get(pickup.date)?.[pickup.category]).toBe(tour);
    });
  }

  test("tour 4 on 2027-01-04 is Biotonne, Papier and Tannenbaum; on 2027-01-08 Restmüll and Gelber Sack", () => {
    const pickups = selectTour(result, 4);
    expect(pickups.filter((p) => p.date === "2027-01-04")).toEqual([
      { category: "waste_bio", date: "2027-01-04", detail: null },
      { category: "waste_paper", date: "2027-01-04", detail: null },
      { category: "waste_tree", date: "2027-01-04", detail: null },
    ]);
    expect(pickups.filter((p) => p.date === "2027-01-08")).toEqual([
      { category: "waste_rest", date: "2027-01-08", detail: null },
      { category: "waste_yellow", date: "2027-01-08", detail: null },
    ]);
  });
});

describe("parseHattingenFlyer: the traps of design §5.3", () => {
  const januarSections = sectionsWithMonth("Januar");
  const julySections = sectionsWithMonth("Juli");

  test("the fixture has two January copies and four July copies (two of them the stale 2026 artwork)", () => {
    expect(januarSections.length).toBe(2);
    expect(julySections.length).toBe(4);
  });

  test("a January block with a shifted weekday column is discarded; the other copy carries the month", () => {
    const mutated = shiftWeekdays(ITEMS, januarSections[0]!, "Januar");
    expect(parsed(mutated)).toEqual(parsed());
  });

  test("both January blocks shifted: no valid block for January is `months`", () => {
    let mutated = shiftWeekdays(ITEMS, januarSections[0]!, "Januar");
    mutated = shiftWeekdays(mutated, januarSections[1]!, "Januar");
    expect(parseHattingenFlyer(mutated)).toMatchObject({ ok: false, check: "months" });
  });

  test("two valid blocks that disagree on a date fail `consensus` with the date and both readings", () => {
    const section = januarSections[1]!;
    const target = rowDigits(ITEMS, section, "Januar", 4).sort((a, b) => a.x - b.x)[0]!;
    expect(target.str).toBe("9");
    const mutated = ITEMS.map((item) => (item === target ? { ...item, str: "8" } : item));
    const result = parseHattingenFlyer(mutated);
    expect(result).toMatchObject({ ok: false, check: "consensus", date: "2027-01-04" });
    if (result.ok) throw new Error("unreachable");
    expect(result.readings?.length).toBe(2);
  });

  test("a missing month (no `Februar` item anywhere) is `months`", () => {
    const mutated = ITEMS.filter((item) => item.str !== "Februar");
    expect(parseHattingenFlyer(mutated)).toMatchObject({ ok: false, check: "months" });
  });

  test("no quarter title (no year) is `year`; titles of two different years are `year`", () => {
    const titled = /^1\.\s*(Januar|April|Juli|Oktober)\s*-/;
    expect(parseHattingenFlyer(ITEMS.filter((item) => !titled.test(item.str)))).toMatchObject({ ok: false, check: "year" });
    const mixed = ITEMS.map((item) => (item.str.startsWith("1. April -") ? { ...item, str: item.str.replace("2027", "2028") } : item));
    expect(parseHattingenFlyer(mixed)).toMatchObject({ ok: false, check: "year" });
  });

  test("a tour on a Sunday (in every copy) is `sundays`", () => {
    const extra = januarSections.map((section) => digitInR(section, "Januar", 3, "4"));
    expect(parseHattingenFlyer([...ITEMS, ...extra])).toMatchObject({ ok: false, check: "sundays", date: "2027-01-03" });
  });

  test("a tour on a holiday (in every copy) is `sundays`", () => {
    const extra = januarSections.map((section) => digitInR(section, "Januar", 1, "4"));
    expect(parseHattingenFlyer([...ITEMS, ...extra])).toMatchObject({ ok: false, check: "sundays", date: "2027-01-01" });
  });

  test("a value outside 1-9 (in every copy) is `values`", () => {
    const targets = new Set(januarSections.map((section) => rowDigits(ITEMS, section, "Januar", 4).sort((a, b) => a.x - b.x)[0]!));
    const mutated = ITEMS.map((item) => (targets.has(item) ? { ...item, str: "0" } : item));
    expect(parseHattingenFlyer(mutated)).toMatchObject({ ok: false, check: "values", date: "2027-01-04" });
  });

  test("an empty item list is refused, never thrown", () => {
    expect(parseHattingenFlyer([]).ok).toBe(false);
  });
});
