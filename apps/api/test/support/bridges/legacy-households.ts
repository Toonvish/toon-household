/**
 * The test door of `apps/api/scripts/legacy/households.ts` (docs/EFFECT.md E7, E9, E10; plan `docs/plans/e8-harden.md` P1):
 * moved from `apps/api/scripts/legacy/households.ts` at E8 (plan e8 P1). It imports its script module and `./legacy-io.ts`
 * only (no `src/env.ts`, no `src/runtime.ts`; CLAUDE.md "The CLI never imports `src/env.ts`").
 */
import { migrateHouseholdsEffect } from "../../../scripts/legacy/households.ts";
import type { MigrationContext } from "../../../scripts/legacy/types.ts";
import { runLegacy } from "./legacy-io.ts";

/**
 * The Promise form of `migrateHouseholdsEffect`; a `MappingError` rejects as that object (`exitCode` 2). Moved from
 * `apps/api/scripts/legacy/households.ts` at E8 (plan e8 P1). Callers: `apps/api/test/legacy-cli.test.ts`,
 * `apps/api/test/legacy-households.test.ts`, `apps/api/test/legacy-recipe.test.ts`, `apps/api/test/legacy-finance.test.ts`,
 * `apps/api/test/finance-scheduler.test.ts`.
 */
export function migrateHouseholds(ctx: MigrationContext): Promise<void> {
  return runLegacy(migrateHouseholdsEffect(ctx));
}
