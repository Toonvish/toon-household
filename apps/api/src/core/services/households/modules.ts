/**
 * household_modules reads, household initialisation and module enabling (SPEC D2, D3, §2).
 * The core reaches modules only through `modules/index.ts` (API_MODULES).
 *
 * A `household_modules` row IS the enabled state: `requireModule(id)` (middleware/module.ts)
 * lets a household's requests through to a module's routes only while the row exists.
 */
import { DEFAULT_ENABLED_MODULES, MODULE_IDS, type ModuleId, isModuleId } from "@toon/shared";
import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "../../../db/client.ts";
import { householdModules } from "../../../db/schema.ts";
import { API_MODULES } from "../../../modules/index.ts";
import type { ApiModule } from "../../../modules/types.ts";
import { type DbLike, nowMs, withTransaction } from "./support.ts";

/** Enabled module ids per household; ids this codebase does not know are dropped (SPEC §2). */
export async function enabledModulesFor(db: DbLike, householdIds: readonly string[]): Promise<Map<string, ModuleId[]>> {
  const result = new Map<string, ModuleId[]>();
  if (householdIds.length === 0) return result;
  const rows = await db
    .select({ householdId: householdModules.householdId, moduleId: householdModules.moduleId })
    .from(householdModules)
    .where(inArray(householdModules.householdId, [...householdIds]));
  for (const row of rows) {
    if (!isModuleId(row.moduleId)) continue;
    const list = result.get(row.householdId) ?? [];
    list.push(row.moduleId);
    result.set(row.householdId, list);
  }
  for (const list of result.values()) list.sort((a, b) => MODULE_IDS.indexOf(a) - MODULE_IDS.indexOf(b));
  return result;
}

/**
 * Every new household: the default module rows (recipe, SPEC D2) — written even when this build
 * lacks the module, the UI filters — then each build module's `onHouseholdCreated` hook, on the
 * same executor so a failing hook rolls the creation back where transactions exist.
 */
export async function initializeHousehold(db: DbLike, householdId: string, modules: readonly ApiModule[] = API_MODULES): Promise<void> {
  const now = Date.now();
  await db
    .insert(householdModules)
    .values(DEFAULT_ENABLED_MODULES.map((moduleId) => ({ householdId, moduleId, enabledAt: now, settings: null })))
    .onConflictDoNothing();
  for (const module of modules) await module.onHouseholdCreated?.(householdId, db);
}

/**
 * Enables `moduleId` for a household (POST /api/households/:householdId/modules/:moduleId).
 *
 * ORDER IS LOAD-BEARING: the build module's `onEnable` hook runs BEFORE the row is written. A
 * hook may refuse by throwing an `ApiError` (finance validates its two participants, SPEC D3);
 * under `bun test` `withTransaction` runs without a transaction (`file::memory:`, see
 * support.ts), so "a refusal writes nothing" holds there only because nothing was written yet.
 *
 * The row is upserted: a repeated enable keeps `enabled_at`; `settings` (JSON text) is replaced
 * only when the caller sent some, otherwise the existing row is left untouched. A module id the
 * build does not contain is still recorded (the UI filters by its own module list, SPEC §2).
 */
export async function enableModule(
  db: Database,
  householdId: string,
  moduleId: ModuleId,
  settings: Record<string, unknown> | undefined,
  modules: readonly ApiModule[] = API_MODULES,
): Promise<void> {
  const module = modules.find((candidate) => candidate.id === moduleId);
  await withTransaction(db, async (tx) => {
    await module?.onEnable?.(householdId, settings ?? null, tx);
    const insert = tx.insert(householdModules).values({
      householdId,
      moduleId,
      enabledAt: nowMs(),
      settings: settings === undefined ? null : JSON.stringify(settings),
    });
    if (settings === undefined) {
      await insert.onConflictDoNothing();
    } else {
      await insert.onConflictDoUpdate({
        target: [householdModules.householdId, householdModules.moduleId],
        set: { settings: JSON.stringify(settings) },
      });
    }
  });
}

/**
 * Disables `moduleId` for a household by deleting its row; idempotent (no row, no error). The
 * module's own household-scoped rows stay in its tables, so re-enabling brings them back.
 */
export async function disableModule(db: DbLike, householdId: string, moduleId: ModuleId): Promise<void> {
  await db
    .delete(householdModules)
    .where(and(eq(householdModules.householdId, householdId), eq(householdModules.moduleId, moduleId)));
}
