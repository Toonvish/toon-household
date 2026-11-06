/**
 * The test door of `apps/api/scripts/legacy/io.ts` (docs/EFFECT.md E7, E9, E10; plan `docs/plans/e8-harden.md` P1):
 * moved from `apps/api/scripts/legacy/io.ts` at E8 (plan e8 P1). The CLI runs the library under `BunRuntime.runMain`;
 * only the tests still need a Promise.
 *
 * Like its source module: no module-scope code beyond imports, never `src/runtime.ts`, never `src/env.ts`.
 */
import { Effect } from "effect";
import { isDatabaseError } from "../../../src/lib/errors.ts";

/**
 * Runs a library effect as a Promise. A `DatabaseError` rejects with its `cause`, anything else (a tagged error of
 * the library, a defect) with the squashed value unchanged. Moved from `apps/api/scripts/legacy/io.ts` at E8 (plan e8
 * P1). Callers: the five legacy doors beside it, `apps/api/test/legacy-io.test.ts`, `apps/api/test/legacy-finance.test.ts`,
 * `apps/api/test/legacy-framework.test.ts`, `apps/api/test/legacy-recipe.test.ts`, `apps/api/test/finance-scheduler.test.ts`.
 */
export function runLegacy<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(effect).then(undefined, (error: unknown) =>
    Promise.reject(isDatabaseError(error) ? error.cause : error),
  );
}
