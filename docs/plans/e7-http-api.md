# E7 — http-api: plan

**Status: DONE (2026-11-05), integrated by E7-T13; the plan was revised the same day after the plan review (section 2.5 lists what changed).** Base commit `16b104d82` (`learn: effect-http-api pattern file from the vendored Effect source`),
Bun 1.4.3 on the host (`.bun-version` says 1.4.2). Sections 9 and 10 (the integration record and "what changed vs plan") were written
by E7-T13.

E7 is the eighth milestone of the Effect migration (`docs/EFFECT.md` §4 E7; decision **E8**, with E4 for the one decode path, E6 for
the error family and its one boundary mapper, E7 for the one runtime and the module contract, E9 for the tests, E12 for the idioms).
Hono leaves the tree: the API is described by `HttpApi` values (`effect/http-api`), protected by `HttpApiMiddleware`s with the same
names and the same order (cors, the origin guard and the security headers become global router middleware, deviation D6), and served by `BunHttpServer` (`@effect/platform-bun`) on the same port and host. The guiding sentence holds:
**how the code is written changes, not what it does.** No `docs/API.md` row, status, body, header (`Set-Cookie`, CSP, CORS,
`Location`, `Content-Disposition`, `Retry-After`, `Cache-Control`), German string, table, migration, log line a doc or test pins, or
exit code changes. The web app is not touched (E11 as built in E6).

Exit (`docs/EFFECT.md` §4 E7 and the milestone task): gates green (`bun install --frozen-lockfile`, `bun run typecheck`, `bun test`,
`bun run build`, `bun run i18n:check` read by hand); the pass count not below E6's record (14993, re-measured as this plan's baseline,
1.2); every `docs/API.md` row served with the same status and headers (the table-driven contract test of E7-T01, written against the
Hono app and passing UNCHANGED after the switch); `apps/api/test/api-doc.test.ts` enumerating `METHOD path` from the `HttpApi`
definitions; `apps/api/test/middleware.test.ts` and `apps/api/test/import-order.test.ts` adapted without losing a case; the local
stack test of `docs/deployment.md` with a freshly built image (build log ending `exit=0`, `/api/health` healthy through the Caddy, the
old-hostname redirects untouched); the CSP hashes matching the built `index.html` at a second origin; `grep -r 'from "hono' apps` empty
and `hono` gone from every `package.json` and `bun.lock` (idioms rule (14)).

## 1. Context

### 1.1 State of the tree at plan time (`16b104d82`, measured 2026-11-05)

- **Hono is the server.** `apps/api/src/index.ts` builds `export const app = new Hono<AppEnv>()` with `onError`/`notFound`
  (`apps/api/src/lib/errors.ts` `onErrorHandler`, `notFoundHandler`), `logger()` outside tests, `securityHeaders(env.webDistDir)`
  (Hono's `secureHeaders` with the CSP hashes), `cors()` on `/api/*`, `localeMiddleware`, `originGuard(env.webOrigins)` on `/api/*`,
  `GET /api/health` (`runtime.runPromise(healthResponse)`), `GET /uploads/:filename` (signature check, `Thumbnails.resolveThumbnail`,
  `Bun.file` response), `mountModules(app, API_MODULES)` (`apps/api/src/modules/mount.ts`: `userRouter` at `/api/<id>`,
  `householdRouter` at `/api/households/:householdId/<id>` behind `requireSession()` → `requireHouseholdRole("member")` →
  `requireModule(id)` on `${base}/*`), `app.route("/api/auth", authRoutes)`, `app.route("/api/households", householdRoutes)`, the
  static web last (`webAppMiddleware`), the SIGTERM/SIGINT teardown and the boot, and `export default { port: env.API_PORT, fetch:
  app.fetch, maxRequestBodySize: 20 MiB }` (Bun's auto-serve of a default export, hostname Bun's default `0.0.0.0`).
- **Every handler is already an Effect.** Since E2 to E4 each route body is `(c) => runtime.runPromise(Effect.gen(...))` (some
  `withImportDb(Effect.gen(...))`); the Hono context `c` is used only through a small vocabulary (tally over the 18 route files and
  `apps/api/src/modules/finance/middleware.ts`): `currentMembership(c)` 70, `json(c, …)` 62, `validate("json", …)` 42 /
  `c.req.valid("json")` 41, `requireSession()` 34, `requireVerifiedEmail()` 32, `currentFinanceParticipant(c)` 32, `currentUser(c)`
  30, `noContent(c)` 26, `c.req.param(…)` 74, `validate("query", …)` 16, `created(c, …)` 15, `requireFinanceParticipant()` 12,
  `requireHouseholdRole(…)` 25, `clientIp(c)` 10, `c.redirect` 7, `requireModule(…)` 6 (the mount and tests), `requestLocale(c)` 5,
  `c.req.json()` 5, `c.req.query(…)` 13, `c.get("sessionId"|"user")` 6, `c.req.header` 2, `c.req.text()` 1, `c.req.formData()` 1,
  `c.req.raw` 1, `new Response(file, …)` 2 (uploads, the import source).
- **47 files import `hono`**: 37 under `apps/api/src` (`index.ts`; `core/routes/{auth,households,invites,members,modules}.ts`;
  `core/services/auth/rateLimit.ts` (`clientIp(c)`); `lib/{cookies,errors,http,locale,types,validate}.ts`;
  `middleware/{household,module,originGuard,securityHeaders,session,staticWeb,verifiedEmail}.ts`; `modules/{mount,types}.ts`;
  `modules/finance/{middleware.ts,routes/{balance,categories,index,participants,plan,settlements,tags,transactions}.ts}`;
  `modules/recipe/routes/{cards,imports,index,plan,recipes,shopping}.ts`) and 10 test files that build their own Hono apps
  (`apps/api/test/{auth,errors,finance-participants,middleware,modules,oauth-callback,rate-limiter,security,static-web,validate}.test.ts`).
  `hono` `^4.13.7` is a dependency of `apps/api/package.json` only.
- **43 test files go through `app.request`** (115 call sites); 28 of them and `apps/api/test/support/finance-harness.ts` import
  `app` from `src/index.ts`. `apps/api/test/api-doc.test.ts` reads `app.routes`. `docs/API.md` has **131** endpoint rows.
- **The route files and their mounts** (Table M, section 2.3): core `auth.ts` (23 routes at `/api/auth`), `households.ts`,
  `members.ts`, `invites.ts`, `modules.ts` (17 routes on the one `householdRoutes` at `/api/households`); recipe `recipes.ts` (root of
  `/api/households/:householdId/recipe`), `imports.ts`, `shopping.ts`, `plan.ts`, `cards.ts` (user-scoped at `/api/recipe/cards`);
  finance `participants.ts`, `transactions.ts`, `categories.ts`, `tags.ts`, `plan.ts`, `balance.ts`, `settlements.ts`. Sub-routers gate
  with `router.use("*", requireVerifiedEmail())` (recipe recipes, plan, shopping, imports, cards; every finance ledger router) and
  `router.use("*", requireFinanceParticipant())` (every finance router but participants).
- **The pattern files exist**: `agent-patterns/effect-http-api.md` and `agent-patterns/effect-http-server-bun.md` (Learn phase,
  `16b104d82`, `9f1038fd4`). One line of `effect-http-api.md` §6 is misleading (middleware order, P6); E7-T02 fixes it.
- **Facts verified in the vendored source for this plan** (each task re-reads its own):
  - `HttpApiBuilder.ts` `applyMiddleware` (around line 936): `for (const key of endpoint.middlewares) handler = apply(handler)`, so the
    middleware attached FIRST is the INNERMOST and the one attached LAST runs FIRST (P6).
  - `HttpApiBuilder.ts` `handlerToHttpEffect` (around line 828): params, headers, query and payload are decoded INSIDE the middleware
    chain; a handler that returns an `HttpServerResponse` bypasses the success encoder (line 888); a failure no `error` schema encodes
    becomes a defect (`Effect.orDie(encodeError(error))`).
  - `HttpApiGroup.ts` line 398: a group's key is `effect/http-api/HttpApiGroup/<identifier>`; `HttpApiBuilder.layer(api)` looks the
    handlers up by that key and dies when one is missing. Group identifiers must be unique across every API the server registers.
  - `internal/path.ts` `toRouterPath`: when an endpoint declares `params`, every `:name` of its FULL path that the schema does not
    list is rewritten to a literal `::` (the route stops matching); without `params` the path is kept as is (P3).
  - `HttpRouter.ts` lines 214 to 216: a `HEAD` request falls back to the `GET` tree ONLY when `router.find("HEAD", url)` finds
    nothing; `BunHttpServer.ts` line 248 omits the body. A route with method `"*"` goes to `router.all(...)`, i.e. into EVERY method
    tree, `HEAD` included (lines 162 to 168; `FindMyWay` `httpMethods`), so a `*`-method wildcard shadows the `HEAD` → `GET` fallback
    (P11, P14).
  - `HttpRouter.ts` lines 162 to 174: a route whose path ends in `/*` is registered TWICE, as `/x/*` and as the bare `/x`;
    `FindMyWay/internal/router.ts` line 261 throws `Method '…' already declared for route '…'` on a second registration of one method
    and path. The path `"*"` (a `PathInput`, line 785) is registered once and matches everything.
  - Global middleware (`HttpRouter.ts` `addGlobalMiddleware` line 207, `asHttpEffect` around line 256): kept in registration order and
    applied reversed, so the FIRST registered is the OUTERMOST. `HttpRouter.middleware(fn, { global: true })` registers when its layer
    is built (line 1043), and `Layer.mergeAll` builds its members concurrently (`Layer.ts` `mergeAllEffect`, line 1220:
    `concurrency: layers.length`): a registration order through `mergeAll` is not deterministic (P11).
  - `BunHttpServer.ts` line 128: the default hostname is `"::"` (Bun.serve's own default is `0.0.0.0`).
  - `Cookies.ts` (around lines 616 to 815): no default attributes; `maxAge` is a `Duration.Input` (a number is MILLISECONDS);
    `expireCookie` adds an `Expires` epoch next to `Max-Age=0`; the serializer writes `SameSite=Lax`.
  - `HttpEffect.ts` `appendPreResponseHandler` (line 264): handlers keyed on `request.source`, applied to the final response,
    success or failure.
  - `HttpServerRequest.ts`: `source` is the underlying `Request` (Bun's, or the one `fromWeb` wrapped); `toWeb` / `toWebResult`,
    `ParsedSearchParams` (a repeated key is an array), `remoteAddress` (an `Option`, set by `BunHttpServer` from `server.requestIP`).
  - `HttpServerResponse.ts`: `fromWeb(response)` (line 1493), `file`, `redirect`, `empty`, `jsonUnsafe`, `setCookie(Unsafe)`.
  - `HttpRouter.toWebHandler(layer, { memoMap, disableLogger })` (line 1449) returns `{ handler, dispose }` and builds the layer at
    once. It provides the module constant `HttpRouter.layer` (line 637, `Layer.effect(HttpRouter)(make)`), which is memoised BY
    IDENTITY (`Layer.effect` → `effectContext` → `fromBuildMemo`, `Layer.ts` line 1101). Two handlers built on the SAME memo map
    therefore share ONE router: a second `/*` registration throws, a module-constant route layer is silently not registered again,
    test routes and global middlewares leak into every later handler. A child map, `Layer.forkMemoMapUnsafe(parent)` (`Layer.ts` line
    524), looks an entry up in its parent (`MemoMapImpl.get`, line 440) and builds everything else fresh; `HttpRouter.serve` does the
    same through `CurrentMemoMap.forkOrCreate` (line 603). The handler needs a per-request `context` argument unless every service the
    layer requires is in the layer's OUTPUT (`ReqR = Exclude<HR, A | …>`), so an app layer is assembled with `Layer.provideMerge`, never
    `Layer.provide` (P13).
  - `HttpApiBuilder.ts` `HandlerRequirements` (line 219): a group handler layer requires the endpoints' middleware tags, the services
    those middlewares require, and every service a handler yields as an `HttpRouter.Request<"Requires", S>` phantom, not as `S`; a
    contract type cannot name them per module (P14).
  - `BunHttpServer.ts` lines 172 to 178: only the serve scope's `preemptiveShutdown` is bounded by `gracefulShutdownTimeout`
    (`Effect.timeoutOrElse`); the layer scope's own finalizer `shutdown` (`Effect.promise(() => server.stop())`, cached) has no timeout
    and waits for every in-flight request (P12).
  - `HttpServer.layerServices` (`HttpServer.ts` line 291) and `BunHttpServer.layerHttpServices` (line 328) provide the platform
    services `HttpApiBuilder.layer` needs.

### 1.2 Baseline

`bun test` on `16b104d82` (log in the planner's scratchpad, ending `exit=0`): **14993 pass, 1 skip, 0 fail, 384819 `expect()` calls,
`Ran 14994 tests across 177 files. [52.80s]`**, the same count as E6's record (`docs/plans/e6-web-client.md` 9.1). The pass count of
every merged task and of the final tree is compared with **14993**.

### 1.3 Bundle size

E7 changes no file under `apps/web` (P20); the gzipped bundle stays E6's 419.99 kB. E7-T13 runs `bun run build` once and records the
number to show it unchanged.

## 2. Decisions (binding for the tasks)

Each decision names the `docs/EFFECT.md` decision it serves. A task that cannot follow one makes the smallest deviation, records it in
its commit message and in section 10, and (for the vocabulary of P4 to P10) writes the amendment into the header comment of
`apps/api/src/http/middleware.ts` under the heading `Table R amendments` in the same commit (this plan file is untracked until E7-T13
commits it, so a worktree does not see edits to it); every rewrite task reads that header together with Table R.

**P1 — Migrate behind a bridge, one area at a time, then cut over (E3, E8, E9).** Until E7-T11 the Hono app keeps serving, and
every converted area is served THROUGH it: `effectBridge(api, handlers, mountedAt)` (`apps/api/src/http/bridge.ts`, E7-T03) is a
`Hono<AppEnv>` sub-app that registers EXACTLY the API's endpoints (method plus the endpoint path minus `mountedAt`) and forwards each
request (`c.req.raw`) to an in-memory `HttpRouter.toWebHandler` of that API, built lazily on the first request by `inMemoryHandler`
(`apps/api/src/http/in-memory.ts`, E7-T02, P13): `AppLayer` is built into `appMemoMap` first (`await runtime.runPromise(Effect.void)`),
then the handler is built on a CHILD memo map `Layer.forkMemoMapUnsafe(appMemoMap)`, so the handlers see the one `AppLayer` (the
shared test DB, the `setMailer` seam, the limiter state) while every bridge gets its OWN `HttpRouter` (1.1). A route file keeps
its exported name (`authRoutes`, `householdRoutes`, `recipeRoutes`, `transactionRoutes`, …) as the bridge, so `apps/api/src/index.ts`,
`apps/api/src/modules/recipe/routes/index.ts` and `apps/api/src/modules/finance/routes/index.ts` do not change until E7-T11, and the
EXISTING route tests, unchanged and still through `app.request`, verify every converted area in the task that converts it. Because
the bridge registers exact routes, `app.routes` keeps listing every `METHOD path` (api-doc unchanged until E7-T11) and an unknown
path still falls through to Hono's JSON 404. Transitional artefact, deleted by E7-T11: a module route bridged inside a Hono module
router passes the module chain twice (Hono's mount, then the API's own; the second pass sees the renewed session and writes nothing),
and a bridged request has no socket address (`clientIp` falls back to `"unknown"`, as every in-process test already does).

**P2 — Where the definition lives: one `HttpApi` per route file, server side (E8, E11).** Each route file `X.ts` gets a sibling
`X.api.ts` holding its `HttpApiGroup` and its `HttpApi` (one group per file; `households.api.ts` holds the four groups `invites`,
`households`, `members`, `modules` of the one `/api/households` router, in that order). The `.api.ts` files are LEAVES: they import only
`effect`, `effect/http-api`, `apps/api/src/http/middleware.ts` and (finance) `apps/api/src/modules/finance/http.ts`. The definitions
stay in `apps/api`, not `packages/shared`: the web keeps its E6 clients (E11 as built), so no web bundle change and no HttpApiClient
(out of scope, section 8). Group identifiers are globally unique (`HttpApiGroup.ts` line 398): core `health`, `uploads`, `auth`,
`invites`, `households`, `members`, `modules`; module `<moduleId>.<file>` (`recipe.recipes`, `recipe.imports`, `recipe.shopping`,
`recipe.plan`, `recipe.cards`, `finance.participants`, `finance.transactions`, `finance.categories`, `finance.tags`, `finance.plan`,
`finance.balance`, `finance.settlements`); each `HttpApi` carries the same identifier as its group (`HttpApi.make("recipe.recipes")`),
`households.api.ts`'s is `households`. Final set: `SystemApi` (health, uploads; E7-T10), `AuthApi`, `HouseholdsApi`, and the module APIs
of Table M.

**P3 — What an endpoint declares, and what it does not (E8, E4).** An endpoint declares its method, its path in Hono's syntax relative
to its API (Table M), its middleware chain (P6), and `params` with **every** `:name` of its FULL path (Table M prefix included, e.g.
`{ householdId: Schema.String, recipeId: Schema.String }`) as `Schema.String`; an endpoint whose full path has no `:name` declares no
`params` (a partial `params` schema turns the missing names into literal `::`, 1.1). It declares **no** `payload`, `query`, `headers`,
`success` or `error` schema. Bodies and queries are decoded in the handler by `apps/api/src/http/request.ts` (P4), which keeps the
`validate` semantics of today; responses are `HttpServerResponse`s built by `apps/api/src/http/response.ts`, which the HttpApi success
encoder never touches (1.1). Reason: HttpApi's own decoding answers an EMPTY `400` (or `415`) where `docs/API.md` pins a `422
validation_failed` envelope and a `400 bad_request`, and its success encoding drops every key the schema does not declare; neither is
observably equal to today. Declaring payload and success schemas per endpoint, with a byte-diff contract test, is open work after E8
(`docs/open-work.md`, E7-T13). The OpenAPI document of these definitions lists methods, paths and path params only.

**P4 — Reading a request keeps Hono's semantics (E4, E8, E12).** `apps/api/src/http/request.ts` (E7-T02) exports Effects over
`HttpServerRequest` (and `HttpRouter.RouteContext`):
- `jsonBody(schema)`: the body is read as JSON ONLY when `Content-Type` matches Hono 4.13.7's JSON regex (copy it verbatim from
  `node_modules/hono/dist/validator/validator.js` while hono is still installed, and cite it); otherwise the schema decodes `{}`.
  Malformed JSON fails with `new ApiFailure({ status: 400, code: "bad_request", text: "server.error.requestFailed" })` (what
  `toApiError` made of Hono's `HTTPException(400)`). The decode is `decode(schema, value)` of `apps/api/src/lib/validate.ts`
  (`ALL_ISSUES`; a refusal is the `Schema.SchemaError` the boundary maps to `422`). The body text is read ONCE per request through
  `HttpServerRequest.text` (cached per request), so `jsonBody` and `rawJsonOrDie` may both run in one handler, as `c.req.valid("json")` and
  `c.req.json()` did.
- `queryParams(schema)`: decodes Hono's `c.req.queries()` shape (a key seen once is a string, a repeated key an array) from
  `HttpServerRequest.ParsedSearchParams`; `queryParam(name)` is `c.req.query(name)` (the first value or `undefined`); `queryRecord` is
  `c.req.query()` (every key's first value).
- `header(name)` (`string | undefined`), `rawText` (`c.req.text()`), `webRequest` (the underlying `Request`, `request.source`, for
  `formData()` and `readUploadedFile`).
- The raw JSON body (`c.req.json()`) in TWO forms, because today's callers treat a malformed body in two different ways and both are
  pinned wire behaviour. `rawJsonOr(onMalformed)` parses the cached body text and fails with `onMalformed()` when it is not JSON: the
  three local `readJson` helpers keep their own refusal, key and German text (`new BadRequest({ text: "server.auth.invalidJsonBody" })`
  in `core/routes/auth.ts` and `modules/recipe/routes/cards.ts`, `new BadRequest({ text: "server.import.invalidJsonBody" })` in
  `modules/recipe/routes/imports.ts`). `rawJsonOrDie` parses it and makes a malformed or empty body a DEFECT carrying the parse error,
  exactly as `Effect.promise(() => c.req.json())` did (`recipes.ts`'s two `keepOnlySentKeys` calls: a `text/plain` request with an empty
  body stays a `500 internal_error` and does not become a 400). There is no bare `rawJson`: every caller states which refusal it keeps.
- `clientIp`: the LAST `X-Forwarded-For` entry when `TRUST_PROXY`, then `X-Real-IP` / `CF-Connecting-IP`, then the socket address
  (`request.remoteAddress`), else `"unknown"`: the logic of `apps/api/src/core/services/auth/rateLimit.ts` `clientIp(c)`, moved into a
  pure `clientIpFrom({ header, socketAddress })` which the Hono function (until E7-T12) and the Effect `clientIp` (E7-T02) both call.
- `requestLocale`: `negotiateLocale(accept-language, env.defaultLocale)`, through a pure `negotiateRequestLocale(header)` added to
  `apps/api/src/lib/locale.ts`. Every request computes it where needed; there is no locale middleware any more (its only job was to
  run before `onError`; the boundary computes it itself).
`request.url` of `BunHttpServer` is a path: anything that needs the full URL (the origin guard's request host, the not-found path)
reads `request.source.url` or `HttpServerRequest.toURL`.

**P5 — The middleware vocabulary (E8).** Tags (the `HttpApiMiddleware.Service` classes) live in the LEAF
`apps/api/src/http/middleware.ts` (E7-T02): `ApiErrorBoundary`, `RequireSession`, `OptionalSession`, `RequireHouseholdMember`,
`RequireHouseholdAdmin`, `RequireHouseholdOwner`, `RequireModule`, `RequireVerifiedEmail`; finance's `RequireFinanceParticipant` lives
in the leaf `apps/api/src/modules/finance/http.ts` (E7-T09). The services they provide live in the leaf `apps/api/src/http/context.ts`:
`CurrentUser` (`User`), `CurrentSession` (`{ sessionId }`), `MaybeSession` (`{ user: User | undefined; sessionId: string | undefined
}`, from `OptionalSession`), `CurrentMembership` (`Membership`, moved from `apps/api/src/lib/types.ts`, which re-exports the type);
finance's `CurrentFinanceParticipant` (`FinanceParticipantContext`) in `modules/finance/http.ts`. Implementations are layers in the
existing files: `apps/api/src/middleware/{session,household,module,verifiedEmail}.ts` (E7-T03), `apps/api/src/modules/finance/middleware.ts`
(E7-T09), `ApiErrorBoundary`'s in `apps/api/src/http/response.ts` (E7-T02); `httpMiddlewareLayer()` (a hoisted function in
`apps/api/src/http/middleware-layer.ts`, E7-T03) merges the core ones. Semantics are today's, line for line: `RequireSession` reads
`toon_session`, clears a stale cookie and renews a session close to expiry through pre-response handlers (P8), fails `Unauthorized`;
the household middlewares resolve the household from `:householdId` (or the `inviteId` resource param, as `resolveHouseholdId` does),
answer `404 server.group.notFound` / `403 server.group.noAccess` / `403 adminOnly|ownerOnly`, and provide the membership;
`RequireModule` reads the module id from the `ModuleId` annotation every group of a module API carries (P14), never from the URL, and
answers `404 module_disabled`; `RequireVerifiedEmail` gates every method but `GET`, `HEAD`, `OPTIONS`. No `HttpApiSecurity` scheme: the
session cookie is read by the session middleware itself (an absent cookie would arrive as an empty credential, and today's stale-cookie
clearing has no place in a security decoder).

**P6 — Middleware order: the LAST attached runs FIRST (E8).** Verified in `HttpApiBuilder.ts` `applyMiddleware` (1.1). Everything is
attached through `chain(...middlewares)` (E7-T02, `apps/api/src/http/middleware.ts`), which takes the middlewares in EXECUTION order,
exactly as Hono lists them, and attaches them reversed; the call shape `.pipe(chain(A, B, C))` works on an endpoint, a group and an
API (if one generic signature is impossible, T02 provides overloads, the call shape stays). Endpoint chains are attached when the
endpoint is defined, the group chain after the group's `.add(...)`, the API chain last, so the execution order of a module write is:
`ApiErrorBoundary` → `RequireSession` → `RequireHouseholdMember` → `RequireModule` (the API chain, P14) → `RequireVerifiedEmail` →
`RequireFinanceParticipant` (the group chain, as the sub-router's `use("*")`) → `RequireHouseholdAdmin` (the endpoint chain, as the
per-route middleware) → the handler (which decodes the body, as `validate` stood last). E7-T02 corrects `agent-patterns/effect-http-api.md`
§6 ("the earlier call wraps the later one") to state this fact with the line reference.

**P7 — One error boundary, outermost on every API (E6, E8).** `ApiErrorBoundary` (implementation `ApiErrorBoundaryLayer` in
`apps/api/src/http/response.ts`) wraps the whole chain and recovers the WHOLE cause (`Effect.catchCause`; a cause that is only
interruption is re-raised, never answered): it renders `errorResponse(error)` = `toApiError(Cause.squash(cause), locale)` →
`errorBody(...)` with the family member's status, `Retry-After: <seconds>` for `RateLimited`, and the exact log lines of today's
`onErrorHandler` (`[api] <METHOD> <path> -> <status> <code>: <English message>` plus the stack for a 5xx family member; `[api]
<METHOD> <path> ->` plus the raw value, or a `DatabaseError`'s `cause`, for anything else; the development `console.warn` for a 4xx),
`<path>` being the pathname without the query (Hono's `c.req.path`). The log lines and the route-unknown error are written ONCE:
E7-T02 extracts them from `onErrorHandler` and `notFoundHandler` into two Hono-free exports of `apps/api/src/lib/errors.ts`,
`logBoundaryFailure({ method, path, error, apiError })` (the three log branches verbatim) and `routeUnknown(method, path)` (the
`NotFound` with `server.error.routeUnknown`), which the Hono handlers (until E7-T12) and `ApiErrorBoundary` both call. Its declared `error` is a `Schema.declare` over the union it
catches (the family, `Schema.SchemaError`, `DatabaseError`) so a handler may fail with any of them type-wise; HttpApi's own
`encodeError` is never reached because the boundary always succeeds. If the declared-error typing turns out impossible, T02 records the
alternative it takes (for example a `respond` combinator passed as the extra argument of every handler's `Effect.fn`) under `Table R
amendments` (section 2 intro).
The origin guard, the route-not-found answer and the module catch-alls render through the same `errorResponse`. Predicates and
`Effect.catch*` only, never `instanceof` (E12).

**P8 — Cookies (E8).** `apps/api/src/http/cookies.ts` (E7-T02) exports `readSessionCookie`, `setSessionCookie(sessionId, expiresAt)`,
`clearSessionCookie`, `setOAuthCookies(values)`, `readOAuthCookies`, `clearOAuthCookies` as Effects; a setter registers a
pre-response handler (`HttpEffect.appendPreResponseHandler`), so a cookie a middleware sets reaches an error response too, as Hono's
`c.header` did (the stale-cookie `401`). Attributes are today's (`apps/api/src/lib/cookies.ts` `baseOptions`): `Path=/`, `HttpOnly`,
`SameSite=Lax`, `Secure` only in production, `Max-Age` in seconds (`maxAge: Duration.seconds(n)`; a bare number is milliseconds);
deleting writes the empty value with `Max-Age=0` and NO `Expires` (never `expireCookie`). The attribute ORDER is Effect's serializer's;
the contract test compares cookie attributes as a set (deviation D2 if anything pins the order; nothing does at plan time: the tests read
`set-cookie` up to the first `;`). Values stay `encodeURIComponent`-encoded both ways.

**P9 — Handlers (E8, E12).** A route file's handlers are ONE layer, `HttpApiBuilder.group(<Api>, "<group id>", (handlers) => handlers
.handle(...)...)`, exported as `<file>Handlers` (Table R). Each handler is `Effect.fn("<group id>.<endpoint name>")(function* ({ params
}) { … })` (traced, never `.pipe` on it, combinators such as `withImportDb` as its extra arguments), registered with `UNINTERRUPTIBLE`
(`{ uninterruptible: true }`, exported by `apps/api/src/http/middleware.ts`): Hono never interrupted a handler when the client went
away, and finance's create-with-`mutationId`, the shopping outbox replays and the import commit rely on a write finishing. Services are
yielded inside the handler as today (`const x = yield* Service`), so a handler file references no service at module scope (P15).
Endpoint names follow Table N.

**P10 — Responses (E8).** `apps/api/src/http/response.ts` (E7-T02): `json(body)` (200, `application/json` exactly as Hono's
`c.json`), `created(body, location?)` (201, `Location` when given), `noContent()` (204, no body), `redirect(url)` (302, `Location`),
`fromWeb(response)` (a `Response` built by today's code, e.g. the import source with `Content-Disposition`, kept byte for byte),
`errorResponse(error)` (P7). Every one returns an `HttpServerResponse` (or an Effect of one where it must read the request).

**P11 — The global HTTP layer (E8; E7-T04; deviation D6).** What Hono ran around every router becomes `globalHttpLayer()`
(`apps/api/src/http/global.ts`): ONE `Layer.effectDiscard(Effect.gen(...))` that yields `HttpRouter.HttpRouter`, prepares what the
middlewares need (the CSP hashes from `env.webDistDir`, the cors options) and THEN calls `router.addGlobalMiddleware` for 1 to 4 below,
one after the other in that one generator (first registered = outermost, 1.1). Never `Layer.mergeAll` of
`HttpRouter.middleware(…, { global: true })` layers: `mergeAll` builds its members concurrently, and a security-headers layer that
finished its file read after cors would leave the preflight `204` and the origin-guard `403` without security headers (E7-T01 rows 2
and 4). These are ROUTER middlewares, not `HttpApiMiddleware`s: they must also cover the preflight, the static web, `/uploads`, the
fallback 404 and requests no endpoint matches, which an `HttpApiMiddleware` (attached to endpoints) never sees (D6). There is no locale
middleware (P4). In this order:
1. the request log (`apps/api/src/middleware/requestLog.ts`): Hono `logger()`'s two lines (`<-- METHOD path`, `--> METHOD path STATUS
   TIME`, copy the format from `node_modules/hono/dist/middleware/logger/index.js`), the PATHNAME only, never the query (signed upload
   URLs carry `sig`; CLAUDE.md "sessions" note), off under `NODE_ENV=test`; Effect's `HttpMiddleware.logger` is off everywhere
   (`disableLogger: true`);
2. the security headers (`apps/api/src/middleware/securityHeaders.ts`): a pre-response handler on EVERY response with the literal
   header set Hono's `secureHeaders` produced with today's options (capture it from the running Hono app in E7-T01 and copy the values;
   `inlineScriptHashes` and the CSP builder unchanged, the hashes computed once at layer build from `env.webDistDir`);
3. CORS for `/api/*` (`apps/api/src/middleware/cors.ts`): Hono 4.13.7 `cors()` semantics with today's options (origin function
   `webOrigins.includes(origin) ? origin : webOrigins[0] ?? ""`, `credentials`, the methods, headers, exposed headers, `maxAge 86400`),
   answering an `OPTIONS` preflight itself with `204` and Hono's exact header values and `Vary` (copy from
   `node_modules/hono/dist/middleware/cors/index.js`), never `HttpRouter.cors` (`*` defaults, different formatting); the
   non-preflight headers go on EVERY `/api/*` response whatever its status, the boundary-rendered 401, 403, 404, 409, 422 and 429
   included, as Hono's `cors()` set them before `next()` (E7-T01 row 3);
4. the origin guard for `/api/*` (`apps/api/src/middleware/originGuard.ts`, `isForeignOrigin` unchanged): a foreign unsafe request is
   answered `errorResponse(new Forbidden({ text: "server.error.originMismatch" }))` before routing;
5. `fallbackRoutesLayer()` (same file, a route layer, not a middleware): the fallback route on the path `"*"` (registered once,
   lowest specificity; never `/*`, which `HttpRouter` would also register as the bare `""`, 1.1), added with `HttpRouter.add` once per
   EXPLICIT method `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`, never `HEAD` and never the method `"*"` (a `*`-method route enters
   the `HEAD` tree and shadows the `HEAD` → `GET` fallback, 1.1; `HEAD /` must reach the `GET` fallback and serve the shell without a
   body, as Hono's `GET` route did): with `WEB_DIST_DIR` set, a `GET`/`HEAD` the static rules of
   `apps/api/src/middleware/staticWeb.ts` accept is served (never `/api/*`, never `/uploads/*`, a missing file with an extension is
   not the shell); everything else is `errorResponse(routeUnknown(method, path))` (P7), the JSON 404 of `notFoundHandler`.
A global middleware never sees a typed failure (`effect-http-server-bun.md` §4): each answers with a response.

**P12 — The server and the lifecycle (E7, E8; E7-T11).** `apps/api/src/http/server.ts`: `HttpRouter.serve(appRoutesLayer(), {
disableLogger: true })` over `BunHttpServer.layer({ port: env.API_PORT, hostname: "0.0.0.0", maxRequestBodySize: 20 * 1024 * 1024,
gracefulShutdownTimeout: Duration.seconds(4) })` (`0.0.0.0` is what Bun's auto-serve bound; BunHttpServer's own default `"::"` would
change the bind). The option alone does NOT bound the stop (1.1: the layer scope's `server.stop()` finalizer has no timeout and waits
for a long OCR import as long as it takes), so `index.ts` bounds the interrupt itself (below). `apps/api/src/index.ts` keeps the boot and the
teardown of CLAUDE.md "One runtime, disposed on shutdown", with the server forked ON the one runtime:
boot (`!env.isTest`): `await runtime.runPromise(Effect.void)` (a database that cannot be opened fails the boot) → each module's
`start()` on the runtime (a failure logs `[api] start of module <id> failed:`, the boot continues) → the server fiber
`runtime.runFork(Layer.launch(serverLayer()))`, awaited until it listens (a bind failure fails the boot, exit 1) → the unchanged line
`[api] toon-household API on http://localhost:<port> (db: …, origins: …, mail: …, web: …)`.
SIGTERM/SIGINT (once): `[api] <signal> — stopping modules …` → interrupt the server fiber, BOUNDED: `await runtime.runPromise(Fiber.interrupt(serverFiber).pipe(Effect.timeoutOrElse({ duration:
Duration.seconds(5), orElse: () => Effect.void })))` (`Fiber.interrupt`, `Effect.timeoutOrElse` as in the vendored source; a request
still in flight after 5 s is abandoned, so the module shutdowns, the dispose and the exit always run inside Docker's 10 s stop timeout) → each module's
`shutdown()` on the runtime (a failure logs `[api] shutdown of module <id> failed:`) → `await runtime.dispose()` (`[db] database
closed`) → `[api] runtime disposed` (or `[api] runtime dispose failed:`) → `process.exit(0)`. `index.ts` must NOT `export default` an
object with `fetch` any more (Bun would auto-serve it a second time).

**P13 — The test seam is still `app.request` (E9).** `apps/api/src/http/in-memory.ts` (E7-T02) exports `inMemoryHandler(makeLayer)`,
a hoisted function returning `{ request(input, init?), fetch(request) }` over `HttpRouter.toWebHandler(layer, { memoMap, disableLogger:
true })`, built on the FIRST call (TDZ) and never disposed in tests, where:
1. the first call awaits `runtime.runPromise(Effect.void)`, so `AppLayer` sits in `appMemoMap` before anything else is built;
2. `memoMap` is a FRESH child `Layer.forkMemoMapUnsafe(appMemoMap)` per handler, so `AppLayer` is found in the parent (one database,
   one limiter, one mailer seam) while `HttpRouter.layer`, the route layers and the global middlewares are built anew for each handler
   (1.1: on the shared map every in-memory handler of the process would share one router);
3. `layer` is `makeLayer()` (the caller's route layer) assembled with `Layer.provideMerge` over `httpMiddlewareLayer()`, `AppLayer` and
   `BunHttpServer.layerHttpServices`, never `Layer.provide`: the services must be in the OUTPUT for `toWebHandler` to drop them from
   the per-request requirements (1.1), otherwise `handler(request)` demands a `context` argument and `app.request` fails `tsc`;
4. `request` resolves a relative path against `http://localhost` (Hono's `app.request`).
`apps/api/src/http/app.ts` (E7-T11) exports `appRoutesLayer()` and `app = inMemoryHandler(appRoutesLayer)`. `apps/api/src/index.ts`
re-exports `app`, so the 28 test files and the finance harness keep `import { app } from "../src/index.ts"` UNCHANGED (E9: the
`app.request` tests now run through HttpApiBuilder's in-memory handler). The bridges of P1 use `inMemoryHandler` too. Isolated tests
build mini APIs through `apps/api/test/support/http.ts` (E7-T02: `testHttpApp(apis, handlers, extra?)` → `{ request, fetch }`, an
`inMemoryHandler` over the same middleware and global layers). `apps/api/test/http-foundation.test.ts` proves the isolation: two
`testHttpApp`s over the same mini API and a third over another one, in one process, each answer their own routes, no `Method …
already declared` is thrown, and no route or global middleware of one is visible in another. `HttpApiTest` is not used: its typed
client needs the payload and success schemas P3 leaves out.

**P14 — The module contract (E7, E8; built beside the Hono mount by E7-T10, switched by E7-T11 with SPEC §2 and the module docs in
the same commit; deviation D7).** `apps/api/src/modules/types.ts` gains `householdApi?: ModuleHttpApi` and `userApi?: ModuleHttpApi`
(E7-T10; E7-T11 deletes `householdRouter` and `userRouter`), where `ModuleHttpApi = { readonly apis: ReadonlyArray<HttpApi.Any>;
readonly handlers: Layer.Layer<any, never, any> }`. The two `any`s are deliberate and explained in the type's doc comment: a contract
cannot name a module's group services, and a handler layer's requirements are middleware tags plus `HttpRouter.Request<"Requires", S>`
phantoms, not `S` (1.1). What the types give up is checked at build and by a test: `HttpApiBuilder.layer(api)` dies when a group has no
handler, a service nobody provides is a defect on first use, `moduleRoutesLayer` asserts the chains (below), and
`apps/api/test/modules.test.ts` builds the REAL `API_MODULES` through `moduleRoutesLayer` and calls one route of each module (E7-T10
case (m)), so a gap fails a test, not production. `moduleRoutesLayer(modules)` carries the one cast of the module side:
`as Layer.Layer<never, never, HttpRouter.HttpRouter>` (what it needs from the router machinery; the handler, middleware and platform
services come from the composition of P13); if the compiled `HttpApiBuilder.layer` shows a further platform requirement that the
composition provides, E7-T10 adds it to that annotation and says so in its commit.
Every household API is built with `householdModuleApi(id, api)` and every user API with `userModuleApi(id, api)` (E7-T02,
`apps/api/src/http/middleware.ts`): `householdModuleApi` prefixes `/api/households/:householdId/<id>`, annotates every group with
`ModuleId` = `<id>` and attaches `RequireModule`, `RequireHouseholdMember`, `RequireSession`, `ApiErrorBoundary` (in that attach order,
so they RUN boundary → session → member → module); `userModuleApi` prefixes `/api/<id>` and attaches `ApiErrorBoundary` only (a user
API runs `RequireSession` itself, as a `userRouter` did); `coreApi(api)` attaches `ApiErrorBoundary` to a core API. A module therefore
contributes `HttpApi`s that wrap its groups (one per route file, P2), not bare `HttpApiGroup`s: the API is where the prefix and the
module chain are attached (D7).
`apps/api/src/modules/mount.ts` keeps its file and gains `moduleRoutesLayer(modules)` (E7-T10; the Hono `mountModules` moves into the
file's Hono section, P17). It ASSERTS at layer build (`Effect.die` naming the module and the endpoint) that every household endpoint's
four outermost middlewares are boundary, session, member, module, that its path starts with the prefix and is not the bare prefix
itself, and that every user endpoint lies under `/api/<id>/`; registers each API with `HttpApiBuilder.layer(api)` and the module's
`handlers`; and registers one raw catch-all per household module, on `/api/households/:householdId/<id>/*` ONLY (`HttpRouter` registers
the bare `/api/households/:householdId/<id>` by itself for a path ending in `/*`; registering the bare path too throws `Method '…'
already declared`, 1.1), with `HttpRouter.add` once per EXPLICIT method `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`, never
`HEAD` and never the method `"*"` (so `HEAD …/recipe/shopping-lists` misses the `HEAD` tree, falls through to the `GET` tree and reaches
the real route, as Hono served `HEAD` through the `GET` handler; E7-T01 row 10). The catch-all runs the same session → member → module
checks and then answers the route-unknown 404, so an unknown path below a module still answers 401 before anything else (as Hono's
`use(\`${base}/*\`)` did). The manifest's `handlers` is `Layer.suspend(() => <id>HouseholdHandlers())` over a hoisted function in the
module's `routes/index.ts` (TDZ, P15).

**P15 — The import cycle after E7 (E7, CLAUDE.md "API import cycle").** Leaves (no import into the cycle): every `*.api.ts`,
`apps/api/src/http/{middleware,context}.ts`, `apps/api/src/modules/finance/http.ts`. A handler layer at module scope references only
`effect` exports, its leaf API and its own build function (services are yielded inside handlers); a middleware layer at module scope
references only its leaf tag (`Layer.effect(RequireSession, Effect.gen(...))`), its services yielded inside. Every list of layers the
server builds is computed in a hoisted function (`appRoutesLayer()`, `moduleRoutesLayer()`, `httpMiddlewareLayer()`,
`globalHttpLayer()`), never at module scope. `apps/api/test/import-order.test.ts` and `apps/api/test/import-order-effect.test.ts` gain
`./src/http/app.ts`, `./src/http/server.ts`, `./src/http/middleware.ts`, `./src/modules/recipe/routes/index.ts` and
`./src/modules/finance/routes/index.ts` (E7-T11); none of their entries is dropped (renamed only if the file is).

**P16 — The api-doc test reads the definitions (E8; E7-T11).** `httpApiRoutes()` (`apps/api/src/http/app.ts`) returns `METHOD path`
for every endpoint of `SystemApi`, `AuthApi`, `HouseholdsApi` and every module API (the full path after prefixes, Hono's `:name`
syntax; the module catch-alls and the fallback are not endpoints). `apps/api/test/api-doc.test.ts` replaces `app.routes` with it and keeps
every assertion, `DOC_ONLY` and the `+verified` sweep (through `app.request`). Until E7-T11 the test is untouched (P1).

**P17 — Hono leaves through marked sections, and stays out (E1, E12; E7-T12).** Until E7-T11, Hono-shaped code that must survive
sits in ONE final section per file, opened by the line `/* Hono (E7 transition): E7-T12 deletes this section */` and running to the end
of the file. The section holds its OWN imports (ES `import` declarations are hoisted and legal anywhere at module top level; the repo
has no import-order lint and `noUnusedLocals` is off): every `import … from "hono"` / `"hono/…"` line of the file, and every other
import used ONLY by the section's code. No name the section imports or declares is used above the marker; the section may use what
is declared above it, never the reverse. E7-T12 can therefore delete each section verbatim and nothing above it dangles.
`apps/api/test/hono-transition.test.ts` (E7-T02) pins it with a comment-free scan in the style of the idioms test, in two tests:
(1) in every file under `apps/api/src` that contains the marker, every `hono` import line lies below the marker, and no identifier
imported or declared below it occurs above it; (2) STRICT, behind `const STRICT = false` until E7-T11 sets it: every file under
`apps/api/src` that imports `hono` contains the marker (before E7-T11 the unconverted route files and `index.ts` import Hono without
one). Who moves what into a section (each task, the files it owns):
- E7-T02: `apps/api/src/lib/http.ts` (`json`, `created`, `noContent` over a Hono `Context`; `toIso`, `toIsoOrNull`, `parseCsvParam`
  stay above), `apps/api/src/lib/cookies.ts` (the `hono/cookie` setters and getters; the cookie names, TTLs and attribute values stay
  above and are what `apps/api/src/http/cookies.ts` reads), `apps/api/src/lib/validate.ts` (the `validate` middleware over
  `hono/validator` and `ValidationTarget`; `decode`, `decodeOrThrow`, `decodeOption`, `Decodable`, `Decoded` stay above),
  `apps/api/src/lib/locale.ts` (`localeMiddleware`, `requestLocale(c)`; `negotiateRequestLocale` above), `apps/api/src/lib/types.ts`
  (`AppVariables`, `AppEnv`, `AppContext`, `currentUser`, `currentMembership`, `requireUser`, `requireMembership`; the `Membership`
  re-export above), `apps/api/src/core/services/auth/rateLimit.ts` (`clientIp(c)`; `clientIpFrom` above), and
  `apps/api/src/lib/errors.ts` as follows. `toApiError` LOSES its `HTTPException` branch (every other line of the function
  byte-identical); the branch becomes `honoExceptionToApiError(error: HTTPException): ApiErrorFamily` in the section (body verbatim,
  comment included); `onErrorHandler` (now `error instanceof HTTPException ? honoExceptionToApiError(error) : toApiError(error, locale)`,
  then `logBoundaryFailure`, then the Hono response) and `notFoundHandler` (over `routeUnknown`) move into the section;
  `logBoundaryFailure` and `routeUnknown` (P7) stay above. After the cutover no `HTTPException` can arise (`jsonBody` maps malformed
  JSON itself, P4), so nothing replaces the branch. The HTTPException test of `apps/api/test/errors.test.ts` is retargeted onto
  `honoExceptionToApiError` in the same commit (assertions unchanged) and deleted by E7-T12 together with the code it tests.
- E7-T03: `apps/api/src/middleware/{session,household,module,verifiedEmail}.ts`; E7-T04:
  `apps/api/src/middleware/{securityHeaders,originGuard,staticWeb}.ts`; E7-T09: `apps/api/src/modules/finance/middleware.ts` (the
  `declare module "hono"` block included); E7-T10: `apps/api/src/modules/mount.ts` (`mountModules`).
- E7-T11 deletes outright, with no section, the Hono code of the files it rewrites: `apps/api/src/index.ts`, the router fields of
  `apps/api/src/modules/types.ts` and of both manifests, the Hono routers of both `routes/index.ts`, and `apps/api/src/http/bridge.ts`.
E7-T12 deletes the sections, the HTTPException test of `errors.test.ts`, `hono-transition.test.ts`, the dependency in
`apps/api/package.json` and the `bun.lock` entries (`bun install`), and switches on idioms rule (14) "no hono" in
`apps/api/test/effect-idioms.test.ts` (no `hono` / `hono/*` specifier in a scanned file, no `hono` key in a dependency section, no
`"hono"` key in `bun.lock`; empty allow list; the `PENDING_RULES` comment line for E7 removed), modelled on rule (9).

**P18 — The contract test (E8; E7-T01).** `apps/api/test/http-contract.test.ts`: a table of rows `{ id, section, method, path
(template), as (who), headers, body, expect: { status, code?, headers: { name: exact | present | absent | cookie-attribute-set } } }`
over the walkthrough of `docs/plans/m7-harden.md` §9.3 plus the header rows of section 4 (E7-T01), run through `app.request` against
the Hono app, with expected values CAPTURED from it. It passes unchanged after E7-T11 (a row that must change is a recorded deviation,
section 7). E7-T13 repeats a small live subset against the real server and the image. Rows the plan review added (E7-T01): malformed
JSON with `Content-Type: application/json` on login, cards and an import route with the `de` and `en` messages (P4), the `text/plain`
empty-body case of `recipes.ts`'s `keepOnlySentKeys` routes, CORS and security headers on error responses, `HEAD` on a module `GET`
route (P14).

**P19 — The deployment files stay (E8).** `Dockerfile` (CMD `bun apps/api/src/index.ts`, `EXPOSE 3001`, the `/api/health`
HEALTHCHECK), `docker-compose.yml`, `docker/Caddyfile` (the `X-Forwarded-For` overwrite that makes the LAST-entry read safe),
`docker/entrypoint.sh` and `.dockerignore` are not edited; `apps/api/test/deploy-*.test.ts` stay green untouched. E7-T13 proves it with
`git diff --quiet 16b104d82 HEAD -- Dockerfile docker-compose.yml docker .dockerignore`.

**P20 — The web is untouched (E11).** No file under `apps/web` changes; `docs/API.md` rows do not change; only its implementation
notes do (E7-T13).

**P21 — `runtime.ts` is unchanged (E7).** The in-memory handler and the bridges build their router layers on child memo maps of
`appMemoMap` with `AppLayer` (P13), the server through `HttpRouter.serve` (which forks the current memo map itself) run on `runtime`; `ManagedRuntime.make` stays in `apps/api/src/runtime.ts` only (idioms rule).

### 2.2 Table R — the route-file rewrite (E7-T05 to E7-T09; amended only through the `Table R amendments` header of `apps/api/src/http/middleware.ts`)

A rewrite task converts each route file `X.ts` of its list into two files: `X.api.ts` (new, the definition, a leaf) and `X.ts` (the
handlers plus the transitional bridge export). It applies ONLY the rows below; any line no row names stays byte-identical (doc comments
included, moved with their route). `<A>` is the file's API constant, `<G>` its group identifier (P2), `<H>` its handler layer name,
`<M>` its mount (Table M).

**R-A. The definition file `X.api.ts`** (template; finance adds `import { RequireFinanceParticipant } from "../http.ts";`):

```ts
/** <the route file's header comment, first paragraph only>; served at <M> (docs/API.md "<section>"). */
import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { chain, householdModuleApi, RequireHouseholdAdmin, RequireVerifiedEmail } from "../../../http/middleware.ts";

export const <G-as-PascalCase>Group = HttpApiGroup.make("<G>")
  .add(
    /** GET <full path> */
    HttpApiEndpoint.get("<name>", "<endpoint path>", { params: { householdId: Schema.String, recipeId: Schema.String } }),
    /** POST <full path> */
    HttpApiEndpoint.post("<name>", "<endpoint path>", { params: { … } }).pipe(chain(RequireHouseholdAdmin)),
    …one entry per Hono registration, IN THE FILE'S REGISTRATION ORDER, the path as written in X.ts…
  )
  .prefix("<group prefix, Table M>")       // omitted when Table M says none
  .pipe(chain(RequireVerifiedEmail));        // only when the Hono sub-router had router.use("*", …) lines, same order

export const <A> = householdModuleApi("<module id>", HttpApi.make("<G>").add(<G-as-PascalCase>Group));
//          core files: coreApi(HttpApi.make("<G>").add(…Group))   (households: .add the four groups in Table M order)
//          recipe cards: userModuleApi("recipe", HttpApi.make("recipe.cards").add(RecipeCardsGroup))
```

| Hono construct (in `X.ts`) | goes to | becomes |
| --- | --- | --- |
| `router.get(P, …)` / `.post` / `.patch` / `.put` / `.delete` | `X.api.ts` | `HttpApiEndpoint.get` / `.post` / `.patch` / `.put` / `.delete` `("<name per Table N>", "P", { params })`, `P` verbatim |
| the `:name`s of the FULL path (Table M prefix + endpoint path) | `X.api.ts` | `params: { <each name>: Schema.String }`, every one, in path order; no `params` key when the full path has none (P3) |
| per-route middleware arguments, in order | `X.api.ts` | `.pipe(chain(<tags in the same order>))` on that endpoint; `validate(…)` arguments are NOT middleware (row "validate" below) |
| `requireSession()` | `X.api.ts` | `RequireSession` |
| `optionalSession()` | `X.api.ts` | `OptionalSession` |
| `requireHouseholdRole("member")` / `requireHouseholdMember()` | `X.api.ts` | `RequireHouseholdMember` |
| `requireHouseholdRole("admin")` / `requireHouseholdAdmin()` | `X.api.ts` | `RequireHouseholdAdmin` |
| `requireHouseholdRole("owner")` / `requireHouseholdOwner()` | `X.api.ts` | `RequireHouseholdOwner` |
| `requireVerifiedEmail()` | `X.api.ts` | `RequireVerifiedEmail` |
| `requireFinanceParticipant()` | `X.api.ts` | `RequireFinanceParticipant` (from `apps/api/src/modules/finance/http.ts`) |
| `router.use("*", m1()); router.use("*", m2());` | `X.api.ts` | `.pipe(chain(M1, M2))` on the GROUP, after `.add(…)` |
| `export const xRoutes = new Hono<AppEnv>();` and the `xRoutes.use(…)` lines | `X.ts` | deleted; at the END of `X.ts`: `export const xRoutes = effectBridge(<A>, <H>, "<bridge mount, Table M>");` (same export name) |
| the registration `router.get(P, …mw, (c) => runtime.runPromise(Effect.gen(function* () { BODY })))` | `X.ts` | `.handle("<name>", Effect.fn("<G>.<name>")(function* ({ params }) { BODY }), UNINTERRUPTIBLE)` inside `export const <H> = HttpApiBuilder.group(<A>, "<G>", (handlers) => handlers .handle(…) .handle(…));`, same order; write `function* ()` when BODY uses no `params` |
| `(c) => runtime.runPromise(withImportDb(Effect.gen(function* () { BODY })))` | `X.ts` | `Effect.fn("<G>.<name>")(function* ({ params }) { BODY }, withImportDb)` |
| `validate("json", S)` (a middleware argument) + `c.req.valid("json")` | `X.ts` | first statement of BODY: `const body = yield* jsonBody(S);`, then every `c.req.valid("json")` → `body` |
| `validate("query", S)` + `c.req.valid("query")` | `X.ts` | first statement of BODY (after a `jsonBody` line if both): `const query = yield* queryParams(S);`, then `c.req.valid("query")` → `query` |
| `yield* currentMembership(c)` | `X.ts` | `yield* CurrentMembership` |
| `yield* currentUser(c)` | `X.ts` | `yield* CurrentUser` |
| `yield* currentFinanceParticipant(c)` | `X.ts` | `yield* CurrentFinanceParticipant` (from `../http.ts`) |
| `c.req.param("x")` | `X.ts` | `params.x` |
| `c.req.query("x")` | `X.ts` | `(yield* queryParam("x"))` |
| `c.req.query()` | `X.ts` | `(yield* queryRecord)` |
| `c.req.header("x")` | `X.ts` | `(yield* header("x"))` |
| `yield* Effect.promise(() => c.req.json())` | `X.ts` | `yield* rawJsonOrDie` (a malformed or empty body stays a defect, i.e. a `500`, P4) |
| `yield* Effect.tryPromise({ try: (): Promise<unknown> => c.req.json(), catch: () => E })` (the local `readJson` helpers) | `X.ts` | `yield* rawJsonOr(() => E)`, `E` VERBATIM (its `BadRequest` and its catalog key stay: `server.auth.invalidJsonBody` in `auth.ts` and `cards.ts`, `server.import.invalidJsonBody` in `imports.ts`); never `jsonBody` (its malformed-JSON refusal is the generic `server.error.requestFailed`); the helper itself follows the "local helper" row |
| `Effect.promise(() => c.req.text())` | `X.ts` | `rawText` |
| `c.req.formData()` / `c.req.raw` | `X.ts` | `(yield* webRequest).formData()` / `(yield* webRequest)` |
| `json(c, X)` / `created(c, X, L)` / `created(c, X)` / `noContent(c)` | `X.ts` | `json(X)` / `created(X, L)` / `created(X)` / `noContent()` |
| `c.redirect(U, 302)` / `c.redirect(U)` | `X.ts` | `redirect(U)` |
| `return new Response(F, { headers: H })` | `X.ts` | `return fromWeb(new Response(F, { headers: H }))` |
| `clientIp(c)` | `X.ts` | `(yield* clientIp)` |
| `requestLocale(c)` | `X.ts` | `(yield* requestLocale)` |
| `c.get("sessionId")` under `requireSession()` / under `optionalSession()` | `X.ts` | `(yield* CurrentSession).sessionId` / `(yield* MaybeSession).sessionId` |
| `c.get("user")` / `c.var.user` under `optionalSession()` | `X.ts` | `(yield* MaybeSession).user` |
| a local helper taking `c: AppContext` (a `function`, an arrow, or already an `Effect.fn` / `Effect.fnUntraced`) | `X.ts` | the `c` parameter is deleted; a helper that is not yet an Effect becomes `const f = Effect.fnUntraced(function* (…) { … })` (an existing `Effect.fn("name")` keeps its name, an existing `Effect.fnUntraced` stays one); every `c.` use inside is replaced by the rows above; each call `f(c, …)` → `yield* f(…)` (an existing `yield* f(c, …)` → `yield* f(…)`) |
| `c.req.param("x")` INSIDE a local helper (where `params` is not in scope) | `X.ts` | a NEW first parameter `x: string \| undefined` of the helper (named as the param); the line `const x = c.req.param("x");` is deleted; every call passes `params.x`. Worked example, `core/routes/modules.ts`: `const moduleIdParam = Effect.fnUntraced(function* (c: AppContext): Effect.fn.Return<ModuleId, NotFound> { const moduleId = c.req.param("moduleId"); if (!moduleId \|\| !isModuleId(moduleId)) return yield* new NotFound(); return moduleId; });` → `const moduleIdParam = Effect.fnUntraced(function* (moduleId: string \| undefined): Effect.fn.Return<ModuleId, NotFound> { if (!moduleId \|\| !isModuleId(moduleId)) return yield* new NotFound(); return moduleId; });`, and `yield* moduleIdParam(c)` → `yield* moduleIdParam(params.moduleId)` |
| a handler FACTORY `function f(arg) { return (c: AppContext) => runtime.runPromise(withImportDb(Effect.gen(function* () { BODY }))); }` registered on several routes (`imports.ts` `ocrUploadHandler`) | `X.ts` | a hoisted `function f(name: string, arg)` that returns `Effect.fn(spanName)(function* () { BODY }, withImportDb)`, `spanName` being the template literal `` `<G>.${name}` `` (in `imports.ts`: `` `recipe.imports.${name}` ``); BODY keeps its statement order (the capability guards stay BEFORE the body is read); each registration becomes `.handle("<name>", f("<name>", arg), UNINTERRUPTIBLE)`, so every endpoint keeps its own span name |
| `import { Hono } from "hono"` / `import type { Hono } …` / `import type { AppEnv, AppContext } from "…/lib/types.ts"` | `X.ts` | deleted |
| `import { runtime } from "…/runtime.ts"` | `X.ts` | deleted |
| `import { currentMembership, currentUser } from "…/lib/types.ts"` | `X.ts` | `import { CurrentMembership, CurrentUser } from "…/http/context.ts"` (the names used) |
| `import { json, created, noContent } from "…/lib/http.ts"` | `X.ts` | those names from `"…/http/response.ts"` (add `redirect`, `fromWeb` when used); `toIso`, `toIsoOrNull`, `parseCsvParam` stay imported from `lib/http.ts` |
| `import { validate } from "…/lib/validate.ts"` | `X.ts` | `import { jsonBody, queryParams } from "…/http/request.ts"` (the names used, plus `queryParam`, `queryRecord`, `header`, `rawJsonOr`, `rawJsonOrDie`, `rawText`, `webRequest`, `clientIp`, `requestLocale` when used); `decode` / `decodeOrThrow` / `decodeOption` stay imported from `lib/validate.ts` |
| middleware imports (`requireSession`, `requireHouseholdRole`, `requireVerifiedEmail`, `requireFinanceParticipant`, …) | `X.ts` | deleted (the tags are imported by `X.api.ts`) |
| `import { clientIp } from "…/rateLimit.ts"`; `import { requestLocale } from "…/lib/locale.ts"` | `X.ts` | deleted (both come from `http/request.ts`) |
| new imports of `X.ts` | `X.ts` | `import { Effect } from "effect"; import { HttpApiBuilder } from "effect/http-api"; import { UNINTERRUPTIBLE } from "…/http/middleware.ts"; import { effectBridge } from "…/http/bridge.ts"; import { <A> } from "./X.api.ts";` |

Do not reorder handlers, rename services, change a status, a catalog key, a log line or a doc comment's text; do not touch services.

### 2.3 Table M — mounts, prefixes and bridge mounts

| Route file | API (identifier) | group `.prefix(…)` in `X.api.ts` (none when empty) | prefix added by the API helper | bridge `mountedAt` (E7-T05 to T09) |
| --- | --- | --- | --- | --- |
| `apps/api/src/core/routes/auth.ts` | `AuthApi` (`auth`) | `/api/auth` | `coreApi` | `/api/auth` |
| `apps/api/src/core/routes/{households,members,invites,modules}.ts` | `HouseholdsApi` (`households`; groups `invites`, `households`, `members`, `modules` in this order) | `/api/households` on each group | `coreApi` | `/api/households` |
| `apps/api/src/modules/recipe/routes/recipes.ts` | `RecipeRecipesApi` (`recipe.recipes`) | none | `householdModuleApi("recipe", …)`: `/api/households/:householdId/recipe` | `/api/households/:householdId/recipe` |
| `apps/api/src/modules/recipe/routes/imports.ts` | `RecipeImportsApi` (`recipe.imports`) | `/imports` | same | `/api/households/:householdId/recipe/imports` |
| `apps/api/src/modules/recipe/routes/shopping.ts` | `RecipeShoppingApi` (`recipe.shopping`) | `/shopping-lists` | same | `…/recipe/shopping-lists` |
| `apps/api/src/modules/recipe/routes/plan.ts` | `RecipePlanApi` (`recipe.plan`) | `/plan` | same | `…/recipe/plan` |
| `apps/api/src/modules/recipe/routes/cards.ts` | `RecipeCardsApi` (`recipe.cards`) | `/cards` | `userModuleApi("recipe", …)`: `/api/recipe` | `/api/recipe/cards` |
| `apps/api/src/modules/finance/routes/participants.ts` | `FinanceParticipantsApi` (`finance.participants`) | `/participants` | `householdModuleApi("finance", …)`: `/api/households/:householdId/finance` | `…/finance/participants` |
| `…/finance/routes/transactions.ts` | `FinanceTransactionsApi` (`finance.transactions`) | `/transactions` | same | `…/finance/transactions` |
| `…/finance/routes/categories.ts` | `FinanceCategoriesApi` (`finance.categories`) | `/categories` | same | `…/finance/categories` |
| `…/finance/routes/tags.ts` | `FinanceTagsApi` (`finance.tags`) | `/tags` | same | `…/finance/tags` |
| `…/finance/routes/plan.ts` | `FinancePlanApi` (`finance.plan`) | `/plan` | same | `…/finance/plan` |
| `…/finance/routes/balance.ts` | `FinanceBalanceApi` (`finance.balance`) | `/balance` | same | `…/finance/balance` |
| `…/finance/routes/settlements.ts` | `FinanceSettlementsApi` (`finance.settlements`) | `/settlements` | same | `…/finance/settlements` |
| `apps/api/src/core/routes/system.ts` (E7-T10) | `SystemApi` (`system`; groups `health`, `uploads`; endpoint paths `/api/health`, `/uploads/:filename`) | none | `coreApi` | `""` (the full paths; E7-T10 registers the bridge with `app.route("/", systemRoutes)` in `apps/api/src/index.ts`, where the two inline routes stood) |

Every endpoint path is the Hono path AS WRITTEN in the route file; the group prefix and the API helper's prefix are joined by
`HttpRouter.prefixPath` (`repos/effect/packages/effect/src/http/HttpRouter.ts` line 803: a path `"/"` becomes the prefix itself, no
trailing slash, as Hono's `app.route` joined it). The group `.prefix(…)` goes right after `.add(…)` and before the group's `chain(…)`; `docs/API.md`'s rows are the
check (`api-doc.test.ts` keeps passing through the bridges because each bridge registers the same full paths). Handler layer names:
`authHandlers`, `householdsHandlers` (one layer providing the four groups: `Layer.mergeAll` of `invitesHandlers`,
`householdGroupHandlers`, `membersHandlers`, `modulesHandlers`, each in its own file), `recipesHandlers`, `importsHandlers`,
`shoppingHandlers`, `recipePlanHandlers`, `cardsHandlers`, `participantsHandlers`, `transactionsHandlers`, `categoriesHandlers`,
`financeTagsHandlers`, `financePlanHandlers`, `balanceHandlers`, `settlementsHandlers`, `systemHandlers`.

### 2.4 Table N — endpoint names

The name is the lower-case method, then each static segment of the Hono path AS WRITTEN in the route file (no prefix) in
PascalCase with `-` and `.` dropped and the next letter capitalised, a `:param` segment written `By<Param>`: `GET /` → `get`,
`GET /:recipeId` → `getByRecipeId`, `POST /:recipeId/photo` → `postByRecipeIdPhoto`, `GET /summary` (finance
transactions) → `getSummary`, `DELETE /oauth/:provider` → `deleteOauthByProvider`, `GET /:listId/items` (shopping) →
`getByListIdItems`, `GET /oauth/:provider/callback` → `getOauthByProviderCallback`. A collision inside one group (none
expected) appends `2`. The span name of the handler is `"<G>.<name>"`.

### 2.5 What the plan review changed (2026-11-05)

- **Hono sections have owners and a guard (P17).** E7-T02 owns `apps/api/src/lib/{http,errors,cookies,validate}.ts` besides
  `lib/{locale,types}.ts` and `rateLimit.ts` and moves their Hono parts into the marked final section; a section carries its own imports
  and nothing above it uses its names, pinned by `apps/api/test/hono-transition.test.ts`, so E7-T12 deletes sections verbatim.
  `toApiError` loses its `HTTPException` branch to `honoExceptionToApiError` in the section; the log lines and the route-unknown error
  become `logBoundaryFailure` / `routeUnknown`, shared by `onErrorHandler` and `ApiErrorBoundary` (P7).
- **Malformed JSON keeps each route's message (P4, Table R).** `rawJsonOr(onMalformed)` for the three local `readJson` helpers
  (`server.auth.invalidJsonBody`, `server.import.invalidJsonBody`), `rawJsonOrDie` for `recipes.ts`'s `Effect.promise(() =>
  c.req.json())` (still a 500); no bare `rawJson`. E7-T01 pins the messages in `de` and `en`.
- **Catch-alls (P11, P14).** The fallback is on `"*"` and the module catch-alls on `…/<id>/*` only, both once per explicit method but
  `HEAD`, so no duplicate registration throws and `HEAD` still reaches `GET` routes; E7-T01 adds a `HEAD` row on a module route.
- **Isolated routers (P1, P13).** Every in-memory handler (bridges, `testHttpApp`, `app`) is built by `inMemoryHandler` on a child memo
  map of `appMemoMap` after `AppLayer` is built, assembled with `Layer.provideMerge`.
- **Global middleware order (P11).** One generator registers the four global middlewares in order; never `Layer.mergeAll`.
- **Bounded shutdown (P12, D4).** `index.ts` bounds the server fiber's interrupt to 5 s; E7-T13 checks it with a request in flight.
- **Typing (P13, P14).** `ModuleHttpApi.handlers` is `Layer.Layer<any, never, any>` with build-time checks; `provideMerge` everywhere.
- **Table R.** A row for a param-reading local helper (`moduleIdParam`), a row for a handler factory (`ocrUploadHandler`); E7-T08 is
  now build tier.
- **The cutover is split.** E7-T10 (new, wave 4) builds the system API behind a bridge, the module contract fields, `moduleRoutesLayer`
  with its assertion and catch-alls, and rewrites `modules.test.ts`, while Hono still serves; E7-T11 is the switch. The old E7-T10,
  E7-T11, E7-T12 are now E7-T11, E7-T12, E7-T13.
- **Contract rows** for CORS and security headers on error responses (401, 422, the module 401, the origin-guard 403).
- **Deviations D6 and D7** recorded (section 7); ADR 0015 amends `docs/EFFECT.md` §4's E7 row and E8's wording.

## 3. Waves and file ownership

| Wave | Task | Tier | Deps | Owns (creates or edits; nobody else in the wave touches them) |
| --- | --- | --- | --- | --- |
| 1 | E7-T01 contract test on the Hono app | build | — | `apps/api/test/http-contract.test.ts` |
| 1 | E7-T02 the HTTP vocabulary | core | — | `apps/api/src/http/{context,middleware,request,response,cookies,in-memory}.ts`, `apps/api/src/lib/{locale,types,http,errors,cookies,validate}.ts`, `apps/api/src/core/services/auth/rateLimit.ts`, `apps/api/test/support/http.ts`, `apps/api/test/{http-foundation,hono-transition}.test.ts`, `apps/api/test/errors.test.ts` (the HTTPException test only), `agent-patterns/effect-http-api.md` |
| 2 | E7-T03 middleware layers and the bridge | core | T02 | `apps/api/src/middleware/{session,household,module,verifiedEmail}.ts`, `apps/api/src/http/{middleware-layer,bridge}.ts`, `apps/api/test/middleware.test.ts`, `apps/api/test/http-bridge.test.ts` (Table R amendments go to the header of `apps/api/src/http/middleware.ts`, owned by T02 in wave 1 and edited by T03 only there) |
| 2 | E7-T04 the global HTTP layer and the boundary tests | build | T01, T02 | `apps/api/src/middleware/{securityHeaders,originGuard,staticWeb,cors,requestLog}.ts`, `apps/api/src/http/global.ts`, `apps/api/test/{security,static-web,errors,validate,rate-limiter}.test.ts`, `apps/api/test/http-global.test.ts` |
| 3 | E7-T05 auth | build | T03 | `apps/api/src/core/routes/{auth.api,auth}.ts`, `apps/api/test/{auth,oauth-callback}.test.ts` |
| 3 | E7-T06 households, members, invites, modules | rewrite | T03 | `apps/api/src/core/routes/{households.api,households,members,invites,modules}.ts` |
| 3 | E7-T07 recipe: recipes, plan, cards | rewrite | T03 | `apps/api/src/modules/recipe/routes/{recipes.api,recipes,plan.api,plan,cards.api,cards}.ts` |
| 3 | E7-T08 recipe: imports, shopping | build | T03 | `apps/api/src/modules/recipe/routes/{imports.api,imports,shopping.api,shopping}.ts` |
| 3 | E7-T09 finance | rewrite | T03 | `apps/api/src/modules/finance/routes/{participants,transactions,categories,tags,plan,balance,settlements}{.api,}.ts`, `apps/api/src/modules/finance/{http,middleware}.ts`, `apps/api/test/finance-participants.test.ts` |
| 4 | E7-T10 system API and module contract behind the bridge | core | T03, T04, T07, T08, T09 | `apps/api/src/core/routes/{system.api,system}.ts`, `apps/api/src/index.ts` (the two inline routes become the system bridge), `apps/api/src/modules/{types,mount}.ts`, `apps/api/src/modules/{recipe,finance}/index.ts`, `apps/api/src/modules/{recipe,finance}/routes/index.ts`, `apps/api/test/modules.test.ts` |
| 5 | E7-T11 the cutover | core | T01, T05, T06, T10 | `apps/api/src/http/{app,server}.ts`, `apps/api/src/http/bridge.ts` (deleted), `apps/api/src/index.ts`, `apps/api/src/modules/types.ts` (the router fields), `apps/api/src/modules/{recipe,finance}/index.ts` (the router fields), `apps/api/src/modules/{recipe,finance}/routes/index.ts` (the Hono routers), the bridge export line of every route file of T05 to T10, `apps/api/test/{api-doc,import-order,import-order-effect,runtime,hono-transition}.test.ts`, `apps/api/test/http-bridge.test.ts` (deleted), `apps/api/test/http-server.test.ts`, `docs/SPEC.md` §2, `docs/modules/recipe.md`, `docs/modules/finance.md` |
| 6 | E7-T12 Hono out, idioms rule (14) | rewrite | T11 | the `/* Hono (E7 transition) … */` sections of `apps/api/src/lib/{http,types,locale,validate,errors,cookies}.ts`, `apps/api/src/middleware/{session,household,module,verifiedEmail,originGuard,securityHeaders,staticWeb}.ts`, `apps/api/src/core/services/auth/rateLimit.ts`, `apps/api/src/modules/finance/middleware.ts`, `apps/api/src/modules/mount.ts`; `apps/api/test/errors.test.ts` (the HTTPException test), `apps/api/test/hono-transition.test.ts` (deleted); `apps/api/package.json`, `bun.lock`, `apps/api/test/effect-idioms.test.ts` |
| 7 | E7-T13 integration | build | all | `CLAUDE.md`, `docs/API.md` (implementation notes only), `docs/EFFECT.md` (E8 "as built", and the §4 E7 row and E8 wording through ADR 0015), `docs/open-work.md`, `docs/adr/0015-*.md`, `agent-patterns/effect-http-{api,server-bun}.md` §7, this plan sections 9 and 10 |

Merge order inside a wave is the id order. Shared files, each edited in different waves only: `apps/api/src/index.ts` (E7-T10 two lines,
E7-T11 the rewrite); `apps/api/src/modules/{types,mount}.ts`, both manifests and both `routes/index.ts` (E7-T10 adds, E7-T11 removes the
Hono side; `mount.ts`'s section goes in E7-T12); `apps/api/test/errors.test.ts` (E7-T02 one test, E7-T04 the Hono app parts, E7-T12 one
test); `apps/api/test/hono-transition.test.ts` (E7-T02 creates, E7-T11 sets `STRICT`, E7-T12 deletes). `apps/api/src/runtime.ts` is not
edited (P21); `package.json` / `bun.lock` only by E7-T12; `CLAUDE.md` only by E7-T13 (no task before it deletes or renames a file
CLAUDE.md names: `middleware/*.ts`, `lib/*.ts`, `modules/{index,types,mount}.ts` all stay); `docs/SPEC.md` and the module docs only by
E7-T11.

## 4. Tasks

Every task: read `docs/EFFECT.md` §1 (E8, E9, E12 at least), `repos/effect/LLMS.md` once (whole; "HttpApi" carefully), this plan's
sections 1 and 2, and the CLAUDE.md gotchas "Middleware chain order is load-bearing", "API import cycle: read the registry inside
functions, declare handlers as functions", "Middleware factories are TDZ-safe", "The error family and the one boundary mapper",
"Catch-all stays catch-all", "Validation details come from the wire-issue vocabulary", "Cross-household guard (D8)". Commit per task,
message body naming the EFFECT.md decision and this plan's P-numbers, ending with the harness's `Co-Authored-By` line. `git status
--porcelain repos/` is empty after every task. Long commands go to the background with a log ending `exit=$?`.

### E7-T01 — The contract test, captured from the Hono app (build)

**Goal.** `apps/api/test/http-contract.test.ts`, the table-driven contract of P18, green against today's Hono app; it is the oracle
E7-T11 must pass UNCHANGED.

**Read.** `docs/plans/m7-harden.md` §9.3 (the walkthrough), `docs/API.md` "Conventions", "Middleware chain and mount order",
"Security" (all four subsections), "Health", "Auth", "Households", "Members and placeholders", "Invites and claim invites", "Modules",
"Uploads and signed URLs", the finance "Transactions" and "Settlements" rows, recipe "Imports" (the `source` row); the fixture helpers
of `apps/api/test/support/finance-harness.ts` (`createUser`, `createHousehold`, cookies), `apps/api/test/core-walkthrough.test.ts`,
`apps/api/test/verified-email-gate.test.ts` (the `setVerifiedEmailRequired` seam), `apps/api/test/import/routes.test.ts` (how a draft
with a source file is made), `apps/api/src/index.ts` (cors options, the uploads route), `apps/api/src/middleware/securityHeaders.ts`,
`apps/api/src/lib/cookies.ts`, `apps/api/src/config.ts` (what `webOrigins` is under `NODE_ENV=test`).

**Rows** (each a table entry; the expected values are what the Hono app answers today, captured by running the test and then written
into the table as literals; an observed value that contradicts a `docs/API.md` row is reported in the commit, never "fixed" here):
1. Health: `GET /api/health` 200 `content-type` exact; `HEAD /api/health` 200, empty body.
2. Security headers on `GET /api/health`, on `GET /api/nope` (404) and on an `OPTIONS` preflight: the COMPLETE list of
   security-header names and exact values (CSP, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`,
   `Cross-Origin-Resource-Policy`, `Cross-Origin-Opener-Policy`, `Origin-Agent-Cluster`, `X-DNS-Prefetch-Control`,
   `X-Download-Options`, `X-Permitted-Cross-Domain-Policies`, `X-XSS-Protection`, any other Hono `secureHeaders` emits), and ABSENT
   `Strict-Transport-Security`, `Permissions-Policy`, `X-Powered-By`.
3. CORS: preflight `OPTIONS /api/auth/login` with a `WEB_ORIGIN` origin, `Access-Control-Request-Method: POST`,
   `Access-Control-Request-Headers: content-type` → status and every `Access-Control-*` header and `Vary` exactly; the same preflight
   from a foreign origin; a simple `GET /api/health` with a trusted `Origin` (`Access-Control-Allow-Origin`, `-Credentials`,
   `-Expose-Headers`, `Vary`). The same CORS headers on ERROR responses to the trusted `Origin`, each row asserting
   `Access-Control-Allow-Origin`, `-Allow-Credentials`, `-Expose-Headers`, `Vary` AND the full security-header set of row 2:
   `GET /api/auth/me` without a cookie (401); `POST /api/households` with a session and an invalid JSON body (422);
   `GET /api/households/<id>/recipe/nope` without a cookie (401); the origin-guard 403 of row 4 from a foreign `Origin` (whatever Hono
   sends there, e.g. `Access-Control-Allow-Origin` = `webOrigins[0]`, captured, not assumed). The dev web app (`:5173` calling `:3001`
   with credentials) reads a 401 and a 422 only because of these headers.
4. Origin guard: `POST …/finance/transactions` with `Origin: https://evil.example` → 403 `forbidden`; with `Sec-Fetch-Site:
   cross-site` → 403; with the trusted origin → 201.
5. Auth: login 200 with `Set-Cookie` `toon_session` (attribute SET: `HttpOnly`, `Path=/`, `SameSite=Lax`, `Max-Age` within ±5 s of
   30 days, no `Secure` under test); wrong password 401 `invalid_credentials`; login body sent as `text/plain` → the status and code
   today's `readJson` gives; a MALFORMED body with `Content-Type: application/json` → 400 `bad_request` with the exact `de` (default)
   and `en` (`Accept-Language: en`) messages of `server.auth.invalidJsonBody`; `GET /api/auth/me` 200 / without cookie 401 `unauthorized` / with a stale cookie 401 plus the clearing
   `Set-Cookie` (`Max-Age=0`, same `Path`, `HttpOnly`, `SameSite`); logout 204 with the clearing cookie; `GET /api/auth/sessions` 200;
   register 201 with a session cookie.
6. Households: list 200; detail 200; unknown id 404; non-member 403; `POST /api/households` 201 with `Location:
   /api/households/<id>`; the same POST with a `text/plain` body → 422 `validation_failed` (the schema saw `{}`); with
   `Content-Type: application/json` and a malformed body → 400 `bad_request`.
7. Members and invites: members 200; invites as admin 200, as member 403; `GET /api/households/invites/nope` 404 and its code;
   `POST …/members` (placeholder) 201 with `Location`.
8. Modules: `DELETE …/modules/finance` 204 twice; `GET …/finance/balance` 404 `module_disabled`; `POST …/modules/finance` 200; the
   POST as a plain member 403.
9. Uploads: `GET /uploads/nope.jpg` (unsigned) 404 with today's body and content type.
10. Recipe: `GET …/recipe/recipes?limit=1` 200; `…/recipe/shopping-lists` 200; `GET /api/recipe/cards` 200 / without cookie 401;
    the import source `GET …/recipe/imports/:draftId/source` 200 with `Content-Type`, `Cache-Control` and `Content-Disposition:
    inline; filename="…"` exact (a draft made as `apps/api/test/import/routes.test.ts` makes one; if no helper reaches it within the
    task's time, record why in the commit and keep the row as `todo`-free prose in the file header for E7-T11 to add).
    Malformed JSON keeps each route's own message (P4): `POST /api/recipe/cards` with a malformed body and `Content-Type:
    application/json` → 400 with the `server.auth.invalidJsonBody` messages in `de` and `en`; `POST …/recipe/imports/text` likewise →
    400 with the `server.import.invalidJsonBody` messages in `de` and `en`; each of the two `recipes.ts` routes that call
    `keepOnlySentKeys(c.req.valid("json"), … c.req.json() …)` with `Content-Type: text/plain` and an EMPTY body → the status and code
    Hono gives today (expected `500 internal_error`, the defect of `Effect.promise`; captured, not assumed). `HEAD
    …/recipe/shopping-lists` as a member → 200 with an empty body (P14: the module catch-alls must not shadow `HEAD` → `GET`).
11. Finance: balance 200 as a participant; balance and transactions as a member without a slot 403 `finance_not_participant` (German
    message by default); participants as that member 200; `POST …/transactions` with a `mutationId` 201 with `Location`, the same body
    again 200 with the same id; `amountCents: 0` 422 `transaction_amount_zero`; `POST …/settlements` with a stale
    `expectedBalanceCents` 409 `balance_stale`.
12. Unknown routes: `GET /api/nope` 404 `not_found` whose message names `GET /api/nope`; `GET …/recipe/nope` without a cookie 401,
    as a non-member 403, as a member 404 `not_found`; `PUT …/recipe/recipes` (no such method) as a member 404.
13. The verified-e-mail gate: with `setVerifiedEmailRequired(true)`, an unconfirmed owner's `POST …/recipe/recipes` (no body) 403
    `email_unverified`, its `GET …/recipe/recipes` 200 (restore the seam in `afterAll`).
14. Query semantics: one documented route whose query schema takes a repeated key as an array (find one in `docs/API.md`; if none
    exists, a row asserting a repeated scalar key is refused or first-wins exactly as today).

**Acceptance.** One `describe` per section, one `test` per row named `<id> <METHOD> <path> -> <status>`; every expected value a
literal in the table; the file builds its own users and households (no reliance on another test file's rows) and restores every
seam it flips; `bun test apps/api/test/http-contract.test.ts` green; no file outside the test changes.

### E7-T02 — The HTTP vocabulary: context, tags, chain, request, response, cookies, the boundary (core)

**Goal.** Everything the route rewrites and the middleware layers stand on, in new LEAF-safe files, proven by unit tests over a mini
API; nothing wired into the Hono app yet.

**Read.** `agent-patterns/effect-http-api.md`, `agent-patterns/effect-http-server-bun.md`, `agent-patterns/effect-errors.md`,
`agent-patterns/effect-services.md`, `agent-patterns/effect-testing.md`; `repos/effect/packages/effect/HTTPAPI.md` ("Middlewares",
"Interdependent Middleware", "Redirects", "Catch-All Endpoints"), `repos/effect/ai-docs/src/51_http-server/{10_basics,20_testing}.ts`
and `fixtures/`; source: `repos/effect/packages/effect/src/http-api/{HttpApiBuilder,HttpApiMiddleware,HttpApiEndpoint,HttpApiGroup,HttpApi}.ts`,
`internal/path.ts`, `repos/effect/packages/effect/src/http/{HttpRouter,HttpServerRequest,HttpServerResponse,HttpEffect,Cookies,HttpServer}.ts`,
`repos/effect/packages/platform/bun/src/BunHttpServer.ts`; repo: `apps/api/src/lib/{errors,validate,cookies,locale,types,http}.ts`,
`apps/api/src/core/services/auth/rateLimit.ts`, `apps/api/src/middleware/session.ts` (what the cookie code must do), `apps/api/src/index.ts`,
`node_modules/hono/dist/validator/validator.js` (the JSON content-type regex, the query shape), `node_modules/hono/dist/helper/cookie/index.js`
and `node_modules/hono/dist/utils/cookie.js` (the attribute set). Decisions P3 to P10, P13, P15.

**Do.**
1. `apps/api/src/http/context.ts`: `CurrentUser`, `CurrentSession`, `MaybeSession`, `CurrentMembership` (`Context.Service` classes, P5);
   move `Membership` here, `apps/api/src/lib/types.ts` re-exports it.
2. `apps/api/src/http/middleware.ts` (a leaf, P15): the tags of P5 (`HttpApiMiddleware.Service`, with `provides` / `requires` as P5
   says), the `ModuleId` group annotation, `chain` (P6), `UNINTERRUPTIBLE`, `coreApi`, `householdModuleApi`, `userModuleApi` (P14).
   Prove P6 by a test before relying on it.
3. `apps/api/src/http/request.ts` (P4): `jsonBody`, `queryParams`, `queryParam`, `queryRecord`, `header`, `rawText`, `webRequest`,
   `rawJsonOr(onMalformed)`, `rawJsonOrDie` (no bare `rawJson`), `clientIp`, `requestLocale`; `clientIpFrom` extracted into
   `rateLimit.ts` (the Hono `clientIp(c)` delegates to it), `negotiateRequestLocale` added to `apps/api/src/lib/locale.ts`.
4. `apps/api/src/lib/errors.ts`, Hono-free part first: extract `logBoundaryFailure({ method, path, error, apiError })` (the three log
   branches of `onErrorHandler`, verbatim) and `routeUnknown(method, path)`; `onErrorHandler` and `notFoundHandler` call them.
5. `apps/api/src/http/response.ts` (P7, P10): the helpers, `errorResponse`, `ApiErrorBoundaryLayer` (logging through
   `logBoundaryFailure`, never a copied line).
6. `apps/api/src/http/cookies.ts` (P8), reading the names, TTLs and attribute values from `apps/api/src/lib/cookies.ts` (export them
   if they are not exported).
7. The Hono sections of P17 in `apps/api/src/lib/{http,errors,cookies,validate,locale,types}.ts` and `rateLimit.ts`, exactly as P17
   lists them, each with its own imports below the marker; in `lib/errors.ts` the `toApiError` split (P17), and in
   `apps/api/test/errors.test.ts` ONLY the HTTPException test retargeted onto `honoExceptionToApiError` (its assertions unchanged, its
   name may say so).
8. `apps/api/test/hono-transition.test.ts` (P17): the two tests, test (2) behind `const STRICT = false` with a comment naming E7-T11;
   a failure prints `file:line: identifier` in the idioms test's style.
9. `apps/api/src/http/in-memory.ts`: `inMemoryHandler(makeLayer)` (P13: warm-up, child memo map, `Layer.provideMerge`, lazy).
10. `apps/api/test/support/http.ts`: `testHttpApp(apis, handlers, extra?)` over `inMemoryHandler` (P13).
11. `apps/api/test/http-foundation.test.ts`: over a mini API, at least: P6 order (three recording middlewares attached through `chain`
   run in the listed order; endpoint, group and API chains nest as P6 says); every family member, a `Schema.SchemaError` (422 with
   `details` in de and en), a `DatabaseError` and a defect through `ApiErrorBoundary` (status, body, `Retry-After`, the log lines via a
   console spy, equal to what `onErrorHandler` logs for the same value); `jsonBody` with no content type (`{}` decoded), `text/plain`,
   malformed JSON (400 `bad_request`, `server.error.requestFailed`), a valid body read twice (`jsonBody` + `rawJsonOrDie`);
   `rawJsonOr` fails with exactly the caller's refusal (status, code, `de` and `en` message of `server.import.invalidJsonBody`);
   `rawJsonOrDie` on an empty `text/plain` body is a `500 internal_error`; `queryParams` with a repeated key (array) and `queryParam`
   (first value); `params` with a full-path schema matches and a partial one does not (documents 1.1's `::` fact); a cookie set before
   a failure is on the error response with the P8 attributes; `clientIp` header precedence; `requestLocale`; the isolation of P13
   (two `testHttpApp`s over the same mini API, then a third over another, in one process: each answers its routes, nothing throws
   `Method … already declared`, no route or global middleware leaks); `UNINTERRUPTIBLE` handler finishes when the request is
   interrupted (if observable in-memory, else document why not).
12. Fix `agent-patterns/effect-http-api.md` §6's order bullet (P6, cite `HttpApiBuilder.ts` `applyMiddleware`).
If a P4 to P10 name or call shape cannot be built as written, choose the closest, record it in the commit and under `Table R
amendments` in the header comment of `apps/api/src/http/middleware.ts`.

**Acceptance.** The files exist with the names of P4 to P8, P13 and Table R; `http-foundation.test.ts` and `hono-transition.test.ts`
green; `errors.test.ts` green with only the HTTPException test changed; `toApiError` has no `HTTPException` branch and the one
`instanceof HTTPException` of `lib/errors.ts` sits below the marker; the Hono app untouched in behaviour (full `bun test` green, pass
count ≥ 14993); no `.api.ts` exists yet; idioms test green.

### E7-T03 — The middleware layers and the bridge (core)

**Goal.** The `HttpApiMiddleware` implementations of P5 and the transitional `effectBridge` of P1, with `middleware.test.ts`
rewritten onto them (every case kept), so the route rewrites can start.

**Read.** As E7-T02, plus `apps/api/src/middleware/{session,household,module,verifiedEmail}.ts` (the semantics to port),
`apps/api/src/core/services/auth/{sessions,users,verifiedEmail}.ts`, `apps/api/src/core/services/households/membership.ts`,
`apps/api/test/middleware.test.ts` (every case), `apps/api/test/verified-email-gate.test.ts`, `apps/api/src/modules/mount.ts`,
`apps/api/src/runtime.ts` (`AppLayer`, `appMemoMap`), the E7-T02 files. Decisions P1, P5, P6, P13, P15, P17.

**Do.**
1. In each of `apps/api/src/middleware/{session,household,module,verifiedEmail}.ts`: the Effect layer of its tag(s) (`RequireSessionLayer`,
   `OptionalSessionLayer`, `RequireHouseholdMemberLayer`/`AdminLayer`/`OwnerLayer`, `RequireModuleLayer`, `RequireVerifiedEmailLayer`)
   with today's semantics and catalog keys (P5); the shared Effect logic (`resolveMembership`, `householdIdOfResource`, the module
   check, `assertVerified`) is reused, not copied; the Hono factories move unchanged into the file's Hono section (P17: the section carries
   its own `hono` imports; `hono-transition.test.ts` stays green). The
   session renewal and stale-cookie clearing use `apps/api/src/http/cookies.ts`.
2. `apps/api/src/http/middleware-layer.ts`: `httpMiddlewareLayer()` (hoisted function) merging the core middleware layers and
   `ApiErrorBoundaryLayer`.
3. `apps/api/src/http/bridge.ts`: `effectBridge(api, handlers, mountedAt): Hono<AppEnv>` (P1): registers each endpoint of `api` (method,
   full path minus `mountedAt`, `"/"` when equal) in the API's group and endpoint order; forwards `c.req.raw`; the web handler built
   once, lazily, with `appMemoMap`, `AppLayer`, `httpMiddlewareLayer()`, `BunHttpServer.layerHttpServices`, `disableLogger: true`;
   returns the Effect response as is (its `Set-Cookie` and headers kept; Hono's own middlewares still decorate it). The web handler is
   `inMemoryHandler(() => HttpApiBuilder.layer(api) with handlers …)` (P13: child memo map of `appMemoMap` after `AppLayer` is built,
   `Layer.provideMerge` over `httpMiddlewareLayer()`, `AppLayer`, `BunHttpServer.layerHttpServices`), never `toWebHandler` with the
   shared `appMemoMap`.
4. `apps/api/test/middleware.test.ts` rewritten onto a mini API through `testHttpApp` (P13): every existing case kept with its
   assertion (the CHAIN ORDER cases included: no cookie 401 first; a non-member of a household with no module row 403, not
   `module_disabled`; unknown household 404 `not_found`; `module_disabled` German by default; another module's row does not enable
   this one; the user API at `/api/<id>/…` needs its own session; the verified gate on POST and not on GET, off when the gate is off),
   plus: a stale cookie clears with the P8 attributes; a renewal sets the cookie on the response.
5. `apps/api/test/http-bridge.test.ts`: a mini API bridged into a mini Hono app: status, body, `Location` and `Set-Cookie` pass
   through; an unknown path under the bridge mount answers the Hono app's own 404; `app.routes` lists the bridged `METHOD path`s; two
   bridges of two different mini APIs in one Hono app, plus a third bridge of the first API in a second Hono app, each answer their own
   routes (no shared router, P13).

**Acceptance.** `middleware.test.ts` has at least its old number of tests, all green; `http-bridge.test.ts` green; full `bun test`
green, pass count ≥ 14993; typecheck; idioms test.

### E7-T04 — The global HTTP layer and the boundary tests (build)

**Goal.** P11 as Effect code (request log, security headers, CORS, origin guard, fallback), proven against the values E7-T01 captured
from Hono, and the five tests that built Hono apps around these pieces rewritten onto the new ones.

**Read.** As E7-T02, plus `apps/api/src/middleware/{securityHeaders,originGuard,staticWeb}.ts`, `apps/api/src/index.ts` (cors
options, the order), `node_modules/hono/dist/middleware/{cors,logger,secure-headers}/index.js` (the exact behaviour to copy, read
BEFORE E7-T12 removes the package), `apps/api/test/{security,static-web,errors,validate,rate-limiter}.test.ts`, `docs/API.md`
"Security" (all subsections), the E7-T01 rows 2, 3, 4, 12 (when merged; otherwise run E7-T01's capture locally, read-only). Decisions
P4, P7, P11, P13, P17.

**Do.**
1. `apps/api/src/middleware/securityHeaders.ts`: an Effect global middleware (pre-response handler) with the literal header set;
   `inlineScriptHashes` and the CSP builder unchanged; the Hono `securityHeaders` moves into the Hono section.
2. `apps/api/src/middleware/cors.ts` (new): Hono's cors semantics (P11.3), preflight answered with 204.
3. `apps/api/src/middleware/originGuard.ts`: the Effect global middleware (`isForeignOrigin` unchanged; the request host from the full
   URL, P4); the Hono `originGuard` to the Hono section.
4. `apps/api/src/middleware/requestLog.ts` (new): P11.1.
5. `apps/api/src/middleware/staticWeb.ts`: the Effect fallback (P11.5) reusing the file's resolution logic; `webAppMiddleware` to the
   Hono section.
6. `apps/api/src/http/global.ts`: `globalHttpLayer()` (hoisted): ONE `Layer.effectDiscard(Effect.gen(...))` that prepares the hashes
   and the cors options and then registers 1 to 4 with `router.addGlobalMiddleware`, one after the other, in P11's order (never
   `Layer.mergeAll`, never four `HttpRouter.middleware(…, { global: true })` layers); `fallbackRoutesLayer()` (5): the path `"*"`, one
   `HttpRouter.add` per explicit method `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`, never `HEAD`, never the method `"*"`.
   Each moved Hono export goes into its file's Hono section with its own imports (P17).
7. Tests: `security.test.ts` and `static-web.test.ts` rewritten onto `testHttpApp` with `globalHttpLayer()` (every case kept: the CSP
   with and without a built index, the hashes, `/api` and `/uploads` never shadowed, the extension rule, HEAD, the `clientIp` cases
   through `clientIp`); `errors.test.ts` (its Hono parts: `Retry-After` on 429, the 501 `ApiFailure`, the locale, the
   HTTPException-400 case becomes the malformed-JSON case of `jsonBody`), `validate.test.ts` (the `validate` middleware cases onto
   `jsonBody` / `queryParams`, the typed-result case onto the decoded type), `rate-limiter.test.ts` (its Hono route onto a mini API);
   `apps/api/test/http-global.test.ts` (new): the preflight and simple-request CORS headers, the security header set on a 200, a 404 and
   a preflight, the origin guard rows, the request log format (a console spy; pathname only, never the query), each value equal to
   the E7-T01 literal; the security headers AND the CORS headers on a boundary-rendered 401 and 422 and on the origin-guard 403; the
   order still holds when the security headers are prepared from a real `index.html` file (the preflight 204 and the origin-guard 403
   carry them); `HEAD` on an unknown non-API path reaches the `GET` fallback (the shell without a body, or the JSON 404 status).
   `errors.test.ts`: the "through a tiny Hono app" cases move onto `ApiErrorBoundary` through `testHttpApp`; the HTTPException test
   E7-T02 retargeted stays as it is (E7-T12 deletes it).

**Acceptance.** Every rewritten file keeps at least its old test count and every assertion; the header values equal E7-T01's
captured literals; full `bun test` green, pass count ≥ 14993; typecheck; idioms test.

### E7-T05 — Auth onto `AuthApi` (build)

**Goal.** `apps/api/src/core/routes/auth.ts` (23 routes) served by `AuthApi` through the bridge at `/api/auth`, every auth test
unchanged and green; the two Hono mini apps of `auth.test.ts` and `oauth-callback.test.ts` rewritten onto `testHttpApp`.

**Read.** Table R, Table M, Table N, P4, P7, P8, P9; `apps/api/src/core/routes/auth.ts` whole, `apps/api/src/lib/{cookies,oauth}.ts`,
`apps/api/src/core/services/auth/*.ts` (signatures only), `docs/API.md` "Auth", "Password reset", "E-mail verification", "Rate limits",
"Client IP"; CLAUDE.md "Catch-all stays catch-all" (the OAuth callback must never use `Effect.catch`: a defect is the redirect with
`oauth_failed`), "Placeholders and claim invites", "Core hardening from `1715207`"; `apps/api/test/{auth,oauth-callback,password-reset,
verified-email-gate,placeholders,core-walkthrough,http-contract}.test.ts`.

**Do.** Apply Table R to `auth.ts` (the file is build tier because of `readJson` (content type required: keep its exact refusal;
`readJson` keeps its shape: the content-type check through `header("content-type")`, the parse through `rawJsonOr(() => new
BadRequest({ text: "server.auth.invalidJsonBody" }))`, then `decode`; it never becomes `jsonBody`, whose malformed-JSON message is the
generic one), `fingerprint(c)` (the "local helper" row: `clientIp` and `header("user-agent")`), the cookies through
`apps/api/src/http/cookies.ts`,
the OAuth start/callback redirects and cookies, `optionalSession` routes reading `MaybeSession`, `clearSessionCookie` when the
revoked session is the caller's); `auth.api.ts` with `AuthApi`; `export const authRoutes = effectBridge(AuthApi, authHandlers,
"/api/auth")`. Rewrite the `guarded` mini app of `auth.test.ts` and the callback mini app of `oauth-callback.test.ts` (keep each
assertion, including the redirect `Location`s and that a defect redirects with `oauth_failed`).

**Acceptance.** No `hono` import left in `auth.ts`; `oauth-callback.test.ts` imports the OAuth cookie helpers from
`apps/api/src/http/cookies.ts`, not from `lib/cookies.ts`'s Hono section; every auth test file green unchanged (except the two rewritten
mini apps); the contract's malformed-JSON login row green;
`http-contract.test.ts` green; full `bun test` ≥ 14993.

### E7-T06 — Households, members, invites, modules onto `HouseholdsApi` (rewrite)

**Goal.** The 17 routes of the one `/api/households` router served by `HouseholdsApi` (four groups) through one bridge, by Table R.

**Read.** Table R, Table M (the households row: group order `invites`, `households`, `members`, `modules`; each group `.prefix("/api/households")`),
Table N; `apps/api/src/core/routes/{households,members,invites,modules}.ts`; `docs/API.md` "Households", "Members and placeholders",
"Invites and claim invites", "Modules".

**Do (only these, file by file).**
- `invites.ts`: `registerInviteRoutes(router)` becomes `export const invitesHandlers = HttpApiBuilder.group(HouseholdsApi, "invites", …)`
  (Table R rows), handlers in the file's order; the function `registerInviteRoutes` is deleted.
- `members.ts`: likewise `membersHandlers` (group `members`); `registerMemberRoutes` deleted.
- `modules.ts`: likewise `modulesHandlers` (group `modules`); `registerModuleRoutes` deleted. Its `c.req.text()` helper follows the
  "local helper" and `rawText` rows; `moduleIdParam` follows the param-reading helper row (its worked example is this file).
- `households.ts`: its own routes become `householdGroupHandlers` (group `households`); the `register…Routes(householdRoutes)` calls are
  deleted; at the end: `export const householdsHandlers = Layer.mergeAll(invitesHandlers, householdGroupHandlers, membersHandlers,
  modulesHandlers);` and `export const householdRoutes = effectBridge(HouseholdsApi, householdsHandlers, "/api/households");`.
- `households.api.ts`: the four groups (`InvitesGroup`, `HouseholdsGroup`, `MembersGroup`, `ModulesGroup`), each `.prefix("/api/households")`,
  and `export const HouseholdsApi = coreApi(HttpApi.make("households").add(InvitesGroup, HouseholdsGroup, MembersGroup, ModulesGroup));`.
Nothing else changes; doc comments move with their routes.

**Acceptance.** `grep -n 'hono' apps/api/src/core/routes/{households,members,invites,modules}.ts` prints nothing; every households,
members, invites, modules, placeholders and claim test green unchanged; full `bun test` ≥ 14993; typecheck.

### E7-T07 — Recipe: recipes, plan, cards (rewrite)

**Goal.** `recipes.ts` (root of the recipe household mount), `plan.ts` (`/plan`) and the user-scoped `cards.ts` (`/api/recipe/cards`)
on their APIs through bridges, by Table R.

**Read.** Table R, Table M (the three rows), Table N; `apps/api/src/modules/recipe/routes/{recipes,plan,cards,index}.ts`;
`docs/modules/recipe.md` section 4 (the gotchas; none of them may change), `docs/API.md` "Recipes", "Meal plan", "Saved cards".

**Do.** Apply Table R to each file; `recipes.api.ts` (`RecipeRecipesApi`, no group prefix, group chain `RequireVerifiedEmail`),
`plan.api.ts` (`RecipePlanApi`, group prefix `/plan`, group chain `RequireVerifiedEmail`), `cards.api.ts` (`RecipeCardsApi` =
`userModuleApi("recipe", …)`, group prefix `/cards`, group chain `RequireSession, RequireVerifiedEmail`); the bridge exports keep the
names `recipeRoutes`, `planRoutes`, `cardRoutes` (Table M mounts). `routes/index.ts` is NOT edited. `recipes.ts`'s two `keepOnlySentKeys(
c.req.valid("json"), yield* Effect.promise(() => c.req.json()), …)` become `keepOnlySentKeys(body, yield* rawJsonOrDie, …)` (still a 500 on an empty `text/plain` body; never `rawJsonOr`);
`cards.ts`'s local `readJson` follows the `rawJsonOr` and "local helper" rows, keeping `new BadRequest({ text:
"server.auth.invalidJsonBody" })` verbatim; its photo
upload reads `(yield* webRequest).formData()` inside the existing `Effect.promise`.

**Acceptance.** No `hono` import in the three files; `recipes`, `recipes-cooked`, `recipes-search`, `tags-kind`, `plan`, `cards`,
`recipe-cross-household`, `recipe-remote-image`, `uploads`, `web-contract-core-recipe`, `api-doc`, `http-contract` (the cards
malformed-JSON row and the two `text/plain` rows) tests green unchanged; full `bun test`
≥ 14993; typecheck.

### E7-T08 — Recipe: imports, shopping (build)

**Goal.** `imports.ts` (`/imports`) and `shopping.ts` (`/shopping-lists`) on their APIs through bridges, by Table R. Build tier because
`imports.ts` combines every special row of Table R: `withImportDb` as an `Effect.fn` argument, a handler factory registered on three
routes, a local JSON reader with its own catalog key, the multipart upload and a `Response` passed through.

**Read.** Table R (all rows, the factory and `rawJsonOr` rows in particular), Table M, Table N; `apps/api/src/modules/recipe/routes/{imports,shopping}.ts`;
`docs/modules/recipe.md` section 4 ("Import route tests use real sessions.", "The shopping list outbox is wired through the manifest.",
the import gotchas); `docs/API.md` "Imports", "Shopping lists"; CLAUDE.md "Bridges until E3 to E5" (`enforceRateLimit` is synchronous:
keep every call as it is); `apps/api/test/import/*.test.ts` (what pins the guard order and the 501s).

**Do.** Apply Table R. `imports.ts`:
- every `runtime.runPromise(withImportDb(Effect.gen(…)))` → `Effect.fn("recipe.imports.<name>")(…, withImportDb)`;
- `ocrUploadHandler(accept)` by the factory row: `function ocrUploadHandler(name: string, accept: readonly ImportFileKind[])` returning
  `Effect.fn(spanName)(function* () { … }, withImportDb)` with `spanName` = `` `recipe.imports.${name}` ``, its body in today's statement order (the up-front
  capability guard and the rate limit BEFORE `files.readUploadedFile(yield* webRequest, { accept })`, the precise guard after it), and
  the three registrations `.handle("postImage", ocrUploadHandler("postImage", ["image"]), UNINTERRUPTIBLE)`,
  `.handle("postPdf", ocrUploadHandler("postPdf", ["pdf"]), UNINTERRUPTIBLE)`, `.handle("postFile", ocrUploadHandler("postFile",
  ["image", "pdf"]), UNINTERRUPTIBLE)` in the file's order, each endpoint in `imports.api.ts` with its doc comment;
- the local `readJson` by the `rawJsonOr` row, keeping `new BadRequest({ text: "server.import.invalidJsonBody" })` verbatim (never
  `jsonBody`, never the generic message);
- the source route's `return new Response(file, { headers })` → `return fromWeb(new Response(file, { headers }))` (headers
  byte-identical);
- `decode(ImportDraftListQuerySchema, c.req.query())` → `decode(ImportDraftListQuerySchema, yield* queryRecord)`.
`shopping.ts`: `parseSinceQuery(c.req.query("since"))` → `parseSinceQuery(yield* queryParam("since"))`. Bridge exports keep
`importRoutes`, `shoppingRoutes`.

**Acceptance.** No `hono` import in the two files; `apps/api/test/import/*.test.ts` (the 501 and guard-order cases included),
`shopping`, `shopping-bought`, `shopping-from-plan`, `recipe-cross-household`, `web-contract-core-recipe`, `http-contract` (the
imports malformed-JSON row in `de` and `en`, the source row, the `HEAD` shopping row) green unchanged; three distinct span names for the
three upload endpoints; full `bun test` ≥ 14993; typecheck.

### E7-T09 — Finance onto its APIs (rewrite)

**Goal.** The seven finance route files on their APIs through bridges, `RequireFinanceParticipant` as an `HttpApiMiddleware`, by
Table R; the probe of `finance-participants.test.ts` onto `testHttpApp`.

**Read.** Table R, Table M (finance rows), Table N; `apps/api/src/modules/finance/{middleware.ts,routes/*.ts}`;
`docs/modules/finance.md` section 4 (every gotcha; "Finance TS identifiers carry a `finance` prefix; ported files import them aliased"
stays true), `docs/API.md` "Finance module"; `apps/api/test/finance-participants.test.ts` (the probe, lines 100 to 140).

**Do.**
1. `apps/api/src/modules/finance/http.ts` (new leaf): `CurrentFinanceParticipant` (`Context.Service`, value `FinanceParticipantContext`,
   the interface moved here and re-exported by `middleware.ts`) and `RequireFinanceParticipant` (`HttpApiMiddleware.Service`, requires
   `CurrentMembership`, provides `CurrentFinanceParticipant`, fails `403 finance_not_participant` / `server.finance.notParticipant`).
2. `apps/api/src/modules/finance/middleware.ts`: add `RequireFinanceParticipantLayer` (the `checkFinanceParticipant` logic, read from
   `CurrentMembership`); the Hono `requireFinanceParticipant`, `currentFinanceParticipant(c)`, `requireFinanceParticipantContext` and the
   `declare module "hono"` block move into the Hono section (P17), with their own `hono` imports below the marker.
3. The seven files by Table R (group chains: every file but `participants.ts` has `chain(RequireVerifiedEmail,
   RequireFinanceParticipant)`; `participants.ts` keeps its per-route middleware); bridge exports keep `participantRoutes`,
   `transactionRoutes`, `categoryRoutes`, `tagRoutes`, `planRoutes`, `balanceRoutes`, `settlementRoutes`. The handler layers need
   `RequireFinanceParticipantLayer`: the bridge's `handlers` argument is `Layer.provideMerge(<H>, RequireFinanceParticipantLayer)`
   (or what E7-T03's bridge documents for module middleware).
4. `finance-participants.test.ts`: the probe becomes a mini household API (`householdModuleApi("finance", …)` with one `GET /probe`
   behind `RequireFinanceParticipant`, echoing `CurrentFinanceParticipant`) through `testHttpApp`; every assertion kept.

**Acceptance.** No `hono` import in the seven route files; every `finance-*` test, `web-contract-finance`, `api-doc`,
`http-contract` green (unchanged but the probe); full `bun test` ≥ 14993; typecheck.

### E7-T10 — The system API and the module contract, behind the bridge (core)

**Goal.** Everything of the cutover that can be built and tested while Hono still serves: `SystemApi` (health, uploads) served through
a bridge; the module contract's `householdApi` / `userApi` beside the Hono routers; `moduleRoutesLayer` with its build-time assertion
and the module catch-alls; `modules.test.ts` on the new contract. E7-T11 is then only the switch.

**Read.** P1, P2, P13, P14, P15, P17; `apps/api/src/index.ts` (the health and uploads routes), `apps/api/src/core/health.ts`,
`apps/api/src/lib/uploadUrls.ts`, `apps/api/src/core/services/media/thumbnails.ts`, `apps/api/src/modules/{types,mount,index}.ts`, both
manifests and both `routes/index.ts`, the E7-T02 to T09 files as merged; `repos/effect/packages/effect/src/http/HttpRouter.ts` (`add`;
lines 150 to 175, the double registration of `/*`), `repos/effect/packages/effect/src/http-api/HttpApiBuilder.ts` (`layer`, `group`,
`HandlerRequirements`); `apps/api/test/{modules,uploads,smoke,runtime}.test.ts`; `docs/API.md` "Health", "Uploads and signed URLs",
"Modules".

**Do.**
1. `apps/api/src/core/routes/system.api.ts` (`SystemApi`: groups `health` `GET /api/health`, `uploads` `GET /uploads/:filename`,
   `coreApi`) and `system.ts` (`systemHandlers`): health = `healthResponse` as `json`; uploads = today's route line for line (normalise,
   `..` refusal, `verifyUploadSignature`, prefix check, `Thumbnails.resolveThumbnail`, the two `Cache-Control` values, `Content-Type`
   from `Bun.file(...).type`), every refusal `errorResponse(routeUnknown(method, path))`, the JSON 404 Hono's `c.notFound()` gave
   (E7-T01 row 9). At the end of `system.ts`: `export const systemRoutes = effectBridge(SystemApi, systemHandlers, "");`. In
   `apps/api/src/index.ts` the two inline routes are replaced, at the same place in the chain, by `app.route("/", systemRoutes)`;
   nothing else in `index.ts` changes.
2. `apps/api/src/modules/types.ts`: `ModuleHttpApi` (P14, the `any`s with their doc comment) and the optional `householdApi` /
   `userApi`, BESIDE the existing router fields.
3. `apps/api/src/modules/mount.ts`: `moduleRoutesLayer(modules)` (hoisted; P14: the assertion with `Effect.die` naming module and
   endpoint, `HttpApiBuilder.layer` per API with the module's `handlers`, the catch-alls on `…/<id>/*` ONLY, once per explicit method
   but `HEAD`, the one documented cast); `mountModules` moves into the file's Hono section (P17).
4. Both `routes/index.ts`: hoisted `recipeHouseholdHandlers()`, `recipeUserHandlers()`, `financeHouseholdHandlers()` (`Layer.mergeAll`
   of the file layers; finance's wrapped in `Layer.provideMerge(…, RequireFinanceParticipantLayer)`) and hoisted `recipeHouseholdApis()`,
   `recipeUserApis()`, `financeHouseholdApis()` (arrays of the file APIs, computed in a function: P15), BESIDE the Hono routers; both
   manifests set `householdApi` / `userApi` with `handlers: Layer.suspend(() => …Handlers())` and `apis` read lazily (a getter or the
   function's result taken inside `moduleRoutesLayer`, never at manifest module scope).
5. `apps/api/test/modules.test.ts` rewritten onto the new contract: case (g)'s fake module becomes a mini household API
   (`householdModuleApi("finance", …)` with one `GET /ping` echoing `CurrentMembership`'s `householdId`) served by `testHttpApp` over
   `moduleRoutesLayer([fakeFinance])`, every assertion kept; the other cases keep going through `app` unchanged; `testApp()`,
   `mountModules` and the Hono imports go. Added: (j) a household API whose chain lacks `RequireModule` (built by hand with the prefix)
   dies at layer build with a message naming the module and the endpoint; (k) an unknown path below the mini module answers 401
   without a cookie, 403 as a non-member, 404 `module_disabled` with the module off and 404 `not_found` with it on; (l) `HEAD …/finance/ping`
   as a member answers 200 with an empty body; (m) the REAL `API_MODULES` build through `moduleRoutesLayer` inside a `testHttpApp` (every
   group has its handler, the assertion holds, no duplicate route) and one documented `GET` of each module answers 200 there for a
   member of a household with the module enabled.

**Acceptance.** `modules.test.ts` keeps every old case (a) to (i) with its assertions, plus (j) to (m), green; `uploads`, `smoke`,
`runtime`, `api-doc` and `http-contract` (rows 1, 2 and 9 included) green unchanged; `hono-transition.test.ts` green; full `bun test`
≥ 14993; typecheck; idioms test.

### E7-T11 — The cutover: the Effect server, the tests on the in-memory handler (core)

**Goal.** Hono stops serving: `BunHttpServer` serves `appRoutesLayer()`; `app.request` runs through the in-memory HttpApi handler; the
module contract loses its router fields (SPEC §2 and the module docs in the same commit); `api-doc` enumerates the definitions; the
bridges are gone; `http-contract.test.ts` passes UNCHANGED.

**Read.** P1, P11 to P17, P19, P21; the E7-T10 files (as merged); `apps/api/src/index.ts`, `apps/api/src/runtime.ts`, both manifests
and both `routes/index.ts`; `repos/effect/packages/platform/bun/src/BunHttpServer.ts` (lines 110 to 200, `layer`, `layerTest`),
`repos/effect/packages/effect/src/http/HttpRouter.ts` (`serve`, `toWebHandler`), `repos/effect/packages/effect/src/Fiber.ts`
(`interrupt`), `repos/effect/packages/effect/src/Effect.ts` (`timeoutOrElse`), `repos/effect/ai-docs/src/01_effect/06_running/`,
`repos/effect/ai-docs/src/04_integration/`; `docs/SPEC.md` §2, `docs/modules/recipe.md` and `docs/modules/finance.md` (every mention of
`householdRouter`, `userRouter`, Hono); CLAUDE.md "One runtime, disposed on shutdown", "One composition point", "Hooks are Effects";
`apps/api/test/{api-doc,import-order,import-order-effect,runtime,smoke}.test.ts`.

**Do.**
1. `apps/api/src/http/app.ts`: `appRoutesLayer()` (hoisted: `globalHttpLayer()`, `HttpApiBuilder.layer` of `SystemApi`, `AuthApi`,
   `HouseholdsApi` with their handler layers, `moduleRoutesLayer(API_MODULES)`, `fallbackRoutesLayer()`), `httpApiRoutes()` (P16),
   `export const app = inMemoryHandler(appRoutesLayer)` (P13).
2. `apps/api/src/http/server.ts` and `apps/api/src/index.ts` per P12: the server fiber forked on `runtime`, the bounded interrupt, no
   `export default`, `export { app } from "./http/app.ts"`; `index.ts` keeps no Hono line.
3. The transition removed: the bridge export line of every route file of E7-T05 to E7-T10 (`authRoutes`, `householdRoutes`,
   `recipeRoutes`, `planRoutes`, `cardRoutes`, `importRoutes`, `shoppingRoutes`, the seven finance exports, `systemRoutes`);
   `apps/api/src/http/bridge.ts` and `apps/api/test/http-bridge.test.ts` deleted; the Hono routers of both `routes/index.ts` (with their
   `hono` import); `householdRouter` / `userRouter` from `apps/api/src/modules/types.ts` (with its `hono` import) and from both
   manifests.
4. Tests: `api-doc.test.ts` on `httpApiRoutes()` (P16, every assertion, `DOC_ONLY` and the `+verified` sweep kept);
   `import-order.test.ts` and `import-order-effect.test.ts` per P15 (no entry dropped); `runtime.test.ts` / `smoke.test.ts` only if they
   read Hono (every assertion kept); `hono-transition.test.ts`: `STRICT = true`; `apps/api/test/http-server.test.ts` (new): the server
   layer on `BunHttpServer.layerTest` (port 0) answers `GET /api/health` and `HEAD /api/health` (200, empty body) through a real socket
   with the security headers, a login's `Set-Cookie` arrives as a real header, and the socket address reaches `clientIp`.
5. Docs in the same commit: `docs/SPEC.md` §2 (the `ApiModule` sketch and the bullet "Module routers do NOT apply …" in HttpApi
   terms: `householdApi` / `userApi` as `ModuleHttpApi`, `householdModuleApi` adds the chain, `RequireFinanceParticipant`,
   `CurrentFinanceParticipant` instead of the `ContextVariableMap` augmentation), `docs/modules/recipe.md` and `docs/modules/finance.md`
   (route files now `X.ts` + `X.api.ts`, the manifest fields).

**Acceptance.** `http-contract.test.ts` green WITHOUT an edit; `api-doc.test.ts` green on the definitions; `modules.test.ts`,
`middleware.test.ts`, `import-order*.test.ts` green with no case lost; `hono-transition.test.ts` green with `STRICT = true` (every
remaining `hono` importer under `apps/api/src` has its section); `grep -rnE 'onErrorHandler|notFoundHandler|mountModules|localeMiddleware|AppEnv|AppContext|effectBridge' apps/api/test apps/api/src --include=*.ts`
finds them only below a Hono marker (no test imports a section export but `errors.test.ts`'s `honoExceptionToApiError`); full `bun
test` ≥ 14993; typecheck; idioms test; `docs-paths.test.ts` green.

### E7-T12 — Hono out of the tree, idioms rule (14) (rewrite)

**Goal.** No Hono code, import, dependency or lockfile entry; rule (14) pins it.

**Read.** P17; `apps/api/test/effect-idioms.test.ts` (rule (9) "no zod" is the model, the `PENDING_RULES` comment);
`apps/api/test/hono-transition.test.ts` (what it proved); CLAUDE.md "The idioms test is the E12 gate".

**Do (only these).**
| File | Change |
| --- | --- |
| `apps/api/src/lib/{http,types,locale,validate,errors,cookies}.ts`, `apps/api/src/middleware/{session,household,module,verifiedEmail,originGuard,securityHeaders,staticWeb}.ts`, `apps/api/src/core/services/auth/rateLimit.ts`, `apps/api/src/modules/finance/middleware.ts`, `apps/api/src/modules/mount.ts` | delete from the line `/* Hono (E7 transition): E7-T12 deletes this section */` to the end of the file, and nothing else (the section holds its own imports; `hono-transition.test.ts` proved nothing above the marker uses a name from it). If a file has a `hono` import ABOVE its marker, or has no marker but imports `hono`, STOP and report the file (an earlier task broke P17). Then trim trailing blank lines so the file ends in one newline. |
| `apps/api/test/errors.test.ts` | delete the one test that calls `honoExceptionToApiError` (E7-T02 retargeted it); delete the line `import { HTTPException } from "hono/http-exception";` and the name `honoExceptionToApiError` from the import of `../src/lib/errors.ts`; nothing else |
| `apps/api/test/hono-transition.test.ts` | delete the file |
| `apps/api/package.json` | delete the line `"hono": "^4.13.7",` |
| `bun.lock` | `bun install` (background, log ending `exit=$?`), then `bun install --frozen-lockfile` |
| `apps/api/test/effect-idioms.test.ts` | delete the `PENDING_RULES` line for E7 (and update the "(E1 switched on …)" line to name E7's rule (14)); add `describe("rule (14): no hono", …)` copying rule (9)'s three tests with `hono` / `hono/*` as the specifiers and `"hono"` as the dependency and lockfile key, message "the API is served by effect/http-api on BunHttpServer; hono is gone (docs/EFFECT.md E8)" |
Then `bun run typecheck`. If `tsc` reports an undefined name or a missing export, STOP and report each `file:line` and name; never
rewrite a caller (it means an earlier task left a live Hono path or broke P17).

**Acceptance.** `grep -rnE "from ['\"]hono" apps packages scripts` prints nothing; `grep -n '"hono' apps/api/package.json bun.lock` prints
nothing; `grep -rn 'Hono (E7 transition)' apps` prints nothing; rule (14) green; full `bun test` ≥ 14993 (the count moves by rule (14)'s
three tests minus the deleted HTTPException test and the two transition tests); typecheck.

### E7-T13 — Integration: gates, live checks, the image, docs, the record (build)

**Goal.** The milestone's exit criteria proven on the merged tree and written down; the docs as built.

**Read.** `docs/EFFECT.md` §4 E7 exit, §5; `docs/deployment.md` "Local stack test"; CLAUDE.md "Commands" (the local stack test,
`caddy validate`), "Headless runs", "The CSP and the baked API URL"; this plan whole; every E7 commit's message.

**Do.**
1. Gates, each a log ending `exit=$?`: `bun install --frozen-lockfile`, `bun run typecheck`, `bun test` (compare with 14993 and list
   the new test files), `bun run build` (record the gzipped bundle, P20), `bun run i18n:check` (classify every hit: the 147 of
   CLAUDE.md, plus any new one).
2. Boot and shutdown: `DATABASE_URL=file:<scratch>/e7.db SESSION_SECRET=<32 hex> bun run db:migrate && bun run seed`, then
   `WEB_DIST_DIR=./apps/web/dist bun run start` in the background; `/api/health`; the boot line; `GET /api/households` with a
   seeded login; eleven bad logins answer `429` with `Retry-After`; the CSP of `/` and `/api/health` carries the `'sha256-…'` of
   the inline script of `apps/web/dist/index.html` (computed with `openssl dgst -sha256 -binary | base64`) at
   `http://127.0.0.1:3001` and at `http://localhost:3001` (the second origin); a request with `?sig=` in the query does not log the
   query; SIGTERM → the P12 lines in order, exit 0. Then the bounded stop with a request IN FLIGHT: start the server again, send a
   slow upload (`curl --limit-rate 2k -F file=@<a 200 kB image> …/recipe/imports/image` with a seeded session, in the background),
   send SIGTERM while it runs, and record the line order and the time to exit (≤ 6 s: the 5 s bound of P12 plus the teardown; the
   module shutdowns, `[db] database closed` and `[api] runtime disposed` all appear).
3. The local stack test of `docs/deployment.md` with a freshly built image (`docker build -t toon-household:local . > build.log
   2>&1; echo "exit=$?" >> build.log`, read `exit=0`), compose project `toon-household-local`, `/api/health` healthy through the Caddy
   (`--cacert root.crt --resolve haushalt.test:443:127.0.0.1`), the old hostnames' 301s and `/sw.js` 200 on `rezepte.test` /
   `finanzen.test`, a login and a module read through the Caddy; tear down with `down -v`; `docker volume ls -q | grep -E
   '^toon-household(-local)?_'` empty. `git diff --quiet 16b104d82 HEAD -- Dockerfile docker-compose.yml docker .dockerignore` exits 0 (P19).
4. OpenAPI for the record: a scratch script (not committed) printing `OpenApi.fromApi` path counts per API; the counts go into 9.x.
5. Docs: `docs/API.md` "Middleware chain and mount order" rewritten in HttpApi terms (the global layer, the APIs, the chain, the
   catch-alls, specificity instead of registration order for `/invites/:token` against `/:householdId`), "Security headers" (Hono's
   "other secure-header defaults" → the literal list), every other Hono mention in an implementation note, NO row changed;
   CLAUDE.md (Layout: `apps/api/src/http/`, the `.api.ts` files, `index.ts`; Status: E7 done with the pass count; the gotchas
   "Middleware chain order is load-bearing", "API import cycle", "Middleware factories are TDZ-safe", "One runtime", "The error family",
   "The origin guard", "The idioms test" (rule 14) rewritten to the E7 shape, the retired ones moved to "Retired gotchas");
   `docs/EFFECT.md` E8 gets an "As built (E7)" paragraph like E11's; `docs/open-work.md` (declared payload and success schemas per
   endpoint, a typed `HttpApiClient` for the web, the request log format); `agent-patterns/effect-http-api.md` and
   `effect-http-server-bun.md` §7 "In this repo" from what the code does; ADR 0015 for D6 and D7 (they ship by design) and every
   other deviation of section 7 that materialised; it edits `docs/EFFECT.md` §4's E7 row (D6) and E8's wording (D7) in the same
   commit, and CLAUDE.md's ADR list gains 0015.
6. This plan's sections 9 (gates, live checks, the image, the record) and 10 (what changed vs plan); status line DONE.

**Acceptance.** Every exit criterion of the milestone task is proven by a command whose output is quoted in section 9;
`docs-paths.test.ts` and `api-doc.test.ts` green on the final tree.

## 5. Acceptance summary (milestone exit → where it is proven)

| Exit criterion | Proven by |
| --- | --- |
| gates green | E7-T13 step 1 (and every task's verify) |
| pass count ≥ E6's 14993 | every task's full `bun test`; E7-T13 section 9 |
| every `docs/API.md` row served with the same status and headers | `apps/api/test/http-contract.test.ts` (E7-T01, unchanged through E7-T11), `apps/api/test/api-doc.test.ts` on the definitions (E7-T11) |
| api-doc enumerates the `HttpApi` definition | E7-T11 (P16) |
| middleware and import-order tests adapted without losing a case | E7-T03 (`middleware.test.ts`), E7-T11 (`import-order*.test.ts`, `modules.test.ts`) |
| `app.request` tests on the in-memory handler | E7-T11 (P13: `app` is `HttpRouter.toWebHandler` of the HttpApi router) |
| module contract: groups plus handler layer, SPEC §2 and module docs in the same commit | E7-T10 (built and tested beside the Hono mount, P14), E7-T11 (switched; SPEC §2 and module docs in that commit), D7 |
| `hono` out of `package.json` and `bun.lock`, `grep -r 'from "hono' apps` empty | E7-T12, rule (14); `hono-transition.test.ts` (E7-T02 to E7-T11) keeps the deletion mechanical |
| local stack test with a fresh image, health through the Caddy, old-hostname redirects | E7-T13 step 3 |
| CSP hashes match the built `index.html` at a second origin | E7-T13 step 2 |
| Dockerfile, compose, Caddyfile unchanged (port, health path, X-Forwarded-For LAST entry) | P19, E7-T13 step 3 `git diff --quiet` |
| `docs/API.md` "Middleware chain and mount order" in HttpApi terms, rows untouched | E7-T13 step 5 (api-doc keeps the rows honest) |
| OpenAPI into the record, `/docs` not mounted | E7-T13 step 4; no `HttpApiScalar` / `HttpApiSwagger` / `openapiPath` in `apps/api/src` |

## 6. Risks

1. **Middleware order misread.** HTTPAPI.md's wording and our pattern file suggested the opposite of the code (P6). Mitigation: `chain`
   takes the execution order; E7-T02 proves the nesting with recording middlewares before anything relies on it; the CHAIN ORDER cases
   of `middleware.test.ts` and E7-T01's rows 12 pin the 401 → 403 → 404 order end to end.
2. **Partial `params` schemas break paths** (`toRouterPath` writes `::`, 1.1). Mitigation: P3's "every `:name` of the full path" rule,
   an E7-T02 test showing the failure mode, and the route tests of every rewrite task (a broken path is a 404 there at once).
3. **Two copies of `AppLayer`, or one shared router.** A router layer built without `appMemoMap` builds a second `Database`, limiter
   state and mailer seam; one built ON `appMemoMap` shares a single `HttpRouter` with every other in-memory handler (1.1). Mitigation:
   `inMemoryHandler` (P13) builds `AppLayer` into `appMemoMap` first and every handler on a child map; `http-foundation.test.ts` and
   `http-bridge.test.ts` prove the isolation; the many tests that write through `runTest` and read through `app.request` (or the
   reverse) fail at once on a second `AppLayer`.
4. **The body read twice** (`jsonBody` then `rawJsonOrDie`, `keepOnlySentKeys`). Mitigation: P4 reads through `HttpServerRequest.text`
   (cached per request); E7-T02 tests it; never read `request.source` and the Effect body accessors in one request.
5. **Hono's header defaults are not where we think.** `secureHeaders`, `cors` and the JSON content type carry defaults no repo file
   spells out. Mitigation: E7-T01 captures every header literally from the running Hono app; E7-T04 copies from Hono's dist before
   E7-T12 removes the package; E7-T11 must pass E7-T01 unchanged.
6. **Routing differences (find-my-way versus Hono).** Specificity instead of registration order, `ignoreDuplicateSlashes: true`, the
   trailing-slash rule, `HEAD` → `GET` only when no `HEAD` route matches (a `*`-method wildcard shadows it), the double registration of
   a `/*` path, percent-encoded params. Mitigation: explicit methods but `HEAD` for every wildcard (P11, P14), the `HEAD` rows of
   E7-T01 and `modules.test.ts` (l); E7-T01 rows for every documented path; the module and
   fallback catch-alls (P11, P14) keep the JSON 404 and the 401-first rule; a difference on an UNDOCUMENTED path is recorded (section
   7), not chased.
7. **The error boundary's typing.** `HttpApiMiddleware`'s `error` must admit a declared schema of the boundary union (P7). Mitigation:
   E7-T02 builds it first; the documented fallback (a `respond` combinator) keeps Table R's shape with one more `Effect.fn` argument,
   written under `Table R amendments`.
8. **TDZ with class-valued tags.** A `Context.Service` / `HttpApiMiddleware.Service` class is a TDZ binding, unlike today's hoisted
   middleware functions. Mitigation: P15's leaves (the tags and the `.api.ts` files import nothing in the cycle), lazily built layer
   lists, and the fresh-process import-order tests with the new entries.
9. **Client disconnects interrupt writes.** BunHttpServer interrupts a handler fiber when the client goes away; Hono did not.
   Mitigation: `UNINTERRUPTIBLE` on every handler (P9).
10. **Bind address and shutdown.** `BunHttpServer`'s `"::"` default and its graceful stop differ from Bun's auto-serve. Mitigation:
    P12's explicit `hostname` and timeout; E7-T13's boot/shutdown log and the Docker HEALTHCHECK through the stack test.
11. **Bridges hide production-only paths.** The socket address and the real Bun response conversion are not exercised by in-process
    tests. Mitigation: `http-server.test.ts` on `BunHttpServer.layerTest` (E7-T11) and the E7-T13 live checks.
12. **`bun install` needs the cache** to rewrite `bun.lock` without hono (E7-T12). Mitigation: background log; if offline fails, run it
    with network once and record it.
13. **Load on parallel worktrees** (wave 3 runs five full suites at once; CLAUDE.md "A test that runs `sharp` carries an explicit time
    budget"). Mitigation: a failing run keeps its `(fail)` lines; a timeout under load is re-run alone before it is called a failure.
14. **Global middleware order.** Registration order decides nesting and `Layer.mergeAll` builds concurrently (1.1). Mitigation: one
    generator registers the four in order (P11); E7-T04 checks the headers on the preflight and the origin-guard 403 with a real
    `index.html`.
15. **An unbounded stop.** `BunHttpServer`'s own `server.stop()` finalizer waits for every in-flight request (1.1). Mitigation: the
    bounded interrupt in `index.ts` (P12) and E7-T13's in-flight SIGTERM check.
16. **The Hono deletion leaves dangling names.** Mitigation: the section convention with its own imports and `hono-transition.test.ts`
    (P17); E7-T12 stops on any `tsc` error instead of guessing.

## 7. Deviations expected (each recorded in section 10 when it happens; ADR 0015 by E7-T13 for the ones that ship)

- **D1 — Unknown paths below a module SUB-router** (`…/finance/transactions/x/y`) pass session → member → module and then answer the
  JSON 404; they no longer also pass that sub-router's own `use("*")` gates (verified e-mail, finance participant) first. No
  `docs/API.md` row is affected; the module prefix keeps 401 → 403 → 404 (P14 catch-alls).
- **D2 — `Set-Cookie` attribute order and spelling** follow Effect's serializer; the attribute set is unchanged (P8). As built, the session cookie's order and spelling equal Hono's (section 10 F3).
- **D3 — The request log line** may differ from Hono's in a detail E7-T04 cannot reproduce (for example the time unit); the path-only
  rule holds. Nothing pins the format.
- **D4 — Graceful stop.** In-flight requests drain for up to 5 s on SIGTERM (P12, bounded in `index.ts`); after that they are
  abandoned and the teardown runs; Bun's auto-serve dropped them at `process.exit`.
- **D5 — Transitional only (never shipped):** the double module chain and the missing socket address behind the bridges (P1).
- **D6 — CORS, the origin guard and the security headers are global router middleware, and there is no locale middleware (P11, P4).**
  `docs/EFFECT.md` §4's E7 row lists `HttpApiMiddleware` for "session, household role, module, verified e-mail, locale, origin guard,
  security headers, cors". An `HttpApiMiddleware` wraps endpoints only, so it would miss the preflight, the static web, `/uploads`, the
  fallback 404 and every request no endpoint matches, all of which carry these headers today; the four become `globalHttpLayer()`
  (same order as Hono's `use` lines), and the locale is negotiated where it is needed (`requestLocale`, the boundary). Session, household
  role, module and verified e-mail ARE `HttpApiMiddleware`s as the row says. Ships by design: ADR 0015 amends the §4 E7 row.
- **D7 — A module contributes `HttpApi`s that wrap its groups (P14).** E8 says a module "contributes `HttpApiGroup`s plus their handler
  layer". `ModuleHttpApi` carries `apis` (one `HttpApi` per route file, each wrapping its one group) plus the handler layer, because
  the API is where the module prefix and the module chain (`householdModuleApi` / `userModuleApi`) are attached and where the
  assertion of `moduleRoutesLayer` reads them; the groups are still the unit of handlers. Ships by design: ADR 0015 amends E8's
  wording in the same commit.

## 8. Out of this milestone

- Declared `payload` / `query` / `success` / `error` schemas per endpoint, and the typed `HttpApiClient` for the web (P3; open work).
- Serving OpenAPI or `/docs` (EFFECT.md §6); the document is generated for the record only.
- E8's review findings, CLAUDE.md's full as-built pass beyond what E7 changes, the `db/client.ts` process-wide instance (E5's
  "stays until E8 decides").
- Any change to `apps/web`, the Dockerfile, compose, the Caddyfile, a `docs/API.md` row, a catalog string, a table or a migration.

## 9. Integration record

Written by E7-T13 on the merged tree (HEAD `98b027c5f` plus the T13 commit). Host: Bun 1.4.3, Docker 29.9.2, load average about 2. Every log below ends `exit=<code>`;
the logs themselves live in the session scratchpad and are not committed (a record of a run names counts and OK/FAIL).

### 9.1 The gates

| Gate | Result |
| --- | --- |
| `bun install --frozen-lockfile` | `Checked 438 installs across 627 packages (no changes)`, `exit=0` |
| `bun run typecheck` | the five projects, `[typecheck] OK`, `exit=0` |
| `bun test` | **15191 pass, 1 skip, 0 fail, 386140 `expect()` calls, `Ran 15192 tests across 181 files. [61.22s]`**, `exit=0`; no `(fail)` line, no `Unhandled error` block. Baseline 14993 in 177 files (1.2), so +198 tests and +4 files |
| `bun run build` | `exit=0`, 84 JS chunks, PWA `precache 104 entries (1507.36 KiB)` (section 9.3) |
| `bun run i18n:check` | `[i18n:check] OK` for parity, then `FAILED — 148 possible German literal(s)`, `exit=1` by design (section 9.2) |

The same chain as one command (the task's verify, run after the docs and the two code edits of section 10): `step-install ok`, `step-typecheck ok`, the three doc and contract
tests `92 pass, 0 fail` (`apps/api/test/docs-paths.test.ts`, `apps/api/test/api-doc.test.ts`, `apps/api/test/http-contract.test.ts`), `exit=0 pass=15191`, `step-build ok`,
`git diff --quiet 16b104d82 HEAD -- Dockerfile docker-compose.yml docker .dockerignore` exits 0, `docs/adr/0015-http-api-deviations.md`, `git status --porcelain repos/` empty.
Before the T13 edits the full suite was `15175 pass` (58.05 s); the 16 added tests are the route-file entries of section 9.6.

New test files since the base (`git diff --name-status 16b104d82 HEAD`): `apps/api/test/http-contract.test.ts` (78 tests, the contract oracle, unchanged by the cutover),
`apps/api/test/http-foundation.test.ts`, `apps/api/test/http-global.test.ts` and `apps/api/test/http-server.test.ts` (a real socket on `BunHttpServer.layerTest`). Two transitional files
(`http-bridge.test.ts`, `hono-transition.test.ts`) were created and deleted inside the milestone. Modified: `api-doc`, `auth`, `effect-idioms` (rule (14)), `errors`,
`finance-cross-household`, `finance-participants`, `import-order`, `import-order-effect`, `middleware`, `module-adapter`, `modules`, `oauth-callback`, `rate-limiter`, `recipe-cross-household`,
`recipe-module`, `runtime`, `security`, `static-web` and `validate`. No test file lost an assertion (each rewrite onto `testHttpApp` keeps its cases, the commit messages say so).

### 9.2 `i18n:check`, classified

148 hits. The same command on a worktree of the base `16b104d82` reports 145; compared line-number-free, the 145 are identical and the three new ones are all in `apps/api/src/modules/mount.ts`:
the doc comment line and the two `return yield* Effect.die(wiringDefect(…))` lines, hits of the check's stopword "die" on the Effect constructor `Effect.die` (the false-positive class CLAUDE.md names
for the retired module adapter). No German string was added, so the parity half stays OK. The other 145 are the known German quotes in comments and the recipe content vocabulary
(`apps/api/src/modules/recipe/services/import/html/entities.ts`, the shopping and tag labels in comments, `apps/web/src/modules/recipe/**` display vocabulary).

### 9.3 The bundle

`bun run build` on the final tree: **84 JS chunks, 419.99 kB gzipped in total** (the sum of the `gzip:` column of `dist/assets/*.js`), CSS 12.92 kB (12.52 + 0.40), PWA `precache 104 entries (1507.36 KiB)`:
identical to E6's record (`docs/plans/e6-web-client.md` 9.2). `git diff --stat 16b104d82 HEAD -- apps/web` is empty (P20).

### 9.4 Boot and shutdown on a scratch database

`DATABASE_URL=file:<scratch>/e7.db SESSION_SECRET=<32 hex>`, `bun run db:migrate && bun run seed` (`exit=0`, `[db] database closed`), then the server as the image runs it (`bun apps/api/src/index.ts` from `apps/api`,
`WEB_DIST_DIR=<repo>/apps/web/dist`), once per check below.

- **Boot line.** `[api] toon-household API on http://localhost:3001 (db: file, origins: http://localhost:5173, mail: console, web: /home/erics/software/toon-household/apps/web/dist)`, the pre-E7 line.
- **Health, login, a read.** `GET /api/health` 200 `{"ok":true,"status":"ok","version":"0.1.0",…,"modules":["recipe","finance"],"features":{…}}` with the security and CORS headers; `POST /api/auth/login`
  (seeded `demo@toon.local`) 200 with `set-cookie: toon_session=…; Max-Age=2591999; Path=/; HttpOnly; SameSite=Lax`; `GET /api/households` with that cookie 200 (`"role":"owner","memberCount":3,"modules":["recipe","finance"]`),
  without it 401 `unauthorized` carrying the security headers.
- **Rate limit.** Eleven bad logins in a row: ten `401`, the eleventh `429 rate_limited` with `retry-after: 59`.
- **CSP at two origins.** The inline script of `apps/web/dist/index.html` hashes to `sha256-5v9mXqu719mluDFYJo1wOcX4/ocZqZ97UKW4cHX3XZs=` (computed independently from the file, base64 of the SHA-256 of the body);
  `Content-Security-Policy` of `/`, `/api/health` and `/uploads/nope.png` at `http://127.0.0.1:3001` AND at `http://localhost:3001` carries exactly that `'sha256-…'` (statuses 200, 200, 404 both times).
- **`?sig=` not logged.** `GET /uploads/nope.png?exp=1&sig=SECRETSIGVALUE` answered 404; the string `SECRETSIGVALUE` occurs 0 times in the server log, whose lines are `<-- GET /uploads/nope.png`, `[api] GET /uploads/nope.png -> 404 not_found: …`, `--> GET /uploads/nope.png 404 …ms`.
- **SIGTERM, idle.** Line order `[api] SIGTERM — stopping modules …`, `[db] database closed`, `[api] runtime disposed`; exit status 0 (wrapper `exit=0`); 23 ms and 48 ms on two runs.
- **SIGTERM with a request in flight.** `IMPORT_OCR_ENABLED=1`, a 200 kB file, `curl --limit-rate 2k -F file=@big.png …/recipe/imports/image` with the seeded session in the background (the handler waits in `readUploadedFile`),
  SIGTERM sent 3 s later:
  - **First measurement, the tree as merged (server forked with `runtime.runFork`): the bound did NOT hold.** Exit status 0 after **8923 ms**; lines `[api] SIGTERM — stopping modules …`, then the abandoned request's own error
    (`[api] POST …/recipe/imports/image -> 400 bad_request: The file could not be read (multipart/form-data expected).`, `--> POST … 400 12s`), then `[db] database closed`, `[api] runtime disposed`, and Bun's
    `Bun.serve() timed out a request after 10 seconds`. The stop ended when Bun's idle timeout closed the stalled upload. Cause: `ManagedRuntime.dispose` interrupts and awaits every fiber it forked
    (`repos/effect/packages/effect/src/ManagedRuntime.ts`, `disposeEffect`: "Closing fiberScope interrupts and awaits every managed fiber"), and the server fiber's finalizer is `server.stop()`, which waits for the
    uninterruptible handler; the 5 s `timeoutOrElse` returned on time and the dispose then waited behind it.
  - **Fix (E7-T13, `apps/api/src/index.ts`, section 10 F1):** the server fiber is forked with `Effect.runForkWith(await runtime.context())` instead of `runtime.runFork`, so the dispose does not await it. Second measurement:
    exit status 0 after **5034 ms**, lines `[api] SIGTERM — stopping modules …`, `[db] database closed`, `[api] runtime disposed` (the in-flight request is abandoned, its client sees the connection close). Idle stop after the fix: 48 ms, same three lines.
  - Module shutdowns log nothing on success (recipe's terminates the tesseract worker, finance's interrupts the accrual schedule), so their place in the order is between the first and the second line; a failure would log `[api] shutdown of module <id> failed:`.

### 9.5 The local stack test (`docs/deployment.md` "Local stack test")

`docker build -t toon-household:local . > build.log 2>&1; echo "exit=$?" >> build.log` on the final tree: `exit=0` (404 MB image; the web-build stage's `! grep -rqF 'localhost:3001' apps/web/dist` passed).
Ports 80 and 443 free. Compose project `toon-household-local`: `docker compose -p toon-household-local --env-file .env.local-stack config -q` exit 0, `up -d`, the app container `Up (healthy)`, caddy `Up`.

- **Health through the Caddy:** `curl -fsS --resolve haushalt.test:443:127.0.0.1 --cacert toon-root-ca.crt https://haushalt.test/api/health` (CA fetched over plain HTTP from `/toon-root-ca.crt`):
  `{"ok":true,"status":"ok","version":"0.1.0",…,"modules":["recipe","finance"],"features":{"verifiedEmailRequired":false,"ocrImport":false,"pdfImport":false}}`; `GET /` 200 `text/html`; the health response carries
  `strict-transport-security: max-age=0` (the Caddy's, `TOON_HSTS_MAX_AGE=0` in `.env.local-stack`), the app's CSP and `x-frame-options: DENY`.
- **Old hostnames:** `rezepte.test` and `finanzen.test` answer `HTTP/2 301` with the mapped `location` (`https://rezepte.test/plan` → `https://haushalt.test/recipe/plan`, `https://finanzen.test/transactions` →
  `https://haushalt.test/finance/transactions`, `/` → `/recipe` and `/finance`), and `/sw.js` on both answers `200 text/javascript; charset=utf-8`, 501 B, the retiring worker ("Retires the service worker of the app that used to live on this hostname (toon-household ADR 0008)").
- **Login and a module read through the Caddy:** `POST /api/auth/register` 201, `POST /api/auth/login` 200, `GET /api/households` one household, `GET …/recipe/recipes` 200 `{"items":[],"total":0,"limit":24,"offset":0}`,
  `GET …/finance/categories` 404 `module_disabled` (finance not enabled), `GET /api/auth/me` 200.
- **The real container's SIGTERM:** `docker compose stop app` took 354 ms, the container log ends `[api] SIGTERM — stopping modules …`, `[db] database closed`, `[api] runtime disposed`, `docker inspect` exit code 0.
- **Tear-down:** `docker compose -p toon-household-local --env-file .env.local-stack down -v` removed the three `toon-household-local_*` volumes and the network; `docker volume ls -q | grep -E '^toon-household(-local)?_'` printed nothing.
- **The deployment files are untouched:** `git diff --quiet 16b104d82 HEAD -- Dockerfile docker-compose.yml docker .dockerignore` exits 0 (P19).

### 9.6 The route files as a first import (open-work O-6)

For each of the 20 route files and the two `routes/index.ts`, a fresh `NODE_ENV=test bun -e` imported the file FIRST, then `src/http/app.ts`, then served `GET /api/health`: all printed `200`
(`recipe/routes/{recipes,imports,shopping,plan,cards,index}.ts`, `finance/routes/{balance,categories,index,participants,plan,settlements,tags,transactions}.ts`,
`core/routes/{auth,households,members,invites,modules,system}.ts`). E7-T13 added the 16 not yet listed to `apps/api/test/import-order-effect.test.ts`
(`bun test apps/api/test/import-order-effect.test.ts`: 69 pass, 0 fail) and retired O-6 in `docs/open-work.md`.

### 9.7 OpenAPI, for the record

A scratch script (deleted, not committed) printed `OpenApi.fromApi` per API on the final tree (`NODE_ENV=test`):

```
SystemApi                            paths=  2 operations=  2
AuthApi                              paths= 15 operations= 17
HouseholdsApi                        paths= 10 operations= 17
recipe:household recipe.imports      paths=  9 operations= 11
recipe:household recipe.shopping     paths= 13 operations= 20
recipe:household recipe.plan         paths=  3 operations=  5
recipe:household recipe.recipes      paths= 10 operations= 20
recipe:user recipe.cards             paths=  3 operations=  5
finance:household finance.participants paths=  3 operations=  4
finance:household finance.transactions paths=  3 operations=  6
finance:household finance.categories paths=  2 operations=  4
finance:household finance.tags       paths=  2 operations=  3
finance:household finance.plan       paths=  9 operations= 12
finance:household finance.balance    paths=  2 operations=  2
finance:household finance.settlements paths=  1 operations=  2
TOTAL apis=15 paths=87 operations=130 distinct METHOD path=130 httpApiRoutes()=130
```

130 served endpoints plus the one documented-only row (`GET /uploads/:filename.thumb.webp`, `DOC_ONLY` in `apps/api/test/api-doc.test.ts`) is the 131 rows of `docs/API.md` (1.1). The document lists methods,
paths and path parameters only (P3). `grep -rn 'HttpApiScalar\|HttpApiSwagger\|openapiPath' apps/api/src` finds nothing: `/docs` is not mounted.

### 9.8 Exit criteria (section 5), where each was proven

| Exit criterion | Proof on the final tree |
| --- | --- |
| gates green | 9.1 |
| pass count ≥ 14993 | 15191 (9.1) |
| every `docs/API.md` row served, same status and headers | `apps/api/test/http-contract.test.ts` 78 tests, unchanged since E7-T01 (it was captured from the Hono app and passes on the Effect server); `apps/api/test/api-doc.test.ts` on `httpApiRoutes()`; both inside the 92 green of 9.1 |
| api-doc enumerates the `HttpApi` definition | `apps/api/test/api-doc.test.ts` reads `httpApiRoutes()` (E7-T11, P16), 130 + 1 `DOC_ONLY` = 131 rows (9.7) |
| middleware and import-order tests adapted, no case lost | E7-T03, E7-T11 (commit messages); `apps/api/test/import-order-effect.test.ts` 69 tests (9.6) |
| `app.request` tests on the in-memory handler | `app = inMemoryHandler(appRoutesLayer)` (E7-T11); 43 test files unchanged in their call shape |
| module contract: groups plus handler layer, SPEC §2 and module docs in the same commit | E7-T11 (SPEC §2, `docs/modules/recipe.md`, `docs/modules/finance.md`), ADR 0015 decision 2 (D7: `HttpApi`s wrapping the groups) |
| `hono` out of `package.json` and `bun.lock`, `grep -r 'from "hono' apps` empty | 0 matches in `apps packages scripts`; `hono` in no `package.json` and no `bun.lock` line; idioms rule (14) green |
| local stack test with a fresh image, health through the Caddy, old-hostname redirects | 9.5 |
| CSP hashes match the built `index.html` at a second origin | 9.4 (`127.0.0.1:3001` and `localhost:3001`) |
| Dockerfile, compose, Caddyfile unchanged | `git diff --quiet 16b104d82 HEAD -- Dockerfile docker-compose.yml docker .dockerignore` exits 0 |
| `docs/API.md` "Middleware chain and mount order" in HttpApi terms, rows untouched | rewritten in this commit; `git diff -U0 docs/API.md | grep '^[-+]|'` shows only the new security-header table, no endpoint row |
| OpenAPI into the record, `/docs` not mounted | 9.7 |
| bounded stop with a request in flight | 9.4: 5034 ms after the fix (8923 ms before it, section 10 F1) |

## 10. What changed vs plan

- **F1 — The 5 s bound of P12 did not hold as built; fixed in E7-T13.** P12 specified `index.ts` bounding the server fiber's interrupt to 5 s so that the module shutdowns, the dispose and the exit always run inside Docker's
  10 s. As merged by E7-T11 the server was forked with `runtime.runFork`, and `runtime.dispose()` awaits every fiber it forked, so the bound returned on time and the dispose then waited for `server.stop()` and the
  uninterruptible handler behind it (section 9.4: 8.9 s, ended by Bun's idle timeout, unbounded in principle). The plan's own risk 15 ("an unbounded stop") named this and its mitigation is the in-flight check, which is what found it. The
  smallest fix is in `apps/api/src/index.ts` (not a file this task owns; recorded in the commit body): `Effect.runForkWith(await runtime.context())` for the server fiber, a comment saying why. Measured after: 5.03 s with the slow upload
  in flight, 23 to 48 ms idle, 354 ms in the container. ADR 0015 decision 4 records it; `docs/open-work.md` O-9 records the abandoned request.
- **F2 — `apps/api/test/import-order-effect.test.ts` gained 16 entries** (the route files the pre-E7 tree could not take as a first import, P15 listed only `routes/index.ts`): the open-work item O-6 promised "ten files" in E7 and the measurement (9.6)
  showed all of them load first now. The file is not in this task's list; the edit adds entries only.
- **F3 — D1, D2, D3, D4, D6, D7 shipped as planned** (section 7; D5 never shipped, the bridges are gone); ADR 0015 records them with P3 (no declared payload or success schemas) and the F1 correction. D2 turned out smaller than planned: the
  session cookie's attribute order and spelling equal Hono's (`Max-Age=…; Path=/; HttpOnly; SameSite=Lax`, section 9.4); the only difference is one `Set-Cookie` per cookie name where Hono appended two.
- **F4 — `i18n:check` count.** The plan and CLAUDE.md said 147 (146 plus an `Effect.die` hit in the since-deleted `apps/api/src/modules/adapter.ts`); the base measures 145 and the final tree 148 (three `Effect.die` hits in `apps/api/src/modules/mount.ts`, 9.2).
- **F5 — Observed values the T01 capture recorded, kept as they are:** CORS headers are on every `/api/*` response, also without an `Origin` and for a foreign one (the allow-origin is the first `WEB_ORIGIN`); `/uploads/*` has the security headers but no CORS headers; `POST /api/households`
  with malformed JSON answers Hono's own `400 "Anfrage fehlgeschlagen"` / `"Request failed"` (`jsonBody` reproduces it, P4); a finance row run by a plain member without a seat is `403 finance_not_participant`.
- **F6 — Comments that still name Hono** (82 lines in 32 files) are left for E8's as-built pass (`docs/open-work.md` O-10); no import or dependency does.
- **F7 — Open work added:** X-5 (declared payload and success schemas), X-6 (a typed `HttpApiClient`), X-7 (the request log format), O-9, O-10; O-5 updated, O-6 retired. CLAUDE.md's gotchas "One runtime, disposed on shutdown", "Middleware factories are TDZ-safe",
  "Middleware chain order is load-bearing", "API import cycle", "The origin guard", "The CSP", "The idioms test" (rule (14)) and "The error family" were rewritten to the E7 shape, two Hono-era gotchas moved to "Retired gotchas", and the ADR list gained 0015.
- **Not done, by plan section 8:** the declared schemas and `HttpApiClient` (X-5, X-6), serving OpenAPI, E8's review findings, the `db/client.ts` process-wide instance, any change to `apps/web`, the Dockerfile, compose, the Caddyfile, a `docs/API.md` row, a catalog string, a table or a migration.
