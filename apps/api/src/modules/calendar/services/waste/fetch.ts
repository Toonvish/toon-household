/**
 * `WasteFlyerFetch` (plan m8 P17, design §5.5): downloads a provider's waste flyer PDF over the `effect/http` `HttpClient`.
 *
 * - Only `https:` and a host EXACTLY in `WASTE_PROVIDERS[provider].hosts` (`checkWasteSourceUrl`, pure, over the shared
 *   `isWasteSourceHost`): no credentials, no port, no suffix match. Never `IMPORT_ALLOW_PRIVATE_HOSTS`: the allow list is
 *   the city's own hosts, so no private address can be reached.
 * - Redirects are followed BY HAND, one request per hop (`redirect: "manual"`), at most `CALENDAR_LIMITS.wasteRedirectsMax`,
 *   and every hop's target is checked BEFORE it is requested (a redirect off the city's hosts is refused, not fetched).
 * - No `traceparent` / `b3` on the wire (`HttpClient.TracerPropagationEnabled` false around each request): the city's
 *   server has no business seeing this server's trace ids.
 * - The whole fetch (every hop and the body) runs under `CALENDAR_LIMITS.wasteTimeoutMs` (20 s); the body is capped at
 *   `CALENDAR_LIMITS.wastePdfMaxBytes` (10 MiB) by `Content-Length` AND by the streamed count (an over-long body is
 *   cancelled, never buffered).
 *
 * Refusals (`./errors.ts`): `400 calendar_waste_source_refused` (scheme or host, first URL or a hop);
 * `502 calendar_waste_fetch_failed` with `details: [{ reason }]`: `network` (transport error, an unreadable body),
 * `status` (non-2xx, a redirect without `Location`), `redirects` (too many), `timeout`, `tooLarge`. Whether the bytes are a
 * PDF is the extractor's question (`WastePdfText`, check `notPdf`).
 *
 * Layers: `layerFromClient` needs an `HttpClient` (the tests hand in an `HttpClient.make` client that records every
 * request); `layer` provides `FetchHttpClient.layer` itself (`HttpClient` is no `ModuleRequirements` service, P27);
 * `layerTest(bytesByUrl)` serves fixture bytes per URL after the same URL check. The route tests reach the runtime's
 * service through the seam `setWasteFlyerFetchForTests(makeTestWasteFlyerFetch(bytesByUrl))`; without it, the production
 * layer under `bun test` answers `502 … network` without a request: no test reaches the network.
 * Its static layers reference only `effect` exports and its own class (CLAUDE.md "One composition point").
 *
 * The SHAPE of the recipe URL importer's hop loop (`apps/api/src/modules/recipe/services/import/url/fetch.ts`), never
 * imported from it (module boundary).
 */
import { CALENDAR_LIMITS, type WasteProviderId, isWasteSourceHost } from "@toon/shared";
import { Context, Effect, Layer, Stream } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest, type HttpClientResponse } from "effect/http";
import { env } from "../../../../env.ts";
import type { ApiFailure } from "../../../../lib/errors.ts";
import { wasteFetchFailed, wasteSourceRefused } from "./errors.ts";

/** A downloaded flyer: its bytes and the URL they finally came from. */
export interface FetchedWasteFlyer {
  readonly bytes: Uint8Array;
  /** The last hop's URL (the requested one when there was no redirect). */
  readonly url: string;
}

/** The User-Agent of the download: honest, and enough for a city web server. */
export const WASTE_FETCH_USER_AGENT = "toon-household/1 (waste schedule import)";

/**
 * The URL when `rawUrl` may be fetched for `provider` (P17), else `undefined`: it parses, is `https:`, has no user,
 * password or port, and its host is exactly one of the provider's hosts.
 */
export function checkWasteSourceUrl(provider: WasteProviderId, rawUrl: string): URL | undefined {
  if (!isWasteSourceHost(provider, rawUrl)) return undefined;
  return new URL(rawUrl);
}

/* ---------------------------------- requests -------------------------------- */

const flyerRequest = (url: string): HttpClientRequest.HttpClientRequest =>
  HttpClientRequest.get(url, {
    headers: { "User-Agent": WASTE_FETCH_USER_AGENT, Accept: "application/pdf,*/*;q=0.5" },
  });

/** One request: redirects left to the caller, no trace headers on the wire. */
const send = (client: HttpClient.HttpClient, url: string) =>
  client.execute(flyerRequest(url)).pipe(
    Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
    Effect.provideService(HttpClient.TracerPropagationEnabled, false),
    Effect.mapError(() => wasteFetchFailed("network")),
  );

/** Gives up on a body nobody will read: one chunk pulled, then the stream (and the request) is cancelled; never fails. */
const discard = (response: HttpClientResponse.HttpClientResponse): Effect.Effect<void> =>
  response.stream.pipe(
    Stream.runForEachWhile(() => Effect.succeed(false)),
    Effect.timeout(1_000),
    Effect.ignoreCause,
  );

/** Reads at most `maxBytes` of a body; `undefined` when it is larger (declared or counted); a null body is empty. */
const readCapped = Effect.fnUntraced(function* (response: HttpClientResponse.HttpClientResponse, maxBytes: number) {
  const declared = Number(response.headers["content-length"] ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    yield* discard(response);
    return undefined;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  let tooLarge = false;
  yield* response.stream.pipe(
    Stream.runForEachWhile((chunk) =>
      Effect.sync(() => {
        total += chunk.byteLength;
        if (total > maxBytes) {
          tooLarge = true;
          return false;
        }
        chunks.push(chunk);
        return true;
      }),
    ),
    Effect.catchTag("HttpClientError", (error) =>
      error.reason._tag === "EmptyBodyError" ? Effect.void : Effect.fail(error),
    ),
  );
  if (tooLarge) return undefined;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
});

/** The hop loop, without the overall budget. */
const fetchHops = Effect.fnUntraced(function* (
  client: HttpClient.HttpClient,
  provider: WasteProviderId,
  rawUrl: string,
): Effect.fn.Return<FetchedWasteFlyer, ApiFailure> {
  let target = checkWasteSourceUrl(provider, rawUrl);
  if (target === undefined) return yield* wasteSourceRefused();
  for (let redirects = 0; ; redirects += 1) {
    const response = yield* send(client, target.href);
    if (response.status >= 300 && response.status < 400) {
      yield* discard(response);
      const location = response.headers["location"];
      if (!location) return yield* wasteFetchFailed("status");
      if (redirects >= CALENDAR_LIMITS.wasteRedirectsMax) return yield* wasteFetchFailed("redirects");
      // Resolved against the current hop, then checked BEFORE it is requested.
      let next: string;
      try {
        next = new URL(location, target.href).href;
      } catch {
        return yield* wasteSourceRefused();
      }
      target = checkWasteSourceUrl(provider, next);
      if (target === undefined) return yield* wasteSourceRefused();
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      yield* discard(response);
      return yield* wasteFetchFailed("status");
    }
    const bytes = yield* readCapped(response, CALENDAR_LIMITS.wastePdfMaxBytes).pipe(
      Effect.mapError(() => wasteFetchFailed("network")),
    );
    if (bytes === undefined) return yield* wasteFetchFailed("tooLarge");
    return { bytes, url: target.href };
  }
});

/* ---------------------------------- the test seam ------------------------------ */

/** What the service does, as a value (the test fetch and the seam's override have this shape). */
export interface WasteFlyerFetchShape {
  /** Downloads the flyer at `url` for `provider`; 400 `calendar_waste_source_refused` or 502 `calendar_waste_fetch_failed`. */
  readonly fetch: (provider: WasteProviderId, url: string) => Effect.Effect<FetchedWasteFlyer, ApiFailure>;
}

let override: WasteFlyerFetchShape | null = null;

/**
 * Test seam: route every fetch of the runtime's `WasteFlyerFetch` through `next` (`makeTestWasteFlyerFetch(bytesByUrl)`);
 * `null` restores the real download. The route tests drive the app through the ONE runtime, whose layer a test cannot
 * swap (CLAUDE.md "The test seams stay in `src`"). A plain synchronous function called outside any effect; it throws
 * outside `NODE_ENV=test` (a production caller must fail loudly). A file that installs it hands it back in `afterEach`.
 */
export function setWasteFlyerFetchForTests(next: WasteFlyerFetchShape | null): void {
  if (!env.isTest) throw new Error("setWasteFlyerFetchForTests is only available under NODE_ENV=test");
  override = next;
}

/**
 * The test fetch: serves `bytesByUrl` (exact URL keys) after the same URL check, and answers any other allowed URL with
 * `502 calendar_waste_fetch_failed` (`status`), as a 404 would. No redirects, no network.
 */
export function makeTestWasteFlyerFetch(bytesByUrl: ReadonlyMap<string, Uint8Array>): WasteFlyerFetchShape {
  return {
    fetch: Effect.fn("WasteFlyerFetch.fetch")(function* (provider: WasteProviderId, url: string) {
      const target = checkWasteSourceUrl(provider, url);
      if (target === undefined) return yield* wasteSourceRefused();
      const bytes = bytesByUrl.get(url);
      if (bytes === undefined) return yield* wasteFetchFailed("status");
      return { bytes: new Uint8Array(bytes), url: target.href };
    }),
  };
}

/**
 * The real download over `client`: the seam's override first; under `bun test` with `offlineUnderTest` (the production
 * layer) and no override, a `502 … network` WITHOUT a request, so no test reaches the city's server by accident.
 */
function makeWasteFlyerFetch(client: HttpClient.HttpClient, offlineUnderTest: boolean): WasteFlyerFetchShape {
  return {
    fetch: Effect.fn("WasteFlyerFetch.fetch")(function* (provider: WasteProviderId, url: string) {
      const installed = override;
      if (installed !== null) return yield* installed.fetch(provider, url);
      if (offlineUnderTest) {
        if (checkWasteSourceUrl(provider, url) === undefined) return yield* wasteSourceRefused();
        return yield* wasteFetchFailed("network");
      }
      return yield* fetchHops(client, provider, url).pipe(
        // The interruption aborts the request in flight through the client's signal.
        Effect.timeoutOrElse({
          duration: CALENDAR_LIMITS.wasteTimeoutMs,
          orElse: () => Effect.fail(wasteFetchFailed("timeout")),
        }),
      );
    }),
  };
}

/** The flyer download (P17). */
export class WasteFlyerFetch extends Context.Service<WasteFlyerFetch, WasteFlyerFetchShape>()(
  "toon/api/modules/calendar/services/waste/fetch/WasteFlyerFetch",
) {
  /** Over the `HttpClient` of the context (the fetch tests provide a recording `HttpClient.make` client). */
  static readonly layerFromClient: Layer.Layer<WasteFlyerFetch, never, HttpClient.HttpClient> = Layer.effect(
    WasteFlyerFetch,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      return WasteFlyerFetch.of(makeWasteFlyerFetch(client, false));
    }),
  );

  /** The production layer: the fetch over `globalThis.fetch` (`FetchHttpClient`); offline under `bun test` (above). */
  static readonly layer: Layer.Layer<WasteFlyerFetch> = Layer.effect(
    WasteFlyerFetch,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      return WasteFlyerFetch.of(makeWasteFlyerFetch(client, env.isTest));
    }),
  ).pipe(Layer.provide(FetchHttpClient.layer));

  /** The test fetch as a layer (service tests that build `CalendarWaste` over it). */
  static layerTest(bytesByUrl: ReadonlyMap<string, Uint8Array>): Layer.Layer<WasteFlyerFetch> {
    return Layer.succeed(WasteFlyerFetch, WasteFlyerFetch.of(makeTestWasteFlyerFetch(bytesByUrl)));
  }
}
