/**
 * The test door of `apps/api/src/modules/recipe/services/import/url/ssrf.ts` (docs/EFFECT.md E7, E9; plan
 * `docs/plans/e8-harden.md` P1): moved from `apps/api/src/modules/recipe/services/import/url/ssrf.ts` at E8 (plan e8
 * P1).
 */
import { Effect } from "effect";
import {
  type AssertPublicUrlOptions,
  checkPublicUrl,
  entryGuard,
} from "../../../src/modules/recipe/services/import/url/ssrf.ts";

/**
 * Promise entry point of `checkPublicUrl`: runs it outside the runtime, so it reads `env.allowPrivateImportHosts`
 * itself (`entryGuard`). Rejects with the `SsrfError` itself; resolves with the parsed URL when it is safe to fetch.
 * Moved from `apps/api/src/modules/recipe/services/import/url/ssrf.ts` at E8 (plan e8 P1). Callers:
 * `apps/api/test/import/ssrf.test.ts`.
 */
export function assertPublicUrl(input: string, options: AssertPublicUrlOptions = {}): Promise<URL> {
  return Effect.runPromise(checkPublicUrl(input, entryGuard(options)));
}
