/**
 * The calendar client against a stubbed `fetch` (plan m8 M8-T13, as `modules/finance/lib/api.test.ts`): every
 * endpoint's method and path with ids kept inside one segment, the query strings, the multipart upload with its
 * `tour` part, a READ decoded with the shared schema and refused on a mismatch, a WRITE passing its body through.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { CalendarOccurrenceListResponse } from "@toon/shared";
import {
  createEntry,
  createResource,
  deleteEntry,
  deleteResource,
  deleteWasteImport,
  fetchEntries,
  fetchEntry,
  fetchOccurrences,
  fetchResources,
  fetchWaste,
  importWasteFromFile,
  importWasteFromUrl,
  isApiError,
  previewWasteFromFile,
  previewWasteFromUrl,
  putWasteSettings,
  setOccurrenceStatus,
  updateEntry,
  updateResource,
} from "./api";

const realFetch = globalThis.fetch;
let calls: Array<{ url: string; method: string; body: unknown }> = [];

function stub(body: unknown = null, status = 204): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? "GET", body: init?.body ?? null });
    return body === null
      ? new Response(null, { status })
      : new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  calls = [];
  stub();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function pathOf(index = 0): string {
  const call = calls[index];
  if (!call) throw new Error("no request recorded");
  const url = new URL(call.url);
  return url.pathname + url.search;
}

const H = "h/1";
const BASE = "/api/households/h%2F1/calendar";

describe("every endpoint: method and path (ids stay inside one segment)", () => {
  test("occurrences", async () => {
    await fetchOccurrences(H, "2026-11-11", "2026-11-24", { memberId: "u/1", kind: "task" }).catch(() => undefined);
    await setOccurrenceStatus(H, "e/1", "2026-11-12", { status: "done" }).catch(() => undefined);
    expect(pathOf(0)).toBe(`${BASE}/occurrences?from=2026-11-11&to=2026-11-24&memberId=u%2F1&kind=task`);
    expect(calls[1]).toMatchObject({ method: "PUT", body: JSON.stringify({ status: "done" }) });
    expect(pathOf(1)).toBe(`${BASE}/entries/e%2F1/occurrences/2026-11-12`);
  });

  test("entries", async () => {
    await fetchEntries(H, { kind: "task", recurring: "true" }).catch(() => undefined);
    await fetchEntry(H, "e/1").catch(() => undefined);
    await createEntry(H, { kind: "event", title: "Zahnarzt", allDay: true, startDate: "2026-11-12" });
    await updateEntry(H, "e/1", { notes: "x" });
    await deleteEntry(H, "e/1");
    expect(pathOf(0)).toBe(`${BASE}/entries?kind=task&recurring=true`);
    expect(pathOf(1)).toBe(`${BASE}/entries/e%2F1`);
    expect(calls.slice(2).map((call) => call.method)).toEqual(["POST", "PATCH", "DELETE"]);
    expect(pathOf(2)).toBe(`${BASE}/entries`);
    expect(pathOf(3)).toBe(`${BASE}/entries/e%2F1`);
    expect(pathOf(4)).toBe(`${BASE}/entries/e%2F1`);
  });

  test("resources", async () => {
    await fetchResources(H).catch(() => undefined);
    await fetchResources(H, true).catch(() => undefined);
    await createResource(H, { name: "Familienauto" });
    await updateResource(H, "r/1", { archived: true });
    await deleteResource(H, "r/1");
    expect(pathOf(0)).toBe(`${BASE}/resources`);
    expect(pathOf(1)).toBe(`${BASE}/resources?includeArchived=true`);
    expect(calls.slice(2).map((call) => [call.method, pathOf(calls.indexOf(call))])).toEqual([
      ["POST", `${BASE}/resources`],
      ["PATCH", `${BASE}/resources/r%2F1`],
      ["DELETE", `${BASE}/resources/r%2F1`],
    ]);
  });

  test("waste: overview, settings, JSON source, delete", async () => {
    await fetchWaste(H, "2026-11-11").catch(() => undefined);
    await putWasteSettings(H, { provider: "hattingen", tour: 4, assigneeMode: "none", assigneeIds: [], today: "2026-11-11" });
    await previewWasteFromUrl(H, { tour: 4, url: "https://www.hattingen.de/x.pdf" });
    await importWasteFromUrl(H, { tour: 4, url: "https://www.hattingen.de/x.pdf" });
    await deleteWasteImport(H, "i/1");
    expect(pathOf(0)).toBe(`${BASE}/waste?from=2026-11-11`);
    expect(calls.slice(1).map((call) => [call.method, pathOf(calls.indexOf(call))])).toEqual([
      ["PUT", `${BASE}/waste/settings`],
      ["POST", `${BASE}/waste/preview`],
      ["POST", `${BASE}/waste/import`],
      ["DELETE", `${BASE}/waste/imports/i%2F1`],
    ]);
    expect(calls[2]?.body).toBe(JSON.stringify({ tour: 4, url: "https://www.hattingen.de/x.pdf" }));
  });

  test("waste: the PDF upload is multipart with `file` and `tour`", async () => {
    const file = new File([new Uint8Array([37, 80, 68, 70, 45])], "AbfallFlyer 2027.pdf", { type: "application/pdf" });
    await previewWasteFromFile(H, file, 4);
    await importWasteFromFile(H, file, 9);
    for (const [index, tour] of [
      [0, "4"],
      [1, "9"],
    ] as const) {
      const form = calls[index]?.body;
      expect(form).toBeInstanceOf(FormData);
      expect((form as FormData).get("tour")).toBe(tour);
      expect(((form as FormData).get("file") as File).name).toBe("AbfallFlyer 2027.pdf");
    }
    expect(pathOf(0)).toBe(`${BASE}/waste/preview`);
    expect(pathOf(1)).toBe(`${BASE}/waste/import`);
  });
});

describe("decoding (plan e6 P7, P7a)", () => {
  const list: CalendarOccurrenceListResponse = {
    items: [
      {
        id: "11111111-1111-4111-8111-111111111111:2026-11-12",
        entryId: "11111111-1111-4111-8111-111111111111",
        kind: "task",
        title: null,
        category: "waste_rest",
        categoryDetail: null,
        date: "2026-11-12",
        endDate: "2026-11-12",
        allDay: true,
        startTime: null,
        endTime: null,
        location: null,
        recurring: false,
        memberIds: [],
        assigneeId: "22222222-2222-4222-8222-222222222222",
        resourceId: null,
        status: "done",
        doneBy: "22222222-2222-4222-8222-222222222222",
      },
    ],
    members: [{ userId: "22222222-2222-4222-8222-222222222222", name: "Kim", colorIndex: 3, hasAccount: false }],
  };

  test("a READ round-trips the occurrence list to the wire value", async () => {
    stub(list, 200);
    expect(await fetchOccurrences("h", "2026-11-11", "2026-11-24")).toEqual(list);
  });

  test("a READ whose body does not match is invalid_response", async () => {
    stub({ items: [{ id: 1 }] }, 200);
    let failure: unknown;
    try {
      await fetchOccurrences("h", "2026-11-11", "2026-11-24");
    } catch (error) {
      failure = error;
    }
    expect(isApiError(failure) && failure.code).toBe("invalid_response");
  });

  test("a WRITE never fails on its 2xx answer", async () => {
    stub({ unexpected: true }, 201);
    expect(await createResource("h", { name: "Golf" })).toEqual({ unexpected: true } as never);
  });

  test("a 409 car conflict arrives as the tagged ApiError with its details", async () => {
    const details = [{ entryId: "e", date: "2026-11-12", startTime: "08:00", endTime: "17:00", title: null, memberIds: ["r"] }];
    stub({ error: { code: "calendar_car_conflict", message: "Das Auto ist schon gebucht.", details } }, 409);
    let failure: unknown;
    try {
      await createEntry("h", { kind: "car", title: "Einkauf", allDay: false, startDate: "2026-11-12", startTime: "09:00", endTime: "10:00" });
    } catch (error) {
      failure = error;
    }
    expect(isApiError(failure)).toBe(true);
    if (isApiError(failure)) {
      expect(failure.status).toBe(409);
      expect(failure.code).toBe("calendar_car_conflict");
      expect(failure.details).toEqual(details);
    }
  });
});
