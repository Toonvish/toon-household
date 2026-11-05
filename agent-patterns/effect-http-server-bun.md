# effect-http-server-bun: BunHttpServer, HttpRouter, responses, cookies, static files (Effect 4.0.5)

Distilled from the vendored source only (`repos/effect/LLMS.md`, `repos/effect/packages/platform/bun/src/{BunHttpServer,BunHttpServerRequest,
BunHttpPlatform,BunRuntime,BunServices,BunMultipart}.ts`, `repos/effect/packages/effect/src/http/{HttpRouter,HttpServer,HttpServerRequest,
HttpServerResponse,HttpMiddleware,HttpEffect,HttpServerError,HttpServerRespondable,HttpStaticServer,HttpPlatform,Cookies,Etag,Multipart}.ts`,
`repos/effect/ai-docs/src/01_effect/06_running/`, `repos/effect/ai-docs/src/51_http-server/10_basics.ts`, `repos/effect/migration/v3-to-v4.md`).
Look a signature up there before using it. Your memory of Effect is v3; section 5 lists what changed. HttpApi (schema-first endpoints) sits
on top of this module and has its own file, `effect-http-api.md`; this one is the server underneath it.

## 1. What this is for, and the imports

`BunHttpServer` is the `HttpServer` service implemented with `Bun.serve`: it turns a Bun `Request` into an `HttpServerRequest`, runs an
`Effect<HttpServerResponse, E, R>` per request on its own fiber and turns the response (streams, files, cookies included) back into a Web
`Response`. `HttpRouter` (in `effect/http`) is the layer-oriented route registry that produces that effect. Routes, middleware and the
server are all layers.

```ts
import { BunHttpPlatform, BunHttpServer, BunHttpServerRequest, BunRuntime } from "@effect/platform-bun"
import { Duration, Effect, Layer } from "effect"
import {
  Cookies, HttpEffect, HttpMiddleware, HttpPlatform, HttpRouter, HttpServer, HttpServerError,
  HttpServerRequest, HttpServerRespondable, HttpServerResponse, HttpStaticServer, Multipart
} from "effect/http"
```

`effect/http` is the stable barrel (never `effect/unstable/http`). `@effect/platform-bun` is `4.0.5`, pinned with `effect`.

## 2. Constructors and the call shapes this repo uses

**(a) Serve routes and keep the process alive.** `HttpRouter.serve(appLayer)` builds the router, serves it on the `HttpServer` in the
environment (logs "Listening on ...") and `Layer.launch` makes it the entry point. `BunHttpServer.layer(options)` takes any `Bun.serve`
options (`port`, `hostname`, `unix`, `routes` are in `BunHttpServer.ServeOptions`; `idleTimeout`, `maxRequestBodySize` are Bun's own, typed by `Bun.Serve`, not described in the vendored source) plus `gracefulShutdownTimeout`,
`disablePreemptiveShutdown`, `websocket`. Adapted from `ai-docs/src/01_effect/06_running/20_layer-launch.ts`, Bun layer from `BunHttpServer.ts`:

```ts
const Routes = HttpRouter.use(Effect.fn(function*(router) {
  yield* router.add("GET", "/health", Effect.succeed(HttpServerResponse.text("ok")))
}))
const ServerLive = HttpRouter.serve(Routes).pipe(
  Layer.provide(BunHttpServer.layer({ port: 3001, gracefulShutdownTimeout: Duration.seconds(20) }))
)
BunRuntime.runMain(Layer.launch(ServerLive))
```

**(b) A route handler: decode the body with a Schema, set a cookie.** `HttpRouter.add(method, path, handler)` is itself a layer; the handler is
a response, an effect, or `(request) => effect`. Path parameters come from `HttpRouter.params` (or `HttpRouter.RouteContext`), the query from
`HttpServerRequest.ParsedSearchParams`. `HttpServerRequest.schemaBodyJson(schema)` fails with `HttpServerError | Schema.SchemaError`
(`HttpServerRequest.ts`, `HttpRouter.ts`):

```ts
const Login = HttpRouter.add("POST", "/api/auth/login", Effect.gen(function*() {
  const body = yield* HttpServerRequest.schemaBodyJson(LoginBody)        // SchemaError on a bad body
  const token = yield* Sessions.use((s) => s.create(body.email))
  const response = yield* HttpServerResponse.json({ ok: true })           // can fail with HttpBodyError
  return yield* HttpServerResponse.setCookie(response, "toon_session", token, {   // can fail with CookiesError
    httpOnly: true, sameSite: "lax", path: "/", secure: true, maxAge: Duration.days(30)
  })
}))
const Account = HttpRouter.add("GET", "/api/households/:householdId", Effect.gen(function*() {
  const { householdId } = yield* HttpRouter.params                       // string | undefined per key
  return yield* HttpServerResponse.json({ householdId })
}))
```

Trusted literals: `HttpServerResponse.jsonUnsafe` and `setCookieUnsafe` / `expireCookieUnsafe` throw instead of widening the error channel.
Logout is `HttpServerResponse.expireCookie(response, "toon_session", { path: "/", httpOnly: true, sameSite: "lax" })` (it writes
`maxAge: 0` and `expires: new Date(0)`; pass the SAME path/domain as at set time). Read cookies with `request.cookies` (a decoded
`Record<string, string>`), headers with `request.headers["x-forwarded-for"]` (lower-case keys).

**(c) Middleware: global (every route) or route-scoped.** `HttpRouter.middleware(fn, { global: true })` is a layer that installs `fn` around
the whole router, route matching included; without `global` it returns a `Middleware` value whose `.layer` is provided to route layers
(`HttpRouter.ts`, docs example verbatim):

```ts
const RouteMiddleware = HttpRouter.middleware((httpEffect) =>
  Effect.map(httpEffect, HttpServerResponse.setHeader("x-route", "route"))
).layer
const GlobalMiddleware = HttpRouter.middleware(
  (httpEffect) => Effect.map(httpEffect, HttpServerResponse.setHeader("x-global", "global")),
  { global: true }
)
const Routes = HttpRouter.add("GET", "/hello", HttpServerResponse.text("Hello")).pipe(Layer.provide(RouteMiddleware))
const App = Layer.mergeAll(Routes, GlobalMiddleware)
```

For headers that must be on EVERY response, error bodies and 404s included, do not `Effect.map` the success channel (a failure skips it):
register a pre-response handler, which runs for success and failure alike: `HttpEffect.withPreResponseHandler(httpEffect, (request,
response) => Effect.succeed(HttpServerResponse.setHeader(response, "x-content-type-options", "nosniff")))` (`HttpEffect.ts`).

**(d) Static files and streamed or file bodies.** `HttpStaticServer.layer({ root, index, spa, cacheControl, mimeTypes, prefix })` registers
`GET /*` (needs `FileSystem | Path | HttpPlatform`, all in `BunHttpServer.layer`); it does MIME types, `Accept-Ranges`, `206`/`416`
ranges, `If-None-Match` / `If-Modified-Since` `304`s, and with `spa: true` serves the index for an extension-less path that accepts HTML
(`HttpStaticServer.ts`). One file by hand: `HttpServerResponse.file(path, { status, headers, contentType, offset, bytesToRead })` needs
`HttpPlatform`; `BunHttpPlatform` answers it with `Bun.file(path)` slices, content-length set, never read into memory. Any
`Stream<Uint8Array>` is `HttpServerResponse.stream(stream, { contentType, contentLength, headers })`.

## 3. Composing, decoding, providing

- Route layers declare what they need; `HttpRouter.serve` leaves those requirements on the result, you `Layer.provide` them (services,
  `BunHttpServer.layer`). A service a handler needs is provided to the layer that registers it, once, at build time, not per request.
- The server handles requests on fibers forked from the `serve` fiber, so the context captured when the layer is built (services,
  `Layer.CurrentMemoMap`) is what handlers see. `HttpRouter.serve` and `toWebHandler` build `appLayer` with a FORKED memo map: a layer
  also used elsewhere is built a second time unless you `Layer.provide` the shared services from outside (docs "Gotchas").
- Order, verified in `HttpRouter.make`: global middleware wraps the whole handler in registration order (first registered = outermost,
  `asHttpEffect` reverses the set before wrapping); route-scoped middleware wraps the route's handler, INSIDE every global one. Route
  matching is a radix tree (`FindMyWay`): specificity decides, not registration order, so a `GET /*` static layer never shadows
  `/api/...`, but it also answers `GET /api/nope` with the SPA shell unless an `/api/*` route (answering the JSON 404) is registered.
- Prefixes: `HttpRouter.addAll(routes, { prefix })` or `router.prefixed(prefix)`; the matched prefix is sliced off `request.url` for the
  handler (`originalUrl` keeps it). `add("*", "/*", ...)` also matches the bare prefix. `HttpRouter.RouterConfig` (a reference) configures
  matching; `ignoreDuplicateSlashes` defaults to `true`.
- `toHttpEffect(appLayer)` returns the handler effect; `HttpRouter.toWebHandler(layer, { disableLogger: true })` returns
  `{ handler: (Request) => Promise<Response>, dispose }`, the in-memory seam for `bun test` (provide `HttpServer.layerServices` when a route needs
  `HttpPlatform` / `FileSystem`). `BunHttpServer.layerTest` serves on an ephemeral `127.0.0.1` port and provides an `HttpClient` aimed at it.
- Bun-specific access: `BunHttpServerRequest.toBunServerRequest(request)` returns the underlying `Bun.BunRequest`;
  `request.remoteAddress` is `Option<string>` from `server.requestIP`. `HttpMiddleware.xForwardedHeaders` rewrites host and remote
  address from the FIRST `X-Forwarded-For` entry (this repo reads the LAST, CLAUDE.md: write its own middleware).
- Body limits: `Multipart.limitsServices({ maxParts, maxFieldSize, maxFileSize, maxTotalSize })` provided to the effect that reads the
  multipart body (`request.multipart` persists files to a scoped temp dir and needs `FileSystem | Path | Scope`;
  `request.multipartStream` streams parts). `HttpServerRequest.MaxBodySize` is read by multipart and `HttpMiddleware.decompression`,
  NOT by `request.json` / `request.text` on Bun: the whole-request cap there is Bun's own `maxRequestBodySize` serve option.

## 4. Error handling

- A handler's typed failure (`E`) or defect reaches `HttpEffect.toHandled`, which calls `HttpServerError.causeResponse`: a failure that is
  a response, or implements the `HttpServerRespondable` protocol (`[HttpServerRespondable.symbol]()` returning
  `Effect<HttpServerResponse>`), is sent as that response; `Schema.SchemaError` becomes an empty `400`; `NoSuchElementError` an empty
  `404`; any other value, and any defect, an empty `500` (the cause is logged). `HttpServerError` reasons: `RequestParseError` `400`,
  `RouteNotFound` `404`, `InternalError` `500`. A pure interrupt is `499` (client abort) or `503` (server abort).
- So this repo's JSON envelope (`docs/API.md` conventions) is produced in ONE place: either make the tagged error family implement
  `HttpServerRespondable.symbol`, or wrap the router's handlers once (`HttpStaticServer.layer` does it with
  `Effect.catch(HttpServerRespondable.toResponse)`). Use `Effect.catchTag(s)` for expected failures, `Effect.catchCause` to see defects.
  Never rely on the default for a documented status: `SchemaError` is a bodyless `400`, while docs/API.md wants `422` with `details`.
- Global middleware cannot handle errors (the types demand `unhandled` stays in `E`); a route-scoped one handles only the errors named in
  `HttpRouter.middleware<{ handles: X }>()`. Recover in the handler or in a pre-response handler, not in a global `Effect.catch`.
- `HttpServerResponse.json`, `setCookie`, `expireCookie` fail with `HttpBodyError` / `CookiesError` (neither is respondable: `500`).
  `Cookies.makeCookie` returns a `Result`, `makeCookieUnsafe` throws; the name, encoded value, domain and path are validated.
- A route handler runs interruptibly (client disconnect interrupts the fiber); pass `{ uninterruptible: true }` as the 4th argument of
  `add` / `route` for a write that must finish (a ledger insert).

## 5. v3 to v4 renames that bite

| v3 | v4 (this file) |
| --- | --- |
| `@effect/platform/HttpRouter` (`HttpRouter.get/post/...`, `HttpRouter.empty`, `Router.Tag`) | `effect/http` `HttpRouter.add(method, path, handler)` as layers, `HttpRouter.addAll`, one `HttpRouter` service |
| `HttpApp.HttpApp`, `HttpApp.toWebHandler` | a plain `Effect<HttpServerResponse, E, HttpServerRequest>`; `HttpEffect.toWebHandler` |
| `HttpRouter.catchAll/catchTag`, `HttpRouter.mount` | `HttpRouter.middleware` + `Effect.catch(Tag)`; `addAll(routes, { prefix })` |
| `HttpServer.layerContext`, `BunHttpServer.layerContext` | `HttpServer.layerServices`, `BunHttpServer.layerHttpServices` |
| `BunHttpServerRequest.toRequest` | `BunHttpServerRequest.toBunServerRequest` |
| `HttpMiddleware.loggerDisabled` (FiberRef) | `HttpMiddleware.withLoggerDisabled`, `HttpRouter.disableLogger` |
| `HttpApp.currentPreResponseHandlers` | `HttpEffect.appendPreResponseHandler` / `withPreResponseHandler` |
| `HttpApp.unsafeEjectStreamScope`, `ejectDefaultScopeClose` | `HttpEffect.scopeTransferToStream`, `scopeDisableClose` |
| `Cookies.unsafeSet`, `HttpServerResponse.unsafeSetCookie`, `unsafeJson` | `Cookies.setUnsafe`, `setCookieUnsafe`, `jsonUnsafe` |
| `CookieError`, `HttpServerResponse.expireCookie` (sync) | `CookiesError`; `expireCookie` returns an Effect, `expireCookieUnsafe` is sync |
| `HttpServerResponse.isServerResponse`, `HttpServerRequest.toWebEither` | `isHttpServerResponse`, `toWebResult` |
| `Multipart.withLimits(opts)`, `MaxFileSize` as a service | `Effect.provideContext(effect, Multipart.limitsServices(opts))`; plain-value `Context.Reference`s |
| `HttpServerError.clientAbortFiberId` | `HttpServerError.ClientAbort.annotation` |
| `Etag.layer` unchanged, `Generator` tag | `Etag.Generator` is a `Context.Service`; `BunHttpServer.layerHttpServices` provides `Etag.layerWeak`, `BunHttpPlatform.layer` builds with `Etag.layer` |
| `NodeRuntime`-only keep-alive | the fiber runtime keeps the process alive itself (`migration/fiber-keep-alive.md`); `BunRuntime.runMain` still adds signal handling |

## 6. Pitfalls

- **Cookies have NO defaults.** `makeCookie` options start empty: no `HttpOnly`, no `SameSite`, no `Secure`, and no `Path` (a browser then
  scopes it to the request's directory). Always pass `path: "/"`, `httpOnly`, `sameSite` and `secure` yourself; `sameSite` is lower-case
  (`"lax" | "strict" | "none"`), `maxAge` is a `Duration.Input` (numbers are milliseconds), the value is `encodeURIComponent`-encoded and
  `request.cookies` decodes it. `response.cookies` become `Set-Cookie` headers in `makeResponse` of `BunHttpServer.ts`.
- **`HttpRouter.cors({ })` with no `allowedOrigins` answers `access-control-allow-origin: *`.** Pass the explicit origin list (or a
  predicate to `HttpMiddleware.cors`) and `credentials: true` for the cookie session; a `*` never works with credentials.
- **`HttpRouter.serve`'s `middleware` option wraps the sending of the response**: header changes there never reach the client. Use
  `HttpRouter.middleware` (global) or a pre-response handler.
- A request with no route is a FAILURE (`HttpServerError` `RouteNotFound`), logged and sent as an empty `404`: add the catch-all route if
  the contract has a JSON `404`.
- `request.text` / `json` / `arrayBuffer` are cached per request (the body is read once); `request.stream` is not, do not mix.
  `request.json` on an empty body is a `RequestParseError` (`400`).
- A streamed response body owns the request `Scope` until the stream ends (`scopeTransferToStream`): a resource acquired in the handler
  stays open while the client downloads, and a client abort interrupts the stream. Do not close it by hand.
- **Graceful shutdown (`BunHttpServer.make`).** The server's finalizers run `server.stop()` (Bun's graceful stop, without `true`; the package test notes it "can hang" for WebSockets); when
  the last `serve` scope closes it waits at most `gracefulShutdownTimeout` (default 20 s, then moves on; `disablePreemptiveShutdown`
  skips the wait). `Layer.launch` + `BunRuntime.runMain` interrupt the fiber on SIGINT/SIGTERM, which closes the scopes in reverse
  build order (server first, then what it depends on, such as `Database`). With a `ManagedRuntime` you must `dispose()` it yourself.
- The hostname default is `"::"` (dual stack); a non-IP hostname is resolved once with `Bun.dns.lookup` at start.
- A `*.test.ts` that starts a real server holds a port: use `BunHttpServer.layerTest` (port `0`) or `toWebHandler`, never a fixed port.
- Effect 4 packages are exact-pinned (CLAUDE.md "Vendored reference code"); import only from `effect/http` and `@effect/platform-bun`.

## 7. In this repo

Applied by milestone E7 (`docs/EFFECT.md` section 4, decision E8: Hono goes last): `apps/api/src/index.ts` (the `export default { port, fetch,
maxRequestBodySize }` and the signal handlers become `BunHttpServer.layer({ port: env.API_PORT, ... })` + `Layer.launch` over the one
`AppLayer`), `apps/api/src/middleware/{originGuard,securityHeaders,session,household,module,verifiedEmail,staticWeb}.ts` (global
middleware and pre-response handlers with the load-bearing order: security headers, cors, origin guard, health, `/uploads`, modules,
`/api/auth`, `/api/households`, static web by specificity plus an `/api/*` JSON `404`), `apps/api/src/lib/errors.ts` (the one
`HttpServerRespondable` mapping of the tagged errors to the `docs/API.md` envelope), `apps/api/src/core/routes/auth.ts` (the session
cookie: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` as today) and `apps/api/src/lib/uploadUrls.ts` consumers (`/uploads/:filename` via
`HttpServerResponse.file` with the signature check first). Until E7 nothing here is imported; tests move from `app.request` to
`HttpRouter.toWebHandler`.

Rule served: **E8** (the observable contract is frozen: every `docs/API.md` row, status, body and header including `Set-Cookie`, CSP,
CORS and `Location`, and the middleware order) together with **E12** (`Effect.gen` / `Effect.fn`, `return yield*` for failures,
`Schema` for bodies instead of manual parsing, `Effect.catchTag(s)` instead of `instanceof`).
