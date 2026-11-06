/**
 * The test door of `apps/api/src/core/services/auth/rateLimit.ts` (docs/EFFECT.md E7, E9; plan
 * `docs/plans/e8-harden.md` P1): moved from `apps/api/src/core/services/auth/rateLimit.ts` at E8 (plan e8 P1). The seam
 * `resetRateLimits` stays in `src` (plan e8 P2).
 */
import { Effect } from "effect";
import { type RateLimitResult, type RateLimitRule, checkIn } from "../../../src/core/services/auth/rateLimit.ts";

/**
 * Records an attempt for `key` in the live bucket store and reports whether it is allowed. SYNCHRONOUS with its old
 * return type (plan e2 P1, P9): a service-free effect run with `Effect.runSync`, time from the default `Clock`. Moved
 * from `apps/api/src/core/services/auth/rateLimit.ts` at E8 (plan e8 P1). Callers: `apps/api/test/auth.test.ts`
 * (rate-limit block), `apps/api/test/rate-limiter.test.ts`.
 */
export function checkRateLimit(key: string, rule: RateLimitRule): RateLimitResult {
  return Effect.runSync(checkIn(key, rule));
}
