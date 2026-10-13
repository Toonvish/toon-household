# Redesign: Newsreader/Figtree, a meal planner, and a bought log

`redesign` → `main` · 11 commits · 203 files · +35,618 / −1,899

## What changed

The design project delivered **seven dark-mode artboards** covering four screens at two
breakpoints. This branch implements them, extends the same visual language over the ~15 screens
the design never drew, and ships the two features the artboards imply but the app did not have: a
**meal planner** and a **bought log**.

**Type is the change; the palette was already ours.** The design lifted its colours from
`theme.css` and evolved the type to **Newsreader** (display) + **Figtree** (text), both
self-hosted and subsetted — four `woff2` files in `apps/web/public/fonts/`, two `latin` faces
preloaded, `woff2` added to the service worker's `globPatterns`. No request reaches
`fonts.googleapis.com` or `fonts.gstatic.com`, verified with a network listener across eleven
screens. Newsreader ships as a **single static `wght=500 opsz=18` instance** declared over
`font-weight: 400 700` precisely so a missed call site renders the real 500 rather than synthetic
fake bold — which retired `font-display font-semibold` at all 26 sites in favour of
`font-medium` plus one of eight `--text-display-*` steps.

**The shell was rebuilt and the tab set changed.** `TopBar` is deleted; a 236px `SideNav`
(`--spacing-sidebar`) owns desktop and `PhoneHeaderRow` owns the phone. The four tabs are now
**Rezepte / Plan / Einkauf / Profil** — Import lost its tab to Plan, on the reasoning that a meal
plan is a daily destination and importing a recipe is something you do a handful of times and then
not for weeks. Import moved to the 44px `+` in the library header, which opens a
`LibraryCreateMenu` sheet offering both *Importieren* and *Neues Rezept*. That sheet is now the
**only** phone route to either, so it joins `GroupsCard` and `CardsCard` on the list of triggers
whose deletion orphans a screen. `/import` remains a declared route for the manifest shortcut and
shared deep links.

**Two features are new, not repainted.** The **planner** (`meal_plan_entries`) is group-owned,
keyed on a `text` `YYYY-MM-DD` calendar date rather than an instant — a date derived from an
instant is a day out whenever the server's zone and the user's disagree, i.e. every night between
00:00 and 02:00 for a UTC container and a Berlin cook. Writes are online-only, so idempotency
comes from a `UNIQUE (group_id, planned_on, recipe_id)` index instead of a `mutationId` ledger.
**Cook tracking** is a log (`recipe_cook_log`), not a column, because `cooked_by` has to be
carried; `recipes.last_cooked_at` is denormalised off it, nullable, written by exactly one writer
(`services/recipes/cookLog.ts`) and unpatchable through `recipePatch()` — the same rule that keeps
`updateUser()` away from `email_verified_at`. A cook deliberately does not bump `updated_at`: a
cook is not an edit, and bumping it would reorder `?sort=newest`.

**The shopping list's check-off now also appends to a log.** It still `DELETE`s the item row and
still bumps the catalog entry — the Bring behaviour is untouched — and it additionally writes
`shopping_bought_items`, which is what draws "Heute gekauft" and `/shopping/history`. There is
still no flag on the item row, and the reason is now two-part: the
`shopping_list_items(list_id, merge_key)` unique index must stay **total** so a re-added bought
item merges normally (a `bought_at` column would need a partial unique index whose support on
libSQL's SQLite 3.45.1 is unverified), and a persisted offline outbox entry must keep meaning
"delete this row" — a dehydrated `v2` mutation replayed against a flag-based schema would silently
mean something else. The append is bound to the `DELETE … RETURNING` actually removing a row, not
to the request arriving, which makes it exactly-once with a `mutationId`, without one, and under
two members checking the same item at the same moment. That gate also fixes a pre-existing double
`use_count` bump. *Gekauftes leeren* clears the **section**, never the log, through a
`bought_cleared_at` watermark — one integer, one O(1) write, and it cannot disagree with itself.
"Häufig gekauft" gained a hide (`hidden_at`) rather than a delete, so an entry keeps its
`use_count`; the chips are the top 8 by `use_count` **displayed alphabetically by folded name**,
which is two separately named operations (`selectMostBoughtEntries`, then
`sortEntriesByFoldedName`) because a single `sortBy` silently reverts the design's own fix.

**Category became a dimension of a tag.** `tags.kind` is `'course' | 'free'`; a course renders as
a honey eyebrow, never a removable pill, and the library's cards show one category with the rest of
the tags moved to the filter rail — which is the design's stated fix for tag clutter.

## What was not drawn, and had to be derived

This is the part of the branch that deserves the most scrutiny, because a reviewer cannot compare
it to anything. Roughly half the redesign's visible behaviour has no drawn reference.

### The desktop recipe library — no artboard

There are **seven artboards for eight intended screens**, and the missing one is the desktop
library. `screen-map.md` claimed `1a/1e Library` + `1b/1f Detail`; that is stale and the file now
says so. `1a` is captioned "Recipe library · desktop 1440" and labelled `Library desktop`, but its
**content is the recipe detail screen**; `1b` does not exist at all. So the screen was reconstructed
from four real sources rather than invented:

1. **`1e`** (library mobile) — the content order: group switcher and `+`, `Recipes` h1, search with
   a Filters affordance, a "This week" strip with `Plan →`, then "All recipes" as editorial rows.
2. **The five unused `renderVals()` datasets** — `recipes`, `week`, `recent`, `courseFilters`,
   `tagFilters`. They exist in the design's script, no artboard renders them, and they *are* this
   screen's data.
3. **The `#t1` intro copy** — "content spans the full width with a filter rail, planner strip and a
   two-column shopping layout", "titles never truncate: editorial rows give titles a full line",
   "cards show one category; tags move to the filter rail on the left".
4. **The 236px desktop chrome** from `1a`/`1c`/`1d`, verbatim.

The design's own "Try next" line (*make 1a a grid instead of rows*) is what confirms rows.
**Five choices inside the screen have no source at all** and are tagged `[RECON]` in `PLAN.md` §7:

- the filter rail's **220px** width;
- the **"Mehr Filter" disclosure** holding Sammlung / Schwierigkeit / Zeit;
- the **sort control's move into the `h1` row**;
- **"Kürzlich gekocht" sitting above "Alle Rezepte"** (nothing may sit below an infinite list);
- the **planner day card gaining a meta line**.

These five are the first places to re-check if the artboard is ever drawn.

### `/plan` — no artboard at all

`SPEC.md` §4.1 says so outright. It is extrapolated from the three drawn day-card states in the
library's "This week" strip, the page-header shape of `1c`/`1g`, `1d`'s 340px rail, 26px gap and
section-header pattern, `ActionMenu` as the repo's existing sheet model, and the new type scale.
**The largest invention is the phone layout**: a vertical list of seven day rows rather than the
library strip's horizontal four, because a 132px strip card cannot hold a title that never
truncates. The screenshots attached to this PR are its only reference.

### `/shopping/history` — the destination of a drawn link that was never drawn

`1c` draws `Bought history → All`. The screen behind that link does not exist in the design. It is
extrapolated from the history panel's own row shape (day header + rows) plus the shell, at a
deliberately pinned scope: read-only, day-grouped, `offset`-paged, with a list filter and no
per-row actions. A cheaper expand-in-place alternative is recorded as open item O4.

### The light-mode twins of the four new tokens

Every artboard is **dark**. Four new semantic tokens therefore had no drawn light value and were
derived:

| Token | Light | Dark |
| --- | --- | --- |
| `--accent-strong` | `--toon-accent-700` `#9a6710` | `--toon-accent-400` `#eab54f` |
| `--bg-sunken` | `--toon-sand-100` | `#130f0c` |
| `--fg-body` | `--toon-sand-700` | `#e8dccd` |
| `--fg-faint` | `#7f6f5b` | `#8d7c67` |

Nobody drew the left column. It is the design's dark ramp reasoned back through the existing
`--toon-*` primitives, and the light halves of the app have no reference beyond the pre-existing
palette.

### The ~15 undesigned screens

Import (page, review, error and OCR panels, source viewer), the recipe form, cook mode,
collections, tags, groups and group detail, the card wallet, the seven auth pages and the two error
screens were **extrapolated** onto A01 §5.1's lookup table (decision D6) rather than left
half-redesigned around the six that were drawn. That table maps a role — page h1, card heading,
compact row title, eyebrow — to a step, so the extrapolation is at least mechanical. It is still
extrapolation.

### Every state the design never drew

The artboards draw populated, online, writable screens in one theme. Everything else was specified
in `PLAN.md` and built without a reference: **empty**, **loading** (skeleton shapes per screen),
**error**, **offline** (which of the shopping screens stay writable and which do not), and
**read-only** (the unconfirmed-address gate). That is roughly half of what a user actually sees.

## The one deliberate colour deviation

`--fg-faint` is **`#8d7c67`**, not the artboard's **`#6b5c4b`**. The drawn hex measures **2.88:1**
on `--bg` across **24 pieces of 11px/700 copy** — under WCAG AA (4.5:1) and under the 3:1
large-text floor, and 11px/700 is not large text. Decision **D8** overrode the artboard here. It is
the only place the app knowingly does not match the design's colour, and it is one token across all
four `theme.css` blocks.

## Two pre-existing bugs fixed in passing

Both are user-visible on ~15 screens that have nothing to do with this redesign.

**`theme.css`'s explicit-theme blocks were incomplete.** The two `[data-theme]` selectors are
specificity `(0,2,0)` and beat both `:root` rules — **but only for the tokens they actually name**,
so the media query's value stands for anything omitted. Measured at the base commit:
`[data-theme="light"]` was missing **14** tokens (every `--accent*`, `--success*`, `--warning*`,
`--danger-hover`, `--ring` and all three `--elevation-*`) and `[data-theme="dark"]` was missing the
**3** elevations. So "light theme on a dark phone" rendered black 70%-opacity shadows under white
cards, and "dark theme on a light laptop" had no card elevation at all — the combination nobody
checks. All four blocks now define the same **39** semantic tokens, verified by diffing the token
name sets. Left unfixed, this would have silently killed the two `shadow-pop` phone bars the
redesign lifts.

**`print.css` has always hidden `[data-app-shell]` on elements that never carried it.** It hides
`header[data-app-shell]`, `nav[data-app-shell]` and `aside[data-app-shell]` — and at the base
commit `data-app-shell` appears in exactly three places in the whole repo: those three selectors.
No element had the attribute, so **every print of a recipe included the entire app chrome**, for as
long as the stylesheet has existed. `SideNav`'s `<aside>`, `BottomTabBar`'s `<nav>` and
`PhoneHeaderRow`'s `<header>` now carry it. A print stylesheet is invisible to all five gates,
which is exactly how this stayed broken — see Open below, because the verification it needs was
not done.

## Three mock inconsistencies not transcribed

- `1a`'s Ingredients header reads **"15"** and its button *"Add all 15"* over
  `renderVals.ingredients`, which holds **12** rows.
- `1a`'s Method reads **"6 steps"** over **4** entries.
- `1c` draws **one** list preview, while *several named lists per group* is locked decision 7.

All three counts come from `recipe.ingredients.length` / `recipe.steps.length` and the real list
collection. Hard-coding 15 or 6, or building the overview around a single list, is the failure those
notes exist to prevent.

## Migrations, and what an existing install sees on day one

Three additive migrations. Nothing is destructive and no `NOT NULL` column is added to a populated
table, so `0003`'s "SQL default plus JS backfill" dance is not needed and `backfillFoldedColumns()`
is untouched.

- **`0006_tag_kind`** — `tags.kind text NOT NULL DEFAULT 'free'`.
- **`0007_meal_plan_and_cook_log`** — `meal_plan_entries`, `recipe_cook_log`,
  `recipes.last_cooked_at` (nullable) and `recipes_group_last_cooked_idx`.
- **`0008_shopping_bought`** — `shopping_bought_items`, `shopping_list_recipes`,
  `shopping_list_catalog.hidden_at`, `shopping_lists.bought_cleared_at`.

**There is no `tags.kind` backfill and no `last_cooked_at` backfill, and the consequence is
visible immediately.** On an existing library:

- **The week strip and "Kürzlich gekocht" render nothing at all — heading included — until
  somebody plans or cooks something.** `last_cooked_at` is NULL for every pre-existing recipe
  because the log is brand new, and the planner starts empty.
- **Every existing tag is `'free'`**, so no recipe shows a honey course eyebrow until somebody
  flips a tag on `/tags`. R41 rejected guessing at somebody else's German tag names, so that
  toggle is the only path by which an existing library adopts the category dimension. The
  course/free split on `/tags` only renders once a first tag has been switched, because an empty
  "Gänge" section above a full "Tags" section would look broken on every pre-redesign install.

**That silence is intentional and it is the single thing most likely to be reported as a bug.** It
belongs in the release notes: the two new library sections are empty by design on day one, and they
fill in as the group uses them. `0006`'s `DEFAULT 'free'` *is* the whole backfill, deliberately.

Forward migration was tested against a real pre-redesign database: a DB built at the base commit
`57edb76` (migrated and seeded there with the old schema), then migrated with this branch — clean,
with existing data intact.

## Verification

**Five gates, run from a clean tree on the final commit:**

| Gate | Result |
| --- | --- |
| `bun install` | Checked 436 installs across 625 packages, no changes |
| `bun run typecheck` | **OK** across all five projects (`packages/shared`, `apps/api`, `apps/web` ×3) |
| `bun test` | **1182 pass / 0 fail**, 6314 `expect()` calls, 50 files, 10.8 s |
| `bun run build` | vite + PWA `generateSW`, precache **88 entries (1619.85 KiB)**, exit 0 |
| `bun run i18n:check` | exit 1 — read and classified, see below |

`i18n:check` is grep-shaped and exits non-zero even when the tree is correct. Its output was read,
not just its exit code. **Check 1 (parity): 129 hits, all genuinely new copy** for new or
redesigned features (`plan.*`, `server.plan.*`, the cook-log keys, `shopping.bought.*`,
`shopping.history.*`, `groups.tags.kind*`, `recipes.form.course.*`, `ui.nav.plan`,
`cards.link.panelTitle`) — and it was verified programmatically that **no key appears as both a
removed and an added line** in any `de` catalog against the merge-base, i.e. the real failure mode
(same key, silently reworded German) does not occur anywhere in the 129. **Check 2: 110 hits, 11
after filtering comments, every one of them content vocabulary** from CLAUDE.md's closed list —
`UNIT_SUGGESTIONS`, the ingredient paste placeholder, `STEP_HEADING_RE`, `html/entities.ts`'s
umlaut table — plus one JSX comment the filter's regex cannot strip.

Also run: `bun run db:migrate` + `bun run seed` against a fresh `file:` DB; the forward migration
above; the README curl walkthrough against a real server (health, login, groups, cards including
check-digit completion `405912345678 → 4059123456788`); and `WEB_DIST_DIR` font serving —
`/fonts/figtree-latin.woff2` returns `200`, `content-type: font/woff2`,
`cache-control: public, max-age=86400`, so no image rebuild is needed for fonts.

**Headless browser (Playwright + Chromium, installed outside the repo; 80 measured assertions, 0
failures):**

- **Horizontal overflow** across 21 screens: `0` on all 14 phone screens; `−15` at 1440 and 1024.
  The negative delta was traced rather than accepted — `html` carries `scrollbar-gutter: stable`
  while `body` owns the scrollbar, so `scrollWidth` follows the narrower 1425px content. Only a
  **positive** delta is overflow, and the runbook's criterion was corrected from `=== 0` to `<= 0`.
- **`<main>` padding**: `16px` at 390 (`.px-gutter`'s 1rem default), `32px` at 1024/1440
  (`lg:[--gutter:2rem]`). `rootPadX` is `['0px','0px']` and `rootMaxWidth` `none` on every
  artboard-shaped page — no page root re-applies the shell's four utilities. Six form-shaped pages
  report `768px`: they narrow the column with `mx-auto max-w-3xl` without re-adding padding, which
  is the intended pattern, not the double-padding trap.
- **`px-4`/`px-2` + `px-safe` on one element**: `0` matches on all six artboard screens.
- **Sticky bar vs the fixed tab bar**: `−1px` on both recipe detail and shopping list detail, i.e.
  the bar sits directly on the tab bar. Matched structurally via `nav.fixed` with a
  `height === 0` guard, because `SideNav` shares the tab bar's `aria-label` and would report a
  plausible-looking wrong number.
- **`<fieldset>` min-inline-size**: `0` fieldsets still carry the browser default.
- **Grids at 390**: recipe detail's 4-up stat row = 4 cells, 358px, **89.5px each**, 0 overflowing;
  shopping list's 2-up tiles = 358px, **179px each** (the design's own estimate was ~175px), 0
  clipped labels.
- **Title clamp**: all three library titles report `webkitLineClamp: none`, `display: block`,
  `scrollHeight === clientHeight` — "titles never truncate" holds, and `block` is not silently
  killing a clamp.
- **Fonts**: `document.fonts.check()` true for both families on all eleven screens; **zero**
  requests to Google's font hosts.
- **Theme parity**: all four `theme.css` blocks define the same 39 tokens, name sets diffed both
  ways, elevations genuinely differing between light and dark in all three non-base blocks.
- **Barcode**: the barcode `<svg>` (viewBox `0 0 113 1`) is `#fff` ground / `#000` modules in all
  four of 390-light, 390-dark, 1440-light and 1440-dark — unaffected by theme, as the rule requires.

22 screenshots at 390 / 1024 / 1440 in light and dark accompany this PR. For `/plan` and
`/shopping/history` they are not a check against a reference — **they are the reference.**

## Open, and knowingly incomplete

Nothing here blocks review, but none of it should be read as done.

1. **The recipe print output was never verified in a browser.** `print.css` was fixed (see above)
   and the markup now carries the attributes it needs, including both phone panels staying in the
   DOM under `hidden` so printing from a phone gets ingredients *and* method. But **no print-to-PDF
   pass was run at 390px or 1440px**, which was an explicit requirement of the task that owns it.
   A print stylesheet is invisible to all five gates — that is precisely how it stayed dead for
   years — so this is the highest-value remaining check.
2. **The type scale is not enforced in the tree.** An arbitrary `text-[…px]` went from **19** hits
   before the redesign to **36** after: the designed screens transcribed artboard pixel values
   instead of mapping them to steps. The gate that was supposed to catch this was written against
   a premise ("one pre-existing violation") that was never true.
3. **Four uppercase labels never became `.eyebrow`** — `IngredientList`, `StepList`,
   `ItemDetailDialog`, `RecipeDetailPage` still carry `text-sm font-semibold tracking-wide`, down
   from 11 such labels. Converting them changes section headings from 14px/600 to 11px/700 on
   screens the design *did* draw, so it is a design decision, not a gate fix.
   (`CardDisplayDialog`'s `tracking-wide` is letter-spacing on the barcode digits and is correctly
   exempt.)
4. **Four `←` glyphs survive in translated copy** — `groups.detail.backLink` and
   `groups.collectionDetail.backLink` in both locales. Unchanged from the base tree, but the new
   rule forbids them: they fall outside both font subsets and render from the fallback family.
   Fixing them is a copy change in two catalogs plus a `lucide` `ArrowLeft` at each call site,
   which trips `i18n:check`'s parity check and so needs an `i18n-keys.md` entry.
5. **`planDateToDate()` is UTC noon**, per its spec'd signature, so a plan date renders a day early
   at UTC+12/+13 — `TZ=Pacific/Auckland` shows `2026-09-08` as "Mi 9". The America/New_York bug
   this mirrors *was* fixed; both remaining call sites correctly follow the documented helper, so
   this is one line in `packages/shared/src/calendar.ts` (local noon instead of UTC noon) and
   nothing else uses it. Not changed at the gate because it overturns a written signature.
6. **`course` lives in `RecipeForm`'s own `useState`**, not in `RecipeFormValues`, because
   `features/recipes/lib/formState.ts` belonged to no task. It is dirty-tracked and
   server-error-mapped, so it behaves correctly, but it should move into `formState.ts` rather than
   be layered on top.
7. **The sidebar's "New" pill on Plan never retires.** The spec wants it hidden after the first
   visit via `readStorage(storageKeys.planVisited)`; `PlanPage` already writes the literal
   `"toon.planVisited"`, so this is one entry in `storage.ts` plus one read in `SideNav`.
8. **Smaller residue**: `/plan`'s loading skeleton uses the week strip's 4-up shape rather than
   seven rows; a day on `/plan` that already holds an entry has no "plan another" affordance (the
   recipe detail's *Für einen Tag planen* covers creation, and only on desktop); `SideNav` renders
   Profil both as a nav row and as the footer account link; `cards.count` and
   `plan.entry.openRecipe` are orphaned keys; `IngredientList`'s `scaled` prop is dead surface;
   `WeekPlanPanel` renders an `<img>` with no `src` for an image-less recipe (`alt=""` on a
   `bg-surface-2` ground, so it degrades quietly); and the library's phone "Filter" trigger is a
   bare text button under the 44px touch target the rest of the app holds.

`CLAUDE.md` was rewritten for all of this — 16 patch entries, applied and then checked
mechanically against the patch file — and items 2, 3 and 4 are recorded in it as open rather than
stated as satisfied, so the next session does not read a rule the tree contradicts and conclude the
rule is dead.
