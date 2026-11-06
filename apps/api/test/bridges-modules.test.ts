/**
 * The module and script test doors of `apps/api/test/support/bridges/` against the src bridges they were copied from
 * (docs/EFFECT.md E7, E9; plan `docs/plans/e8-harden.md` P1, P8, E8-T01): the recipe doors (`recipe-drafts`,
 * `recipe-ocr`, `recipe-fetch`, `recipe-ssrf`), the finance doors (`finance-bridge`, `finance-participants`,
 * `finance-clock`) and the legacy doors (`legacy-io`, `legacy-run`, `legacy-users`, `legacy-households`,
 * `legacy-recipe`, `legacy-sources`). One case per door: the door and its src bridge get the same input and must give
 * the same outcome (the resolved value, or the rejected error's `_tag`, `code` and identity rule). Every src bridge is
 * imported ALIASED (`bridge…`), so the import rewrite of E8-T04 never touches this file; E8-T06 rewrites it to compare
 * each door with its Effect form instead (case count kept).
 *
 * Isolation (ADR 0009: one process, one shared database): nothing here touches the shared database. The draft and
 * finance cases run on a temp file database of their own; the legacy cases on the legacy harness's temp databases
 * (`apps/api/test/support/legacy-harness.ts`), cleaned up in `afterAll`; the clock override is released after every
 * case (`setClockForTest(null)` in `afterEach`).
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client } from "@libsql/client";
import { Effect } from "effect";
import { migrateHouseholds as bridgeMigrateHouseholds } from "../scripts/legacy/households.ts";
import { runLegacy as bridgeRunLegacy } from "../scripts/legacy/io.ts";
import { MappingError } from "../scripts/legacy/mapping.ts";
import { migrateRecipe as bridgeMigrateRecipe } from "../scripts/legacy/recipe.ts";
import { runLegacyMigration as bridgeRunLegacyMigration } from "../scripts/legacy/run.ts";
import { openLegacy as bridgeOpenLegacy } from "../scripts/legacy/sources.ts";
import type { LegacyDb, Report } from "../scripts/legacy/types.ts";
import { migrateUsers as bridgeMigrateUsers } from "../scripts/legacy/users.ts";
import { createDatabase } from "../src/db/client.ts";
import { runMigrations as bridgeRunMigrations } from "./support/bridges/migrate.ts";
import { householdMembers, households, users } from "../src/db/schema.ts";
import { DatabaseError, NotFound, isApiError } from "../src/lib/errors.ts";
import { runFinanceBridge as bridgeRunFinanceBridge } from "../src/modules/finance/bridge.ts";
import { nowMs as bridgeNowMs, setClockForTest } from "../src/modules/finance/lib/clock.ts";
import {
  assignParticipants as bridgeAssignParticipants,
  FinanceParticipants,
  updateParticipantDisplayName as bridgeUpdateParticipantDisplayName,
} from "../src/modules/finance/services/participants/participants.service.ts";
import { createDraft as bridgeCreateDraft } from "../src/modules/recipe/services/import/drafts.ts";
import { importFromText as bridgeImportFromText } from "../src/modules/recipe/services/import/ocr/index.ts";
import { fetchHtml as bridgeFetchHtml } from "../src/modules/recipe/services/import/url/fetch.ts";
import { assertPublicUrl as bridgeAssertPublicUrl, SsrfError } from "../src/modules/recipe/services/import/url/ssrf.ts";
import { FIXTURE_DIR } from "./support/legacy-harness.ts";
import { countRows, createLegacyRun, type LegacyRun } from "./support/legacy-harness.ts";
import { createResolver, createScriptedFetch } from "./import/helpers.ts";
import { runFinanceBridge } from "./support/bridges/finance-bridge.ts";
import { nowMs } from "./support/bridges/finance-clock.ts";
import { assignParticipants, updateParticipantDisplayName } from "./support/bridges/finance-participants.ts";
import { migrateHouseholds } from "./support/bridges/legacy-households.ts";
import { runLegacy } from "./support/bridges/legacy-io.ts";
import { migrateRecipe } from "./support/bridges/legacy-recipe.ts";
import { runLegacyMigration } from "./support/bridges/legacy-run.ts";
import { openLegacy } from "./support/bridges/legacy-sources.ts";
import { migrateUsers } from "./support/bridges/legacy-users.ts";
import { createDraft } from "./support/bridges/recipe-drafts.ts";
import { fetchHtml } from "./support/bridges/recipe-fetch.ts";
import { importFromText } from "./support/bridges/recipe-ocr.ts";
import { assertPublicUrl } from "./support/bridges/recipe-ssrf.ts";

/** The rejection value of `promise` (fails the test when it resolves). */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return await promise.then(
    (value) => {
      throw new Error(`expected a rejection, got ${JSON.stringify(value)}`);
    },
    (error: unknown) => error,
  );
}

/** What a synchronous call threw (fails the test when it returns). */
function thrown(f: () => unknown): unknown {
  try {
    f();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
}

function tagOf(u: unknown): unknown {
  return (u as { _tag?: unknown })._tag;
}

function codeOf(u: unknown): unknown {
  return (u as { code?: unknown }).code;
}

const tempDir = mkdtempSync(join(tmpdir(), "toon-bridges-modules-"));
const scratch = createDatabase({ url: `file:${join(tempDir, "scratch.db")}` });
const legacyRuns: LegacyRun[] = [];
const legacyClients: LegacyDb[] = [];

beforeAll(async () => {
  await scratch.ready;
  await bridgeRunMigrations(scratch.db);
});

afterEach(() => {
  setClockForTest(null);
});

afterAll(() => {
  for (const legacy of legacyClients.splice(0)) legacy.client.close();
  for (const run of legacyRuns.splice(0)) run.cleanup();
  scratch.client.close();
  rmSync(tempDir, { recursive: true, force: true });
});

/** A household of two verified accounts on the scratch database (never the shared one). */
async function seedHousehold(): Promise<{ householdId: string; a: string; b: string }> {
  const householdId = crypto.randomUUID();
  const ids = [crypto.randomUUID(), crypto.randomUUID()] as const;
  for (const [index, id] of ids.entries()) {
    await scratch.db.insert(users).values({
      id,
      email: `bridges-modules.${id.slice(0, 8)}@toon.test`,
      name: index === 0 ? "Anna" : "Bert",
      emailVerified: true,
      emailVerifiedAt: Date.now(),
    });
  }
  await scratch.db.insert(households).values({ id: householdId, name: "Bridges", createdBy: ids[0] });
  for (const [index, id] of ids.entries()) {
    await scratch.db
      .insert(householdMembers)
      .values({ id: crypto.randomUUID(), householdId, userId: id, role: index === 0 ? "owner" : "member" });
  }
  return { householdId, a: ids[0], b: ids[1] };
}

describe("the recipe test doors match their src bridges", () => {
  test("createDraft: both store the same draft on the given database", async () => {
    const { householdId, a } = await seedHousehold();
    const parsed = bridgeImportFromText("200 g Mehl\n1 Ei\n\nVerrühren und ausbacken.", { title: "Pfannkuchen" }).parsed;
    const input = { householdId, createdBy: a, sourceType: "manual" as const, parsed, rawText: "200 g Mehl" };
    const fromDoor = await createDraft(scratch.db, input);
    const fromBridge = await bridgeCreateDraft(scratch.db, input);
    const stable = (draft: typeof fromDoor) => ({ ...draft, id: "", createdAt: "", updatedAt: "" });
    expect(stable(fromDoor)).toEqual(stable(fromBridge));
    expect(fromDoor.id).not.toBe(fromBridge.id);
    expect(fromDoor.parsed.title).toBe("Pfannkuchen");
    expect(fromDoor.householdId).toBe(householdId);
  });

  test("importFromText: synchronous, the same payload, and the same synchronous 400 for an empty text", () => {
    const text = "Pfannkuchen\n\n200 g Mehl\n1 Ei\n300 ml Milch\n\nAlles verrühren und ausbacken.";
    const fromDoor = importFromText(text, { title: "Pfannkuchen" });
    const fromBridge = bridgeImportFromText(text, { title: "Pfannkuchen" });
    expect(fromDoor.parsed).toEqual(fromBridge.parsed);
    expect(fromDoor.rawText).toBe(fromBridge.rawText);
    expect(Object.keys(fromDoor.sourceMeta).sort()).toEqual(Object.keys(fromBridge.sourceMeta).sort());
    expect(importFromText(text).parsed).toEqual(bridgeImportFromText(text).parsed);

    const doorError = thrown(() => importFromText("   "));
    const bridgeError = thrown(() => bridgeImportFromText("   "));
    expect(tagOf(doorError)).toBe(tagOf(bridgeError));
    expect(tagOf(doorError)).toBe("BadRequest");
    expect(codeOf(doorError)).toBe(codeOf(bridgeError));
    expect(isApiError(doorError)).toBe(true);
  });

  test("fetchHtml: the same page, hops and final URL, and the same 400 fetch_failed for a private address", async () => {
    const page = "<html><head><title>OK</title></head><body>Hallo</body></html>";
    const resolve = createResolver();
    const routes = {
      "https://ok.example/start": { redirectTo: "https://ok.example/r" },
      "https://ok.example/r": { body: page },
    };
    const doorFetch = createScriptedFetch(routes);
    const bridgeFetch = createScriptedFetch(routes);
    const fromDoor = await fetchHtml("https://ok.example/start", { fetchImpl: doorFetch.fetch, resolve });
    const fromBridge = await bridgeFetchHtml("https://ok.example/start", { fetchImpl: bridgeFetch.fetch, resolve });
    expect(fromDoor).toEqual(fromBridge);
    expect(fromDoor.url).toBe("https://ok.example/r");
    expect(doorFetch.requests).toEqual(bridgeFetch.requests);

    const doorRefusal = await rejection(fetchHtml("http://127.0.0.1:9999/secret", { fetchImpl: doorFetch.fetch, resolve }));
    const bridgeRefusal = await rejection(
      bridgeFetchHtml("http://127.0.0.1:9999/secret", { fetchImpl: bridgeFetch.fetch, resolve }),
    );
    expect(tagOf(doorRefusal)).toBe(tagOf(bridgeRefusal));
    expect(codeOf(doorRefusal)).toBe(codeOf(bridgeRefusal));
    expect(codeOf(doorRefusal)).toBe("fetch_failed");
    expect((doorRefusal as { details?: unknown }).details).toEqual((bridgeRefusal as { details?: unknown }).details);
    expect(doorFetch.requests).toEqual(bridgeFetch.requests);
  });

  test("assertPublicUrl: the same parsed URL, and the same SsrfError for a private address", async () => {
    const resolve = createResolver();
    const fromDoor = await assertPublicUrl("https://whatever.example/x", { skipDns: true });
    const fromBridge = await bridgeAssertPublicUrl("https://whatever.example/x", { skipDns: true });
    expect(fromDoor.href).toBe(fromBridge.href);
    expect((await assertPublicUrl("https://ok.example/r", { resolve })).href).toBe(
      (await bridgeAssertPublicUrl("https://ok.example/r", { resolve })).href,
    );

    const privateResolve = createResolver({ "intern.example": "10.0.0.5" });
    for (const url of ["http://169.254.169.254/latest", "https://intern.example/"]) {
      const doorError = await rejection(assertPublicUrl(url, { resolve: privateResolve }));
      const bridgeError = await rejection(bridgeAssertPublicUrl(url, { resolve: privateResolve }));
      expect(doorError).toBeInstanceOf(SsrfError);
      expect(bridgeError).toBeInstanceOf(SsrfError);
      expect((doorError as SsrfError).reason).toBe((bridgeError as SsrfError).reason);
      expect(tagOf(doorError)).toBe(tagOf(bridgeError));
    }
  });
});

describe("the finance test doors match their src bridges", () => {
  test("runFinanceBridge: the same value on the given executor; a refusal as itself, a DatabaseError as its cause", async () => {
    const { householdId, a } = await seedHousehold();
    const slot = FinanceParticipants.use((service) => service.participantSlotOf(householdId, a));
    expect(await runFinanceBridge(slot, scratch.db)).toBe(await bridgeRunFinanceBridge(slot, scratch.db));
    expect(await runFinanceBridge(Effect.succeed(42), scratch.db)).toBe(42);
    expect(await bridgeRunFinanceBridge(Effect.succeed(42), scratch.db)).toBe(42);

    const refusal = new NotFound();
    expect(await rejection(runFinanceBridge(Effect.fail(refusal), scratch.db))).toBe(refusal);
    expect(await rejection(bridgeRunFinanceBridge(Effect.fail(refusal), scratch.db))).toBe(refusal);

    const cause = new Error("disk I/O error");
    const failure = Effect.fail(new DatabaseError({ cause }));
    expect(await rejection(runFinanceBridge(failure, scratch.db))).toBe(cause);
    expect(await rejection(bridgeRunFinanceBridge(failure, scratch.db))).toBe(cause);
  });

  test("assignParticipants and updateParticipantDisplayName: the same seats, the same renamed participant, the same refusals", async () => {
    const doorHousehold = await seedHousehold();
    const bridgeHousehold = await seedHousehold();
    const seats = (h: { a: string; b: string }) => [
      { userId: h.a, memberSlot: 1 },
      { userId: h.b, memberSlot: 2 },
    ];
    expect(await assignParticipants(scratch.db, doorHousehold.householdId, seats(doorHousehold))).toBeUndefined();
    expect(await bridgeAssignParticipants(scratch.db, bridgeHousehold.householdId, seats(bridgeHousehold))).toBeUndefined();

    const renamedByDoor = await updateParticipantDisplayName(scratch.db, doorHousehold.householdId, doorHousehold.b, "Bee");
    const renamedByBridge = await bridgeUpdateParticipantDisplayName(
      scratch.db,
      bridgeHousehold.householdId,
      bridgeHousehold.b,
      "Bee",
    );
    const stable = (participant: typeof renamedByDoor) => ({ ...participant, userId: "", joinedAt: "", email: "" });
    expect(stable(renamedByDoor)).toEqual(stable(renamedByBridge));
    expect(renamedByDoor.displayName).toBe("Bee");
    expect(renamedByDoor.memberSlot).toBe(2);

    // one seat only: the same 422
    const lone = [{ userId: doorHousehold.a, memberSlot: 1 }];
    const doorRefusal = await rejection(assignParticipants(scratch.db, doorHousehold.householdId, lone));
    const bridgeRefusal = await rejection(bridgeAssignParticipants(scratch.db, doorHousehold.householdId, lone));
    expect(tagOf(doorRefusal)).toBe(tagOf(bridgeRefusal));
    expect(codeOf(doorRefusal)).toBe(codeOf(bridgeRefusal));
    expect(codeOf(doorRefusal)).toBe("finance_participants_required");

    // a stranger: the same 404
    const stranger = crypto.randomUUID();
    const doorMissing = await rejection(updateParticipantDisplayName(scratch.db, doorHousehold.householdId, stranger, "X"));
    const bridgeMissing = await rejection(
      bridgeUpdateParticipantDisplayName(scratch.db, doorHousehold.householdId, stranger, "X"),
    );
    expect(tagOf(doorMissing)).toBe(tagOf(bridgeMissing));
    expect(tagOf(doorMissing)).toBe("NotFound");
  });

  test("nowMs: the pinned override, and the real clock once released", () => {
    const pinned = Date.UTC(2026, 0, 15, 11, 0, 0);
    setClockForTest(pinned);
    expect(nowMs()).toBe(pinned);
    expect(bridgeNowMs()).toBe(pinned);

    setClockForTest(null);
    const before = Date.now();
    const fromDoor = nowMs();
    const fromBridge = bridgeNowMs();
    const after = Date.now();
    for (const value of [fromDoor, fromBridge]) {
      expect(value).toBeGreaterThanOrEqual(before);
      expect(value).toBeLessThanOrEqual(after);
    }
  });
});

async function targetCounts(client: Client): Promise<Record<string, number>> {
  const result = await client.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations' ORDER BY name",
  );
  const counts: Record<string, number> = {};
  for (const row of result.rows) counts[String(row.name)] = await countRows(client, String(row.name));
  return counts;
}

/** The parts of a report that do not carry the random ids of a pass. */
function stableReport(report: Report) {
  return {
    mode: report.mode,
    inputs: report.inputs.map(({ source, schema, tables }) => ({ source, schema, tables })),
    users: { ...report.users, collisions: report.users.collisions.length },
    counts: report.counts,
    skipped: report.skipped.length,
    notMigrated: report.notMigrated,
    balances: report.balances.length,
    placeholders: report.placeholders.length,
    warnings: report.warnings.length,
    errors: report.errors,
  };
}

describe("the legacy test doors match their src bridges", () => {
  let doorRun: LegacyRun;
  let bridgeRun: LegacyRun;

  beforeAll(async () => {
    doorRun = await createLegacyRun({ mode: "apply" });
    bridgeRun = await createLegacyRun({ mode: "apply" });
    legacyRuns.push(doorRun, bridgeRun);
  });

  test("runLegacy: the same value; a tagged error as itself, a DatabaseError as its cause", async () => {
    expect(await runLegacy(Effect.succeed(7))).toBe(await bridgeRunLegacy(Effect.succeed(7)));
    const mapping = new MappingError({ message: "bad mapping" });
    expect(await rejection(runLegacy(Effect.fail(mapping)))).toBe(mapping);
    expect(await rejection(bridgeRunLegacy(Effect.fail(mapping)))).toBe(mapping);
    const cause = new Error("SQLITE_BUSY");
    const failure = Effect.fail(new DatabaseError({ cause }));
    expect(await rejection(runLegacy(failure))).toBe(cause);
    expect(await rejection(bridgeRunLegacy(failure))).toBe(cause);
  });

  test("openLegacy: the same snapshot of the same input, and the same refusal of a missing file", async () => {
    const dir = mkdtempSync(join(tempDir, "open-"));
    const input = join(dir, "recipe.db");
    cpSync(join(FIXTURE_DIR, "recipe.db"), input);
    mkdirSync(join(dir, "door"));
    mkdirSync(join(dir, "bridge"));
    const fromDoor = await openLegacy("recipe", input, join(dir, "door"));
    legacyClients.push(fromDoor);
    const fromBridge = await bridgeOpenLegacy("recipe", input, join(dir, "bridge"));
    legacyClients.push(fromBridge);
    expect(fromDoor.source).toBe(fromBridge.source);
    expect(fromDoor.originalPath).toBe(fromBridge.originalPath);
    expect(await targetCounts(fromDoor.client)).toEqual(await targetCounts(fromBridge.client));

    const missing = join(dir, "absent.db");
    const doorError = await rejection(openLegacy("recipe", missing, join(dir, "door")));
    const bridgeError = await rejection(bridgeOpenLegacy("recipe", missing, join(dir, "bridge")));
    expect(tagOf(doorError)).toBe(tagOf(bridgeError));
    expect(tagOf(doorError)).toBe("LegacyInputError");
    expect((doorError as Error).message).toBe((bridgeError as Error).message);
  });

  test("migrateUsers: the same users in the target and the same report", async () => {
    expect(await migrateUsers(doorRun.ctx)).toBeUndefined();
    expect(await bridgeMigrateUsers(bridgeRun.ctx)).toBeUndefined();
    expect(await targetCounts(doorRun.target.client)).toEqual(await targetCounts(bridgeRun.target.client));
    expect(doorRun.ctx.ids.users.recipe.size).toBe(bridgeRun.ctx.ids.users.recipe.size);
    expect(doorRun.ctx.ids.users.finance.size).toBe(bridgeRun.ctx.ids.users.finance.size);
    expect(stableReport(doorRun.ctx.report)).toEqual(stableReport(bridgeRun.ctx.report));
    expect(doorRun.ctx.report.errors).toEqual([]);
  });

  test("migrateHouseholds: the same households in the target and the same report", async () => {
    expect(await migrateHouseholds(doorRun.ctx)).toBeUndefined();
    expect(await bridgeMigrateHouseholds(bridgeRun.ctx)).toBeUndefined();
    expect(await targetCounts(doorRun.target.client)).toEqual(await targetCounts(bridgeRun.target.client));
    expect(doorRun.ctx.ids.households.recipe.size).toBe(bridgeRun.ctx.ids.households.recipe.size);
    expect(stableReport(doorRun.ctx.report)).toEqual(stableReport(bridgeRun.ctx.report));
    expect(doorRun.ctx.report.errors).toEqual([]);
  });

  test("migrateRecipe: the same backfill count, the same recipe rows and the same report", async () => {
    const fromDoor = await migrateRecipe(doorRun.ctx);
    const fromBridge = await bridgeMigrateRecipe(bridgeRun.ctx);
    expect(fromDoor).toEqual(fromBridge);
    expect(await targetCounts(doorRun.target.client)).toEqual(await targetCounts(bridgeRun.target.client));
    expect(stableReport(doorRun.ctx.report)).toEqual(stableReport(bridgeRun.ctx.report));
  });

  test("runLegacyMigration: the same dry-run report on the same inputs", async () => {
    const doorPass = await createLegacyRun();
    const bridgePass = await createLegacyRun();
    legacyRuns.push(doorPass, bridgePass);
    const options = (run: LegacyRun) => ({
      mode: "dry-run" as const,
      recipe: run.ctx.recipe,
      finance: run.ctx.finance,
      target: run.target,
      uploads: run.ctx.uploads,
    });
    const fromDoor = await runLegacyMigration(options(doorPass));
    const fromBridge = await bridgeRunLegacyMigration(options(bridgePass));
    expect(stableReport(fromDoor)).toEqual(stableReport(fromBridge));
    expect(fromDoor.errors).toEqual([]);
    expect(fromDoor.inputs.map((input) => input.source)).toEqual(["recipe", "finance"]);
  });
});
