# effect-http-client: HttpClient, requests, responses, Fetch layer (Effect 4.0.5)

Distilled from the vendored source only (`repos/effect/LLMS.md` "Effect HttpClient",
`repos/effect/ai-docs/src/50_http-client/10_basics.ts`, `repos/effect/packages/effect/src/http/{HttpClient,HttpClientRequest,
HttpClientResponse,HttpIncomingMessage,FetchHttpClient,HttpClientError,Cookies,Headers}.ts`, `repos/effect/packages/effect/test/HttpClient.test.ts`,
`repos/effect/migration/annotations/effect__platform__Http*.yaml`). Look a signature up there before using it. Your memory of Effect
is v3; section 5 lists what changed.

## 1. What this is for, and the imports

`HttpClient` is the outgoing HTTP service: a request value goes in, an `Effect<HttpClientResponse, HttpClientError, R>` comes out.
Requests are immutable values built with pipeable `HttpClientRequest` helpers; clients are values too (`HttpClient.With<E, R>`), and
every combinator (`mapRequest`, `filterStatusOk`, `retryTransient`, ...) returns a NEW client. The implementation is a layer:
`FetchHttpClient.layer` wraps `globalThis.fetch` (Bun's, here). Use it for every outgoing call that is not a one-line script: OAuth
userinfo, the Resend mail API, recipe URL import, image localisation, and the web's own API calls (E11).

```ts
import { Context, Effect, flow, Layer, Schedule, Schema } from "effect"
import {
  FetchHttpClient,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse
} from "effect/http"
```

`effect/http` is the stable barrel (NOT `effect/unstable/http`; the idioms test refuses that path). `Cookies`, `Headers`, `UrlParams`,
`HttpBody`, `HttpIncomingMessage` are in the same barrel. `@effect/platform-bun` re-exports `FetchHttpClient` as `BunHttpClient`
(`repos/effect/packages/platform/bun/src/BunHttpClient.ts`), but `FetchHttpClient` from `effect/http` is the same layer and also what the web uses:
import it from `effect/http` in both apps. `HttpClient.HttpClient` is the service (a `Context.Service` constant, id
`"effect/HttpClient"`), not a class.

## 2. Constructors and the call shapes this repo uses

**(a) A service around a configured client.** Take the client from the environment, derive a client with the common middleware, then
build calls. The layer provides `FetchHttpClient.layer` to itself.

```ts
export class JsonPlaceholder extends Context.Service<JsonPlaceholder, {
  getTodo(id: number): Effect.Effect<Todo, JsonPlaceholderError>
}>()("app/JsonPlaceholder") {
  static readonly layer = Layer.effect(
    JsonPlaceholder,
    Effect.gen(function*() {
      const client = (yield* HttpClient.HttpClient).pipe(
        HttpClient.mapRequest(flow(
          HttpClientRequest.prependUrl("https://jsonplaceholder.typicode.com"),
          HttpClientRequest.acceptJson
        )),
        HttpClient.filterStatusOk, // non-2xx becomes a failure
        HttpClient.retryTransient({ schedule: Schedule.exponential(100), times: 3 })
      )
      const getTodo = Effect.fn("JsonPlaceholder.getTodo")(function*(id: number) {
        return yield* client.get(`/todos/${id}`, { urlParams: { format: "json" } }).pipe(
          Effect.flatMap(HttpClientResponse.schemaBodyJson(Todo)),
          Effect.mapError((cause) => new JsonPlaceholderError({ cause }))
        )
      })
      return JsonPlaceholder.of({ getTodo })
    })
  ).pipe(Layer.provide(FetchHttpClient.layer))
}
```
(`ai-docs/src/50_http-client/10_basics.ts`; `JsonPlaceholderError` is a `Schema.TaggedError` with `cause: Schema.Defect()`.)

**(b) A request with a schema-encoded JSON body.** Build with the `HttpClientRequest` module, encode the body with the shared schema,
send with `client.execute`, decode the response with a schema.

```ts
const createTodo = (todo: typeof TodoWithoutId.Type) =>
  HttpClientRequest.post("/todos").pipe(
    HttpClientRequest.schemaBodyJson(TodoWithoutId)(todo),
    Effect.flatMap(client.execute),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(Todo))
  )
```
(`repos/effect/packages/effect/test/HttpClient.test.ts`, `makeJsonPlaceholder`.) With a body known to be serialisable, the synchronous form is
`HttpClientRequest.bodyJsonUnsafe(todo)` inside the pipe, as in `10_basics.ts` `createTodo`; headers, bearer tokens and other bodies:
`setHeader`, `setHeaders`, `bearerToken`, `basicAuth`, `bodyText`, `bodyUrlParams`, `bodyFormData`, `bodyUint8Array`, `bodyStream`.

**(c) The default client straight from the environment.** `HttpClient.get`, `post`, `put`, `patch`, `del`, `head`, `options`,
`execute` read `HttpClient.HttpClient` themselves, so the effect then needs `HttpClient.HttpClient` in `R`:

```ts
const body = HttpClient.get("https://api.github.com/user", { headers: { accept: "application/json" } }).pipe(
  Effect.flatMap(HttpClientResponse.schemaBodyJson(GithubUser))
) // Effect<GithubUser, HttpClientError | SchemaError, HttpClient>
```
(`HttpClient.ts`: `get` ... `options` are `accessor(...)` over the service; options are `HttpClientRequest.Options.NoUrl`:
`urlParams`, `hash`, `headers`, `body`, `accept`, `acceptJson`.)

**(d) A custom client: an SSRF guard, or a test fake.** `HttpClient.make(f)` builds a client from
`(request, url: URL, signal, fiber) => Effect<HttpClientResponse, HttpClientError>`; `HttpClientResponse.fromWeb(request, new
Response(...))` makes the response. Provide it with `Layer.succeed(HttpClient.HttpClient, client)`; adapted from the signatures in
`HttpClient.ts:680` and `HttpClientResponse.ts:95`:

```ts
const fake = HttpClient.make((request) =>
  Effect.succeed(HttpClientResponse.fromWeb(
    request,
    new Response(JSON.stringify({ id: 1 }), { status: 200, headers: { "content-type": "application/json" } })
  ))
)
export const FakeHttpClient = Layer.succeed(HttpClient.HttpClient, fake)
```
A guard that refuses a URL before the network is a `HttpClient.mapRequestEffect` (it can fail with your tagged error) over the real client.

**(e) Fetch options for the whole client (credentials, cache, redirect).** `FetchHttpClient.RequestInit` is a service of default
`RequestInit` fields; the layer reads it from the context it was BUILT in (`layerMergedContext`), so provide it to the layer:

```ts
export const WebHttpClient = FetchHttpClient.layer.pipe(
  Layer.provide(Layer.succeed(FetchHttpClient.RequestInit, { credentials: "include" }))
)
```
(`FetchHttpClient.ts:52`, `HttpClient.ts:1801`. `FetchHttpClient.Fetch` is a `Context.Reference` defaulting to `globalThis.fetch`; override it
with `Layer.succeed(FetchHttpClient.Fetch, myFetch)` to count or stub calls without a fake client.)

## 3. Composing, encoding and decoding, providing

- **Client combinators** (all in `HttpClient`, data-first and data-last): `mapRequest(f)`, `mapRequestEffect(f)`, `mapRequestInput`,
  `transform((effect, request) => ...)`, `transformResponse(f)`, `tap`, `tapError`, `tapRequest`, `filterStatus(pred)`,
  `filterStatusOk`, `filterOrFail`, `filterOrElse`, `retry(...)`, `retryTransient({ schedule, times, retryOn, while })`,
  `followRedirects(max?)`, `withCookiesRef(ref)`, `withScope`, `withRateLimiter`. Put request-shaping ones (`mapRequest`) before the
  status filter and `retryTransient` last, as in 2(a).
- **Request building** (`HttpClientRequest`): constructors `get/post/put/patch/del`... (`del` is exported as `delete` too), `make(method)(url, options)`;
  URLs `setUrl`, `prependUrl`, `appendUrl`, `setUrlParam(s)`, `appendUrlParam(s)`, `setHash`; `modify(options)`.
- **Decoding**: `HttpClientResponse.schemaBodyJson(schema)` (body only), `HttpClientResponse.schemaJson(schema)` (a schema over
  `{ status, headers, body }`, for one decode that also checks the status), `schemaNoBody`, `schemaHeaders`, `schemaBodyUrlParams`. The
  body readers are `response.json`, `.text`, `.arrayBuffer`, `.stream`, `.formData`, `.urlParamsBody` (`json` of an empty body is `null`,
  not an error). Schemas go through `Schema.toCodecJson`, so a shared wire schema works unchanged.
- **Encoding**: `HttpClientRequest.schemaBodyJson(schema)(value)` fails with `HttpBody.HttpBodyError`; `bodyJson(value)` is the
  schema-less effectful form; `bodyJsonUnsafe` throws (a defect).
- **Cookies and headers**: `response.cookies` is a `Cookies.Cookies` (`Cookies.getValue(cookies, "name")` returns an `Option`);
  `response.headers` is a lowercase-keyed record (`response.headers["retry-after"]`, or `Headers.get(headers, "Retry-After")`).
  A server-side session cookie jar is `HttpClient.withCookiesRef(ref)` over a `Ref<Cookies.Cookies>` (tests; the browser has its own jar).
- **Providing**: `Layer.provide(FetchHttpClient.layer)` into the service's layer (2(a)); the AppLayer then never exposes `HttpClient` to
  a route. For one call in a test, `Effect.provide(FakeHttpClient)`.

## 4. Error handling

- A completed response is a SUCCESS whatever its status. Only `HttpClient.filterStatusOk` / `filterStatus` (or
  `HttpClientResponse.filterStatusOk(response)`) turn a 4xx/5xx into a failure. Without it a 404 body is decoded as the success schema.
- The error channel of every client call is ONE class, `HttpClientError.HttpClientError` (`_tag: "HttpClientError"`), carrying the real
  cause in `error.reason`, a tagged union: `TransportError` (network, abort, DNS), `EncodeError`, `InvalidUrlError` (request side),
  `StatusCodeError` (has `response`), `DecodeError` (body unreadable or not JSON), `EmptyBodyError` (response side). `error.request`,
  `error.response` (may be `undefined`) and `error.message` read through to the reason.

```ts
program.pipe(
  Effect.catchTag("HttpClientError", (error) => {
    switch (error.reason._tag) {
      case "StatusCodeError":
        return Effect.fail(new UpstreamRefused({ status: error.reason.response.status }))
      case "TransportError":
      case "InvalidUrlError":
      case "EncodeError":
      case "DecodeError":
      case "EmptyBodyError":
        return Effect.fail(new UpstreamUnreachable({ cause: error }))
    }
  })
)
```
- Decoding failures are `Schema.SchemaError` (a separate tag, `catchTag("SchemaError", ...)`), a body-encode failure is
  `HttpBody.HttpBodyError`, `Effect.timeout(d)` adds `Cause.TimeoutError`. All of them are typed failures. Defects come only from your own
  code (`bodyJsonUnsafe` on a cyclic value, a throwing `mapRequest`). A user-visible failure is mapped ONCE into the service's own
  `Schema.TaggedError` with `Effect.mapError((cause) => new XError({ cause }))`, so `HttpClientError` never reaches `toApiError`.
- Client-level recovery: `HttpClient.catchTag`, `HttpClient.catchTags`, `HttpClient.catch` (they return a client, the callback returns a
  response effect). `retryTransient` retries `TransportError`, `TimeoutError` and 408/429/500/502/503/504 (response or `StatusCodeError`),
  honours `Retry-After`, and by default retries both errors and responses; `retryOn: "errors-only"` leaves a 5xx response alone.

## 5. v3 to v4 renames that bite here

| v3 | v4 |
| --- | --- |
| `import ... from "@effect/platform"` (`HttpClient`, `FetchHttpClient`, `HttpClientRequest`, ...) | `import ... from "effect/http"` |
| `HttpClientError` is a union of `RequestError \| ResponseError` | one `HttpClientError` wrapper with `reason`; `RequestError`/`ResponseError` are type-only unions |
| `HttpClient.catchAll` | `HttpClient.catch` |
| `HttpClient.HttpClient` as a `Context.Tag` class | `HttpClient.HttpClient` is a `Context.Service` constant |
| `HttpClientRequest.bodyUnsafeJson` | `HttpClientRequest.bodyJsonUnsafe` |
| `HttpClientRequest.Options.NoBody` (GET/HEAD took no body) | `Options.NoUrl` for every method |
| `FetchHttpClient.Fetch`, `RequestInit` as Tags / FiberRef | `Fetch` is a `Context.Reference`, `RequestInit` a `Context.Service` class |
| `HttpClient.currentTracerDisabledWhen` / `withTracerDisabledWhen` | `HttpClient.TracerDisabledWhen` (Reference) via `transformResponse(Effect.provideService(...))` |
| `HttpClient.currentTracerPropagation` / `withTracerPropagation` | `HttpClient.TracerPropagationEnabled`, same pattern |
| `HttpClient.withSpanNameGenerator` | `HttpClient.SpanNameGenerator` provided around the response effects |
| `HttpClient.TypeId`, request `TypeId` | `HttpClient.isHttpClient`, `HttpClientRequest.isHttpClientRequest` |
| `Effect.catchAll`, `Either`, `Schema.decodeUnknown` | `Effect.catch`, `Result`, `Schema.decodeUnknownEffect` |
| `HttpClientRequest.toUrl` (in the annotations) | not present in 4.0.5 `HttpClientRequest.ts`; build the URL with `UrlParams`/`new URL` yourself |

(`migration/annotations/effect__platform__HttpClient*.yaml`, `...FetchHttpClient.yaml`, `migration/v3-to-v4.md` import map.)

## 6. Pitfalls

- **Status is not an error** (section 4). Add `HttpClient.filterStatusOk` to the derived client, never forget it on `get` calls whose
  body you then decode. (The web's `ApiClient` is the deliberate exception: it maps a status by hand into its `ApiError` envelope, so it
  uses no `filterStatusOk`; a status mapper must read the body of a non-2xx response before failing.)
- **Consume or discard every response.** The client registers each response with a `FinalizationRegistry`; a response that is dropped
  without reading its body is aborted on garbage collection, and an interrupted fiber aborts the request (`HttpClient.ts` `responseRegistry`,
  `InterruptibleResponse`). Read `json`/`text`/`arrayBuffer` (cached, so a second read is free) or `stream`; for a long-lived stream use
  `HttpClient.withScope` so the scope closing aborts it.
- **The client does not cap the body.** `HttpIncomingMessage.MaxBodySize` is read by the server and multipart code only, not by
  `arrayBuffer`/`text`/`json` here. An import that must refuse a 50 MB page reads `response.stream` with a counting `Stream` and stops early.
- **Redirects.** `fetch` follows them itself; `RequestInit` fields (for example `redirect: "manual"`) are passed through by
  `FetchHttpClient`. A guard that checks only the first URL needs `redirect: "manual"` plus `HttpClient.followRedirects(max)` (which
  drops `authorization`, `cookie` and `proxy-authorization` when the origin changes) and a `mapRequestEffect` check that runs per hop.
- **Trace headers.** Every request carries `b3` and `traceparent` while `TracerPropagationEnabled` is true (the default). A cross-origin
  browser call fails its preflight unless the server lists them, and a third-party API may reject them: provide
  `HttpClient.TracerPropagationEnabled` as `false` around those clients.
- `FetchHttpClient` removes a `content-length` header and sends stream bodies with `duplex: "half"`; request `method`, `headers`, `body`
  and `signal` override `RequestInit` fields of the same name.
- `HttpClientResponse.schemaBodyJson` is a re-export of `HttpIncomingMessage.schemaBodyJson` (both paths exist); the decoder takes a
  Schema, not a Zod-style `parse`. Log requests through `request.toJSON()`/inspection only: `url` and sensitive headers are redacted
  there (`UrlParams.redactUrl`, `Headers.redact`), a hand-built log line is not.

## 7. In this repo

- **Server side, only the URL importer uses `HttpClient`.** `apps/api/src/modules/recipe/services/import/url/fetch.ts` and `ssrf.ts` (E3): the `ImportHttp` service. NOT a
  `mapRequestEffect` guard and NOT `HttpClient.followRedirects` for pages: the hop loop is the module's own, because every hop must
  re-run the SSRF guard BEFORE its request. Per hop: `checkPublicUrl(url, guard)` (a service-free `Effect.fnUntraced`; the DNS
  lookup is an `Effect.tryPromise` of an injectable resolver; failures are `SsrfError`, a `Schema.TaggedError` outside the API
  family, mapped once to a 400 `fetch_failed` `ApiFailure` with `details.reason`), then ONE `client.execute(HttpClientRequest.get(...))`
  wrapped in `Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" })` (the per-call form of 2(e): the
  layer merges the fiber's context over its own, so a service provided around the call wins) and
  `Effect.provideService(HttpClient.TracerPropagationEnabled, false)` (no `traceparent` / `b3` to a third-party site; the test
  asserts the five headers and nothing else reach the fetch). The layer is `Layer.effect(ImportHttp, gen).pipe(Layer.provide(
  FetchHttpClient.layer))`; the core (`fetchHtmlWith(client, guard, url, limits)`, `fetchImageWith`) is service-free. A hero image is
  fetched by `ImportHttp.fetchImage` (`image.ts`, `HeroImages`) with `redirect: "follow"` after the guard checked the FIRST URL, and is judged by its magic
  bytes, never by `Content-Type`. Tests reach the core through the door `apps/api/test/support/bridges/recipe-fetch.ts`
  (`fetchHtml(url, { fetchImpl })` provides `FetchHttpClient.layer` and `FetchHttpClient.Fetch`; the client hands `fetch` a `URL`, and its
  `init.headers` is a plain lower-cased record: `new Headers(init.headers)` reads it). Facts found while building it:
  a 3xx with `redirect: "manual"` is a SUCCESS (status 302, `response.headers["location"]`); a response body is read from
  `response.stream` with `Stream.runForEachWhile` (return `false` to stop: the reader is cancelled and the request aborted when
  the stream's scope closes), a null body fails the stream with an `EmptyBodyError` reason that the reader turns into empty
  bytes; `Stream.take(0)` does NOT open the stream, so it cancels nothing: to discard a response pull one chunk and stop
  (`runForEachWhile(() => Effect.succeed(false))`, bounded with `Effect.timeout`); the overall budget is `Effect.timeoutOrElse`
  over the hop loop (interruption aborts the fetch through the client's signal). The seam `setImportGuardForTests({ allowHosts,
  resolve } | null)` is an exact-host allow list and has deliberately no "allow private hosts" switch (it would skip the metadata
  address's refusal too).
- **Two outgoing calls are still plain `fetch`** (no milestone moves them; behaviour frozen): `apps/api/src/lib/oauth.ts` (Google userinfo, GitHub user and emails) and
  `apps/api/src/core/services/mail/resend.ts` (the Resend POST). If one moves, it becomes a service-held `HttpClient` with `filterStatusOk` and a mapped `Schema.TaggedError`.
- The web (E6; plan `docs/plans/e6-web-client.md`): `apps/web/src/lib/runtime.ts` is the one `ManagedRuntime` over
  `FetchHttpClient.layer` provided with `FetchHttpClient.RequestInit` `{ credentials: "include" }`, a late-bound `FetchHttpClient.Fetch`
  and `HttpClient.TracerPropagationEnabled` false; `apps/web/src/lib/api-client.ts` is the `ApiClient` service whose `execute` builds
  `HttpClientRequest.make(method)(url)` with `setHeaders` and sends it with `client.execute`, then maps the response by hand (no
  `filterStatusOk`: a status is the app's `ApiError` envelope) and turns every `HttpClientError` into `network_error` with
  `Effect.catchTag("HttpClientError", ...)` and a `switch` on `error.reason._tag`. `apps/web/src/lib/api.ts`, the recipe and finance
  `lib/api.ts` and `apps/web/src/modules/recipe/features/import/lib/importApi.ts` describe each endpoint once on top of it. Facts found
  while building it:
  - `FetchHttpClient.Fetch` is a `Context.Reference` whose default `() => globalThis.fetch` is evaluated ONCE and cached: provide it as
    a wrapper that reads `globalThis.fetch` at CALL time (`lateBoundFetch`), or a test that stubs `fetch` per test sees only its first stub.
    The client hands `fetch` a `URL`; Bun's `typeof fetch` has an extra `preconnect`, so provide it with a cast.
  - A JSON body is `HttpBody.raw(JSON.stringify(body), { contentType: "application/json" })`, byte-identical to the old call and still a
    STRING at `fetch`; `bodyJson` / `bodyText` produce a `Uint8Array`, so a test asserting `typeof init.body === "string"` would see
    nothing. A form is `HttpClientRequest.bodyFormData(form)` (no content type: the browser sets the boundary).
  - `HttpClientResponse` has no `statusText` (the web response keeps its source private): a mapper that showed the reason phrase loses it
    (deviation D4 of the plan, the import client); the response body is read with `response.text` and parsed tolerantly, because
    `response.json` of an empty or invalid body is not today's `undefined`.
  - A body that fails while being read (`DecodeError`, `EmptyBodyError` reasons on `text`) is an `HttpClientError` too: it lands in the same
    `catchTag`, so the app's `network_error` also covers a response cut mid-stream.
  - `runtime.runPromiseExit(effect, { signal })` interrupts the fiber on abort and the client aborts its own request, but
    `Cause.squash` of an interruption is a plain `Error`: rethrow `signal.reason` (the `AbortError`) when `Cause.hasInterruptsOnly`.
  - Decoding a response: `Schema.decodeUnknownEffect(schema, { disableChecks: true })` checks structure and types only (no pattern,
    length or range check, transformations and defaults still run); a decode STRIPS keys the schema does not declare, so the identity
    "decode(body) equals body" is a test to run over the real routes (the API's `web-contract-*` tests).
  - An XHR upload (progress) is not an `HttpClient` call: wrap it in `Effect.callback` whose finalizer aborts the XHR.
- Tests provide `FakeHttpClient` (2(d)) or a `FetchHttpClient.Fetch` stub instead of mocking `globalThis.fetch` (`agent-patterns/effect-testing.md`).

From `apps/api/src/modules/recipe/services/import/url/fetch.ts`, one request through the client with the two per-call settings:

```ts
/** One request through `client`: the fetch option `redirect`, and no trace headers on the wire. */
function send(client: HttpClient.HttpClient, request: HttpClientRequest.HttpClientRequest, redirect: "manual" | "follow") {
  return client.execute(request).pipe(
    Effect.provideService(FetchHttpClient.RequestInit, { redirect }),
    Effect.provideService(HttpClient.TracerPropagationEnabled, false),
  );
}
```

and the service layer that provides the client once (same file):

```ts
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
```

Rule served: **E11** (the web gets a runtime and an Effect API client: `HttpClient` from `effect/http` with `FetchHttpClient`, failures
as the same tagged `ApiError`, `credentials: "include"` and the `PUBLIC_API_URL` / CSP `connect-src 'self'` rules kept), with **E6** (errors are tagged,
typed and mapped once: `HttpClientError` is mapped inside the service, never leaked) and **E12** (`Effect.fn` for the reusable call,
`Predicate` over `instanceof`).
