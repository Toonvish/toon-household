/**
 * The clock SEAM. Every time-dependent computation (session expiry checks
 * aside, which read Date.now() directly for simplicity) that needs to reason
 * about "now" in a test — first and foremost the fixed-cost plan's period
 * catch-up ([API-DOMÄNE]) — goes through `nowMs()` instead of calling
 * `Date.now()` itself, so a test can pin "now" to a specific month without
 * waiting for a real calendar to turn over.
 *
 * A setter seam, not `mock.module`: this file's own discipline is that
 * whichever test calls `setClockForTest` restores it (`setClockForTest(null)`)
 * in `afterAll`/`afterEach` — see CLAUDE.md's `mock.module` gotcha for why.
 */
let override: number | null = null;

/** Current unix ms — the ONE place production code reads "now" from. */
export function nowMs(): number {
  return override ?? Date.now();
}

/** Pins (or, with `null`, releases) the clock for the current test file. */
export function setClockForTest(ms: number | null): void {
  override = ms;
}
