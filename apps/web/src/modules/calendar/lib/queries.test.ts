/** The optimistic done toggle over every cached list, its rollback, and the online-only rule (plan m8 P24). */
import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import type { CalendarOccurrence, CalendarOccurrenceListResponse } from "@toon/shared";
import { applyOccurrenceStatus, calendarKeys, canWriteNow, feedQuery, restoreOccurrences, withStatus } from "./queries";

const H = "h1";
const ENTRY = "11111111-1111-4111-8111-111111111111";

function occurrence(date: string, entryId = ENTRY): CalendarOccurrence {
  return {
    id: `${entryId}:${date}`,
    entryId,
    kind: "task",
    title: "Blumen",
    category: null,
    categoryDetail: null,
    date,
    endDate: date,
    allDay: true,
    startTime: null,
    endTime: null,
    location: null,
    recurring: true,
    memberIds: [],
    assigneeId: "a",
    resourceId: null,
    status: "open",
    doneBy: null,
  };
}

const list = (...items: CalendarOccurrence[]): CalendarOccurrenceListResponse => ({ items, members: [] });

describe("the optimistic toggle", () => {
  test("done marks the occurrence in EVERY cached list of the household, and only there", () => {
    const qc = new QueryClient();
    const agenda = calendarKeys.occurrences(H, "2026-11-04", "2026-11-24");
    const month = calendarKeys.occurrences(H, "2026-10-26", "2026-12-06", { kind: "task" });
    const elsewhere = calendarKeys.occurrences("h2", "2026-11-04", "2026-11-24");
    const unrelated = calendarKeys.occurrences(H, "2027-01-01", "2027-01-14");
    qc.setQueryData(agenda, list(occurrence("2026-11-12"), occurrence("2026-11-15")));
    qc.setQueryData(month, list(occurrence("2026-11-12")));
    qc.setQueryData(elsewhere, list(occurrence("2026-11-12")));
    const unrelatedData = list(occurrence("2027-01-02"));
    qc.setQueryData(unrelated, unrelatedData);

    const snapshot = applyOccurrenceStatus(qc, H, { entryId: ENTRY, date: "2026-11-12", status: "done" }, "me");

    const agendaItems = qc.getQueryData<CalendarOccurrenceListResponse>(agenda)?.items ?? [];
    expect(agendaItems.map((o) => [o.status, o.doneBy])).toEqual([
      ["done", "me"],
      ["open", null],
    ]);
    expect(qc.getQueryData<CalendarOccurrenceListResponse>(month)?.items[0]?.status).toBe("done");
    expect(qc.getQueryData<CalendarOccurrenceListResponse>(elsewhere)?.items[0]?.status).toBe("open");
    expect(qc.getQueryData<CalendarOccurrenceListResponse>(unrelated)).toBe(unrelatedData);

    restoreOccurrences(qc, snapshot);
    expect(qc.getQueryData<CalendarOccurrenceListResponse>(agenda)?.items[0]?.status).toBe("open");
    expect(qc.getQueryData<CalendarOccurrenceListResponse>(month)?.items[0]?.status).toBe("open");
  });

  test("withStatus: skipped and reset clear doneBy", () => {
    const done = withStatus(occurrence("2026-11-12"), "done", "me");
    expect([done.status, done.doneBy]).toEqual(["done", "me"]);
    expect([withStatus(done, "skipped", "me").status, withStatus(done, "skipped", "me").doneBy]).toEqual(["skipped", null]);
    expect([withStatus(done, null, "me").status, withStatus(done, null, "me").doneBy]).toEqual(["open", null]);
  });
});

describe("writes are online only", () => {
  test("canWriteNow follows the online state", () => {
    expect(canWriteNow(true)).toBe(true);
    expect(canWriteNow(false)).toBe(false);
  });

  test("the feed query is never fresh: lastUsedAt is refetched on every mount (M9-T09 review)", () => {
    const options = feedQuery(H);
    expect(options.staleTime).toBe(0);
    expect<readonly unknown[]>(options.queryKey).toEqual([...calendarKeys.feed(H)]);
  });

  test("the feed key (plan m9 P17) sits below the module prefix", () => {
    expect<readonly unknown[]>(calendarKeys.feed(H)).toEqual(["toon", "household", H, "calendar", "feed"]);
    expect(calendarKeys.feed(H).slice(0, 4)).toEqual([...calendarKeys.all(H)]);
  });

  test("the occurrence root is a prefix of every occurrence key and below the module prefix", () => {
    const root = calendarKeys.occurrencesRoot(H);
    expect(calendarKeys.occurrences(H, "a", "b").slice(0, root.length)).toEqual([...root]);
    expect(root.slice(0, 4)).toEqual([...calendarKeys.all(H)]);
  });
});
