# 0015: The HttpApi server: what E7 does differently from `docs/EFFECT.md` (records plan e7 D1 to D7, P3, P12; E8)

Date: 2026-11-05

## Context

Milestone E7 of `docs/EFFECT.md` (plan `docs/plans/e7-http-api.md`) replaced Hono with `effect/http-api` served by
`BunHttpServer` (decision E8). The §4 E7 row lists `HttpApiMiddleware` for "session, household role, module, verified
e-mail, locale, origin guard, security headers, cors", and E8 says a module contributes "`HttpApiGroup`s plus their
handler layer". Building it showed that two of those sentences cannot be followed to the letter without changing what
the API answers, and that a handful of smaller differences ship with the cutover. The observable contract stayed
frozen: every `docs/API.md` row, status, body and header, the middleware order, the signed `/uploads`, the CSP hashes,
the exit codes. What follows is the list of where the code differs from the text of `docs/EFFECT.md`, so that the next
reader does not mistake a deliberate choice for an oversight.

## Decision

1. **CORS, the origin guard and the security headers are global router middleware, and there is no locale middleware
   (plan D6, P11, P4).** An `HttpApiMiddleware` wraps an endpoint, so it never sees the CORS preflight, the static web,
   `/uploads` errors, the fallback `404` or any request no endpoint matches, and all of those carry these headers today
   (`apps/api/test/http-contract.test.ts` rows 2 to 4). `globalHttpLayer()` (`apps/api/src/http/global.ts`) registers
   the request log, the security headers, CORS for `/api/*` and the origin guard with `router.addGlobalMiddleware`, one
   after the other in ONE generator (the first registered is the outermost; a `Layer.mergeAll` would build them
   concurrently and the order would no longer be fixed). The locale is negotiated where a message is rendered
   (`requestLocale` in `apps/api/src/http/request.ts`, the boundary in `apps/api/src/http/response.ts`); there is no
   middleware for it, because its only job under Hono was to run before `onError`. Session, household role, module and
   verified e-mail ARE `HttpApiMiddleware`s with the same names and the same 401, 403, 404 order, as the row says.
   `docs/EFFECT.md` §4's E7 row is amended in this commit.
2. **A module contributes `HttpApi`s that wrap its groups, plus the handler layer (plan D7, P14).** `ModuleHttpApi =
   { apis, handlers }` (`apps/api/src/modules/types.ts`), `householdApi` and `userApi` on the manifest, one `HttpApi`
   per route file (`recipe.recipes`, `finance.transactions`, …). The API is where the module prefix and the module
   chain (`householdModuleApi` / `userModuleApi` in `apps/api/src/http/middleware.ts`) are attached and where
   `moduleRoutesLayer` (`apps/api/src/modules/mount.ts`) reads them to assert the chain at layer build; the groups
   stay the unit of handlers. The handler layer is typed `Layer<any, never, any>` on purpose (a contract cannot name a
   module's group services; the gap is closed by the build-time assertion and by `apps/api/test/modules.test.ts` (m),
   which builds the real `API_MODULES`). `docs/EFFECT.md` E8's wording is amended in this commit; SPEC §2 and the
   module docs were updated by E7-T11.
3. **Endpoints declare method, path, `params` and middleware, not payload, query, success or error schemas (plan
   P3).** HttpApi's own decoding answers an empty `400` where `docs/API.md` pins a `422 validation_failed` envelope and
   a `400 bad_request`, and its success encoding drops every key a schema does not declare. Bodies and queries are
   decoded in the handler by `apps/api/src/http/request.ts` (`jsonBody`, `queryParams`, the two raw-JSON forms) with
   `validate.ts`'s `ALL_ISSUES` decode, responses are `HttpServerResponse`s built by `apps/api/src/http/response.ts`.
   The OpenAPI document of these definitions therefore lists methods, paths and path parameters only. The
   definitions live in `apps/api` beside their handlers, not in `packages/shared` (the web keeps its E6 clients, so the
   bundle is untouched). Declared schemas and a typed `HttpApiClient` are open work (`docs/open-work.md` X-5, X-6).
4. **Shutdown is bounded and the server is not a managed fiber of the runtime (plan D4, P12; corrected by E7-T13).**
   SIGTERM and SIGINT interrupt the server fiber, bounded to 5 s (`Fiber.interrupt` under `Effect.timeoutOrElse`);
   a request still running after that is abandoned, and the module shutdowns, `runtime.dispose()`, the database close
   and `process.exit(0)` run inside Docker's 10 s stop timeout. The first implementation forked the server with
   `runtime.runFork`; `ManagedRuntime.dispose` interrupts AND AWAITS every fiber it forked, and the server layer's
   finalizer (`server.stop()`, which waits for every request in flight, the handlers being uninterruptible) held the
   dispose, so a slow upload in flight stretched the stop to 8.9 s and would have held it for as long as the slowest
   request. `apps/api/src/index.ts` now forks the server with `Effect.runForkWith(await runtime.context())`: the same
   services and memo map, a fiber the dispose does not wait for. Measured: 5.03 s with a slow upload in flight, 23 to 48
   ms idle, 354 ms through `docker compose stop` (`docs/plans/e7-http-api.md` 9.4). `BunHttpServer` binds
   `hostname: "0.0.0.0"` explicitly (Bun's auto-serve bound that; the layer's own default is `"::"`).
5. **Smaller differences that ship (plan D1, D2, D3):**
   - D1: an unknown path BELOW a module sub-router (`…/finance/transactions/x/y`) passes session, member and module and
     answers the JSON `404`; it no longer also passes that sub-router's own gates (verified e-mail, finance participant)
     first. The module prefix keeps the 401, 403, 404 order (`modules.test.ts` (k)). No `docs/API.md` row is affected.
   - D2: a cookie is keyed by its name on the Effect response, so setting the same cookie twice in one request (a
     stale-cookie clear, then a new session) sends ONE `Set-Cookie` with the last value where Hono appended two; a
     browser ends in the same state. The attribute set is unchanged and the session cookie's order equals Hono's (`Max-Age`, `Path`,
     `HttpOnly`, `SameSite=Lax`, `Secure` in production).
   - D3: the request log is Hono `logger()`'s two lines (`<-- METHOD path`, `--> METHOD path STATUS TIME`) from
     `apps/api/src/middleware/requestLog.ts`, pathname only (a signed upload URL carries `sig`); the time comes from the
     `Clock`. Nothing pins the format.
   - Routing is by specificity (find-my-way) instead of registration order: the invite-token routes beside
     `/:householdId`, `…/shopping-lists/bought` beside `…/:listId` and `…/participants/me` beside `…/:userId` no longer
     depend on the order they are declared in.

## Consequences

- `docs/EFFECT.md` §4's E7 row and E8's wording are edited in this commit, and E8 gains an "As built (E7)" paragraph.
  CLAUDE.md's ADR list names this record.
- Hono is gone from `apps/api/package.json`, `bun.lock` and every import (idioms rule (14), no allow list).
  `docs/API.md` "Middleware chain and mount order" and "Security headers and the CSP" are rewritten in HttpApi terms;
  no row changed.
- A contributor who adds a module route writes an `X.api.ts` leaf (endpoints, `householdModuleApi`) and the handler
  layer beside it; nothing in `apps/api/src/index.ts` changes. A new global concern (a header every response must carry)
  goes into `globalHttpLayer()` in order, never into a `HttpApiMiddleware`.
- The server fiber is outside the runtime's fiber scope. A future change that wants the runtime to own and interrupt
  it must first make the handlers interruptible or bound the stop another way, and re-measure the in-flight stop
  (`docs/plans/e7-http-api.md` 9.4).
- Reversal: restoring Hono means restoring the P17 sections from git history (`98b027c5f^`); nothing else depends on it.
