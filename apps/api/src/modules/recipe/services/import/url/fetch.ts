/**
 * Guarded HTML and image fetcher for the URL importer (docs/EFFECT.md E7, E12; plan `docs/plans/e3-recipe-services.md`
 * P10): the `ImportHttp` service over an `effect/http` `HttpClient` (`FetchHttpClient`), wrapped by the SSRF guard.
 *
 * Redirects are followed MANUALLY (`redirect: "manual"`, one request per hop through the client) so that every hop can
 * be re-validated by the SSRF guard (`checkPublicUrl`): `redirect: "follow"`, or `HttpClient.followRedirects`, would
 * let a public host bounce us into the private network.
 *
 * Also enforced: desktop User-Agent (recipe sites serve stripped markup or 403 to unknown agents), `Accept-Language:
 * de-DE`, a 10 s overall timeout, a 5 MB body cap (streamed, so a huge body is cancelled instead of buffered), and an
 * HTML-ish content type. The request is byte-for-byte what the plain `fetch` sent before: the client's `traceparent`
 * and `b3` headers are switched off (`HttpClient.TracerPropagationEnabled` provided as `false`), because a recipe site
 * has no business seeing this server's trace ids.
 *
 * `fetchHtmlWith` and `fetchImageWith` are service-free (they take the client and the guard); `ImportHttp` binds them to
 * the layer's client and the configuration.
 */
import { Context, Effect, Layer, Predicate, Stream } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest, type HttpClientError, type HttpClientResponse } from "effect/http";
import { AppConfig } from "../../../../../config.ts";
import { env } from "../../../../../env.ts";
import { ApiFailure, type ErrorText } from "../../../../../lib/errors.ts";
import {
  type AssertPublicUrlOptions,
  type Resolver,
  type SsrfError,
  type SsrfGuard,
  checkPublicUrl,
} from "./ssrf.ts";

/** A real, current desktop Chrome UA — anything exotic gets 403 on chefkoch. */
export const IMPORT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
export const MAX_HTML_BYTES = 5 * 1024 * 1024;
export const MAX_REDIRECTS = 5;
/** The hero image budget. */
export const IMAGE_FETCH_TIMEOUT_MS = 8_000;
export const MAX_IMAGE_FETCH_BYTES = 4 * 1024 * 1024;

const HTML_CONTENT_TYPE_RE = /^(?:text\/html|application\/xhtml\+xml|text\/plain|application\/xml|text\/xml)\b/i;

export interface FetchHtmlOptions extends AssertPublicUrlOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** Injectable fetch, used by the tests to stay offline. */
  fetchImpl?: typeof fetch;
}

export interface FetchedHtml {
  /** The final URL after all redirects. */
  url: string;
  status: number;
  contentType: string;
  html: string;
  /** Every URL visited, first entry = the requested one. */
  hops: string[];
}

/** The page fetch's limits (every one optional: the constants above are the defaults). */
export interface FetchLimits {
  readonly timeoutMs?: number | undefined;
  readonly maxBytes?: number | undefined;
  readonly maxRedirects?: number | undefined;
}

/** The hero image fetch's options. */
export interface FetchImageOptions {
  /** Page URL, sent as the Referer (many CDNs require it). */
  readonly refererUrl?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly maxBytes?: number | undefined;
}

/* ------------------------------- the test seam ------------------------------ */

/** What a test may change about the guard (plan e3 P10): an exact-host allow list and the DNS resolver. */
export interface ImportGuardSeam {
  /** Hostnames that skip the host checks (exact, lower-case); every other host still runs every check. */
  readonly allowHosts?: readonly string[] | undefined;
  readonly resolve?: Resolver | undefined;
}

let guardSeam: ImportGuardSeam | null = null;

/**
 * Test seam: let the guard pass chosen hosts (an exact list, e.g. `["127.0.0.1"]` for a fixture server) and/or swap the
 * resolver; `null` restores the real guard. Read on every call. It has NO "allow private hosts" switch on purpose: such
 * a switch skips every host check, the cloud-metadata address included, so a test behind it could not prove a refusal
 * (the allow list leaves `169.254.169.254` refused). A file that installs it hands it back in `afterEach` / `afterAll`.
 */
export function setImportGuardForTests(options: ImportGuardSeam | null): void {
  if (!env.isTest) throw new Error("setImportGuardForTests is only available under NODE_ENV=test");
  guardSeam = options;
}

/** The guard for one call: the base (escape hatch, resolver, `skipDns`) plus the seam's allow list and resolver. */
export function guardNow(base: SsrfGuard): SsrfGuard {
  if (guardSeam === null) return base;
  const hosts = (guardSeam.allowHosts ?? []).map((host) => host.toLowerCase());
  return {
    ...base,
    allowHosts: new Set([...base.allowHosts, ...hosts]),
    ...(base.resolve === undefined && guardSeam.resolve !== undefined ? { resolve: guardSeam.resolve } : {}),
  };
}

/** Decodes a body honouring a charset from the header or a `<meta charset>`. */
function decodeBody(bytes: Uint8Array, contentType: string): string {
  const headerCharset = /charset\s*=\s*"?([\w-]+)"?/i.exec(contentType)?.[1];
  const sniff = (charset: string): string | undefined => {
    try {
      // The label is data-driven (from a header/meta tag), so the narrow
      // Encoding union in @types/node cannot apply here.
      const decoder = new TextDecoder(charset as ConstructorParameters<typeof TextDecoder>[0], { fatal: false });
      return decoder.decode(bytes);
    } catch {
      return undefined;
    }
  };

  if (headerCharset && !/^utf-?8$/i.test(headerCharset)) {
    const decoded = sniff(headerCharset);
    if (decoded !== undefined) return decoded;
  }

  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (headerCharset) return utf8;

  // No charset header: trust an early <meta charset="...">.
  const metaCharset =
    /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(utf8.slice(0, 4096))?.[1] ??
    /<\?xml[^>]+encoding\s*=\s*["']([\w-]+)/i.exec(utf8.slice(0, 512))?.[1];
  if (metaCharset && !/^utf-?8$/i.test(metaCharset)) {
    const decoded = sniff(metaCharset);
    if (decoded !== undefined) return decoded;
  }
  return utf8;
}

/* ---------------------------------- failures -------------------------------- */

/** Every refusal of the page fetch: 400 `fetch_failed`, `details` only when there is one. */
function fetchFailed(text: ErrorText, details?: unknown): ApiFailure {
  return new ApiFailure({ status: 400, code: "fetch_failed", text, ...(details === undefined ? {} : { details }) });
}

/** The guard's refusal as the API failure: the URL is unusable, not our bug. */
function refusal(error: SsrfError): ApiFailure {
  return fetchFailed(error.text, { reason: error.reason });
}

/** A transport failure (or an unreadable body) as `pageLoadFailed`, with today's reason text. */
function loadFailed(error: HttpClientError.HttpClientError): ApiFailure {
  const cause = error.reason._tag === "TransportError" ? error.reason.cause : undefined;
  return fetchFailed({
    key: "server.import.pageLoadFailed",
    values: { reason: Predicate.isError(cause) ? cause.message : "network error" },
  });
}

/* ---------------------------------- requests -------------------------------- */

/** One request through `client`: the fetch option `redirect`, and no trace headers on the wire. */
function send(client: HttpClient.HttpClient, request: HttpClientRequest.HttpClientRequest, redirect: "manual" | "follow") {
  return client.execute(request).pipe(
    Effect.provideService(FetchHttpClient.RequestInit, { redirect }),
    Effect.provideService(HttpClient.TracerPropagationEnabled, false),
  );
}

const pageRequest = (url: string): HttpClientRequest.HttpClientRequest =>
  HttpClientRequest.get(url, {
    headers: {
      "User-Agent": IMPORT_USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "de-DE,de;q=0.9,en;q=0.6",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
  });

const imageRequest = (url: string, refererUrl: string | undefined): HttpClientRequest.HttpClientRequest =>
  HttpClientRequest.get(url, {
    headers: {
      "User-Agent": IMPORT_USER_AGENT,
      Accept: "image/avif,image/webp,image/jpeg,image/png,*/*;q=0.8",
      "Accept-Language": "de-DE,de;q=0.9",
      ...(refererUrl === undefined ? {} : { Referer: refererUrl }),
    },
  });

const isSuccess = (response: HttpClientResponse.HttpClientResponse): boolean =>
  response.status >= 200 && response.status < 300;

/** How long giving up on a body may take before the interruption does it (the abort) instead. */
const DISCARD_BUDGET_MS = 1_000;

/**
 * Gives up on a body nobody will read: pulling one chunk and stopping closes the stream, which cancels the body (and
 * aborts the request). Never fails, never waits longer than {@link DISCARD_BUDGET_MS} for a slow server.
 */
const discard = (response: HttpClientResponse.HttpClientResponse): Effect.Effect<void> =>
  response.stream.pipe(
    Stream.runForEachWhile(() => Effect.succeed(false)),
    Effect.timeout(DISCARD_BUDGET_MS),
    Effect.ignoreCause,
  );

/**
 * Reads at most `maxBytes` from a response body, cancelling anything larger. `undefined` means "over the cap" (declared
 * by `Content-Length` or counted while streaming); a null body is an empty one.
 */
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

/* ------------------------------------ pages --------------------------------- */

/** The hop loop of the page fetch, without the overall budget. */
const fetchPage = Effect.fnUntraced(function* (
  client: HttpClient.HttpClient,
  guard: SsrfGuard,
  rawUrl: string,
  maxBytes: number,
  maxRedirects: number,
) {
  const hops: string[] = [];
  let target = yield* checkPublicUrl(rawUrl, guard).pipe(Effect.mapError(refusal));
  for (let redirect = 0; ; redirect += 1) {
    hops.push(target.href);

    const response = yield* send(client, pageRequest(target.href), "manual").pipe(Effect.mapError(loadFailed));

    if (response.status >= 300 && response.status < 400) {
      yield* discard(response);
      const location = response.headers["location"];
      if (!location) {
        return yield* fetchFailed({ key: "server.import.redirectNoLocation", values: { status: response.status } });
      }
      if (redirect >= maxRedirects) return yield* fetchFailed("server.import.tooManyRedirects");
      // Resolve relative Locations against the current hop, then re-validate.
      const next = new URL(location, target.href).href;
      target = yield* checkPublicUrl(next, guard).pipe(Effect.mapError(refusal));
      continue;
    }

    if (!isSuccess(response)) {
      yield* discard(response);
      return yield* fetchFailed({ key: "server.import.pageHttpError", values: { status: response.status } });
    }

    const contentType = response.headers["content-type"] ?? "";
    if (contentType.length > 0 && !HTML_CONTENT_TYPE_RE.test(contentType)) {
      yield* discard(response);
      return yield* fetchFailed({
        key: "server.import.pageNotHtml",
        values: { contentType: contentType.split(";")[0] ?? contentType },
      });
    }

    const bytes = yield* readCapped(response, maxBytes).pipe(Effect.mapError(loadFailed));
    if (bytes === undefined) return yield* fetchFailed("server.import.pageTooLarge");
    return {
      url: target.href,
      status: response.status,
      contentType,
      html: decodeBody(bytes, contentType),
      hops,
    } satisfies FetchedHtml;
  }
});

/**
 * Fetches a public web page as HTML, every hop through the guard. Service-free: the caller hands in the client (whose
 * `Fetch` reference decides the transport) and the guard.
 *
 * Fails with a 400 `fetch_failed` `ApiFailure` for SSRF refusals (`details.reason`), transport errors, the 10 s budget,
 * non-2xx responses, redirect loops, oversized bodies and non-HTML content types.
 */
export function fetchHtmlWith(
  client: HttpClient.HttpClient,
  guard: SsrfGuard,
  rawUrl: string,
  limits: FetchLimits = {},
): Effect.Effect<FetchedHtml, ApiFailure> {
  return fetchPage(
    client,
    guard,
    rawUrl,
    limits.maxBytes ?? MAX_HTML_BYTES,
    limits.maxRedirects ?? MAX_REDIRECTS,
  ).pipe(
    // The interruption aborts the request through the client's signal.
    Effect.timeoutOrElse({
      duration: limits.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS,
      orElse: () => Effect.fail(fetchFailed("server.import.pageTimeout")),
    }),
  );
}

/* ------------------------------------ images -------------------------------- */

const fetchImageBytes = Effect.fnUntraced(function* (
  client: HttpClient.HttpClient,
  guard: SsrfGuard,
  url: string,
  options: FetchImageOptions,
) {
  // The guard checks the FIRST URL only: the CDN redirects of an image are followed by fetch itself.
  const target = yield* checkPublicUrl(url, guard);
  const response = yield* send(client, imageRequest(target.href, options.refererUrl), "follow");
  // A non-2xx status is no photo; the bytes of anything else are judged by their magic bytes, by the caller, never by
  // the Content-Type label (a real JPEG served as `text/plain` by a misconfigured bucket is still stored, as before).
  if (!isSuccess(response)) {
    yield* discard(response);
    return undefined;
  }
  const bytes = yield* readCapped(response, options.maxBytes ?? MAX_IMAGE_FETCH_BYTES);
  return bytes === undefined || bytes.byteLength === 0 ? undefined : bytes;
});

/**
 * Downloads a hero image. Best-effort by contract: a guard refusal, a non-2xx status, an empty or oversized body, a
 * transport failure, the 8 s budget and any defect all answer `undefined` (a recipe without its photo is still a good
 * import), so the effect cannot fail.
 */
export function fetchImageWith(
  client: HttpClient.HttpClient,
  guard: SsrfGuard,
  url: string,
  options: FetchImageOptions = {},
): Effect.Effect<Uint8Array | undefined> {
  return fetchImageBytes(client, guard, url, options).pipe(
    Effect.timeoutOrElse({
      duration: options.timeoutMs ?? IMAGE_FETCH_TIMEOUT_MS,
      orElse: () => Effect.succeed(undefined),
    }),
    Effect.catchCause(() => Effect.succeed(undefined)),
  );
}

/* ------------------------------------ service ------------------------------- */

/**
 * The URL import's outgoing HTTP (plan e3 P10). `fetchHtml` fails with a 400 `fetch_failed`; `fetchImage` never fails
 * (`undefined` is "no photo"). The guard options are read on every call: `AppConfig.allowPrivateImportHosts`
 * (development only) and the test seam's allow list and resolver.
 */
export class ImportHttp extends Context.Service<
  ImportHttp,
  {
    readonly fetchHtml: (url: string, limits?: FetchLimits) => Effect.Effect<FetchedHtml, ApiFailure>;
    readonly fetchImage: (url: string, options?: FetchImageOptions) => Effect.Effect<Uint8Array | undefined>;
  }
>()("toon/api/modules/recipe/services/import/url/fetch/ImportHttp") {
  static readonly layer = Layer.effect(
    ImportHttp,
    Effect.gen(function* () {
      const config = yield* AppConfig;
      const client = yield* HttpClient.HttpClient;
      const guard = (): SsrfGuard =>
        guardNow({ allowPrivateHosts: config.allowPrivateImportHosts, allowHosts: new Set() });

      const fetchHtml = Effect.fn("ImportHttp.fetchHtml")(function* (url: string, limits: FetchLimits = {}) {
        return yield* fetchHtmlWith(client, guard(), url, limits);
      });
      const fetchImage = Effect.fn("ImportHttp.fetchImage")(function* (url: string, options: FetchImageOptions = {}) {
        return yield* fetchImageWith(client, guard(), url, options);
      });
      return ImportHttp.of({ fetchHtml, fetchImage });
    }),
  ).pipe(Layer.provide(FetchHttpClient.layer));
}
