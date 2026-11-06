/**
 * The module and script test doors of `apps/api/test/support/bridges/` against the `Effect` forms they wrap
 * (docs/EFFECT.md E7, E9; plan `docs/plans/e8-harden.md` P1, P8, E8-T01, E8-T06): the recipe doors (`recipe-drafts`,
 * `recipe-ocr`, `recipe-fetch`, `recipe-ssrf`), the finance doors (`finance-bridge`, `finance-participants`,
 * `finance-clock`) and the legacy doors (`legacy-io`, `legacy-run`, `legacy-users`, `legacy-households`,
 * `legacy-recipe`, `legacy-sources`). One case per door: the door and the Effect form it wraps get the same input and
 * must give the same outcome (the resolved value, or the failure's `_tag`, `code` and identity rule; a door rejects
 * with the failure itself, a `DatabaseError` with its `cause`). The src bridges these doors were copied from are gone
 * (E8-T06); the Effect forms run through `Effect.runPromise` / `Effect.runSync` and `Effect.flip` for a failure.
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
import { FetchHttpClient, HttpClient } from "effect/http";
import { migrateHouseholdsEffect } from "../scripts/legacy/households.ts";
import { MappingError } from "../scripts/legacy/mapping.ts";
import { migrateRecipeEffect } from "../scripts/legacy/recipe.ts";
import { type RunOptions, runLegacyMigrationEffect } from "../scripts/legacy/run.ts";
import { openLegacyEffect } from "../scripts/legacy/sources.ts";
import type { LegacyDb, Report } from "../scripts/legacy/types.ts";
import { migrateUsersEffect } from "../scripts/legacy/users.ts";
import { createDatabase } from "../src/db/client.ts";
import { Database } from "../src/db/database.ts";
import { householdMembers, households, users } from "../src/db/schema.ts";
import { DatabaseError, NotFound, isApiError, isDatabaseError } from "../src/lib/errors.ts";
import { type FinanceServices, withFinanceServices } from "../src/modules/finance/layer.ts";
import { financeTimeMillis, setClockForTest } from "../src/modules/finance/lib/clock.ts";
import { FinanceParticipants } from "../src/modules/finance/services/participants/participants.service.ts";
import { type CreateDraftInput, ImportDrafts } from "../src/modules/recipe/services/import/drafts.ts";
import { importFromTextEffect } from "../src/modules/recipe/services/import/ocr/index.ts";
import { fetchHtmlWith, guardNow, type FetchHtmlOptions } from "../src/modules/recipe/services/import/url/fetch.ts";
import { type AssertPublicUrlOptions, SsrfError, checkPublicUrl, entryGuard } from "../src/modules/recipe/services/import/url/ssrf.ts";
import { runtime } from "../src/runtime.ts";
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
import { runMigrations } from "./support/bridges/migrate.ts";
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

/** The failure of `effect` as a value (fails the test when it succeeds). */
function failureOf<A, E>(effect: Effect.Effect<A, E>): Promise<E> {
  return Effect.runPromise(Effect.flip(effect));
}

/** What a door rejects with for a failure: the failure itself, a `DatabaseError` as its raw `cause`. */
function rejectionOf(failure: unknown): unknown {
  return isDatabaseError(failure) ? failure.cause : failure;
}

/** The effect form of `fetchHtml` (`apps/api/test/support/bridges/recipe-fetch.ts`): the core `fetchHtmlWith` on a scripted `fetch`. */
function fetchHtmlProgram(rawUrl: string, options: FetchHtmlOptions = {}) {
  return Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    return yield* fetchHtmlWith(client, guardNow(entryGuard(options)), rawUrl, options);
  }).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.provideService(FetchHttpClient.Fetch, options.fetchImpl ?? globalThis.fetch),
  );
}

/** The effect form of `runFinanceBridge`: the finance services over the scratch database's executor. */
function financeProgram<A, E>(effect: Effect.Effect<A, E, FinanceServices | Database>) {
  return withFinanceServices(effect).pipe(Effect.provide(Database.layerFromExecutor(scratch.db)));
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
  await runMigrations(scratch.db);
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

describe("the recipe test doors match their Effect forms", () => {
  test("createDraft: both store the same draft on the given database", async () => {
    const { householdId, a } = await seedHousehold();
    const parsed = Effect.runSync(
      importFromTextEffect("200 g Mehl\n1 Ei\n\nVerrühren und ausbacken.", { title: "Pfannkuchen" }),
    ).parsed;
    const input: CreateDraftInput = { householdId, createdBy: a, sourceType: "manual" as const, parsed, rawText: "200 g Mehl" };
    const fromDoor = await createDraft(scratch.db, input);
    const fromEffect = await runtime.runPromise(
      ImportDrafts.use((s) => s.createDraft(input)).pipe(Database.withExecutor(scratch.db)),
    );
    const stable = (draft: typeof fromDoor) => ({ ...draft, id: "", createdAt: "", updatedAt: "" });
    expect(stable(fromDoor)).toEqual(stable(fromEffect));
    expect(fromDoor.id).not.toBe(fromEffect.id);
    expect(fromDoor.parsed.title).toBe("Pfannkuchen");
    expect(fromDoor.householdId).toBe(householdId);
  });

  test("importFromText: synchronous, the same payload, and the same synchronous 400 for an empty text", () => {
    const text = "Pfannkuchen\n\n200 g Mehl\n1 Ei\n300 ml Milch\n\nAlles verrühren und ausbacken.";
    const fromDoor = importFromText(text, { title: "Pfannkuchen" });
    const fromEffect = Effect.runSync(importFromTextEffect(text, { title: "Pfannkuchen" }));
    expect(fromDoor.parsed).toEqual(fromEffect.parsed);
    expect(fromDoor.rawText).toBe(fromEffect.rawText);
    expect(Object.keys(fromDoor.sourceMeta).sort()).toEqual(Object.keys(fromEffect.sourceMeta).sort());
    expect(importFromText(text).parsed).toEqual(Effect.runSync(importFromTextEffect(text)).parsed);

    const doorError = thrown(() => importFromText("   "));
    const effectError = Effect.runSync(Effect.flip(importFromTextEffect("   ")));
    expect(tagOf(doorError)).toBe(tagOf(effectError));
    expect(tagOf(doorError)).toBe("BadRequest");
    expect(codeOf(doorError)).toBe(codeOf(effectError));
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
    const effectFetch = createScriptedFetch(routes);
    const fromDoor = await fetchHtml("https://ok.example/start", { fetchImpl: doorFetch.fetch, resolve });
    const fromEffect = await Effect.runPromise(
      fetchHtmlProgram("https://ok.example/start", { fetchImpl: effectFetch.fetch, resolve }),
    );
    expect(fromDoor).toEqual(fromEffect);
    expect(fromDoor.url).toBe("https://ok.example/r");
    expect(doorFetch.requests).toEqual(effectFetch.requests);

    const doorRefusal = await rejection(fetchHtml("http://127.0.0.1:9999/secret", { fetchImpl: doorFetch.fetch, resolve }));
    const effectRefusal = await failureOf(
      fetchHtmlProgram("http://127.0.0.1:9999/secret", { fetchImpl: effectFetch.fetch, resolve }),
    );
    expect(tagOf(doorRefusal)).toBe(tagOf(effectRefusal));
    expect(codeOf(doorRefusal)).toBe(codeOf(effectRefusal));
    expect(codeOf(doorRefusal)).toBe("fetch_failed");
    expect((doorRefusal as { details?: unknown }).details).toEqual((effectRefusal as { details?: unknown }).details);
    expect(doorFetch.requests).toEqual(effectFetch.requests);
  });

  test("assertPublicUrl: the same parsed URL, and the same SsrfError for a private address", async () => {
    const resolve = createResolver();
    const check = (url: string, options: AssertPublicUrlOptions) => checkPublicUrl(url, entryGuard(options));
    const fromDoor = await assertPublicUrl("https://whatever.example/x", { skipDns: true });
    const fromEffect = await Effect.runPromise(check("https://whatever.example/x", { skipDns: true }));
    expect(fromDoor.href).toBe(fromEffect.href);
    expect((await assertPublicUrl("https://ok.example/r", { resolve })).href).toBe(
      (await Effect.runPromise(check("https://ok.example/r", { resolve }))).href,
    );

    const privateResolve = createResolver({ "intern.example": "10.0.0.5" });
    for (const url of ["http://169.254.169.254/latest", "https://intern.example/"]) {
      const doorError = await rejection(assertPublicUrl(url, { resolve: privateResolve }));
      const effectError = await failureOf(check(url, { resolve: privateResolve }));
      expect(doorError).toBeInstanceOf(SsrfError);
      expect(effectError).toBeInstanceOf(SsrfError);
      expect((doorError as SsrfError).reason).toBe((effectError as SsrfError).reason);
      expect(tagOf(doorError)).toBe(tagOf(effectError));
    }
  });
});

describe("the finance test doors match their Effect forms", () => {
  test("runFinanceBridge: the same value on the given executor; a refusal as itself, a DatabaseError as its cause", async () => {
    const { householdId, a } = await seedHousehold();
    const slot = FinanceParticipants.use((service) => service.participantSlotOf(householdId, a));
    expect(await runFinanceBridge(slot, scratch.db)).toBe(await Effect.runPromise(financeProgram(slot)));
    expect(await runFinanceBridge(Effect.succeed(42), scratch.db)).toBe(42);
    expect(await Effect.runPromise(financeProgram(Effect.succeed(42)))).toBe(42);

    const refusal = new NotFound();
    expect(await rejection(runFinanceBridge(Effect.fail(refusal), scratch.db))).toBe(refusal);
    expect(await failureOf(financeProgram(Effect.fail(refusal)))).toBe(refusal);

    const cause = new Error("disk I/O error");
    const failure = Effect.fail(new DatabaseError({ cause }));
    expect(await rejection(runFinanceBridge(failure, scratch.db))).toBe(cause);
    expect(rejectionOf(await failureOf(financeProgram(failure)))).toBe(cause);
  });

  test("assignParticipants and updateParticipantDisplayName: the same seats, the same renamed participant, the same refusals", async () => {
    const doorHousehold = await seedHousehold();
    const effectHousehold = await seedHousehold();
    const seats = (h: { a: string; b: string }) => [
      { userId: h.a, memberSlot: 1 },
      { userId: h.b, memberSlot: 2 },
    ];
    const assign = (householdId: string, assignment: ReadonlyArray<{ userId: string; memberSlot: number }>) =>
      financeProgram(FinanceParticipants.use((service) => service.assignParticipants(householdId, assignment)));
    const rename = (householdId: string, userId: string, displayName: string) =>
      financeProgram(FinanceParticipants.use((service) => service.updateParticipantDisplayName(householdId, userId, displayName)));
    expect(await assignParticipants(scratch.db, doorHousehold.householdId, seats(doorHousehold))).toBeUndefined();
    expect(await Effect.runPromise(assign(effectHousehold.householdId, seats(effectHousehold)))).toBeUndefined();

    const renamedByDoor = await updateParticipantDisplayName(scratch.db, doorHousehold.householdId, doorHousehold.b, "Bee");
    const renamedByEffect = await Effect.runPromise(rename(effectHousehold.householdId, effectHousehold.b, "Bee"));
    const stable = (participant: typeof renamedByDoor) => ({ ...participant, userId: "", joinedAt: "", email: "" });
    expect(stable(renamedByDoor)).toEqual(stable(renamedByEffect));
    expect(renamedByDoor.displayName).toBe("Bee");
    expect(renamedByDoor.memberSlot).toBe(2);

    // one seat only: the same 422
    const lone = [{ userId: doorHousehold.a, memberSlot: 1 }];
    const doorRefusal = await rejection(assignParticipants(scratch.db, doorHousehold.householdId, lone));
    const effectRefusal = await failureOf(assign(doorHousehold.householdId, lone));
    expect(tagOf(doorRefusal)).toBe(tagOf(effectRefusal));
    expect(codeOf(doorRefusal)).toBe(codeOf(effectRefusal));
    expect(codeOf(doorRefusal)).toBe("finance_participants_required");

    // a stranger: the same 404
    const stranger = crypto.randomUUID();
    const doorMissing = await rejection(updateParticipantDisplayName(scratch.db, doorHousehold.householdId, stranger, "X"));
    const effectMissing = await failureOf(rename(doorHousehold.householdId, stranger, "X"));
    expect(tagOf(doorMissing)).toBe(tagOf(effectMissing));
    expect(tagOf(doorMissing)).toBe("NotFound");
  });

  test("nowMs: the pinned override, and the real clock once released", async () => {
    const pinned = Date.UTC(2026, 0, 15, 11, 0, 0);
    setClockForTest(pinned);
    expect(nowMs()).toBe(pinned);
    expect(Effect.runSync(financeTimeMillis)).toBe(pinned);
    expect(await Effect.runPromise(financeTimeMillis)).toBe(pinned);

    setClockForTest(null);
    const before = Date.now();
    const fromDoor = nowMs();
    const fromEffect = Effect.runSync(financeTimeMillis);
    const fromEffectAsync = await Effect.runPromise(financeTimeMillis);
    const after = Date.now();
    for (const value of [fromDoor, fromEffect, fromEffectAsync]) {
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

describe("the legacy test doors match their Effect forms", () => {
  let doorRun: LegacyRun;
  let effectRun: LegacyRun;

  beforeAll(async () => {
    doorRun = await createLegacyRun({ mode: "apply" });
    effectRun = await createLegacyRun({ mode: "apply" });
    legacyRuns.push(doorRun, effectRun);
  });

  test("runLegacy: the same value; a tagged error as itself, a DatabaseError as its cause", async () => {
    expect(await runLegacy(Effect.succeed(7))).toBe(await Effect.runPromise(Effect.succeed(7)));
    const mapping = new MappingError({ message: "bad mapping" });
    expect(await rejection(runLegacy(Effect.fail(mapping)))).toBe(mapping);
    expect(await failureOf(Effect.fail(mapping))).toBe(mapping);
    const cause = new Error("SQLITE_BUSY");
    const failure = Effect.fail(new DatabaseError({ cause }));
    expect(await rejection(runLegacy(failure))).toBe(cause);
    expect(rejectionOf(await failureOf(failure))).toBe(cause);
  });

  test("openLegacy: the same snapshot of the same input, and the same refusal of a missing file", async () => {
    const dir = mkdtempSync(join(tempDir, "open-"));
    const input = join(dir, "recipe.db");
    cpSync(join(FIXTURE_DIR, "recipe.db"), input);
    mkdirSync(join(dir, "door"));
    mkdirSync(join(dir, "effect"));
    const fromDoor = await openLegacy("recipe", input, join(dir, "door"));
    legacyClients.push(fromDoor);
    const fromEffect = await Effect.runPromise(openLegacyEffect("recipe", input, join(dir, "effect")));
    legacyClients.push(fromEffect);
    expect(fromDoor.source).toBe(fromEffect.source);
    expect(fromDoor.originalPath).toBe(fromEffect.originalPath);
    expect(await targetCounts(fromDoor.client)).toEqual(await targetCounts(fromEffect.client));

    const missing = join(dir, "absent.db");
    const doorError = await rejection(openLegacy("recipe", missing, join(dir, "door")));
    const effectError = await failureOf(openLegacyEffect("recipe", missing, join(dir, "effect")));
    expect(tagOf(doorError)).toBe(tagOf(effectError));
    expect(tagOf(doorError)).toBe("LegacyInputError");
    expect((doorError as Error).message).toBe((effectError as Error).message);
  });

  test("migrateUsers: the same users in the target and the same report", async () => {
    expect(await migrateUsers(doorRun.ctx)).toBeUndefined();
    expect(await Effect.runPromise(migrateUsersEffect(effectRun.ctx))).toBeUndefined();
    expect(await targetCounts(doorRun.target.client)).toEqual(await targetCounts(effectRun.target.client));
    expect(doorRun.ctx.ids.users.recipe.size).toBe(effectRun.ctx.ids.users.recipe.size);
    expect(doorRun.ctx.ids.users.finance.size).toBe(effectRun.ctx.ids.users.finance.size);
    expect(stableReport(doorRun.ctx.report)).toEqual(stableReport(effectRun.ctx.report));
    expect(doorRun.ctx.report.errors).toEqual([]);
  });

  test("migrateHouseholds: the same households in the target and the same report", async () => {
    expect(await migrateHouseholds(doorRun.ctx)).toBeUndefined();
    expect(await Effect.runPromise(migrateHouseholdsEffect(effectRun.ctx))).toBeUndefined();
    expect(await targetCounts(doorRun.target.client)).toEqual(await targetCounts(effectRun.target.client));
    expect(doorRun.ctx.ids.households.recipe.size).toBe(effectRun.ctx.ids.households.recipe.size);
    expect(stableReport(doorRun.ctx.report)).toEqual(stableReport(effectRun.ctx.report));
    expect(doorRun.ctx.report.errors).toEqual([]);
  });

  test("migrateRecipe: the same backfill count, the same recipe rows and the same report", async () => {
    const fromDoor = await migrateRecipe(doorRun.ctx);
    const fromEffect = await Effect.runPromise(migrateRecipeEffect(effectRun.ctx));
    expect(fromDoor).toEqual(fromEffect);
    expect(await targetCounts(doorRun.target.client)).toEqual(await targetCounts(effectRun.target.client));
    expect(stableReport(doorRun.ctx.report)).toEqual(stableReport(effectRun.ctx.report));
  });

  test("runLegacyMigration: the same dry-run report on the same inputs", async () => {
    const doorPass = await createLegacyRun();
    const effectPass = await createLegacyRun();
    legacyRuns.push(doorPass, effectPass);
    const options = (run: LegacyRun): RunOptions => ({
      mode: "dry-run" as const,
      recipe: run.ctx.recipe,
      finance: run.ctx.finance,
      target: run.target,
      uploads: run.ctx.uploads,
    });
    const fromDoor = await runLegacyMigration(options(doorPass));
    const fromEffect = await Effect.runPromise(runLegacyMigrationEffect(options(effectPass)));
    expect(stableReport(fromDoor)).toEqual(stableReport(fromEffect));
    expect(fromDoor.errors).toEqual([]);
    expect(fromDoor.inputs.map((input) => input.source)).toEqual(["recipe", "finance"]);
  });
});
