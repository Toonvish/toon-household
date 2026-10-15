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
  object URLs and a recipe may keep an external `https:` hero image. `object-src blob:`: the PDF import
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

<!-- M7-T04 fills this section -->

## Finance module

<!-- M7-T05 fills this section -->
