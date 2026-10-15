# Open work

What toon-household has deliberately not done, and who has to do the rest. M0 to M7 built, migrated,
packaged and documented the app; this file is the honest list of what is still open after that.
It is a record, not a rulebook: [`SPEC.md`](./SPEC.md) (§1 decisions D1 to D15, changed only through an
ADR in [`adr/`](./adr/)) and [`../CLAUDE.md`](../CLAUDE.md) are the rules. Every item below names its
source (the plan section or ADR that recorded it) and how to tell it is done. An item with no source
does not belong here.

The four groups differ in who moves them:

| Group | Who | What closes an item |
| --- | --- | --- |
| [Owner actions](#owner-actions) | the owner, on the server, on GitHub, at the providers, on a device | the check named in the item |
| [Owner decisions](#owner-decisions) | the owner, then a session | a decision, usually an ADR, then the change |
| [Deferred by design](#deferred-by-design) | nobody, until a need appears | a new SPEC decision (an ADR) |
| [Recorded observations](#recorded-observations) | nobody; behaviour that was seen, judged harmless and left | nothing, unless the behaviour changes |

## Owner actions

Everything here needs the owner's server, accounts or devices. No agent session can do it, and none was
ever meant to (M6 plan section 8). The guide for all of it is [`deployment.md`](./deployment.md).

| # | What | Why only the owner | Source | Done when |
| --- | --- | --- | --- | --- |
| A1 | The cutover from toon-edge, steps 0 to 12 of `deployment.md` "Cutover from toon-edge": prepare the new stack (step 1), stop the old stacks without `-v` (2), copy the old volumes out (3), dry run (4), `--apply` twice (5), copy the result into `toon-household_toon-data` (6), start the new stack (7), verify (8), switch deploys over (9), retire the old stacks and toon-edge (10), later drop the redirects (11), last delete the old volumes (12). Steps 11 and 12 are items A7 and A8 below. | It touches the production volumes, DNS and the old stacks. | M6 plan section 8; `deployment.md` "Cutover from toon-edge"; `migration.md` | The step 8 checklist of the guide passes on the real server: both old hostnames redirect, the new site serves, and the finance balance equals the legacy balance to the cent. |
| A2 | The real `migrate:legacy` run on copies of the real volumes, with the claim links handed over privately. The `--apply` report holds live claim links (the placeholder member's invite URL), so it is a credential: keep it outside any repository and give the link to its person over a private channel. | Only the owner has the data, and only the owner knows who the placeholder is. M5 found no owner data in the sandbox. | M5 plan section 10 ("Owner data: none available", "Left open"); ADR 0006 consequences; `migration.md` | The dry run exits 0 with the balance OK, a second `--apply` reports "already migrated", and the placeholder's person can register through their claim link. |
| A3 | The first `release.yml` run (a push to `main` publishes `ghcr.io/toonvish/toon-household` for `linux/amd64` and `linux/arm64`) and the first `deploy.yml` run. Nothing was pushed from agent sessions. | The workflows run on GitHub, and the first run needs the repository's secrets and the `production` environment. | M6 plan sections 8 and 10; `deployment.md` "Fresh install" step 11 | A green `release.yml` run with an image for both platforms, then a green `deploy.yml` run that restarts the stack. |
| A4 | Make the GHCR package `toon-household` public (organisation, Packages, Package settings, Change visibility), or `docker login ghcr.io` once on the server. | Package settings belong to the GitHub organisation. | M6 plan section 8; `deployment.md` "Fresh install" step 6 | `docker compose pull` on the server succeeds without `denied`. |
| A5 | Set the repository variable `DEPLOY_ENABLED` to `true`, but only after the five deploy secrets exist. Without it the deploy job is skipped; set on the old repositories to `false`, it stops them deploying (cutover step 9). | Repository variables and secrets are the owner's. | M6 plan section 8; `deployment.md` step 11 and the secrets table | A push to `main` runs the deploy job instead of skipping it, and the old repositories' deploy jobs are skipped. |
| A6 | Add the new OAuth callback URL `https://<hostname>/api/auth/oauth/<provider>/callback` for Google and GitHub next to the old ones at the providers, and remove the old ones after cutover. | The provider consoles are the owner's. | `deployment.md` cutover step 0 and step 10 | OAuth sign-in works on the new hostname and no old callback is left. |
| A7 | Drop `RECIPE_HOSTNAME` and `FINANCE_HOSTNAME` from the stack's `.env` once bookmarks and installed old PWAs have moved (weeks). | Only the owner knows when the last old bookmark has moved. | ADR 0008 (the retiring worker and the path maps are optional and meant to go); `deployment.md` cutover step 11 | `caddy validate` passes with both variables unset and the old hostnames no longer resolve to the stack. |
| A8 | Delete the old `toon-recipe_toon-data` and `toon-finance_toon-data` volumes (and retire the toon-edge repository). | The only step that cannot be undone; kept until the owner is sure. | SPEC D11 ("their volumes kept until the owner deletes them"); M6 plan section 8; `deployment.md` cutover step 12 | The volumes are gone after a backup of the new volume exists outside the server (`deployment.md` "First backup"). |
| A9 | An arm64 run of the published image. | Never built or run locally (the build machine is x86_64); only a real arm64 host proves it. | M6 plan sections 8 and 10 ("arm64 (never built locally)") | The image from A3 starts on an arm64 server, `/api/health` answers and `docker compose ps` shows `app` as `healthy`. |
| A10 | A real iOS home-screen install check on a device: the manifest, the icon set, the theme colour, the three shortcuts. | Needs a physical iPhone; headless Chromium cannot show it. | M4 plan section 7; CLAUDE.md "Owner decisions still open" | The app installs from Safari's Share sheet with the house icon, opens standalone, and a shortcut opens its screen. |

## Owner decisions

Each one changes copy or drawn screens that the sources shipped, so an agent does not take it
unprompted. Where an ADR is needed it is said, because SPEC §1 changes only through one.

| # | Decision | What it would touch | Source | Done when |
| --- | --- | --- | --- | --- |
| D-1 | "Gruppe" or "Haushalt" in the German copy, and the value of `DEFAULT_HOUSEHOLD_NAME` (today "Meine Rezepte"). The German values keep toon-recipe's "Gruppe"; the code is already "household". | The `household.*`, `auth.*` and `common.*` German catalog values; the `server.group.*` strings; the default name of a new household. Needs an ADR (SPEC D10 keeps every German string byte-identical). | CLAUDE.md "Conventions" (renames from toon-recipe) and "Owner decisions still open"; M4 plan section 7 | The ADR exists, the catalogs and `DEFAULT_HOUSEHOLD_NAME` follow it, and `bun run i18n:check`'s parity half is OK. |
| D-2 | Convert toon-recipe's pinned design exceptions: the 34 arbitrary `text-[…]` sizes in 17 files, the four uppercase labels, the two `←` back links, and the `-mx-4` bars in `RecipeForm` and `ImportReviewPage`. | Drawn recipe screens. Pinned in `styles/design-system.test.ts`, so a conversion edits that record in the same commit. toon-recipe's `docs/redesign/PR.md` keeps them open too. | M4 plan section 7; CLAUDE.md "The design-system test is the Table D gate" | The pinned lists in `design-system.test.ts` are shorter by what was converted, and the screens are re-checked at 390 and 1440. |
| D-3 | Print styles for the finance screens. Neither source had any; only the recipe detail prints (M4-T09, M7-T01). | A new `print.css` for `modules/finance`. | M4 plan section 7 ("Print styles for finance screens") | Printing a finance screen to PDF at 390 and 1440 (`page.emulateMedia({media:"print"})` plus `page.pdf()`) shows content and no chrome. |
| D-4 | A per-household PWA name or icon. The manifest is static per build. | `pwa-manifest.ts`, the build, or a served manifest. | M4 plan section 7 | The decision is recorded in an ADR, then the manifest follows the active household. |

## Deferred by design

Left out on purpose. Each is a decision in SPEC or an ADR, not an oversight.

| # | What | Why deferred | Source | How to verify when done |
| --- | --- | --- | --- | --- |
| X-1 | An N-person finance ledger. The ledger stays exactly two people, `member_slot` 1 or 2, slot 1 the balance anchor. | SPEC D3 keeps toon-finance decision 1 and says the generalisation is explicitly out of scope: every kind, the balance sign and the half-split rule assume two. | SPEC D3 and §9; ADR 0004 | A new SPEC decision (an ADR) rewrites D3, then `finance-balance` and the ledger tests are redone for N. |
| X-2 | A shell-wide sync badge. The shell has none; recipe's shopping list shows its own count and finance's `PendingSyncNote` is module-local. | The core cannot know a module's mutation namespaces (SPEC §5). | SPEC §5 "Offline outbox note"; M4 plan section 7 | A module-contract field for the namespaces exists and the shell renders one count across modules. |
| X-3 | Extending the `onMemberRemoving` veto to other modules. Today only finance vetoes (a seated participant leaves with `409 member_has_ledger` while the ledger has rows). | Recipe has nothing to veto: its content belongs to the household, saved cards belong to the user. | ADR 0004 (the contract gained `onMemberRemoving`); CLAUDE.md "Obligations" (M7 "may extend the veto") | A new module declares an `onMemberRemoving` hook and a test refuses its leaver. |
| X-4 | The dead state of a one-seat ledger after a slot-1 placeholder: a placeholder may hold slot 2 only, but ADR 0004's re-seat can leave a placeholder alone in slot 1 after the account in slot 1 leaves an empty ledger. A booking that needs the other slot answers `409` (`server.household.needsSecondMember`); nobody can open it until an admin seats two people with `PUT …/finance/participants`. | The state is reachable only through an admin's own removal of the other participant; the refusal is precise and the fix (seating two) is one admin action. | ADR 0006 consequences; ADR 0004 and ADR 0005 (the one-seat ledger) | A decision is recorded for the state (for example refusing the removal that would cause it), then a test pins it. |

## Recorded observations

Seen, judged harmless and left as they are. Nothing is open unless the behaviour changes.

| # | What was observed | Why it stays | Source | How to verify |
| --- | --- | --- | --- | --- |
| O-1 | Every output line of `bun run migrate:legacy` carries the `@toon/api migrate:legacy: ` prefix, the workspace filter's. The `--report` JSON is clean. | It is the filter's behaviour, documented in `docs/migration.md`; stripping it would mean bypassing the workspace script. | M5 plan section 10 (observations) | Run the CLI and compare with `docs/migration.md`; parse the `--report` file as JSON. |
| O-2 | The ids re-keyed in a dry run differ from those of the apply: a legacy id that is already taken gets a random fresh UUID per pass. | The dry run is a scratch copy and the apply repeats its pass first; only the `--apply` result is kept, and a second `--apply` maps through `legacy_ids`, not through the ids. | M5 plan section 10 (observations); `docs/migration.md` | Dry-run twice and `--apply` once on the fixtures; the second `--apply` writes nothing. |
| O-3 | `uploads:gc` keeps a migrated orphan for 24 hours after the copy (it never deletes a file younger than 24 h). | The 24-hour grace is the safety rule of the script, deliberately. | M5 plan section 10 (observations); CLAUDE.md `uploads:gc` | `bun run uploads:gc -- --dry-run` lists the orphan only after 24 h, or with `--min-age-hours=0`. |
| O-4 | After "Buchen" on the Erfassen sheet the focus is on `body`, not on Betrag (the sheet re-renders the form). Cmd or Ctrl+Enter from inside the field keeps the focus where it is. | toon-finance has no refocus code either (its `grep focus` finds only `Dialog`'s one-shot autofocus), so H matches F. | M3b plan section 9.6 | In the headless run, book from the sheet and read `document.activeElement`. |
| O-5 | `bun run i18n:check` exits 1 by design: its parity half is OK and its leftover-German half reports 146 hits, all classified as false positives (German labels or umlaut examples quoted in doc comments, and recipe content vocabulary such as the ingredient-paste placeholder, `UNIT_SUGGESTIONS`, `STEP_HEADING_RE`, the `html/entities.ts` umlaut entities). | The check is grep-shaped and cannot tell a comment quote from UI copy; classify each hit, never suppress the check. | M3b plan section 9.3 (the 146 classified); M7 plan section 1.1; CLAUDE.md "Commands" | `bun run i18n:check` prints `OK` for parity and `146 possible German literal(s)`; a changed count means a new hit to classify. |

The temp-file test database (ADR 0009) is not listed: M7-T02 went GO, so the whole suite runs on a
temp file DB and there is nothing left to record.
