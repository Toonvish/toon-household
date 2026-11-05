/**
 * The clock SEAM. Every time-dependent computation (session expiry checks
 * aside, which read Date.now() directly for simplicity) that needs to reason
 * about "now" in a test — first and foremost the fixed-cost plan's period
 * catch-up ([API-DOMÄNE]) — goes through the module clock instead of calling
 * `Date.now()` itself, so a test can pin "now" to a specific month without
 * waiting for a real calendar to turn over.
 *
 * Since E4 (docs/EFFECT.md E7, E12; plan `docs/plans/e4-finance-services.md` P6) the services read
 * {@link financeTimeMillis}, an Effect: the `setClockForTest` override when one is set, else the fiber's
 * `Clock`, so a `TestClock` drives every row stamp, the catch-up and the scheduler. It reads the time on
 * every run (never captured at layer build). The synchronous `nowMs()` stays for the test harness
 * (`apps/api/test/support/finance-harness.ts`) and the callers not converted yet.
 *
 * A setter seam, not `mock.module`: this file's own discipline is that
 * whichever test calls `setClockForTest` restores it (`setClockForTest(null)`)
 * in `afterAll`/`afterEach` — see CLAUDE.md's `mock.module` gotcha for why.
 *
 * Import cycle (CLAUDE.md "API import cycle"): the module scope reads only `effect` exports and this file's own
 * `override`.
 */
import { Clock, Effect } from "effect";

let override: number | null = null;

/** Current unix ms — the synchronous read of the module clock (the override, else `Date.now()`). */
export function nowMs(): number {
  return override ?? Date.now();
}

/** Current unix ms as an Effect: the `setClockForTest` override, else the fiber's `Clock` (P6). */
export const financeTimeMillis: Effect.Effect<number> = Effect.suspend(() =>
  override === null ? Clock.currentTimeMillis : Effect.succeed(override),
);

/** Pins (or, with `null`, releases) the clock for the current test file. */
export function setClockForTest(ms: number | null): void {
  override = ms;
}
