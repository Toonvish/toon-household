# 0007: toon-finance 1715207 adapted in three places (refines D13)

Date: 2026-10-15

## Context

M3b ported toon-finance `cbdec67..1715207` (plan `m3b-finance-sync.md`). SPEC D13 makes every
locked decision and gotcha of a source `CLAUDE.md` binding inside the module that inherits it, with a
short list of named changes. Three of the new toon-finance gotchas cannot be taken literally in this
repository, and the review of M3b confirmed each as a deliberate deviation rather than a slip:

- **F gotcha 69 (leaving).** toon-finance refuses a slot-1 member leaving while slot 2 sits
  (`409 server.household.anchorCannotLeave`), refuses the payer of an ENABLED plan, and deletes the
  leaver's incomes. In H the membership (`household_members`) and the seat (`finance_participants`)
  are different tables and ADR 0004 already settled the rule: any seated leaver is refused with
  `409 member_has_ledger` while the ledger has a row or an income names them; on an empty ledger the
  seat is deleted, a slot-2 survivor is re-seated in slot 1 and the plan payer moves.
- **F gotcha 67 (security headers).** toon-finance's CSP serves one app that needs no WebAssembly,
  no `blob:` images and no external images. H serves the recipe module from the same origin: the card
  scanner instantiates zxing-wasm, import previews are `blob:` / `data:` object URLs, the PDF import
  preview is an `<embed src="blob:…">` and a recipe may keep an external `https:` hero image.
- **F gotcha 66 (origin guard).** toon-finance's rule refuses `Sec-Fetch-Site: same-site`. H's dev
  default runs the web app on `:5173` and calls the API on `:3001` with CORS and credentials, which
  is the same SITE, so F's rule would refuse every dev write.

Two further plan-level departures from toon-finance (claim invites need admin or owner, F: either
member; the "Erfassen" sheet is module-local without a FAB) are not SPEC §1 changes: the first is in
ADR 0006, the second keeps D6 (Erfassen stays tab 3, Fixkosten sidebar-only) and D5.

## Decision

1. **Leaving follows ADR 0004, not F gotcha 69.** `anchorCannotLeave` does not exist in H.
   `finance-security.test.ts` carries F's case titles and asserts H's rule, so every F test file at
   `1715207` still has a counterpart.
2. **The CSP is F's plus the recipe module's needs, and nothing else:** `script-src 'self'
   'wasm-unsafe-eval'` plus the SHA-256 of every inline script of the built `index.html`;
   `img-src 'self' data: blob: https:`; `media-src 'self' blob:`; `object-src blob:`. Everything else
   as F (`style-src 'self'`, `font-src 'self'`, `connect-src 'self'`, `frame-ancestors 'none'`,
   `X-Frame-Options: DENY`). No `Permissions-Policy` (the scanner needs the camera), no HSTS (the
   Caddy owns it, D11). `Cross-Origin-Resource-Policy` is `same-site` instead of Hono's
   `same-origin`, because the dev web origin loads `<img>` from the API origin.
3. **The origin guard trusts the `WEB_ORIGIN` entries first,** then applies F's rule (`Sec-Fetch-Site`
   cross-site or same-site, `Origin: null`, an `Origin` host that differs from the request host are
   403; no `Origin` passes). An origin the operator listed is the one CORS already trusts.

SPEC D13 carries the exception in the same commit.

## Consequences

- `connect-src 'self'` presumes a build with `PUBLIC_API_URL=""` (F gotcha 50): a bundle that baked
  `http://localhost:3001` has every API call and upload image blocked when served from another
  origin. `lib/api.ts` now falls back to `""` in a production build (`af71df1`), the image build (M6)
  must still set the variable empty, and the CSP is never widened for an absolute API URL.
- The wider `script-src` and `object-src` are what the recipe module needs and are pinned in the
  header's source comment; a new feature that needs more is a new entry here, not a quiet widening.
- A later toon-finance gotcha about leaving or about the CSP is read against this record first.
- The slot-1 survivor state that F's gotcha 69 prevents cannot arise in H except through ADR 0004's
  re-seat, which keeps `slot1UserId` resolvable; see ADR 0006 for the one case where a placeholder
  is left alone in slot 1.
