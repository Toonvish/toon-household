# toon-household API contract

**Authoritative.** The web app is built against this document and the API implements it. Every
request and response name below is an export of `@toon/shared` (`packages/shared/src/index.ts` is
the only entry; the module barrels are re-exported from it). Do not invent shapes: extend the shared
package, and only additively. Where finance's flat barrel renamed a schema, the `Finance…` export name
is the one written here.

This file has three parts: the cross-cutting contract and the **core** API (everything up to
"Core tables"), then `## Recipe module` and `## Finance module`, one section per module. Routes
and error codes are kept in step with this file by `apps/api/test/api-doc.test.ts`: a served core
route without a row, a row without a served route, an error code that no inline-code span names, and
a row documented twice all fail `bun test`.

Base URL: the origin the API listens on (`API_PORT`, default `3001`; the Docker image serves the web
app from the same origin, so `/api` and `/uploads` are relative there). Everything below `/api` is JSON.

## Conventions

- **Content type**: `application/json` for every request body (an upload endpoint of a module uses
  `multipart/form-data`; its section says so). The core auth routes refuse a body that does not
  declare itself JSON with `400 bad_request`: `Request.json()` would happily parse a `text/plain`
  form post, which is exactly what a foreign page can send with the cookie attached.
- **Errors**: always `ApiError` = `{ error: { code, message, details? } }`. `code` values come from
  `ERROR_CODES` (`packages/shared/src/core/schemas/common.ts`) and are a stable wire contract: never
  renamed, never localised. `message` is prose in the request's negotiated locale, so **branch on
  `code`, never on `message`**. A stack trace is never returned. An unknown route answers `404
  not_found` in the same envelope. `422 validation_failed` carries `details`: an array of
  `ValidationIssue` (`{ path, code, message, i18n? }`, `path` is a dotted string).
- **Interface locale**: every response's prose (`error.message`, a validation issue's `message`,
  mailed copy) is rendered in the locale negotiated from the request's `Accept-Language` header
  (first supported primary subtag wins, `;q=` weights are ignored), falling back to the deployment's
  `DEFAULT_LOCALE` (`de`). Supported: `de`, `en`. `Accept-Language` is CORS-safelisted, so this costs no
  preflight. A validation issue also carries `i18n: { key, values }`, so a client may re-render it in
  its own active locale; an unknown key means a version skew and the client falls back to `message`,
  never to the raw dotted key. This is the INTERFACE language only: it never affects module content
  (recipe language, the German recipe parsers, the finance descriptions written into rows, which
  follow `finance_settings.default_locale`).
- **Auth**: an opaque session id in the cookie `toon_session` (`HttpOnly; SameSite=Lax; Secure` in
  production; `Path=/`), 30-day sliding expiry (renewed on use once less than 15 days remain).
  Browsers send `credentials: "include"`. The OAuth handshake uses four short-lived (10 minute)
  cookies, `toon_oauth_state`, `toon_oauth_verify`, `toon_oauth_next` and `toon_oauth_intent`.
- **Auth levels** (the `Auth` column of every row):

  | level | meaning |
  | --- | --- |
  | `public` | no session needed (a route that merely reads an optional session says so in its notes) |
  | `session` | valid session required, else `401 unauthorized` |
  | `household:member` | session plus membership in `:householdId`; `404 not_found` for an unknown household, `403 forbidden` for a non-member |
  | `household:admin` | session plus role `admin` or `owner`, else `403 forbidden` |
  | `household:owner` | session plus role `owner`, else `403 forbidden` |
  | `+module:<id>` | suffix: the household has enabled module `<id>`, else `404 module_disabled` (applied by the mount, see "Middleware chain and mount order") |
  | `+verified` | suffix: a write that answers `403 email_unverified` for an account whose address is unconfirmed, on a deployment that gates on it (see "Unconfirmed accounts are read-only") |
  | `+finance:participant` | suffix, finance only: the caller holds one of the household's two finance seats, else `403 finance_not_participant` |
  | `signature` | `/uploads/…` only: a valid `?exp` and `?sig` (see "Uploads and signed URLs") |

- **Household middleware**: `requireHouseholdRole(role)` in `apps/api/src/middleware/household.ts`,
  applied per route (core) or by the module mount. Membership is never checked inline in a handler.
  The household comes from `:householdId` only, never from a resource row: every by-id lookup in a
  module service filters by that household and answers `404 not_found` for another household's id
  (SPEC D8).
- **Ids**: `crypto.randomUUID()` strings. **Timestamps**: ISO-8601 strings on the wire (`IsoDate`),
  integer unix milliseconds in SQLite. A calendar date (a meal plan day) or a period (finance
  `YYYY-MM`) is text, not an instant, and is described in the module section that owns it.
- **Lists**: `{ items, total, limit, offset }` (`listResponse(...)`). The core `PaginationQuery` is
  `limit` (default 24, 1 to 100) and `offset` (default 0); finance has its own 50 / 200 pagination
  (`FinancePaginationQuery`). Some small lists are a bare `{ items }` (households, members,
  sessions); the row says which.
- **PATCH semantics**: a `PATCH` body carries only the fields to change; an omitted field is left
  alone. `null` clears a nullable field (`description`, `imageUrl`, `avatarUrl`,
  `activeHouseholdId`, `locale`). A `PATCH` with no field at all is `422 validation_failed`
  (`server.validation.noChanges`). `PUT` replaces the whole addressed set (finance participants).
- **Status codes**: `200` read or update, `201` create (with `Location` where a row says so), `204`
  delete or no body, `302` OAuth redirect, `400` bad request, `401` unauthorized, `403` forbidden,
  `404` not found, `409` conflict, `413` too large, `415` unsupported media type, `422`
  validation or parse failure, `429` rate limited, `500` internal, `501` feature off, `504` OCR
  timeout. The `Status` column of a row lists the codes that route's own code raises, with the error
  `code` after a status where it is not the generic one; a `401` is implied for every route that is
  not `public`, and a `422` for every route with a request body or query.
- **Idempotency**: finance ledger writes take a client-minted `mutationId`; the recipe shopping list
  does too. Both are described in their module sections. Nothing in the core needs one.
- **CORS**: on `/api/*`, the allowed origin is the request `Origin` when it is an entry of
  `WEB_ORIGIN` (comma-separated, default `http://localhost:5173`), else the first entry; credentials
  are allowed; methods `GET, POST, PATCH, PUT, DELETE, OPTIONS`; request headers `Content-Type` and
  `Authorization`; `Content-Disposition` and `Location` are exposed; preflights are cached for 24 h.
- **Body size**: the server accepts at most 20 MB per request (15 MB file plus multipart overhead).

## Error codes

`ERROR_CODES` is the complete list; `code` on the wire is a plain string so an older client tolerates
a newer server. The generic ones are raised by the shared `ApiError` helpers, the rest by the
code that names them. "Core" means the core routers, middleware and services; a module column entry
means that module's routes (the module section lists which).

| Code | Status | Raised by | Meaning |
| --- | --- | --- | --- |
| `bad_request` | 400 | core, recipe | Malformed or non-JSON body, a route without a usable id, or a framework error mapped to 400. |
| `validation_failed` | 422 | core, recipe, finance | A Zod schema refused the body or query; `details` lists the issues. |
| `unauthorized` | 401 | core | No session cookie, or it is expired, revoked or unknown (the stale cookie is cleared). |
| `invalid_credentials` | 401 | core | Wrong e-mail or password at login, a wrong or missing `currentPassword` at `POST /api/auth/password`. The answer and its timing are identical for an unknown address. |
| `forbidden` | 403 | core, recipe, finance | The role is too low, the caller is not a member, or the origin guard refused a foreign-origin write (message `server.error.originMismatch`). |
| `not_found` | 404 | core, recipe, finance | The row does not exist, or exists in another household (never revealed), or the route is unknown. |
| `conflict` | 409 | core, recipe, finance | A state conflict without a dedicated code: the invitee is already a member, an accepted invite cannot be revoked, a placeholder keeps role `member`, an already confirmed address, a recipe already planned that day, a committed import draft, finance's missing second seat. |
| `email_taken` | 409 | core | The e-mail already has an account (registration, claim, profile, or an OAuth login on a taken address: OAuth never auto-links). |
| `group_name_taken` | 409 | core | The caller already belongs to a household with that name (`POST /api/households`). The name keeps toon-recipe's wording for wire stability. |
| `tag_name_taken` | 409 | recipe, finance | Another tag of the household has that name. |
| `shopping_list_name_taken` | 409 | recipe | Another shopping list of the household has that name. |
| `card_already_saved` | 409 | recipe | The user already saved a card with the same symbology and number. |
| `too_many_cards` | 409 | recipe | The user already has `CARD_LIMITS.perUser` saved cards. |
| `shopping_list_full` | 409 | recipe | The list already holds `SHOPPING_LIMITS.itemsPerList` lines. |
| `too_many_shopping_lists` | 409 | recipe | The household already has `SHOPPING_LIMITS.listsPerHousehold` lists. |
| `invite_invalid` | 404 | core | At registration: the invite token is unknown, revoked, spent, or not a claim invite where a claim is required. A spent claim token is no capability any more. |
| `invite_expired` | 409 | core | The invite is past `expiresAt`; the row is flagged `expired`. |
| `member_has_account` | 409 | core | A placeholder action (rename, claim invite, claim at registration) addressed a member who already has an account. |
| `invite_claim_requires_register` | 409 | core | A signed-in account tried `POST /api/households/invites/accept` on a claim invite; claim invites are redeemed only by registering. |
| `reset_token_invalid` | 400 | core | The password-reset token is unknown, expired or already used (one code for all three, so a token cannot be probed). |
| `verification_token_invalid` | 400 | core | The e-mail confirmation token is unknown, expired, already used, or issued for another address. |
| `last_owner` | 409 | core | The change would leave the household without an owner (demoting, removing or leaving as the only owner). |
| `email_unverified` | 403 | core, recipe, finance | The account's address is unconfirmed and this deployment makes such an account read-only. The session is valid, so a client must not log the user out; it offers the confirmation mail instead. |
| `payload_too_large` | 413 | core, recipe | An uploaded file exceeds `MAX_UPLOAD_BYTES` (15 MB). |
| `unsupported_media_type` | 415 | core, recipe | The sniffed content type of an upload is not accepted. |
| `rate_limited` | 429 | core, recipe | A rate limit bucket is exhausted (`Retry-After` seconds header and `{seconds}` in the message), or the OCR concurrency gate is full. |
| `fetch_failed` | 400 | recipe | The URL importer could not fetch the page (too large, timeout, blocked by the SSRF guard). |
| `parse_failed` | 422 | recipe | No recipe was found in the fetched page. |
| `ocr_failed` | 422, 504 | recipe | OCR ran or tried to and could not deliver (422), or timed out (504). |
| `pdf_no_text_layer` | 422 | recipe | The PDF has no text layer and OCR found none. |
| `ocr_disabled` | 501 | recipe | Photo or PDF import is switched off on this deployment (`features.ocrImport`, `features.pdfImport`). |
| `oauth_failed` | 400 | core | The OAuth handshake failed (provider error, bad state, incomplete profile). On the callback it is delivered as `?error=` on the redirect. |
| `oauth_not_configured` | 400 | core | The provider has no client credentials on this deployment (`?json=1`, the link route and the callback; a plain browser start redirects to `/login` instead). |
| `oauth_already_linked` | 409 | core | The provider identity is attached to another account, or the account already has that provider. |
| `last_login_method` | 409 | core | Unlinking a provider would leave the account with no way to sign in. |
| `internal_error` | 500 | core | Anything unexpected; the stack goes to the log, never to the client. |
| `meal_plan_day_full` | 409 | recipe | A day already holds `PLAN_LIMITS.entriesPerDay` planned recipes. |
| `module_disabled` | 404 | core | The household has not enabled the module a route belongs to. 404, not 403: for that household the module's routes do not exist. |
| `transaction_amount_zero` | 422 | finance | `amountCents` is 0 (negative amounts are allowed). |
| `transaction_generated` | 409 | finance | `PATCH` or `DELETE` on a booking whose `origin` is not `manual`; only the fixed-cost plan can change it. |
| `balance_stale` | 409 | finance | The `expectedBalanceCents` the client quoted is no longer current; `details` carries the current balance. |
| `settlement_amount_invalid` | 422 | finance | A settlement amount must be greater than 0. |
| `category_in_use` | 409 | finance | The category still has transactions and no `reassignTo`. |
| `category_system` | 409 | finance | A system category (`fixkosten`) cannot be changed or removed. |
| `category_slug_taken` | 409 | finance | Another category of the household already has that slug. |
| `plan_disabled` | 409 | finance | `run` or `recalculate` while the fixed-cost plan is disabled. |
| `plan_incomplete` | 409 | finance | The plan lacks an active item, an income for a person, or has overlapping income rows. |
| `plan_period_locked` | 409 | finance | The start period is on or before a period that already has a booking. |
| `plan_period_out_of_range` | 422 | finance | The requested period lies before the plan's start or in the future. |
| `finance_not_participant` | 403 | finance | The caller is a household member without a finance seat; every ledger route refuses them, reads included. |
| `finance_participants_required` | 422 | finance | The two finance participants must be two different household members in slots 1 and 2. This is also what enabling finance answers without them. |
| `finance_participant_in_use` | 409 | finance | A participant who leaves the budget cannot be replaced while the household has any transaction row or an income naming them (ADR 0004). |
| `member_has_ledger` | 409 | finance | A seated participant cannot leave or be removed from the household while the ledger has rows (ADR 0004). Raised through the member-removal veto, so it surfaces on a core route. |

Notes on the codes the core answers in more than one shape:

- **An invite that cannot be used** answers differently by route, because two services own it. The
  registration path (`POST /api/auth/register` with an `inviteToken`) says `404 invite_invalid` for an
  unknown, revoked or spent token and `409 invite_expired` for an expired one. The household routes
  (`GET /api/households/invites/:token`, `POST /api/households/invites/accept`) say `404 not_found`
  for an unknown or revoked token, and `409 invite_expired` for an expired one; the preview of an
  already accepted invite is `200` with `status: "accepted"`, and accepting a spent one is `404
  not_found`. Branch on the status there.
- **`validation_failed` also covers semantic refusals** that name a field, such as an active household
  the caller is not a member of (`PATCH /api/auth/me`) or a finance plan payer who is not a participant
  (`server.finance.personNotParticipant`).

## Middleware chain and mount order

`apps/api/src/index.ts` registers, in this order (the order is load-bearing and pinned by tests):

1. `onError` and `notFound` handlers (the one error envelope).
2. `securityHeaders` on every path (see "Security").
3. `cors()` on `/api/*`.
4. `localeMiddleware` on every path: negotiates the locale before any router, so error bodies are localised.
5. `originGuard` on `/api/*` (unsafe methods only).
6. `GET /api/health`.
7. `GET /uploads/:filename`.
8. `mountModules`: for every build module, its `userRouter` at `/api/<id>`, and its `householdRouter`
   at `/api/households/:householdId/<id>`.
9. The core routers: `/api/auth`, then `/api/households`.
10. The built web app (`webAppMiddleware`), last, only when `WEB_DIST_DIR` is set. It is the SPA fallback
    for unknown non-file paths, so anything it saw first would never reach a real route; it also refuses
    `/api/*` and `/uploads/*` itself, and a missing path with a file extension is a real `404`, not the
    app shell.

A module's `householdRouter` is mounted behind this chain, in this order:

```
requireSession()  ->  requireHouseholdRole("member")  ->  requireModule(<id>)  ->  the module's router
```

- No cookie is `401` before anything else; a non-member is `403 forbidden` before the module row is
  read, so one household's enabled modules never leak to another's users; a disabled module is
  `404 module_disabled`. `apps/api/test/middleware.test.ts` pins the order.
- Because the chain already ran, a module router has no `requireSession()` or
  `requireHouseholdRole("member")` of its own. It adds `requireVerifiedEmail()` itself (uniformly, or
  per route) and `requireHouseholdRole("admin")` per route where needed.
- A module's `userRouter` (recipe's `/api/recipe/cards`) runs `requireSession()` itself and is **not**
  behind `requireModule`: the data belongs to the user, not to a household.
- **A `household_modules` row is the enabled state.** Every household-creation path (registration,
  OAuth sign-up, `POST /api/households`) writes the default module rows (`recipe`) and then runs each
  build module's `onHouseholdCreated`. The module's routes answer only while the row exists.
- Inside `/api/households` the invite-token routes (`/invites/:token`, `/invites/accept`) are registered
  before `/:householdId`, which would otherwise capture the word `invites`. Module routers stay before
  the `/api/households` router.
- The core routers apply `requireVerifiedEmail()` **per route**, never with `use("*")`: the writes are
  deliberately not uniform (next sections).

## Security

### Origin guard (CSRF)

`apps/api/src/middleware/originGuard.ts` runs on every unsafe `/api/*` request (anything but `GET`,
`HEAD` and `OPTIONS`) after `cors()` and before any router parses a body. `SameSite=Lax` alone does not
stop a script on a sibling origin of the same site, so the rule, in order, is:

1. An `Origin` that is an entry of `WEB_ORIGIN` passes. The dev web app on `:5173` calling the API on
   `:3001` is the same SITE, which rule 2 would refuse; an origin the operator listed is exactly the
   one CORS already trusts. A second origin that legitimately calls the API must be listed in
   `WEB_ORIGIN`, comma-separated.
2. `Sec-Fetch-Site: cross-site` or `same-site` is refused.
3. `Origin: null` (a sandboxed frame, a `data:` page) is refused.
4. An `Origin` whose **host** differs from the request's own host is refused. Only the host is
   compared, never the scheme: the edge proxy terminates TLS, so the browser says `https://` while the
   API sees plain http.
5. No `Origin` at all (curl, tests, server-to-server) passes: a browser always sends one on a
   cross-origin unsafe request, the only case this guard exists for.

A refusal is `403` with code `forbidden` and message key `server.error.originMismatch`. The second half
of the defence is the JSON content-type check of the core auth routes (see Conventions).

### Security headers and the CSP

`apps/api/src/middleware/securityHeaders.ts` sets the browser hardening headers on **every** response
(JSON, `/uploads`, error bodies, preflights, and the PWA in the single-origin container). With no web
build the `Content-Security-Policy` header is exactly:

```
default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob: https:; media-src 'self' blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src blob:
```

When `WEB_DIST_DIR` holds a built `index.html`, the SHA-256 of each inline `<script>` body of that file
(the theme pre-paint script) is appended to `script-src` as `'sha256-…'`, computed once at boot from the
file that is served. The choices that differ from a plain policy, each for a reason:

- `'wasm-unsafe-eval'` (recipe): the card scanner instantiates zxing-wasm. It allows WebAssembly
  compilation only, not `eval`.
- `img-src … blob: https:` and `media-src … blob:` (recipe): import previews are `blob:` and `data:`
  object URLs and a recipe keeps an external `https:` hero image when its local copy failed (the write
  paths copy remote images into `/uploads`, `apps/api/src/modules/recipe/services/recipes/remoteImage.ts`). `object-src blob:`: the PDF import
  preview is an `<embed src="blob:…">`; only a script already running on this origin can mint a `blob:` URL.
- `style-src 'self'` with no `'unsafe-inline'`: the built app has one external stylesheet and no inline
  style.
- **`connect-src 'self'` presumes a web build with `PUBLIC_API_URL=""`** (relative API URLs). A bundle
  that baked `http://localhost:3001` has every API call and every `/uploads` image blocked when served
  from another origin. Build the served app with the variable empty; the CSP is never widened for an
  absolute API URL.

Alongside it: `X-Frame-Options: DENY` and `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin` (an invite or reset URL carries its token in the
path), `Cross-Origin-Resource-Policy: same-site` (not `same-origin`: the dev web origin loads `<img>` from
the API origin), and Hono's other secure-header defaults. There is **no** `Strict-Transport-Security`
(TLS and HSTS belong to the edge proxy, SPEC D11) and no `Permissions-Policy` (the card scanner needs
the camera).

### Rate limits

In-memory sliding windows, one process (`apps/api/src/core/services/auth/rateLimit.ts`), disabled under
`NODE_ENV=test`. A refusal is `429 rate_limited` with a `Retry-After` header in seconds. The key is
`<scope>:<identifier>`, lower-cased. A restart resets every bucket.

| Scope | Route | Identifier | Limit |
| --- | --- | --- | --- |
| `register` | `POST /api/auth/register` | client IP | 5 per 15 min |
| `login` | `POST /api/auth/login` | client IP and e-mail | 10 per 1 min |
| `login-email` | `POST /api/auth/login` | e-mail (IP independent) | 20 per 15 min |
| `password` | `POST /api/auth/password` | user id | 10 per 5 min |
| `password-forgot` | `POST /api/auth/password/forgot` | client IP | 5 per 15 min |
| `password-forgot-email` | `POST /api/auth/password/forgot` | e-mail (IP independent) | 3 per 15 min |
| `password-reset` | `POST /api/auth/password/reset` | client IP | 10 per 15 min |
| `email-verify` | `POST /api/auth/email/verify/request` | user id | 5 per 15 min |
| `email-verify-confirm` | `POST /api/auth/email/verify/confirm` | client IP | 5 per 15 min |
| `oauth` | `GET /api/auth/oauth/:provider/callback` | client IP | 20 per 1 min |
| `household-create` | `POST /api/households` | user id | 5 per 1 hour |
| `invite-mail` | `POST /api/households/:householdId/invites` with an `email` | user id | 10 per 1 hour |

A link-only invite and a claim invite without an address send nothing and are not metered. The recipe
module adds its own import limit (10 per minute per user) and an OCR concurrency gate; see its section.

### Client IP, `TRUST_PROXY` and `X-Forwarded-For`

The rate-limit identifier "client IP" is the socket peer address. **Forwarding headers are believed only
when `TRUST_PROXY=1`**, because on a directly exposed server they are attacker controlled (a fresh
`X-Forwarded-For` per request would hand out a brand-new bucket every time). With `TRUST_PROXY=1` the
address is the **last** entry of `X-Forwarded-For`, the hop the trusted proxy appended, not the first,
which is whatever the client chose to send; then `X-Real-IP`, then `CF-Connecting-IP`. The stack's own
Caddy overwrites the header (`header_up X-Forwarded-For {remote_host}`), so both are the same value
there. If even the socket address is unavailable the bucket is `unknown`, one shared bucket that throttles
rather than opens up. The per-address ceilings (`login-email`, `password-forgot-email`) hold even when
a header can move the IP.

### Passwords, sessions and tokens

Passwords are hashed with `Bun.password` (argon2id), 8 to 200 characters; login always runs a
verification (a dummy hash for an unknown address) so timing does not reveal whether an account exists. A
password change signs every other device out; a password reset signs every device out. Password-reset and
e-mail-confirmation tokens are stored as SHA-256 hashes only; invite tokens are stored raw (a leaked
invites table costs household membership, a leaked reset table would cost accounts). A production API
refuses the `change-me…` `SESSION_SECRET`.

## Health

| Method | Path | Auth | Request | Response | Status |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/health` | public | – | `HealthResponse` | 200 |

`HealthResponse` is `{ ok: true, status: "ok", version, time, database: "file" | "remote", modules,
features }`. `modules` is the ids of the modules this **build** contains (`["recipe","finance"]`), not
what a household enabled. `features` merges the core's flags with each module's `healthFeatures()`, so a
client can stop offering what the server cannot do instead of discovering it through an error. It needs
no session and the service worker never caches `/api`, so the answer is always the running server's.

| Field | Meaning when false |
| --- | --- |
| `features.verifiedEmailRequired` | Nothing is gated on e-mail confirmation: an account writes as soon as it exists. **When true**, an account whose `emailVerifiedAt` is null is READ-ONLY (see the next section). It follows whether a mail transport is configured, so it is `true` with SMTP or Resend and `false` on the default console-only stack. There is deliberately no environment variable for it. |
| module features | Recipe's `features.ocrImport` and `features.pdfImport` are listed in the recipe section. |

`features` is optional in the schema: a client treats a missing one as "unknown", and unknown as
unavailable (briefly hiding a working button is self-correcting, offering a missing one is not).
`verifiedEmailRequired` has the opposite default: unknown reads as `false`, because guessing "gated"
would grey out every write and demand a confirmation the server never asks for.

## Unconfirmed accounts are read-only

Open registration means anybody can mint an account, so on a deployment that can send mail
(`features.verifiedEmailRequired: true`) an account is held read-only until its address is confirmed.
`users.emailVerifiedAt`, the timestamp, never the `emailVerified` boolean, is the only evidence that
counts. Such an account gets **`403 email_unverified`** on:

- `POST /api/households`, `PATCH /api/households/:householdId`, `DELETE /api/households/:householdId`,
- `POST /api/households/:householdId/invites`,
- `POST /api/households/:householdId/members` and `PATCH …/members/:userId/placeholder` (a placeholder
  is content),
- `POST` and `DELETE /api/households/:householdId/modules/:moduleId` (a household-wide settings write),
- every write of the modules' routers that the module section marks `+verified` (recipe: all writes;
  finance: every ledger write, behind `requireFinanceParticipant`).

Everything else is unchanged, and deliberately so:

- **every `GET`**: the account browses its households normally, which is what makes this read-ONLY rather
  than locked out;
- **`POST /api/households/invites/accept`**: the one write that must never be gated, or an invited
  flatmate could not get in at all;
- **the member routes** `PATCH` and `DELETE /api/households/:householdId/members/:userId`: leaving a
  household and changing a role are neither spam nor content, and being trapped in a household is worse
  than what the gate prevents;
- **`DELETE /api/households/:householdId/invites/:inviteId`**: revoking is the undo for the gated create;
- **every `/api/auth/*` route**, including `POST /api/auth/email/verify/request`, which is the way out.

The status is `403`, not `401`: the session is valid and a client must not log the user out over this.
Registering mails the confirmation link by itself, best-effort, so the gate always arrives with its own
way out. **Accounts that start unconfirmed**: every self-registration and every claimed placeholder;
and, after `migrate:legacy`, **finance-only accounts** (users who existed only in toon-finance carry their
password hash but `email_verified = 0` and no timestamp). Such a participant can read the ledger but not
book until the address is confirmed (when mail is configured); a deployment without a mail transport has
no gate, so nothing changes there. `docs/migration.md` has the operator's steps.

## Auth

Mounted at `/api/auth`. All the routes are `readJson` routes: a body that is not
`application/json` is `400 bad_request`.

| Method | Path | Auth | Request | Response | Status |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/auth/register` | public | `RegisterRequest` | `AuthSessionResponse` | 201, 400, 404 `invite_invalid`, 409 `email_taken`, 409 `invite_expired`, 409 `member_has_account`, 422, 429 |
| POST | `/api/auth/login` | public | `LoginRequest` | `AuthSessionResponse` | 200, 400, 401 `invalid_credentials`, 422, 429 |
| POST | `/api/auth/logout` | session | – | – | 204, 401 |
| GET | `/api/auth/me` | session | – | `MeResponse` | 200, 401 |
| PATCH | `/api/auth/me` | session | `UpdateProfileRequest` | `UserResponse` | 200, 401, 422 |
| POST | `/api/auth/password` | session | `ChangePasswordRequest` | – | 204, 401 `invalid_credentials`, 422, 429 |
| POST | `/api/auth/password/forgot` | public | `ForgotPasswordRequest` | – | **always 204**, 422, 429 |
| POST | `/api/auth/password/reset` | public | `ResetPasswordRequest` | – | 204, 400 `reset_token_invalid`, 422, 429 |
| POST | `/api/auth/email/verify/request` | session | – | `EmailVerificationRequestResponse` | 200, 401, 409 `conflict` (already confirmed), 429 |
| POST | `/api/auth/email/verify/confirm` | public | `VerifyEmailRequest` | `UserResponse` | 200, 400 `verification_token_invalid`, 422, 429 |
| GET | `/api/auth/sessions` | session | – | `SessionListResponse` | 200, 401 |
| DELETE | `/api/auth/sessions/:sessionId` | session | – | – | 204, 401, 404 |
| GET | `/api/auth/oauth` | public | – | `OAuthProvidersResponse` | 200 |
| GET | `/api/auth/oauth/:provider` | public | `OAuthProvider` in the path, `?next=`, `?json=1` | 302 to the provider (`OAuthStartResponse` with `?json=1`) | 302, 400 `oauth_not_configured` (only with `?json=1`), 404 |
| GET | `/api/auth/oauth/:provider/link` | session | `OAuthProvider` in the path, `?next=`, `?json=1` | 302 to the provider (`OAuthStartResponse` with `?json=1`) | 302, 400 `oauth_not_configured`, 401, 404 |
| DELETE | `/api/auth/oauth/:provider` | session | – | – | 204, 401, 404, 409 `last_login_method` |
| GET | `/api/auth/oauth/:provider/callback` | public | provider query (`code`, `state`) | 302 to `WEB_ORIGIN` | 302, 400 `oauth_not_configured`, 429 |

`AuthSessionResponse` and `MeResponse` are `{ user, households, activeHouseholdId }` (`households` are
`HouseholdWithRole`, each with its `modules`): one bootstrap shape for the web app. `UserResponse` is
`{ user }`. The `User` of `/me` always has an e-mail; a placeholder cannot sign in.

Notes

- **Registration** creates the account with `emailVerified: false` (self-registration proves nothing
  about who owns the address; the flag is earned through the confirmation flow), mails the confirmation
  link without being asked (best-effort: a failed send never changes the 201), starts a session, and then:
  - with no `inviteToken` it creates the first household named `householdName` (default `Meine Rezepte`,
    owner) and writes the default module rows;
  - with an `inviteToken` for a plain invite it joins that household instead, as the invited role. The
    token is validated **before** the user row is written, so a bad token leaves no user without a
    household behind;
  - with an `inviteToken` for a **claim invite** it creates no user. It writes the registration's e-mail,
    name and password hash onto the placeholder the invite names, **in place, with the same user id**, so
    every membership, finance seat, payer and income person keeps naming that id. One conditional
    `UPDATE … WHERE id = ? AND password_hash IS NULL AND email IS NULL` does it (zero rows is `409
    member_has_account`, a taken address `409 email_taken`; never check-then-write). The invite becomes
    `accepted`, the session belongs to the claimed id, and the account is **unconfirmed** like any
    registration. A spent claim link answers `404 invite_invalid` and never reaches the account it
    created. An address that already has an account never claims a placeholder (`409 email_taken`).
- An e-mail that already has an account is `409 email_taken` whatever the invite.
- **OAuth never auto-links on an e-mail match.** State and PKCE live in short-lived `HttpOnly` cookies. A
  known `oauth_accounts(provider, provider_user_id)` logs that user in; an unknown identity whose e-mail
  is free creates a user (`emailVerified` from the provider, no password) plus the first household; an
  unknown identity on a taken e-mail is `409 email_taken` (delivered as `?error=email_taken` on the
  redirect). To use both methods, sign in and start `GET /api/auth/oauth/:provider/link`, which marks the
  flow with `toon_oauth_intent=link`; it redirects back to `?next=` with `?linked=<provider>` or
  `?error=<code>`. A confirmed address still does NOT enable auto-linking.
- `GET /api/auth/oauth` reads an optional session: with one, `linked` and `linkedEmail` say which
  providers the user can already sign in with; without one they are `false` and `null`.
- `GET /api/auth/oauth/:provider` **redirects** a browser to `/login?error=oauth_not_configured` when the
  provider has no credentials; only `?json=1` gets the `400`. The callback converts every failure into a
  redirect carrying `?error=<code>` (to `/login`, or to `?next=` when linking), except
  `oauth_not_configured` (JSON `400`) and `429`.
- `?next=` is validated by `safeNextPath`: relative paths only, with no backslashes, control characters
  or spaces.
- `DELETE /api/auth/sessions/:sessionId` takes the **handle** from `SessionListResponse`, never the raw
  session id (it would end up in an access log and be reusable as a cookie).
- `PATCH /api/auth/me`: `avatarUrl` may be the signed URL the client was served; the bare
  `/uploads/<file>` is stored. An `activeHouseholdId` the caller is not a member of is `422
  validation_failed` (`server.group.notAMember`). `locale` mirrors the device choice onto the account so
  mail can pick a language.
- `POST /api/auth/password`: an account with a password must send `currentPassword` (`401
  invalid_credentials` when missing or wrong); an OAuth-only account (`hasPassword: false`) may omit it.
  Every other session of the user is deleted.
- `PasswordSchema` (8 to 200 characters) is shared by register, reset and change.

### Password reset

- `POST /api/auth/password/forgot` answers **204 whether or not the address exists**, with an identical
  body and timing; anything else is a user-enumeration oracle. The rate limit is enforced before the
  lookup, a failed mail send is swallowed (logged), and an unknown address (a placeholder has none)
  simply sends nothing.
- It is rate limited twice, per IP and per address (see "Rate limits").
- `POST /api/auth/password/reset` consumes the token **once**, sets the new hash and **deletes every
  session of that user**. It answers 204 and does **not** sign the user in; the web app sends them to
  `/login`. Unknown, expired and used tokens all answer the same `400 reset_token_invalid`. TTL is
  **1 hour**; a new request invalidates the outstanding token.
- Operator escape hatch with no mailer: `bun run auth:reset-password <email> [--send]` mints a token and
  prints the URL.

### E-mail verification

- `POST /api/auth/email/verify/request` mails a link to the **session's own** address (authenticated, so
  it is not another enumeration oracle). TTL 24 hours, one live token per user. It answers **200
  `{ mailDelivery }`** (`"sent" | "not_configured" | "failed"`), not 204: the send happens after the token
  row is written and can fail without failing the request, and with an empty body the UI would claim
  "mail on its way" for a message that only reached the log. **Do not copy that onto `/password/forgot`**,
  where the answer must stay identical for a known and an unknown address. `409 conflict` when the address
  is already confirmed.
- `POST /api/auth/email/verify/confirm` works **without a session** (the link is regularly opened on
  another device) and sets `email_verified` and `email_verified_at` together. A token is bound to the
  address it was issued for, so it cannot verify an address that changed in the meantime.

## Households

Mounted at `/api/households`. The two `/invites/…` routes are registered before `/:householdId`. A
household is `HouseholdWithRole`: the household row, the caller's `role`, a `memberCount`, and
`modules`, the ids of the modules enabled for it (the core never counts a module's rows, ADR 0001).

| Method | Path | Auth | Request | Response | Status |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/households` | session | – | `HouseholdListResponse` | 200, 401 |
| POST | `/api/households` | session+verified | `CreateHouseholdRequest` | `HouseholdResponse` | 201 (+ `Location`), 401, 403 `email_unverified`, 409 `group_name_taken`, 422, 429 |
| GET | `/api/households/invites/:token` | public | – | `InvitePreviewResponse` | 200, 404, 409 `invite_expired` |
| POST | `/api/households/invites/accept` | session | `AcceptInviteRequest` | `AcceptInviteResponse` | 200, 401, 404, 409 `invite_expired`, 409 `invite_claim_requires_register`, 422 |
| GET | `/api/households/:householdId` | household:member | – | `HouseholdDetailResponse` | 200, 401, 403, 404 |
| PATCH | `/api/households/:householdId` | household:admin+verified | `UpdateHouseholdRequest` | `HouseholdResponse` | 200, 401, 403, 403 `email_unverified`, 404, 422 |
| DELETE | `/api/households/:householdId` | household:owner+verified | – | – | 204, 401, 403, 403 `email_unverified`, 404 |

Notes

- `POST /api/households` makes the caller `owner`, points `users.active_household_id` at the new
  household, writes the default module rows and runs every build module's `onHouseholdCreated`, in one
  transaction. A household name may not repeat one of the caller's own (`409 group_name_taken`). Names are
  1 to 80 characters without control characters; `description` is at most 500.
- Ownership transfer is `PATCH …/members/:userId { role: "owner" }` (see Members); there is exactly one
  owner at any time.
- `DELETE /api/households/:householdId` cascades the household's members, invites, module rows and every
  module's household-scoped rows, and deletes the **placeholder users** that belonged to nowhere else.
- `imageUrl` of `UpdateHouseholdRequest` accepts the signed URL the client was served and stores the
  bare `/uploads/<file>`.
- Account deletion is intentionally not exposed: `created_by` and `invited_by` cascade, so a future
  "delete account" flow must first transfer household ownership and re-assign authorship.

## Members and placeholders

A **placeholder** is a core `users` row with `email IS NULL AND password_hash IS NULL`: a person added to
a household by name so a module (finance) can name them before they ever sign in (ADR 0006). It has no
session, no OAuth link and no avatar, cannot sign in (login, reset and OAuth all look up by e-mail or
provider id), and has role `member` for good. It becomes an account only through a claim invite redeemed
by registration. `HouseholdMember.hasAccount` is `false` for it and `user.email` is `null`.

| Method | Path | Auth | Request | Response | Status |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/households/:householdId/members` | household:member | – | `HouseholdMemberListResponse` | 200, 401, 403, 404 |
| POST | `/api/households/:householdId/members` | household:admin+verified | `CreatePlaceholderMemberRequest` | `HouseholdMemberResponse` | 201 (+ `Location`), 401, 403, 403 `email_unverified`, 404, 422 |
| PATCH | `/api/households/:householdId/members/:userId/placeholder` | household:admin+verified | `UpdatePlaceholderMemberRequest` | `HouseholdMemberResponse` | 200, 401, 403, 403 `email_unverified`, 404, 409 `member_has_account`, 422 |
| PATCH | `/api/households/:householdId/members/:userId` | household:admin | `UpdateMemberRoleRequest` | `HouseholdMemberResponse` | 200, 401, 403, 404, 409 `last_owner`, 409 `conflict` (a placeholder keeps `member`), 422 |
| DELETE | `/api/households/:householdId/members/:userId` | household:member (yourself) or household:admin | – | – | 204, 401, 403, 404, 409 `last_owner`, 409 `member_has_ledger` |

Notes

- `POST …/members` adds a placeholder by `displayName` (`201 { member }`, role `member`, `hasAccount:
  false`). The user row and the membership are written in one transaction; the core has no "household
  full" rule (a module that seats people decides its own seats).
- `PATCH …/members/:userId/placeholder` renames a placeholder (`{ name }`). A person with an account names
  themselves (`PATCH /api/auth/me`), so a member with an account is `409 member_has_account`; a
  non-member is `404`.
- `PATCH …/members/:userId` changes a role: only an owner may grant `owner` or change an owner's role; the
  previous owner becomes `admin` in the same transaction; the last owner can never lose the role (`409
  last_owner`); a placeholder always stays `member` (`409 conflict`).
- **`DELETE …/members/:userId`** needs only `member` because everybody may remove **themselves** ("leave");
  removing somebody else needs `admin`, and an admin may not remove someone above their own rank. The last
  owner cannot leave (`409 last_owner`, transfer ownership first). **The core runs every build module's
  `onMemberRemoving(householdId, userId, tx)` before it deletes the membership, whether or not the module
  is enabled for the household (rows outlive a disable), and a module may veto by throwing.** Finance's
  veto (ADR 0004): a seated participant is refused with **`409 member_has_ledger`** while the household has
  any transaction row or an income naming them; with an empty ledger the seat is deleted, a slot-2
  survivor is re-seated in slot 1 and the plan payer moves, and the household becomes a one-seat ledger
  until an admin seats two people again. A member without a seat may always leave. A veto deletes nothing.
  Removing a placeholder goes the same way, module vetoes included, and then deletes its user row (its
  claim invites follow by cascade).

## Invites and claim invites

Invite tokens are 32 random bytes, URL-safe, valid for 14 days; `inviteUrl` is
`<first WEB_ORIGIN>/invite/<token>`. The token is the capability.

| Method | Path | Auth | Request | Response | Status |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/households/:householdId/invites` | household:admin | `PaginationQuery` | `HouseholdInviteListResponse` | 200, 401, 403, 404, 422 |
| POST | `/api/households/:householdId/invites` | household:admin+verified | `CreateInviteRequest` | `HouseholdInviteResponse` | 201, 401, 403, 403 `email_unverified`, 404, 409 `member_has_account`, 409 `conflict` (already a member), 422, 429 |
| DELETE | `/api/households/:householdId/invites/:inviteId` | household:admin | – | – | 204, 401, 403, 404, 409 `conflict` (already accepted) |

(`GET /api/households/invites/:token` and `POST /api/households/invites/accept` are in "Households".)

Notes

- A **plain invite** needs an `email` and a `role` (`admin` or `member`, default `member`, never `owner`).
  The invitee must not already be a member (`409 conflict`). A newer plain invite for the same address
  revokes the older pending one.
- A **claim invite** names a placeholder in `claimsUserId` (ADR 0006). **Creating one needs `admin` or
  `owner`** (toon-finance lets either member). Its role is always `member`. `404` for a user who is not a
  member of the household, **`409 member_has_account`** for a member who already has an account (a link
  that could write a password onto a real account must not exist). It may carry an `email`, and only then
  is it mailed; without one the response has `emailSent: false` and no `mailDelivery`, and the admin
  copies `inviteUrl` from the response. **Creating a claim invite revokes the older pending one for the
  same placeholder**: one open claim link per placeholder, which is also the "send it again" path.
- A claim invite is redeemed **only by registration** (`POST /api/auth/register { inviteToken }`). A
  signed-in account calling `POST /api/households/invites/accept` on one gets **`409
  invite_claim_requires_register`**; the one caller let through is the claimed user itself, replaying its
  accept. A **spent** claim token is no capability for anyone: registering onto it answers `404
  invite_invalid`, accepting it `404 not_found`.
- `InvitePreviewResponse` (public) carries `claimsDisplayName`, so the landing page can say as whom the
  visitor is being registered and prefill the name; `email` is `null` for an addressless claim invite.
- `HouseholdInviteResponse` is `{ invite, inviteUrl, emailSent?, mailDelivery? }`. `inviteUrl` is the
  source of truth: the invite is valid whether or not a mail went out. `mailDelivery` has three states
  (`sent`, `not_configured`, `failed`) and a UI must never render the last two as success. Only the
  mailing variant is rate limited (`invite-mail`).
- `acceptInvite` is idempotent for a caller who is already a member (the existing role is kept, nobody is
  downgraded); the invited e-mail is not enforced, so a link can be forwarded.
- The invite list includes the tokens, so links can be re-copied; it is admin-only.
- Every claim link is a credential: whoever holds it becomes that person. The `migrate:legacy` apply
  report carries live links and must stay outside any repository.

## Modules

A household enables the modules it uses; a `household_modules` row is the enabled state, and without it a
module's routes answer `404 module_disabled`. New households start with `DEFAULT_ENABLED_MODULES`
(`["recipe"]`).

| Method | Path | Auth | Request | Response | Status |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/households/:householdId/modules/:moduleId` | household:admin+verified | `EnableModuleRequest` (body optional) | `HouseholdResponse` | 200, 401, 403, 403 `email_unverified`, 404, 409 `finance_participant_in_use`, 422 `finance_participants_required`, 422 |
| DELETE | `/api/households/:householdId/modules/:moduleId` | household:admin+verified | – | – | 204 (idempotent), 401, 403, 403 `email_unverified`, 404 |

Notes

- `:moduleId` is any id of `MODULE_IDS` (`recipe`, `finance`), whether or not this build contains the
  module; any other id is `404 not_found`. The enable body is `{ settings? }`, an optional module-owned JSON
  object; an empty body means `{}`, and a body that is not valid JSON or not that shape is `422
  validation_failed`.
- **Enabling runs the build module's `onEnable(householdId, settings, tx)` hook before the row is
  written**, and the hook may refuse by throwing, in which case nothing is written. The response is the
  household with its updated `modules`. A repeated enable keeps `enabled_at`; `settings` is replaced only
  when the caller sent some.
- **Enabling finance needs two participants** (D3). The caller sends `settings: { participants: [{
  userId, memberSlot: 1 }, { userId, memberSlot: 2 }] }`: two different household members, applied with
  the `PUT …/finance/participants` rules. A malformed or missing pair is **`422
  finance_participants_required`** and nothing is written. A re-enable after a disable needs no body:
  finance requires its two existing `finance_participants` rows (else the same `422`), because that table
  is the truth and the core's stored `settings` JSON is never read back. Changing the participants on a
  household whose ledger has rows is `409 finance_participant_in_use`.
- **Disabling keeps the data.** Only the `household_modules` row is deleted; the module's own rows stay in
  its tables, so enabling again brings the ledger or the recipes back unchanged. The call is idempotent:
  disabling a disabled module is 204. A client that disables behind the web app's back learns it from the
  first `404 module_disabled`.
- Both routes need `admin` or `owner` and a verified e-mail, like `PATCH /api/households/:householdId`.

## Uploads and signed URLs

`UPLOAD_DIR` holds two kinds of file with two different rules.

| Method | Path | Auth | Request | Response | Status |
| --- | --- | --- | --- | --- | --- |
| GET | `/uploads/:filename` | signature | `?exp` and `?sig` | binary | 200, 404 (missing, forged or expired signature, or no such file) |
| GET | `/uploads/:filename.thumb.webp` | signature | `?exp` and `?sig` | binary | 200 (built on demand; the original when it cannot be converted), 404 |

**Avatars, household images and the recipe module's images** are served by `GET /uploads/:filename`,
which requires `?exp=<unix ms>&sig=<hmac>`. The signature is HMAC-SHA256 over `"<filename>|<exp>"`
keyed with `SESSION_SECRET`, truncated to 128 bits (32 hex characters). Missing, forged and expired
signatures all answer **404**, so the route never confirms that a file exists. Responses are `Cache-Control:
private, max-age=21600, immutable`. A cookie check is not possible: images are plain `<img>` tags, the
default dev deployment is cross-origin, and a cross-origin `<img>` sends no credentials, so the
authorisation travels in the URL.

- **Minted on serialisation**, not on storage: wherever a stored media path becomes a DTO (the user, the
  household, the recipe and collection mappers, the upload response), the value is wrapped by
  `signUploadUrl()`.
- **Stripped on every write**: `normalizeStoredUploadUrl()` reduces whatever the client sends back to the
  bare `/uploads/<filename>`, so a column never holds an expiring value or a pinned origin. A client that
  round-trips the URL it was given is harmless.
- `exp` is **quantised to a 12 h window**, so every response inside one window carries a byte-identical URL
  (otherwise the browser and service-worker image caches would never hit). A signature is valid for 12 to
  24 hours, which is also the window in which a link a removed member kept goes dead.
- External URLs (`https://…`), `data:` URIs and anything with a path segment are passed through untouched
  and never signed. A path with `..` or a leading `/` is a `404`.
- Uploads are at most 15 MB (`MAX_UPLOAD_BYTES`) and their real content type is sniffed server-side
  (`413 payload_too_large`, `415 unsupported_media_type`). The upload endpoints belong to the recipe
  module and are listed in its section.

**List thumbnails** are derived, never uploaded and never stored. `<name>.thumb.webp` is the 480 px WebP
derivative of `<name>`, one flat filename under `UPLOAD_DIR`, so it is signed, verified and swept like any
other upload. `GET /uploads/<name>.thumb.webp` builds the file on the first request and caches it on disk.
A conversion that fails (sharp missing, HEIC without the HEIF plugin) serves the **original** with a short
`max-age` (`private, max-age=300`) instead of a `404`.

**Import source scans** (the photo or PDF behind a recipe import draft) are the private half: no signature
is ever minted for them, so `/uploads/…` cannot serve one at all. They are available only from the
membership-checked recipe route `GET /api/households/:householdId/recipe/imports/:draftId/source`.

Orphaned files are swept by `bun run uploads:gc [-- --dry-run] [-- --min-age-hours=N]`: it deletes files no
row references (the core's avatars and household images plus every module's `uploadReferences`), keeps files
younger than 24 hours, and deletes a `.thumb.webp` together with its original.

## Core tables

SQLite through libSQL, `apps/api/src/db/schema/core.ts`; ids are text UUIDs, timestamps integer unix
milliseconds, booleans 0 or 1. Module tables are prefixed (`recipe_`, `finance_`) and described in their
sections; core tables are not.

| Table | Holds |
| --- | --- |
| `users` | One row per person. `email` is NULL only for a placeholder (the unique index stays: SQLite treats NULLs as distinct); `password_hash` is NULL for an OAuth-only account or a placeholder; `email_verified` plus `email_verified_at` (the timestamp is the evidence); `active_household_id` is a soft pointer without a foreign key; `locale` is the interface locale or NULL. |
| `oauth_accounts` | A provider identity (`provider`, `provider_user_id`, `provider_email`) attached to a user. Unique on `(provider, provider_user_id)`. |
| `sessions` | The opaque session id (the cookie value), `expires_at`, `last_used_at`, `ip_address`, `user_agent`. |
| `password_reset_tokens` | SHA-256 hash of the token, `expires_at` (1 hour), `used_at`, `requested_ip`. |
| `email_verification_tokens` | Same shape plus the `email` the token was issued for; 24 hours. |
| `households` | `name`, `description`, `image_url`, `created_by`. |
| `household_members` | `(household_id, user_id)` unique, `role` `owner` / `admin` / `member`. |
| `household_invites` | `email` (NULL for an addressless claim invite), `role`, the raw `token` (unique), `status` `pending` / `accepted` / `revoked` / `expired`, `invited_by`, `accepted_by`, `expires_at`, and `claims_user_id` (the placeholder a claim invite turns into an account; cascades with it). |
| `household_modules` | `(household_id, module_id)` primary key: the enabled state; `enabled_at`; `settings` module-owned JSON text. |
| `legacy_ids` | The idempotency ledger of `bun run migrate:legacy`: `(table, legacy_source, legacy_id)` primary key, `new_id`. The SQL column is named `table`. |

`password_reset_tokens` and `email_verification_tokens` store a **hash**, never the token, the deliberate
difference from `household_invites.token`, which keeps the raw value. Unique indexes: `users.email`,
`oauth_accounts(provider, provider_user_id)`, `household_members(household_id, user_id)`,
`household_invites.token`, `password_reset_tokens.token_hash`, `email_verification_tokens.token_hash`.
Every household-scoped table cascades from `households`; `household_invites.claims_user_id` cascades from
`users`. Authorship columns (`created_by`, `invited_by`) cascade on user deletion, which is why account
deletion is not exposed (see "Households").

## Recipe module

### Health features

| Field | Meaning when false |
| --- | --- |
| `features.ocrImport` | `/imports/image` (and `/imports/file` for an image) answer `501 ocr_disabled` (`IMPORT_OCR_ENABLED` unset, or an image built without `WITH_OCR=1`). URL and text import still work. |
| `features.pdfImport` | `/imports/pdf` (and `/imports/file` for a PDF) answer `501 ocr_disabled` (`IMPORT_PDF_ENABLED=0`, or an image built without `WITH_PDF=1`). Separate from `ocrImport` because a scanned PDF is up to ten tesseract runs where a photo is one — a one-core deployment runs photos and withholds PDFs. Itself optional inside `features`, so a client newer than its server still parses the object; absent reads as unavailable. |

### Unconfirmed accounts in the recipe module

Such an account gets **`403 { code: "email_unverified" }`** on:

- every `POST`/`PATCH`/`PUT`/`DELETE` under `/api/households/:householdId/recipe/recipes`, `/tags`, `/collections`,
  `/imports` (all six sources, plus draft edit/delete and commit), `/shopping-lists` and `/plan`
  (create, update, delete of a meal-plan entry),
- every write under `/api/recipe/cards` (create, update, delete and `…/:cardId/used`), a user-scoped
  router behind `requireSession()` that mounts `requireVerifiedEmail()` itself.

### Recipes — `apps/api/src/modules/recipe/routes/recipes.ts`

Mounted at `/api/households/:householdId/recipe` by `mountModules` (`apps/api/src/modules/mount.ts`), behind `requireSession()` → `requireHouseholdRole("member")` → `requireModule("recipe")`, so this router also owns tags and collections.

| Method | Path | Auth | Request | Response | Status |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/households/:householdId/recipe/recipes` | household:member+module:recipe | `RecipeListQuery` (query) | `RecipeListResponse` | 200, 403 |
| POST | `/api/households/:householdId/recipe/recipes` | household:member+module:recipe+verified | `CreateRecipeRequest` | `RecipeResponse` | 201, 403, 422 |
| GET | `/api/households/:householdId/recipe/recipes/:recipeId` | household:member+module:recipe | – | `RecipeResponse` | 200, 403, 404 |
| PATCH | `/api/households/:householdId/recipe/recipes/:recipeId` | household:member+module:recipe+verified (author or admin) | `UpdateRecipeRequest` | `RecipeResponse` | 200, 403, 404, 422 |
| DELETE | `/api/households/:householdId/recipe/recipes/:recipeId` | household:member+module:recipe+verified (author or admin) | – | – | 204, 403, 404 |
| POST | `/api/households/:householdId/recipe/recipes/:recipeId/image` | household:member+module:recipe+verified | multipart `file` | `UploadResponse` | 200, 403, 413, 415 |
| GET | `/api/households/:householdId/recipe/recipes/:recipeId/scale` | household:member+module:recipe | `ScaleRecipeQuery` (query) | `ScaledRecipeResponse` | 200, 403, 404, 422 |
| POST | `/api/households/:householdId/recipe/recipes/:recipeId/cooked` | household:member+module:recipe+verified | `MarkCookedRequest` | `RecipeCookedResponse` | 200, 403, 404 |
| DELETE | `/api/households/:householdId/recipe/recipes/:recipeId/cooked` | household:member+module:recipe+verified | – | – | 204, 403, 404 `server.recipes.nothingToUndo` |
| GET | `/api/households/:householdId/recipe/tags` | household:member+module:recipe | – | `TagListResponse` | 200, 403 |
| POST | `/api/households/:householdId/recipe/tags` | household:member+module:recipe+verified | `CreateTagRequest` | `TagResponse` | 201, 403, 409 `tag_name_taken`, 422 |
| PATCH | `/api/households/:householdId/recipe/tags/:tagId` | household:member+module:recipe+verified | `UpdateTagRequest` | `TagResponse` | 200, 403, 404, 409 |
| DELETE | `/api/households/:householdId/recipe/tags/:tagId` | household:admin+module:recipe+verified | – | – | 204, 403, 404 |
| GET | `/api/households/:householdId/recipe/collections` | household:member+module:recipe | – | `CollectionListResponse` | 200, 403 |
| POST | `/api/households/:householdId/recipe/collections` | household:member+module:recipe+verified | `CreateCollectionRequest` | `CollectionResponse` | 201, 403, 422 |
| GET | `/api/households/:householdId/recipe/collections/:collectionId` | household:member+module:recipe | – | `CollectionDetailResponse` | 200, 403, 404 |
| PATCH | `/api/households/:householdId/recipe/collections/:collectionId` | household:member+module:recipe+verified | `UpdateCollectionRequest` | `CollectionResponse` | 200, 403, 404, 422 |
| DELETE | `/api/households/:householdId/recipe/collections/:collectionId` | household:member+module:recipe+verified (creator or admin) | – | – | 204, 403, 404 |
| PUT | `/api/households/:householdId/recipe/collections/:collectionId/recipes/:recipeId` | household:member+module:recipe+verified | – | – | 204, 403, 404 |
| DELETE | `/api/households/:householdId/recipe/collections/:collectionId/recipes/:recipeId` | household:member+module:recipe+verified | – | – | 204, 403, 404 |

Notes
- `CreateRecipeRequest.tags` are tag **names**; unknown names are created inside the household
  (`recipe_tags(household_id,name)` is unique, so upsert case-insensitively).
- `ingredients` / `steps` / `tags` / `collectionIds` are **replace-all** when present in a PATCH and
  untouched when absent. Positions are re-assigned from array order.
- `q` searches `recipe_recipes.title`, `recipe_recipes.description` and `recipe_recipe_ingredients.name` with LIKE, via
  the pre-folded `*_fold` columns (see the search-strategy comment in `src/db/schema.ts`; FTS5 is
  out of scope). Matching is unchanged: case- and diacritic-insensitive, German folding.
- `tags` in `RecipeListQuery` is a comma-separated list of tag **ids**; a recipe must carry all.
- `scale` uses `scaleIngredients` from `@toon/shared` so client and server agree.
- **`?sort=lastCooked`** puts the most-recently-cooked recipe first and never-cooked recipes
  **last** — `ORDER BY last_cooked_at DESC` puts SQLite `NULL`s at the end for free, so the sort
  needs no `IS NULL` leading term and stays index-served (`recipe_recipes_household_last_cooked_idx`).
  **`?hasCooked=1`** restricts the list to recipes cooked at least once (`last_cooked_at IS NOT
  NULL`, a plain column predicate — never a subquery, so the envelope's `count(*)` stays
  index-narrowed). `hasCooked` is intentionally absent from `RecipeListQuery`'s persisted URL
  filters; it exists only for the "Kürzlich gekocht" carousel's own request.
- **`recipe.lastCookedAt` is READ-ONLY and derived** from `recipe_recipe_cook_log`, never accepted on a
  write. It changes only through `POST`/`DELETE /api/households/:householdId/recipe/recipes/:recipeId/cooked` below, and cooking a recipe never bumps
  `recipe.updatedAt` — a cook is not an edit, and bumping it would reorder `?sort=newest`.
- **`POST /api/households/:householdId/recipe/recipes/:recipeId/cooked`** ("Gekocht") appends one `recipe_recipe_cook_log` row stamped with
  the caller's id, sets `recipe.lastCookedAt` to that instant, and — **only if the client says
  so** — stamps a meal-plan entry's `cookedAt`: `mealPlanEntryId` when the caller already knows it
  (must actually name this recipe, else 404 `server.plan.entryNotFound`), otherwise the entry for
  `plannedOn` **if one exists that day**, otherwise nothing. The server never derives a date or an
  entry itself; `MarkCookedRequest`'s body is all-optional, so a bare `POST {}` marks the recipe
  cooked with no plan entry touched and `mealPlanEntry: null` in the response.
- **`DELETE /api/households/:householdId/recipe/recipes/:recipeId/cooked`** undoes the **caller's own** most recent cook of that
  recipe, but only within `COOK_UNDO_WINDOW_MS` (10 minutes) of it — outside that window, or with
  nothing to undo, it is 404 `server.recipes.nothingToUndo`. It recomputes `lastCookedAt` from
  `max(cookedAt)` over the remaining log rows (`null` if none remain, since another member may have
  cooked the same recipe in between) and clears the stamped plan entry's `cookedAt` **only if the
  undone row was the one that set it**.
- **`course` (create/PATCH) is one tag NAME, separate from `tags`.** Sending it gets-or-creates that
  name inside the household as `kind: 'course'` and replaces the recipe's one course link (a recipe has
  at most one). **Absent** (the field left out of a PATCH) leaves the course link untouched;
  **`null`** unlinks it. `course` therefore has no default and is deliberately **not** one of the
  child arrays `keepOnlySentKeys` restores — that mechanism exists only for `ingredients` / `steps`
  / `tags` / `collectionIds`, which carry a schema `.default([])` and would otherwise read "field
  omitted" as "send an empty array".
- **`tags` (create/PATCH) always creates and links `kind: 'free'` tags, and a PATCH's `tags` array
  replaces only the recipe's FREE links** — a course link set through `course` is left alone by a
  `tags`-only PATCH. This is why `course` is its own field instead of one more tag name: routing it
  through `tags` would create "Dessert" as a `free` tag and lose the eyebrow.
- **An older client that has never heard of `course`** and instead sends the category's name inside
  `tags` still works: the name is get-or-created as `kind: 'free'` like any other tag NAME, **except**
  when a tag by that exact name already exists as `kind: 'course'` — then the existing tag is linked
  as-is, never flipped to `free`. `getOrCreateTagIds` changes the `kind` only of a tag it CREATES,
  never one it finds.
- `Tag.kind` (`'course' | 'free'`) is returned on every tag, in `GET /tags` and everywhere a recipe's
  `tags` array appears. `CreateTagRequest.kind` defaults to `'free'` server-side.
- Tag and course **names are CONTENT** (German recipe vocabulary), never routed through the locale
  catalogs — see CLAUDE.md's interface-vs-content gotcha.

### Imports — `apps/api/src/modules/recipe/routes/imports.ts`

Mounted at `/api/households/:householdId/recipe/imports`. **Every** import produces an `ImportDraft` that the user
edits in the review screen; nothing is written to `recipe_recipes` until `/commit`.

| Method | Path | Auth | Request | Response | Status |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/households/:householdId/recipe/imports/url` | household:member+module:recipe+verified | `ImportUrlRequest` | `ImportDraftResponse` | 201, 403, 422 `parse_failed`, 400 `fetch_failed` |
| POST | `/api/households/:householdId/recipe/imports/image` | household:member+module:recipe+verified | multipart `file` | `ImportDraftResponse` | 201, 403, 413, 415, 422 `ocr_failed`, 501 `ocr_disabled` |
| POST | `/api/households/:householdId/recipe/imports/pdf` | household:member+module:recipe+verified | multipart `file` | `ImportDraftResponse` | 201, 403, 413, 415, 422 `pdf_no_text_layer`, 501 `ocr_disabled` |
| POST | `/api/households/:householdId/recipe/imports/text` | household:member+module:recipe+verified | `ImportTextRequest` | `ImportDraftResponse` | 201, 403, 422 |
| POST | `/api/households/:householdId/recipe/imports/file` | household:member+module:recipe+verified | multipart `file` | `ImportDraftResponse` | 201, 403, 413, 415, 422, 501 `ocr_disabled` |
| GET | `/api/households/:householdId/recipe/imports/:draftId/source` | household:member+module:recipe | – | binary | 200, 403, 404 |
| GET | `/api/households/:householdId/recipe/imports` | household:member+module:recipe | `ImportDraftListQuery` (query) | `ImportDraftListResponse` | 200, 403 |
| GET | `/api/households/:householdId/recipe/imports/:draftId` | household:member+module:recipe | – | `ImportDraftResponse` | 200, 403, 404 |
| PATCH | `/api/households/:householdId/recipe/imports/:draftId` | household:member+module:recipe+verified | `UpdateImportDraftRequest` | `ImportDraftResponse` | 200, 403, 404, 422 |
| POST | `/api/households/:householdId/recipe/imports/:draftId/commit` | household:member+module:recipe+verified | `CommitImportDraftRequest` | `CommitImportDraftResponse` | 201, 403, 404, 422 |
| DELETE | `/api/households/:householdId/recipe/imports/:draftId` | household:member+module:recipe+verified | – | – | 204, 403, 404 |

Notes
- **PHOTO AND PDF IMPORT ARE OPT-IN, AND SEPARATELY SO.** `/imports/image` needs
  `IMPORT_OCR_ENABLED`, `/imports/pdf` needs `IMPORT_PDF_ENABLED` (which follows the first unless
  set), and `/imports/file` needs whichever kind was actually uploaded — decided by SNIFFED content,
  so renaming a PDF does not get it past the gate. Otherwise **`501 { code: "ocr_disabled" }`**,
  because OCR needs the `tesseract`/`pdftoppm` binaries and the memory a job holds, and a scanned PDF
  costs an order of magnitude more than a photo (see README and `docs/deployment.md`). 501 rather
  than 503: it is how the server was built, not a temporary outage, so retrying cannot help. Both
  cases share the `ocr_disabled` code — a wire contract, and the client's handling is identical —
  but the MESSAGE differs, since a server with photos on should say so rather than send the user to
  a URL. The check runs BEFORE the rate limiter and before the body is read, so a rejected upload
  costs neither a bucket slot nor 15 MB of buffering; the one exception is `/imports/file` on a
  server offering only one kind, where the content must be sniffed first. `/imports/url`,
  `/imports/text`, the draft endpoints and commit are unaffected, and a draft OCR produced earlier
  stays reviewable and committable. Clients discover all this from `HealthResponse.features`
  rather than by probing — but the 501 is the enforcement, since an installed PWA can be running a
  bundle from before the flag was flipped.
- `sourceType`: `url` for URL imports, `ocr` for image **and** PDF imports, `manual` for pasted text.
  `sourceMeta.method` disambiguates: `json-ld` \| `microdata` \| `selector` \| `pdf-text` \| `ocr` \| `manual`.
- URL pipeline: fetch → JSON-LD `@graph`/array-aware schema.org `Recipe` → microdata → site selectors
  (chefkoch.de, WP Recipe Maker for biancazapatka.com). Durations via `parseDuration`, yield via
  `parseServings`, ingredient lines via `parseIngredientLine`.
- PDF pipeline: text layer first (`unpdf`), rasterize + OCR only as fallback (`pdftoppm` →
  `sharp` → `tesseract`). If rasterization is unavailable, answer
  `422 { code: "pdf_no_text_layer" }` with an actionable message in the request's locale
  "Das PDF enthält keine Textebene. Bitte lade ein Foto der Seite hoch."
  BOTH OCR STEPS ARE NATIVE SUBPROCESSES, not libraries: `tesseract` and poppler's `pdftoppm` must be
  installed on the host (the image installs `tesseract-ocr`, `tesseract-ocr-deu`, `tesseract-ocr-eng`
  and `poppler-utils`). A missing binary is the documented 422, not a crash. `sourceMeta.engine` is
  therefore `tesseract-native`. Tests stub rasterization via `setPdfRasterizer()` and must reset it;
  the regression test (`apps/api/test/import/pdf-rasterize.test.ts`) uses the real one and asserts the
  rendered page size, so a leaked stub cannot make it pass.
- Every import endpoint is rate limited (`IMPORT_RULE`, 10 per user per minute → 429 `rate_limited`),
  and the OCR/PDF paths additionally hold one of `IMPORT_OCR_CONCURRENCY` (default **1**)
  process-wide slots. A request that finds them all taken **waits** up to `OCR_SLOT_WAIT_MS` (30 s)
  and only then answers 429 — with at most two waiters per slot queued, beyond which the 429 is
  immediate. Since the engine went native that gate is also the cap on concurrent `tesseract`
  processes, i.e. the memory ceiling, which is why the default is one and raising it wants a
  measurement. `OCR_TIMEOUT_MS` (60 s) is a `Promise.race` that starts AFTER the slot is acquired
  (so queueing never eats the recognition's budget), and an extraction that ignores the abort signal
  still yields `504 ocr_failed` on time — OCR itself now honours it (aborting kills the child), but
  `unpdf` does not.
- `ParsedRecipe.sourceUrl` and `CreateRecipeRequest.sourceUrl` accept **http(s) only**
  (`HttpUrlSchema`); anything else is 422. They are rendered into `<a href>`, and a `javascript:`
  value stored by a member would run on the app origin with the reader's session.
- `POST /imports/file` is a convenience wrapper (added during integration): it sniffs the
  uploaded bytes and dispatches to the image or the PDF pipeline.
- `GET /imports/:draftId/source` serves the stored upload behind the membership check, and is the
  **only** way to read an import source scan — the review screen fetches it with
  `credentials: "include"` and renders a `URL.createObjectURL()` blob. Nothing mints an
  `/uploads/…` signature for a source scan, so the public route cannot serve one. A non-member gets
  403; a removed member loses access immediately.
- `confidence` mirrors `parsed.confidence.overall`; the review screen warns below 0.5.
- The URL importer refuses localhost / private / link-local targets (SSRF guard). For local
  testing only, `IMPORT_ALLOW_PRIVATE_HOSTS=1` disables that check; it is ignored when
  `NODE_ENV=production`.
- `/commit` writes the recipe, links tags/collections, sets `recipe_import_drafts.status = "reviewed"` and
  `recipe_import_drafts.recipe_id`.

### Shopping lists — `apps/api/src/modules/recipe/routes/shopping.ts`

Mounted at `/api/households/:householdId/recipe/shopping-lists`, **before** the catch-all recipes router (same
reason as `imports`). Several named lists per household ("Rewe", "Drogerie"); a list belongs to the
household, not to a user. **`GET /api/households/:householdId/recipe/shopping-lists/bought` is registered before `GET /api/households/:householdId/recipe/shopping-lists/:listId`**
— Hono matches in registration order, so the static path has to come first or a request for it
would be read as a request for the list literally named `"bought"`.

| Method | Path | Auth | Request | Response | Status |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/households/:householdId/recipe/shopping-lists` | household:member+module:recipe | optional `since` (query) | `ShoppingListListResponse` | 200, 403 |
| GET | `/api/households/:householdId/recipe/shopping-lists/bought` | household:member+module:recipe | `listId?`, `limit?`, `offset?` (query) | `ShoppingBoughtListResponse` | 200, 403 |
| POST | `/api/households/:householdId/recipe/shopping-lists` | household:member+module:recipe+verified | `CreateShoppingListRequest` | `ShoppingListResponse` | 201, 403, 409 `recipe_shopping_list_name_taken`, 409 `too_many_recipe_shopping_lists`, 422 |
| GET | `/api/households/:householdId/recipe/shopping-lists/:listId` | household:member+module:recipe | – | `ShoppingListDetailResponse` | 200, 403, 404 |
| PATCH | `/api/households/:householdId/recipe/shopping-lists/:listId` | household:member+module:recipe+verified | `UpdateShoppingListRequest` | `ShoppingListResponse` | 200, 403, 404, 409, 422 |
| DELETE | `/api/households/:householdId/recipe/shopping-lists/:listId` | household:member+module:recipe+verified (creator or admin) | – | – | 204, 403, 404 |
| POST | `/api/households/:householdId/recipe/shopping-lists/:listId/items` | household:member+module:recipe+verified | `AddShoppingItemsRequest` | `ShoppingListDetailResponse` | 200, 403, 404, 409 `recipe_shopping_list_full`, 422 |
| DELETE | `/api/households/:householdId/recipe/shopping-lists/:listId/items` | household:member+module:recipe+verified | – | `ShoppingListDetailResponse` | 200, 403, 404 |
| PATCH | `/api/households/:householdId/recipe/shopping-lists/:listId/items/:itemId` | household:member+module:recipe+verified | `UpdateShoppingItemRequest` | `ShoppingListDetailResponse` | 200, 403, 404, 422 |
| DELETE | `/api/households/:householdId/recipe/shopping-lists/:listId/items/:itemId` | household:member+module:recipe+verified | – | `ShoppingListDetailResponse` | 200, 403, 404 |
| POST | `/api/households/:householdId/recipe/shopping-lists/:listId/items/:itemId/check` | household:member+module:recipe+verified | `CheckShoppingItemRequest` (optional) | `ShoppingListDetailResponse` | 200, 403, 404 |
| POST | `/api/households/:householdId/recipe/shopping-lists/:listId/bought/clear` | household:member+module:recipe+verified | – | `ShoppingListDetailResponse` | 200, 403, 404 |
| POST | `/api/households/:householdId/recipe/shopping-lists/:listId/bought/:boughtId/undo` | household:member+module:recipe+verified | `CheckShoppingItemRequest` (optional) | `ShoppingListDetailResponse` | 200, 403, 404 |
| POST | `/api/households/:householdId/recipe/shopping-lists/:listId/recipes` | household:member+module:recipe+verified | `AddRecipeToShoppingListRequest` | `ShoppingListDetailResponse` | 200, 403, 404, 422 |
| DELETE | `/api/households/:householdId/recipe/shopping-lists/:listId/recipes/:recipeId` | household:member+module:recipe+verified | – | `ShoppingListDetailResponse` | 200, 403, 404 |
| GET | `/api/households/:householdId/recipe/shopping-lists/:listId/from-plan` | household:member+module:recipe | `MealPlanRangeQuery` (query: `from`, `to`, both required) | `PlanShoppingPreviewResponse` | 200, 403, 404, 422 |
| GET | `/api/households/:householdId/recipe/shopping-lists/:listId/catalog` | household:member+module:recipe | `includeHidden?`, `limit?`, `offset?` (query) | `ShoppingCatalogListResponse` | 200, 403, 404 |
| PATCH | `/api/households/:householdId/recipe/shopping-lists/:listId/catalog/:entryId` | household:member+module:recipe+verified | `UpdateShoppingCatalogEntryRequest` | `ShoppingListDetailResponse` | 200, 403, 404, 422 |
| POST | `/api/households/:householdId/recipe/shopping-lists/:listId/catalog/:entryId` | household:member+module:recipe+verified | `CheckShoppingItemRequest` (optional) | `ShoppingListDetailResponse` | 200, 403, 404 |
| DELETE | `/api/households/:householdId/recipe/shopping-lists/:listId/catalog/:entryId` | household:member+module:recipe+verified | – | – | 204, 403, 404 |

Notes
- **Every mutation returns the WHOLE list** (`ShoppingListDetailResponse`: list + open items +
  suggestions), never just the touched item. The web client replaces its cache entry with it rather
  than patching, which is what keeps an optimistic offline edit from drifting — and merging means one
  added line can change a different one.
- **Items merge.** An item is identified by `shoppingItemKey(name, unit)` from `@toon/shared`: a
  folded name plus the unit's *merge bucket*. Adding "200 g Mehl" to a list that already has 200 g
  yields one **400 g** line, and `1 kg + 200 g` yields `1.2 kg`. Enforced by the unique index on
  `recipe_shopping_list_items(list_id, merge_key)`, not by a read-modify-write.
  Units with no fixed ratio (`EL`, `Dose`) only merge with themselves, and an **amount-less line
  never merges with a measured one** — folding "Mehl" into "200 g Mehl" would invent or lose a
  quantity.
- **Checking off is a DELETE, not a flag.** There is no `checked` field anywhere: the row is removed
  and its `recipe_shopping_list_catalog` entry is bumped, so the item leaves the list and reappears under
  "Häufig gekauft". `use_count` counts check-offs, not adds, so the ranking reflects what actually
  gets bought. Suggestions currently on the list are filtered out of the response.
- **`POST /api/households/:householdId/recipe/shopping-lists/:listId/recipes` scales** with the same `scaleIngredients` as `GET /recipes/:id/scale`, with
  `keepNonScalingUnits` (a Prise stays a Prise). `servings` is the TARGET count; omit it for factor 1.
  A recipe with no `servingsAmount` is added unscaled rather than refused. The recipe id is recorded
  on every resulting line (`sourceRecipeIds`), and survives the recipe being deleted — the id stays,
  it just stops resolving into `sources`.
- **`mutationId` (optional, uuid) makes a replay safe.** The API records applied ids in
  `recipe_shopping_mutations` and applies each at most once. This is what lets the PWA queue edits made
  offline: without it, a request that reached the server but lost its response would be applied twice
  on replay, and because items merge that is a silently **doubled amount**, not a visible duplicate.
  `DELETE` of an item and `check` are idempotent by construction and safe without one.
- Free text ("500g Mehl") is parsed **client-side** with `parseIngredientLine`
  (`apps/web/src/modules/recipe/features/shopping/lib/parse.ts`); the API only accepts structured items.
- **The bought log and the `Clear bought` watermark are two different things (D4).** Checking an
  item off still DELETEs the row (see above) and still bumps `recipe_shopping_list_catalog`; it
  additionally appends one row to `recipe_shopping_bought_items`, a log that is never itself deleted or
  edited. `recipe_shopping_lists.boughtClearedAt` is a single per-list watermark: `POST
  /api/households/:householdId/recipe/shopping-lists/:listId/bought/clear` only moves it to "now" (200, idempotent, no `mutationId` — "set the watermark to
  now" cannot disagree with itself). The list DETAIL payload's `bought` array shows only rows
  **newer than the watermark** (`bought_at > boughtClearedAt ?? 0`); `GET /api/households/:householdId/recipe/shopping-lists/bought`, the
  cross-list archive, **ignores the watermark entirely** and returns every row in the household's
  90-day (`BOUGHT_LOG_TTL_MS`) window, because clearing a list's "Bought today" section must never
  make something the household actually bought disappear from the history it can still be found in.
  `POST /api/households/:householdId/recipe/shopping-lists/bought/:boughtId/undo` reverses one row: deletes the log entry and re-adds its amount
  through the **same merge** every other add goes through (so an undo folds into whatever is on the
  list now instead of creating a second line), decrements the matching `recipe_shopping_list_catalog`
  entry's `useCount` (floored at 0), and is idempotent — an unknown or already-undone `boughtId` is
  a 200 no-op.
- **`?since` (on `GET /api/households/:householdId/recipe/shopping-lists`) is an INSTANT, and day grouping happens client-side.** It
  is the caller's own calendar-day boundary (their device's local midnight), sent as an ISO instant
  because the server only ever COMPARES instants and never derives a calendar day from one — the
  same reasoning `recipe_meal_plan_entries.planned_on` is documented against below. A value that fails to
  parse is **ignored, not 422** (a bad query param must not blank the whole overview), and any value
  is clamped to `[now - 7d, now]` so a wrong device clock cannot invent a nonsense count. It only
  narrows `ShoppingList.boughtCount`; nothing about `GET /api/households/:householdId/recipe/shopping-lists/bought`'s day-by-day grouping is
  server-side either — that response is a flat, `boughtAt`-ordered list, and the history panel
  buckets it into days itself (the same `groupByLocalDay` from `packages/shared/src/core/calendar.ts`
  the planner uses), because "what day was this bought on" is exactly as timezone-dependent as
  "what day is this recipe planned for".
- **The "Häufig gekauft" ranking is two deliberately separate steps, never one `sortBy`.** Both the
  list detail's `catalog` array and `GET /api/households/:householdId/recipe/shopping-lists/:listId/catalog` are ordered `use_count DESC, last_used_at DESC`
  — SELECTION by actual purchase frequency. Client-side, `packages/shared/src/modules/recipe/shopping.ts` picks the
  chip row's top `FREQUENT_CHIP_COUNT` from that same ranking (`selectMostBoughtEntries`) and only
  THEN re-sorts the picked set alphabetically by folded German name for DISPLAY
  (`sortEntriesByFoldedName`) — "Äpfel" sits under A, not after Z, and a name never moves the
  selection just because it folds differently. Collapsing the two into one comparator is the bug
  this split exists to prevent.

### Meal plan — `apps/api/src/modules/recipe/routes/plan.ts`

Mounted at `/api/households/:householdId/recipe/plan`, alongside `imports` and `shopping-lists`, above the
catch-all `recipes` router. **Any member may plan, move or unplan any entry** — a shared week is
shared property, the same rule `PATCH /api/households/:householdId/recipe/shopping-lists/:listId` already applies to renaming a list;
there is no author-or-admin check anywhere in this router.

| Method | Path | Auth | Request | Response | Status |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/households/:householdId/recipe/plan` | household:member+module:recipe | `MealPlanRangeQuery` (query: `from`, `to`) | `MealPlanRangeResponse` | 200, 403, 422 |
| GET | `/api/households/:householdId/recipe/plan/last-planned` | household:member+module:recipe | `LastPlannedQuery` (query: `before`) | `LastPlannedResponse` | 200, 403, 422 |
| POST | `/api/households/:householdId/recipe/plan` | household:member+module:recipe+verified | `CreateMealPlanEntryRequest` | `MealPlanEntryResponse` | 200, 201, 403, 404, 409 `meal_plan_day_full`, 422 |
| PATCH | `/api/households/:householdId/recipe/plan/:entryId` | household:member+module:recipe+verified | `UpdateMealPlanEntryRequest` | `MealPlanEntryResponse` | 200, 403, 404, 409 `conflict` / `meal_plan_day_full`, 422 |
| DELETE | `/api/households/:householdId/recipe/plan/:entryId` | household:member+module:recipe+verified | – | – | 204, 403, 404 |

Notes
- **`plannedOn` is a CALENDAR DATE (`YYYY-MM-DD`), not a timestamp, and it is the CLIENT's calendar
  date, not the server's.** It is computed from the viewing DEVICE's local calendar
  (`toPlanDate()` in `@toon/shared`'s `calendar.ts`) and sent as-is; nothing in this router or its
  service ever calls `new Date()` to decide what day it is. That matters concretely: the API runs
  in UTC (Docker) and its users are in Europe/Berlin, so a date the server derived from an instant
  would be a day out for two hours every night. The server only stores and compares the string —
  see the `recipe_meal_plan_entries.planned_on` column comment in `apps/api/src/db/schema.ts`.
- **`GET` returns `{ from, to, items }`, not the `{ items, total, limit, offset }` list envelope.**
  That envelope is for PAGINATED lists; a week is bounded by its own `from`/`to`, not a page, so
  `total`/`limit`/`offset` would be three fields that always say the same thing. `items` is FLAT
  (not grouped by day) and sorted `(plannedOn, position)`; a day with nothing planned is simply
  absent, and the seven-slot week — including empty "+ Plan" cards — is built client-side.
  `PLAN_LIMITS.rangeDays` (62) bounds the request; a longer or inverted range is 422.
- **`POST` is idempotent, and that is deliberate: planner writes are ONLINE-ONLY, so there is no
  `mutationId` ledger like the shopping list's.** Planning a recipe that is already on that day
  returns the EXISTING entry with **200**, not a duplicate, and the second call's `servings` still
  applies (a new one returns **201**). The `(household_id, planned_on, recipe_id)` unique index is the
  whole idempotency story, including under a race between two members' simultaneous POSTs.
- **`GET /last-planned?before=` is the recipe picker's "Zuletzt geplant"**: one `{ recipeId, plannedOn }`
  per recipe, the latest day it was planned STRICTLY before `before` (the day being planned, a
  client-computed calendar date like every other). A never-planned recipe is absent. Unpaginated —
  it is bounded by the household's recipe count.
- `POST` 404s for a `recipeId` outside the household. A day already holding
  `PLAN_LIMITS.entriesPerDay` (12) entries answers 409 `meal_plan_day_full`.
- **`PATCH` moves an entry between days by setting `plannedOn`.** Moving re-tails `position` on the
  TARGET day unless `position` is sent explicitly. Moving onto a day that already holds the SAME
  recipe never silently merges the two entries — it is 409 `conflict` (`server.plan.alreadyPlanned`)
  — which is the opposite answer from `POST`'s idempotent 200, because a drag-and-drop move losing
  data silently would be far worse than a duplicate add.
- A cross-household `:entryId` answers 404 rather than leaking the entry's existence — `entryId` is
  deliberately not one of `middleware/household.ts`'s `RESOURCE_PARAMS`; the service itself scopes every
  lookup by `and(eq(id), eq(householdId))`.
- **"Gekocht" lives on the RECIPE router**, not here: `POST`/`DELETE
  /api/households/:householdId/recipe/recipes/:recipeId/cooked` (see "Recipes" above) is what stamps a plan
  entry's `cookedAt`, because cooking is something you do to a recipe that may or may not be on a
  plan that day — the planner itself never writes `cooked_at` outside that path.

### Saved cards — `apps/api/src/modules/recipe/routes/cards.ts`

Mounted at `/api/recipe/cards` (the module's `userRouter`, NOT behind `requireModule`). **The only router that is not household-scoped.** A saved card is a loyalty or
membership barcode belonging to the signed-in USER (Payback, DeutschlandCard, the gym, the library),
so there is no `:householdId` in any path and no `requireHouseholdRole`: `requireSession()` plus the `userId`
every query filters on is the whole authorisation. See the header of
`packages/shared/src/modules/recipe/schemas/card.ts` for why this entity is a deliberate exception to "households own
the content".

| Method | Path | Auth | Request | Response | Status |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/recipe/cards` | session | – | `CardListResponse` | 200, 401 |
| POST | `/api/recipe/cards` | session+verified | `CreateCardRequest` | `CardResponse` | 201, 401, 403, 409 `card_already_saved`, 409 `too_many_cards`, 422 |
| PATCH | `/api/recipe/cards/:cardId` | session+verified (owner) | `UpdateCardRequest` | `CardResponse` | 200, 401, 403, 404, 409, 422 |
| DELETE | `/api/recipe/cards/:cardId` | session+verified (owner) | – | – | 204, 401, 403, 404 |
| POST | `/api/recipe/cards/:cardId/used` | session+verified (owner) | – | `CardResponse` | 200, 401, 403, 404 |

Notes
- **`format` is one of `qr · ean13 · ean8 · upca · code128 · code39 · itf`** (`BarcodeFormat`), the
  symbologies real German loyalty cards carry AND this app can draw offline. A format outside that
  list is a 422, not a stored row it could never display — see `packages/shared/src/modules/recipe/barcode.ts`.
- **`value` is normalised by the schema, not by the handler.** Separators are stripped from the
  numeric formats, `code39` is upper-cased, and an EAN/UPC value that is exactly one digit short
  GAINS its check digit — so the twelve digits printed under a Payback barcode are a valid request
  body. The stored value is always the normalised one.
- **The check digit is validated** for `ean13`/`ean8`/`upca`. A mistyped digit answers 422 with
  `details[0].path = "value"` and `details[0].i18n.key = "server.card.valueCheckDigit"`. This router
  throws the raw `ZodError` (rather than using `zValidator`'s hook, which drops `i18n`) precisely so
  a client can re-render that issue in its own language.
- **`format` and `value` travel together or not at all** in a PATCH: a value cannot be check-digit
  validated without its symbology. `{ "value": … }` alone is 422 `server.card.formatAndValue`.
- **`(userId, format, value)` is unique.** Saving the same number twice is 409 `card_already_saved` —
  two identical cards in a wallet cannot be told apart. Two different accounts may of course save the
  same household card.
- **The list is ordered by last USE**, most recent first, then newest. `POST /api/recipe/cards/:cardId/used` is what records
  a use; it is a separate call because the list is re-fetched on every visit to the screen and
  bumping on read would make the ordering meaningless. It moves `lastUsedAt` only — showing a card is
  not an edit, so `updatedAt` stays put.
- **Writes are gated by the confirmed-address rule** like every other write (403 `email_unverified`
  where the deployment can mail). That includes `POST /api/recipe/cards/:cardId/used`, which is why the web client fires it
  and forgets it: losing the ordering bump must never break showing a card.
- **No pagination.** `CARD_LIMITS.perUser` (50) is the page size, and the screen has to render from
  the offline cache; `{ items }` is the whole envelope.

### Tables (SQLite, `apps/api/src/db/schema.ts`)

`recipe_recipes`, `recipe_recipe_ingredients`, `recipe_recipe_steps`, `recipe_tags`,
`recipe_recipe_tags`, `recipe_collections`, `recipe_collection_recipes`, `recipe_meal_plan_entries`,
`recipe_recipe_cook_log`, `recipe_import_drafts`, `recipe_shopping_lists`, `recipe_shopping_list_items`,
`recipe_shopping_list_catalog`, `recipe_shopping_bought_items`, `recipe_shopping_list_recipes`,
`recipe_shopping_mutations`, `recipe_cards`.

Unique indexes: `recipe_tags(household_id, name)`, `recipe_shopping_lists(household_id, name)`,
`recipe_shopping_list_items(list_id, merge_key)`, `recipe_shopping_list_catalog(list_id, name_key)`,
`recipe_cards(user_id, format, value)`, `recipe_meal_plan_entries(household_id, planned_on, recipe_id)`,
`recipe_shopping_list_recipes(list_id, recipe_id)`.

`recipe_shopping_list_items.merge_key` is the item's *identity*, not a cache: the unique index on it is what
performs the merging, so two members adding the same ingredient at once cannot produce two lines.
`recipe_shopping_mutations` is an idempotency ledger keyed by the client's `mutationId` (TTL 14 days, pruned
on write) — see the Shopping lists notes above for why it has to exist.
`recipe_meal_plan_entries(household_id, planned_on, recipe_id)` is what makes `POST /plan` idempotent (see the
"Meal plan" section): planning the same recipe on the same day twice hits the index instead of
inserting a duplicate. `recipe_shopping_list_recipes(list_id, recipe_id)` is why adding a recipe to a list
twice, at a different portion count, upserts the "Recipes on this list" rail row instead of adding a
second one.
Composite primary keys: `recipe_recipe_tags(recipe_id, tag_id)`, `recipe_collection_recipes(collection_id, recipe_id)`.
All household-scoped tables cascade from `households`; child rows cascade from `recipe_recipes`, with one
exception: `recipe_recipe_cook_log.meal_plan_entry_id` is `ON DELETE set null` — deleting a plan entry must
not erase the fact that the meal was cooked, only the link between the two facts.

**`recipe_meal_plan_entries.planned_on` is the one column in this whole schema that is NOT an instant.**
Every other timestamp in every table (`created_at`, `updated_at`, `cooked_at`, `bought_at`,
`last_cooked_at`, `bought_cleared_at`, …) is integer unix ms, resolved into a moment the same way
everywhere. `planned_on` is `YYYY-MM-DD` text instead, because a plan entry is a DATE — "Thursday"
— and an integer midnight is an instant that every reader has to re-interpret in some timezone,
which is wrong twice a night for a UTC server and Europe/Berlin users. It is always the CLIENT's
calendar date (never derived server-side, see the "Meal plan" section above), sorts
lexicographically = chronologically, and needs no timezone to be wrong about.

`recipe_cards` is the one table that hangs off `users` instead of `households` — a saved loyalty barcode is
personal property (see the Saved cards section). It cascades from `users`, so deleting an account
takes its wallet with it.

## Finance module

This section is toon-finance's API contract (`/home/erics/software/toon-finance/docs/spec.md` §3, in German there) in English, under H's paths, with every H change: the two finance seats (`finance_participants`, SPEC D3), the participant gate on every ledger route, the core's module chain, and ADRs 0002 (validation wording), 0004 (participant churn), 0006 (placeholder seats) and 0007 (where H leaves toon-finance 1715207). Request and response names are exports of `@toon/shared`; finance's flat barrel renamed the tag schemas and the 50 / 200 pagination, so the tag shapes below are `FinanceTagResponse`, `FinanceTagListResponse`, `FinanceUpdateTagRequest` and the list query is `FinancePaginationQuery` (the bare names are recipe's and the core's). The ledger arithmetic (halving, plan share, balance) is `packages/shared/src/modules/finance/ledger.ts`, `money.ts` and `plan.ts`; the rules that matter to a client are restated where a route exposes them.

### Mount and access

The module's `householdRouter` (`apps/api/src/modules/finance/routes/index.ts`) is mounted by `mountModules` at **`/api/households/:householdId/finance`**, behind the core chain `requireSession()` → `requireHouseholdRole("member")` → `requireModule("finance")` (see "Middleware chain and mount order"). Finance has no `userRouter`: every route is household-scoped. The seven routers are `participants`, `transactions`, `categories`, `tags`, `plan`, `balance` and `settlements`.

On top of the chain, **every ledger router** (`transactions`, `categories`, `tags`, `plan`, `balance`, `settlements`) applies, for every method, `requireVerifiedEmail()` and then `requireFinanceParticipant()` (`apps/api/src/modules/finance/middleware.ts`):

- **`403 finance_not_participant`** when the caller is a household member without one of the two finance seats. Reads are refused too: the kinds and the balance sign are projections onto a viewer's slot and mean nothing for a third person. The check reads `finance_participants` by the session user and the path household.
- **`403 email_unverified`** for a write from an unconfirmed account on a deployment that gates on it (reads pass; see "Unconfirmed accounts are read-only"). The verified-email check runs first, so an unconfirmed non-participant sees `email_unverified`.
- **`404 module_disabled`** while the household has not enabled finance (a disabled module keeps its rows, and enabling again brings the ledger back).

The `participants` router is the exception: its `GET` is open to any household member (so a non-participant can learn their state and the web app can show the "not a participant" screen) and nothing is mounted with `use("*")` there. Its own gates are in the rows below.

Auth column vocabulary of this section: `household:member+module:finance`, plus `+verified` (a write behind `requireVerifiedEmail()`) and `+finance:participant` (behind `requireFinanceParticipant()`).

### Conventions

- **Money is integer cents** (`…Cents`, signed `CentsSchema`), never a float or a decimal string. Formatting happens at the edge of the web app's render tree. The only forbidden transaction amount is `0` (`422 transaction_amount_zero`, thrown by the service because a Zod refinement could only ever surface as `validation_failed`); negative amounts are refunds and corrections and keep their sign. Fixed-cost items, incomes and settlement amounts must be greater than 0.
- **Periods** are `YYYY-MM` text between `2000-01` and `2100-12` (`PeriodSchema`). `from` and `to` filters accept either an ISO date or time or a period; a bound that is neither is `422 validation_failed` with a detail on `from` or `to`. A period `to` is inclusive of the whole month. Timestamps are ISO-8601 on the wire and integer unix milliseconds in SQLite; every finance timestamp comes from the module clock (`apps/api/src/modules/finance/lib/clock.ts`).
- **Lists** are `{ items, total, limit, offset }` with `FinancePaginationQuery`: `limit` default 50, 1 to 200; `offset` default 0. `GET …/categories`, `…/tags` and `…/balance/history` are bare `{ items }`.
- **Booleans in a query string** (`includeAggregates`, `includeHidden`) accept `true`, `false`, `1` and `0`; any other value is `422`. `includeAggregates` defaults to `true`; `false` hides the rows tagged `sammelbuchung` (the one imported lump-sum row), which the balance and the lists include by default.
- **Idempotency.** `POST …/transactions`, `PATCH …/transactions/:transactionId`, `DELETE …/transactions/:transactionId?mutationId=` and `POST …/settlements` take an optional client-minted `mutationId` (a UUID the client mints at the call site, once per user action, never per retry). The claim is an `INSERT` on the primary key of `finance_mutation_claims` (`onConflictDoNothing`), inside the same transaction as the write, never a read-then-write, so two concurrent deliveries cannot both apply. A replayed id applies **nothing** and answers **`200` with the current state** of the linked row (not `201`, not `409`); a replayed `DELETE` answers `204` even though the row is gone. The claim TTL is 14 days (`MUTATION_CLAIM_TTL_MS`); `pruneMutationClaims` implements the cleanup, but no scheduler tick calls it in H yet, so claims are in practice kept until pruned. The claim table is keyed by the id alone, so every lookup that follows a lost claim filters on the **path household**: a `mutationId` another household already used is never a replay (`PATCH` and `DELETE` answer `409 conflict`, `POST` answers `404 not_found` because the row it points at is not in this household) and never leaks that household's row. Without a `mutationId` there is no replay protection, which is allowed for calls that are idempotent anyway.
- **Content language is not interface language.** `error.message` and every validation message follow the request's `Accept-Language` (see "Conventions"). Text the server **writes into rows** (the plan's booking description, the settlement description when no `note` is sent, the default category names at household creation) follows `finance_settings.default_locale`, never the viewer's language. A category's `label` in a response is rendered for the request's negotiated locale (`customLabel ?? catalog name`) and is never stored.
- **Finance's generic validation messages** use the core's wording (ADR 0002), e.g. "Darf höchstens 200 Zeichen lang sein"; `code` and `details[].path` are unchanged.
- **Cross-household guard (SPEC D8).** The household comes from `:householdId` only. A transaction, category, tag, fixed-cost item or income of another household is `404 not_found`, never revealed.

### Participants — `apps/api/src/modules/finance/routes/participants.ts`

A household has any number of core members; finance seats exactly **two** of them, by user id, in slot 1 and slot 2 (`finance_participants`). Slot 1 is the balance's anchor (positive `balanceCents` means slot 2 owes slot 1). A seat is a person, not an account: a **placeholder** (ADR 0006: a member without e-mail and password, added with `POST /api/households/:householdId/members`) may hold slot 2, so the ledger can name them before they ever sign in; a claim invite later turns the same user row into an account and no seat or `payerId` has to be re-pointed.

| Method | Path | Auth | Request | Response | Status |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/households/:householdId/finance/participants` | household:member+module:finance | – | `FinanceParticipantListResponse` | 200, 401, 403, 404 |
| PUT | `/api/households/:householdId/finance/participants` | household:admin+module:finance+verified | `UpdateFinanceParticipantsRequest` | `FinanceParticipantListResponse` | 200, 401, 403, 403 `email_unverified`, 404, 409 `finance_participant_in_use`, 422 `finance_participants_required`, 422 |
| PATCH | `/api/households/:householdId/finance/participants/me` | household:member+module:finance+verified+finance:participant | `UpdateFinanceDisplayNameRequest` | `FinanceParticipantResponse` | 200, 401, 403 `finance_not_participant`, 403 `email_unverified`, 404, 422 |
| PATCH | `/api/households/:householdId/finance/participants/:userId` | household:member+module:finance+verified+finance:participant | `UpdateFinanceDisplayNameRequest` | `FinanceParticipantResponse` | 200, 401, 403 `finance_not_participant`, 403 `email_unverified`, 403 (the seat has an account), 404, 422 |

Notes

- **`GET`** answers `{ items, viewerSlot }`: one `FinanceParticipantResponse` per seat ordered by slot (`userId`, `memberSlot`, `displayName`, `name`, `email`, `hasAccount`, `joinedAt`; `email` is `null` and `hasAccount` is `false` for a placeholder) and the caller's own seat. **`viewerSlot` is `null` for a household member without a seat**, and this is the only finance route such a member reaches (every other route is `403 finance_not_participant`). The web app caches it so a cold offline start knows the viewer's slot.
- **`PUT`** replaces the two seats and answers the new list. The rules live in the service (`assignParticipants`, `apps/api/src/modules/finance/services/participants/participants.service.ts`), not in Zod, because a Zod refinement cannot carry its own error code. The body is exactly two entries `{ userId, memberSlot }`:
  - slots exactly {1, 2}, two different users, else **`422 finance_participants_required`** (`server.finance.participantsRequired`); both users must be members of the household, else the same code with `server.finance.participantNotMember`;
  - a **placeholder may hold slot 2 only**: a placeholder in slot 1 is `422 validation_failed` with a detail on `participants.<index>.userId` and `server.finance.placeholderSlotOne` ("Eine Person ohne Konto kann nur Platz 2 belegen.");
  - a user who **leaves the budget** (seated before, absent after) while the household has **any** `finance_transactions` row, or an income naming them, is **`409 finance_participant_in_use`** and nothing is written (ADR 0004). Any row blocks it, not only rows naming the outgoing user, because every two-person row involves both slots: a replacement would silently inherit the outgoing user's share of every row and of the balance. Swapping the same two users between slots is allowed (nobody leaves; every projection is computed at read time). A concurrent assignment that wins the slot's unique index answers the same `409`, never a 500;
  - when the plan's payer is an outgoing user (the ledger is empty, else the `409` above), the payer moves to the incoming user of the same slot; a kept user keeps `displayName` and `joinedAt`, a new one gets their `users.name` (at most 80 characters) and the module clock.
- **`PATCH …/participants/me`** renames the caller's own display name in the budget (`FinanceDisplayNameSchema`: trimmed, 1 to 80 characters, no control characters).
- **`PATCH …/participants/:userId`** renames the **other** seat when it is a placeholder (toon-finance `b1b517d`, ADR 0006): `404` for a user without a seat in THIS household (another household's id too), `403 forbidden` when the seat has an account (their name is theirs to change through `…/participants/me`). `…/participants/me` is registered before `…/participants/:userId`, so `me` is never read as an id.
- **Enabling finance** is a core route (`POST /api/households/:householdId/modules/finance`, see "Modules"): it seats the two participants from the enable body's `settings` with the `PUT` rules, or on a re-enable requires the two existing seats, else `422 finance_participants_required` and nothing is written. `finance_participants` is the truth; the core's stored `settings` JSON is never read back.
- **A seated participant cannot leave the household while the ledger has rows** (`409 member_has_ledger`). That refusal is raised by the core's member removal through the module's `onMemberRemoving` veto, so it is documented with `DELETE /api/households/:householdId/members/:userId` in "Members and placeholders". With an empty ledger the seat is deleted, a slot-2 survivor is re-seated in slot 1 and the plan payer moves, leaving a one-seat ledger until an admin seats two people again through `PUT /api/households/:householdId/finance/participants`.
- **A one-seat ledger** (after such a leave, or a migrated household with one participant, ADR 0005) answers `409 conflict` (`server.household.needsSecondMember`) for any booking that needs the other slot: `THEIRS_SPLIT` and `TRANSFER` transactions, a settlement against a positive balance, and the plan's accrual.

### Transactions — `apps/api/src/modules/finance/routes/transactions.ts`

Mounted at `/api/households/:householdId/finance/transactions`. Every method runs `requireVerifiedEmail()` then `requireFinanceParticipant()`.

| Method | Path | Auth | Request | Response | Status |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/households/:householdId/finance/transactions` | household:member+module:finance+finance:participant | `TransactionListQuery` (query) | `TransactionListResponse` | 200, 403 `finance_not_participant`, 404, 422 |
| POST | `/api/households/:householdId/finance/transactions` | household:member+module:finance+verified+finance:participant | `CreateTransactionRequest` | `TransactionResponse` | 201 (+ `Location`; 200 on a replayed `mutationId`), 403 `finance_not_participant`, 403 `email_unverified`, 404, 409 `conflict` (one seat), 422, 422 `transaction_amount_zero` |
| GET | `/api/households/:householdId/finance/transactions/summary` | household:member+module:finance+finance:participant | `TransactionSummaryQuery` (query) | `TransactionSummaryResponse` | 200, 403 `finance_not_participant`, 404, 422 |
| GET | `/api/households/:householdId/finance/transactions/:transactionId` | household:member+module:finance+finance:participant | – | `TransactionResponse` | 200, 403 `finance_not_participant`, 404 |
| PATCH | `/api/households/:householdId/finance/transactions/:transactionId` | household:member+module:finance+verified+finance:participant | `UpdateTransactionRequest` | `TransactionResponse` | 200, 403 `finance_not_participant`, 403 `email_unverified`, 404, 409 `transaction_generated`, 409 `conflict`, 422, 422 `transaction_amount_zero` |
| DELETE | `/api/households/:householdId/finance/transactions/:transactionId` | household:member+module:finance+verified+finance:participant | `?mutationId=` (query) | – | 204, 403 `finance_not_participant`, 403 `email_unverified`, 404, 409 `transaction_generated`, 409 `conflict` |

Notes

- **`/summary` is registered before `/:transactionId`**, otherwise the literal path would be captured as an id.
- **The client sends `kind`; the server stores `(payerId, splitMode)`.** `kindToStorage(kind, viewerId, otherId)` from `@toon/shared` runs server-side against the **session's** viewer, never a client-picked payer, so an offline-replayed create stays correct whoever is logged in when it is finally sent. The four kinds are a projection of `(payerId, splitMode)` onto the viewer, computed at read time and never persisted (`projectKind`):

  | `kind` | `payerId` | `splitMode` | who bears what |
  | --- | --- | --- | --- |
  | `MINE_SPLIT` | the viewer | `SPLIT_EQUAL` | the viewer bears half plus an odd cent, the other person half |
  | `THEIRS_SPLIT` | the other participant | `SPLIT_EQUAL` | the other person bears half plus an odd cent, the viewer half |
  | `FOR_THEM` | the viewer | `OTHER_ONLY` | the other person bears 100 % |
  | `TRANSFER` | the other participant | `SETTLEMENT` | pure money movement, no expense |

  A row created by one participant reads back as the mirrored kind for the other. `THEIRS_SPLIT` and `TRANSFER` need the other seat; with a one-seat ledger they answer `409 conflict` (`server.household.needsSecondMember`). `TransactionResponse` carries `payerId` and `splitMode`, not `kind`; the client projects.
- **`TransactionListQuery`**: `from`, `to` (ISO date or `YYYY-MM`), `kind` (a viewer projection resolved server-side: the two "theirs" kinds mean `payerId` is not the viewer, which stays correct for a seat-less or departed payer), `splitMode`, `payerId`, `categoryId`, `tagIds` (comma-separated ids, at most 10 are used; a row must carry **all**), `origin` (`manual`, `fixed_plan`, `fixed_plan_adjustment`, `import`), `q` (case-insensitive substring of `description`, at most 100 characters, no full-text search), `includeAggregates`, `sort` (`bookedAt`, `-bookedAt` default, `amount`, `-amount`), `limit`, `offset`.
- **`TransactionResponse`** carries, besides the stored fields, what the server derives so the client never re-derives it: `otherShareCents` (what the non-paying person bears), `payerShareCents` (its exact complement), `balanceDeltaCents` (this row's contribution to the balance from slot 1's perspective) and `isExpense` (`splitMode !== "SETTLEMENT"`). Also `categorySlug`, `tags: { id, name }[]`, `dateSource` (`exact`, `day`, `month`, `estimated`), `origin`, `planPeriod` (`YYYY-MM` or `null`), `createdBy`, `createdAt`, `updatedAt`.
- **`CreateTransactionRequest`**: `kind`, `amountCents` (signed, not 0), `description` (trimmed, 1 to 200 characters), `categoryId?` (`404 not_found` when it is not a category of this household), `tags?` (tag **names**, at most 20 per row; unknown names are created, matching is case-insensitive through the tag's `name_key`), `bookedAt?` (ISO, default now), `mutationId?`. `UpdateTransactionRequest` is the same shape, every field optional (**replace-all-when-present** for `tags`: present replaces every link, absent leaves them untouched).
- **Only `origin = "manual"` rows can be edited or deleted.** A row booked by the fixed-cost plan or the one-off import is `409 transaction_generated`; a booked period is corrected by an adjustment row (see Plan), never edited.
- **`GET …/summary`** returns the overview aggregates in one call: `{ from, to, totalExpenseCents, byCategory: { categoryId, categorySlug, totalCents, count }[], byMonth: { period, totalCents, balanceDeltaCents }[], settlementTotalCents }`. Settlements are excluded from `totalExpenseCents` and `byCategory`: they are debt movement, not consumption (one exported predicate, `isExpense`).

### Categories — `apps/api/src/modules/finance/routes/categories.ts`

Mounted at `/api/households/:householdId/finance/categories`. Every method runs `requireVerifiedEmail()` then `requireFinanceParticipant()`.

| Method | Path | Auth | Request | Response | Status |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/households/:householdId/finance/categories` | household:member+module:finance+finance:participant | `?includeHidden=` (query) | `CategoryListResponse` | 200, 403 `finance_not_participant`, 404 |
| POST | `/api/households/:householdId/finance/categories` | household:member+module:finance+verified+finance:participant | `CreateCategoryRequest` | `CategoryResponse` | 201, 403 `finance_not_participant`, 403 `email_unverified`, 404, 409 `category_slug_taken`, 422 |
| PATCH | `/api/households/:householdId/finance/categories/:categoryId` | household:member+module:finance+verified+finance:participant | `UpdateCategoryRequest` | `CategoryResponse` | 200, 403 `finance_not_participant`, 403 `email_unverified`, 404, 409 `category_system`, 422 |
| DELETE | `/api/households/:householdId/finance/categories/:categoryId` | household:member+module:finance+verified+finance:participant | `?reassignTo=` (query) | – | 204, 400 (`reassignTo` is the category itself), 403 `finance_not_participant`, 403 `email_unverified`, 404, 409 `category_in_use`, 409 `category_system` |

Notes

- `GET` is sorted by `position`; hidden categories are left out unless `includeHidden` is `true` or `1`. `CategoryResponse` is `{ id, slug, label, customLabel, isSystem, isHidden, position, usageCount }`. **`label` is fully rendered**: `customLabel` when set, else the catalog name for `slug` in the request's negotiated locale. A client shows `label` and sends `label` back to rename, which sets `customLabel`; from then on it is stored content and is never translated again.
- A household starts with 21 default categories (seeded for every new household, finance enabled or not). A new category gets `slug = "custom-" + id.slice(0, 8)`, so the default slugs keep their namespace, and is never a system row. `position` defaults to the end of the list.
- **`fixkosten`** is the system category (`isSystem`) the plan books into: setting its `label` is `409 category_system` (hiding it or moving it is allowed) and deleting it is `409 category_system`.
- `DELETE` of a category that still has transactions is `409 category_in_use` (the message carries the count) **unless** `?reassignTo=<categoryId>` names another category of the same household: then the transactions are re-pointed and the category removed in one transaction (`404` for an unknown target, `400 bad_request` for the category itself). An empty `reassignTo` counts as absent.

### Tags — `apps/api/src/modules/finance/routes/tags.ts`

Mounted at `/api/households/:householdId/finance/tags`. Every method runs `requireVerifiedEmail()` then `requireFinanceParticipant()`. There is **no `POST`**: a tag exists only as a side effect of attaching it to a transaction (`CreateTransactionRequest.tags`).

| Method | Path | Auth | Request | Response | Status |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/households/:householdId/finance/tags` | household:member+module:finance+finance:participant | `TagQuery` (query) | `FinanceTagListResponse` | 200, 403 `finance_not_participant`, 404, 422 |
| PATCH | `/api/households/:householdId/finance/tags/:tagId` | household:member+module:finance+verified+finance:participant | `FinanceUpdateTagRequest` | `FinanceTagResponse` | 200, 403 `finance_not_participant`, 403 `email_unverified`, 404, 409 `tag_name_taken`, 422 |
| DELETE | `/api/households/:householdId/finance/tags/:tagId` | household:member+module:finance+verified+finance:participant | – | – | 204, 403 `finance_not_participant`, 403 `email_unverified`, 404 |

Notes

- `GET` without `q` returns the most-used tags (`usageCount` descending, `limit` default 20, 1 to 100): the suggestions of the capture flow. With `q` it is a prefix match, ordered by name. `FinanceTagResponse` is `{ id, name, usageCount }`.
- `PATCH` renames; a name another tag of the household already normalises to is `409 tag_name_taken`.
- `DELETE` drops the tag and its links; the transactions are untouched.

### Plan — `apps/api/src/modules/finance/routes/plan.ts`

Mounted at `/api/households/:householdId/finance/plan`. The fixed-cost plan (one row per household), its items and incomes, the read-only preview, and the booking calls. Every method runs `requireVerifiedEmail()` then `requireFinanceParticipant()`. The booking itself is `apps/api/src/modules/finance/services/plan/accrual.service.ts`; the routes only call it.

| Method | Path | Auth | Request | Response | Status |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/households/:householdId/finance/plan` | household:member+module:finance+finance:participant | – | `PlanResponse` | 200, 403 `finance_not_participant`, 404 |
| PATCH | `/api/households/:householdId/finance/plan` | household:member+module:finance+verified+finance:participant | `UpdatePlanRequest` | `PlanResponse` | 200, 403 `finance_not_participant`, 403 `email_unverified`, 404, 409 `plan_period_locked`, 422 (`validation_failed`, also for a payer who is not a participant: `server.finance.personNotParticipant`) |
| GET | `/api/households/:householdId/finance/plan/preview` | household:member+module:finance+finance:participant | `PlanPreviewQuery` (query) | `PlanComputationResponse` | 200, 403 `finance_not_participant`, 404, 409 `plan_incomplete`, 422, 422 `plan_period_out_of_range` |
| POST | `/api/households/:householdId/finance/plan/run` | household:member+module:finance+verified+finance:participant | `RunPlanRequest` | `RunPlanResponse` | 200, 403 `finance_not_participant`, 403 `email_unverified`, 404, 409 `plan_disabled`, 409 `plan_incomplete`, 422 |
| POST | `/api/households/:householdId/finance/plan/recalculate` | household:member+module:finance+verified+finance:participant | `RecalculatePlanRequest` | `RecalculatePlanResponse` | 200, 403 `finance_not_participant`, 403 `email_unverified`, 404, 409 `plan_disabled`, 422 |
| GET | `/api/households/:householdId/finance/plan/runs` | household:member+module:finance+finance:participant | `FinancePaginationQuery` (query) | `AccrualRunListResponse` | 200, 403 `finance_not_participant`, 404, 422 |
| POST | `/api/households/:householdId/finance/plan/items` | household:member+module:finance+verified+finance:participant | `CreateFixedCostItemRequest` | `FixedCostItemResponse` | 201, 403 `finance_not_participant`, 403 `email_unverified`, 404, 422 |
| PATCH | `/api/households/:householdId/finance/plan/items/:itemId` | household:member+module:finance+verified+finance:participant | `UpdateFixedCostItemRequest` | `FixedCostItemResponse` | 200, 403 `finance_not_participant`, 403 `email_unverified`, 404, 422 |
| DELETE | `/api/households/:householdId/finance/plan/items/:itemId` | household:member+module:finance+verified+finance:participant | – | – | 204, 403 `finance_not_participant`, 403 `email_unverified`, 404 |
| POST | `/api/households/:householdId/finance/plan/incomes` | household:member+module:finance+verified+finance:participant | `CreateIncomeRequest` | `IncomeResponse` | 201, 403 `finance_not_participant`, 403 `email_unverified`, 404, 409 `conflict`, 422 (`validation_failed`, also for a person who is not a participant: `server.finance.personNotParticipant`) |
| PATCH | `/api/households/:householdId/finance/plan/incomes/:incomeId` | household:member+module:finance+verified+finance:participant | `UpdateIncomeRequest` | `IncomeResponse` | 200, 403 `finance_not_participant`, 403 `email_unverified`, 404, 409 `conflict`, 422 (`validation_failed`, also for a person who is not a participant: `server.finance.personNotParticipant`) |
| DELETE | `/api/households/:householdId/finance/plan/incomes/:incomeId` | household:member+module:finance+verified+finance:participant | – | – | 204, 403 `finance_not_participant`, 403 `email_unverified`, 404 |

Notes

- **The plan payer and an income's person must be finance participants** (M3 review finding B, SPEC D3 and D8). `PATCH /api/households/:householdId/finance/plan { payerId }`, `POST /api/households/:householdId/finance/plan/incomes` and `PATCH /api/households/:householdId/finance/plan/incomes/:incomeId { personId }` answer **`422 validation_failed`** with a detail on `payerId` or `personId` and the message key **`server.finance.personNotParticipant`** for a household member without a seat, or a user of another household. `PATCH /api/households/:householdId/finance/plan { enabled: true }` without a `payerId` checks the payer of record the same way, because the payer may have been seated once and left since. The check lives in the plan service (the same issue shape as every other service-side validation), never in the route. A plan whose income names a non-participant (a migrated ledger, ADR 0005) stays `plan_incomplete` until the income is deleted or replaced.
- **`PlanResponse`** is `{ plan: { enabled, payerId, startPeriod, lastBookedPeriod }, items, incomes, current, lastRun, pendingPeriods }`; `current` is `null` while the plan is incomplete for the current period and `pendingPeriods` is what a run would book right now. A new household's plan row is disabled, with slot 1 as payer and the current period as `startPeriod`.
- **`PATCH /api/households/:householdId/finance/plan`** enables or disables the plan, changes the payer, or moves `startPeriod`. A `startPeriod` on or before a period that any transaction already occupies (`planPeriod`, whatever the origin, e.g. the one-off import's rent series) is `409 plan_period_locked`.
- **`GET /api/households/:householdId/finance/plan/preview?period=`** is the read-only computation for one period: `422 plan_period_out_of_range` before `startPeriod` or after the current period, `409 plan_incomplete` when it cannot be computed (no active item, a person without an income valid in that period, or overlapping income rows of one person). `PlanComputationResponse` is `{ period, costTotalCents, incomeTotalCents, quoteNumerator, quoteDenominator, shares: { personId, incomeCents, shareCents }[], payerId, bookableCents, booked }`. The quote stays an integer fraction (`quoteNumerator` is the cost total, `quoteDenominator` the income total), never a float; only the non-paying person's share is rounded (once, half away from zero) and booked, and `payerShare = costTotal − otherShare` by definition. A share of exactly 0 books nothing.
- **`POST /api/households/:householdId/finance/plan/run`** is the catch-up on demand (`through?` defaults to the current period): every missed period from `lastBookedPeriod + 1` (or `startPeriod`) is booked as a `fixed_plan` row, historically, from the items and incomes that applied **in** that period, never the future. `409 plan_disabled` while the plan is off; `409 plan_incomplete` when nothing could be booked because every candidate period lacked data. The same function runs at API boot (`ApiModule.start`, before traffic) and every 6 hours, and every path writes one `finance_accrual_runs` row.
- **Booked periods are immutable.** `POST /api/households/:householdId/finance/plan/recalculate` with `{ dryRun }` recomputes every period the plan has walked past against today's items and incomes, each for the payer that period was booked under: the response lists `{ period, bookedCents, recomputedCents, deltaCents }`, the total and, unless `dryRun`, the **new** `fixed_plan_adjustment` rows (`amountCents = recomputed − effective booked`). The old rows are never touched, and re-running against unchanged data creates nothing. `409 plan_disabled` while the plan is off.
- **`GET /api/households/:householdId/finance/plan/runs`** is the audit trail, most recent first (`AccrualRunResponse`: `trigger` of `boot`, `interval`, `manual` or `import`, the periods walked, `bookedCents`, `error` as English ops text or `null`).
- **Items and incomes.** `CreateFixedCostItemRequest` is `{ label (1 to 80), amountCents (> 0), activeFrom, activeTo?, position? }`, `CreateIncomeRequest` is `{ personId, amountCents (> 0), validFrom, validTo? }`; the updates are partial. A `to` before its `from` is `422 validation_failed` (`server.validation.periodRange`; thrown by the service because a refinement on a partial PATCH cannot see the row's other half). A second income of the same person starting the same month is `409 conflict` (`server.plan.incomeOverlap`); a broader overlap is not rejected here and shows up as `plan_incomplete` at compute time.

### Balance — `apps/api/src/modules/finance/routes/balance.ts`

Mounted at `/api/households/:householdId/finance/balance`. Every method runs `requireVerifiedEmail()` then `requireFinanceParticipant()`.

| Method | Path | Auth | Request | Response | Status |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/households/:householdId/finance/balance` | household:member+module:finance+finance:participant | `BalanceQuery` (query) | `BalanceResponse` | 200, 403 `finance_not_participant`, 404, 422 |
| GET | `/api/households/:householdId/finance/balance/history` | household:member+module:finance+finance:participant | `BalanceHistoryQuery` (query) | `BalanceHistoryResponse` | 200, 403 `finance_not_participant`, 404, 422 |

Notes

- **One sign convention, chosen once: a positive `balanceCents` means slot 2 owes slot 1.** `perspectiveUserId` is the slot-1 user the number is expressed for. **`viewerBalanceCents` is the viewer's projection** (`balanceCents`, negated when the viewer holds slot 2) and is what a client renders. **The UI never shows a raw sign**: it renders `viewerBalanceCents` through three catalog keys (owes you, you owe, settled), never `balanceCents`.
- `BalanceResponse` is `{ balanceCents, perspectiveUserId, viewerUserId, viewerBalanceCents, asOf, breakdown: { splitOtherCents, forOtherCents, settledCents, transactionCount } }`. The breakdown exists so a screen can show why the number is what it is without deriving it a second time. Each `SPLIT_EQUAL` row contributes `halfForOther(amount)` (halved per transaction, never on the total; `halfForOther(-101)` is `-50`), signed by who paid; `OTHER_ONLY` and `SETTLEMENT` rows contribute the full amount.
- `GET …/balance/history?from=&to=&includeAggregates=` is a running balance per period, `{ items: { period, deltaCents, balanceCents }[] }`.

### Settlements — `apps/api/src/modules/finance/routes/settlements.ts`

Mounted at `/api/households/:householdId/finance/settlements`. Every method runs `requireVerifiedEmail()` then `requireFinanceParticipant()`. There is no settlements table: a settlement **is** a transaction with `splitMode: "SETTLEMENT"`, and `GET` is the reader `GET /api/households/:householdId/finance/transactions?splitMode=SETTLEMENT&sort=-bookedAt` would give.

| Method | Path | Auth | Request | Response | Status |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/households/:householdId/finance/settlements` | household:member+module:finance+finance:participant | `FinancePaginationQuery` (query) | `TransactionListResponse` | 200, 403 `finance_not_participant`, 404, 422 |
| POST | `/api/households/:householdId/finance/settlements` | household:member+module:finance+verified+finance:participant | `CreateSettlementRequest` | `SettlementResponse` | 201 (200 on a replayed `mutationId`), 403 `finance_not_participant`, 403 `email_unverified`, 404, 409 `balance_stale`, 409 `conflict` (one seat), 422, 422 `settlement_amount_invalid` |

Notes

- **`expectedBalanceCents` is required**: the balance the client displayed. When it no longer equals the current balance (the other person booked something thirty seconds ago) the server answers **`409 balance_stale`** with **`details.currentBalanceCents`** (and the amount in the message), nothing is booked, and the client asks again. Settling against a number the user was not shown is the one race in this app that costs real money.
- `amountCents` defaults to `|balance|` and must be greater than 0 (`422 settlement_amount_invalid`, so a default settlement of a zero balance is refused too). The payer is derived from the balance's sign: a positive balance means slot 2 pays, otherwise slot 1. Partial payments need no special case (less than `|b|` leaves the rest open, more flips the sign; over-settlement is allowed and is not clamped). `note` (at most 200 characters) is the row's description; without one the server writes the settlement description in `finance_settings.default_locale`, in the `ausgleich` category.
- `SettlementResponse` is `{ transaction, balance }` (the booked row and the balance after it). Settlements are never generated automatically: the monthly plan creates debt, not payment.

### The member-leaves veto

A seated participant cannot leave (or be removed from) the household while the ledger has rows: **`409 member_has_ledger`**, raised by the core's `DELETE /api/households/:householdId/members/:userId` through `ApiModule.onMemberRemoving` (ADR 0004). It is documented once, with the other member rules, in "Members and placeholders". toon-finance's own gotcha 69 (`anchorCannotLeave`, the refusal of an enabled plan's payer, the deletion of the leaver's incomes) does not exist in H (ADR 0007): this rule replaces it.

### Tables (SQLite, `apps/api/src/modules/finance/schema.ts`)

Eleven tables, all prefixed `finance_` (the drizzle identifiers carry a `finance` prefix too, because `apps/api/src/db/schema.ts` re-exports every module's schema flat); the migration is `apps/api/drizzle/0002_finance.sql`. Every household-scoped table cascades from `households`. Timestamps are integer unix milliseconds; `YYYY-MM` periods and the `start_period`-style columns are text with a `glob` CHECK.

| Table | Primary key | Notes |
| --- | --- | --- |
| `finance_participants` | `(household_id, user_id)` | The two seats: `member_slot` (CHECK `finance_participants_slot_range`: `member_slot in (1, 2)`), `display_name`, `joined_at`. **Unique index `finance_participants_slot_uidx` on `(household_id, member_slot)`**, index on `user_id`. `user_id` is `ON DELETE restrict`. |
| `finance_settings` | `household_id` | `default_locale` (`de` or `en`): the language of text the server writes into rows. |
| `finance_categories` | `id` | `slug`, `custom_label`, `is_system`, `is_hidden`, `position`. Unique `(household_id, slug)`. |
| `finance_tags` | `id` | `name`, `name_key` (normalised), `usage_count`. Unique `(household_id, name_key)`. |
| `finance_transaction_tags` | `(transaction_id, tag_id)` | Both columns cascade. |
| `finance_transactions` | `id` | `payer_id` (restrict), `split_mode` (`SPLIT_EQUAL`, `OTHER_ONLY`, `SETTLEMENT`), `amount_cents` (CHECK `finance_transactions_amount_not_zero`), `description`, `category_id` (`set null`), `booked_at`, `date_source`, `origin` (`manual`, `fixed_plan`, `fixed_plan_adjustment`, `import`), `plan_period` (CHECK format), `category_source`, `import_seq`, `external_key` (unique `(household_id, external_key)`: the plan's `fixedplan:{household}:{period}` and adjustment keys, the importer's keys), `created_by`. |
| `finance_mutation_claims` | `id` (the client-minted `mutationId`) | `household_id`, `transaction_id` (`set null`), `applied_at` (indexed; TTL 14 days, see Conventions). |
| `finance_fixed_cost_items` | `id` | `label`, `amount_cents` (> 0), `active_from`, `active_to` (CHECKs: format and `active_to >= active_from`), `position`. |
| `finance_incomes` | `id` | `person_id` (restrict), `amount_cents` (> 0), `valid_from`, `valid_to` (same CHECKs). Unique `(household_id, person_id, valid_from)`. |
| `finance_fixed_cost_plans` | `household_id` | One row per household: `enabled`, `payer_id` (restrict), `start_period`, `last_booked_period` (format CHECKs). |
| `finance_accrual_runs` | `id` | The audit trail: `trigger`, `from_period`, `to_period`, `periods_booked`, `periods_skipped`, `booked_cents`, `error`, `started_at`, `finished_at`. Not the idempotency mechanism (that is `external_key`). |

`finance_participants` replaces toon-finance's `household_members` (the two seats were the household there; here a household has any number of core members and finance seats two of them). `users` and `households` are core tables (see "Core tables"). Nothing else in the core knows finance's tables: the core reaches them only through the module's hooks (`onHouseholdCreated`, `onEnable`, `onMemberRemoving`, `start`, `shutdown`, `seedDemo`).
