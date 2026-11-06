/**
 * M8-T18 (docs/plans/m8-calendar-module.md section 5.2, P24; the shape of `web-contract-finance.test.ts`): the contract
 * test of the calendar routes the web client decodes. A household with the calendar enabled, a second member and a
 * placeholder member (ADR 0006) is driven through the REAL app (`app.request`, the calendar harness, the shared test `db`,
 * ADR 0009); every export of `apps/web/src/modules/calendar/lib/api.ts` has a row. A JSON row asserts the status the client
 * expects, that `Schema.decodeUnknownSync(schema, { disableChecks: true })(body)` succeeds AND that the decoded value
 * `toEqual`s the body (nothing stripped, defaulted or transformed: plan e6 P7's identity oracle with the web's decode
 * options). A void row (`schema: null`, the three deletes) asserts its 204 only.
 *
 * The waste household is imported twice: from a LINK through the test seam `setWasteFlyerFetchForTests` (the runtime's
 * layer cannot be swapped in a route test; `makeTestWasteFlyerFetch` is the seam form of `WasteFlyerFetch.layerTest`, it
 * serves the committed flyer and never reaches the network) and from an UPLOAD of the same fixture as multipart `file` +
 * `tour`, the parts the web's `sendForm` sends. The occurrence list then carries waste pickups (category, `bio_cleaning`
 * detail), a done task, a skipped occurrence and a car booking.
 *
 * A row the oracle cannot satisfy would carry `lenient: { schema, reason }` ON ONE LINE and need `lenient(X)` in the
 * client (CLAUDE.md "One web runtime"); at M8 there is none.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Schema } from "effect";
import {
  CalendarEntryListResponseSchema,
  CalendarEntrySchema,
  CalendarOccurrenceListResponseSchema,
  CalendarOccurrenceSchema,
  CalendarResourceListResponseSchema,
  CalendarResourceSchema,
  CalendarWasteImportResponseSchema,
  CalendarWasteOverviewResponseSchema,
  CalendarWastePreviewSchema,
  CalendarWasteSettingsSchema,
  WASTE_PROVIDERS,
} from "@toon/shared";
import { db } from "../src/db/client.ts";
import { makeTestWasteFlyerFetch, setWasteFlyerFetchForTests } from "../src/modules/calendar/services/waste/fetch.ts";
import { runMigrations } from "./support/bridges/migrate.ts";
import {
  type TestUser,
  addMember,
  addPlaceholder,
  calendarPath,
  call,
  createCalendarHousehold,
  createUser,
} from "./support/calendar-harness.ts";
import { FLYER_PDF } from "./fixtures/calendar/record-items.ts";

await runMigrations(db);

afterAll(() => setWasteFlyerFetchForTests(null));

const OPTIONS = { disableChecks: true } as const;
/** The flyer parse runs pdf.js over six pages: an explicit budget, as the waste route tests give it. */
const SLOW = 120_000;
const FLYER = new Uint8Array(readFileSync(FLYER_PDF));
const URL_OK = WASTE_PROVIDERS.hattingen.defaultUrl;

interface Row {
  name: string;
  method?: string;
  path: string;
  body?: unknown;
  /** A multipart body (the web's `sendForm`): the parts in order; a `Blob` part is the file. */
  form?: Record<string, string | Blob>;
  status?: number;
  /** The shared schema the web client decodes with; `null` for a void route (204). */
  schema: Schema.Top | null;
  /** ON ONE LINE; the schema the client passes as `lenient(...)` and why. */
  lenient?: { schema: string; reason: string };
}

const rows: string[] = [];
const lenientRows: string[] = [];

async function send(user: TestUser, row: Row): Promise<Response> {
  if (!row.form) return call(row.path, { method: row.method ?? "GET", cookie: user.cookie, body: row.body });
  const { app } = await import("../src/index.ts");
  const form = new FormData();
  for (const [key, value] of Object.entries(row.form)) {
    if (typeof value === "string") form.append(key, value);
    else form.append(key, value, "Abfall 2027.pdf");
  }
  return app.request(row.path, { method: row.method ?? "POST", headers: { Cookie: user.cookie }, body: form });
}

/** Runs one row as the given user: status, decode with the web's options, identity. Returns the body. */
async function check(user: TestUser, row: Row): Promise<any> {
  const response = await send(user, row);
  const text = await response.text();
  const expected = row.status ?? (row.schema === null ? 204 : 200);
  expect(response.status, `${row.name}: ${row.method ?? "GET"} ${row.path} -> ${text}`).toBe(expected);
  rows.push(row.name);
  if (row.schema === null) {
    expect(text, `${row.name}: a void route answers no body`).toBe("");
    return undefined;
  }
  const payload = JSON.parse(text) as unknown;
  if (row.lenient) {
    lenientRows.push(`${row.name} (${row.lenient.schema}): ${row.lenient.reason}`);
    return payload;
  }
  const decoded = Schema.decodeUnknownSync(row.schema as Schema.Decoder<unknown>, OPTIONS)(payload);
  expect(decoded, `${row.name}: decoded is not the body`).toEqual(payload);
  return payload;
}

const pdf = () => new Blob([FLYER], { type: "application/pdf" });

describe("calendar contract: the routes the web client decodes", () => {
  test(
    "every route of the calendar client decodes to the body",
    async () => {
      const owner = await createUser("CalOwner");
      const robin = await createUser("CalRobin");
      const householdId = await createCalendarHousehold(owner, "Kalender-Vertrag");
      await addMember(owner, householdId, robin);
      const placeholderId = await addPlaceholder(owner, householdId, "Oma");
      const base = (rest: string) => calendarPath(householdId, rest);

      // resources
      const car = await check(owner, {
        name: "createResource",
        method: "POST",
        path: base("/resources"),
        body: { name: "Familienauto" },
        status: 201,
        schema: CalendarResourceSchema,
      });
      const spare = await check(owner, {
        name: "createResource (second)",
        method: "POST",
        path: base("/resources"),
        body: { name: "Zweitwagen" },
        status: 201,
        schema: CalendarResourceSchema,
      });
      const archived = await check(owner, {
        name: "updateResource (archive)",
        method: "PATCH",
        path: base(`/resources/${spare.id}`),
        body: { archived: true },
        schema: CalendarResourceSchema,
      });
      expect(archived.archived).toBe(true);
      expect(typeof archived.archivedAt).toBe("string");
      await check(owner, { name: "fetchResources", path: base("/resources"), schema: CalendarResourceListResponseSchema });
      const all = await check(owner, {
        name: "fetchResources (includeArchived)",
        path: base("/resources?includeArchived=true"),
        schema: CalendarResourceListResponseSchema,
      });
      expect(all.items).toHaveLength(2);

      // entries: an all-day event for everybody, a timed event with an open end and attendees, a rotating weekly task,
      // a fixed task, a car booking, a multi-day event
      const event = await check(owner, {
        name: "createEntry (event, all day, Alle)",
        method: "POST",
        path: base("/entries"),
        body: { kind: "event", title: "Sommerfest", allDay: true, startDate: "2027-06-12", location: "Garten", notes: "Grill" },
        status: 201,
        schema: CalendarEntrySchema,
      });
      await check(owner, {
        name: "createEntry (event, timed, no end)",
        method: "POST",
        path: base("/entries"),
        body: { kind: "event", title: "Zahnarzt", allDay: false, startDate: "2027-06-10", startTime: "09:30", attendeeIds: [robin.id] },
        status: 201,
        schema: CalendarEntrySchema,
      });
      await check(owner, {
        name: "createEntry (event, multi-day)",
        method: "POST",
        path: base("/entries"),
        body: { kind: "event", title: "Urlaub", allDay: true, startDate: "2027-06-14", endDate: "2027-06-18", attendeeIds: [owner.id, placeholderId] },
        status: 201,
        schema: CalendarEntrySchema,
      });
      const rotation = await check(owner, {
        name: "createEntry (task, weekly rotation)",
        method: "POST",
        path: base("/entries"),
        body: {
          kind: "task",
          title: "Blumen gießen",
          allDay: true,
          startDate: "2027-06-07",
          repeat: { freq: "weekly", interval: 1, weekdays: ["MO", "TH"] },
          assigneeMode: "rotate",
          assigneeIds: [owner.id, robin.id, placeholderId],
        },
        status: 201,
        schema: CalendarEntrySchema,
      });
      await check(owner, {
        name: "createEntry (task, monthly until, fixed)",
        method: "POST",
        path: base("/entries"),
        body: {
          kind: "task",
          title: "Filter wechseln",
          allDay: false,
          startDate: "2027-01-31",
          startTime: "18:00",
          endTime: "18:30",
          repeat: { freq: "monthly", interval: 1, until: "2027-12-31" },
          assigneeMode: "fixed",
          assigneeIds: [robin.id],
        },
        status: 201,
        schema: CalendarEntrySchema,
      });
      const booking = await check(owner, {
        name: "createEntry (car)",
        method: "POST",
        path: base("/entries"),
        body: {
          kind: "car",
          title: "Einkauf",
          allDay: false,
          startDate: "2027-06-11",
          startTime: "08:00",
          endTime: "12:00",
          attendeeIds: [robin.id],
          resourceId: car.id,
        },
        status: 201,
        schema: CalendarEntrySchema,
      });
      await check(owner, {
        name: "createEntry (car, conflicting, allowConflict)",
        method: "POST",
        path: base("/entries"),
        body: {
          kind: "car",
          title: "Baumarkt",
          allDay: true,
          startDate: "2027-06-11",
          attendeeIds: [owner.id],
          resourceId: car.id,
          allowConflict: true,
        },
        status: 201,
        schema: CalendarEntrySchema,
      });
      await check(owner, {
        name: "updateEntry",
        method: "PATCH",
        path: base(`/entries/${event.id}`),
        body: { notes: null, location: null, attendeeIds: [owner.id] },
        schema: CalendarEntrySchema,
      });
      await check(robin, {
        name: "updateEntry (car, member)",
        method: "PATCH",
        path: base(`/entries/${booking.id}`),
        body: { notes: "Tank leer" },
        schema: CalendarEntrySchema,
      });
      await check(owner, { name: "fetchEntry", path: base(`/entries/${rotation.id}`), schema: CalendarEntrySchema });
      const entries = await check(owner, { name: "fetchEntries", path: base("/entries"), schema: CalendarEntryListResponseSchema });
      expect(entries.items.length).toBeGreaterThanOrEqual(7);
      const tasks = await check(owner, {
        name: "fetchEntries (kind=task, recurring=true)",
        path: base("/entries?kind=task&recurring=true"),
        schema: CalendarEntryListResponseSchema,
      });
      expect(tasks.items).toHaveLength(2);

      // occurrence states
      const done = await check(robin, {
        name: "setOccurrenceStatus (done)",
        method: "PUT",
        path: base(`/entries/${rotation.id}/occurrences/2027-06-10`),
        body: { status: "done" },
        schema: CalendarOccurrenceSchema,
      });
      expect(done.doneBy).toBe(robin.id);
      await check(owner, {
        name: "setOccurrenceStatus (skipped)",
        method: "PUT",
        path: base(`/entries/${rotation.id}/occurrences/2027-06-14`),
        body: { status: "skipped" },
        schema: CalendarOccurrenceSchema,
      });
      await check(owner, {
        name: "setOccurrenceStatus (done, then reset)",
        method: "PUT",
        path: base(`/entries/${rotation.id}/occurrences/2027-06-17`),
        body: { status: "done" },
        schema: CalendarOccurrenceSchema,
      });
      const reset = await check(owner, {
        name: "setOccurrenceStatus (reset)",
        method: "PUT",
        path: base(`/entries/${rotation.id}/occurrences/2027-06-17`),
        body: { status: null },
        schema: CalendarOccurrenceSchema,
      });
      expect(reset.status).toBe("open");
      expect(reset.doneBy).toBeNull();

      // waste: settings, preview and import from a link (the seam) and from an upload
      setWasteFlyerFetchForTests(makeTestWasteFlyerFetch(new Map([[URL_OK, FLYER]])));
      const empty = await check(owner, { name: "fetchWaste (nothing imported)", path: base("/waste?from=2027-06-01"), schema: CalendarWasteOverviewResponseSchema });
      expect(empty.settings).toBeNull();
      const preview = await check(owner, {
        name: "previewWasteFromUrl",
        method: "POST",
        path: base("/waste/preview"),
        body: { provider: "hattingen", tour: 4, url: URL_OK },
        schema: CalendarWastePreviewSchema,
      });
      expect(preview.year).toBe(2027);
      const fromUrl = await check(owner, {
        name: "importWasteFromUrl",
        method: "POST",
        path: base("/waste/import"),
        body: { provider: "hattingen", tour: 4, url: URL_OK },
        status: 201,
        schema: CalendarWasteImportResponseSchema,
      });
      expect(fromUrl.import.source).toBe("url");
      await check(owner, {
        name: "putWasteSettings (rotate)",
        method: "PUT",
        path: base("/waste/settings"),
        body: { provider: "hattingen", tour: 4, assigneeMode: "rotate", assigneeIds: [robin.id, owner.id], today: "2027-06-01" },
        schema: CalendarWasteSettingsSchema,
      });
      await check(owner, {
        name: "previewWasteFromFile",
        form: { file: pdf(), tour: "4" },
        path: base("/waste/preview"),
        schema: CalendarWastePreviewSchema,
      });
      const fromFile = await check(owner, {
        name: "importWasteFromFile",
        form: { file: pdf(), tour: "4" },
        path: base("/waste/import"),
        status: 201,
        schema: CalendarWasteImportResponseSchema,
      });
      expect(fromFile.import.source).toBe("upload");
      const overview = await check(owner, { name: "fetchWaste", path: base("/waste?from=2027-06-01"), schema: CalendarWasteOverviewResponseSchema });
      expect(overview.imports).toHaveLength(1);
      expect(overview.next.length).toBeGreaterThan(0);
      expect(overview.settings.assigneeMode).toBe("rotate");

      // occurrences: the whole mix, the bio cleaning weeks (2027-07-01) and the filters
      const occurrences = await check(owner, {
        name: "fetchOccurrences",
        path: base("/occurrences?from=2027-06-01&to=2027-07-31"),
        schema: CalendarOccurrenceListResponseSchema,
      });
      const kinds = new Set(occurrences.items.map((o: { kind: string }) => o.kind));
      expect([...kinds].sort()).toEqual(["car", "event", "task"]);
      expect(occurrences.items.some((o: { category: string | null }) => o.category === "waste_rest")).toBe(true);
      expect(occurrences.items.some((o: { status: string | null }) => o.status === "skipped")).toBe(true);
      expect(occurrences.members.some((m: { userId: string; hasAccount: boolean }) => m.userId === placeholderId && !m.hasAccount)).toBe(true);
      await check(owner, {
        name: "fetchOccurrences (memberId, kind)",
        path: base(`/occurrences?from=2027-06-01&to=2027-06-30&memberId=${robin.id}&kind=task`),
        schema: CalendarOccurrenceListResponseSchema,
      });
      const year = await check(owner, {
        name: "fetchOccurrences (a whole year of pickups)",
        path: base("/occurrences?from=2027-01-01&to=2027-12-31&kind=task"),
        schema: CalendarOccurrenceListResponseSchema,
      });
      expect(year.items.some((o: { categoryDetail: string | null }) => o.categoryDetail === "bio_cleaning")).toBe(true);

      // the void routes
      await check(owner, { name: "deleteWasteImport", method: "DELETE", path: base(`/waste/imports/${fromFile.import.id}`), schema: null });
      await check(owner, { name: "deleteEntry", method: "DELETE", path: base(`/entries/${event.id}`), schema: null });
      await check(owner, { name: "deleteResource", method: "DELETE", path: base(`/resources/${spare.id}`), schema: null });
      const after = await check(owner, { name: "fetchWaste (after delete)", path: base("/waste?from=2027-06-01"), schema: CalendarWasteOverviewResponseSchema });
      expect(after.imports).toEqual([]);
    },
    SLOW,
  );

  test("the rows cover every export of the calendar client", async () => {
    const source = await Bun.file(new URL("../../web/src/modules/calendar/lib/api.ts", import.meta.url)).text();
    // Each `export function` up to the `{` that opens its body (a default `= {}` is followed by `,`, never a newline);
    // a facade is one that returns `Promise<X>` (not `calendarBase`).
    const all = [...source.matchAll(/export function (\w+)\([\s\S]*?\):\s*([^\n]+?)\s*\{\n/g)]
      .map((m) => [m[0], m[1]!, /^Promise<(\w+)>$/.exec(m[2]!)?.[1]] as const)
      .filter((m) => m[2] !== undefined);
    const voidExports = all.filter((m) => m[2] === "void").map((m) => m[1]!);
    // plan m8 section 5.4: 18 members, three of them void deletes.
    expect(all.length).toBe(18);
    expect(voidExports.sort()).toEqual(["deleteEntry", "deleteResource", "deleteWasteImport"]);
    const covered = rows.map((row) => row.split(" ")[0]);
    for (const [, fn] of all) {
      expect(covered, `no contract row for ${fn}`).toContain(fn!);
    }
    expect(lenientRows).toEqual([]);
    console.log(`[web-contract-calendar] ${rows.length} rows, ${lenientRows.length} lenient`);
  });
});
