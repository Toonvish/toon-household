# E6 — web-client: plan

**Status: DONE (2026-11-05), planned with revision 1 after review; integration record in section 9, deviations in section 10.** Base commit `f16544915` (`E5-T10: integration record, ADR 0014 status
after E5, docs sync`), Bun 1.4.3 on the host (`.bun-version` says 1.4.2; nothing here depends on the difference). Sections 9 and 10
(the integration record and "what changed vs plan") are written by E6-T10, which also commits this file.

Revision 1 (same day) answers the plan review: response decoding skips the schemas' checks (`disableChecks`, P7), a WRITE's response
never fails on decode and `invalid_response` is never retried (P7, P7a), a new task E6-T02b runs the decode oracle over the migrated
legacy fixtures and ships the env-gated snapshot sweep the owner runs (P7b), E6-T09 applies every `lenient` row of the three contract
tests to all three clients with a two-way grep check (P7c), the decoded type is `Types.DeepMutable` with one cast in the helper (P3),
rule (13c) has two separate allow lists and word-bounded patterns (P13), the tagged errors' field schemas are permissive and named
(P5, P12), the import client's lost `statusText` is deviation D4 (P12), the stale-client consequence of strict structure is written down
(section 7, D5), and the `files` lists of E6-T02 / E6-T03 name every schema file a fix can need (section 3).

E6 is the seventh milestone of the Effect migration (`docs/EFFECT.md` §4 E6; decision **E11** for the web, with E4 for the shared
schemas the web decodes with, E6 for the tagged error, E7 for the one runtime, E9 for the tests, E12 for the idioms). The web app gets
ONE `ManagedRuntime` (`apps/web/src/lib/runtime.ts`) over a `WebLayer` built from `FetchHttpClient` (`effect/http`), and its API
clients (`apps/web/src/lib/api.ts`, `apps/web/src/modules/recipe/lib/api.ts`, `apps/web/src/modules/finance/lib/api.ts`,
`apps/web/src/modules/recipe/features/import/lib/importApi.ts`) describe every request ONCE as an Effect that decodes the response
with the shared `Schema` and fails with the tagged `ApiError`. TanStack Query, the router, the persist policy, the outboxes and
`PERSIST_BUSTER` stay exactly as they are (SPEC D9, E11). The guiding sentence holds: how the code is written changes, not what it does.
No `docs/API.md` row, German string, query key, persisted shape, request header, URL or status handling changes.

Exit (`docs/EFFECT.md` §4 E6 and the milestone task): gates green (`bun install --frozen-lockfile`, `bun run typecheck` with the three
web projects, `bun test`, `bun run build`, `bun run i18n:check` read by hand); the pass count not below E5's record (14785, re-measured
as this plan's baseline, section 1.2); `apps/web/src/lib/api.test.ts` extended with a decode-failure case and a 401 case; the shopping
and finance outbox tests, `apps/web/src/lib/persist.test.ts`, `apps/web/src/lib/query-client.test.ts` and
`apps/web/src/lib/session-purge.test.ts` unchanged and green; the three contract tests green with every `lenient` row applied in the
clients; the LINKS greps of both module docs print nothing; the headless checks of CLAUDE.md (login via `fetch`, a shopping-list offline
check-off replayed after a reload, a finance capture replayed after a reload while offline, `scrollWidth <= clientWidth` at 390 and 1440
on Home and one screen per module) pass against the built app served by `WEB_DIST_DIR`; the CSP `connect-src` check at the second origin
`127.0.0.1:3001` shows no console error; the gzipped bundle growth is recorded (section 1.3 before, section 9 after) and under 60 kB,
else an ADR explains it; web code imports from `"effect"` and `"effect/http"` only; `git status --porcelain repos/` empty;
`apps/api/test/effect-idioms.test.ts` green with the new rule (13) (P13).

## 1. Context

### 1.1 State of the tree at plan time (`f16544915`, measured 2026-11-05)

- **E0 to E5 are done.** The API is Effect underneath (`apps/api/src/runtime.ts`, `AppLayer`, the tagged error family in
  `apps/api/src/lib/errors.ts`), Hono stays until E7, the scripts are Effect programs. Nothing in `apps/web` has moved yet except E1's
  form validation: `apps/web/src/lib/validation.ts`, `apps/web/src/core/features/households/components/InvitePanel.tsx` (a form
  schema with `Schema.withDecodingDefault(Effect.succeed(...))`) and
  `apps/web/src/modules/recipe/features/import/lib/importApi.ts` (`Schema.decodeUnknownResult` in `parseOrPassThrough`) import
  `effect` today. No web file imports `effect/http`.
- **The transport today.** `apps/web/src/lib/api.ts` (≈640 lines) is "the ONLY place in the web app that talks to the network": the
  base URL rules (`API_BASE_URL`, `PUBLIC_API_URL` / `VITE_API_URL`, the `import.meta.env.PROD ? "" : "http://localhost:3001"`
  fallback pinned by source in `apps/web/src/lib/api.test.ts`), `apiUrl`, `mediaUrl`, `thumbnailUrl`, the class `ApiError extends
  Error` (`name = "ApiError"`, `code`, `status`, `details`, getters `isClientError` (`400 <= status < 500`), `isUnauthorized`,
  `isForbidden`, `isNotFound`, `isOffline` (`code === "network_error"`)), the alias `ApiClientError`, `isApiError` (`instanceof`),
  `errorMessage`, the 401 hook (`setUnauthorizedHandler`, `handleUnauthorized`: no redirect from `/login`, `/register`, `/invite/…`, at
  most one per second, else `window.location.assign`), `queryString`, `seg`, `RequestOptions { signal?, allowUnauthorized? }`, ONE
  `request<T>(path, input)` over `fetch` (headers `Accept: application/json`, `Accept-Language: getLocale()`, `Content-Type:
  application/json` for a JSON body; `credentials: "include"`; an `AbortError` is rethrown as is, any other `fetch` rejection becomes
  `ApiError { code: "network_error", status: 0, message: translate("common.error.network"), details: cause }`; a 401 without
  `allowUnauthorized` calls the hook; 204/205 resolve `undefined`; the body is read as text and `JSON.parse`d tolerantly; a non-2xx
  becomes `toApiError(status, parsed, raw)` with the envelope's `code` / `message` or `fallbackCode` / `fallbackMessage`; a 2xx resolves
  the parsed body UNVALIDATED as `T`), `assertUploadSize` / `fileForm` (the 15 MB cap, `common.upload.tooLarge`), and 41 endpoint
  functions plus the `api` facade object. `apps/web/src/modules/recipe/lib/api.ts` (860 lines, 62 exports) and
  `apps/web/src/modules/finance/lib/api.ts` (456 lines, 34 exports) build on `request`, `queryString`, `seg` (finance only: the recipe
  paths interpolate ids raw, and that stays), `fileForm`, and `export * from "@/lib/api"`. `importApi.ts` has its own transport: three
  `fetch` calls (no `Accept-Language`, no 401 hook, failures mapped by `toImportApiError(status, payload, response.statusText)` to
  `ImportApiError` with catalog KEYS, recipe gotcha R4; `statusText` is the `{ text }` fallback headline of the `unknown` kind when the
  envelope has no `message`), one `XMLHttpRequest` multipart upload with progress and a 4-minute timeout (WITH `Accept-Language`, using
  `xhr.statusText`), and `parseOrPassThrough` (a schema mismatch only logs in DEV and passes the payload on).
- **Callers.** 19 files import from `@/lib/api`, about 50 from the three API files in all (screens, `mutationFn`s, the outboxes
  `apps/web/src/modules/recipe/features/shopping/lib/offline.ts` and `apps/web/src/modules/finance/features/transactions/lib/offline.ts`,
  `apps/web/src/lib/session.tsx`, `apps/web/src/lib/i18n/store.ts`). `queryFn`s sit in five files: `apps/web/src/lib/queries.ts`
  (9), `apps/web/src/modules/finance/lib/queries.ts` (12), `apps/web/src/modules/recipe/lib/queries.ts` (16),
  `apps/web/src/modules/recipe/features/recipes/lib/queries.ts` (1), `apps/web/src/modules/recipe/features/import/lib/queries.ts` (3);
  every one of them except the import ones has the shape `({ signal }) => fetchX(args, { signal })`.
- **Retries today.** `shouldRetry` (`apps/web/src/lib/queries.ts`) refuses a retry only for `isApiError(error) && error.isClientError`,
  else retries twice; the QueryClient's queries use it, mutations default to `retry: false`, the shopping outbox's defaults set `retry: 1`
  and the finance outbox's `retry: shouldRetry` (`apps/web/src/modules/finance/features/transactions/lib/offline.ts`, which explains why
  not `false`). A 2xx is never an error today.
- **Tests that pin the transport.** `apps/web/src/lib/api.test.ts` and `apps/web/src/modules/finance/lib/api.test.ts` stub
  `globalThis.fetch` in `beforeEach` (a NEW stub per test), record `String(input)`, `init.method` and `init.body` only when it is a
  STRING, answer `204` to everything and `await` JSON endpoints (`fetchHousehold`, `fetchBalance`, …) against that 204.
  `apps/web/src/lib/query-client.test.ts` constructs `new ApiError({ code, status, message })`;
  `apps/web/src/lib/session-purge.test.ts` reads `session.tsx`'s source for `setUnauthorizedHandler((next) => {` →
  `setActiveCacheUser(null)` → `purgePersistedCache()` → `navigate({ to: "/login"`; the outbox tests
  (`apps/web/src/modules/recipe/features/shopping/lib/offline.test.ts`,
  `apps/web/src/modules/finance/features/transactions/lib/offline.test.ts`) never run a `mutationFn`.
- **The data the server holds is not only data this app wrote.** Since the cutover (2026-10-16) production holds rows migrated from both
  archived apps, the ledger states only the migration writes (ADR 0005: a lone slot-2 participant re-seated, an income naming a
  non-participant, a one-participant finance household), placeholders (ADR 0006) and names stored before the `1715207` hardening. The
  committed fixtures `apps/api/test/fixtures/legacy/` (`recipe.db`, `finance.db`, `uploads/`, `facts.ts` with plain passwords) contain
  these states on purpose, and `apps/api/test/legacy-placeholders.test.ts` shows how a real `apply` goes into the shared test DB and is
  cleaned up again.
- **Facts of the vendored source that shape the design** (`repos/effect/packages/effect/src/http/FetchHttpClient.ts`,
  `http/HttpBody.ts`, `http/HttpClientResponse.ts`, `Context.ts`, `SchemaAST.ts`, `Schema.ts`):
  1. `FetchHttpClient.Fetch` is a `Context.Reference` whose default `() => globalThis.fetch` is evaluated ONCE and cached on the
     reference (`getDefaultValue`, `Context.ts:1065`). A test that replaces `globalThis.fetch` per test would only ever be seen the
     first time. The `WebLayer` therefore provides `Fetch` as a late-bound wrapper (P2).
  2. `HttpClientRequest.bodyJson` / `bodyText` / `HttpBody.text` produce a `Uint8Array` body; `FetchHttpClient` hands `fetch` the
     BYTES, so the tests' `typeof init.body === "string"` assertions would see `null`. A JSON body is
     `HttpBody.raw(JSON.stringify(body), { contentType: "application/json" })` (a `Raw` body is passed to `fetch` as is;
     `setBody` sets `content-type` from it), byte-identical to today (P3).
  3. `HttpClientResponse` has no `statusText`: the web response is `private readonly source` (`HttpClientResponse.ts:276`) and the module
     exports no accessor for it (P12, D4).
  4. `SchemaAST.ParseOptions` (`SchemaAST.ts:490-545`) knows `onExcessProperty: "ignore" | "error"` only, so a decode STRIPS keys a schema
     does not declare, and `disableChecks: true`, which "skips validation checks while still applying defaults and transformations".
     `Schema.decodeUnknownEffect(schema, options?)` takes the options (`Schema.ts:1524`); `Schema.MakeOptions` has `disableChecks` too
     (`Schema.ts:136`), which is how `apps/api/src/lib/errors.ts` constructs its legacy `ApiError`.
  5. A decoded `Schema.Struct` / `Schema.Array` value is READONLY-typed; the shared package exports every response type as
     `Types.DeepMutable<typeof X.Type>` (e.g. `MeResponse` in `packages/shared/src/core/schemas/auth.ts`), and a `ReadonlyArray` is not
     assignable to an `Array` (P3).
  Also: `Url.make` resolves a relative URL against `location.origin + location.pathname` in the browser, so the production base
  `""` (`/api/...`) works; `runPromise` rejects with `Cause.squash(cause)`, which for an interruption is a plain
  `Error("All fibers interrupted without error")`, not today's `AbortError` (P1 maps it back); the `HttpClient` adds `b3` and
  `traceparent` headers unless `HttpClient.TracerPropagationEnabled` is `false` (P2).

### 1.2 Baseline

`bun test` at `f16544915`, 2026-11-05: **14785 pass, 0 fail, 383956 expect() calls, 14785 tests across 170 files, 49.57 s** (log
ends `exit=0`). Every task verifies `pass >= 14785` and `0 fail`; E6 adds tests, so the record at the end is higher.

### 1.3 Bundle size (before)

`bun run build` at `f16544915` (Vite 8 / rolldown reporter, the `gzip:` column): **84 JS chunks, 402.54 kB gzipped in total**, CSS
12.92 kB gzipped. The two big chunks: `dist/assets/queries-*.js` 507.73 kB (140.85 kB gzip; the shared schemas and `effect` already
live here since E1) and `dist/assets/index-*.js` 264.09 kB (83.83 kB gzip); PWA precache 104 entries (1456.28 KiB). The measurement
(E6-T10 repeats it on the final tree; growth = after − before, threshold 60 kB):

```bash
L=$(mktemp); bun run build > "$L" 2>&1; echo "exit=$?" >> "$L"
grep -E 'dist/assets/.*\.js ' "$L" | awk -F'gzip:' '{gsub(/ kB/,"",$2); s+=$2; n++} END {printf "js=%d gzip_total=%.2f kB\n", n, s}'
grep -E 'dist/assets/(index|queries)-' "$L"
```

## 2. Decisions (binding for the tasks)

Each names the `docs/EFFECT.md` decision it serves. A task that cannot follow one makes the smallest deviation and records it in its
commit body; E6-T10 copies it to section 10.

**P1 — One runtime, `apps/web/src/lib/runtime.ts` (E11, E7).** The file exports `WebLayer`, `runtime` and `runPromise`.
`runtime = ManagedRuntime.make(Layer.suspend(webLayer))` where `webLayer` is a hoisted `function` declaration returning
`Layer.provideMerge(ApiClient.layer, transportLayer())` (P2, P3): the module scope reads only `Layer` and `ManagedRuntime` (the
API's rule, CLAUDE.md "One composition point, evaluated lazily"), because `api-client.ts` → `i18n/store.ts` → `api.ts` →
`runtime.ts` is an import cycle (P16). It is never disposed (it lives as long as the page). `runPromise(effect, options?: { signal?:
AbortSignal })` is the ONE way web code runs an API effect: `runtime.runPromiseExit(effect, { signal })`, then success → the value;
failure with `Cause.hasInterruptsOnly(cause)` and `signal?.aborted` → `throw signal.reason ?? new DOMException("Aborted",
"AbortError")` (today's `AbortError` rethrow); any other failure → `throw Cause.squash(cause)` (the tagged error itself). Its type
accepts `Effect<A, E, WebServices>` where `WebServices = ApiClient | HttpClient.HttpClient`. `apps/web/src/lib/runtime.ts` joins
`RUNTIME_ALLOW_LIST` in `apps/api/test/effect-idioms.test.ts` (rule (5); its comment already announces it). Read:
`agent-patterns/effect-services.md` §3.2 and §6, `repos/effect/ai-docs/src/04_integration/10_managed-runtime.ts`,
`repos/effect/packages/effect/src/ManagedRuntime.ts`.

**P2 — The transport layer (E11).** `transportLayer()` in `runtime.ts` is `FetchHttpClient.layer` provided with
`Layer.succeed(FetchHttpClient.RequestInit, { credentials: "include" })`, `Layer.succeed(FetchHttpClient.Fetch, (input, init) =>
globalThis.fetch(input, init))` (late-bound: the stubs of the existing tests and any later replacement are seen; section 1.1 fact 1;
this is the ONE `fetch(` call of the web app, allowed by rule (13c)) and `Layer.succeed(HttpClient.TracerPropagationEnabled, false)`
(no `b3` / `traceparent`: the request headers stay exactly today's, and the dev setup's cross-origin calls get no new preflight header).
No `HttpClient.filterStatusOk` (a status is mapped by P4, not turned into an `HttpClientError`), no `retryTransient` and no
`followRedirects` (TanStack's `shouldRetry` / `retryDelay` own retries; `fetch` follows redirects as today). Verify each name in
`repos/effect/packages/effect/src/http/{FetchHttpClient,HttpClient}.ts` before use; `agent-patterns/effect-http-client.md` §2(e), §6.

**P3 — `ApiClient`, the request described once (E11, E12).** New file `apps/web/src/lib/api-client.ts`: the tagged `ApiError` (P5),
the 401 hook (P10), the envelope mapping (`fallbackCode`, `fallbackMessage`, `toApiError` moved verbatim from `api.ts`), and the
service `class ApiClient extends Context.Service<ApiClient, { execute(spec: ApiRequest): Effect<ApiResponse, ApiError> }>()
("toon/web/ApiClient")` with a static `layer` that yields `HttpClient.HttpClient` inside its generator (no imported binding but
`effect` exports and its own class at the static's evaluation, the API's TDZ rule). `ApiRequest = { method, url, body?, form?,
allowUnauthorized? }` where `url` is ALREADY the full URL (the base URL rules stay in `api.ts`, whose source the test pins).
`execute` is `Effect.fnUntraced` (a hot path; no span per request) and builds `HttpClientRequest.make(method)(url)` →
`HttpClientRequest.setHeaders({ accept: "application/json", "accept-language": getLocale() })` → for a JSON body
`HttpClientRequest.setBody(HttpBody.raw(JSON.stringify(body), { contentType: "application/json" }))`, for a form
`HttpClientRequest.bodyFormData(form)` (no content type: the browser sets the boundary) → `client.execute`. The helpers the endpoint
files use live in `apps/web/src/lib/api.ts` (they need `apiUrl`): `getJson(schema, path, options?)`, `sendJson(method, schema, path,
body?, options?)`, `sendForm(schema, path, file, options?)` (P11), `sendVoid(method, path, body?, options?)`, and the marker
`lenient(schema)` (P7c). **Their type:** `getJson` / `sendJson` / `sendForm` return `Effect<Types.DeepMutable<S["Type"]>, ApiError,
ApiClient>` (`Types` from `"effect"`), so every facade keeps today's `Promise<HouseholdListResponse>` etc. with no cast at the call
site; the ONE cast (`as Types.DeepMutable<S["Type"]>`) sits inside the shared decode step of the helpers, with a comment: decoding
builds fresh objects and arrays, so handing them out mutable is sound, and a raw payload handed out by the pass-through paths (P7a,
P7c) is the parsed JSON, also fresh. `sendVoid` returns `Effect<void, ApiError, ApiClient>`. No other cast of a decoded value anywhere.
`request<T>` stays as a LEGACY BRIDGE (no decode, today's semantics, through `runPromise`) only while
`apps/web/src/modules/{recipe,finance}/lib/api.ts` still call it, and E6-T09 deletes it. Read: `repos/effect/LLMS.md` "Writing Effect
services", `agent-patterns/effect-http-client.md` §2–§4, `repos/effect/ai-docs/src/50_http-client/10_basics.ts`.

**P4 — The response, in today's order (E11, behaviour frozen).** Inside `ApiClient.execute` after the response arrives: (1)
`status === 401 && !allowUnauthorized` → `Effect.sync(handleUnauthorized)`; (2) `204` or `205` → succeed with no body (the helpers
return `undefined` typed as the result WITHOUT decoding, exactly as `request<T>` did; the existing tests `await fetchHousehold(...)`
against a 204); (3) read `response.text`, `JSON.parse` it in a `try` (invalid JSON → `undefined`, today's rule); (4) not `ok` → fail
with `toApiError(status, parsed, raw)` (verbatim); (5) `ok` → hand `{ status, parsed }` to the helper, which decodes (P7). A response
body that cannot be read (`HttpClientError` reason `DecodeError` / `EmptyBodyError` on `text`) and every request-side reason
(`TransportError`, `InvalidUrlError`, `EncodeError`) become `ApiError { code: "network_error", status: 0, message:
translate("common.error.network"), details: error.reason.cause ?? error }` (today: the raw `fetch` rejection was the `details`;
a body read that failed mid-stream used to reject with the raw `TypeError` and now is a `network_error`: recorded deviation D1).
Match with `Effect.catchTag("HttpClientError", …)` and a `switch` on `error.reason._tag`, never `instanceof` (E12).

**P5 — `ApiError` is a `Schema.TaggedError` with today's shape and permissive fields (E6, E11).** `class ApiError extends
Schema.TaggedError<ApiError>()("ApiError", { code: Schema.String, status: Schema.Number, message: Schema.String, details:
Schema.optional(Schema.Unknown) })` with the five getters unchanged (`isClientError` stays `400 <= status < 500`, `isUnauthorized`,
`isForbidden`, `isNotFound`, `isOffline`). The field schemas are deliberately PERMISSIVE, as in `apps/api/src/lib/errors.ts` ("a
constructor never throws on a value today's code passes"): a `Schema.TaggedError` constructor validates its input, and it runs inside
error paths (`toApiError`, `assertUploadSize` / `uploadForm`, the decode-failure path, the network path, `query-client.test.ts`,
`validation.test.ts`); no field gets a check, a literal union or a refinement. `error.name` stays `"ApiError"` (override it if the
vendored class gives another name; verify in `repos/effect/packages/effect/src/Schema.ts`, `TaggedError`, line ≈16278, and the core
error class it extends). The constructor keeps the object shape `new ApiError({ code, status, message, details? })`; verify that a
`message` FIELD becomes `error.message` (`errorMessage` renders it); if it does not, keep the field and add `override get message()` as
`apps/api/src/lib/errors.ts` does. `isApiError(u): u is ApiError` is `Predicate.isTagged(u, "ApiError")`. `api.ts` re-exports
`ApiError`, `ApiClientError` (the alias) and `isApiError`, so every existing `import { ApiError } from "./api"` / `"@/lib/api"` /
`"@/modules/<id>/lib/api"` keeps compiling. A client-only code beside `network_error`: `invalid_response` (P7). `client_error` stays
mentioned in the doc comment as today. E6-T01 adds one test that constructs an `ApiError` for every shape the code produces (envelope,
fallback 500, `network_error` with an `Error` / a `TypeError` / `undefined` as `details`, `payload_too_large`, `invalid_response` with a
string `details`) and asserts no throw, `_tag`, `name`, `message`, `status`, `code`.

**P6 — Abort and network semantics (E11, behaviour frozen).** A cancelled TanStack query aborts its `signal`; `runPromise` passes it
to `runPromiseExit`, the fiber is interrupted, the `HttpClient` aborts its own `AbortController` (the request is really cancelled), and
P1 rethrows `signal.reason` (a `DOMException` named `AbortError`, today's rejection). A `fetch` that rejects while the signal is NOT
aborted is a `network_error` as today (`isOffline` true; `shouldRetry` retries it twice).

**P7 — Responses are decoded with the shared schema, structure and types only; the contract tests prove decoding is the identity on the
wire (E4, E11).** Every JSON endpoint names the `@toon/shared` `…ResponseSchema` of its `T` (each response type the web requests has one:
section 1.1 and the `ResponseSchema` list of `packages/shared/src`). The helpers decode with ONE options constant, `DECODE_OPTIONS = {
disableChecks: true }` (section 1.1 fact 4): `Schema.decodeUnknownEffect(schema, DECODE_OPTIONS)(parsed)`. So the response decode checks
the STRUCTURE and the TYPES (object keys, `string` / `number` / `boolean` / `null`, arrays, literal unions such as `TxKind`, `TagKind`,
`InviteStatus`, a role) and runs the transformations, and it does NOT run the wire checks the shared schemas carry for REQUESTS (the
UUID pattern of `IdSchema`, the ISO pattern, lengths such as `RecipeIngredientRecord`'s, step text 1..5000, `servingsAmount` positive,
rating 0..5, `PeriodSchema`'s 2000-01..2100-12, integer and range checks). Reason: the server is the authority on those checks and
already applied them on the way in; rows written before a limit tightened, migrated legacy rows and placeholder rows must still render as
they do today, and the old client never checked them. A READ (`getJson`) whose decode fails fails with `new ApiError({ code:
"invalid_response", status: <the 2xx status>, message: translate("common.error.unknown"), details: <the SchemaError's message> })` (no
new catalog key, no new German). Because a decode strips keys a schema does not declare and runs its transformations
(`withDecodingDefault…`, `decodeTo`), E6-T02 and E6-T03 add contract tests (`apps/api/test/web-contract-core-recipe.test.ts`,
`apps/api/test/web-contract-finance.test.ts`) that drive the REAL app through `app.request` over seeded data and assert, for every
route the web clients decode, that `Schema.decodeUnknownSync(schema, { disableChecks: true })(body)` succeeds AND `expect(decoded)
.toEqual(body)` (nothing stripped, nothing transformed); E6-T02b runs the same oracle over migrated legacy data (P7b). A route whose
schema fails that oracle is a finding: fix the shared schema when `packages/shared/test` (the golden and parity tests of E1 included,
never edited) stays green, else mark the row `lenient` (P7c) and list it as deviation D3. `apps/web/src/lib/api.test.ts` gains the
decode-failure case (P14).

**P7a — A write never fails on its response, and `invalid_response` is never retried (E11, D9, behaviour frozen).** A 2xx to a POST,
PATCH, PUT or DELETE proves the server APPLIED the write; failing it would roll back an applied optimistic update (`onError`), drop the
paused capture from the outbox and retry a request the server already took (the shopping outbox's `retry: 1`, the finance outbox's
`retry: shouldRetry`). So `sendJson` and `sendForm` decode with the same options and, on a decode failure, log the issue once in DEV
(`import.meta.env.DEV`, as `parseOrPassThrough` guards it) and SUCCEED with the parsed payload, exactly today's behaviour; they never
produce `invalid_response`. Only `getJson` (a read: idempotent, refetchable) fails with it. And `shouldRetry` gains one condition
(E6-T07): `if (isApiError(error) && (error.isClientError || error.code === "invalid_response")) return false;` — a schema mismatch is
deterministic, so a retry only delays the error screen by the backoff; `isClientError` keeps its 4xx meaning. The decision is pinned by
`apps/web/src/lib/should-retry.test.ts` (E6-T07) and by T01's write-pass-through case in `apps/web/src/lib/api.test.ts`.

**P7b — The oracle also runs over data this app never wrote (E4, E11; ADR 0005, ADR 0006).** E6-T02b's
`apps/api/test/web-contract-legacy.test.ts` applies the committed legacy fixtures (`apps/api/test/fixtures/legacy/`, recipe AND finance,
with uploads) through `runLegacyMigration` (`apps/api/scripts/legacy/run.ts`) into the SHARED test DB the way `apps/api/test/legacy-placeholders.test.ts` does (assert first
that no fixture e-mail exists, record the row counts, delete in `afterAll` everything the run wrote, households first, and assert the
counts are back), logs in as every migrated account that has a password (`apps/api/test/fixtures/legacy/facts.ts`) and decodes every
READ route the three web clients call over every migrated household that account belongs to (core, recipe, finance; the ADR 0005
households included) with P7's oracle. The same file holds a second `describe`, the **snapshot sweep**, that runs only when
`WEB_CONTRACT_SNAPSHOT=1` is set (`describe.skipIf`, with a comment naming `docs/open-work.md` and this decision; never silently skipped
otherwise, the default run prints its skip): against the DB of `TEST_DATABASE_URL` (the owner's local COPY of a production snapshot,
outside the repo) it mints a session for one member of each household through the core `Sessions` service, runs the same read sweep, and
prints counts only (routes decoded, failures per schema and issue PATH, never a value, a name or an e-mail). E6-T10 records the owner
action in `docs/open-work.md`.

**P7c — Lenient routes: one marker, one list, applied by one task (E11, D3).** A contract row the oracle cannot satisfy without breaking
`packages/shared/test` carries `lenient: { schema: "<XResponseSchema>", reason: "<one line>" }` WRITTEN ON ONE LINE (the grep below
reads it), keeps the assertion that the body is the wire truth, and is named in the commit body. In the clients such a schema is passed
as `lenient(<XResponseSchema>)` (P3's marker: the helper validates with `DECODE_OPTIONS`, logs in DEV on a mismatch and returns the raw
payload, the import rule of P12). E6-T04 applies E6-T02's recipe rows, E6-T05 E6-T03's finance rows; E6-T09 applies EVERY remaining row
(the core rows of E6-T02, which E6-T01 cannot know in the same wave, and all of E6-T02b's) to all three clients and verifies both
directions with the grep of its verify list: every `lenient: { schema: "X"` of `apps/api/test/web-contract-*.test.ts` appears as
`lenient(X)` in one of the three client files, and every `lenient(X)` there (pattern `lenient\([A-Z][A-Za-z]*Schema\)`) is listed in a
contract test.

**P8 — Endpoints as namespaced effects, facades with today's names (E11).** Each client file exports ONE namespace object of endpoint
effects: `CoreApi` (`apps/web/src/lib/api.ts`), `RecipeApi` (`apps/web/src/modules/recipe/lib/api.ts`), `FinanceApi`
(`apps/web/src/modules/finance/lib/api.ts`), `ImportApi` (`importApi.ts`). The member name EQUALS today's function name
(`CoreApi.fetchMe`, `FinanceApi.fetchTransactions`, `RecipeApi.fetchShoppingList`, `ImportApi.listDrafts`), and its parameters are
today's parameters WITHOUT the signal (`options?: RequestOptions` stays the last parameter where it was, the member reads only
`allowUnauthorized` from it and keeps today's hard-coded `allowUnauthorized: true` where the function set it; `ImportApi` members drop
the positional `signal`). Members are plain arrow functions over the P3 helpers (a pipe, not a generator: E12's "no function that only
wraps an `Effect.gen`"); a member that needs logic (`uploadRecipeImage`'s size cap, `fetchDraftSource`'s blob) uses `Effect.fnUntraced`.
Every existing exported function KEEPS its name, signature and `Promise` return type as a facade whose body is exactly `return
runPromise(<Ns>.<name>(<args without signal>), options)` (or `{ signal }` for the import functions): the ~50 calling files (screens,
`mutationFn`s, both outboxes, `session.tsx`, `i18n/store.ts`) do not change, and a forgotten `await` on an Effect cannot silently drop a
request. The path strings, `queryString` arguments and `seg()` use move into the member byte for byte (the recipe paths keep
interpolating ids raw). The `api` facade object of `apps/web/src/lib/api.ts` stays, pointing at the facades.

**P9 — The `queryFn`s run the effects; everything else is untouched (E11, D9).** Every `queryFn` of the five files of section 1.1 calls
`runPromise(<Ns>.<name>(<args>), { signal })` (E6-T07, E6-T08, mechanical, tables in their briefs). Query keys, `staleTime`,
`networkMode`, `retry`, `select`, `enabled`, every `mutationFn`, every `setMutationDefaults` registration
(`apps/web/src/modules/recipe/features/shopping/lib/offline.ts`, `apps/web/src/modules/finance/features/transactions/lib/offline.ts`),
`apps/web/src/lib/persist.ts`, `apps/web/src/lib/query-client.ts` and `PERSIST_BUSTER = "household-v1"` are not edited by any task
(the mutations reach the runtime through the facades, P8). The one edit outside the `queryFn`s is P7a's condition in `shouldRetry`.

**P10 — The 401 hook runs inside the client pipeline (E11).** `setUnauthorizedHandler` / `handleUnauthorized` and their module state
(`unauthorizedHandler`, `lastRedirectAt`) move verbatim to `api-client.ts` (re-exported from `api.ts`, so `session.tsx` and
`session-purge.test.ts` are untouched); the hook is read at CALL time (the seam pattern of the API's `setMailer`), and the only caller is
`ApiClient.execute` (P4 step 1). The purge order (`setActiveCacheUser(null)` → `purgePersistedCache()` → `navigate`) stays in
`session.tsx`'s handler. `Date.now()` stays in `handleUnauthorized` (pure UI throttle; rule (11) covers `apps/api/src` only).

**P11 — The upload cap is part of the request description (E11).** `apps/web/src/lib/api.ts` keeps `assertUploadSize(file)` and
`fileForm(file)` (synchronous, exported, unchanged), and adds `uploadForm(file): Effect<FormData, ApiError>` (the same check and
message, failing instead of throwing). `sendForm` uses it, so `RecipeApi.uploadRecipeImage` / the recipe import uploads fail inside the
effect. Observable difference: the facade REJECTS instead of throwing synchronously; every caller awaits it inside an `async`
`mutationFn` or handler (E6-T04 lists them in its commit body), so the screen sees the same error. Recorded as deviation D2.

**P12 — The import client keeps its own rules on the same runtime (E11, recipe gotcha R4).** `importApi.ts`'s three `fetch` calls go
through `HttpClient.HttpClient` from the runtime (credentials from P2), with its OWN headers (`Accept` and, for a body, `Content-Type`;
NO `Accept-Language`, as today), NO 401 hook, `ImportApiError` mapping via `toImportApiError` unchanged, and `parseOrPassThrough`
unchanged (a mismatch logs in DEV and returns the payload: the review screen must survive an additive server change).
**`statusText`:** the `HttpClientResponse` has none (section 1.1 fact 3), so the three former `fetch` paths call
`toImportApiError(response.status, payload, undefined)`: an unmapped status without an envelope `message` now shows the catalog headline
`recipe.import.error.unknown.title` instead of the reason phrase. Over HTTP/2 behind the Caddy the reason phrase is already empty, so
this is the honest choice and no cast reaches into the private `source`; recorded as deviation D4. The XHR path keeps `xhr.statusText`.
`fetchDraftSource` reads `response.arrayBuffer` and builds `new Blob([buffer], { type })` from the `content-type` header (the shape
`{ objectUrl, mimeType }` and `blob.type`'s lower-casing as `Response.blob()` gave it). The XHR upload stays an `XMLHttpRequest` (fetch
cannot report upload progress; the one `new XMLHttpRequest` of the web app, allowed by rule (13c)) wrapped in `Effect.callback` (resume
once from `onload` / `onerror` / `ontimeout` / `onabort`; the returned finalizer calls `xhr.abort()` on interruption); its rejections stay
byte-identical (`toImportApiError(0)`, the `ocr_timeout` error, a `DOMException("Upload aborted", "AbortError")`).
**`ImportApiError`** becomes `Schema.TaggedError<ImportApiError>()("ImportApiError", { kind, code, status, title, hint, retryable,
details })` with these field schemas, chosen so the class keeps today's PROPERTY TYPES (no widening that would break `describeError`,
`importErrorText.ts` or `resolveImportErrorText`) and the constructor never throws on a value today's code passes:
`kind: Schema.Literals([<the 16 members of ImportErrorKind, in the type's order>])` (and `ImportErrorKind` is then derived as
`typeof ImportErrorKindSchema.Type` or kept as the type with a compile-time equality check: one source, no drift), `code: Schema.String`,
`status: Schema.Number`, `retryable: Schema.Boolean`, `details: Schema.optional(Schema.Unknown)`, and `title` / `hint`:
`ImportErrorTextSchema = Schema.declare<ImportErrorText>((u): u is ImportErrorText => Predicate.isObject(u))` (a permissive guard,
typed as the literal-`MessageKey` union: any object passes at run time, the type stays `{ key: MessageKey; values? } | { text }`; the
same pattern as `Text` in `apps/api/src/lib/errors.ts`). `override get message()` returns `errorTextForLog(this.title)` (today's
`Error.message`); `name` stays `"ImportApiError"`; constructor object shape unchanged (`queries.ts` and `importErrors.test.ts`
construct it); `isImportApiError` via `Predicate.isTagged`. `ImportApi` members and facades follow P8 (facades keep the positional
`signal` / the `UploadHandle`). E6-T06's test constructs every kind `toImportApiError` produces (a table of statuses and codes covering
all its branches, plus status 0) and the two XHR-only ones, asserting no throw and the `kind`.

**P13 — Effect stays at the edge of the web app, and a gate says so (E11, E12).** New idioms rule (13) in
`apps/api/test/effect-idioms.test.ts` (E6-T09), over the comment-free lines of non-test files under `apps/web/src/` (the file's existing
`scan`): (13a) every `from "effect…"` specifier is exactly `"effect"` or `"effect/http"`; (13b) only the files of
`WEB_EFFECT_ALLOW_LIST` import `effect` at all: `apps/web/src/lib/runtime.ts`, `apps/web/src/lib/api-client.ts`,
`apps/web/src/lib/api.ts`, `apps/web/src/lib/validation.ts` (E1, the form adapter),
`apps/web/src/core/features/households/components/InvitePanel.tsx` (E1, a form schema's decoding default),
`apps/web/src/modules/recipe/lib/api.ts`, `apps/web/src/modules/finance/lib/api.ts`,
`apps/web/src/modules/recipe/features/import/lib/importApi.ts` (each with its reason; a stale entry fails like rules (10) and (11));
(13c) the network primitives, two patterns with SEPARATE allow lists, each entry with its reason and a stale entry failing:
`/\bfetch\(/` is allowed only in `apps/web/src/lib/runtime.ts` (P2's late-bound `Fetch`; `\b` keeps the screens' `refetch(` and
`queryClient.fetchQuery(` out, and still catches `globalThis.fetch(` / `window.fetch(` anywhere else) and `/\bnew XMLHttpRequest\b/` is
allowed only in `apps/web/src/modules/recipe/features/import/lib/importApi.ts` (P12's upload progress). The `queries.ts` files import
`runPromise` from `@/lib/runtime`, not `effect`. `PENDING_RULES` keeps only E7's line.

**P14 — Tests (E9).** Web tests run Effect through `runPromise` / `Effect.runPromise` directly (no `@effect/vitest`). Unchanged and
green, files byte-identical: `apps/web/src/lib/persist.test.ts`, `apps/web/src/lib/query-client.test.ts`,
`apps/web/src/lib/session-purge.test.ts`, `apps/web/src/lib/queries.test.ts`, both `offline.test.ts`, both `manifest.test.ts`, both
module `persist.test.ts`, `apps/web/src/modules/finance/lib/queries.test.ts`,
`apps/web/src/modules/recipe/features/import/lib/importErrors.test.ts`. Extended (existing cases untouched, new `describe`s appended):
`apps/web/src/lib/api.test.ts` (E6-T01: a READ's decode failure → `ApiError` with `_tag "ApiError"`, `code "invalid_response"`, the 2xx
status; a READ whose id violates the UUID check but whose structure is right decodes (P7's `disableChecks`); a WRITE whose response
fails the decode resolves the raw payload (P7a); a 401 on a guarded endpoint calls the registered handler once with the current path and
rejects with `isUnauthorized`; a 401 on `fetchMe` does NOT call it; a rejected `fetch` → `network_error`, status 0; an aborted signal → a
rejection named `AbortError`; the request headers `accept`, `accept-language`, `content-type` and `credentials: "include"` reach `fetch`,
and no `b3` / `traceparent`; `assertUploadSize` / `uploadForm` over 15 MB → `payload_too_large`; an error envelope → its `code` and
`message`; a 500 without envelope → `internal_error` with `common.error.serverError`'s text; P5's constructor table) and
`apps/web/src/modules/finance/lib/api.test.ts` (E6-T05: a decoded `TransactionResponse` round trip and the decode-failure case on one
finance READ route). New: `apps/web/src/lib/runtime.test.ts` (E6-T01, P16), `apps/web/src/lib/should-retry.test.ts` (E6-T07, P7a),
`apps/web/src/modules/recipe/lib/api.test.ts` (E6-T04: a path per resource family, the raw-id rule, one decoded response),
`apps/web/src/modules/recipe/features/import/lib/importApi.test.ts` (E6-T06: no `accept-language` on the fetch calls, the pass-through
on a mismatch, `fetchDraftSource`'s blob type, `ImportApiError`'s message, tag, name and the constructor table of P12), the three
contract tests (P7, P7b). A test that needs `window` for the 401 hook sets `globalThis.window` to a stub with `location` and restores it
in `afterEach`; it never sets `globalThis.location` (that would change `Url.make`'s base). The pass count never drops below 14785.

**P15 — Bundle (E11).** Imports from `"effect"` and `"effect/http"` only (P13 (a)); `effect`'s `package.json` declares
`sideEffects` for one file only, so the `effect/http` barrel tree-shakes. E6-T10 measures as section 1.3 and records before / after /
growth; growth ≥ 60 kB gzip needs ADR 0015 (what grew, why, what was tried) before the milestone can close.

**P16 — Import cycles stay safe (E11; CLAUDE.md "API import cycle" in spirit).** `api-client.ts` → `@/lib/i18n/store.ts` →
`@/lib/api` → `@/lib/runtime` → `api-client.ts` is a cycle (store.ts already imports `updateProfile` from `@/lib/api` today). Rules: no
module-scope read of an imported binding in `runtime.ts` (P1's `Layer.suspend`), `api-client.ts` reads `getLocale` / `translate` only
inside functions, `api.ts`'s namespace members are arrow functions (no call at definition), facades are `function` declarations,
`DECODE_OPTIONS` is a plain object literal (no imported binding). `apps/web/src/lib/runtime.test.ts` proves it: for each of
`apps/web/src/lib/api-client.ts`, `apps/web/src/lib/runtime.ts`, `apps/web/src/lib/api.ts`, `apps/web/src/lib/i18n/store.ts`,
`apps/web/src/modules/recipe/lib/api.ts`, `apps/web/src/modules/finance/lib/api.ts`, a fresh `bun` subprocess (cwd `apps/web`, so the
`@/` paths resolve) imports that file FIRST, then runs one facade against a stubbed `fetch` and prints `ok`; plus `runPromise` maps an
aborted signal to `AbortError` and a failure to the tagged error itself.

**P17 — The headless and CSP checks run once, in E6-T10 (E11 exit).** Built app: `bun run build`, then on a fresh temp file DB
(`DATABASE_URL=file:<tmp>/e6.db`, `SESSION_SECRET` of 32 hex, `NODE_ENV=development`) `bun run seed`, then `WEB_DIST_DIR=./apps/web/dist
bun run start` in the background (log ending `exit=$?`). Playwright installed in a scratch directory outside the repo (a `bun add`
log ending `exit=$?`), Chromium, CLAUDE.md "Headless runs" rules: log in with `fetch("/api/auth/login")` from the page as
`demo@toon.local` / `demo1234` and save a `storageState` (the login rate limit); (1) shopping: open a demo shopping list
(`/recipe/shopping/<id>`), `context.setOffline(true)`, check one item off, reload while offline (the service worker serves the shell),
`setOffline(false)`, wait for the replay, assert through `fetch` of the list detail that the item is bought; (2) finance: open
`/finance/new` (or the Erfassen sheet) offline, capture a booking, reload while offline, `PendingSyncNote` visible, go online, assert
the transaction exists through `fetch`; (3) at 390x844 (`isMobile: true, hasTouch: true`) and 1440x900: `/`, one recipe screen
(`/recipe/recipes`) and one finance screen (`/finance`) satisfy `scrollWidth <= clientWidth` and no element's right edge beyond
`innerWidth + 0.5`; (4) CSP: the same built app opened at `http://127.0.0.1:3001` (the second origin), logged in, Home, a recipe and a
finance screen: zero `console` errors and zero `Refused to connect` / CSP violation messages, and no request to `localhost:3001`. The
script and its logs stay in the scratch directory; section 9 records the outcomes and the numbers.

## 3. Waves and file ownership

Two tasks of one wave never share a file. Shared files across waves: `apps/api/test/effect-idioms.test.ts` is edited by T01 (one
allow-list entry) and T09 (rule (13)); `apps/web/src/lib/api.ts` by T01 and T09 (deleting `request`, applying lenient rows);
`apps/web/src/modules/recipe/lib/api.ts` by T04 and T09, `apps/web/src/modules/finance/lib/api.ts` by T05 and T09 (lenient rows only);
`apps/web/src/lib/queries.ts` by T07 only; `CLAUDE.md`, `docs/EFFECT.md`, the pattern files, `docs/open-work.md` and this plan by T10
only. The `packages/shared` schema files are edited only when a contract test finds a mismatch: in wave 1 by T02 (core and recipe files)
or T03 (finance files), never both; in wave 2 by T02b only (none of T04, T05, T06 touches `packages/shared`). The golden corpus
`packages/shared/test/fixtures/schema-golden/` and the parity tests `packages/shared/test/parity/` are never edited by any task.

| Wave | Task | Tier | Owns (creates or edits) |
| --- | --- | --- | --- |
| 1 | E6-T01 runtime, `ApiClient`, the core client | core | `apps/web/src/lib/runtime.ts` (new), `apps/web/src/lib/api-client.ts` (new), `apps/web/src/lib/api.ts`, `apps/web/src/lib/api.test.ts`, `apps/web/src/lib/runtime.test.ts` (new), `apps/api/test/effect-idioms.test.ts` (`RUNTIME_ALLOW_LIST` only) |
| 1 | E6-T02 contract test, core and recipe routes | build | `apps/api/test/web-contract-core-recipe.test.ts` (new); on a finding only: `packages/shared/src/core/schemas/{common,household,user,auth,checks}.ts`, `packages/shared/src/modules/recipe/schemas/{recipe,shopping,card,import,plan}.ts`, and (new cases only) `packages/shared/test/{core,household,recipe-schemas,cards,shopping,schema-checks}.test.ts` |
| 1 | E6-T03 contract test, finance routes | build | `apps/api/test/web-contract-finance.test.ts` (new); on a finding only: `packages/shared/src/modules/finance/schemas/{common,transactions,categories,tags,participants,plan,balance,settlements}.ts`, and (new cases only) `packages/shared/test/finance-schemas.test.ts` |
| 2 | E6-T02b contract test over migrated legacy data, snapshot sweep | build | `apps/api/test/web-contract-legacy.test.ts` (new); on a finding only: the schema and test files of T02 and T03 |
| 2 | E6-T04 the recipe client | build | `apps/web/src/modules/recipe/lib/api.ts`, `apps/web/src/modules/recipe/lib/api.test.ts` (new) |
| 2 | E6-T05 the finance client | build | `apps/web/src/modules/finance/lib/api.ts`, `apps/web/src/modules/finance/lib/api.test.ts` (appended `describe`s) |
| 2 | E6-T06 the import client | build | `apps/web/src/modules/recipe/features/import/lib/importApi.ts`, `apps/web/src/modules/recipe/features/import/lib/importApi.test.ts` (new) |
| 3 | E6-T07 core and finance `queryFn`s, `shouldRetry` | rewrite | `apps/web/src/lib/queries.ts`, `apps/web/src/modules/finance/lib/queries.ts`, `apps/web/src/lib/should-retry.test.ts` (new) |
| 3 | E6-T08 recipe `queryFn`s | rewrite | `apps/web/src/modules/recipe/lib/queries.ts`, `apps/web/src/modules/recipe/features/recipes/lib/queries.ts`, `apps/web/src/modules/recipe/features/import/lib/queries.ts` |
| 4 | E6-T09 bridge gone, lenient rows applied, idioms rule (13) | build | `apps/web/src/lib/api.ts` (delete `request` and what only it used; lenient rows), `apps/web/src/modules/recipe/lib/api.ts` and `apps/web/src/modules/finance/lib/api.ts` (lenient rows only), `apps/api/test/effect-idioms.test.ts` (rule (13)) |
| 5 | E6-T10 integration | build | `CLAUDE.md`, `docs/EFFECT.md` (the E6 status sentence), `agent-patterns/effect-http-client.md` (§7 "In this repo", §6 if a line proved wrong), `agent-patterns/effect-services.md` (§7 web line), `docs/open-work.md` (the snapshot-sweep owner action, P7b; anything deferred), `docs/adr/0015-*.md` (only if P15 needs it), `docs/plans/e6-web-client.md` (sections 9, 10; committed here) |

Deps: T02b needs T02 and T03; T04 needs T01 and T02; T05 needs T01 and T03; T06 needs T01; T07 needs T01 and T05; T08 needs T04 and T06;
T09 needs T02, T02b, T03 and T04 to T08; T10 needs all.

## 4. Tasks

Every task reads first: `docs/EFFECT.md` §1 (E3, E4, E6, E7, E9, E11, E12) and §2; this plan's sections 1.1, 2 (the decisions its
brief names) and 6; `repos/effect/LLMS.md` ("Writing Effect code", "Writing Effect services", "Error handling", "Effect HttpClient",
"Integrating Effect into existing applications"); `agent-patterns/effect-core.md`, `effect-services.md`, `effect-errors.md`,
`effect-http-client.md`, `effect-schema.md`, `effect-testing.md`; CLAUDE.md "Persist policy comes from the manifests (D9)", "The
offline queue survives a second reload", "The CSP and the baked API URL", "A module owns its layout route and its static import graph
stays shell-free" (a manifest's static graph includes `offline.ts`, which imports the module `api.ts`: none of the new files may import
`@/modules`, `@/components/layout` or `use-nav-items`), "Long commands". Every commit body names the EFFECT.md decision(s) and the plan
decisions applied, lists any deviation, and ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
`git -C /home/erics/software/toon-household status --porcelain repos/` is empty after every task. The pass-count check every task runs:

```bash
L=$(mktemp); cd /home/erics/software/toon-household && bun test > "$L" 2>&1; P=$(grep -oE '^ *[0-9]+ pass' "$L" | grep -oE '[0-9]+'); grep -qE '^ *0 fail' "$L" && [ "${P:-0}" -ge 14785 ]
```

A "code line" grep below means comment-free: `grep -vE '^\s*(\*|//|/\*)' <file> | grep -cP '<pattern>'`, compared with `[ … = N ]`
(a bare `grep -c` exits 1 on a zero count).

### E6-T01 — `runtime.ts`, `ApiClient`, the tagged `ApiError`, the core client on `CoreApi` (core)

P1, P2, P3, P4, P5, P6, P7, P7a, P7c (the `lenient` marker), P8, P10, P11, P14, P16. Write `apps/web/src/lib/api-client.ts` and
`apps/web/src/lib/runtime.ts`, then rewrite `apps/web/src/lib/api.ts`: keep verbatim the header comment (update its transport
paragraph), `buildEnv`, `API_BASE_URL` with its literal `import.meta.env.PROD ? "" : "http://localhost:3001"`, `apiUrl`, `mediaUrl`,
`thumbnailUrl`, `QueryValue`, `queryString`, `seg`, `RequestOptions`, `errorMessage`, `assertUploadSize`, `fileForm`; re-export
`ApiError`, `ApiClientError`, `isApiError`, `setUnauthorizedHandler` from `./api-client`; add `DECODE_OPTIONS`, the helpers of P3 with the
`Types.DeepMutable` result type and the one cast, `lenient` (P7c) and `uploadForm` (P11); `getJson` fails a decode with
`invalid_response` (P7), `sendJson` / `sendForm` pass the raw payload through on a decode failure (P7a); add `CoreApi` with one member per
endpoint function (41: `fetchHealth` … `disableModule`, names and leading parameters as today, P8) and turn each function into its facade;
`request<T>` stays as the bridge (P3) with a doc comment listing its callers (`apps/web/src/modules/recipe/lib/api.ts`,
`apps/web/src/modules/finance/lib/api.ts`) and "E6-T09 deletes it". Response schemas (all from `@toon/shared`, all STRICT here; a core
row E6-T02 later marks `lenient` is switched by E6-T09, P7c): `HealthResponseSchema`, `AuthSessionResponseSchema` (register, login),
`MeResponseSchema`, `UserResponseSchema` (updateProfile, confirmEmailVerification), `EmailVerificationRequestResponseSchema`,
`SessionListResponseSchema`, `OAuthStartResponseSchema`, `OAuthProvidersResponseSchema`, `HouseholdListResponseSchema`,
`HouseholdResponseSchema` (create, update, enableModule), `InvitePreviewResponseSchema`, `AcceptInviteResponseSchema`,
`HouseholdDetailResponseSchema`, `HouseholdMemberListResponseSchema`, `HouseholdMemberResponseSchema` (role, placeholder create and
rename), `HouseholdInviteListResponseSchema`, `HouseholdInviteResponseSchema`; the `void` ones use `sendVoid`. `oauthStartUrl`,
`startOAuth`, `startOAuthLink` are navigation, not requests: unchanged. Add `apps/web/src/lib/runtime.ts` to `RUNTIME_ALLOW_LIST` in
`apps/api/test/effect-idioms.test.ts` (one line, its reason in the existing comment). Extend `apps/web/src/lib/api.test.ts` and add
`apps/web/src/lib/runtime.test.ts` as P14 and P16 say; the existing cases of `api.test.ts` are not edited. Look up every signature in
`repos/effect/packages/effect/src/{ManagedRuntime,Layer,Cause,Context,Predicate,Schema,SchemaAST,Types}.ts` and
`repos/effect/packages/effect/src/http/{HttpClient,HttpClientRequest,HttpClientResponse,HttpClientError,HttpBody,FetchHttpClient}.ts`;
`repos/effect/migration/v3-to-v4.md` for anything you remember from v3. Acceptance: the three web projects typecheck; every web test
green with the files of P14 untouched; the idioms test green; `apps/web/src/lib/api.ts` has no `fetch(` code line (the transport is the
`HttpClient`) and `apps/web/src/lib/runtime.ts` exactly one; no `as ` cast of a decoded value outside the helpers' one cast; the
decode-failure, `disableChecks`, write-pass-through, 401 and constructor-table cases exist and pass; `bun run build` succeeds.

### E6-T02 — Contract test: the core and recipe routes the web decodes (build)

P7, P7c. New `apps/api/test/web-contract-core-recipe.test.ts`, through the real `app` (`app.request`, the shared test `db`, ADR 0009),
in the style of `apps/api/test/core-walkthrough.test.ts` and `apps/api/test/recipe-module.test.ts` (read both, and `apps/api/test/support/`
for the harnesses): register a user (real session cookie, verified e-mail where a route needs it; see how `recipe-module.test.ts` and
`households.test.ts` confirm the address), create the data a walkthrough needs (a second member and an invite, a placeholder, recipes
with tags, a collection, a meal-plan entry, a shopping list with items checked and a bought section, a card; an upload through the
recipe image route with a small PNG from `apps/api/test/support/files.ts` if present), then a table-driven sequence over EVERY JSON
response route the core client (`apps/web/src/lib/api.ts`, the list of E6-T01) and the recipe client
(`apps/web/src/modules/recipe/lib/api.ts`, every `request<…>` line, section 1.1 / P8) decode: `{ name, method, path, body?, schema,
lenient? }` rows; each asserts the status the client expects, `Schema.decodeUnknownSync(schema, { disableChecks: true })(body)`
succeeds, and `expect(decoded).toEqual(body)` (P7's identity oracle with the web's decode options: nothing stripped, nothing defaulted or
transformed). Include the mutation responses the outbox replays (shopping item check, uncheck, undo-bought, catalog hide) and the
list-detail reads. Import draft routes are covered only where they do not need OCR or a network fetch (`imports/text`, the draft list,
get, patch, commit, delete); the URL import is skipped with a comment naming `apps/api/test/import/` as where it is covered. Clean up as
`apps/api/test/legacy-placeholders.test.ts` does only if a later file would be disturbed (fresh e-mail addresses per run suffice for
most). A finding (a decode failure or a non-identity) is fixed in the shared schema files of this task's `files` when `bun test
packages/shared` stays green (golden and parity tests included, never edited to pass; a new case in the listed shared tests is fine);
otherwise mark the row `lenient: { schema: "<XResponseSchema>", reason: "<one line>" }` ON ONE LINE (P7c), keep the assertion that the
body is the wire truth, and list it in the commit body (deviation D3). Recipe rows marked `lenient` are applied by E6-T04, core rows by
E6-T09. Acceptance: every core and recipe JSON route of the two clients has a row (the commit body lists the count and every lenient
row); the file passes; `bun test packages/shared` green.

### E6-T03 — Contract test: the finance routes the web decodes (build)

P7, P7c. New `apps/api/test/web-contract-finance.test.ts`, on `apps/api/test/support/finance-harness.ts` (read its header: the harness
gives toon-finance's names H semantics, `docs/modules/finance.md` "The finance test harness …"), a household with finance enabled and
two participants, then rows for every JSON route of `apps/web/src/modules/finance/lib/api.ts` (34 exports; every `request<…>` with a
non-void `T`): transactions list (with and without `includeAggregates`), detail, summary, create, update (with a `mutationId`),
categories (list with and without hidden, create, update), tags (list, update), plan (get, patch, preview for a period, run,
recalculate, runs list, items create and update, incomes create and update), balance (with a query), balance history, settlements list
and create, participants (list, update, own display name, placeholder rename). Same assertions, decode options and finding rule as
E6-T02 (a shared schema fix only in the finance schema files of this task's `files` — note that `BalanceResponseSchema` lives in
`settlements.ts`, the plan schemas in `plan.ts` — with `bun test packages/shared` green; else a one-line `lenient: { schema, reason }` and
D3, applied by E6-T05). Acceptance: every finance JSON route of the client has a row (count and lenient rows in the commit body); the
file passes; the finance tests of `apps/api/test/` still pass; `bun test packages/shared` green.

### E6-T02b — Contract test over migrated legacy data, and the snapshot sweep (build)

P7, P7b, P7c. New `apps/api/test/web-contract-legacy.test.ts`. Read first: `apps/api/test/legacy-placeholders.test.ts` (the `describe`
"a migrated placeholder is claimable by register (shared DB, finance-only input)": the fixture-e-mail precondition, `COUNTED`, the
`legacy_ids` ledger, the `afterAll` cleanup), `apps/api/test/support/legacy-harness.ts`, `apps/api/test/fixtures/legacy/facts.ts` and
`README.md` (the traps; plain passwords), ADR 0005 and ADR 0006, `docs/migration.md`, and the two contract tests of E6-T02 / E6-T03 for
the route list and the oracle. Part 1 (always runs): copy `recipe.db`, `finance.db` and `uploads/` of the fixtures to a temp dir, open
them with `openLegacy` (`apps/api/scripts/legacy/sources.ts`), `runLegacyMigration({ mode: "apply", recipe, finance, target: <the shared db and client>, uploads: { targetDir:
<tmp>, copy: true }, webOrigin })`, assert the report is clean; then for every migrated account with a password (log in through
`POST /api/auth/login`; an unconfirmed finance-only account can read) and every household it belongs to (from `/api/auth/me`), decode
every READ route of the three clients (core: me, households, household detail, members, invites where the role allows; recipe: recipes
list, each recipe's detail and scaled view, tags, collections and each collection detail, the meal-plan range, last planned, shopping
lists, each list's detail, catalog page and bought history, cards; finance where the module row exists: participants, transactions with
and without aggregates, each transaction's detail, summary, categories with hidden, tags, plan, a plan preview, plan runs, balance,
balance history, settlements) with P7's oracle and options, as rows built from the migrated ids. Assert the run touched the ADR 0005
households (a lone re-seated participant, an income naming a non-participant, a one-participant finance household) and a placeholder
(ADR 0006) by their `facts.ts` ids. `afterAll` deletes every household, user and `legacy_ids` row the run wrote (households first, the
cascade takes the module rows; then users) and asserts the counts of `COUNTED` plus `recipe_recipes` and `finance_transactions` are back.
Part 2, the snapshot sweep (P7b): a `describe.skipIf(process.env.WEB_CONTRACT_SNAPSHOT !== "1")` with a comment naming P7b and the
`docs/open-work.md` item; it skips Part 1 when set (`describe.skipIf(process.env.WEB_CONTRACT_SNAPSHOT === "1")` on Part 1), reads
every household of the `TEST_DATABASE_URL` DB, mints a session for one member of each through the core `Sessions` service
(`apps/api/src/core/services/auth/`; the cookie as `apps/api/src/middleware/session.ts` reads it), runs the same read sweep and prints
ONE summary line per schema (`<schema>: <decoded> ok, <failed> failed`) plus each failure's issue PATH, never a value, a name or an
e-mail; it fails when any decode failed. Prove the sweep once on a temp file DB (outside the repo) made by `bun run migrate:legacy -- … --apply` of the fixtures (the CLAUDE.md fixture run, `NODE_ENV=development`, then
`NODE_ENV=test TEST_DATABASE_URL=file:<that db> WEB_CONTRACT_SNAPSHOT=1 bun test apps/api/test/web-contract-legacy.test.ts`; the output
goes to the commit body). Findings follow E6-T02's rule: a fix in the shared schema files of T02 / T03 with `bun test packages/shared`,
`apps/api/test/web-contract-core-recipe.test.ts` and `apps/api/test/web-contract-finance.test.ts` green, else a one-line `lenient: {
schema, reason }` row (applied by E6-T09). Acceptance: Part 1 passes and leaves the shared DB at its counts; the default run reports
Part 2 as skipped; the snapshot run over the fixture-migrated DB passes; the other two contract tests and `bun test packages/shared`
green; `bun test apps/api/test/legacy-placeholders.test.ts apps/api/test/web-contract-legacy.test.ts` green in one process (no fixture
e-mail collision).

### E6-T04 — The recipe client on `RecipeApi` (build)

P3, P7, P7a, P7c, P8, P11, P14. Rewrite `apps/web/src/modules/recipe/lib/api.ts`: drop the `request` / `fileForm` imports for the P3
helpers and `uploadForm`; add `RecipeApi` with one member per endpoint function (62 exports minus the re-exported core and the pure
helpers; names and leading parameters as today); each function becomes its facade (P8). Every path string moves into its member BYTE FOR
BYTE (ids interpolated raw, never `seg()`: behaviour frozen; `queryString` keys and the `hasCooked` `"1"` / `"0"` mapping unchanged).
Response schemas: the `@toon/shared` schema of each `request<T>`'s `T` (`RecipeListResponseSchema`, `RecipeResponseSchema`,
`UploadResponseSchema`, `ScaledRecipeResponseSchema`, `RecipeCookedResponseSchema`, `TagListResponseSchema`, `TagResponseSchema`,
`CollectionListResponseSchema`, `CollectionResponseSchema`, `CollectionDetailResponseSchema`, `MealPlanRangeResponseSchema`,
`LastPlannedResponseSchema`, `MealPlanEntryResponseSchema`, `ImportDraftResponseSchema`, `ImportDraftListResponseSchema`,
`CommitImportDraftResponseSchema`, `ShoppingListListResponseSchema`, `ShoppingListResponseSchema`, `ShoppingListDetailResponseSchema`,
`ShoppingCatalogListResponseSchema`, `ShoppingBoughtListResponseSchema`, `PlanShoppingPreviewResponseSchema`, `CardListResponseSchema`,
`CardResponseSchema`); reads through `getJson`, writes through `sendJson` / `sendForm` (P7a); `request<void>` → `sendVoid`. A recipe row
E6-T02 marked `lenient` uses `lenient(<schema>)` (P7c). No cast of a decoded value (P3's helper types carry `DeepMutable`). `export *
from "@/lib/api"` stays. List in the commit body every caller of `uploadRecipeImage` and the two import uploads and that each awaits it
inside an `async` function (D2). New `apps/web/src/modules/recipe/lib/api.test.ts` (stubbed `globalThis.fetch` per test as in
`apps/web/src/lib/api.test.ts`): one path per resource family (recipes with a `queryString`, tags, collections, plan, shopping,
`/api/recipe/cards`), that an id with `/` is interpolated raw (today's behaviour, pinned), one decoded response, one READ decode failure
(`invalid_response`), one shopping WRITE whose response mismatches resolving the raw payload. Read `docs/modules/recipe.md` §4a ("The
shopping list outbox is wired through the manifest.", "Import query keys are rooted at `"toon"`") and §4b R4, R29, R40, R48.
Acceptance: typecheck; all web tests green, `offline.test.ts` and the recipe `persist.test.ts` / `manifest.test.ts` untouched; no
`request<` in the file; the recipe LINKS grep prints nothing.

### E6-T05 — The finance client on `FinanceApi` (build)

P3, P7, P7a, P7c, P8, P14. Rewrite `apps/web/src/modules/finance/lib/api.ts` as E6-T04 does: `FinanceApi` members (names and leading
parameters as today, `seg()` and `queryString` calls moved byte for byte, `deleteTransaction`'s `?mutationId=` kept), facades with
today's signatures; reads through `getJson`, writes through `sendJson` (P7a: the finance outbox's create / update / delete replays never
see `invalid_response`); the aliased shared imports (`FinancePaginationQuery as PaginationQuery`, `FinanceTag… as Tag…`) stay aliased,
the schemas imported likewise (`FinanceTagListResponseSchema`, `FinanceTagResponseSchema`, plus `TransactionListResponseSchema`,
`TransactionResponseSchema`, `TransactionSummaryResponseSchema`, `CategoryListResponseSchema`, `CategoryResponseSchema`,
`PlanResponseSchema`, `PlanComputationResponseSchema`, `RunPlanResponseSchema`, `RecalculatePlanResponseSchema`,
`AccrualRunListResponseSchema`, `FixedCostItemResponseSchema`, `IncomeResponseSchema`, `BalanceResponseSchema`,
`BalanceHistoryResponseSchema`, `SettlementResponseSchema`, `FinanceParticipantListResponseSchema`,
`FinanceParticipantResponseSchema`). A row E6-T03 marked `lenient` uses `lenient(<schema>)` (P7c). No cast of a decoded value. Append to
`apps/web/src/modules/finance/lib/api.test.ts` (existing cases untouched) a decoded `TransactionResponse` round trip, a READ
decode-failure case and a create-transaction WRITE whose response mismatches resolving the raw payload. Read `docs/modules/finance.md`
§4a ("Finance TS identifiers carry a `finance` prefix …", "The finance greps") and §4b F7, F8, F10, F11, F50, F53, F74. Acceptance:
typecheck; all web tests green, the finance `offline.test.ts`, `persist.test.ts`, `manifest.test.ts`, `queries.test.ts` untouched; no
`request<` in the file; `LINKS_FIN`, `NOROUTER`, `NOCORE`, `NOSHADOW` (`docs/modules/finance.md` §5.1, under bash) print nothing.

### E6-T06 — The import client on the runtime (build)

P8, P12, P14. Rewrite the transport section of `apps/web/src/modules/recipe/features/import/lib/importApi.ts`: `requestJson`,
`requestNoContent` and `fetchDraftSource` onto `HttpClient.HttpClient` (yielded inside `Effect.fnUntraced` generators; the URL is
`${apiBaseUrl()}${path}` as today; `toImportApiError(status, payload, undefined)` where `response.statusText` was, deviation D4),
`uploadFile` onto `Effect.callback` around the unchanged XHR body (keeps `xhr.statusText`), `ImportApi` members for the eleven endpoint
functions (`importFromUrl`, `importFromText`, `importImage`, `importPdf`, `listDrafts`, `getDraft`, `patchDraft`, `commitDraft`,
`deleteDraft`, `fetchDraftSource`, `listHouseholdTags`) and facades with today's signatures (`signal` positional; `importImage` /
`importPdf` take the `UploadHandle` and pass nothing to `runPromise`: the XHR owns its abort). `ImportApiError` with exactly P12's field
schemas (`Schema.Literals` for `kind`, the permissive `Schema.declare` guard for `title` / `hint`, `String` / `Number` / `Boolean` /
optional `Unknown` for the rest), `override get message()`, `name` `"ImportApiError"`; `toImportApiError`, `describeError`,
`isImportApiError`, `errorTextForLog`, the `ImportErrorKind` / `ImportErrorText` types (one source for the kinds, P12) and every catalog
key unchanged. Keep the module's self-contained comment, amended: it no longer calls `fetch`, it uses the runtime's `HttpClient` with its
own headers and error mapping. New `importApi.test.ts`: the fetch calls carry `accept` and no `accept-language`, a 4xx envelope becomes
the same `ImportApiError` `kind` as `toImportApiError` gives, an unmapped status without envelope message gives the `unknown` kind with
the catalog headline (D4), a schema mismatch returns the raw payload, an aborted `signal` rejects with a `DOMException` named
`AbortError`, `fetchDraftSource` returns the `content-type` as `mimeType` (stub `URL.createObjectURL`), `new ImportApiError({...})
.message` is the title key, `name` is `"ImportApiError"` and `_tag` is `"ImportApiError"`, and P12's constructor table (every branch of
`toImportApiError` plus status 0, `ocr_timeout` and `aborted`: no throw, the expected `kind`). Read `docs/modules/recipe.md` §4b R4 and
R34, and `apps/web/src/modules/recipe/features/import/lib/importErrorText.ts`. Acceptance: typecheck; all web tests green,
`importErrors.test.ts`, `confidence.test.ts`, `draftEdit.test.ts` untouched; the file has no `fetch(` code line (word-bounded) and
exactly one `new XMLHttpRequest`; the recipe LINKS grep prints nothing.

### E6-T07 — Core and finance `queryFn`s through `runPromise`, `shouldRetry` (rewrite)

P7a, P9. Three files, nothing else; change no line the tables do not name.

`apps/web/src/lib/queries.ts`: add `import { runPromise } from "./runtime";` after the `./api` import; in the `./api` import list
add `CoreApi` and remove the nine `fetch…` names below (keep `isApiError`).

| Old (inside the `queryFn`) | New |
| --- | --- |
| `fetchHealth({ signal })` | `runPromise(CoreApi.fetchHealth(), { signal })` |
| `await fetchMe({ signal })` | `await runPromise(CoreApi.fetchMe(), { signal })` |
| `fetchSessions({ signal })` | `runPromise(CoreApi.fetchSessions(), { signal })` |
| `fetchOAuthProviders({ signal })` | `runPromise(CoreApi.fetchOAuthProviders(), { signal })` |
| `fetchHouseholds({ signal })` | `runPromise(CoreApi.fetchHouseholds(), { signal })` |
| `fetchInvitePreview(token, { signal })` | `runPromise(CoreApi.fetchInvitePreview(token), { signal })` |
| `fetchHousehold(householdId, { signal })` | `runPromise(CoreApi.fetchHousehold(householdId), { signal })` |
| `fetchHouseholdMembers(householdId, { signal })` | `runPromise(CoreApi.fetchHouseholdMembers(householdId), { signal })` |
| `fetchHouseholdInvites(householdId, query, { signal })` | `runPromise(CoreApi.fetchHouseholdInvites(householdId, query), { signal })` |

In the same file, the one line of `shouldRetry`:

| Old | New |
| --- | --- |
| `  if (isApiError(error) && error.isClientError) return false;` | `  if (isApiError(error) && (error.isClientError \|\| error.code === "invalid_response")) return false;` |

and add the doc line `/** A 4xx or a response that does not match its schema (deterministic, plan e6 P7a) is not retried. */` directly
above `export function shouldRetry` if no doc comment is there, else append that sentence to the existing one.

New `apps/web/src/lib/should-retry.test.ts`, exactly:

```ts
import { describe, expect, test } from "bun:test";
import { ApiError } from "./api";
import { shouldRetry } from "./queries";

describe("shouldRetry (plan e6 P7a)", () => {
  test("a response that does not match its schema is not retried", () => {
    const error = new ApiError({ code: "invalid_response", status: 200, message: "x" });
    expect(shouldRetry(0, error)).toBe(false);
  });
  test("a network error is still retried twice", () => {
    const error = new ApiError({ code: "network_error", status: 0, message: "x" });
    expect(shouldRetry(0, error)).toBe(true);
    expect(shouldRetry(1, error)).toBe(true);
    expect(shouldRetry(2, error)).toBe(false);
  });
  test("a 4xx is not retried", () => {
    expect(shouldRetry(0, new ApiError({ code: "not_found", status: 404, message: "x" }))).toBe(false);
  });
});
```

`apps/web/src/modules/finance/lib/queries.ts`: add `import { runPromise } from "@/lib/runtime";` directly after the `} from "./api";`
line (before `export * from "@/lib/queries";`); add `FinanceApi` to that `"./api"` import list; every `queryFn` of the form
`({ signal }) => NAME(ARGS, { signal })` becomes `({ signal }) => runPromise(FinanceApi.NAME(ARGS), { signal })` with `ARGS` copied
unchanged. The twelve: `fetchFinanceParticipants(householdId)`, `fetchTransactions(householdId, query)`, `fetchTransaction(householdId,
transactionId)`, `fetchTransactionSummary(householdId, query)`, `fetchCategories(householdId, includeHidden)`, `fetchTags(householdId,
query)`, `fetchPlan(householdId)`, `fetchPlanPreview(householdId, period)`, `fetchPlanRuns(householdId, query)`,
`fetchBalance(householdId, query)`, `fetchBalanceHistory(householdId, query)`, `fetchSettlements(householdId, query)`. Then remove from
the import list each `NAME` that no longer occurs as `NAME(` in the file (a name still used by a `mutationFn` stays). If a `queryFn` or
the `shouldRetry` line does not match, stop and report it instead of improvising. Acceptance: typecheck; `grep -c 'runPromise('
apps/web/src/lib/queries.ts` is 9 and in the finance file 12; `bun test apps/web` green with `queries.test.ts`, `query-client.test.ts`,
`persist.test.ts` and the finance `queries.test.ts` untouched, and the new `should-retry.test.ts` green.

### E6-T08 — Recipe `queryFn`s through `runPromise` (rewrite)

P9. Three files, nothing else.

`apps/web/src/modules/recipe/lib/queries.ts`: add `import { runPromise } from "@/lib/runtime";` after the last import; add `RecipeApi` to
the `./api` import; every `queryFn: ({ signal }) => NAME(ARGS, { signal })` becomes `queryFn: ({ signal }) =>
runPromise(RecipeApi.NAME(ARGS), { signal })`, `ARGS` unchanged. The sixteen: `fetchRecipes(householdId, query)`,
`fetchRecipe(householdId, recipeId)`, `fetchScaledRecipe(householdId, recipeId, servings)`, `fetchTags(householdId)`,
`fetchCollections(householdId)`, `fetchCollection(householdId, collectionId)`, `fetchImportDrafts(householdId, query)`,
`fetchImportDraft(householdId, draftId)`, `fetchCards()`, `fetchShoppingLists(householdId)`, `fetchShoppingList(householdId, listId)`,
`fetchPlanRange(householdId, range)`, `fetchLastPlanned(householdId, before)`, `fetchPlanShoppingPreview(householdId, listId, range)`,
`fetchShoppingBoughtHistory(householdId, query)`, `fetchShoppingCatalogPage(householdId, listId, query)`. Remove each now-unused name
from the `./api` import.

`apps/web/src/modules/recipe/features/recipes/lib/queries.ts`: add `import { runPromise } from "@/lib/runtime";`; change the import
`import { createRecipe, deleteRecipe, fetchRecipes, updateRecipe, uploadRecipeImage } from "@/modules/recipe/lib/api";` to `import {
RecipeApi, createRecipe, deleteRecipe, updateRecipe, uploadRecipeImage } from "@/modules/recipe/lib/api";`; the one `queryFn`
`fetchRecipes(householdId ?? "", { ...wire, offset: pageParam }, { signal })` becomes `runPromise(RecipeApi.fetchRecipes(householdId
?? "", { ...wire, offset: pageParam }), { signal })`.

`apps/web/src/modules/recipe/features/import/lib/queries.ts`: add `import { runPromise } from "@/lib/runtime";`; add `ImportApi` to the
`./importApi` import; three substitutions: `await listDrafts(householdId!, { status, limit }, signal)` → `await
runPromise(ImportApi.listDrafts(householdId!, { status, limit }), { signal })`; `await getDraft(householdId, draftId!, signal)` → `await
runPromise(ImportApi.getDraft(householdId, draftId!), { signal })`; `listHouseholdTags(householdId!, signal)` →
`runPromise(ImportApi.listHouseholdTags(householdId!), { signal })`. Remove `listDrafts`, `getDraft`, `listHouseholdTags` from the
import if no longer used. Everything else in the three files (the `try` / `catch` loop, `new ImportApiError(...)`, keys, options,
`mutationFn`s) stays byte-identical. If a line differs from the tables, stop and report. Acceptance: typecheck; the counts of
`runPromise(` are 16, 1 and 3; `bun test apps/web` green; the recipe LINKS grep prints nothing.

### E6-T09 — The `request` bridge deleted, every lenient row applied, idioms rule (13) (build)

P3, P7c, P13. (1) Delete `request<T>` and `RequestInput` from `apps/web/src/lib/api.ts` (and any helper only it used), after
`grep -rn '\brequest<\|\brequest(' apps/web/src` shows no caller outside comments (the wake-lock `.request("screen")` calls in
`apps/web/src/modules/recipe/features/recipes/lib/hooks.ts` and `CardDisplayDialog.tsx` are not API calls). (2) Apply every `lenient: {
schema: "X", reason }` row of `apps/api/test/web-contract-core-recipe.test.ts`, `apps/api/test/web-contract-finance.test.ts` and
`apps/api/test/web-contract-legacy.test.ts` not yet applied: in `apps/web/src/lib/api.ts` (`CoreApi`; E6-T01 wrote every core route
strict because it ran beside E6-T02), `apps/web/src/modules/recipe/lib/api.ts` and `apps/web/src/modules/finance/lib/api.ts` (rows of
E6-T02b), by passing `lenient(X)` where `X` is used; touch nothing else in the module files. The commit body lists every row applied
and its route(s); if there is none, it says so. (3) Add rule (13) to `apps/api/test/effect-idioms.test.ts` in the file's shape (a
`describe`, the comment-free line scan, `file:line: code` failures, pinned allow lists with a reason per entry, a stale entry fails):
(13a) the effect specifier, (13b) `WEB_EFFECT_ALLOW_LIST`, (13c) `/\bfetch\(/` with its allow list `apps/web/src/lib/runtime.ts` only and
`/\bnew XMLHttpRequest\b/` with its allow list `apps/web/src/modules/recipe/features/import/lib/importApi.ts` only, two separate lists
(P13), all over non-test files of `apps/web/src/`. Update the header comment of the idioms test ("E6 switched on rule (13)").
Acceptance: typecheck; the idioms test green, and three scratch edits (each reverted, none committed) each make it fail: `import {
Option } from "effect/Option"` in a web file fails (13a), `globalThis.fetch("/x")` in a screen fails (13c) while `refetch()` does not,
and removing the `new XMLHttpRequest` line from `importApi.ts` fails (13c) as a stale entry; the lenient two-way grep of the verify list
exits 0; the three contract tests green; the pass-count check.

### E6-T10 — Integration: gates, bundle, headless and CSP checks, docs, the record (build)

All decisions, P15 and P17. (1) Gates on the merged tree, each as a log ending `exit=$?`: `bun install --frozen-lockfile`, `bun run
typecheck`, `bun test` (pass ≥ 14785, record the count), `bun run build`, `bun run i18n:check` (classify every hit: the 147 known false
positives of CLAUDE.md "Commands"; a new hit is a finding), `bun test apps/api/test/effect-idioms.test.ts`, the lenient two-way grep of
E6-T09, `git status --porcelain repos/`. (2) The LINKS grep of `docs/modules/recipe.md` §5 and the four finance greps of
`docs/modules/finance.md` §5.1, under bash. (3) The bundle after, as section 1.3; growth = after − 402.54 kB; ≥ 60 kB → write
`docs/adr/0015-web-bundle-growth.md` (and edit the E11 text of `docs/EFFECT.md` per the ADR rule). (4) The headless and CSP checks of
P17, and a boot-and-shutdown of the API (`/api/health`, SIGTERM, `[db] database closed`, `[api] runtime disposed`, exit 0). (5) Docs:
CLAUDE.md "Layout (as built)" (the web runtime, `api-client.ts`, the namespaces, the three contract tests), "Status" (E6 done, the new
pass count), a web gotcha "One web runtime; API calls are described once" (P1, P2's late-bound `Fetch`, P4's order, P7's decode with
`disableChecks` and the contract tests, P7a's write pass-through and the non-retried `invalid_response`, P7c's `lenient` marker and the
two-way grep, P8's facades, P13's rule (13), and the deploy rule of D5: a response literal or shape that WIDENS — a new
`TransactionOrigin`, `TagKind`, `InviteStatus` or role, a field turning nullable — is a two-step deploy: first a release whose shared
schema accepts the new value while the server never sends it, then, once the old service workers have been replaced, the release that
sends it; installed PWAs run the previous bundle until every tab closes, `skipWaiting` being off), "Testing and tooling" (rule (13), the
snapshot sweep switch `WEB_CONTRACT_SNAPSHOT=1`); `docs/EFFECT.md` §4 E6 row untouched, a status sentence where E5's is;
`agent-patterns/effect-http-client.md` §7 (the web as built, the `Fetch` default-caching, string-body and missing-`statusText` facts of
section 1.1) and §6 if a line proved wrong; `agent-patterns/effect-services.md` §7 web line; `docs/open-work.md`: an OWNER ACTION "E6
decode sweep over a production snapshot": take a `VACUUM INTO` snapshot as in the backup routine, copy it to a directory OUTSIDE the
repository, run `NODE_ENV=test TEST_DATABASE_URL=file:<copy> WEB_CONTRACT_SNAPSHOT=1 bun test apps/api/test/web-contract-legacy.test.ts`,
record counts and OK/FAIL only (never content; a failure's schema and path go to a new ADR-or-fix task: a lenient row or a schema fix),
delete the copy; plus anything deferred. (6) This file's sections 9 (gates, counts, bundle before/after/growth, the headless and CSP
outcomes, the contract-test row counts, lenient rows and findings, the fixture snapshot-sweep output) and 10 (what changed vs plan,
deviations D1–D5 as they happened). Acceptance: every gate green; growth recorded and < 60 kB or ADR 0015 present; all headless checks
and the CSP check pass; `bun test apps/api/test/docs-paths.test.ts` green after the doc edits.

## 5. Acceptance summary

| Exit criterion | Where proven |
| --- | --- |
| One web runtime over `FetchHttpClient`, credentials, base URL, JSON content type, 401 hook, upload cap | T01 (`runtime.ts`, `api-client.ts`, `api.ts`), `apps/web/src/lib/api.test.ts`, `apps/web/src/lib/runtime.test.ts` |
| Every client describes each request once and decodes with the shared schema | T01, T04, T05, T06; contract tests T02, T03, T02b; lenient rows applied T04, T05, T09 |
| Decoding is safe on data the app never wrote | T02b (migrated fixtures, ADR 0005 / 0006 states); P7's `disableChecks`; the owner's snapshot sweep (T10, `docs/open-work.md`) |
| A write never fails on its response; `invalid_response` not retried | T01, T04, T05 (write pass-through cases); T07 (`should-retry.test.ts`) |
| Same `ApiError` (status, code, message, details), now tagged, constructors never throw | T01 (P5 table); `query-client.test.ts` unchanged; T06 (P12 table) |
| `queryFn`s through `runPromise`; keys, persist, outbox, `PERSIST_BUSTER` untouched | T07, T08; P14's unchanged list |
| 401 purge through the runtime | T01 (P10); `session-purge.test.ts` unchanged; T01's 401 case |
| `api.test.ts` decode-failure and 401 cases | T01 |
| Effect imports from `effect` / `effect/http` only, in the listed files only; one `fetch(`, one XHR | T09 rule (13) |
| Bundle before / after, growth < 60 kB | sections 1.3 and 9 (T10) |
| LINKS greps | T04, T05, T06, T08, T10 |
| Three web tsconfig projects typecheck; pass count ≥ 14785 | every task |
| Headless checks and CSP at `127.0.0.1:3001` | T10 (P17) |

## 6. Risks

- **A shared response schema that does not match the wire** (they were never run against real responses; the API does not encode with
  them). With P7 a mismatch would turn a working screen into an error. Mitigation: T02 and T03 run before the module clients decode, with
  the identity oracle; T01's core endpoints are covered by T02 in the same wave and any core `lenient` row is applied by T09 before the
  milestone closes; T10's headless pass exercises the main screens.
- **Stored data the oracle on fresh rows cannot see** (migrated rows, ADR 0005 / 0006 states, rows older than a tightened limit). Three
  layers: P7 decodes with `disableChecks` (structure and types only, so no pattern, length or range check can reject a stored row), T02b
  runs the oracle over the migrated fixtures, and the owner's snapshot sweep covers the real data (D5's residual risk: a type or literal
  mismatch in production that no fixture has; a failure is visible as `invalid_response` on one read screen, never on a write, P7a).
- **Key stripping.** v4 decoding has no "preserve" mode; a field the server sends and the schema lacks would vanish. The `toEqual`
  oracle of T02 / T03 / T02b catches it on the covered routes; screens are typed from the same schemas, so a screen cannot read such a
  field without a type error.
- **Stale clients after a deploy** (D5): strict structure on reads means an additive server change to a literal union or a shape breaks
  the previous bundle's read of that route, where today it rendered. The two-step deploy rule (T10's gotcha) is the mitigation; the
  import client keeps its pass-through (P12).
- **`Fetch` default caching** (section 1.1): without P2's late-bound wrapper the existing fetch-stub tests fail from the second test on.
- **String bodies.** Using `bodyJson` / `bodyJsonUnsafe` would hand `fetch` bytes and break the existing body assertions (section 1.1).
- **Trace headers.** Forgetting `TracerPropagationEnabled = false` adds `b3` / `traceparent` to every request (a preflight in the dev
  setup's cross-origin calls); T01's header test pins their absence.
- **Abort semantics.** `runPromise` on an interrupted fiber rejects with a generic `Error`; P1 restores the `AbortError`. TanStack ignores
  the rejection of a cancelled query either way, but `describeError` in the import feature matches on `name === "AbortError"`.
- **Error paths that throw.** A `Schema.TaggedError` constructor validates; a strict field schema would throw a `SchemaError` inside
  `toApiError` / `toImportApiError` and the screen would render the wrong error. P5 and P12 fix permissive field schemas; the constructor
  tables of T01 and T06 pin them.
- **Import cycle** (P16): a module-scope read in `runtime.ts` or `api-client.ts` would throw a TDZ `ReferenceError` only in the entry
  order that hits it; `runtime.test.ts` checks the orders in fresh processes.
- **Persisted errors.** A paused mutation's `failureReason` may be persisted to IndexedDB (structured clone). A tagged error is still an
  `Error` subclass, cloned as an `Error`; T10's offline replays are the proof (a `DataCloneError` would lose the persisted cache).
- **Bundle.** `effect/http` pulls `HttpClient`, `FetchHttpClient`, `Stream` (stream bodies) and tracing. If growth approaches 60 kB,
  check the chunk map before reaching for subpath imports (forbidden by P13 (a)); an ADR is the escape, not a relaxed rule.
- **Parallel waves.** T04, T05, T06 depend on T01's helper signatures; T01's brief fixes them (P3), and a task that needs another helper
  adds it in its own file, not in `apps/web/src/lib/api.ts`. T02b may change a shared schema while T04 / T05 run; the merge verification
  runs typecheck and the three contract tests on the merged tree.
- **The shared test DB** (T02b): a real `apply` into it must leave it at its counts and must not collide with
  `apps/api/test/legacy-placeholders.test.ts` (both assert no fixture e-mail at start; each cleans up in `afterAll`).
- **The host load.** `bun test` took 49.57 s at baseline; under parallel worktrees the sharp tests carry their own budgets (CLAUDE.md);
  a gate that fails keeps its `(fail)` lines in the log.

## 7. Deviations expected (each recorded in section 10 when it happens)

- **D1** — A response body that fails while being read becomes `ApiError network_error` instead of the raw `TypeError` (P4).
- **D2** — An oversized upload makes the facade reject instead of throwing synchronously (P11); every caller awaits inside an `async`
  function, so no screen sees a difference.
- **D3** — A route whose shared schema cannot be fixed without breaking the golden or parity tests decodes leniently (P7c: validate, log
  in DEV, return the raw payload); each one is named with its contract row and reason.
- **D4** — The import client's three former `fetch` paths lose `response.statusText` (the `HttpClientResponse` has none, section 1.1
  fact 3): an unmapped status without an envelope `message` shows the catalog headline `recipe.import.error.unknown.title` instead of the
  reason phrase (P12). Behind the Caddy over HTTP/2 the reason phrase is already empty; the XHR path is unchanged.
- **D5** — Reads now fail on a STRUCTURE or TYPE mismatch (`invalid_response`, P7): the E11 consequence of decoding. Not a wire change.
  Two consequences are written into CLAUDE.md by T10: a client running the previous bundle (`skipWaiting` off) fails a read whose response
  literal or shape the server widened, so such a change is a two-step deploy (section 4, E6-T10 (5)); and production data no fixture has
  could fail a read, which the owner's snapshot sweep (P7b) checks. Writes are exempt (P7a), the checks are not run (P7), and
  `invalid_response` is not retried (P7a).

## 8. Out of this milestone

E7 (`effect/http-api`, Hono's removal, a typed client derived from an `HttpApi` definition: the web could then call `HttpApiClient`, a
later decision); `@effect/atom-react` or any replacement of TanStack Query (`docs/open-work.md` D-6); any change to query keys, the
persist policy, the outboxes, `PERSIST_BUSTER`, the service worker rules (ADR 0011), the CSP or the base URL rules; moving forms off
`apps/web/src/lib/validation.ts`; Effect in components or hooks; encoding request bodies with the shared schemas (the server validates
them; the web sends what it sends today); OpenTelemetry export from the browser; running the snapshot sweep on real data (an owner
action, P7b).

## 9. Integration record

Written by E6-T10 on `main` at `6a15662d0` (E6-T09) plus this commit, 2026-11-05, Bun 1.4.3 on the host (`.bun-version` says 1.4.2), host load
average about 4 to 5 during the gates. Logs are quoted from the runs; no session cookie, claim link or token is quoted. The scripts and logs
stayed in the session's scratch directory outside the repository (Playwright 1.63.0 installed there with `bun add`, log ending `exit=0`).

### 9.1 Gates (each a log ending `exit=$?`, on the merged tree)

- `bun install --frozen-lockfile`: `Checked 439 installs across 628 packages (no changes)`, `exit=0`.
- `bun run typecheck`: `[typecheck] OK` over the five projects (packages/shared, apps/api, the three apps/web projects), `exit=0`.
- `bun run build`: `@toon/web build: Exited with code 0`, `exit=0` (`dist/sw.js`, `dist/workbox-*.js` generated; the one chunk-size warning is the
  inherited `queries-*` chunk, see 9.2).
- `bun test`: **14993 pass, 1 skip, 0 fail, 384819 expect() calls, `Ran 14994 tests across 177 files. [51.57s]`**, `exit=0`. The record rises by
  208 over E5's 14785 (the new tests of E6-T01 to E6-T09: `apps/web/src/lib/runtime.test.ts`, `apps/web/src/lib/should-retry.test.ts`,
  `apps/web/src/modules/recipe/lib/api.test.ts`, `apps/web/src/modules/recipe/features/import/lib/importApi.test.ts`, the extended
  `apps/web/src/lib/api.test.ts` and `apps/web/src/modules/finance/lib/api.test.ts`, the three `apps/api/test/web-contract-*.test.ts`, rule (13) in
  `apps/api/test/effect-idioms.test.ts`). The one skip is the snapshot sweep of `apps/api/test/web-contract-legacy.test.ts` (it prints its skip
  unless `WEB_CONTRACT_SNAPSHOT=1`).
- `bun test apps/api/test/effect-idioms.test.ts apps/api/test/docs-paths.test.ts` after the doc edits: 45 pass, 0 fail (rule (13) on; every repo path of
  CLAUDE.md, `docs/open-work.md` and the module docs exists).
- The lenient two-way grep of E6-T09: the forward loop printed `forward-ok` (no `lenient: { schema: "X"` row exists in
  `apps/api/test/web-contract-*.test.ts`, so the loop body ran zero times) and the reverse grep
  (`lenient\([A-Z][A-Za-z]*Schema\)` over the three client files) found no hit. The list is empty on both sides.
- The LINKS greps (`docs/modules/recipe.md` section 5 and the four finance greps of `docs/modules/finance.md` section 5.1: `LINKS_FIN`, `NOROUTER`,
  `NOCORE`, `NOSHADOW`), under bash from the repository root: all five printed nothing and exited 0.
- `bun run i18n:check`: `[i18n:check] OK` (parity) and `FAILED - 145 possible German literal(s)` (exit 1, by design). Compared line-number-free
  (`file | text`, sorted) with the run at E5's end (`i18n-head`) and with the base run (`i18n-base`) the three lists are identical (`diff` empty): no new
  hit and none moved. Every hit is a classified false positive of the known kinds (German quoted in doc comments such as "Häufig gekauft",
  "Nicht mehr vorschlagen", "Mehr laden", "Rückgängig", "Übersicht", recipe content vocabulary, umlaut entities). Several hits sit in files E6
  rewrote (`apps/web/src/modules/recipe/lib/api.ts`, `apps/web/src/modules/recipe/lib/queries.ts` and three feature `queries.ts`): doc comments that
  were carried over verbatim, so only their line numbers changed. The 147 of CLAUDE.md's old wording was 146 plus the `Effect.die` hit that E4 removed.
- `git status --porcelain repos/`: empty (`0` lines), before and after every step here.

### 9.2 The bundle (section 1.3's measurement, `bun run build` on the final tree)

| | before (`f16544915`) | after (this tree) | growth |
| --- | --- | --- | --- |
| JS chunks | 84 | 84 | 0 |
| JS gzip total | 402.54 kB | **419.99 kB** | **+17.45 kB** |
| `dist/assets/queries-*.js` (the big chunk) | 507.73 kB (gzip 140.85) | 557.53 kB (gzip 157.29) | +49.80 kB (+16.44 gzip) |
| `dist/assets/index-*.js` | 264.09 kB (gzip 83.83) | 264.08 kB (gzip 83.81) | -0.01 kB |
| CSS gzip (`index-*.css` plus `RecipeDetailPage-*.css`) | 12.92 kB | 12.92 kB (12.52 + 0.40) | 0 |
| PWA precache | 104 entries, 1456.28 KiB | 104 entries, 1507.36 KiB | +51.08 KiB |

The growth is 17.45 kB gzipped, under the 60 kB threshold of P15, so **no ADR 0015 is written** and the E11 text of `docs/EFFECT.md` carries the number
instead (its "As built (E6)" sentence). The growth is `effect/http` (`HttpClient`, `FetchHttpClient`, the request and response modules) and the
`ManagedRuntime`/`Layer` machinery joining the chunk that already held `effect` and the shared schemas since E1; the imports are `"effect"` and
`"effect/http"` only (rule (13a)), no subpath was needed to stay under the line.

### 9.3 The contract tests and the lenient list

`bun test apps/api/test/web-contract-legacy.test.ts apps/api/test/web-contract-core-recipe.test.ts apps/api/test/web-contract-finance.test.ts`: `115 pass, 1
skip, 0 fail, Ran 116 tests across 3 files. [2.19s]`.

| Test | Rows | Lenient rows |
| --- | --- | --- |
| `apps/api/test/web-contract-core-recipe.test.ts` (core and recipe, `app.request` over the shared test DB) | 83 JSON rows decoded with `{ disableChecks: true }` and compared `toEqual` the body, plus 27 void (204) rows asserted | none |
| `apps/api/test/web-contract-finance.test.ts` (finance harness, two participants plus a placeholder-seat household) | 49 rows; all 28 JSON exports of `apps/web/src/modules/finance/lib/api.ts` covered (a coverage test reads the client file) | none |
| `apps/api/test/web-contract-legacy.test.ts` part 1 (the committed legacy fixtures applied through `runLegacyMigration`, six accounts with a password, every migrated household, ADR 0005 and ADR 0006 states asserted, the counts restored in `afterAll`) | the same read sweep over the migrated households | none |

No shared schema file changed in E6 (`packages/shared` is untouched since E5), no golden or parity file was edited, and the `LENIENT` list is empty:
D3 did not happen.

**The fixture snapshot-sweep output (P7b)**, re-run on this tree: `bun run migrate:legacy -- --recipe-db apps/api/test/fixtures/legacy/recipe.db
--recipe-uploads apps/api/test/fixtures/legacy/uploads --finance-db apps/api/test/fixtures/legacy/finance.db --apply` twice into a scratch target (exits
`0, 0`; the second ends `[migrate:legacy] already migrated: nothing written.`; the apply logs with the fixture's claim links were deleted), then
`NODE_ENV=test TEST_DATABASE_URL=file:<scratch>/target.db WEB_CONTRACT_SNAPSHOT=1 bun test apps/api/test/web-contract-legacy.test.ts` (4 pass, 5 skip, 0
fail: part 1 is skipped when the switch is set; exit 0):

```
[web-contract-snapshot] 5 households (0 without a password account), 4 sessions, 180 requests
[web-contract-snapshot] HealthResponseSchema: 1 ok, 0 failed
[web-contract-snapshot] MeResponseSchema: 4 ok, 0 failed
[web-contract-snapshot] HouseholdDetailResponseSchema: 5 ok, 0 failed
[web-contract-snapshot] RecipeResponseSchema: 6 ok, 0 failed
[web-contract-snapshot] ShoppingBoughtListResponseSchema: 4 ok, 0 failed
[web-contract-snapshot] TransactionListResponseSchema: 15 ok, 0 failed
[web-contract-snapshot] TransactionResponseSchema: 28 ok, 0 failed
[web-contract-snapshot] BalanceResponseSchema: 10 ok, 0 failed
... (35 schema lines in all, every one "0 failed"; the eight lines above are a sample, the full list is the E6-T02b commit body)
```

The real-data sweep is an owner action (`docs/open-work.md` A11).

### 9.4 The headless and CSP checks (P17), against the built app

Setup: `bun run build`, a fresh temp file DB (`DATABASE_URL=file:<scratch>/run/e6.db`, `SESSION_SECRET` of 32 hex, `NODE_ENV=development`), `bun run seed`
(exit 0, `Passwort: demo1234`), then `WEB_DIST_DIR=./apps/web/dist bun run start` in the background (log ending `exit=$?`). Chromium revision 1248 from
`~/.cache/ms-playwright` through Playwright's `executablePath` (the installed Playwright 1.63.0 wants revision 1243, which is not on this host), context
`locale: "en-US"`, login by `fetch("/api/auth/login")` from a non-SPA page (`/api/health`) with one saved `storageState` per origin (the login rate
limit), the shell served and the service worker controlling the page before the offline steps.

| Check | Result |
| --- | --- |
| (1) Shopping offline replay: two items added through the API, `/recipe/shopping/<listId>` opened, service worker ready and controlling, `setOffline(true)`, "Check off Zebramilch" clicked (the row leaves optimistically), 3.5 s for the persist throttle, **reload while offline** (the shell comes from the service worker, the checked item stays out), `setOffline(false)` and an `online` event | PASS: within 15 s a `fetch` of the list detail no longer lists the item, and the bought history holds it; the other item is untouched; no page error |
| (2) Finance capture replay: `/finance/new` opened, service worker controlling, offline, amount `12.34` and a description typed, "Book" | PASS: the toast "Saved. Will sync once you are back online." appears; after the offline reload `PendingSyncNote` ("N change(s) waiting to sync") is visible; online again, the transaction exists server side (amount 1234 ct) exactly once (no double replay); no page error |
| (3) Overflow at 390x844 (`isMobile`, `hasTouch`) and 1440x900 on `/`, `/recipe` (the recipe Home) and `/finance` | PASS, six pages: at 390 `scrollWidth` 390 = `clientWidth` 390 and the widest element edge 390; at 1440 `scrollWidth` 1425 against `clientWidth` 1440 (`scrollbar-gutter: stable` under classic scrollbars) and 1440 = 1440 with `scrollbarGutter = "auto"`, widest edge 1425; no console error |
| (4) CSP at the second origin `http://127.0.0.1:3001` (logged in there): `/`, `/recipe`, `/recipe/shopping`, `/finance`, `/finance/transactions` | PASS: 27 `/api/` responses, none >= 400; 0 console errors or warnings, 0 `Refused to connect` or CSP messages, 0 requests to `localhost:3001`, 0 failed requests; the served header has `connect-src 'self'` |
| Boot and shutdown (`docs/EFFECT.md` §5): the same API process, then SIGTERM to its pid | PASS: the log ends `[api] SIGTERM — stopping modules …`, `[db] database closed`, `[api] runtime disposed`, `Exited with code 0`, `exit=0`; no 5xx line in the whole log |

Two things about the script, not about the app: the browser's own console line `Failed to load resource: net::ERR_INTERNET_DISCONNECTED` (and
`net::ERR_FAILED`) while `setOffline(true)` is not counted as a page error (it is the browser reporting the refused request the offline outbox expects),
and the overflow measurement skips elements whose ancestor is an `overflow-x` scroller (the recipe Home's week strip, `LI.w-daycard`, is 600 px wide
inside its own scroller at 390), which is what "no element's right edge beyond `innerWidth`" means for a deliberately scrolling strip. A first run
without that refinement flagged it; nothing in the app changed.

### 9.5 Docs synced by E6-T10

`CLAUDE.md` ("Status": E6 done and the new counts, "Layout (as built)": the web runtime bullet and the new web tests, the web gotcha "One web runtime; API calls
are described once" with `disableChecks`, the write pass-through, the non-retried `invalid_response`, the `lenient` marker and its two-way grep, rule (13)
and the D5 two-step deploy rule, "Testing and tooling": rule (13) and the contract tests with the `WEB_CONTRACT_SNAPSHOT=1` switch, "Open work": the sweep);
`docs/EFFECT.md` (the "As built (E6)" sentence under E11; the §4 E6 row untouched); `agent-patterns/effect-http-client.md` §6 (the status-mapper exception) and
§7 (the web as built and the facts found); `agent-patterns/effect-services.md` §7 (the web runtime line); `docs/open-work.md` (A11, the owner's sweep over a
production snapshot, and O-8, two unused recipe client exports). `docs/API.md`, `docs/SPEC.md`, `docs/migration.md`, `docs/deployment.md` and the module docs
are not edited: no route, no service shape and no operator command changed.

### 9.6 Findings

None open. The decode oracle found no shared schema that disagreed with the wire (not on fresh rows, not on the migrated fixtures); the headless
pass found no behaviour change in the offline replays; the bundle is well inside its threshold.

## 10. What changed vs plan

- **D1 (happened, E6-T01).** A response body that fails while being read is `ApiError network_error` (status 0) instead of the raw `TypeError`; the
  `catchTag("HttpClientError")` covers the `DecodeError` and `EmptyBodyError` reasons of `response.text` as it covers every request-side reason.
- **D2 (happened, E6-T01 and E6-T04).** An oversized upload through `sendForm` / `uploadForm` rejects inside the effect instead of throwing synchronously
  (`assertUploadSize` and `fileForm` themselves still throw). The callers: `uploadRecipeImage` is called from a `mutationFn` TanStack runs in its own
  promise chain, so a rejection and a throw reach `onError` the same way; `importFromImage` and `importFromPdf` have no caller at all (the import screens use
  `importApi.ts`), recorded as O-8 in `docs/open-work.md`.
- **D3 (did not happen).** No contract row was marked `lenient` (E6-T02, E6-T03, E6-T02b all found the decode to be the identity on the wire), so no
  `lenient(X)` is applied in any client, the E6-T09 two-way grep checks two empty lists, and `packages/shared` is untouched. The `lenient` marker
  and the grep stay as the mechanism for the next schema that needs it.
- **D4 (happened, E6-T06).** The import client's three former `fetch` paths lose `response.statusText` (`HttpClientResponse` exposes none): an unmapped
  status without an envelope `message` shows `recipe.import.error.unknown.title`; the XHR upload keeps `xhr.statusText`. A body that fails while being
  read is also the `network` kind there.
- **D5 (stands, written into CLAUDE.md).** Reads fail on a structure or type mismatch (`invalid_response`, never retried), writes never fail on their
  response, the checks are not run. The two consequences are in CLAUDE.md's gotcha: the two-step deploy for a widened response literal or shape
  (`skipWaiting` is off, installed PWAs run the previous bundle) and the owner's snapshot sweep (`docs/open-work.md` A11).
- **Deviations the plan did not list.**
  1. **Rule (13b)'s allow list has six files, not eight** (E6-T09): the recipe and finance `lib/api.ts` import no `effect` specifier (they use the helpers of
     `apps/web/src/lib/api.ts`), so the plan's two entries would have been stale entries that the rule itself refuses. The six are `runtime.ts`, `api-client.ts`,
     `api.ts`, `validation.ts`, `InvitePanel.tsx` and `importApi.ts`.
  2. **The finance client has 33 exports, not 34** (E6-T03): 28 JSON and 5 void deletes; the contract test's coverage test reads the client file, so the
     count cannot drift.
  3. **E6-T09's `request<T>` deletion needed no caller migration** (E6-T04 and E6-T05 had moved every caller): the bridge and its `RequestInput` were removed
     as dead code, and the two header comments of `apps/api/test/web-contract-legacy.test.ts` that spelled the lenient format as `schema: "X"` were reworded to
     `"<XResponseSchema>"` because the two-way grep read the placeholder as a row.
  4. **The headless script differs from P17 in three details**: the recipe screen is `/recipe` (there is no `/recipe/recipes` route; the recipe Home is the
     list), Chromium 1248 is started through `executablePath` (Playwright 1.63.0's own revision 1243 is not installed here), and the overflow measurement
     skips elements inside an `overflow-x` scroller (9.4). None of the three touches the app.
  5. **The bundle growth is 17.45 kB, so ADR 0015 was not needed** and `docs/EFFECT.md`'s E11 text carries the number in an "As built (E6)" sentence
     instead (the ADR rule of P15 applies at 60 kB or more).
- **What the plan got right.** The late-bound `Fetch` (without it the per-test `fetch` stubs fail from the second test on), the string JSON body
  (`HttpBody.raw`), the permissive `ApiError` fields, the `Layer.suspend` runtime and the fresh-process import orders (`apps/web/src/lib/runtime.test.ts`)
  all held up as written; the offline outbox tests, `apps/web/src/lib/persist.test.ts`, `apps/web/src/lib/query-client.test.ts` and
  `apps/web/src/lib/session-purge.test.ts` were never edited.
