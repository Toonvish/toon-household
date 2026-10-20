/**
 * household_modules reads, household initialisation and module enabling (SPEC D2, D3, §2).
 * The core reaches modules only through `modules/index.ts` (API_MODULES).
 *
 * A `household_modules` row IS the enabled state: `requireModule(id)` (middleware/module.ts)
 * lets a household's requests through to a module's routes only while the row exists.
 *
 * The `HouseholdModules` service (docs/EFFECT.md E7; plan `docs/plans/e2-api-core-services.md` P2, P7, P11) reads
 * the current executor of `Database` on every call, takes `enabledAt` from the `Clock`, and runs the module hooks
 * (Effects since E2-T05) with `yield*` on that same executor: inside `database.transaction` the open transaction,
 * which a Promise-based manifest behind `fromPromiseModule` receives as its `tx`. `modules` defaults to the build's
 * `API_MODULES`, read when a method is called, never at import (CLAUDE.md "API import cycle"). The two Promise bridges
 * at the end of the file (`initializeHousehold`, `enableModule`) keep the seed script, the finance seed and
 * `finance-seed.test.ts` working until E4/E5.
 */
import { DEFAULT_ENABLED_MODULES, MODULE_IDS, type ModuleId, isModuleId } from "@toon/shared";
import { and, eq, inArray } from "drizzle-orm";
import { Clock, Context, Effect, Layer } from "effect";
import type { Database as DrizzleDatabase } from "../../../db/client.ts";
import { Database } from "../../../db/database.ts";
import { householdModules } from "../../../db/schema.ts";
import type { DatabaseError } from "../../../lib/errors.ts";
import { API_MODULES } from "../../../modules/index.ts";
import type { ApiModule, HookError } from "../../../modules/types.ts";
import { runtime } from "../../../runtime.ts";
import type { DbLike } from "./support.ts";

/** The module rows of households: reading, initialising, enabling and disabling (SPEC D2, D3, §2). */
export class HouseholdModules extends Context.Service<
  HouseholdModules,
  {
    /** Enabled module ids per household; ids this codebase does not know are dropped (SPEC §2). */
    readonly enabledModulesFor: (
      householdIds: readonly string[],
    ) => Effect.Effect<Map<string, ModuleId[]>, DatabaseError>;
    /**
     * Every new household: the default module rows (recipe, SPEC D2) — written even when this build
     * lacks the module, the UI filters — then each build module's `onHouseholdCreated` hook, on the
     * same executor so a failing hook rolls the creation back where transactions exist.
     */
    readonly initializeHousehold: (householdId: string, modules?: readonly ApiModule[]) => Effect.Effect<void, HookError>;
    /**
     * Enables `moduleId` for a household (POST /api/households/:householdId/modules/:moduleId).
     *
     * ORDER IS LOAD-BEARING: the build module's `onEnable` hook runs BEFORE the row is written. A
     * hook may refuse by failing with an API error (finance validates its two participants, SPEC D3);
     * "a refusal writes nothing" holds because nothing was written yet, and it must keep holding
     * on a memory DB, where `Database.transaction` runs without a transaction (`bun test` itself
     * runs on a temp file DB with real transactions since ADR 0009).
     *
     * The row is upserted: a repeated enable keeps `enabled_at`; `settings` (JSON text) is replaced
     * only when the caller sent some, otherwise the existing row is left untouched. A module id the
     * build does not contain is still recorded (the UI filters by its own module list, SPEC §2).
     */
    readonly enableModule: (
      householdId: string,
      moduleId: ModuleId,
      settings: Record<string, unknown> | undefined,
      modules?: readonly ApiModule[],
    ) => Effect.Effect<void, HookError>;
    /**
     * Disables `moduleId` for a household by deleting its row; idempotent (no row, no error). The
     * module's own household-scoped rows stay in its tables, so re-enabling brings them back.
     */
    readonly disableModule: (householdId: string, moduleId: ModuleId) => Effect.Effect<void, DatabaseError>;
  }
>()("toon/api/core/services/households/modules/HouseholdModules") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const database = yield* Database;

      const enabledModulesFor = Effect.fn("HouseholdModules.enabledModulesFor")(function* (
        householdIds: readonly string[],
      ) {
        const result = new Map<string, ModuleId[]>();
        if (householdIds.length === 0) return result;
        const rows = yield* database.use((db) =>
          db
            .select({ householdId: householdModules.householdId, moduleId: householdModules.moduleId })
            .from(householdModules)
            .where(inArray(householdModules.householdId, [...householdIds])),
        );
        for (const row of rows) {
          if (!isModuleId(row.moduleId)) continue;
          const list = result.get(row.householdId) ?? [];
          list.push(row.moduleId);
          result.set(row.householdId, list);
        }
        for (const list of result.values()) list.sort((a, b) => MODULE_IDS.indexOf(a) - MODULE_IDS.indexOf(b));
        return result;
      });

      const initializeHousehold = Effect.fn("HouseholdModules.initializeHousehold")(function* (
        householdId: string,
        modules: readonly ApiModule[] = API_MODULES,
      ) {
        const now = yield* Clock.currentTimeMillis;
        yield* database.use((db) =>
          db
            .insert(householdModules)
            .values(DEFAULT_ENABLED_MODULES.map((moduleId) => ({ householdId, moduleId, enabledAt: now, settings: null })))
            .onConflictDoNothing(),
        );
        // Each hook runs on the current executor (the creation's transaction inside `createHousehold`), which a
        // Promise-based manifest receives as its `tx` (plan e2 P11).
        for (const module of modules) {
          if (module.onHouseholdCreated) {
            yield* module.onHouseholdCreated(householdId).pipe(Effect.provideService(Database, database));
          }
        }
      });

      const enableModule = Effect.fn("HouseholdModules.enableModule")(function* (
        householdId: string,
        moduleId: ModuleId,
        settings: Record<string, unknown> | undefined,
        modules: readonly ApiModule[] = API_MODULES,
      ) {
        const module = modules.find((candidate) => candidate.id === moduleId);
        yield* database.transaction(
          Effect.gen(function* () {
            // The hook runs on the transaction opened here (plan e2 P11), still BEFORE the upsert.
            if (module?.onEnable) {
              yield* module.onEnable(householdId, settings ?? null).pipe(Effect.provideService(Database, database));
            }
            const enabledAt = yield* Clock.currentTimeMillis;
            yield* database.use((tx) => {
              const insert = tx.insert(householdModules).values({
                householdId,
                moduleId,
                enabledAt,
                settings: settings === undefined ? null : JSON.stringify(settings),
              });
              return settings === undefined
                ? insert.onConflictDoNothing()
                : insert.onConflictDoUpdate({
                    target: [householdModules.householdId, householdModules.moduleId],
                    set: { settings: JSON.stringify(settings) },
                  });
            });
          }),
        );
      });

      const disableModule = Effect.fn("HouseholdModules.disableModule")(function* (
        householdId: string,
        moduleId: ModuleId,
      ) {
        yield* database.use((db) =>
          db
            .delete(householdModules)
            .where(and(eq(householdModules.householdId, householdId), eq(householdModules.moduleId, moduleId))),
        );
      });

      return HouseholdModules.of({ enabledModulesFor, initializeHousehold, enableModule, disableModule });
    }),
  );
}

/* legacy bridges: callers listed; E3 (recipe), E4 (finance), E5 (scripts) remove them */

/**
 * Runs on `db`, the executor the caller holds (the creation's transaction inside `createHousehold`).
 * Callers: `scripts/seed.ts` (E5), `apps/api/test/finance-seed.test.ts` (E4). Promise.
 */
export function initializeHousehold(
  db: DbLike,
  householdId: string,
  modules: readonly ApiModule[] = API_MODULES,
): Promise<void> {
  return runtime.runPromise(
    HouseholdModules.use((service) => service.initializeHousehold(householdId, modules)).pipe(Database.withExecutor(db)),
  );
}

/** Callers: `modules/finance/seed.ts` (E4). Promise. */
export function enableModule(
  db: DrizzleDatabase,
  householdId: string,
  moduleId: ModuleId,
  settings: Record<string, unknown> | undefined,
  modules: readonly ApiModule[] = API_MODULES,
): Promise<void> {
  return runtime.runPromise(
    HouseholdModules.use((service) => service.enableModule(householdId, moduleId, settings, modules)).pipe(
      Database.withExecutor(db),
    ),
  );
}
