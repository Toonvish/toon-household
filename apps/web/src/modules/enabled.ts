/**
 * Which modules a household has enabled — pure helpers (SPEC D2, §2, §5).
 *
 * Takes the registry as a PARAMETER and never imports `./index`: `lib/session.tsx`
 * (`RequireModule`) imports this file, and the registry's manifests import screens that
 * import `lib/session.tsx`. Callers compute at call time from `WEB_MODULES`; no
 * module-level constant over it.
 *
 * `enabledIds` is `HouseholdWithRole.modules` — typed `string[]` on the wire, so an id this
 * build does not know (an old client, a newer server) simply never matches: an unknown
 * module reads as disabled.
 */
import type { ModuleId } from "@toon/shared";
import type { WebModule } from "./types";

/** Whether `id` is among the household's enabled module ids. */
export function isModuleEnabled(enabledIds: readonly string[], id: ModuleId): boolean {
  return enabledIds.includes(id);
}

/**
 * The single decision `RequireModule` acts on (SPEC §5 "Module disabled"):
 * `"render"` iff the module is enabled, else `"redirect"` (Home with a toast).
 */
export function moduleGuard(enabledIds: readonly string[], id: ModuleId): "render" | "redirect" {
  return isModuleEnabled(enabledIds, id) ? "render" : "redirect";
}

/** The build's modules the household has enabled, in registry order; unknown ids are ignored. */
export function enabledWebModules(
  modules: readonly WebModule[],
  enabledIds: readonly string[],
): WebModule[] {
  return modules.filter((module) => isModuleEnabled(enabledIds, module.id));
}

/** The build's modules the household has NOT enabled yet (what Settings offers to enable). */
export function availableWebModules(
  modules: readonly WebModule[],
  enabledIds: readonly string[],
): WebModule[] {
  return modules.filter((module) => !isModuleEnabled(enabledIds, module.id));
}
