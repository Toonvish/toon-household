/**
 * The bridge between the Promise-based module manifests and the Effect contract (docs/EFFECT.md
 * E7; plan `docs/plans/e2-api-core-services.md` P11; SPEC §2).
 *
 * - `fromPromiseModule(m)` turns a {@link PromiseApiModule} (finance until E4; recipe implements
 *   `ApiModule` itself since E3) into an {@link ApiModule}. A synchronous `healthFeatures` becomes
 *   `Effect.sync` over it. Each hook reads the CURRENT executor of `Database` (the open
 *   transaction inside `Database.transaction`, a handed-in executor, else the root) and calls the
 *   Promise hook with exactly that executor, as the core did before. A rejection that is a member
 *   of the API error family becomes the typed failure UNCHANGED (the same object, so a refusal
 *   reaches the boundary and the tests as it was thrown); anything else is a defect.
 * - `runModuleHook(effect, executor)` runs a hook effect outside the runtime on a BARE drizzle
 *   executor (`Database.layerFromExecutor`): the Promise-based core callers (`runMigrations`,
 *   `initializeHousehold`, `enableModule`, `removeMember`, `collectUploadReferences`, `seed`)
 *   hold a root instance or an open drizzle transaction and hand it over; the hook receives that
 *   very executor. A failure rejects with the squashed value (a refusal is the same object).
 *
 * This file never imports `src/runtime.ts`: `src/db/migrate.ts` imports it, and
 * `scripts/migrate-legacy.ts` imports `migrate.ts` only after redirecting `DATABASE_URL`
 * (CLAUDE.md "The CLI never imports `src/env.ts`, and its import order is load-bearing").
 * Import cycle (CLAUDE.md "API import cycle"): `src/modules/index.ts` calls `fromPromiseModule` at
 * module scope, so it is a hoisted function declaration and reads only `effect` and the
 * `Database` class at call time.
 */
import { Effect } from "effect";
import type { DrizzleDatabase } from "../db/client.ts";
import { Database, type DbExecutor } from "../db/database.ts";
import { type ApiErrorFamily, isApiError } from "../lib/errors.ts";
import type { ApiModule, PromiseApiModule } from "./types.ts";

/**
 * Calls a Promise hook with the current executor. A rejection (or a synchronous throw) from the
 * API error family is the typed failure as is; any other value is a defect.
 */
const callWithExecutor = Effect.fnUntraced(function* <A>(
  call: (executor: DbExecutor) => Promise<A>,
): Effect.fn.Return<A, ApiErrorFamily, Database> {
  const database = yield* Database;
  const executor = yield* database.executor;
  return yield* Effect.tryPromise({ try: () => call(executor), catch: (cause): unknown => cause }).pipe(
    Effect.catch((cause) => (isApiError(cause) ? Effect.fail(cause) : Effect.die(cause))),
  );
});

/**
 * The hooks typed with a root `database` (`afterMigrate`, `uploadReferences`, `seedDemo`) are
 * only ever called on a root executor (`runMigrations(database)`, `collectUploadReferences(db)`,
 * `scripts/seed.ts`), so the current executor is narrowed with this one cast.
 */
function asRoot(executor: DbExecutor): DrizzleDatabase {
  return executor as DrizzleDatabase;
}

/** A Promise rejection of `start` / `shutdown` becomes the failure value unchanged (the boot logs it). */
function fromLifecycle(run: () => Promise<void>): Effect.Effect<void, unknown> {
  return Effect.tryPromise({ try: () => run(), catch: (cause): unknown => cause });
}

/** Wraps a Promise-based manifest into the Effect contract (plan e2 P11). */
export function fromPromiseModule(module: PromiseApiModule): ApiModule {
  const {
    healthFeatures,
    onHouseholdCreated,
    onEnable,
    onMemberRemoving,
    afterMigrate,
    start,
    shutdown,
    seedDemo,
    uploadReferences,
  } = module;
  return {
    id: module.id,
    householdRouter: module.householdRouter,
    userRouter: module.userRouter,
    schema: module.schema,
    healthFeatures: healthFeatures && (() => Effect.sync(() => healthFeatures())),
    onHouseholdCreated:
      onHouseholdCreated &&
      ((householdId) => callWithExecutor((executor) => onHouseholdCreated(householdId, executor))),
    onEnable:
      onEnable && ((householdId, settings) => callWithExecutor((executor) => onEnable(householdId, settings, executor))),
    onMemberRemoving:
      onMemberRemoving &&
      ((householdId, userId) => callWithExecutor((executor) => onMemberRemoving(householdId, userId, executor))),
    afterMigrate: afterMigrate && (() => callWithExecutor((executor) => afterMigrate(asRoot(executor)))),
    start: start && (() => fromLifecycle(start)),
    shutdown: shutdown && (() => fromLifecycle(shutdown)),
    seedDemo: seedDemo && ((context) => callWithExecutor((executor) => seedDemo(asRoot(executor), context))),
    uploadReferences: uploadReferences && (() => callWithExecutor((executor) => uploadReferences(asRoot(executor)))),
  };
}

/**
 * Runs a hook effect on a bare drizzle executor, outside the runtime (plan e2 P11): the hook sees
 * `executor` as the root of `Database` (`Database.layerFromExecutor`), so a Promise hook behind
 * `fromPromiseModule` receives that very executor. Resolves with the hook's value; a failure or a
 * defect rejects with the squashed value (a refusal is the object the hook raised).
 */
export function runModuleHook<A, E>(effect: Effect.Effect<A, E, Database>, executor: DbExecutor): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(Database.layerFromExecutor(executor))));
}
