/**
 * Cross-household sweep of the waste routes (CLAUDE.md "Cross-household guard (D8)", plan m8 M8-T12): households A and
 * B with the calendar on, B has an imported flyer and waste settings. With A's cookie every by-id waste route addressed
 * with B's id answers `404 not_found` and changes nothing; A's settings naming B's owner are `422` at `assigneeIds.0`;
 * A's overview never shows B's import. A coverage test reads `waste.api.ts` and fails for a `:param` endpoint without a
 * probe, so a route added later cannot skip the sweep.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client.ts";
import { migrateDatabase } from "../src/db/migrate.ts";
import { calendarEntries, calendarWasteImports } from "../src/db/schema.ts";
import { type TestUser, body, calendarPath, call, createCalendarHousehold, createUser } from "./support/calendar-harness.ts";
import { runTest } from "./support/effect.ts";
import { FLYER_PDF } from "./fixtures/calendar/record-items.ts";

interface Side {
  owner: TestUser;
  householdId: string;
  importId: string;
}

interface Probe {
  readonly label: string;
  readonly method: string;
  /** Below `/calendar`. */
  readonly path: string;
  readonly body?: unknown;
  readonly status: number;
  readonly code: string;
}

let a: Side;
let b: Side;

async function importFlyer(owner: TestUser, householdId: string): Promise<string> {
  const { app } = await import("../src/index.ts");
  const form = new FormData();
  form.append("tour", "4");
  form.append("file", new Blob([new Uint8Array(readFileSync(FLYER_PDF))], { type: "application/pdf" }), "flyer.pdf");
  const response = await app.request(calendarPath(householdId, "/waste/import"), {
    method: "POST",
    headers: { Cookie: owner.cookie },
    body: form,
  });
  if (response.status !== 201) throw new Error(`import failed: ${response.status} ${await response.text()}`);
  return (await body<{ import: { id: string } }>(response)).import.id;
}

async function side(label: string): Promise<Side> {
  const owner = await createUser(`${label}-waste-owner`);
  const householdId = await createCalendarHousehold(owner, `${label} waste ${crypto.randomUUID().slice(0, 8)}`);
  const importId = await importFlyer(owner, householdId);
  return { owner, householdId, importId };
}

/** Every by-id waste route, addressed with B's id (and A's household in the path). */
function probes(): Probe[] {
  return [
    { label: "DELETE imports/:importId", method: "DELETE", path: `/waste/imports/${b.importId}`, status: 404, code: "not_found" },
  ];
}

beforeAll(async () => {
  await runTest(migrateDatabase());
  a = await side("a");
  b = await side("b");
}, 60_000);

describe("calendar waste: another household's ids are 404 (D8)", () => {
  test("every by-id route answers 404 not_found for B's id and B's import stays", async () => {
    const results: Array<{ route: string; status: number; code: string | undefined }> = [];
    for (const probe of probes()) {
      const response = await call(calendarPath(a.householdId, probe.path), {
        method: probe.method,
        cookie: a.owner.cookie,
        ...(probe.body === undefined ? {} : { body: probe.body }),
      });
      const payload = await body<{ error?: { code?: string } }>(response).catch(() => ({}) as { error?: { code?: string } });
      results.push({ route: probe.label, status: response.status, code: payload.error?.code });
    }
    expect(results).toEqual(probes().map((probe) => ({ route: probe.label, status: probe.status, code: probe.code })));
    const [row] = await db.select().from(calendarWasteImports).where(eq(calendarWasteImports.id, b.importId));
    expect(row?.householdId).toBe(b.householdId);
    expect((await db.select().from(calendarEntries).where(eq(calendarEntries.wasteImportId, b.importId))).length).toBe(94);
  });

  test("B's import cannot be deleted through A's path even by B's owner (403 non-member)", async () => {
    const response = await call(calendarPath(a.householdId, `/waste/imports/${b.importId}`), { method: "DELETE", cookie: b.owner.cookie });
    expect(response.status).toBe(403);
  });

  test("A's settings naming B's owner are 422 memberNotInHousehold at assigneeIds.0", async () => {
    const response = await call(calendarPath(a.householdId, "/waste/settings"), {
      method: "PUT",
      cookie: a.owner.cookie,
      body: { provider: "hattingen", tour: 4, assigneeMode: "fixed", assigneeIds: [b.owner.id], today: "2027-01-01" },
    });
    expect(response.status).toBe(422);
    const error = (await body<{ error: { details: Array<{ path: string; i18n: { key: string } }> } }>(response)).error;
    expect(error.details[0]).toMatchObject({ path: "assigneeIds.0", i18n: { key: "server.calendar.memberNotInHousehold" } });
  });

  test("A's overview lists A's import only", async () => {
    const overview = await body<{ imports: Array<{ id: string }> }>(
      await call(calendarPath(a.householdId, "/waste?from=2027-01-01"), { cookie: a.owner.cookie }),
    );
    expect(overview.imports.map((row) => row.id)).toEqual([a.importId]);
  });

  test("coverage: every `:param` endpoint of waste.api.ts has a probe", () => {
    const source = readFileSync(join(import.meta.dir, "../src/modules/calendar/routes/waste.api.ts"), "utf8");
    const declared = [...source.matchAll(/HttpApiEndpoint\.(get|post|put|patch|delete)\(\s*"[^"]+",\s*"([^"]+)"/g)]
      .map((match) => `${(match[1] ?? "").toUpperCase()} ${match[2] ?? ""}`)
      .filter((route) => route.includes(":"));
    const swept = (route: string): boolean => {
      const [method, pattern] = route.split(" ") as [string, string];
      const shape = new RegExp(`^${pattern.replace(/:[A-Za-z]+/g, "[^/?]+").replace(/\//g, "\\/")}$`);
      return probes().some((probe) => {
        if (probe.method !== method) return false;
        // The group prefix is the first segment (`/waste`).
        const segments = probe.path.split("?")[0]!.split("/").filter(Boolean);
        return shape.test(`/${segments.slice(1).join("/")}`);
      });
    };
    expect(declared).toEqual(["DELETE /imports/:importId"]);
    expect(declared.filter((route) => !swept(route))).toEqual([]);
  });
});
