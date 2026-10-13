# `CLAUDE.md` — the proposed patch (D3)

**This is the patch, not the edit.** `T10.3` is the only task allowed to touch `CLAUDE.md`, and this
file is what it applies. Each entry gives the **section**, the **current text quoted exactly** (so
the replacement is mechanical, not interpretive), the **replacement text**, and a short **why** in
the voice of the surrounding file — which explains *why* each decision is what it is, not merely
what it is. A replacement that states only the new behaviour makes `CLAUDE.md` worse.

**D3 governs:** where the design contradicts a locked decision, the design is the newer decision;
implement it and rewrite the entry **including its rationale**, never leaving the old reason
standing beside new behaviour.

**Two kinds of edit, kept visibly apart.** Most entries below are *the design changed this*. Three
are *this was never true* — E4 (`Sammlungen / Tags ← Erweiterte Suche`), E8's `min-h-full` clause,
and E16 (`data-app-shell` was on no element, so printing has always included the nav). Mark the
corrections as corrections in the file itself, or the next reader concludes the app used to work
that way and regressed.

**Sixteen entries.** E1–E13 come from `PLAN.md` §5 and are refined here; E14–E16 are new gotchas the
redesign creates. `PLAN.md` §5's table stays as the index of which entries move; **where the two
differ, this file wins.**

**Entries that must stay VERBATIM** — the rewrite must not drift into them: the OCR/PDF two-flag
split and everything under it; the Dockerfile / compose / `toon-edge` entries; every mail entry
(`trySendMail`, `mailDeliveryOf()`'s three states, "`delivered` ALONE IS NOT 'a mail went out'",
`/password/forgot`'s 204-for-both); the unconfirmed-address read-only gate and "THE TIMESTAMP, NEVER
THE BOOLEAN"; OAuth never auto-linking; `safeNextPath`; `/uploads` signing; the libSQL PRAGMA and
one-serialised-lane entries; the `file::memory:` transaction workarounds; "`FOLD_PAIRS` CANNOT BE
COMPLETED" (only its closing example grows, E13d); "`bun:sqlite` IS A NEWER SQLite"; `shoppingItemKey`'s
U+001F; the barcode encoders and the black-on-white rule; `normalizeBarcodeValue` vs
`checkBarcodeValue`; the card form's format+value pairing; `routes/cards.ts` throwing the raw
`ZodError`; `clientIp()` / `TRUST_PROXY`; the import rate limits; "`skipWaiting` is OFF";
`lib/unsavedWork.ts` is a counter; the language picker's third state; the
`apple-mobile-web-app-status-bar-style` ban; "`mock.module` LEAKS ACROSS TEST FILES"; the three web
TS projects; "`apps/api/tsconfig.json` only includes `test/**`"; `envDir`/`envPrefix`;
`build.sourcemap` is off; and "Verify a phone layout in a real headless browser", which the redesign
only makes more load-bearing.

---

## E1 — Locked decision 1: the four new group-owned tables

**Section:** Locked decisions → 1.

**Current text (exact):**

```
1. **Groups own the content.** Recipes, tags, collections and import drafts belong to a `group`, not
   a user. Roles `owner > admin > member`. A user can be in many groups; the UI has an active-group
   switcher; `users.active_group_id` persists the choice.
```

**Replacement:**

```
1. **Groups own the content.** Recipes, tags, collections, import drafts, **meal-plan entries, the
   recipe cook log, the bought-item log and the list↔recipe join** belong to a `group`, not a user.
   Roles `owner > admin > member`. A user can be in many groups; the UI has an active-group
   switcher; `users.active_group_id` persists the choice. The four tables the redesign added are
   group-owned for the same reason the first four are: a flatshare's week, its cooking history and
   its shopping are shared property, so **any member may plan, unplan, mark cooked and check off
   anything** — the same rule `updateShoppingList` already applies to renaming a list, and the
   reason none of the new endpoints calls `assertCanModifyOwned`. **Decision 11 (cards belong to the
   USER) is still the ONLY exception**, and adding four tables here does not widen it: a loyalty
   barcode is personal property that earns money, a meal plan is not.
```

**Why.** The enumeration is the thing people copy when they add a table, so an incomplete list is
how a per-user `meal_plan_entries` gets written. Naming decision 11 as still-the-only-exception in
the same breath is what stops the growth from reading as a precedent.

---

## E2 — Locked decision 2: the two desktop measurements

**Section:** Locked decisions → 2.

**Current text (exact):**

```
2. **One React PWA**, responsive mobile-first. No React Native, no Capacitor. Bottom tab bar on
   phones, sidebar from `lg`. Photo capture via
   `<input type="file" accept="image/*" capture="environment">`.
```

**Replacement:**

```
2. **One React PWA**, responsive mobile-first. No React Native, no Capacitor. Bottom tab bar on
   phones, sidebar from `lg`. Photo capture via
   `<input type="file" accept="image/*" capture="environment">`.
   The desktop chrome has two measurements and **they must always change together**: the sidebar is
   236px (`--spacing-sidebar`, used as `w-sidebar` on `SideNav` and `lg:pl-sidebar` on `AppShell`'s
   inner column) and the content column caps at 1204px (`--container-content`, `max-w-content` on
   `<main>`). Both live in `index.css`'s `@theme inline`, not in `theme.css` — they are Tailwind
   scales, not colours. A mismatch between the two either overlaps the content or leaves a strip of
   `--bg` beside the sidebar, and neither is visible in a phone screenshot.
```

**Why.** The pair is a single invariant expressed in two files, and the failure mode is a silent
1440px-only artefact. Recording the numbers next to the decision they belong to means nobody has to
grep two stylesheets to find out what "the sidebar" is.

---

## E3 — Navigation: the tab set, the sidebar order, and the union

**Section:** `## Navigation (four tabs, and what is deliberately NOT one)` — the table and the two
lines above it.

**Current text (exact):**

```
| | |
| --- | --- |
| Tabs | Rezepte `/` · Einkauf `/shopping` · Importieren `/import` · Profil `/settings` |
| Sidebar-only | Gruppen `/groups` · Sammlungen `/collections` · Tags `/tags` |
```

**Replacement:**

```
| | |
| --- | --- |
| Tabs | Rezepte `/` · Plan `/plan` · Einkauf `/shopping` · Profil `/settings` |
| Sidebar-only | Sammlungen `/collections` · Tags `/tags` · Gruppen `/groups` |
```

and immediately after the table, before "**There is no sidebar below `lg`**", insert:

```
**Plan took Import's tab, and that is the trade.** A meal plan is a daily destination; importing a
recipe is something you do a handful of times and then not again for weeks, so it does not earn one
of four slots on a phone. `NavItem["to"]` therefore **gained `/plan` and LOST `/import`**, and
`/import` is now reached the way the artboards draw it — see the third bullet below. The active tab
is a 44×28 `--brand-soft` pill behind the icon and Profil is a user-circle glyph (`CircleUser`), not
a gear: the tab is a person, not a settings screen. `SECONDARY_NAV_ITEMS` is Sammlungen / Tags /
Gruppen **in that order**, which is the artboard's "Organisieren" group; the order is copy, not
taste, so do not re-sort it alphabetically.
```

**Why.** The table is the file's only statement of what the app's navigation *is*, and the
Import-for-Plan swap is the one nav change a future session is most likely to try to undo (it looks
like an omission). Saying why importing does not earn a tab is what makes the swap defensible
without re-reading the design.

---

## E4 — Navigation: `Sammlungen / Tags` — a CORRECTION, and now enforced

**Section:** `## Navigation` → the reachability bullet list.

**Current text (exact):**

```
- **Sammlungen / Tags** ← the "Erweiterte Suche" panel on `/`.
```

**Replacement:**

```
- **Sammlungen / Tags** ← the "Sammlungen verwalten" / "Tags verwalten" links in the library's
  filter surfaces: `RecipeFilterRail` at `lg` and `RecipeFilterSheet` below it.
  **[CORRECTION — this line was FALSE, not changed.]** Before the redesign it named the
  "Erweiterte Suche" panel, which offered a collection filter `Select` and tag filter chips and no
  links at all: `grep` found no `to="/tags"` outside `nav-items.ts` and no `to="/collections"`
  outside `CollectionDetailPage`, so both screens were **unreachable on a phone** for as long as
  the sidebar-only decision has existed. The sentence is true now because those two links exist.
  **They are the enforcement, not a description** — a future refactor of the filter sheet may not
  drop them, and there is no other phone route to either screen.
```

**Why.** A rule that describes a mechanism which does not exist is worse than no rule: it makes the
next person believe the reachability invariant is satisfied. Marking it as a correction, and saying
the links *are* the enforcement, is what turns the sentence into something a refactor can violate
and a reviewer can catch.

---

## E5 — Navigation: a new bullet for `/import`, and the rule now names three mechanisms

**Section:** `## Navigation` → the reachability bullet list, after the `Karten` bullet.

**Current text (exact)** — the list ends with:

```
- **Karten** (`/shopping/cards`) ← the `CardsCard` panel on `/shopping`. It is not a tab and not in
  `SECONDARY_NAV_ITEMS` at all, so that panel is the ONLY route to the wallet on a phone.
```

**Replacement** — keep that bullet verbatim and add one after it:

```
- **Importieren** (`/import`) and **Neues Rezept** (`/recipes/new`) ← the 44px `--brand` `+` in the
  library header, which opens a `LibraryCreateMenu` sheet (`ActionMenu`, so Escape, the focus trap
  and the scroll lock come free) offering both. That sheet is the **ONLY** phone route to either,
  now that Import has lost its tab and `TopBar` — which carried the old `+` — is deleted. Same shape
  of rule as `CardsCard` and `GroupsCard`: **deleting the trigger orphans two create paths**, and
  because the sheet is hidden (not disabled) while `useEmailVerificationBlock()` is set, an
  unconfirmed account correctly sees no create affordance at all rather than a dead button.
  `/import` remains a declared route: the PWA manifest's `shortcuts` entry and shared deep links
  point at it.

So the reachability rule now names **three** mechanisms, not two: a `/settings` card
(`GroupsCard`), a panel on a tab screen (`CardsCard`, the filter links), and the library's `+`
sheet.
```

**Why.** The existing list is the checklist someone runs before deleting a component. `/import` was
a tab, so nothing in the file ever had to say how it was reached; after the swap the `+` is a single
point of failure for two screens and it needs to be on that checklist by name.

---

## E6 — Conventions → Timestamps: the one calendar-date exception

**Section:** `## Conventions` → the IDs / Timestamps bullet.

**Current text (exact):**

```
- **IDs** `crypto.randomUUID()`. **Timestamps** integer unix ms in SQLite, ISO strings on the wire
  (`toIso()`).
```

**Replacement:**

```
- **IDs** `crypto.randomUUID()`. **Timestamps** integer unix ms in SQLite, ISO strings on the wire
  (`toIso()`). **One column is deliberately not an instant: `meal_plan_entries.planned_on` is
  `text` holding `YYYY-MM-DD`.** A plan entry is a **calendar date**, and the calendar is the
  **user's** — so the server never derives one. A date read off an instant in a UTC container is a
  day out for two hours every night against Europe/Berlin, and local-time day arithmetic lands on
  23:00 the previous day across a spring-forward boundary; both bugs are invisible in a test that
  runs at midday. Lexicographic order on `YYYY-MM-DD` is chronological, so
  `meal_plan_entries_group_date_idx` serves the range scan and the `ORDER BY` with no conversion,
  and the value is legible in the DB. The client computes every date string from the device's local
  calendar through **`packages/shared/src/calendar.ts`** — the only place that conversion lives —
  and sends it (`plannedOn`, `from`, `to`); `plannedOn` goes to the wire **verbatim**, because
  `toIso()` would hand the client a `T00:00:00.000Z` it mis-renders west of Greenwich. Every actual
  instant the redesign added — `cooked_at`, `bought_at`, `bought_cleared_at`, `hidden_at` — stays
  integer unix ms with `toIso()`/`toIsoOrNull()`. The one endpoint tempted to guess is the cook
  endpoint: it stamps a plan entry only when the client names one (`mealPlanEntryId`) or names a
  date (`plannedOn`), and otherwise stamps nothing.
```

**Why.** This is an *extension* of the convention, not an overturning of it, and it has to read that
way or the next new column becomes a second text date "for consistency". The two named failure modes
are what justify the exception; without them the entry sounds like a preference.

---

## E7 — Locked decision 7: the shopping list's second half

**Section:** Locked decisions → 7.

**Current text (exact)** — the whole of decision 7, so the edit needs no line splicing. The last
seven lines come back **verbatim** in the replacement; only the first four change and the four new
paragraphs are appended:

```
7. **Shopping lists are group-owned, merge by `(name, unit)` and have no `checked` column.**
   Several named lists per group. Checking an item off DELETES the row and bumps a
   `shopping_list_catalog` entry, so it leaves the list and reappears under "Häufig gekauft" — the
   Bring behaviour, chosen deliberately over a flag. Adding merges: the unique index on
   `shopping_list_items(list_id, merge_key)` turns 200 g + 200 g Mehl into one 400 g line. Amounts in
   units with no fixed ratio (`EL`, `Dose`) never merge across units, and an amount-less line never
   merges with a measured one. **This is the ONE feature that is editable offline** (see the gotcha).
   `POST …/shopping-lists/:listId/recipes` takes an optional `ingredientIds` subset — OMITTED means
   the whole recipe, which is what keeps an older client and a queued offline replay working. Unknown
   ids are ignored, never rejected, for the same reason. `AddRecipeToListDialog` ticks every
   ingredient by default and tracks the EXCLUDED set, so a recipe that gains a line stays all-on.
```

**Replacement:**

```
7. **Shopping lists are group-owned, merge by `(name, unit)`, have no `checked` column, and log
   every check-off.** Several named lists per group. Checking an item off DELETES the row, bumps a
   `shopping_list_catalog` entry **and appends a `shopping_bought_items` row** (D4) — so the item
   leaves the list, reappears under "Häufig gekauft", **and** draws "Heute gekauft" and the bought
   history. The Bring behaviour is retained; the log is what the redesign added.
   Adding merges: the unique index on
   `shopping_list_items(list_id, merge_key)` turns 200 g + 200 g Mehl into one 400 g line. Amounts in
   units with no fixed ratio (`EL`, `Dose`) never merge across units, and an amount-less line never
   merges with a measured one. **This is the ONE feature that is editable offline** (see the gotcha).
   `POST …/shopping-lists/:listId/recipes` takes an optional `ingredientIds` subset — OMITTED means
   the whole recipe, which is what keeps an older client and a queued offline replay working. Unknown
   ids are ignored, never rejected, for the same reason. `AddRecipeToListDialog` ticks every
   ingredient by default and tracks the EXCLUDED set, so a recipe that gains a line stays all-on.
   **There is still no flag on the item row, and the reason is now two-part.** (a) The
   `shopping_list_items(list_id, merge_key)` unique index must stay **TOTAL**, so a re-added bought
   item merges normally; a `bought_at` column on the item row would need a *partial* unique index
   (`WHERE bought_at IS NULL`) whose support on libSQL's SQLite 3.45.1 is unverified. (b) A
   persisted offline outbox entry must keep meaning **"delete this row"** — a dehydrated `v2`
   mutation replayed against a flag-based schema would silently mean something else. Two supporting
   facts: the log append is bound to the check-off's `DELETE … RETURNING` **actually removing a
   row**, not to the request arriving, which is what makes it exactly-once with a `mutationId`,
   without one, and under two members checking the same item simultaneously (the same gate fixes a
   pre-existing double `use_count` bump); and `RETURNING` on DELETE needs SQLite ≥ 3.35, so verify
   it through `@libsql/client`, never `bun:sqlite`.
   **`Gekauftes leeren` clears the SECTION, never the log**: `shopping_lists.bought_cleared_at` is a
   watermark — one integer, one O(1) write, and it cannot disagree with itself — reached by
   `POST …/bought/clear`, deliberately not `DELETE …/bought`, which reads as "delete the log". The
   log is pruned on write with a 90-day TTL, the way `shoppingMutations` already is. The copy is
   part of the decision: the confirm says *"aus dieser Ansicht entfernen"*, never "löschen", and the
   action is not styled destructive.
   **"Häufig gekauft" gained a hide, not a delete.** `shopping_list_catalog.hidden_at` (nullable)
   excludes an entry from suggestions while it **keeps its `use_count`**, set and cleared by
   `PATCH …/catalog/:entryId { hidden }` — one endpoint, both directions. The chips are the top 8 by
   `use_count` **displayed alphabetically by folded name**, and that is two separately named
   operations in `@toon/shared` — `selectMostBoughtEntries` then `sortEntriesByFoldedName` — because
   selection and display order are different things and a single `sortBy` silently reverts the
   design's stated fix. The per-chip `×` is gone; `DELETE …/catalog/:entryId` survives as a wire
   contract the UI no longer calls.
```

(The "Adding merges:" paragraph through "…stays all-on." is the original tail, repeated **verbatim**
and in its original position, so the replacement is one whole block. Keep it byte-identical.)

**Why.** SPEC §4.3 asks for exactly this: the behaviour is retained and the sentence needs its
second half. The two-part reason for "still no flag" is the load-bearing part — it is the answer to
the next person who reads "no `checked` column" and thinks a `bought_at` column would be tidier.

---

## E8 — The page-root rule: the value changes, and one clause was never true

**Section:** Gotchas → "A page component must NOT re-apply …".

**Current text (exact):**

```
- **A page component must NOT re-apply `mx-auto max-w-5xl px-gutter pt-4 pb-tabbar`** — `AppShell`'s
  `<main>` already does all four. `ImportReviewPage`'s `PageShell` did, which cost a phone 32px of
  the 390 it has and doubled the bottom padding. Page roots here are plain `flex flex-col gap-4`.
  Ten of them had drifted back to `pb-tabbar` anyway: on the shopping list that stranded the sticky
  add bar a whole tab-bar height above the tab bar. Grep before adding one.
```

**Replacement:**

```
- **A page component must NOT re-apply `mx-auto max-w-content px-gutter pt-4 pb-tabbar`** —
  `AppShell`'s `<main>` already does all four. `ImportReviewPage`'s `PageShell` did, which cost a
  phone 32px of the 390 it has and doubled the bottom padding. Page roots here are plain
  `flex flex-col gap-4`. Ten of them had drifted back to `pb-tabbar` anyway: on the shopping list
  that stranded the sticky add bar a whole tab-bar height above the tab bar. Grep before adding one.
  **The rule survived the redesign; the value did not.** `max-w-5xl` (1024px) could not express a
  single desktop artboard — `1a`'s `minmax(0,1fr) 420px` hero, `1c`'s three columns and `1d`'s
  `minmax(0,1fr) 340px` are all drawn against 1140px of content — so `<main>` now caps at
  `--container-content` (1204px = the 1440px artboards minus the 236px sidebar), which is
  pixel-identical to the artboards at 1440px and stays centred above it rather than stretching
  editorial rows across a 4K monitor. **One addition to the rule:** a screen that is a form or prose
  applies its own `mx-auto w-full max-w-3xl` on its page root, and that is the ONLY cap a page root
  may carry. It is not the forbidden re-apply — the rule is about the shell's four properties, and a
  max-width that is not the shell's own carries no padding. 768px is the measured comfortable form
  width; there is deliberately no `PageColumn` component, because a component carrying only a
  max-width is a component for nothing.
```

and in the **next** gotcha ("A `sticky bottom-*` bar can only be pushed UP…"), delete the
misleading clause. **Current text (exact):**

```
  the page root is `flex-1`, and a `flex-1` spacer sits above the bar. `min-h-full` on the page root
  reads as equivalent and measurably is not — a percentage min-height needs a definite parent height
```

**Replacement:**

```
  the page root is **`flex-1`** — never `min-h-full` — and a `flex-1` spacer sits above the bar.
  `min-h-full` reads as equivalent and measurably is not: a percentage min-height needs a definite
  parent height
```

The clause after it (`and a flex-GROWN item is not one, so Chromium left the root at…`) is unchanged
and still reads correctly. **`AddItemBar`'s own comment claims `min-h-full` was the answer and must
be corrected in the same pass** (T8.6 owns that file) — it contradicted this gotcha two bullets
away, so a reader picked whichever they read first.

**Why.** Only the number moved, so the entry must not be rewritten as if the rule is new; and
`AddItemBar`'s stale comment claiming `min-h-full` was the answer contradicted this very gotcha two
bullets later. Fixing the sentence and the comment in the same pass is what stops a future reader
from picking whichever of the two they happened to read first.

---

## E9 — The `sm` markup branch: the reason changes, the hazard does not

**Section:** Gotchas → "The recipe list switches MARKUP at `sm`, in JS…".

**Current text (exact):**

```
- **The recipe list switches MARKUP at `sm`, in JS, and `sm:hidden` on both is the trap.** A
  `display:none` `<img>` is still fetched, so rendering `RecipeRow` and `RecipeCard` together would
  load every image twice. `useIsWideViewport()` (`lib/viewport.ts`) picks one. The row exists because
  a card leads with a 4:3 image: on a 390 px phone that is ~380 px per recipe, i.e. one recipe per
  screen. `SkeletonList`'s `variant` must match the branch or the list visibly jumps when data lands.
```

**Replacement:**

```
- **The recipe list switches MARKUP at `sm`, in JS, and `sm:hidden` on both is the trap.** A
  `display:none` `<img>` is still fetched, so rendering both trees would load every thumbnail twice —
  24 of them on the first screen. `useIsWideViewport()` (`lib/viewport.ts`, `SM_QUERY =
  "(min-width: 40rem)"`, i.e. **640px, not `lg`**) picks one. **The hazard is unchanged; the reason
  for two trees is not.** `RecipeCard` and `RecipeRow` are both deleted: both breakpoints now render
  `RecipeEditorialRow`, and the branch exists so the desktop row can carry a description while the
  phone row stays compact. The old reason — a card led with a 4:3 image, ~380px per recipe on a
  390px phone, one recipe per screen — is why the card is gone; the design's own "Try next: make 1a
  a grid instead of rows" line is what confirms rows are the decision. `SkeletonList`'s `variant`
  must match the branch (`"editorial"`) or the list visibly jumps when data lands, and the
  `"cards"`/`"rows"` variants are deleted with the components. Note the 640–1024px band renders the
  desktop row with **no sidebar**; that is intended and is what that whole band looks like.
```

**Why.** The hazard sentence is the one that stops someone "simplifying" the branch into
`sm:hidden`, so it stays first and stays intact. Everything after it was justification for a
component that no longer exists, and a stale justification is how a deleted card gets reintroduced.

---

## E10 — `block` beats `line-clamp-N`: titles never truncate at all

**Section:** Gotchas → "`block` beats `line-clamp-N`".

**Current text (exact):**

```
- **`block` beats `line-clamp-N`.** The clamp works by setting `display: -webkit-box`; a `block`
  utility on the same element wins in the cascade and the clamp silently does nothing. Drop `block`,
  and when a breakpoint needs single-line truncation instead use `sm:line-clamp-none sm:block
  sm:truncate` — in that order of intent, since the `sm:` rules are emitted later.
```

**Replacement** (keep the cascade fact verbatim, append):

```
- **`block` beats `line-clamp-N`.** The clamp works by setting `display: -webkit-box`; a `block`
  utility on the same element wins in the cascade and the clamp silently does nothing. Drop `block`,
  and when a breakpoint needs single-line truncation instead use `sm:line-clamp-none sm:block
  sm:truncate` — in that order of intent, since the `sm:` rules are emitted later.
  **A RECIPE TITLE NEVER TRUNCATES AT ALL.** The design's stated fix is that editorial rows give a
  title a full line, so `RecipeEditorialRow`'s `<h3>`, both recipe-detail `<h1>`s and every planner
  day-card title carry **no clamp, no `truncate`, no `overflow-hidden` and no fixed height** — only
  `text-pretty`. The fix for a long German compound title is **removal**, not reordering the
  utilities. A clamp is still legitimate where the text is not a name: `ShoppingItemTile`'s item name
  is `line-clamp-2` with a fixed `min-h` so the 2-up grid stays even (a deliberate deviation from
  the artboard's single line — "Rinderhackfl…" is unreadable at 175px on the one screen whose whole
  job is being read at a shelf), plus the descriptions on `GroupsPage` and `CollectionsPage`.
```

**Why.** The cascade fact is a CSS trap and stays as it is. The new half is a *design* rule that
happens to be implemented by removing utilities, so it belongs next to the trap it will otherwise be
confused with — and naming the one place a clamp was *added* keeps the rule from reading as absolute.

---

## E11 — `useCanMutate()`: a third case, and a new shape of case

**Section:** Gotchas → "`useCanMutate()` must NOT be used on the shopping screens".

**Current text (exact):**

```
- **`useCanMutate()` must NOT be used on the shopping screens.** It returns false when offline, which
  is exactly backwards for the one feature that works offline. Those screens pass `canMutate` and only
  gate *list* create/rename/delete on `isOnline` (those are genuinely online-only, so a list created
  offline never needs a client-side id that queued item mutations would have to be rewritten to).
```

**Replacement:**

```
- **`useCanMutate()` must NOT be used on the shopping screens.** It returns false when offline, which
  is exactly backwards for the one feature that works offline. Those screens take
  `useEmailVerificationBlock()` directly and gate the genuinely online-only writes on `isOnline`:
  *list* create/rename/delete (a list created offline would need a client-side id that queued item
  mutations would have to be rewritten to), **plus `Gekauftes leeren`, catalog hide/unhide and
  "Rezept von der Liste entfernen"**. Undo of a check-off is the opposite: it **is** queued through
  the outbox and carries a `mutationId`, because it re-adds a line that may merge.
  **`/plan` uses `useCanMutate()`** — the cards-screen rule, not the shopping rule: planner writes
  are online-only, so false-when-offline is exactly right. It sits two files from the opposite rule
  and must not be unified.
  **And the recipe detail header carries TWO DIFFERENT GATES ON ONE SCREEN, per button.** `Zur
  Einkaufsliste` keeps `useEmailVerificationBlock()` because it queues offline; `Gekocht` and `Für
  einen Tag planen` take `useCanMutate()` because they are online-only. Do not unify them — the
  existing comment on that screen argues the opposite direction for the other button, so a reader
  who unifies will find a comment agreeing with them. The rule underneath all four cases is one
  sentence: **a queued offline mutation the server will 403 must never enter the outbox**, because it
  can never succeed and queuing it converts "read-only right now" into "your edit was silently
  discarded three days later".
```

**Why.** The entry was a two-case opposition, and the redesign makes it a four-case rule where one
case is *per button on one screen*. Stating the underlying sentence at the end is what lets the next
new screen decide for itself instead of pattern-matching the nearest example.

---

## E12 — `globPatterns`: `woff2` is the opposite case from `wasm`, plus the plan route

**Section:** Gotchas → the barcode entry's `globPatterns` sub-bullet, and the service-worker entry.

**Current text (exact)** — the sub-bullet:

```
  - **The wasm is deliberately NOT precached** (`globPatterns` in `vite.config.ts` lists no `wasm`),
    and `/api/cards` is `NetworkOnly` in the SW for the same reason `shopping-lists` is — its offline
    copy is the persisted TanStack cache.
```

**Replacement** (the `wasm` rationale stays **verbatim**; append):

```
  - **The wasm is deliberately NOT precached** (`globPatterns` in `vite.config.ts` lists no `wasm`),
    and `/api/cards` is `NetworkOnly` in the SW for the same reason `shopping-lists` is — its offline
    copy is the persisted TanStack cache.
    **`woff2` IS precached, and that is the opposite case, not a violation of the same rule.** The
    four self-hosted font files total ~55 KB, are needed by **every** screen and are needed
    **offline** — an unavailable webfont reflows the shopping list at a supermarket till, which is
    the exact failure the offline-first design exists to prevent. `zxing-wasm` is 1.1 MB, one screen,
    once per card, at home, with a connection. The files live in **`apps/web/public/fonts/`** (never
    imported from `src/`, which would emit them to `dist/assets/` with a hash — the glob would still
    match, the build would stay green, and the `/fonts/...` preload would 404 with no error from any
    gate) and the two latin subsets are preloaded in `index.html`. A `fonts.googleapis.com` `<link>`
    is banned for the same offline reason. `middleware/staticWeb.ts` already serves `.woff2` with
    the right content type, and `/fonts/*` falls to its default `public, max-age=86400` — the
    filenames are unhashed, so **re-subsetting a font means renaming the file**.
```

**Current text (exact)** — the service-worker entry's second sentence:

```
  must stay in `navigateFallbackDenylist` and out of `runtimeCaching` — a cached API response would
  be a data-correctness bug.
```

**Replacement:**

```
  must stay in `navigateFallbackDenylist` and out of `runtimeCaching` — a cached API response would
  be a data-correctness bug. `/api/groups/*/shopping-lists`, `/api/cards` **and
  `/api/groups/*/plan`** are `NetworkOnly` for the same reason: each one's offline copy **is** the
  persisted TanStack cache, and a `NetworkFirst` hit would hand TanStack a stale body that looks
  like a fresh success — on the shopping list `onSuccess` then writes it over the optimistic state
  and silently un-ticks items. Note that a `NetworkOnly` rule placed **after** the `NetworkFirst`
  `(recipes|tags|collections)` rule is never consulted, so order in `runtimeCaching` is load-bearing.
  `/plan` is a **navigation** path as well as an API prefix — it must never go in the denylist.
```

**Why.** The `wasm` rationale reads as though it forbade every future glob entry, so the fonts have
to be justified as the mirror-image case rather than an exception. The `dist/assets/` trap is worth
one sentence because it is green in all five gates and broken in production.

---

## E13 — Four enumerations that grow, and two counts

**Section:** four separate gotchas plus the verification gates. Each is an *append*, not a rewrite.

**(a) "Recipe search reads PRE-FOLDED columns"** — add a sibling paragraph:

```
  **`recipes.last_cooked_at` is the SECOND derived-but-stored column, and the same lesson in a new
  place.** It is written by exactly one writer — `services/recipes/cookLog.ts` — and `recipePatch()`
  deliberately cannot touch it, the same rule that keeps `updateUser()` from patching
  `email_verified_at`. It is stored rather than joined because `?sort=lastCooked` through a grouped
  `max()` or a correlated subquery cannot use an index and sorts the whole group in a `TEMP B-TREE`,
  and because `?hasCooked=1` would otherwise put the derivation in the `WHERE` of the `count(*)`
  that cannot stop early. Two differences from the fold columns, both deliberate: it is **nullable**
  and therefore does **not** use the notNull-with-no-drizzle-default trick — "never cooked" is a
  real value, so a forgotten insert cannot make a recipe unfindable — and it is **never**
  `NOT NULL DEFAULT 0`, because 0 is 1970 and would sort a never-cooked recipe as recently cooked.
  SQLite puts NULLs **last** under `DESC`, which is what lets
  `recipes_group_last_cooked_idx (group_id, last_cooked_at, created_at)` serve the order with no
  `is null` leading term — unlike `?sort=rating`, which pays a temp b-tree for exactly that. A
  `GENERATED … STORED` column is not an option on 3.45.1. A cook does **not** bump
  `recipes.updated_at`: a cook is not an edit, and bumping it would reorder `?sort=newest`.
```

**(b) "A LIST never renders `imageUrl`"** — the closing sentence currently reads:

```
  `thumbnailUrl()` in `lib/api.ts` (falls back to `imageUrl`); detail screens keep the big one.
```

Replace with:

```
  `thumbnailUrl()` in `lib/api.ts` (falls back to `imageUrl`). The list surfaces now include the
  library's 84px editorial squares, the planner day cards and the library week strip, the "Aus dem
  Wochenplan" thumbs, the "Kürzlich gekocht" shelf and the list rail's "Rezepte auf dieser Liste"
  rows — `/plan` alone asks for seven at once. **Only the two recipe-detail heroes render
  `imageUrl`**, and they are the only `mediaUrl(imageUrl)` call sites in the app.
```

**(c) The two bottom-bar gotchas** — mechanics unchanged; the enumerations grow. In "A bottom action
bar needs `bottom-tabbar`, never `bottom-0`", append after the entry's last line — the one ending
"before adding a new bar." — the following:

```
  The app now has four such bars: the import review footer and `RecipeForm`'s save bar (the two
  original instances), **the recipe detail screen's `Kochmodus` + `Gekocht` bar** (`1f`, inset — no
  bleed, no `-mb-4`) and **the shopping list's chip row + add bar** (`1h`, `bleed-gutter-inset
  -mb-4`). And `-mx-4` is replaced everywhere by `.bleed-gutter-inset`: `-mx-4` assumes the gutter
  is exactly 1rem, which it is not at `lg` (`--gutter:2rem`) and not on a notched device.
```

**(d) "`FOLD_PAIRS` CANNOT BE COMPLETED"** — after "…do not write a fold in SQL for anything new.":

```
  The redesign's "Häufig gekauft" chips are the concrete example: they are **selected** by
  `use_count` in SQL and **ordered** alphabetically in JS with `foldText()` — two operations,
  deliberately on two sides of the wire — because a SQL fold would need the uppercase twin of every
  accent (the table the parser cannot hold) and `localeCompare` alone sorts `Ä` after `Z`.
```

**(e) Verification gates** — the current line:

```
bun test             # 1058 tests
```

Replace the count with the number from **one real run** of the finished branch, and set
`README.md`'s (which says 934) from the **same** run — the two files already disagree, so
incrementing them independently is how they got there. Same for the precache line
(`115 entries (1359 KiB)`), which the four woff2 change.

**Why.** All four are enumerations people copy from, and an out-of-date list is read as an exhaustive
one. (a) is the exception: it is a full new paragraph, because the *reasoning* for storing a
derivation is the reusable part and a future third derived column should find it here.

---

## E14 — NEW GOTCHA: the palette is declared four times

**Section:** Gotchas — new entry, placed before the `px-4 px-safe` entry (both are `styles/` traps).

**Text to add:**

```
- **THE PALETTE IS DECLARED FOUR TIMES AND THE TWO `[data-theme]` BLOCKS ONLY OVERRIDE WHAT THEY
  NAME.** `apps/web/src/styles/theme.css` has four blocks: `:root` (light), the
  `@media (prefers-color-scheme: dark)` query, `:root[data-theme="light"]` and
  `:root[data-theme="dark"]`. The attribute selectors are specificity `(0,2,0)` and beat both
  `:root` rules — **but only for the tokens they actually define**, so the media query's value
  stands for anything omitted. Measured before the redesign: `[data-theme="light"]` was missing 14
  tokens (every `--accent*`, `--success*`, `--warning*`, `--danger-hover`, `--ring` and all three
  `--elevation-*`) and `[data-theme="dark"]` was missing the three elevations — so "light on a dark
  phone" rendered black 70%-opacity shadows under white cards, and "dark on a light laptop" had no
  card elevation at all. That is the combination nobody checks, and it would have silently killed
  the two `shadow-pop` phone bars the redesign lifts. **Every new token goes in all four blocks**,
  and all four now define the same 39 semantic tokens. Do not delete a block to "simplify" — and do
  not put a Tailwind *scale* here (`--spacing-*`, `--container-*`, `--text-*`, `--radius-*` live in
  `index.css`'s `@theme inline`); this file is colours and elevations only.
```

**Why.** Nothing in `CLAUDE.md` described `theme.css`'s structure, and the failure mode is invisible
in three of the four states. Recording the measurement is what makes "all four blocks" a rule rather
than a style preference.

---

## E15 — NEW GOTCHA: the display family ships one weight, and type comes from the scale

**Section:** Gotchas — new entry, next to E14.

**Text to add:**

```
- **THE DISPLAY FAMILY SHIPS EXACTLY ONE WEIGHT, so `font-display font-semibold` is now wrong
  everywhere.** It was correct for the old Iowan/Palatino stack, and all 26 call sites carried it.
  Newsreader is a **single static `wght=500 opsz=18` instance** declared over
  `font-weight: 400 700` **precisely so a missed site renders the real 500 instead of synthetic fake
  bold** — that range is a safety net, not permission to ask for 600. Use `font-display
  font-medium` plus a `--text-display-*` step. The scale contract, which is the rest of this rule:
  type comes from `--text-control` (13.5px), `--text-item` (15px), the eight `--text-display-*`
  steps and the `.eyebrow` utility, and an arbitrary `text-[13px]` is a review-blocking mistake.
  **`.eyebrow` is deliberately NOT named `.text-eyebrow`**: the hand-written utilities in
  `styles/index.css` are emitted after everything Tailwind generates, so a `text-*`-shaped name
  would silently override a real size utility on the same element — the same cascade trap as
  `.px-safe`. Inputs stay at **≥16px** whatever the artboard drew (the design's 14.5px search field
  and 15px add bar both ship at `text-base`), because `@layer base`'s
  `font-size: max(1rem, 16px)` exists to stop iOS zooming the viewport on focus — which on the
  shopping list also shifts the sticky add bar under the keyboard. And **no arrow, chevron, check or
  ellipsis is ever a text glyph**: `→ ← ✓ ▾` all fall outside both font subsets and render from the
  fallback family or as tofu, so use `lucide-react` (`ArrowRight`, `ArrowLeft`, `Check`,
  `ChevronDown`) with `aria-hidden`.
```

**Why.** `font-semibold` on a serif was correct for years, so every muscle memory in the repo is now
wrong; and the two cascade traps (`.eyebrow`, `.px-safe`) share a cause worth naming once. The glyph
rule belongs here because it is a consequence of subsetting the fonts, not a style choice.

---

## E16 — NEW GOTCHA: reconstructed and extrapolated screens, and the print stylesheet

**Section:** Gotchas — new entry, at the end (next to "Verify a phone layout in a real headless
browser", which it depends on).

**Text to add:**

```
- **THREE SCREENS HAVE NO ARTBOARD, AND THEY WERE DERIVED, NOT INVENTED — do not "correct" them
  back to something that was never drawn.** `docs/redesign/` is the record; read it before
  reshaping any of them. (1) **The desktop recipe library** is *reconstructed*: the design has seven
  artboards for eight intended screens and this is the missing one, assembled from `1e`'s content
  order, the five `renderVals()` datasets no artboard renders (`recipes`, `week`, `recent`,
  `courseFilters`, `tagFilters` — they *are* this screen's data), the intro copy's own claims
  ("content spans the full width with a filter rail, planner strip and a two-column shopping
  layout", "titles never truncate", "tags move to the filter rail"), and the 236px chrome from
  `1a`/`1c`/`1d` verbatim. Five choices inside it have **no** source and are tagged `[RECON]` in
  `docs/redesign/PLAN.md` §7: the 220px rail width, the "Mehr Filter" disclosure, the sort control's
  place in the `h1` row, "Kürzlich gekocht" sitting **above** the infinite "Alle Rezepte" list, and
  the planner day card's meta line. (2) **`/plan`** has no artboard at all; its day cards come from
  the library strip's three drawn states, and its **phone layout is a vertical list of seven day
  rows** rather than the strip's horizontal four — a 132px strip card cannot hold a title that never
  truncates. (3) **`/shopping/history`** is the destination of a drawn `All` link that was never
  drawn itself. For (2) and (3) the PR's 390px and 1440px screenshots **are** the reference.
  **Two consequences.** An empty screen is the *default* on a fresh install, not an edge case: R41
  ships no `tags.kind` and no `last_cooked_at` backfill, so "Kürzlich gekocht" and the week strip
  render **nothing at all** — heading included — until somebody cooks and plans, and that silence is
  deliberate rather than a missing state. And **`--fg-faint` is `#8d7c67`, not the artboard's
  `#6b5c4b`**: the drawn hex measures 2.88:1 on `--bg` across 24 pieces of 11px/700 copy, under both
  WCAG AA (4.5:1) and the large-text floor (3:1). It is the only place the app knowingly does not
  match the artboards' colour, and it is one line in `theme.css`.
- **`features/recipes/print.css` is invisible to all five gates, and it was dead for as long as it
  has existed.** It hides `header[data-app-shell]`, `nav[data-app-shell]`, `aside[data-app-shell]`
  and `[data-print="hide"]` — and until the redesign **no element carried `data-app-shell`**, so
  every print of a recipe included the whole app chrome. `SideNav`'s `<nav>`, `BottomTabBar`'s
  `<nav>` and `PhoneHeaderRow` now carry it, and the phone hero's scrim controls, the segmented
  control and the detail bottom bar carry `data-print="hide"`. Two rules follow. **The phone
  detail screen's two panels must both stay in the DOM**, toggled with the `hidden` attribute rather
  than rendered conditionally — the segmented control shows one at a time, so a conditional render
  means printing from a phone prints the ingredients and not the method, and `print.css` clears
  `[hidden]` inside `.recipe-print` to reveal both. And **verify by printing to PDF from a real
  browser**, at 390px and 1440px: `bun run typecheck`, `bun test`, `bun run build` and
  `bun run i18n:check` all pass with this stylesheet completely broken, which is exactly how it
  stayed broken. `ActionMenu` is a PORTAL outside `.recipe-print` — that is why it closes before
  running an item and defers one `requestAnimationFrame`, or `window.print()` prints the open menu
  over the recipe.
```

**Why.** The reconstruction is the single most likely thing to be "fixed" by a later session that
assumes the artboards showed it — the whole point of naming the four sources and the five `[RECON]`
choices is that a future change can then be argued against a reference. The print entry is the
opposite problem: a feature that has never worked and that no gate can see, so the only defence is
a written instruction to print a page.

---

## Applying this patch

1. Work top to bottom; each entry is independent.
2. **Quote-match before replacing.** If a "current text" block does not match the file byte for
   byte, stop — the file has drifted and the replacement may be wrong.
3. Keep the corrections (E4, E8's second half, E16's print entry) visibly marked as corrections.
4. E13(e) needs a **real run** of the finished branch: set `CLAUDE.md`'s test count and
   `README.md`'s from the same run, in the same commit.
5. Do not touch the VERBATIM list at the top of this file.
