import { Enum } from "../core/schemas/checks.ts";

/** The modules this codebase knows (SPEC §2). Order is display order. */
export const MODULE_IDS = ["recipe", "finance"] as const;
export type ModuleId = (typeof MODULE_IDS)[number];
export function isModuleId(value: string): value is ModuleId {
  return (MODULE_IDS as readonly string[]).includes(value);
}

/** Wire validation of a module id path/body value. */
export const ModuleIdSchema = Enum(MODULE_IDS);
/** Enabled on every new household (SPEC D2: recipe by default; finance needs its two slots, D3). */
export const DEFAULT_ENABLED_MODULES: readonly ModuleId[] = ["recipe"];
