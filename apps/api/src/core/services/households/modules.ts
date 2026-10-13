/**
 * household_modules reads + household initialisation (SPEC D2, §2). M1-T09 adds enabling.
 * The core reaches modules only through `modules/index.ts` (API_MODULES).
 */
import { DEFAULT_ENABLED_MODULES, MODULE_IDS, type ModuleId, isModuleId } from "@toon/shared";
import { inArray } from "drizzle-orm";
import { householdModules } from "../../../db/schema.ts";
import { API_MODULES } from "../../../modules/index.ts";
import type { ApiModule } from "../../../modules/types.ts";
import type { DbLike } from "./support.ts";

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
