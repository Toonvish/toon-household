/**
 * The waste routes (plan m8 section 5.2, P15-P17, P20; M8-T12) through the real app on the shared db: the upload and
 * URL paths of preview and import (the URL through the seam `setWasteFlyerFetchForTests`, never the network), every
 * refusal of P17 (400, 413, 415, 422 at path `file`, 422 `calendar_waste_unparseable`, 502), preview writing nothing,
 * the settings and the overview, the import delete, and `email_unverified` on the writes.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  CalendarWasteImportResponseSchema,
  CalendarWasteOverviewResponseSchema,
  CalendarWastePreviewSchema,
  CalendarWasteSettingsSchema,
  DEFAULT_LOCALE,
  WASTE_PROVIDERS,
  serverText,
} from "@toon/shared";
import { eq } from "drizzle-orm";
import { Schema } from "effect";
import { setVerifiedEmailRequired } from "../src/core/services/auth/verifiedEmail.ts";
import { db } from "../src/db/client.ts";
import { migrateDatabase } from "../src/db/migrate.ts";
import { calendarWasteImports, users } from "../src/db/schema.ts";
import { makeTestWasteFlyerFetch, setWasteFlyerFetchForTests } from "../src/modules/calendar/services/waste/fetch.ts";
import { type TestUser, addMember, body, calendarPath, call, createCalendarHousehold, createUser } from "./support/calendar-harness.ts";
import { runTest } from "./support/effect.ts";
import { FLYER_PDF } from "./fixtures/calendar/record-items.ts";

const SLOW = 60_000;
const FLYER = new Uint8Array(readFileSync(FLYER_PDF));
const URL_OK = WASTE_PROVIDERS.hattingen.defaultUrl;

interface ErrorBody {
  error: { code: string; message: string; details?: Array<Record<string, unknown>> };
}

/** A multipart POST through the in-memory app (the browser's FormData shape). */
async function postForm(path: string, cookie: string, fields: Record<string, string | Blob>, fileName = "Abfall 2027.pdf") {
  const { app } = await import("../src/index.ts");
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === "string") form.append(key, value);
    else form.append(key, value, fileName);
  }
  return app.request(path, { method: "POST", headers: { Cookie: cookie }, body: form });
}

const pdfBlob = (bytes: Uint8Array = FLYER) => new Blob([bytes], { type: "application/pdf" });

/** A tiny valid PDF with no flyer in it (one empty page). */
function emptyPdf(): Uint8Array {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>"];
  let text = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(text.length);
    text += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = text.length;
  text += `xref\n0 4\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  text += `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(text);
}

/** The web's read decode (`disableChecks`): structure and types; the identity on the wire (E6). */
const decodes = (schema: Schema.Decoder<unknown, never>, value: unknown): unknown =>
  Schema.decodeUnknownSync(schema)(value, { disableChecks: true });

let owner: TestUser;
let robin: TestUser;
let householdId: string;

beforeAll(async () => {
  await runTest(migrateDatabase());
  owner = await createUser("waste-route-owner");
  robin = await createUser("waste-route-robin");
  householdId = await createCalendarHousehold(owner, "Waste routes");
  await addMember(owner, householdId, robin);
});

afterEach(() => setWasteFlyerFetchForTests(null));
afterAll(() => setVerifiedEmailRequired(null));

const importsOf = (id: string) => db.select().from(calendarWasteImports).where(eq(calendarWasteImports.householdId, id));

describe("POST …/waste/preview", () => {
  test(
    "an upload previews tour 4 and writes nothing",
    async () => {
      const response = await postForm(calendarPath(householdId, "/waste/preview"), owner.cookie, { tour: "4", file: pdfBlob() });
      expect(response.status).toBe(200);
      const preview = await body<Record<string, unknown>>(response);
      expect(decodes(CalendarWastePreviewSchema, preview)).toEqual(preview);
      expect(preview).toMatchObject({
        provider: "hattingen",
        year: 2027,
        tour: 4,
        counts: { waste_rest: 26, waste_yellow: 26, waste_bio: 27, waste_paper: 14, waste_tree: 1 },
      });
      expect((preview.dates as unknown[]).length).toBe(94);
      expect((preview.warnings as Array<{ code: string }>).every((warning) => warning.code === "hiddenCopyDiffers")).toBe(true);
      expect(await importsOf(householdId)).toEqual([]);
    },
    SLOW,
  );

  test(
    "a link previews through the fetch (test seam); the default URL works",
    async () => {
      setWasteFlyerFetchForTests(makeTestWasteFlyerFetch(new Map([[URL_OK, FLYER]])));
      const response = await call(calendarPath(householdId, "/waste/preview"), {
        method: "POST",
        cookie: owner.cookie,
        body: { tour: 9, url: URL_OK },
      });
      expect(response.status).toBe(200);
      expect(await body(response)).toMatchObject({ tour: 9, year: 2027 });
    },
    SLOW,
  );

  test("an http or foreign link is 400 calendar_waste_source_refused", async () => {
    for (const url of [URL_OK.replace("https:", "http:"), "https://example.com/flyer.pdf"]) {
      const response = await call(calendarPath(householdId, "/waste/preview"), { method: "POST", cookie: owner.cookie, body: { tour: 4, url } });
      expect(response.status).toBe(400);
      expect((await body<ErrorBody>(response)).error.code).toBe("calendar_waste_source_refused");
    }
  });

  test("a link the city does not answer is 502 calendar_waste_fetch_failed with its reason", async () => {
    setWasteFlyerFetchForTests(makeTestWasteFlyerFetch(new Map()));
    const response = await call(calendarPath(householdId, "/waste/preview"), { method: "POST", cookie: owner.cookie, body: { tour: 4, url: URL_OK } });
    expect(response.status).toBe(502);
    expect((await body<ErrorBody>(response)).error).toMatchObject({ code: "calendar_waste_fetch_failed", details: [{ reason: "status" }] });
  });

  test("fetched bytes that are no PDF are 422 calendar_waste_unparseable (notPdf)", async () => {
    setWasteFlyerFetchForTests(makeTestWasteFlyerFetch(new Map([[URL_OK, new TextEncoder().encode("<html>moved</html>")]])));
    const response = await call(calendarPath(householdId, "/waste/preview"), { method: "POST", cookie: owner.cookie, body: { tour: 4, url: URL_OK } });
    expect(response.status).toBe(422);
    expect((await body<ErrorBody>(response)).error).toMatchObject({ code: "calendar_waste_unparseable", details: [{ check: "notPdf" }] });
  });

  test("an upload over 10 MiB is 413 payload_too_large", async () => {
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    big.set(new TextEncoder().encode("%PDF-1.7\n"));
    const response = await postForm(calendarPath(householdId, "/waste/preview"), owner.cookie, { tour: "4", file: pdfBlob(big) });
    expect(response.status).toBe(413);
    const error = (await body<ErrorBody>(response)).error;
    expect(error.code).toBe("payload_too_large");
    expect(error.message).toBe(serverText(DEFAULT_LOCALE, "server.calendar.wasteTooLarge"));
  });

  test("an upload that is not a PDF is 415 unsupported_media_type", async () => {
    const response = await postForm(calendarPath(householdId, "/waste/preview"), owner.cookie, {
      tour: "4",
      file: new Blob(["hello, I am a text file"], { type: "application/pdf" }),
    });
    expect(response.status).toBe(415);
    expect((await body<ErrorBody>(response)).error).toMatchObject({
      code: "unsupported_media_type",
      message: serverText(DEFAULT_LOCALE, "server.calendar.wasteNotPdf"),
    });
  });

  test("neither a file nor a link is 422 validation_failed at path file (multipart, JSON and any other body)", async () => {
    const multipart = await postForm(calendarPath(householdId, "/waste/preview"), owner.cookie, { tour: "4" });
    const json = await call(calendarPath(householdId, "/waste/preview"), { method: "POST", cookie: owner.cookie, body: { tour: 4 } });
    const { app } = await import("../src/index.ts");
    const text = await app.request(calendarPath(householdId, "/waste/preview"), {
      method: "POST",
      headers: { Cookie: owner.cookie, "Content-Type": "text/plain" },
      body: "4",
    });
    for (const response of [multipart, json, text]) {
      expect(response.status).toBe(422);
      const error = (await body<ErrorBody>(response)).error;
      expect(error.code).toBe("validation_failed");
      expect(error.details?.[0]).toMatchObject({ path: "file", i18n: { key: "server.calendar.wasteFileRequired" } });
    }
  });

  test("a tour outside 1-9 is 422 validation_failed at path tour (multipart and JSON)", async () => {
    const multipart = await postForm(calendarPath(householdId, "/waste/preview"), owner.cookie, { tour: "12", file: pdfBlob() });
    const json = await call(calendarPath(householdId, "/waste/preview"), { method: "POST", cookie: owner.cookie, body: { tour: 0, url: URL_OK } });
    for (const response of [multipart, json]) {
      expect(response.status).toBe(422);
      const error = (await body<ErrorBody>(response)).error;
      expect(error.code).toBe("validation_failed");
      expect(error.details?.[0]).toMatchObject({ path: "tour" });
    }
  });

  test("a PDF that is no Hattingen flyer is 422 calendar_waste_unparseable naming the check", async () => {
    const response = await postForm(calendarPath(householdId, "/waste/preview"), owner.cookie, { tour: "4", file: pdfBlob(emptyPdf()) });
    expect(response.status).toBe(422);
    const error = (await body<ErrorBody>(response)).error;
    expect(error).toMatchObject({
      code: "calendar_waste_unparseable",
      details: [{ check: "year", i18n: { key: "server.calendar.wasteCheck.year" } }],
    });
  });
});

describe("POST …/waste/import, GET …/waste, PUT …/waste/settings, DELETE …/waste/imports/:importId", () => {
  test(
    "an upload imports (201), the overview lists it with the next pickups, a delete removes it",
    async () => {
      const response = await postForm(calendarPath(householdId, "/waste/import"), owner.cookie, { tour: "4", file: pdfBlob() });
      expect(response.status).toBe(201);
      const result = await body<{ import: { id: string; sourceName: string }; entryCount: number }>(response);
      expect(decodes(CalendarWasteImportResponseSchema, result)).toEqual(result);
      expect(result.entryCount).toBe(94);
      expect(result.import.sourceName).toBe("Abfall 2027.pdf");

      const overview = await call(calendarPath(householdId, "/waste?from=2027-01-05"), { cookie: robin.cookie });
      expect(overview.status).toBe(200);
      const payload = await body<{ imports: Array<{ id: string }>; next: Array<{ category: string; date: string; detail: string | null }>; settings: unknown }>(overview);
      expect(decodes(CalendarWasteOverviewResponseSchema, payload)).toEqual(payload);
      expect(payload.imports.map((row) => row.id)).toEqual([result.import.id]);
      expect(payload.next[0]).toEqual({ category: "waste_rest", date: "2027-01-08", detail: null });

      const removed = await call(calendarPath(householdId, `/waste/imports/${result.import.id}`), { method: "DELETE", cookie: robin.cookie });
      expect(removed.status).toBe(204);
      const again = await call(calendarPath(householdId, `/waste/imports/${result.import.id}`), { method: "DELETE", cookie: robin.cookie });
      expect(again.status).toBe(404);
      expect((await body<ErrorBody>(again)).error.code).toBe("not_found");
    },
    SLOW,
  );

  test(
    "a link imports and keeps the link in the settings",
    async () => {
      setWasteFlyerFetchForTests(makeTestWasteFlyerFetch(new Map([[URL_OK, FLYER]])));
      const response = await call(calendarPath(householdId, "/waste/import"), { method: "POST", cookie: owner.cookie, body: { tour: 4, url: URL_OK } });
      expect(response.status).toBe(201);
      const overview = await body<{ settings: { sourceUrl: string | null; tour: number } }>(
        await call(calendarPath(householdId, "/waste?from=2027-01-01"), { cookie: owner.cookie }),
      );
      expect(overview.settings).toMatchObject({ sourceUrl: URL_OK, tour: 4 });
    },
    SLOW,
  );

  test("GET without from is 422", async () => {
    const response = await call(calendarPath(householdId, "/waste"), { cookie: owner.cookie });
    expect(response.status).toBe(422);
  });

  test("PUT settings answers the settings; a person outside the household is 422 at assigneeIds.<n>; a bad rule is 422", async () => {
    const ok = await call(calendarPath(householdId, "/waste/settings"), {
      method: "PUT",
      cookie: owner.cookie,
      body: { provider: "hattingen", tour: 5, assigneeMode: "rotate", assigneeIds: [robin.id, owner.id], today: "2027-03-01" },
    });
    expect(ok.status).toBe(200);
    const settings = await body<Record<string, unknown>>(ok);
    expect(decodes(CalendarWasteSettingsSchema, settings)).toEqual(settings);
    expect(settings).toMatchObject({ provider: "hattingen", tour: 5, assigneeMode: "rotate", assigneeIds: [robin.id, owner.id] });

    const stranger = await createUser("waste-route-stranger");
    const foreign = await call(calendarPath(householdId, "/waste/settings"), {
      method: "PUT",
      cookie: owner.cookie,
      body: { provider: "hattingen", tour: 5, assigneeMode: "fixed", assigneeIds: [stranger.id], today: "2027-03-01" },
    });
    expect(foreign.status).toBe(422);
    expect((await body<ErrorBody>(foreign)).error.details?.[0]).toMatchObject({
      path: "assigneeIds.0",
      i18n: { key: "server.calendar.memberNotInHousehold" },
    });

    const badRule = await call(calendarPath(householdId, "/waste/settings"), {
      method: "PUT",
      cookie: owner.cookie,
      body: { provider: "hattingen", tour: 5, assigneeMode: "rotate", assigneeIds: [robin.id], today: "2027-03-01" },
    });
    expect(badRule.status).toBe(422);
  });

  test("an unconfirmed account reads but cannot write (403 email_unverified)", async () => {
    const unconfirmed = await createUser("waste-route-unconfirmed");
    await addMember(owner, householdId, unconfirmed);
    await db.update(users).set({ emailVerified: false, emailVerifiedAt: null }).where(eq(users.id, unconfirmed.id));
    setVerifiedEmailRequired(true);
    try {
      const read = await call(calendarPath(householdId, "/waste?from=2027-01-01"), { cookie: unconfirmed.cookie });
      expect(read.status).toBe(200);
      for (const [method, rest] of [
        ["POST", "/waste/preview"],
        ["POST", "/waste/import"],
        ["PUT", "/waste/settings"],
        ["DELETE", `/waste/imports/${crypto.randomUUID()}`],
      ] as const) {
        const response = await call(calendarPath(householdId, rest), { method, cookie: unconfirmed.cookie, body: {} });
        expect(response.status).toBe(403);
        expect((await body<ErrorBody>(response)).error.code).toBe("email_unverified");
      }
    } finally {
      setVerifiedEmailRequired(null);
    }
  });

  test("the module chain is in front: no cookie 401, a non-member 403", async () => {
    expect((await call(calendarPath(householdId, "/waste?from=2027-01-01"))).status).toBe(401);
    const outsider = await createUser("waste-route-outsider");
    expect((await call(calendarPath(householdId, "/waste?from=2027-01-01"), { cookie: outsider.cookie })).status).toBe(403);
  });
});
