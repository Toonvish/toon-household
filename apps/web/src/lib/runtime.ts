/**
 * The web app's ONE `ManagedRuntime` (docs/EFFECT.md E11, E7; plan docs/plans/e6-web-client.md P1, P2, P6, P16).
 *
 * `WebLayer` is `ApiClient.layer` over the transport: `FetchHttpClient` with `credentials: "include"` on every
 * request, a LATE-BOUND `Fetch` (the reference's default `() => globalThis.fetch` is evaluated once and cached, so a
 * test that replaces `globalThis.fetch` per test, or any later replacement, would never be seen) and trace
 * propagation off (no `b3` / `traceparent` header: the request headers stay exactly the app's, and the dev setup's
 * cross-origin calls get no new preflight header). No `filterStatusOk` (a status is mapped by `ApiClient`), no
 * `retryTransient` and no `followRedirects` (TanStack's `shouldRetry` owns retries; `fetch` follows redirects).
 *
 * `runPromise(effect, { signal })` is the one way web code runs an API effect: success resolves the value, an
 * interruption by the aborted `signal` rejects with the signal's reason (a `DOMException` named `AbortError`, what
 * `fetch` rejected with before), any other failure rejects with the tagged error itself.
 *
 * Import cycle (P16): `api-client.ts` → `@/lib/i18n/store.ts` → `@/lib/api` → this file → `api-client.ts`. The module
 * scope therefore reads only `Layer` and `ManagedRuntime`; `Layer.suspend` defers `webLayer()` (a hoisted function)
 * to the first run. The runtime is never disposed: it lives as long as the page.
 */
import { Cause, type Effect, Exit, Layer, ManagedRuntime } from "effect";
import { FetchHttpClient, HttpClient } from "effect/http";
import { ApiClient } from "./api-client.ts";

/** Everything an effect run on the web runtime may require. */
export type WebServices = ApiClient | HttpClient.HttpClient;

/** `fetch` read at CALL time, never cached (see the header). The one `fetch(` call of the web app. */
function lateBoundFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return globalThis.fetch(input, init);
}

function transportLayer(): Layer.Layer<HttpClient.HttpClient> {
  return FetchHttpClient.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(FetchHttpClient.RequestInit, { credentials: "include" }),
        // Bun's `typeof fetch` carries an extra `preconnect` the client never calls; the DOM one does not.
        Layer.succeed(FetchHttpClient.Fetch, lateBoundFetch as typeof globalThis.fetch),
        Layer.succeed(HttpClient.TracerPropagationEnabled, false),
      ),
    ),
  );
}

function webLayer(): Layer.Layer<WebServices> {
  return Layer.provideMerge(ApiClient.layer, transportLayer());
}

export const WebLayer: Layer.Layer<WebServices> = Layer.suspend(webLayer);

export const runtime = ManagedRuntime.make(WebLayer);

export interface RunOptions {
  readonly signal?: AbortSignal | undefined;
}

export async function runPromise<A, E>(effect: Effect.Effect<A, E, WebServices>, options?: RunOptions): Promise<A> {
  const signal = options?.signal;
  const exit = await runtime.runPromiseExit(effect, signal ? { signal } : undefined);
  if (Exit.isSuccess(exit)) return exit.value;
  if (signal?.aborted && Cause.hasInterruptsOnly(exit.cause)) {
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
  }
  throw Cause.squash(exit.cause);
}
