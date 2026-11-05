# effect-http-api: HttpApi definition, handlers, middleware, server, client (Effect 4.0.5)

Distilled from the vendored source only (`repos/effect/LLMS.md` "Building HttpApi servers",
`repos/effect/packages/effect/HTTPAPI.md`, `repos/effect/ai-docs/src/51_http-server/{10_basics,20_testing}.ts` and its `fixtures/`,
`repos/effect/packages/effect/src/http-api/{HttpApi,HttpApiGroup,HttpApiEndpoint,HttpApiBuilder,HttpApiMiddleware,HttpApiSchema,
HttpApiSecurity,HttpApiError,HttpApiClient,HttpApiTest,HttpApiScalar}.ts`, `repos/effect/packages/effect/src/http/{HttpRouter,HttpEffect}.ts`,
`repos/effect/packages/platform/bun/src/BunHttpServer.ts`, `repos/effect/migration/annotations/effect__platform__HttpApi*.yaml`).
Look a signature up there before using it. Your memory of Effect is v3; section 5 lists what changed. This is E7 material
(`docs/EFFECT.md` milestone E7, decision E8): nothing here is wired until Hono is replaced.

## 1. What this is for, and the imports

`HttpApi` describes an HTTP API once, schema first, and the one definition drives the server, the typed client, the OpenAPI document
and the in-memory test client. Three nested values: `HttpApiEndpoint` (method, path, `params`/`query`/`headers`/`payload`/`success`/`error`
schemas), `HttpApiGroup` (endpoints plus group middleware and prefix), `HttpApi` (groups). A handler layer per group
(`HttpApiBuilder.group`) implements the endpoints; `HttpApiBuilder.layer` registers every group on the `HttpRouter`.

```ts
import { Context, Effect, Layer, Redacted, Schema } from "effect"
import { HttpClientRequest, HttpEffect, HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from "effect/http"
import {
  HttpApi, HttpApiBuilder, HttpApiClient, HttpApiEndpoint, HttpApiError, HttpApiGroup, HttpApiMiddleware,
  HttpApiScalar, HttpApiSchema, HttpApiSecurity, HttpApiTest, OpenApi
} from "effect/http-api"
import { BunHttpServer, BunRuntime } from "@effect/platform-bun"
```

`effect/http-api` is a barrel (`packages/effect/package.json` exports `"./http-api"`); `HttpApiTest`, `HttpApiSwagger` and `OpenApi` are in it
too. The server modules (`HttpRouter`, `HttpServerRequest`, `HttpServerResponse`, `HttpEffect`, `HttpServer`, `Multipart`) are in `effect/http`.
`BunHttpServer` and `BunRuntime` come from `@effect/platform-bun`. Never `effect/unstable/*`, never `@effect/platform`.

## 2. Constructors and the call shapes this repo will use

**(a) An endpoint, a group, the API.** The definition imports no server code (it is shared with the web client). Path, query and header
values are coerced from strings by the endpoint itself (`Schema.toCodecStringTree`), JSON payload/success/error by `Schema.toCodecJson`, so the
natural domain schema (`Schema.Int`) is written as is. `payload` on a no-body method (`GET`, `HEAD`, `OPTIONS`, `TRACE`; `DELETE` carries a body) is a record of fields and travels in
the query string.

```ts
export class UsersApiGroup extends HttpApiGroup.make("users")
  .add(
    HttpApiEndpoint.get("list", "/", {
      query: { search: Schema.optional(Schema.String) },
      success: Schema.Array(User.json)
    }),
    HttpApiEndpoint.patch("update", "/:id", {
      params: { id: UserId },
      payload: User.jsonUpdate,
      success: User.json,
      error: UserNotFound.pipe(HttpApiSchema.asNoContent({ decode: () => new UserNotFound() }))
    })
  )
  .middleware(Authorization)   // group scope; also on one endpoint or on the whole API
  .prefix("/users")            // also on one endpoint or on the whole API
{}

export class Api extends HttpApi.make("user-api").add(UsersApiGroup).add(SystemApi)
  .annotateMerge(OpenApi.annotations({ title: "Acme User API" })) {}
```
(`ai-docs/src/51_http-server/fixtures/api/{Api,Users}.ts`; endpoint option shape `HttpApiEndpoint.ts` `make`.) `success` and `error` take one schema or
an array; with several, each member keeps its own status and encoding. The default success is `HttpApiSchema.NoContent` (204);
`HttpApiSchema.status(206)` on a schema sets another status, `Schema.Void.pipe(HttpApiSchema.status(401))` is an empty body. Request body
encodings: `HttpApiSchema.asJson` (default) / `asFormUrlEncoded` / `asText` / `asUint8Array` / `asMultipart` (`Multipart.FilesSchema` for files).
Response encodings: `asJson` / `asFormUrlEncoded` / `asText({ contentType: "text/csv" })` / `asUint8Array`. A catch-all is path `"*"`, must be the group's last
endpoint and is not in the OpenAPI document (HTTPAPI.md "Catch-All Endpoints").

**(b) The handlers of a group, as a layer.** `HttpApiBuilder.group(api, "groupId", build)`; `build` receives an empty `Handlers`, may be an
`Effect.fn` generator (so services are `yield*`ed once at build time) and must return the handlers with every endpoint handled, else a type error
`Endpoint not handled: <id>`. The handler gets `{ params, query, headers, payload, request, endpoint, group }` (only the declared parts).

```ts
export const UsersApiHandlersNoDeps = HttpApiBuilder.group(
  Api,
  "users",
  Effect.fn(function*(handlers) {
    const users = yield* Users
    return handlers.handleAll({
      list: ({ query }) => users.list(query.search).pipe(Effect.orDie),   // undeclared failure -> defect
      update: ({ params, payload }) =>
        users.update(params.id, payload).pipe(
          Effect.catchReasons("UsersError", { UserNotFound: (e) => Effect.fail(e) }, Effect.die)
        ),
      me: () => CurrentUser   // a service provided by the Authorization middleware
    })
  })
)
export const UsersApiHandlers = UsersApiHandlersNoDeps.pipe(Layer.provide([Users.layer, AuthorizationLayer]))
```
(`fixtures/server/Users/http.ts`.) `handlers.handle("id", fn)` registers one, `handleRaw` skips payload decoding and gives the raw
`HttpServerRequest` (`ctx.request.stream`; the declared content type is then not enforced), `handle` and `handleRaw` take
`{ uninterruptible: true }` as a third argument, and a `handleAll` entry may be `{ handler, options }`. A handler may return an `HttpServerResponse` instead of the success value (redirects, files,
anything off-schema): `HttpServerResponse.redirect("/new", { status: 302 })` (HTTPAPI.md "Redirects").

**(c) A middleware with a security scheme.** A class from `HttpApiMiddleware.Service` declares what it provides, requires, which error schema it
may raise and which security schemes it decodes; the implementation is a separate layer so it does not leak into clients.
`provides` services are available to every handler behind it; `requires` must come BEFORE the provider when both are attached
(HTTPAPI.md "Interdependent Middleware").

```ts
export class Authorization extends HttpApiMiddleware.Service<Authorization, {
  provides: CurrentUser
  requires: never
}>()("acme/HttpApi/Authorization", {
  requiredForClient: true,                       // a client must also supply a client implementation
  security: { bearer: HttpApiSecurity.bearer },  // or apiKey({ in: "cookie", key: "session" }) / basic
  error: Unauthorized                            // Schema.TaggedError(..., { httpApiStatus: 401 })
}) {}

export const AuthorizationLayer = Layer.effect(Authorization, Effect.gen(function*() {
  return Authorization.of({
    bearer: Effect.fn(function*(httpEffect, { credential }) {       // credential is Redacted
      if (Redacted.value(credential) !== "dev-token") return yield* new Unauthorized({ message: "no" })
      return yield* Effect.provideService(httpEffect, CurrentUser, devUser)
    })
  })
}))
```
(`fixtures/api/Authorization.ts`, `fixtures/server/Authorization.ts`.) Without `security`, the service value is `(httpEffect, { endpoint, group }) => Effect`
that wraps the whole response effect (HTTPAPI.md "Middlewares" `LoggerLayer`). Several security schemes are tried in declaration order.

**(d) Serving: the router, the Bun server, a web handler.** `HttpApiBuilder.layer(api, { openapiPath })` needs one handler layer per group
(a missing one is `Effect.die("HttpApiGroup ... not found ... Did you forget to provide HttpApiBuilder.group")` at build time) and requires
`HttpRouter`, `FileSystem`, `Path`, `HttpPlatform`, `Etag.Generator`; `BunHttpServer.layer` provides the Bun server plus those platform services.

```ts
const ApiRoutes = HttpApiBuilder.layer(Api, { openapiPath: "/openapi.json" }).pipe(
  Layer.provide([UsersApiHandlers, SystemApiHandlers])
)
const AllRoutes = Layer.mergeAll(ApiRoutes, HttpApiScalar.layer(Api, { path: "/docs" }))

export const HttpServerLayer = HttpRouter.serve(AllRoutes).pipe(
  Layer.provide(BunHttpServer.layer({ port: 3001 }))      // vendored example: NodeHttpServer.layer(createServer, { port: 3000 })
)
Layer.launch(HttpServerLayer).pipe(BunRuntime.runMain)

// or no server layer at all, a web handler (fetch-style) with its own dispose:
export const { handler, dispose } = HttpRouter.toWebHandler(AllRoutes.pipe(Layer.provide(HttpServer.layerServices)))
```
(`ai-docs/src/51_http-server/10_basics.ts`; `BunHttpServer.layer` in `platform/bun/src/BunHttpServer.ts`.) `HttpRouter.toWebHandler(layer, { memoMap, middleware,
disableLogger })` takes the application's `Layer.MemoMap`, which is how the API's one `ManagedRuntime` and the router share built services
(CLAUDE.md "one runtime"); `handler(new Request(...))` returns a `Promise<Response>`. `HttpApiScalar.layer` / `HttpApiSwagger.layer` are for
development and the record only (EFFECT.md §6: `/docs` is not mounted in production).

## 3. Composing, encoding and decoding, providing

- **Request decoding** happens before the handler: params, headers, query, then payload, each with the schema's own `decodeUnknownEffect`. A
  failure is an `HttpApiSchemaError` (`kind: "Params" | "Headers" | "Query" | "Payload"`) answered as an EMPTY `400`. An unknown request
  `Content-Type` for a declared payload answers `415` text `Unsupported content-type: <type>`. An empty JSON body decodes `undefined`
  (or `null` if the payload accepts null); malformed JSON is the same empty `400`. Parse options for all slots: `.annotate(HttpApi.ParseOptions, { errors: "all" })`
  on the API, group or endpoint (per slot: `QueryParseOptions`, `PayloadParseOptions`, ... `HeadersParseOptions`; a slot falls back to `ParseOptions`).
  This repo's `ALL_ISSUES` is `{ errors: "all" }` (`packages/shared/src/core/schemas/checks.ts`), so the wire-issue list of ADR 0013 needs it annotated.
- **Response encoding** after the handler: the value is encoded by the success schema(s) (status and content type from the schema), a failure by the
  `error` schemas. Headers: `HttpApiSchema.WithHeaders(schema, { "x-total-count": Schema.Int })` on the success, handler returns
  `HttpApiSchema.withHeaders({ body, headers })`; for an error class carrying a header (`Retry-After`) fold it with `HttpApiSchema.encodeToWithHeaders({ body:
  HttpApiSchema.Empty(429), headers: {...} }, { decode, encode })`. Cookies and untyped headers: `yield* HttpEffect.appendPreResponseHandler((_req, response) =>
  Effect.succeed(HttpServerResponse.setCookieUnsafe(response, "name", "value", { httpOnly: true, path: "/" })))` inside the handler; for an `apiKey` cookie scheme
  `HttpApiBuilder.securitySetCookie(security, value)` (defaults `HttpOnly`, `Secure`).
- **Providing.** Group layers are `Layer.provide`d their services; the handler's own requirements show up on the group layer's `RIn`. Middleware layers are
  provided to the group layer (`fixtures/server/Users/http.ts`) or the API layer (HTTPAPI.md "Middlewares"), and with `Layer.provideMerge` in tests because the pipeline also
  resolves them when routes are built. Cross-cutting HTTP
  middleware that is not part of the API contract: `HttpRouter.middleware(fn, { global: true })` (a layer; `fn` maps the response effect), `HttpRouter.cors({ allowedOrigins, ... })`.
- **Client.** `HttpApiClient.make(Api, { baseUrl, transformClient })` is an Effect needing `HttpClient.HttpClient` (`FetchHttpClient.layer` from `effect/http`) plus the
  client side of every `requiredForClient` middleware, provided with `HttpApiMiddleware.layerClient(Authorization, ({ request, next }) => next(HttpClientRequest.bearerToken(request, token)))`.
  Calls: `client.users.update({ params: { id }, payload })`; a `topLevel: true` group (`HttpApiGroup.make("g", { topLevel: true })`) lifts its methods to the client root.
  `responseMode: "decoded-and-response"` returns `[value, response]`. `HttpApiClient.urlBuilder(Api, { baseUrl })` builds URLs only. Wrap it in a service
  (`Context.Service<ApiClient, HttpApiClient.ForApi<typeof Api>>`, 10_basics `ApiClient`).
- **Testing without a socket.** `HttpApiTest.groups(Api, ["users"])` is an Effect (needs a `Scope`) giving a typed client wired to the handlers of the listed groups through the real
  encoding and routing; other groups are placeholders that die when called. Provide the handler layers (with `Layer.provideMerge` for the middleware layers) and `HttpServer.layerServices`.
  The vendored test uses `@effect/vitest`; this repo has none: run the same Effect from `apps/api/test/support/effect.ts` (`runTest`), supplying `Scope` (`Effect.scoped`).

```ts
const makeClient = HttpApiTest.groups(Api, ["users"])
const error = yield* client.users.getById({ params: { id } }).pipe(Effect.flip)   // assert on the typed failure
// the in-test client middleware: Effect.provide(HttpApiMiddleware.layerClient(Authorization, ({ next, request }) => next(HttpClientRequest.bearerToken(request, "dev-token"))))
```
(`ai-docs/src/51_http-server/20_testing.ts`.) A real socket in tests: `BunHttpServer.layerTest` (ephemeral port, plus an `HttpClient`).

## 4. Error handling

- A handler's error channel is `Endpoint["~Error"]["Type"] | middleware error`: declared, schema-encoded failures (`error: [...]`) are answered with the schema's status and
  body (`return yield* new UserNotFound(...)`, or `Effect.fail`). The built-ins in `HttpApiError` (`BadRequest`, `Unauthorized`, `Forbidden`, `NotFound`, `Conflict`, `Gone`,
  `UnprocessableEntity`, `InternalServerError`, `ServiceUnavailable`, ...) have JSON-tagged bodies; the `...NoContent` variants (`NotFoundNoContent`) are empty. A schema encoding to
  `Schema.Void` is an empty body. Status comes from `HttpApiSchema.status(n)` or `Schema.TaggedError<Self>()("Tag", fields, { httpApiStatus: 401 })` (the third argument).
- **Typed failure versus defect.** Anything not declared never reaches the client as data: `Effect.orDie`, `Effect.die`, a thrown error and a failure no `error` schema can encode all end as a
  defect, answered `500` (the framework runs `Effect.orDie(encodeError(error))`, `HttpApiBuilder.ts` `handlerToHttpEffect`). A response-side `HttpApiSchemaError` (`kind: "Body"` or
  `"ResponseHeaders"`) is also a defect, a `500`, and is reported; a request-side one is a `400` and is ignored by error reporters. Convert a service's wider error union with
  `Effect.catchTag(s)`, `Effect.catchReason(s)` (as `fixtures/server/Users/http.ts`) or `Effect.orDie` in the handler.
- **Replacing the empty 400.** Request validation failures are defects unless a middleware maps them: declare `class SchemaErrorHandler extends HttpApiMiddleware.Service<SchemaErrorHandler>()
  ("api/SchemaErrorHandler", { error: ValidationError.pipe(HttpApiSchema.status(422)) }) {}`, implement it with `HttpApiMiddleware.layerSchemaErrorTransform(SchemaErrorHandler,
  (schemaError) => Effect.fail(new ValidationError(...)))` (it gets `HttpApiSchemaError` with `kind` and `cause: Schema.SchemaError`), provide the layer, attach `.middleware(SchemaErrorHandler)`
  at endpoint, group or API scope. Format the issues from `schemaError.cause`, never by reading an Effect message (CLAUDE.md "Never read an Effect message").
- A middleware failure is also typed: its `error` schema is merged into every endpoint behind it and into the client's error channel.
- The client side: an undeclared status fails with `HttpClientError` (`StatusCodeError`); a declared error status decodes to the error class.

## 5. v3 to v4 renames that bite for this module

| v3 (`@effect/platform`) | v4 (`effect/http-api`) |
| --- | --- |
| `HttpApiEndpoint.get("name")\`/path/${param}\`` with `.setPayload/.addSuccess/.addError/.setPath/.setUrlParams` | `HttpApiEndpoint.get("name", "/path/:p", { params, query, headers, payload, success, error })`; `urlParams` is `query`, `path` is `params`; no fluent setters |
| `HttpApiBuilder.api(Api)` + `HttpApiBuilder.serve()` + `HttpApiBuilder.httpApp` | `HttpApiBuilder.layer(Api, { openapiPath })` registered on `HttpRouter`, served by `HttpRouter.serve(layer)` or `HttpRouter.toWebHandler(layer)` |
| `HttpApiBuilder.toWebHandler` | `HttpRouter.toWebHandler` (HTTPAPI.md prose still says the old name, its code uses the router) |
| `HttpApiMiddleware.Tag<Self>()("id", { failure, provides, security })` | `HttpApiMiddleware.Service<Self, { provides, requires }>()("id", { error, security, requiredForClient })`; `optional` removed |
| `HttpApiBuilder.middleware`, `middlewareCors`, `middlewareOpenApi` | `HttpRouter.middleware(fn, { global: true })`, `HttpRouter.cors(...)`, the `openapiPath` option |
| `HttpApiError.HttpApiDecodeError` (400 with issues) | `HttpApiError.HttpApiSchemaError` (`kind`, `cause`): a defect (empty 400) unless a schema-error middleware transforms it |
| `HttpApiError.Forbidden` (empty 403) | `HttpApiError.ForbiddenNoContent`; `Forbidden` is a JSON-tagged class now |
| `HttpApiSchema.annotations({ status })`, `asEmpty`, `deunionize` | `HttpApiSchema.status(n)` / `Schema.annotate({ httpApiStatus })`, `asNoContent({ decode })`, an array of schemas |
| `HttpApiSecurity.annotateContext` | `HttpApiSecurity.annotateMerge`; `Bearer` is `Http` with scheme `Bearer` (`HttpApiSecurity.bearer` stays) |
| client `{ path, urlParams, withResponse }` | `{ params, query, payload, headers, responseMode }` |
| `HttpApi.Api` context tag, API-level `addError`, group-level errors | gone: declare errors per endpoint or in a middleware; pass the `Api` value explicitly |
| `Schema.Union(A, B)` / `.annotations()` / `.filter()` inside endpoint schemas | `Schema.Union([A, B])`, `.annotate()`, `.check()` (CLAUDE.md "v4, not v3") |

## 6. Pitfalls from LLMS.md and the source

- Keep the `HttpApi` definition free of server code (LLMS.md/10_basics): the web client imports it. Handlers and middleware implementations live elsewhere.
- Endpoint names are the client method names and the handler keys; a group key is `HttpApiGroup.make("id")`, and `HttpApiBuilder.group(Api, "id", ...)` names it again. Header keys are lowercase.
- `payload` on a no-body method must be a record of fields (query string). The query is decoded through `Schema.toCodecArrayFromSingle`, so a repeated
  parameter is an array and a single one is wrapped.
- Path params are strings on the wire: declare the coercing schema (`Schema.Int`) for `/:id`.
- The order of `.middleware(...)` calls matters: the earlier call wraps the later one (HTTPAPI.md "Interdependent Middleware"). Put the session middleware before the ones that read its service.
- Security handlers receive a `Redacted` credential (`Redacted.value`); an absent credential arrives as an EMPTY redacted string, so a handler must reject `""` itself. A cookie scheme reads the
  cookie by `key` case-sensitively, a header scheme by lowercase key.
- Provide the middleware layers wherever the routes are built, including tests (`Layer.provideMerge`), or the API layer fails to build.
- `handleRaw` bypasses payload decoding and content-type enforcement; the raw request stream failure is `HttpServerError`, which a handler must turn into a defect or its own error.
- `HttpRouter.serve` and `toWebHandler` apply `HttpMiddleware.logger` unless `disableLogger: true`; their `middleware` option wraps the whole chain but cannot change the sent response (use
  `HttpRouter.middleware`).
- `HttpApiGroup.add` takes endpoints, `HttpApi.add` takes groups, both varargs of at least one. `HttpApi.prefix` / `HttpApiGroup.prefix` rewrite every contained path.
- The codec coercion is on by default; `disableCodecs: true` on an endpoint turns it off and then the schemas must already encode to strings / JSON.

## 7. In this repo

- E7 (`docs/EFFECT.md` milestone E7, decision E8): `apps/api/src/core/routes/*.ts` become `HttpApiGroup` definitions with handler layers; each module contributes groups plus a handler layer in place of a `Hono`
  router (`apps/api/src/modules/<id>/routes/`, the `ApiModule` contract of `apps/api/src/modules/types.ts`); `apps/api/src/middleware/*.ts` become `HttpApiMiddleware` services in the order
  `requireSession` then `requireHouseholdRole("member")` then `requireModule(id)`; `apps/api/src/index.ts` serves with `BunHttpServer` on the same port, static web last. The definition lives where the web can import it
  (`packages/shared`), the wire shape is `docs/API.md` and is frozen: error bodies keep `{ error: { code, message, details, i18n } }` through declared error schemas (`apps/api/src/lib/errors.ts`, `toApiError`).
- Rule served: **E8** (Hono goes last, the contract is frozen, middleware order is load-bearing), with **E12** (`Effect.fn`, `return yield*`, `Schema.TaggedError`) for the handlers, **E4** (one schema adapter: the same shared
  schemas, decoded with `ALL_ISSUES`) for the request slots, and **E2** (look every signature up in `repos/effect`) when this file is silent.
