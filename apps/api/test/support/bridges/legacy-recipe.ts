/**
 * The test door of `apps/api/scripts/legacy/recipe.ts` (docs/EFFECT.md E7, E9, E10; plan `docs/plans/e8-harden.md` P1):
 * moved from `apps/api/scripts/legacy/recipe.ts` at E8 (plan e8 P1). It imports its script module and `./legacy-io.ts`
 * only (no `src/env.ts`, no `src/runtime.ts`; CLAUDE.md "The CLI never imports `src/env.ts`").
 */
import { migrateRecipeEffect } from "../../../scripts/legacy/recipe.ts";
import type { MigrationContext } from "../../../scripts/legacy/types.ts";
import { runLegacy } from "./legacy-io.ts";

/**
 * The Promise form of `migrateRecipeEffect`. Moved from `apps/api/scripts/legacy/recipe.ts` at E8 (plan e8 P1).
 * Callers: `apps/api/test/legacy-cli.test.ts`, `apps/api/test/legacy-recipe.test.ts`.
 */
export function migrateRecipe(ctx: MigrationContext): Promise<{ backfilled: number }> {
  return runLegacy(migrateRecipeEffect(ctx));
}
