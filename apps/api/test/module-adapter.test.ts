/**
 * The module contract on Effects (`src/modules/types.ts`; docs/EFFECT.md E7; plan `docs/plans/e2-api-core-services.md`
 * P11; SPEC §2).
 *
 * Covered: an Effect hook of an `ApiModule` literal reads the open transaction from `Database` inside
 * `Database.transaction` and the root outside; `runHook(hook, tx)` inside a drizzle transaction hands the hook
 * that very `tx`; an API error the hook fails with (or raises with `return yield*`) arrives as the SAME object in
 * the error channel and from `runHook`'s rejection; a defect (`Effect.die(error)`) stays a defect; `start`
 * keeps its failure value; `afterMigrate` through `runMigrations(createDatabase(...).db)` runs on that database
 * (identity, and recipe's real fold backfill there); `API_MODULES` lists recipe and finance unwrapped (E3, E4: each
 * with its `layer`), with their ids and `healthFeatures`.
 * The fake modules are `ApiModule` literals with Effect hooks since E4-T09 (plan `docs/plans/e4-finance-services.md` P11).
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
import { ApiError, type ApiErrorFamily, isApiError, NotFound } from "../src/lib/errors.ts";
import { financeModule } from "../src/modules/finance/index.ts";
import { API_MODULES } from "../src/modules/index.ts";
import { recipeModule } from "../src/modules/recipe/index.ts";
import type { ApiModule } from "../src/modules/types.ts";

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

/**
 * Runs a hook effect on a bare drizzle executor outside the runtime, as the Promise-based callers do (E5-T09: the
 * helper that was `runModuleHook`): `executor` is the root of `Database`, a failure or defect rejects with the
 * squashed value (a refusal is the same object).
 */
function runHook<A, E>(effect: Effect.Effect<A, E, Database>, executor: DbExecutor): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(Database.layerFromExecutor(executor))));
}

function onPrimary<A, E>(effect: Effect.Effect<A, E, Database>): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(Database.layerFrom(primary))));
}

function onPrimaryExit<A, E>(effect: Effect.Effect<A, E, Database>): Promise<Exit.Exit<A, E>> {
  return Effect.runPromiseExit(effect.pipe(Effect.provide(Database.layerFrom(primary))));
}

/** The current executor of `Database`, the one a hook reads (the open transaction inside `Database.transaction`). */
const currentExecutor = Effect.gen(function* () {
  const database = yield* Database;
  return yield* database.executor;
});

/** A manifest whose `onEnable` records the executor it reads from `Database`. */
function recordingModule(): { module: ApiModule; seen: DbExecutor[] } {
  const seen: DbExecutor[] = [];
  const module: ApiModule = {
    id: "finance",
    schema: {},
    onEnable: () =>
      Effect.gen(function* () {
        seen.push(yield* currentExecutor);
      }),
  };
  return { module, seen };
}

/** `fail`: the hook's error channel; `yield`: raised inside a generator with `return yield*`; `die`: a defect. */
function refusingModule(reason: ApiErrorFamily | Error, mode: "fail" | "yield" | "die" = "fail"): ApiModule {
  return {
    id: "finance",
    schema: {},
    onEnable: () => {
      if (mode === "die") return Effect.die(reason);
      if (mode === "yield" && isApiError(reason)) {
        return Effect.gen(function* () {
          return yield* reason;
        });
      }
      return Effect.fail(reason as ApiErrorFamily);
    },
  };
}

function enableHook(module: ApiModule): Effect.Effect<void, unknown, Database> {
  const hook = module.onEnable;
  if (hook === undefined) throw new Error("the fake module has no onEnable");
  return hook("household-1", null);
}

describe("the executor an Effect hook reads from Database", () => {
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
    const writing: ApiModule = {
      id: "finance",
      schema: {},
      onHouseholdCreated: (householdId) =>
        Effect.gen(function* () {
          const executor = yield* currentExecutor;
          yield* Effect.promise(() => executor.run(sql`INSERT INTO probe (id) VALUES (${householdId})`));
        }),
    };
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

describe("runHook", () => {
  test("inside a drizzle transaction the hook receives that very tx", async () => {
    const { module, seen } = recordingModule();
    let held: DbExecutor | undefined;
    await primary.db.transaction(async (tx) => {
      held = tx;
      await runHook(enableHook(module), tx);
    });
    expect(held).toBeDefined();
    expect(seen).toEqual([held as DbExecutor]);
    expect(seen[0]).toBe(held as DbExecutor);
  });

  test("on a root instance the hook receives that instance", async () => {
    const { module, seen } = recordingModule();
    await runHook(enableHook(module), primary.db);
    expect(seen[0]).toBe(primary.db);
  });

  test("resolves with the hook's value", async () => {
    const listing: ApiModule = {
      id: "recipe",
      schema: {},
      uploadReferences: () => Effect.succeed(["/uploads/a.jpg"]),
    };
    const hook = listing.uploadReferences;
    if (hook === undefined) throw new Error("the fake module has no uploadReferences");
    expect(await runHook(hook(), primary.db)).toEqual(["/uploads/a.jpg"]);
  });
});

describe("failures", () => {
  test("a rejected ApiError is the typed failure, the same object", async () => {
    const refusal = new ApiError(409, "participants_missing", "server.error.conflict");
    const failure = await onPrimary(Effect.flip(enableHook(refusingModule(refusal))));
    expect(failure).toBe(refusal);
    await expect(runHook(enableHook(refusingModule(refusal)), primary.db)).rejects.toBe(refusal);
  });

  test("a family member raised with return yield* is the typed failure too", async () => {
    const refusal = new NotFound();
    const failure = await onPrimary(Effect.flip(enableHook(refusingModule(refusal, "yield"))));
    expect(failure).toBe(refusal);
    await expect(runHook(enableHook(refusingModule(refusal, "yield")), primary.db)).rejects.toBe(refusal);
  });

  test("a plain Error the hook dies with is a defect", async () => {
    const boom = new Error("boom");
    const exit = await onPrimaryExit(enableHook(refusingModule(boom, "die")));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasDies(exit.cause)).toBe(true);
      expect(Cause.hasFails(exit.cause)).toBe(false);
      expect(Cause.squash(exit.cause)).toBe(boom);
    }
    await expect(runHook(enableHook(refusingModule(boom, "die")), primary.db)).rejects.toBe(boom);
  });

  test("start keeps its failure value", async () => {
    const reason = new Error("start failed");
    const starting: ApiModule = { id: "finance", schema: {}, start: () => Effect.fail(reason) };
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
    const spy: ApiModule = {
      id: "recipe",
      schema: {},
      afterMigrate: () =>
        Effect.gen(function* () {
          seen.push(yield* currentExecutor);
        }),
    };
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
  test("API_MODULES lists the two manifests unwrapped: ids and healthFeatures are theirs", () => {
    expect(API_MODULES.map((module) => module.id)).toEqual(["recipe", "finance"]);
    const [recipe, finance] = API_MODULES;
    // Since E3 recipe implements the Effect contract itself and is listed unwrapped (plan e3 P3).
    expect(recipe).toBe(recipeModule);
    expect(recipe?.healthFeatures).toBe(recipeModule.healthFeatures);
    // Since E4 finance is listed unwrapped too (plan e4 P3); it has no healthFeatures.
    expect(financeModule.healthFeatures).toBeUndefined();
    expect(finance?.healthFeatures).toBeUndefined();
    expect(recipe?.householdApi).toBe(recipeModule.householdApi);
    expect(recipe?.userApi).toBe(recipeModule.userApi);
    expect(finance?.householdApi).toBe(financeModule.householdApi);
    expect(recipe?.schema).toBe(recipeModule.schema);
    expect(finance?.schema).toBe(financeModule.schema);
    expect(recipe?.layer).toBeDefined();
    expect(recipe?.layer).toBe(recipeModule.layer);
    expect(finance?.layer).toBe(financeModule.layer);
    expect(finance?.layer).toBeDefined();
    expect(finance?.onEnable).toBeDefined();
    expect(finance?.onMemberRemoving).toBeDefined();
    expect(recipe?.onEnable).toBeUndefined();
  });
});
