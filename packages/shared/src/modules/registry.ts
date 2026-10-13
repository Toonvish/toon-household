/** The modules this codebase knows (SPEC §2). Order is display order. */
export const MODULE_IDS = ["recipe", "finance"] as const;
export type ModuleId = (typeof MODULE_IDS)[number];
export function isModuleId(value: string): value is ModuleId {
  return (MODULE_IDS as readonly string[]).includes(value);
}
