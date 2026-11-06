/**
 * The Stadt Hattingen waste flyer parser (plan m8 P19, design §5.3): a PURE function over the text items of
 * `WastePdfText` (`./pdf-text.ts`). No `Date` (the weekdays come from the shared days-from-civil helpers), no throw, no
 * `Error` subclass: a refusal is a value naming its check, which the caller turns into `422 calendar_waste_unparseable`.
 *
 * THE TEXT LAYER IS NOT WHAT YOU SEE (design §5.3). The four quarter grids are placed PDFs that carry several copies of
 * every month, all in the text layer and only one visible: copies shifted by 14.4 pt (a copy's digits fall into the
 * NEIGHBOURING column of the other copy, rows 0.1-0.2 pt apart), and stale artwork of the previous year underneath. Each
 * copy is its own marked-content section, and inside one section the geometry is consistent. Hence:
 *
 * 1. Year: the quarter titles `1. <Monat> - <d>. <Monat> <YYYY>`; all four quarters present, one year (else `year`).
 * 2. Blocks, PER SECTION, one per month-name item: the header row `R G B P [T]` just below the name (the `R` nearest
 *    below it within 25 pt, the letters of that row within 3 pt of its y, x from the name -25 to +70), the day items
 *    (`01`…`31`) left of `R` and their weekday items (`Mo`…`So`). A block is VALID only when every day of the month is
 *    present once and every row's weekday is the real weekday of that date in the title year; an invalid block (a
 *    stale year's copy) is DISCARDED, never repaired.
 * 3. Reading a valid block: the row band of a day is its day item's y ± half the row pitch MEASURED from the block's own
 *    day items (median gap), never a fixed tolerance; a tour digit belongs to the column whose cell holds its centre,
 *    a cell running from its header's x to the NEXT header's x of the SAME block (the last one a median header gap wide).
 *    Only items of the block's own section are looked at. A row with a word in the cell area is a holiday.
 * 4. Paint order, then consensus: every date must come from at least one valid block (else `months`). The section
 *    drawn LAST (the highest section number: sections are counted in content-stream order, which is paint order) covers
 *    the copies under it, so its reading is the one the flyer shows; valid blocks of that one section that read a date
 *    must agree (else `consensus`, with the date and two readings). A covered copy that reads a date otherwise is a
 *    WARNING (`hiddenCopyDiffers`), never a refusal: the 2027 fixture's hidden January/February copy is an older draft
 *    (2027-01-15 G 3 instead of 9; 2027-02-15 to -20 one row later, Rosenmontag empty), and the rendered page shows the
 *    last-drawn copy's values (design §5.4 golden 2027-01-15: G 9). Design §5.3 asked for agreement across ALL valid
 *    blocks; the fixture refutes that (plan m8 section 10, M8-T10).
 * 5. Sanity: every value is a tour 1-9 (`values`), Sundays and holidays carry nothing (`sundays`), every tour 1-9 has
 *    Restmüll at least 20 times (`tourCount`).
 * 6. Cleaning: the footers' `dd.mm.-dd.mm.YYYY` ranges ("Reinigungstermine der Biotonnen"); a Biotonne pickup inside one
 *    is `bio_cleaning` (`selectTour`).
 *
 * Order-independent: every choice sorts its candidates first, so a shuffled item list parses to the same result.
 */
import {
  WASTE_CATEGORIES,
  type WasteCategory,
  type WasteDetail,
  calendarWeekday,
  daysInCalendarMonth,
  formatCalendarDate,
  isCalendarDate,
} from "@toon/shared";
import type { WasteCheck } from "./errors.ts";
import { type WasteTextItem, compareWasteItems } from "./pdf-text.ts";

/** One day of the flyer: the tour collected per waste type (an absent type is not collected that day). */
export type HattingenDay = Partial<Record<WasteCategory, number>>;

/** A parsed flyer. */
export interface HattingenFlyer {
  readonly ok: true;
  readonly year: number;
  /** Every date of the year, ascending, each with its (possibly empty) record. */
  readonly days: ReadonlyMap<string, HattingenDay>;
  /** The Biotonne cleaning ranges, inclusive, ascending. */
  readonly cleaning: ReadonlyArray<{ readonly from: string; readonly to: string }>;
  /** Non-fatal findings, by date: `hiddenCopyDiffers` when a covered (hidden) copy of a grid reads that day otherwise. */
  readonly warnings: ReadonlyArray<HattingenWarning>;
}

/** A non-fatal finding of the parser (the preview lists them). */
export interface HattingenWarning {
  readonly code: "hiddenCopyDiffers";
  readonly date: string;
}

/** A refusal: the failed check (P19), the date it concerns and, for `consensus`, two disagreeing readings. */
export interface HattingenRefusal {
  readonly ok: false;
  readonly check: Exclude<WasteCheck, "notPdf" | "encrypted" | "pages" | "timeout" | "noTourDates">;
  readonly date?: string;
  readonly readings?: ReadonlyArray<HattingenDay>;
}

export type HattingenParse = HattingenFlyer | HattingenRefusal;

/** One pickup of the selected tour. */
export interface HattingenPickup {
  readonly category: WasteCategory;
  readonly date: string;
  readonly detail: WasteDetail | null;
}

/* ------------------------------------------------------------------------------ */
/* vocabulary of the flyer                                                         */
/* ------------------------------------------------------------------------------ */

const MONTHS = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
] as const;

/** The flyer's weekday abbreviations, index 0 = Monday (as `calendarWeekday`). */
const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"] as const;

/** The column letters of a month block and their waste types (design §5.1). */
const COLUMN_CATEGORY: Readonly<Record<string, WasteCategory>> = {
  R: "waste_rest",
  G: "waste_yellow",
  B: "waste_bio",
  P: "waste_paper",
  T: "waste_tree",
};

/** `1. Januar - 31. März 2027`: the first month of each quarter, then the year. */
const QUARTER_TITLE = /^1\.\s*(Januar|April|Juli|Oktober)\s*-\s*\d{1,2}\.\s*(?:März|Juni|September|Dezember)\s+(\d{4})$/;
/** `08.03.-19.03.2027` inside a "Reinigungstermine der Biotonnen" footer. */
const CLEANING_RANGE = /(\d{1,2})\.(\d{1,2})\.?\s*-\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/g;
const DAY_NUMBER = /^\d\d$/;
/** A weekday item: the abbreviation alone, or followed by a holiday name in the same run (`Sa Tag der Arbeit`). */
const WEEKDAY_TOKEN = /^(Mo|Di|Mi|Do|Fr|Sa|So)(?:\s|$)/;
const TOUR_DIGITS = /^\d+$/;
const HAS_LETTER = /\p{L}/u;

/* ------------------------------------------------------------------------------ */
/* geometry helpers                                                                */
/* ------------------------------------------------------------------------------ */

function median(values: ReadonlyArray<number>): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

const centreX = (item: WasteTextItem): number => item.x + item.width / 2;

/* ------------------------------------------------------------------------------ */
/* 1. the year                                                                     */
/* ------------------------------------------------------------------------------ */

function readYear(items: ReadonlyArray<WasteTextItem>): number | undefined {
  const quarters = new Set<string>();
  const years = new Set<number>();
  for (const item of items) {
    const match = QUARTER_TITLE.exec(item.str);
    if (match === null) continue;
    quarters.add(match[1]!);
    years.add(Number(match[2]));
  }
  if (quarters.size !== 4 || years.size !== 1) return undefined;
  return [...years][0];
}

/* ------------------------------------------------------------------------------ */
/* 2. + 3. the month blocks                                                        */
/* ------------------------------------------------------------------------------ */

/** One row of a valid block: the tours read per type (raw numbers, checked later) and whether a holiday name sits in it. */
interface BlockRow {
  readonly section: number;
  readonly date: string;
  readonly values: Readonly<Record<string, number>>;
  readonly holiday: boolean;
}

/** A month block that passed the calendar check. */
interface ValidBlock {
  readonly section: number;
  readonly x: number;
  readonly rows: ReadonlyArray<BlockRow>;
}

/** The items of one section, by a cheap index. */
function bySection(items: ReadonlyArray<WasteTextItem>): Map<number, WasteTextItem[]> {
  const sections = new Map<number, WasteTextItem[]>();
  for (const item of items) {
    const list = sections.get(item.section);
    if (list === undefined) sections.set(item.section, [item]);
    else list.push(item);
  }
  return sections;
}

/** The header row of a month name: `R` nearest below it, then every column letter of that row (sorted by x). */
function headersOf(name: WasteTextItem, section: ReadonlyArray<WasteTextItem>): WasteTextItem[] | undefined {
  const inWindow = (item: WasteTextItem): boolean =>
    item.str in COLUMN_CATEGORY && item.y < name.y && name.y - item.y <= 25 && item.x >= name.x - 25 && item.x <= name.x + 70;
  const rs = section.filter((item) => item.str === "R" && inWindow(item)).sort((a, b) => b.y - a.y || compareWasteItems(a, b));
  const r = rs[0];
  if (r === undefined) return undefined;
  const row = section.filter((item) => inWindow(item) && Math.abs(item.y - r.y) <= 3).sort((a, b) => a.x - b.x || compareWasteItems(a, b));
  const letters = row.map((item) => item.str);
  if (new Set(letters).size !== letters.length) return undefined;
  return row;
}

/** Reads one month block of a section; `undefined` when it is not a valid block of `month` in `year`. */
function readBlock(
  name: WasteTextItem,
  section: ReadonlyArray<WasteTextItem>,
  year: number,
): ValidBlock | undefined {
  const month = MONTHS.indexOf(name.str as (typeof MONTHS)[number]) + 1;
  const headers = headersOf(name, section);
  if (headers === undefined) return undefined;
  const r = headers.find((item) => item.str === "R")!;
  const headerY = r.y;

  // The day column: two-digit items left of R (its rows run down from the header).
  const dayItems = section
    .filter((item) => DAY_NUMBER.test(item.str) && item.y < headerY - 3 && item.x >= r.x - 50 && item.x <= r.x - 28)
    .sort(compareWasteItems);
  const length = daysInCalendarMonth(year, month);
  const days = new Map<number, WasteTextItem>();
  for (const item of dayItems) {
    const day = Number(item.str);
    if (day < 1 || day > length || days.has(day)) return undefined;
    days.set(day, item);
  }
  if (days.size !== length) return undefined;

  // The row pitch, from the block's own day items: rows run downwards in day order.
  const gaps: number[] = [];
  for (let day = 1; day < length; day += 1) gaps.push(days.get(day)!.y - days.get(day + 1)!.y);
  const pitch = median(gaps);
  if (!(pitch > 0) || gaps.some((gap) => gap <= 0)) return undefined;
  const half = pitch / 2;

  // The calendar check: each row's weekday item is the real weekday of that date.
  for (const [day, item] of days) {
    const weekdays = section.filter(
      (other) => WEEKDAY_TOKEN.test(other.str) && Math.abs(other.y - item.y) < half && other.x > item.x && other.x < r.x,
    );
    if (weekdays.length !== 1) return undefined;
    const real = calendarWeekday(formatCalendarDate(year, month, day));
    if (WEEKDAY_TOKEN.exec(weekdays[0]!.str)![1] !== WEEKDAYS[real]) return undefined;
  }

  // The column cells: from a header's x to the next header's x of THIS block; the last one a median gap wide.
  const headerGaps = headers.slice(1).map((item, index) => item.x - headers[index]!.x);
  const lastWidth = headerGaps.length > 0 ? median(headerGaps) : 14;
  const cells = headers.map((item, index) => ({
    letter: item.str,
    from: item.x,
    to: index + 1 < headers.length ? headers[index + 1]!.x : item.x + lastWidth,
  }));
  const areaFrom = cells[0]!.from;
  const areaTo = cells[cells.length - 1]!.to;

  const rows: BlockRow[] = [];
  for (let day = 1; day <= length; day += 1) {
    const rowY = days.get(day)!.y;
    const inBand = section.filter((item) => item.y >= rowY - half && item.y < rowY + half);
    const values: Record<string, number> = {};
    const seen = new Map<string, number>();
    for (const item of inBand.filter((other) => TOUR_DIGITS.test(other.str))) {
      const cx = centreX(item);
      const cell = cells.find((candidate) => cx >= candidate.from && cx < candidate.to);
      if (cell === undefined) continue;
      seen.set(cell.letter, (seen.get(cell.letter) ?? 0) + 1);
      values[cell.letter] = Number(item.str);
    }
    // Two digit items in one cell are no tour this parser understands.
    for (const [letter, count] of seen) if (count > 1) values[letter] = Number.NaN;
    const holiday = inBand.some(
      (item) =>
        HAS_LETTER.test(item.str) &&
        !(WEEKDAYS as ReadonlyArray<string>).includes(item.str) &&
        item.x < areaTo &&
        item.x + item.width > areaFrom,
    );
    rows.push({ section: name.section, date: formatCalendarDate(year, month, day), values, holiday });
  }
  return { section: name.section, x: name.x, rows };
}

/* ------------------------------------------------------------------------------ */
/* 6. the cleaning ranges                                                          */
/* ------------------------------------------------------------------------------ */

function readCleaning(items: ReadonlyArray<WasteTextItem>): Array<{ from: string; to: string }> {
  const ranges = new Map<string, { from: string; to: string }>();
  for (const item of items) {
    if (!/Reinigungstermine/.test(item.str)) continue;
    for (const match of item.str.matchAll(CLEANING_RANGE)) {
      const year = Number(match[5]);
      const from = formatCalendarDate(year, Number(match[2]), Number(match[1]));
      const to = formatCalendarDate(year, Number(match[4]), Number(match[3]));
      if (!isCalendarDate(from) || !isCalendarDate(to) || to < from) continue;
      ranges.set(`${from}/${to}`, { from, to });
    }
  }
  return [...ranges.values()].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}

/* ------------------------------------------------------------------------------ */
/* the parser                                                                      */
/* ------------------------------------------------------------------------------ */

const sameReading = (a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>): boolean => {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.is(a[key], b[key]));
};

/** The reading of a row as the wire record (column letters to waste types, in display order). */
function toDay(values: Readonly<Record<string, number>>): HattingenDay {
  const day: HattingenDay = {};
  for (const category of WASTE_CATEGORIES) {
    const letter = Object.keys(COLUMN_CATEGORY).find((key) => COLUMN_CATEGORY[key] === category)!;
    const value = values[letter];
    if (value !== undefined) day[category] = value;
  }
  return day;
}

/** Parses the flyer's text items (P19); never throws. */
export function parseHattingenFlyer(items: ReadonlyArray<WasteTextItem>): HattingenParse {
  const year = readYear(items);
  if (year === undefined) return { ok: false, check: "year" };

  // Every valid block of every section, in a fixed order (section, then x).
  const blocks: ValidBlock[] = [];
  for (const [, section] of [...bySection(items)].sort(([a], [b]) => a - b)) {
    const names = section
      .filter((item) => (MONTHS as ReadonlyArray<string>).includes(item.str))
      .sort(compareWasteItems);
    for (const name of names) {
      const block = readBlock(name, section, year);
      if (block !== undefined) blocks.push(block);
    }
  }
  blocks.sort((a, b) => a.section - b.section || a.x - b.x);

  // Consensus per date.
  const readings = new Map<string, BlockRow[]>();
  for (const block of blocks) {
    for (const row of block.rows) {
      const list = readings.get(row.date);
      if (list === undefined) readings.set(row.date, [row]);
      else list.push(row);
    }
  }
  const dates: string[] = [];
  for (let month = 1; month <= 12; month += 1) {
    for (let day = 1; day <= daysInCalendarMonth(year, month); day += 1) dates.push(formatCalendarDate(year, month, day));
  }
  const days = new Map<string, HattingenDay>();
  const holidays = new Set<string>();
  const warnings: HattingenWarning[] = [];
  for (const date of dates) {
    const rows = readings.get(date);
    if (rows === undefined || rows.length === 0) return { ok: false, check: "months", date };
    // Paint order: the section drawn LAST covers the others, so its reading is what the flyer shows.
    const topSection = Math.max(...rows.map((row) => row.section));
    const top = rows.filter((row) => row.section === topSection);
    const first = top[0]!;
    const other = top.find((row) => !sameReading(row.values, first.values));
    if (other !== undefined) {
      return { ok: false, check: "consensus", date, readings: [toDay(first.values), toDay(other.values)] };
    }
    if (rows.some((row) => row.section !== topSection && !sameReading(row.values, first.values))) {
      warnings.push({ code: "hiddenCopyDiffers", date });
    }
    if (first.holiday) holidays.add(date);
    days.set(date, toDay(first.values));
  }

  // Sanity.
  for (const [date, day] of days) {
    for (const tour of Object.values(day)) {
      if (!Number.isInteger(tour) || tour! < 1 || tour! > 9) return { ok: false, check: "values", date };
    }
  }
  for (const [date, day] of days) {
    const empty = Object.keys(day).length === 0;
    if (!empty && (calendarWeekday(date) === 6 || holidays.has(date))) return { ok: false, check: "sundays", date };
  }
  const restCounts = new Map<number, number>();
  for (const day of days.values()) {
    const tour = day.waste_rest;
    if (tour !== undefined) restCounts.set(tour, (restCounts.get(tour) ?? 0) + 1);
  }
  for (let tour = 1; tour <= 9; tour += 1) {
    if ((restCounts.get(tour) ?? 0) < 20) return { ok: false, check: "tourCount" };
  }

  return { ok: true, year, days, cleaning: readCleaning(items), warnings };
}

/**
 * The pickups of one tour (P19), by date then in `WASTE_CATEGORIES` order; a Biotonne pickup inside a cleaning range is
 * `bio_cleaning` ("Biotonne + Reinigung"). Empty when the tour has no date (the caller refuses with `noTourDates`).
 */
export function selectTour(flyer: HattingenFlyer, tour: number): HattingenPickup[] {
  const pickups: HattingenPickup[] = [];
  for (const [date, day] of flyer.days) {
    for (const category of WASTE_CATEGORIES) {
      if (day[category] !== tour) continue;
      const cleaning =
        category === "waste_bio" && flyer.cleaning.some((range) => date >= range.from && date <= range.to);
      pickups.push({ category, date, detail: cleaning ? "bio_cleaning" : null });
    }
  }
  return pickups;
}
