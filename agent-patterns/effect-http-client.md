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
(`packages/platform/bun/src/BunHttpClient.ts`), but `FetchHttpClient` from `effect/http` is the same layer and also what the web uses:
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
(`packages/effect/test/HttpClient.test.ts`, `makeJsonPlaceholder`.) With a body known to be serialisable, the synchronous form is
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
  body you then decode.
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

Applied at (milestone in brackets; paths exist now unless marked new):

- `apps/api/src/lib/oauth.ts` (Google userinfo, GitHub user and emails) and `apps/api/src/core/services/mail/resend.ts` (Resend POST):
  today `fetch`, to a service-held `HttpClient` with `filterStatusOk` and a mapped `Schema.TaggedError` (EFFECT.md names no milestone for these two; E3 to E5 or later).
- `apps/api/src/modules/recipe/services/import/` (URL fetch, `url/`, image localisation): an SSRF-guarded client built with
  `HttpClient.mapRequestEffect` over `FetchHttpClient.layer`, refusals as tagged errors the ssrf tests pin [E3].
- `apps/web/src/lib/api.ts`, `apps/web/src/modules/finance/lib/api.ts`, `apps/web/src/modules/recipe/features/import/lib/importApi.ts`
  (and a new `apps/web/src/lib/runtime.ts`): one client layer with `credentials: "include"` (2(e)), responses decoded with the shared
  `Schema`, the 401 handler as a `tap`/`catchTag` [E6].
- Tests provide `FakeHttpClient` (2(d)) or a `FetchHttpClient.Fetch` stub instead of mocking `globalThis.fetch` (`agent-patterns/effect-testing.md`).

Rule served: **E11** (the web gets a runtime and an Effect API client: `HttpClient` from `effect/http` with `FetchHttpClient`, failures
as the same tagged `ApiError`, `credentials: "include"` and the `PUBLIC_API_URL` / CSP `connect-src 'self'` rules kept), with **E6** (errors are tagged,
typed and mapped once: `HttpClientError` is mapped inside the service, never leaked) and **E12** (`Effect.fn` for the reusable call,
`Predicate` over `instanceof`).
