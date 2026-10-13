# Rezepte Redesign — grounding + settled decisions

Imported 2026-09-08 from Claude Design project `6b3dfba1-164e-4583-b0cc-f3dafe529cd7`
("Rezepte Redesign"). The artboards are committed verbatim as `design.dc.html`; the
project's own repo mapping is `screen-map.md`.

**This file is the contract.** Every agent working on the redesign reads it before
touching code. It records what the design actually contains, what was decided, and the
repo rules the design must be expressed through. It does NOT restate `CLAUDE.md` — read
that too; the gotchas section there is load-bearing.

---

## 0 — How to read a `.dc.html`

`design.dc.html` is a Claude Design canvas document, not a web page. Two helper files
it imports were read during the import and are **deliberately not committed**, because
nothing in either becomes app code:

| Helper | What it is | What it means for us |
| --- | --- | --- |
| `support.js` | The generated `dc-runtime`. Parses `<x-dc>`, evaluates the `data-dc-script` `DCLogic` class, renders the template through React. | Nothing. Canvas plumbing. |
| `image-slot.js` | A `<image-slot>` web component: a drag-to-fill image placeholder that persists into a `.image-slots.state.json` sidecar. | Nothing. It marks *where an image goes*. |

Canvas syntax → what to build:

| In the artboard | Means |
| --- | --- |
| `<sc-for list="{{ items }}" as="i" hint-placeholder-count="8">` | Repeat the child per item. `hint-placeholder-count` is how many the mock drew — **not** a page size. |
| `{{ i.field }}` | A binding into `renderVals()` at the bottom of the file. That data is the shape the screen needs; map each field to a real DTO field. |
| `<image-slot …>` | The hero image. Lists render `thumbnailUrl()`; detail screens render `imageUrl`. |
| `style-hover="border-color:#dc7051"` | A hover state → a Tailwind `hover:` variant. |
| `width:1440px` / `width:390px` | The two viewports the design was drawn at. 390 is the phone budget the layout gotchas in `CLAUDE.md` are measured against. |

**Do not port `sc-for`, `{{ }}`, `image-slot`, `style-hover` or `DCLogic` into the app.**
They are the mock's language. The app's language is React + the existing primitives.

---

## 1 — Artboard inventory (and the hole in it)

| Id | Caption in the file | `data-screen-label` | What the content ACTUALLY is |
| --- | --- | --- | --- |
| `1a` | "Recipe library · desktop 1440" | `Library desktop` | **The recipe DETAIL screen, desktop.** Sidebar + breadcrumb + hero + ingredients card + method column. |
| `1b` | — | — | **Does not exist.** |
| `1c` | "Shopping overview · desktop 1440" | `Shopping overview desktop` | Shopping overview, desktop. Correct. |
| `1d` | "Shopping list · desktop 1440" | `Shopping list desktop` | Shopping list detail, desktop. Correct. |
| `1e` | (mobile row) | `Library mobile` | Recipe library, phone. Correct. |
| `1f` | (mobile row) | `Detail mobile` | Recipe detail, phone. Correct. |
| `1g` | (mobile row) | `Shopping overview mobile` | Shopping overview, phone. Correct. |
| `1h` | (mobile row) | `Shopping list mobile` | Shopping list detail, phone. Correct. |

So there are **seven** artboards for **eight** intended screens, and the missing one is
the desktop recipe library. `screen-map.md` claims `1a/1e Library` + `1b/1f Detail`; that
is stale.

**The desktop library is RECONSTRUCTED, not transcribed.** It is the one screen with no
drawn reference, and it must be assembled from four real sources rather than invented:

1. **`1e` (library mobile)** — the content order: group switcher + `+` action, `Recipes`
   h1, search field with a `Filters` affordance, a "This week" strip with `Plan →`, then
   "All recipes" as editorial rows (84px square thumb · category eyebrow · serif title ·
   `time · servings`).
2. **The unused `renderVals()` data** — `recipes` (6, each with `category`, `desc`,
   `time`, `servings`, `tone`), `week` (7 days, states planned/empty/today, `meta` like
   `"1 h 15 · cooked ✓"`), `recent` (5, each with `when`), `courseFilters`
   (`Hauptspeise 21`, `Beilage 6`, `Dessert 4`, `Suppe 3`), `tagFilters` (8 names).
   All five exist in the script and are rendered by no artboard — they are the desktop
   library's data.
3. **The intro copy** (`#t1`): "Tag clutter: cards show **one** category; tags move to the
   filter rail on the left" · "content spans the full width with a filter rail, planner
   strip and a two-column shopping layout" · "Titles never truncate: editorial rows give
   titles a full line" · "Week planner strip on the library" · "Recently cooked carousel".
4. **The shared desktop chrome** from `1a`/`1c`/`1d` — the 236px sidebar, verbatim.

The "Try next" line (`make 1a a grid instead of rows`) confirms rows, not a grid.

---

## 2 — The palette is already ours; the type is the change

Every colour in the artboards resolves to an existing token in
`apps/web/src/styles/theme.css`. This was verified hex by hex:

| Artboard hex | Existing token (dark) |
| --- | --- |
| `#dc7051` | `--brand` (`--toon-brand-400`) |
| `#eb9d84` | `--brand-hover` (`--toon-brand-300`) |
| `#f6c5b4` | `--brand-soft-fg` (`--toon-brand-200`) |
| `#3b1f13` | `--brand-soft` |
| `#24120a` | `--brand-fg` |
| `#eab54f` | `--accent` (`--toon-accent-400`) |
| `#3a2c0f` | `--accent-soft` |
| `#7ba05b` | `--success` (`--toon-herb-400`) |
| `#26301b` / `#a9c68c` | `--success-soft` / `--success-soft-fg` |
| `#17120f` | `--bg` / `--surface-inset` (`--toon-sand-950`) |
| `#201a15` | `--surface` |
| `#2a221c` | `--surface-2` |
| `#382e26` | `--line` |
| `#4a3d33` | `--line-strong` |
| `#f6ece1` | `--fg` |
| `#b8a693` | `--fg-muted` |
| `#9c8b79` | `--fg-subtle` |
| `#6b5c4b` | `--toon-sand-600` |
| `0 12px 34px -12px rgb(0 0 0 / .7)` | `--elevation-pop` |

**Genuinely new values — these are the only palette additions:**

- `#130f0c` — the sidebar / tab-bar ground, one step below `--bg`. Needs a semantic name
  (e.g. `--bg-sunken`) and a light-mode twin.
- `#e8dccd` — a body-copy tone between `--fg` and `--fg-muted`, used for step text and
  chip labels. Needs a name (e.g. `--fg-body`) and a light twin.
- The recipe `tone` swatches (`#4a3320`, `#2f3a22`, `#3a2b1e`, `#5a3a1a`, `#3a3326`,
  `#5c2e1c`, `#3d4020`, `#3b2a3f`, `#3a4a2a`, `#5a4014`, `#4a3a22`) are **mock
  placeholders for missing photos**, not tokens. In the app that slot is
  `thumbnailUrl()`, with the existing image-less fallback.

**Consequences.** (a) No palette rewrite. (b) Because components reference semantic
tokens and never `dark:` classes, **light mode keeps working for free** — only the two
new tokens need light twins. The design is dark-only and light was never drawn; deriving
the two twins is the whole obligation. (c) The real foundation change is **typography**:

```
--font-display: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, ui-serif, serif;
             -> Newsreader, <same fallbacks>
--font-sans:   <current system stack>
             -> Figtree, <same system stack>
```

Both are self-hosted woff2 (latin + latin-ext subsets) under `apps/web/public/fonts/`,
`font-display: swap`, preloaded in `index.html`, and precached by the service worker.
**Not** a `fonts.googleapis.com` `<link>`: this is an offline-first PWA whose shopping
list has to render at a supermarket till, and a webfont that 404s offline reflows every
screen. Add `woff2` to `globPatterns` in `vite.config.ts` when they land.

Type scale actually used by the artboards, for reference: display serif at 44/46/38/34/30/
28/24/22/21/20/17/15px (weight 500, `line-height` 1.05–1.2, `letter-spacing:-0.01em` on
the largest), sans at 16.5/16/15/14.5/14/13.5/13/12.5/12/11.5/11/10.5px, eyebrows at
10.5–11px `weight:700` `letter-spacing:.06–.08em` `uppercase`, and `font-variant-numeric:
tabular-nums` on every quantity.

---

## 3 — Settled decisions

Seven, all decided by the repo owner during the import. They are settled; do not reopen.

| # | Decision |
| --- | --- |
| D1 | **One branch, phased commits.** Work lands on a `redesign` branch, one commit per phase, reviewed as a single diff at the end. `main` stays clean. |
| D2 | **Design wins on visuals, repo wins on architecture.** Match layout, spacing, type and component shapes exactly; express them through the existing `components/ui` primitives, semantic tokens, theme variables and i18n catalogs. A new primitive only where the design genuinely has no counterpart. |
| D3 | **Where the design contradicts a locked decision in `CLAUDE.md`, the design is the newer decision.** Implement the design and rewrite that `CLAUDE.md` entry — including its rationale — to match. Never silently leave the old rationale standing next to new behaviour. |
| D4 | **Bought state = a log table.** Check-off still DELETEs the item row and bumps `shopping_list_catalog`, and additionally writes a `shopping_bought_items` row. See § 4.3. This is the D3 case that rewrites locked decision 7. |
| D5 | **Category = `tags.kind`.** Add `kind text NOT NULL DEFAULT 'free'` (`'course' \| 'free'`) to `tags`. See § 4.4. |
| D6 | **All screens.** The four designed screens exactly as drawn, plus the shell, plus every remaining screen brought onto the same tokens, type scale and component shapes by extrapolation. The app is never half-redesigned. |
| D7 | **Full planner.** `meal_plan_entries` + endpoints + the library week strip + the shopping overview panel + "Plan for a day" on detail + a `/plan` week screen extrapolated from the design's tokens. See § 4.1. |

---

## 4 — Features the design adds

Seven workstreams. Each names what the artboards show, then the shape it needs.

### 4.1 — Meal planner (`Plan`) — NEW  · D7

**Shown.** A `Plan` item in the desktop sidebar and in the phone tab bar, both carrying a
honey `New` pill in the sidebar. The library "This week" strip: 7 day cards (phone shows
4, `week.slice(3,7)`) in three states — *planned* (`--surface` ground, `--line` border,
`--brand-hover` day label), *empty* (transparent, `--toon-sand-600` label, title `+ Plan`),
*today* (`--brand-soft` ground, `--brand` border). Card content: `MON 1` eyebrow + serif
title + `meta` (`"1 h 15 · cooked ✓"`, `"30 min"`, `"15 min · today"`). A `Plan →` link to
the destination. `Plan for a day` button in the desktop detail header. The shopping
overview's "From this week's plan" panel (§ 4.5).

**Shape.** `meal_plan_entries`: `id`, `group_id` → `groups` (cascade), `recipe_id` →
`recipes` (cascade), `planned_on` (date — store as an integer unix-ms midnight **or** a
`YYYY-MM-DD` text column; pick one and document why), `servings` (integer, nullable →
falls back to the recipe's), `cooked_at` (integer, nullable — what draws `cooked ✓`),
`created_by` → `users`, `created_at`, `updated_at`. Group-owned per locked decision 1.
Index on `(group_id, planned_on)`. Endpoints under `/api/groups/:groupId/plan` with
`requireGroupRole("member")` + `requireVerifiedEmail` on non-GET.

**Watch.** `planned_on` is a *calendar* date in the user's timezone but the server stores
integers in UTC — decide the boundary explicitly and write it down, or "Thursday" drifts.
The `/plan` screen is the one screen with no artboard at all; build it from the day-card
states above plus the shell, and say so in the PR.

### 4.2 — Cook tracking — NEW

**Shown.** A `Cooked` button in the desktop detail header (`--success-soft` ground,
`--success-soft-fg` text, check glyph) and as a 52px square beside `Cook mode` on phone.
A `Last cooked` stat in the detail stat row (`3 days ago`, in `--success-soft-fg`) and
`Cooked · 3 d ago` in the phone 4-up stat grid. A "Recently cooked" carousel on the
desktop library (`renderVals.recent`: 5 entries, each `title` + `when`). `cooked ✓` on a
planner day card.

**Shape.** A log, not a column: `recipe_cook_log` (`id`, `recipe_id` → cascade,
`group_id`, `cooked_by` → `users`, `cooked_at`, `meal_plan_entry_id` nullable). `POST
…/recipes/:recipeId/cooked` appends and, when the recipe is on today's plan, stamps that
entry's `cooked_at`. `lastCookedAt` is a derived field on `RecipeResponse`. A `?sort=
lastCooked` option needs a line in `RECIPE_FILTER_PARAMS` (`router.tsx`) or it is dropped
by `pick()`.

**Watch.** A derived `lastCookedAt` computed per row on the list path is exactly the
mistake the pre-folded search columns exist to prevent — the `total` half of the list
envelope is a `count(*)` that cannot stop early. Join against a grouped max, or
denormalise `recipes.last_cooked_at` and write it from the log. Measure it.

### 4.3 — Bought state + history — NEW · D4 · rewrites locked decision 7

**Shown.** Desktop `1d`: a `To buy` section header with a count, then item rows
(`64px` tabular qty in `--accent` · name + note · a right-aligned `from` provenance label),
then a `Bought today` header in `--success` with a `Clear bought` action, then bought rows
— struck through, `--fg-subtle`, with `who · when` (`"Lena · just now"`, `"Eric · 2 h"`).
Phone `1h`: same two sections as a 2-up grid of tiles, the bought header carrying a `▾`
collapse. Overview `1c`/`1g`: `10 to buy · 4 bought today`, a 6px progress bar at 29%
(`--success` fill), and a `Bought history` panel — `Today / 4 items · Eric`,
`Sat 30 Aug / 17 items · Lena`, `Wed 27 Aug / 6 items · Eric` + an `All` link.

**Shape (D4).**

```
shopping_bought_items
  id                 text pk
  list_id            text not null -> shopping_lists (cascade)
  name               text not null
  quantity           real null          -- NULL = no amount, never 0
  unit               text null
  note               text null
  bought_by          text not null -> users
  bought_at          integer not null
  source_recipe_ids  json null
index (list_id, bought_at desc)

shopping_list_items    UNCHANGED  (no `bought_at`, no partial index)
shopping_list_catalog  UNCHANGED  (still bumped on check-off; still ranks by use_count)
offline outbox         UNCHANGED  (check-off is still a DELETE)
```

**Why this shape.** It keeps all four things that make offline editing safe (see the
`CLAUDE.md` gotcha) untouched: the `(list_id, merge_key)` unique index stays total, so
re-adding a bought item merges normally; the queued mutation stays a delete, so no
persisted outbox entry changes meaning; `mutationId` idempotency covers the log append
because it happens inside the same mutation; and "Häufig gekauft" keeps working off
`use_count`. The alternative — `bought_at` on the item row — needs a *partial* unique
index (`WHERE bought_at IS NULL`) whose support on libSQL's SQLite 3.45.1 is unverified,
and would silently change what a replayed offline delete means.

**Watch.** `Clear bought` must NOT delete log rows the history panel needs — it clears the
*section*, so it needs either a per-list `bought_cleared_at` watermark or a `cleared_at`
stamp on the log rows. Decide and document. Undo of a check-off = re-add from the log
(which may merge); that is the Bring behaviour and is acceptable, but the button has to
say so. `shopping_bought_items` grows forever — prune on write like
`shoppingMutations` does, with a documented TTL.

**`CLAUDE.md` edit required (D3).** Locked decision 7 currently reads "have no `checked`
column" and "Checking an item off DELETES the row and bumps a `shopping_list_catalog`
entry, so it leaves the list and reappears under 'Häufig gekauft' — the Bring behaviour,
chosen deliberately over a flag." That behaviour is *retained*, but the sentence now needs
the second half: the check-off ALSO appends to `shopping_bought_items`, which is what
draws "Bought today" and the history panel, and the reason there is still no flag on the
item row is the merge index + the offline outbox.

### 4.4 — Course / category — NEW · D5

**Shown.** A single uppercase honey eyebrow above every recipe title —
`Hauptspeise · Eintopf`, `Vegan · Pasta`, `Curry & Suppen`, `Auflauf`, `Beilage`,
`Dessert`. A left filter rail on the desktop library splitting `courseFilters` (with
per-course counts) from `tagFilters`. Detail pages keep the full tag line as small
`--fg-subtle` text (`Deutsch · Gemüse · Rind · Schmoren · Sommer · …`).

**Shape (D5).** `tags.kind text NOT NULL DEFAULT 'free'` (`'course' | 'free'`). The
eyebrow is the recipe's `kind='course'` tag; where the mock shows two segments the second
is the first free tag. The rail lists courses with counts and free tags separately.
`scripts/seed.ts` marks the course vocabulary.

**Watch.** The course vocabulary (`Hauptspeise`, `Beilage`, `Dessert`, `Suppe`, `Auflauf`,
…) is **CONTENT**, German-only, and must never be routed through `t()` or made to depend
on the viewer's locale — same rule as `units.ts`. Only the rail's *heading* is interface.
A recipe with no course tag must render without the eyebrow, not with an empty one.

### 4.5 — "From this week's plan" (planner × shopping)

**Shown.** `1c`: a panel titled "From this week's plan", subtitle `3 recipes · 22
ingredients not yet on a list`, three rows (thumb · serif title · `Tue · 9 ingredients` ·
an `Add` action), and `Add all to Einkaufsliste`. `1g`: the same, condensed to three
thumbs + the button.

**Shape.** A read endpoint that diffs the week's planned recipes' ingredients against the
target list's current `merge_key`s and returns per-recipe counts of what is not yet on it,
plus a bulk add. Reuses `POST …/shopping-lists/:listId/recipes` (whose `ingredientIds`
subset is already optional — omitted means the whole recipe, which is what keeps an older
client and a queued offline replay working; do not change that).

**Watch.** "not yet on a list" is computed against ONE list in the mock ("Einkaufsliste").
With several lists per group, define the target explicitly — the default list, or the one
the user last opened.

### 4.6 — Frequently bought, redesigned

**Shown.** `1d` right rail: "Frequently bought", `Show all 24`, then **8** pill chips with
a leading `+`, and the hint "Right-click or long-press a chip to hide it." `1h`: a
horizontal chip row above the add bar. **No per-chip `×`** — that is the stated fix for
"Frequently bought" clutter, and the chips are **alphabetical**, not frequency-ordered.

**Shape.** Select the top 8 by the existing `use_count` ranking, then **display them
alphabetically** (selection and ordering are two different things — say which is which in
the code). Hiding needs a new nullable `hidden_at` on `shopping_list_catalog` plus an
endpoint; a hidden entry is excluded from suggestions but keeps its count. `Show all 24`
opens the full catalog with an unhide affordance.

**Watch.** Alphabetical ordering of German names must fold umlauts the way the rest of the
app does — `foldText()` from `@toon/shared`, not `localeCompare` alone, or `Ä` sorts after
`Z`. Do not add a SQL fold (see the `FOLD_PAIRS` gotcha).

### 4.7 — Shell, nav and counts

**Shown.** Desktop sidebar, 236px, `#130f0c`: logo + `Rezepte` wordmark in the display
serif · a group-switcher button (avatar · name · `2 members · 37 recipes` · chevron) ·
primary nav `Recipes 37` / `Plan [New]` / `Shopping 10` / `Import` · an `Organise` group
label with `Collections` / `Tags` / `Groups` · and a footer user row (avatar · name ·
e-mail · gear). Phone tab bar, 4 tabs: **`Recipes · Plan · Shopping · Profile`**, active
tab drawn as a 44×28 `--brand-soft` pill behind the icon, `Profile` now a user-circle
glyph rather than a gear. Phone library header: group switcher chip + a 40px `--brand`
`+` button.

**Shape + the nav consequence.** `Plan` takes Import's tab. `CLAUDE.md`'s nav rule says
everything not in the phone tab bar must still be reachable from a tab screen — so
**Import moves to the `+` button in the library header**, which is exactly what the
artboard draws: it opens a sheet offering "Neues Rezept" and "Importieren". `NAV_ITEMS`
and `SECONDARY_NAV_ITEMS` (`components/layout/nav-items.ts`) both change, and the
`NavItem["to"]` union has to gain `/plan`. Items keep carrying catalog **keys**, never
labels — resolving at import time freezes the tab bar at whichever locale loaded first.
The sidebar counts (`37`, `10`) need a cheap group summary; do not compute them per
render from a full list fetch.

**Watch.** `/settings` keeps hosting the `GroupsCard` — it is still the only route to
group management on a phone. The wallet stays reachable only through the `CardsCard` panel
on `/shopping` (the design keeps it there, as "Loyalty cards" on the overview and in the
list rail). Deleting either panel orphans a feature on mobile.

---

## 5 — Non-negotiables (the ones this redesign will actually trip over)

Read the `CLAUDE.md` gotchas in full. These are the ones a screen rewrite hits directly:

**Layout, verified in a real browser at 390px — not by reading Tailwind classes.**
- `AppShell`'s `<main>` already applies `mx-auto max-w-5xl px-gutter pt-4 pb-tabbar`. A
  page root must NOT re-apply any of them; page roots are plain `flex flex-col gap-4`.
- Never `px-4 px-safe` on one element. Use `.px-gutter`, set the breakpoint gutter as a
  variable (`lg:[--gutter:2rem]`).
- A bottom action bar uses `.bottom-tabbar`, never `bottom-0` — `BottomTabBar` is
  `fixed … z-30` and paints over it. Prefer `sticky`. The design has such a bar on `1f`
  (Cook mode + Cooked) and `1h` (chips + add bar): both are new instances of this trap.
- A `sticky bottom-*` bar needs an unbroken flex chain and a `flex-1` spacer, or it floats
  mid-screen on a short page. `min-h-full` on the page root is NOT equivalent to `flex-1`.
- `controlClasses` carries `min-w-0`; a `<fieldset>` needs `min-w-0` explicitly. Grid
  tracks holding controls use `minmax(0,1fr)`, never a bare `1fr`. The design's 2-up item
  grid on `1h` and 4-up stat grid on `1f` are both at risk on a 390px screen.
- `block` beats `line-clamp-N`. The design says **titles never truncate** — so the
  editorial rows must drop the clamp, not fight it.
- A list renders `thumbnailUrl()`, never `imageUrl`. The library's 84px squares and every
  planner/plan-panel thumb are list images.
- The list switches markup at `sm` **in JS** (`useIsWideViewport()`), because a
  `display:none` `<img>` is still fetched. Keep that; `SkeletonList`'s `variant` must
  match the branch.
- A header gets ONE overflow trigger (`ActionMenu`), not a row of icon buttons. The
  desktop detail header in `1a` shows three buttons + a `⋯`; the `⋯` is the menu.

**i18n — the typing is the enforcement.**
- Every new string is a key in the `de` catalog **and** its `en` twin. `en` is typed
  `LocaleCatalog<typeof de>`, so a missing key is a *compile* error.
- One key per whole sentence, never per fragment.
- **CONTENT never goes through `t()`**: the course vocabulary, units, ingredient names,
  `parseDuration`, the fold tables, `recipes.language`. `formatDuration(minutes, locale)`
  is interface and takes a locale; `parseDuration` is content and does not.
- Ops output (`console.*`, `env.ts` boot validation, CLI scripts) stays English literals.
- New German copy has no base-tree counterpart, so `i18n:check` parity will flag it. That
  is expected — read the output, never just the exit code.

**Data + offline.**
- New endpoints are excluded from the persisted offline cache until listed in
  `shouldPersistQuery` (`lib/persist.ts`) — it is an allow-list. Planner and bought-history
  reads that must work offline need a line each; bump `PERSIST_BUSTER` if the blob shape
  changes.
- `/api` and `/uploads` stay out of `runtimeCaching` and in `navigateFallbackDenylist`.
  `shopping-lists` and `/api/cards` stay `NetworkOnly`.
- Only the shopping list is editable offline. Do not use `useCanMutate()` on the shopping
  screens (it is false offline); use `useEmailVerificationBlock()`. The cards screens do
  the opposite. Planner writes are online-only — treat them like list create/rename.
- Errors are `{ error: { code, message, details? } }`, `code` from `ERROR_CODES` and never
  renamed. Handlers pass an `ErrorText` key, never a sentence.
- Timestamps: integer unix ms in SQLite, ISO on the wire (`toIso()`). IDs `crypto.randomUUID()`.
- Lists are `{ items, total, limit, offset }`, limit default 24 / max 100.
- Verify DDL through `@libsql/client` (SQLite **3.45.1**), never through `bun:sqlite`
  (3.53). No `GENERATED … STORED`. Migrations add NOT NULL columns with a SQL-level
  `DEFAULT` and back-fill in JS.

**Tests.**
- API tests live in `apps/api/test/`, never `tests/`. `apps/web` is three TS projects;
  `scripts/typecheck.ts` lists them explicitly.
- Prefer an explicit seam (`setMailer`, `setOcrEngine`, `setPdfRasterizer`) over
  `mock.module`, which leaks across files in filesystem order. A file that sets a seam
  hands it back in `afterAll`.
- Pure logic (date maths for the week, alphabetical folding, progress percentages) belongs
  in `packages/shared` with unit tests — not in a route handler or a component.

**Gates.** All five must be clean: `bun install`, `bun run typecheck`, `bun test`,
`bun run build`, `bun run i18n:check`.

---

## 6 — Open items (flag in the PR; do not silently invent)

1. **`Share` on a shopping list** (`1d` header, `1h` header). Undefined. Cheapest honest
   reading: `navigator.share()` of the list as text, no backend. A real share token is a
   new auth surface and is not implied by anything else in the design.
2. **`Sort: newest`** on the shopping list (`1d`). The only sort the mock names. Items
   currently carry `position`. Decide the option set; do not build a sort menu with one item.
3. **"Lena is shopping now"** (`1g` subtitle) and **"synced 2 min ago"** (`1c`). Real-time
   presence is not in this codebase and nothing else in the design needs a socket. Derive
   both from the newest `shopping_bought_items.bought_at` for the group, or drop the
   sentence. Do not add a websocket for a subtitle.
4. **`Bought history` → `All`** (`1c`). Needs a destination screen that was not drawn.
5. **Progress bar semantics.** `29%` with `10 to buy · 4 bought today` is `4/14`. Confirm
   the denominator is "to buy + bought today", not the list's lifetime total.
6. **`+2 more`** on the overview list preview (`1c` shows 8 of 10). Confirm the preview
   size is 8 and that it comes from the list endpoint rather than a full item fetch.

---

## 7 — Decisions settled after the plan was derived (2026-09-08)

The plan's four open items, all resolved in favour of the plan's own defaults. They are
settled; do not reopen.

| # | Decision |
| --- | --- |
| D8 | **`--fg-faint` is `#8d7c67` (dark) / `#7f6f5b` (light), NOT the drawn `#6b5c4b`.** The drawn hex measures 2.88:1 on `--bg` and 2.67:1 on `--surface`, across 24 pieces of 11px/700 copy — under WCAG AA and under the 3:1 large-text floor. One perceptual step up buys 4.61:1 and keeps the five-tier foreground hierarchy distinguishable. This is the one place the implementation knowingly does not match the artboards' colour, and it is one line in `theme.css`. |
| D9 | **Ship `shopping_list_recipes`.** Six columns, additive, cascading from the list, written in `addRecipeToShoppingList` and cleared by `clearShoppingList`, so artboard 1d's "5 von 5 Zutaten · 4 Portionen" rail renders literally. The ingredient total is derivable; the servings chosen at add time is not, because `source_recipe_ids` is per-item and every merge rewrites it. |
| D10 | **Implement the reconstructed desktop library now** rather than waiting for a `1b` artboard. Its five unsourced choices stay tagged `[RECON]` with their reasons, so the PR reviews the reasoning. Only T8.1–T8.3 would be revisited if the artboard is drawn later. |
| D11 | **Ship `/shopping/history`** at the pinned scope: read-only, day-grouped, `offset`-paged, filterable by list, no per-row actions. Artboard 1c draws the `All` link; a bought log is only worth keeping if it can be read back past the panel's three rows. |
