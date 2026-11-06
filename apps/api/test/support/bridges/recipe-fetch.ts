/**
 * The test door of `apps/api/src/modules/recipe/services/import/url/fetch.ts` (docs/EFFECT.md E7, E9; plan
 * `docs/plans/e8-harden.md` P1): moved from `apps/api/src/modules/recipe/services/import/url/fetch.ts` at E8 (plan e8
 * P1). The seam `setImportGuardForTests` stays in `src` (plan e8 P2).
 */
import { Effect } from "effect";
import { FetchHttpClient, HttpClient } from "effect/http";
import {
  type FetchHtmlOptions,
  type FetchedHtml,
  fetchHtmlWith,
  guardNow,
} from "../../../src/modules/recipe/services/import/url/fetch.ts";
import { entryGuard } from "../../../src/modules/recipe/services/import/url/ssrf.ts";

/**
 * Fetches a public web page as HTML outside the runtime, on the same core as `ImportHttp.fetchHtml`
 * (`fetchHtmlWith`). Moved from `apps/api/src/modules/recipe/services/import/url/fetch.ts` at E8 (plan e8 P1). Callers:
 * `apps/api/test/import/ssrf.test.ts`, `apps/api/test/import/import-http.test.ts`.
 *
 * @throws ApiFailure 400 `fetch_failed` (the failure itself, `instanceof ApiError`) for SSRF violations, network
 *   errors, timeouts, non-2xx responses, redirect loops and non-HTML content types.
 */
export function fetchHtml(rawUrl: string, options: FetchHtmlOptions = {}): Promise<FetchedHtml> {
  const program = Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    return yield* fetchHtmlWith(client, guardNow(entryGuard(options)), rawUrl, options);
  }).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.provideService(FetchHttpClient.Fetch, options.fetchImpl ?? globalThis.fetch),
  );
  return Effect.runPromise(program);
}
