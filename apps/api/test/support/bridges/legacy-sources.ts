/**
 * The test door of `apps/api/scripts/legacy/sources.ts` (docs/EFFECT.md E7, E9, E10; plan `docs/plans/e8-harden.md` P1):
 * moved from `apps/api/scripts/legacy/sources.ts` at E8 (plan e8 P1). It imports its script module and `./legacy-io.ts`
 * only (no `src/env.ts`, no `src/runtime.ts`; CLAUDE.md "The CLI never imports `src/env.ts`").
 */
import { openLegacyEffect } from "../../../scripts/legacy/sources.ts";
import type { LegacyDb, LegacySource } from "../../../scripts/legacy/types.ts";
import { runLegacy } from "./legacy-io.ts";

/**
 * The Promise form of `openLegacyEffect`. Moved from `apps/api/scripts/legacy/sources.ts` at E8 (plan e8 P1). Callers:
 * `apps/api/test/support/legacy-harness.ts`, `apps/api/test/legacy-cli.test.ts`, `apps/api/test/legacy-placeholders.test.ts`,
 * `apps/api/test/legacy-users.test.ts`, `apps/api/test/legacy-households.test.ts`, `apps/api/test/legacy-framework.test.ts`.
 */
export function openLegacy(source: LegacySource, path: string, scratchDir: string): Promise<LegacyDb> {
  return runLegacy(openLegacyEffect(source, path, scratchDir));
}
