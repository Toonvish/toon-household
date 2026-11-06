/**
 * The test door of `apps/api/src/modules/finance/lib/clock.ts` (docs/EFFECT.md E7, E9, E12; plan
 * `docs/plans/e8-harden.md` P1): moved from `apps/api/src/modules/finance/lib/clock.ts` at E8 (plan e8 P1). The one door
 * that is not a verbatim copy: the old `nowMs()` read the module-private override, so this one reads the exported
 * `financeTimeMillis` synchronously. The seam `setClockForTest` stays in `src` (plan e8 P2).
 */
import { Effect } from "effect";
import { financeTimeMillis } from "../../../src/modules/finance/lib/clock.ts";

/**
 * Current unix ms, the synchronous read of the finance module clock: the `setClockForTest` override when one is set,
 * else `Clock.currentTimeMillis` under the default services, which is `Date.now()`. Moved from
 * `apps/api/src/modules/finance/lib/clock.ts` at E8 (plan e8 P1). Callers: `apps/api/test/support/finance-harness.ts`,
 * `apps/api/test/finance-clock.test.ts`.
 */
export function nowMs(): number {
  return Effect.runSync(financeTimeMillis);
}
