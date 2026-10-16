# 0013: Validation details come from the one schema adapter (records plan e1 P7, P9, P10)

Date: 2026-10-16

Status: implemented and pinned by `apps/api/test/validation-wire.test.ts`; the wire change of the owner note below
awaits the owner's acknowledgment (`docs/open-work.md` D-7). Until then it is the shipped behaviour, not a settled one.

## Context

Milestone E1 of `docs/EFFECT.md` (decision E4) replaces Zod with Effect `Schema` in `packages/shared` and gives
the API one decode path, `apps/api/src/lib/validate.ts` (plan `docs/plans/e1-shared-schema.md`, decisions P8 and
P9). Before E1 the API had two validation paths that both answered `422 validation_failed`, with different
`details`:

- the 58 `zValidator(target, X, onValidationError)` call sites in 15 route files, plus
  `EnableModuleRequestSchema.safeParse` in `apps/api/src/core/routes/modules.ts`, built each item in
  `apps/api/src/core/services/households/validation.ts` as `{ path, code, message }` with **Zod's own English
  default message** ("Too small: expected string to have >=1 characters") and no `i18n`;
- the `readJson` routes (`apps/api/src/core/routes/auth.ts`, `apps/api/src/modules/recipe/routes/cards.ts`,
  `apps/api/src/modules/recipe/routes/imports.ts`) let a `ZodError` escape to `toApiError` in
  `apps/api/src/lib/errors.ts`, which rendered it with `toValidationIssues`: `{ path, code, message, i18n: { key,
  values } }`, the message from the server catalog in the negotiated locale.

`docs/API.md` "Conventions" documents only the second shape: "every response's prose (… a validation issue's
`message` …) is rendered in the locale negotiated from the request's `Accept-Language` header" and "a validation
issue also carries `i18n: { key, values }`". The first path never met that promise. Separately, Effect `Schema`
runs a struct's own checks only when every field of the struct decoded, where Zod also ran an object-level
refinement after a continuable field issue (`too_small`, `custom`); the golden corpus of E1-T01 shows the
difference on inputs that are already rejected.

## Decision

- **One decode path, one renderer (P9).** Every validation of request input goes through `validate(target,
  schema)` (built on `hono/validator`'s `validator` exactly as `@hono/zod-validator` 0.9.1 is: a JSON body only
  with a JSON `Content-Type`, otherwise `{}`; malformed JSON stays Hono's `400 bad_request`; a repeated query key
  is an array), `decodeOrThrow` or `decodeOption` of `apps/api/src/lib/validate.ts`. A refused value throws
  `Schema.SchemaError` (`Schema.decodeUnknownSync` with every issue collected, plan P6); `toApiError` maps it ONCE:
  `if (Schema.isSchemaError(error)) return ApiError.validationFailed(toValidationIssues(error.issue, locale))`.
  The status and code stay **422 `validation_failed`** (`docs/API.md` error table); the milestone task text's
  "400 validation_error" is not the contract. Until E1-T11 the helpers also take a Zod schema and its `ZodError`
  renders through the same `toValidationIssues` (plan P8).
- **Every validation issue of every route is rendered by the adapter (P10).** When E1-T06 and E1-T07 move the
  58 validator routes and `POST /api/households/:householdId/modules/:moduleId` onto `validate`, their `details`
  items keep the same `path` and the same `code`, and their `message` becomes the server catalog's text in the
  negotiated locale, plus `i18n: { key, values }` where only Zod's English default was sent. That is what
  `docs/API.md` "Conventions" already says for every validation issue, so no `docs/API.md` row, status or code
  changes; `onValidationError`'s own `{ path, code, message }` mapping retires with the last `zValidator`.
- **One pinned structural divergence (P7).** On a body that is already rejected, a struct-level refinement no
  longer runs while a field of that struct fails, so `details` may list fewer trailing `custom` issues than Zod
  did. `ok` (accepted or refused) and the first issue never change; every such golden case is listed by id in the
  parity tests' P7 allow map with its reason, and a listed case that does not diverge fails (no stale entries).
  Any other difference is a defect in the schema or the vocabulary, not a candidate for this ADR.

## Consequences

- **(i) Forms show catalog text for a server 422 on the former `zValidator` routes.** `apiFieldErrors` /
  `fromIssues` in `apps/web/src/lib/validation.ts` prefer `i18n.key` over `message`. A server-side 422 from one of
  those routes that a form renders (a form whose client-side `validate` passed, or a request without one) now
  shows the catalog text in the UI language, for example "Name fehlt" / "Name is required"
  (`server.zod.field.name.too_small.1`), under the SAME field where it showed Zod's English sentence ("Too small:
  expected string to have >=1 characters") before. The field it lands on (`path`) is unchanged. This contradicts
  the milestone task's "the same onValidationError behaviour" for the message prose only, and follows
  `docs/API.md` "Conventions" and `docs/EFFECT.md` E4 (the wording of ADR 0002).
- **(ii) P7 reaches client-side forms through the shared schemas.** The web `validate` decodes with the same
  shared schemas (E1-T05), so while a field of a struct fails, that struct's own refinements do not run on the
  client either. In `apps/web/src/modules/recipe/features/cards/components/CardFormDialog.tsx` an invalid
  `label` hides the card-value error (the card schemas' struct-level check on path `["value"]`) until the label
  is fixed; the user sees the value error on the next submit. Measured with Zod 4.5.4 at E1-T04: for the
  check-digit rule of `CreateCardRequestSchema` and `UpdateCardRequestSchema` (a `superRefine` after a
  `transform`) Zod already behaved so, because the transform does not run after a field issue; what newly stops
  running after a field issue are `UpdateCardRequestSchema`'s two object-level `.refine`s
  (`server.card.formatAndValue` on `["value"]`, `server.validation.noChanges`), which the dialog cannot trigger
  because it sends every field. `ok` never changes, so no invalid card is ever accepted.
- The `422 validation_failed` envelope, every route row of `docs/API.md` and every German catalog string stay as
  they are; the API tests pin `path`, `code` and `i18n.key` of `details[0]`, none of which changes.
- **`docs/EFFECT.md` is corrected in the same commit as this record.** E4 and the E1 row of section 4 named a status and
  code the contract does not have (`400` / `validation_error`), a `details` item without `i18n`, and "`env.ts` kept on
  its own parsing until E2", which cannot hold once `zod` leaves the tree (`env.ts` and `lib/oauth.ts` decode with a
  local `Schema` and the pure `parseEnv`, plan e1 P11; the `AppConfig` service is still E2's). The texts now say 422
  `validation_failed`, `{ path, code, message, i18n }` and the P11 arrangement. No decision changed.
- **No SPEC text changes.** D10's sentence on validation wording (as amended by ADR 0012) stays true: the generic
  validation messages come from the core's catalog with the core's wording, now for every route. D8's error
  envelope and codes are untouched.
- `apps/api/test/validate.test.ts` pins both arms of the decode path until E1-T11, with the Zod cases in one
  delimited `describe` that E1-T11 deletes (plan P20).
- **Owner note: a deliberate wire change, pinned.** The `details` items of the 58 former `zValidator` routes and of
  `POST /api/households/:householdId/modules/:moduleId` changed on the wire: `{ path, code, message }` with Zod's
  English sentence became `{ path, code, message, i18n: { key, values } }` with the catalog text in the negotiated
  locale. It is the one intentional departure from "behaviour is frozen" in E1; `path`, `code`, the status and the
  envelope are unchanged and every `docs/API.md` row already described this shape. `apps/api/test/validation-wire.test.ts`
  pins it on real routes (a JSON body, the enable-module body, a query) in `de` and `en`, so the shape cannot drift
  back or apart unnoticed. A client that matched the old English sentence would break; the web forms read `i18n.key`
  first, and no other consumer is known.
