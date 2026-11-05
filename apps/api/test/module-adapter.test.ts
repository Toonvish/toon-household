/**
 * The module contract on Effects (`src/modules/adapter.ts`; docs/EFFECT.md E7; plan `docs/plans/e2-api-core-services.md`
 * P11; SPEC §2).
 *
 * Covered: a Promise hook behind `fromPromiseModule` receives the open transaction inside `Database.transaction` and
 * the root outside; `runModuleHook(hook, tx)` inside a drizzle transaction hands the hook that very `tx`; a rejected
 * (or synchronously thrown) API error arrives as the SAME object in the error channel and from `runModuleHook`'s
 * rejection; a rejected plain `Error` is a defect; `start` keeps its rejection value; `afterMigrate` through
 * `runMigrations(createDatabase(...).db)` runs on that database (identity, and recipe's real fold backfill there);
 * `API_MODULES` lists recipe unwrapped (E3, with its `layer`) and wraps finance, with their ids and `healthFeatures`.
 *
 * Most cases run on a temp `file:` database of their own with one probe table, never on the shared test DB.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { Cause, Effect, Exit } from "effect";
import { type CreatedDatabase, createDatabase } from "../src/db/client.ts";
import { Database, type DbExecutor } from "../src/db/database.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { households, recipes, users } from "../src/db/schema.ts";
import { ApiError, NotFound } from "../src/lib/errors.ts";
import { fromPromiseModule, runModuleHook } from "../src/modules/adapter.ts";
import { financeModule } from "../src/modules/finance/index.ts";
import { API_MODULES } from "../src/modules/index.ts";
import { recipeModule } from "../src/modules/recipe/index.ts";
import type { ApiModule, PromiseApiModule } from "../src/modules/types.ts";

const dir = mkdtempSync(join(tmpdir(), "toon-household-module-adapter-"));
let primary: CreatedDatabase;
const opened: CreatedDatabase[] = [];

async function open(name: string): Promise<CreatedDatabase> {
  const created = createDatabase({ url: `file:${join(dir, name)}` });
  await created.ready;
  opened.push(created);
  return created;
}

beforeAll(async () => {
  primary = await open("primary.db");
  await primary.db.run(sql`CREATE TABLE probe (id TEXT PRIMARY KEY)`);
});

afterAll(() => {
  for (const created of opened) created.client.close();
  rmSync(dir, { recursive: true, force: true });
});

function onPrimary<A, E>(effect: Effect.Effect<A, E, Database>): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(Database.layerFrom(primary))));
}

function onPrimaryExit<A, E>(effect: Effect.Effect<A, E, Database>): Promise<Exit.Exit<A, E>> {
  return Effect.runPromiseExit(effect.pipe(Effect.provide(Database.layerFrom(primary))));
}

/** A Promise manifest whose `onEnable` records the executor it was handed. */
function recordingModule(): { module: ApiModule; seen: DbExecutor[] } {
  const seen: DbExecutor[] = [];
  const promiseModule: PromiseApiModule = {
    id: "finance",
    schema: {},
    async onEnable(_householdId, _settings, tx) {
      seen.push(tx);
    },
  };
  return { module: fromPromiseModule(promiseModule), seen };
}

function refusingModule(reason: unknown, mode: "reject" | "throw" = "reject"): ApiModule {
  return fromPromiseModule({
    id: "finance",
    schema: {},
    onEnable(): Promise<void> {
      if (mode === "throw") throw reason;
      return Promise.reject(reason);
    },
  });
}

function enableHook(module: ApiModule): Effect.Effect<void, unknown, Database> {
  const hook = module.onEnable;
  if (hook === undefined) throw new Error("the fake module has no onEnable");
  return hook("household-1", null);
}

describe("fromPromiseModule: the executor a Promise hook receives", () => {
  test("the root outside a transaction, the open transaction inside Database.transaction", async () => {
    const { module, seen } = recordingModule();

    await onPrimary(enableHook(module));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(primary.db);

    const inside = await onPrimary(
      Effect.gen(function* () {
        const database = yield* Database;
        return yield* database.transaction(
          Effect.gen(function* () {
            yield* enableHook(module);
            return yield* database.executor;
          }),
        );
      }),
    );
    expect(seen).toHaveLength(2);
    expect(seen[1]).toBe(inside);
    expect(seen[1]).not.toBe(primary.db);
  });

  test("a write of the hook on the open transaction rolls back with it", async () => {
    const writing = fromPromiseModule({
      id: "finance",
      schema: {},
      async onHouseholdCreated(householdId, tx) {
        await tx.run(sql`INSERT INTO probe (id) VALUES (${householdId})`);
      },
    });
    const hook = writing.onHouseholdCreated;
    if (hook === undefined) throw new Error("the fake module has no onHouseholdCreated");

    const exit = await onPrimaryExit(
      Effect.gen(function* () {
        const database = yield* Database;
        return yield* database.transaction(
          Effect.gen(function* () {
            yield* hook("rolled-back");
            return yield* new NotFound();
          }),
        );
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    const rows = await primary.db.all<{ id: string }>(sql`SELECT id FROM probe WHERE id = 'rolled-back'`);
    expect(rows).toEqual([]);
  });
});

describe("runModuleHook", () => {
  test("inside a drizzle transaction the hook receives that very tx", async () => {
    const { module, seen } = recordingModule();
    let held: DbExecutor | undefined;
    await primary.db.transaction(async (tx) => {
      held = tx;
      await runModuleHook(enableHook(module), tx);
    });
    expect(held).toBeDefined();
    expect(seen).toEqual([held as DbExecutor]);
    expect(seen[0]).toBe(held as DbExecutor);
  });

  test("on a root instance the hook receives that instance", async () => {
    const { module, seen } = recordingModule();
    await runModuleHook(enableHook(module), primary.db);
    expect(seen[0]).toBe(primary.db);
  });

  test("resolves with the hook's value", async () => {
    const listing = fromPromiseModule({
      id: "recipe",
      schema: {},
      async uploadReferences() {
        return ["/uploads/a.jpg"];
      },
    });
    const hook = listing.uploadReferences;
    if (hook === undefined) throw new Error("the fake module has no uploadReferences");
    expect(await runModuleHook(hook(), primary.db)).toEqual(["/uploads/a.jpg"]);
  });
});

describe("failures", () => {
  test("a rejected ApiError is the typed failure, the same object", async () => {
    const refusal = new ApiError(409, "participants_missing", "server.error.conflict");
    const failure = await onPrimary(Effect.flip(enableHook(refusingModule(refusal))));
    expect(failure).toBe(refusal);
    await expect(runModuleHook(enableHook(refusingModule(refusal)), primary.db)).rejects.toBe(refusal);
  });

  test("a synchronously thrown family member is the typed failure too", async () => {
    const refusal = new NotFound();
    const failure = await onPrimary(Effect.flip(enableHook(refusingModule(refusal, "throw"))));
    expect(failure).toBe(refusal);
    await expect(runModuleHook(enableHook(refusingModule(refusal, "throw")), primary.db)).rejects.toBe(refusal);
  });

  test("a rejected plain Error is a defect", async () => {
    const boom = new Error("boom");
    const exit = await onPrimaryExit(enableHook(refusingModule(boom)));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasDies(exit.cause)).toBe(true);
      expect(Cause.hasFails(exit.cause)).toBe(false);
      expect(Cause.squash(exit.cause)).toBe(boom);
    }
    await expect(runModuleHook(enableHook(refusingModule(boom)), primary.db)).rejects.toBe(boom);
  });

  test("start keeps its rejection value as the failure", async () => {
    const reason = new Error("start failed");
    const starting = fromPromiseModule({ id: "finance", schema: {}, start: () => Promise.reject(reason) });
    const start = starting.start;
    if (start === undefined) throw new Error("the fake module has no start");
    await expect(onPrimary(start())).rejects.toBe(reason);
  });
});

describe("afterMigrate through runMigrations", () => {
  test("runs on the database handed to runMigrations", async () => {
    const target = await open("migrated.db");
    const recipe = API_MODULES[0] as ApiModule;
    const original = recipe.afterMigrate;
    const seen: DbExecutor[] = [];
    const spy = fromPromiseModule({
      id: "recipe",
      schema: {},
      async afterMigrate(database) {
        seen.push(database);
      },
    });
    recipe.afterMigrate = spy.afterMigrate;
    try {
      await runMigrations(target.db);
    } finally {
      recipe.afterMigrate = original;
    }
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(target.db);
  });

  test("recipe's real fold backfill runs on that database", async () => {
    const target = await open("backfill.db");
    await runMigrations(target.db);
    const userId = crypto.randomUUID();
    const householdId = crypto.randomUUID();
    const recipeId = crypto.randomUUID();
    await target.db.insert(users).values({ id: userId, name: "Fold" });
    await target.db.insert(households).values({ id: householdId, name: "Fold", createdBy: userId });
    await target.db.insert(recipes).values({
      id: recipeId,
      householdId,
      title: "Käsespätzle",
      titleFold: "",
      descriptionFold: "",
      createdBy: userId,
    });

    await runMigrations(target.db);

    const [folded] = await target.db.select().from(recipes).where(eq(recipes.id, recipeId));
    expect(folded?.titleFold).toBe("kasespatzle");
  });
});

describe("the registry", () => {
  test("API_MODULES wraps the two manifests: ids and healthFeatures are theirs", () => {
    expect(API_MODULES.map((module) => module.id)).toEqual(["recipe", "finance"]);
    const [recipe, finance] = API_MODULES;
    // Since E3 recipe implements the Effect contract itself and is listed unwrapped (plan e3 P3).
    expect(recipe).toBe(recipeModule);
    expect(recipe?.healthFeatures).toBe(recipeModule.healthFeatures);
    // Finance has no healthFeatures; the adapter wraps a synchronous one with Effect.sync when present.
    expect(financeModule.healthFeatures).toBeUndefined();
    expect(finance?.healthFeatures).toBeUndefined();
    expect(recipe?.householdRouter).toBe(recipeModule.householdRouter);
    expect(recipe?.userRouter).toBe(recipeModule.userRouter);
    expect(finance?.householdRouter).toBe(financeModule.householdRouter);
    expect(recipe?.schema).toBe(recipeModule.schema);
    expect(finance?.schema).toBe(financeModule.schema);
    expect(recipe?.layer).toBeDefined();
    expect(recipe?.layer).toBe(recipeModule.layer);
    expect(finance?.layer).toBeDefined();
    expect(finance?.onEnable).toBeDefined();
    expect(finance?.onMemberRemoving).toBeDefined();
    expect(recipe?.onEnable).toBeUndefined();
  });
});
