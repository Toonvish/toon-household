# Redesign — the complete i18n key inventory

**Inputs read in full:** `docs/redesign/SPEC.md`, `docs/redesign/PLAN.md`, all six specs under
`docs/redesign/specs/`, `CLAUDE.md`, `docs/i18n.md`, `packages/shared/src/i18n/**`,
`apps/web/src/lib/i18n/**` and every catalog file under `apps/web/src/lib/i18n/catalogs/`.

**What this file is.** The single authoritative list of every catalog key the redesign adds,
changes or deletes, with **both** locale values, grouped by namespace, plus a per-file summary so
an implementer can work one file at a time. It is written for phase 6 (`T6.1`–`T6.3`) and
phase 2 (the `server` namespace), and it is also the reference every phase 7/8/9 screen agent
reads instead of inventing a key.

**What this file is not.** It does not restate the screens. Where it contradicts an area spec or
`PLAN.md`, §14 records the contradiction, the ruling and the reason — nothing is papered over.

**The typing is the enforcement.** `de` catalogs are `as const satisfies NamespaceCatalog<"prefix">`
and each `en` catalog is annotated `LocaleCatalog<typeof theDeCatalog>`, a mapped type over the `de`
keys. A key present in one file and not the other, an extra key, or a plural-vs-string mismatch on
one key is a **compile** error, not a runtime warning. So this inventory must be complete and
symmetric, and it is: every row below carries a `de` value and an `en` value.

---

## 1 — The five authoring rules this inventory obeys

**R-A · One key per whole sentence, never per fragment.** A `·`-joined line, a ternary, or a
sentence split across two JSX lines becomes **one** key with placeholders. A language with
different word order cannot reassemble fragments. Applied below to
`recipes.list.sharedSummary`, `shopping.lists.counts`, `shopping.detail.subtitle`,
`shopping.bought.rowMeta`, `shopping.history.dayMeta`, `recipes.list.rowMeta`,
`recipes.detail.tabs.*` and `plan.day.eyebrow`.

**R-B · One plural axis per entry.** The runtime (`packages/shared/src/i18n/translate.ts`) selects
a plural form from exactly one `count`, and `ValuesFor<E>` derives the required values from the
`other` form. A sentence that needs **two** pluralised numbers therefore cannot be one plural
entry. Two legal shapes, both used below:

1. **Composite count phrases** — the sentence lives in one plain-string key whose placeholders
   receive *already-rendered* self-contained count phrases from their own plural keys. This is not
   fragment assembly: the word order and every separator live in the one sentence key, and each
   count phrase is a complete noun phrase any language can slot in. **The repo already does this:**
   `shopping.delete.confirmDescription` (`"„{name}“ und alle {itemCount} werden gelöscht."`) is
   filled with `t("shopping.list.itemCount", { count })`. Used for
   `recipes.list.sharedSummary`, `shopping.lists.sharedSummary`, `shopping.fromPlan.subtitle`,
   `shopping.fromPlan.rowMeta`, `shopping.history.dayMeta`, `shopping.listRecipe.meta`.
2. **Split into two whole sentences**, each with its own plural axis, rendered as two elements.
   Used for the `ListRecipesPanel` remove dialog (§7.7) because
   *"{removed} werden entfernt. {shared} bleiben …"* cannot agree its verb with a composite
   phrase (`"1 Position werden entfernt"` is wrong German).

**R-C · Text glyphs are never in a key.** `PLAN.md` phase 9 forbids a raw `→ ← ✓ ▾` in the tree
and `T8.3`/`T8.5` say so per component (`an ArrowRight icon, never →`). So every key below carries
**words only**; the arrow, plus, check and chevron are `lucide-react` icons with `aria-hidden`.
This deliberately changes several literals that `specs/04 §11` and `specs/05 §10.8` wrote with the
glyph inline (`Planen →`, `+ Planen`, `+ Neue Liste`, `+ Karte hinzufügen`, `← Alle Listen`,
`gekocht ✓`; `Alle {n} anzeigen` is unaffected). Recorded in §14 (C8).

**R-D · Formatted values are not keyed per phrasing.** Relative times, weekdays, dates, durations,
numbers and percentages come from `Intl` through `apps/web/src/lib/format.ts` — see §3. The design's
`3 days ago` / `just now` / `2 h` / `10 min` / `Last week` produce **no keys at all** beyond the
`ui.time.justNow` that already exists.

**R-E · Content never gets a key.** §4 is the explicit list of strings on these screens that stay
German literals for every viewer.

---

## 2 — Namespace map, and the one new namespace

| # | Namespace | `de` file | `en` file | Redesign delta |
| --- | --- | --- | --- | --- |
| 1 | `auth` | `apps/web/src/lib/i18n/catalogs/auth.de.ts` | `auth.en.ts` | **none** |
| 2 | `recipes` | `…/recipes.de.ts` | `recipes.en.ts` | +38, −1 |
| 3 | `import` | `…/import.de.ts` | `import.en.ts` | **none** |
| 4 | `shopping` | `…/shopping.de.ts` | `shopping.en.ts` | +83, −1 |
| 5 | `groups` | `…/groups.de.ts` | `groups.en.ts` | +9 |
| 6 | `ui` | `…/ui.de.ts` | `ui.en.ts` | +4, −3 |
| 7 | `server` | `packages/shared/src/i18n/catalogs/server.de.ts` | `server.en.ts` | +7 |
| 8 | `cards` | `…/cards.de.ts` | `cards.en.ts` | +1, −1 |
| **9** | **`plan` — NEW** | `…/plan.de.ts` | `plan.en.ts` | **new file pair, 42 keys** |

### 2.1 Registering the new namespace — three edits, and one of them is a test

`apps/web/src/lib/i18n/catalogs/index.ts` is marked **FINAL** ("a port agent extends its own two
namespace files, never this one"). A *new namespace* cannot register itself, so this is the
sanctioned exception (`PLAN.md` §8.2 grants it once, in `T6.1`). Add exactly two imports and two
spread entries, nothing else, and **flag it in the PR** so it is not read as the rule being broken:

```ts
import { planDe } from "./plan.de.ts";
import { planEn } from "./plan.en.ts";
// …
const de = { ...authDe, ...recipesDe, ...importDe, ...shoppingDe, ...cardsDe, ...groupsDe, ...planDe, ...uiDe };
const en = { ...authEn, ...recipesEn, ...importEn, ...shoppingEn, ...cardsEn, ...groupsEn, ...planEn, ...uiEn };
```

**`apps/web/src/lib/i18n/i18n.test.ts:22` hard-codes the prefix list and WILL FAIL without an
edit.** It asserts every key in the merged catalog matches exactly one known prefix:

```ts
const prefixes = ["auth.", "recipes.", "import.", "shopping.", "cards.", "groups.", "ui."];
```

`"plan."` must be added to that array in the same commit. `PLAN.md` `T6.1` says the relevant test
is `packages/shared/test/i18n.test.ts` and that it "must still pass" — that file exists but only
compares the two **server** catalogs' key sets and needs no change; the web-side file is the one
that breaks. Recorded in §14 (correction C1).

The same file's other three assertions constrain every row in this document, and each is satisfied
by construction below:

- `de` and `en` list exactly the same keys → every table has both values.
- every plural entry carries an `other` form in both locales → every plural row spells out `one`
  and `other`.
- **the placeholder set of every key is identical in `de` and `en`, compared on the `other` form
  of a plural** → checked row by row. Where a German `one` form drops `{count}`
  (`"Eine Position wird entfernt."`), the English `one` form drops it too, and both `other` forms
  carry it.

### 2.2 `docs/i18n.md` needs its §9 note (owned by `T10.1`)

§9 says "Exactly seven" and already carries an `[R]` paragraph recording `cards` as the eighth.
Add a sibling paragraph in the same style recording **`plan` as the ninth**, added by the redesign
(D7's `/plan` screen plus the library week strip), owner = whoever owns
`apps/web/src/features/plan/**`, all of its German values NEW copy with no base-tree counterpart.
`specs/06 §7.3` recommended the opposite (no ninth namespace; planner copy under a
`recipes.plan.*` prefix) — overruled, see §14 (C2).

---

## 3 — Formatting: what is rendered, not keyed

All of this lives in **`apps/web/src/lib/format.ts`**, which reads the ambient locale via
`getLocale()` and caches one `Intl` object per locale in a `Map` (constructing a formatter costs
tens of µs and a recipe list formats 24 values). Interface, therefore locale-dependent — the same
split as `formatDuration(minutes, locale)` (interface) vs `parseDuration` (content).

### 3.1 Relative time — already solved, do not key it

`formatRelative(iso)` **already exists** and already returns the design's long forms. Verified
against this repo's Bun/ICU:

| | `de-DE` | `en-GB` |
| --- | --- | --- |
| < 45 s | `gerade eben` (`ui.time.justNow`) | `just now` (`ui.time.justNow`) |
| −10 min | `vor 10 Minuten` | `10 minutes ago` |
| −2 h | `vor 2 Stunden` | `2 hours ago` |
| −3 d | `vor 3 Tagen` | `3 days ago` |
| −1 d | `gestern` | `yesterday` |
| −1 week | `letzte Woche` | `last week` |

So the artboards' `3 days ago`, `just now` and `Last week` need **no new keys**. `PLAN.md` `T6.2`
asks for `gerade eben`, `vor {n} Min.`, `vor {n} Std.`, `vor {n} Tagen` as catalog keys — **do not
add them** (§14, C3): `Intl.RelativeTimeFormat` produces exactly those strings in both locales with
correct plural rules and the `gestern` / `letzte Woche` special cases that a hand-keyed set gets
wrong, and four hand-written German time phrases are four future parity hits for nothing.

**One addition.** The design's compact `2 h` / `10 min` on bought rows and in the phone stat grid
needs the short style. Add a second cached formatter and one export:

```ts
// in build(): the SHORT relative formatter, next to `relative`.
relativeShort: new Intl.RelativeTimeFormat(intlLocale, { numeric: "auto", style: "short" }),

/** "vor 10 Min." / "vor 2 Std." ("de"); "10 min ago" / "2 hr ago" ("en") */
export function formatRelativeShort(iso: string | null | undefined): string;
```

Same body as `formatRelative`, same `< 45 s → translate("ui.time.justNow")` and same
nullish/`NaN` → `translate("ui.common.dash")` guards. Verified output: `de` `vor 10 Min.` ·
`vor 2 Std.` · `vor 3 Tagen` · `gestern` · `letzte Woche`; `en` `10 min ago` · `2 hr ago` ·
`3 days ago` · `yesterday` · `last wk`. **Use `style: "short"`, not `"narrow"`** — narrow German
renders minutes as `vor 10 m`, which is unreadable.

Consumers: `BoughtSection`'s `{when}`, `shopping.lists.syncedRelative`'s `{relative}`, the phone
detail stat `Gekocht`, `RecentlyCookedShelf`. `formatRelative` (long) stays for the desktop
`Zuletzt gekocht` stat, where there is room.

### 3.2 Three new date formatters

Added to the same memoised `formatters()` builder — never constructed per row:

```ts
/** "So" ("de") / "Sun" ("en") — the day-card eyebrow's weekday. */
export function formatWeekdayShort(iso: string): string;      // { weekday: "short" }
/** "30" — the day-card eyebrow's day number, no separator. */
export function formatDayOfMonth(iso: string): string;        // { day: "numeric" }
/** "So., 30. Aug." ("de") / "Sun 30 Aug" ("en") — the history panel's day header. */
export function formatShortWeekdayDate(iso: string): string;  // { weekday:"short", day:"numeric", month:"short" }
```

`specs/04 §7.5` asks for `formatShortWeekdayDate` by name; `specs/05 §10.7` asks for the other
two. All three are interface and take the viewer's locale, exactly like `formatDuration`.

**The week-range label uses the existing `formatDate`** (`31.08.2026 – 06.09.2026`), per `PLAN.md`
R2's "the week label is `formatDate` of the two bounds". `isoWeekNumber` is deliberately not
implemented (R2), so **`plan.weekNumber` (`"KW {week}"`) from `specs/05 §10.8` is dropped** — no
key, no formatter. A shorter `{ day:"numeric", month:"short" }` range (`31. Aug. – 6. Sept.`) is a
purely presentational refinement and is a separate decision; it is **not** in this inventory.

### 3.3 Day labels vs day buckets

`groupByLocalDay` (`packages/shared/src/calendar.ts`, `T2.1`) returns a `dayKey: PlanDate`. The
**bucket is data**; the **label is interface**: `shopping.history.today` from the catalog when
`dayKey === todayPlanDate()`, otherwise `formatShortWeekdayDate(dayKey)`. Never key a weekday name.

### 3.4 No label maps

`ROLE_LABEL_KEYS` (`features/groups/lib/roleLabels.ts`), `DIFFICULTY_LABEL_KEYS`
(`features/recipes/lib/difficultyLabels.ts`) and `SORT_LABELS`
(`features/recipes/lib/format.ts`) are maps of **catalog keys**, resolved with `t()` at render
time. `SORT_LABELS` gains one line — `lastCooked: "recipes.sort.lastCooked"` — and stays a key map.
Do **not** re-add a `roleLabels`-style map of literals: it freezes at import time and cannot follow
a locale switch. That is why the two old maps were deleted, and the comment in `lib/format.ts`
saying so must stay.

### 3.5 Percentages and counts

`shoppingProgressPercent(toBuy, bought)` (`packages/shared/src/shopping.ts`, `T2.x`) returns an
integer. The only interface part is the `aria-label` sentence — `shopping.lists.progressAriaLabel`,
which is `"Fortschritt: {percent} %"` in German (space before `%`, per DIN) and
`"Progress: {percent}%"` in English. Bare counts next to a content word (the rail's
`Hauptspeise 21`, the sidebar's `Rezepte 37`, `Alle Rezepte {total}`) are numbers rendered with
`tabular-nums` and get **no key**.

---

## 4 — CONTENT: what is deliberately NOT keyed

Getting this backwards is described in `CLAUDE.md` as the most damaging edit available in this
codebase. Every string below appears on a redesigned screen and stays a **German literal for every
viewer**, in both locales, never through `t()`:

| Content string / source | Where it now shows | Why it is content |
| --- | --- | --- |
| The **course vocabulary** — `Hauptspeise`, `Beilage`, `Dessert`, `Suppe`, `Auflauf`, … | the honey eyebrow above every recipe title, the filter rail's `Gänge` list, `/tags`, the recipe form's course field | D5 makes it `tags.kind = 'course'`: it is a **tag name in the group's data**. `SPEC.md §4.4` states it outright, and `specs/02 §4.3`'s `recipeEyebrow()` doc comment repeats it. Only the rail's *heading* is interface. |
| The **second eyebrow segment** (the recipe's first free tag: `Eintopf`, `Pasta`, `Vegan`) | same eyebrow | a user-created tag name. The only interface decision in `recipeEyebrow()` is the `·` separator, identical in both locales. |
| Every **unit** — `g kg ml l EL TL Prise Bund Pck. Stück Dose Portionen` | shopping rows, tiles, ingredient lists, `ListRecipesPanel`'s `4 Portionen`, planner day cards | `packages/shared/src/units.ts`, on the `i18n-check` allow-list. `formatServings`/`formatQuantity` render them verbatim. |
| Every **ingredient and item name** (`Rinderhackfleisch`, `Mehl`, `n. B.`) | to-buy rows, bought rows, chips, `Häufig gekauft`, the add-bar preview | user and seed data. |
| **Recipe section headings** (`Für den Teig`) | ingredient/step lists, cook mode | recipe text. |
| **Recipe titles, descriptions, notes** | everywhere | recipe text. |
| `UNIT_SUGGESTIONS`, the ingredient/step **paste placeholders**, `STEP_HEADING_RE` | the editors (T9.6) | already `i18n-check` false-positive class 3; must not move. |
| `recipes.language` / `draft.language` (`"de"`) | wire only | describes the RECIPE TEXT, never the viewer. Must never be wired to `users.locale`. |
| `parseDuration`, `parseServings`, `foldText`/`FOLD_PAIRS`, `foldSql`, `recipes.*_fold`, `nameKey`/`mergeKey` | parsing + search + merge | content half of the split. `formatDuration(minutes, locale)` is the interface half and takes a locale. |
| `scripts/seed.ts`'s tag names and recipe data, incl. the new `courseTagNames` | seeded groups | seed DATA. Its console output stays **English literals**. |
| The wire `reason` field in an error's `details` (`tesseract_unavailable`, `rasterization_unavailable`) | API only | a machine contract like `code`: never keyed, never translated, never renamed. |
| `"Rezepte"` as the **sidebar wordmark** (`SideNav` row 1) | desktop sidebar | the product name, identical in both locales; `Logo`'s `title` prop already defaults to it. `specs/05 §3.2` says "stays a bare literal, not a catalog key". Note this is a *different string* from `recipes.list.title` (`"Rezepte"`), which is the library's `h1` and IS keyed. |
| **New:** `packages/shared/src/tags.ts` must be added to `ALLOW_LIST` in `scripts/i18n-check.ts` | — | `PLAN.md` R43. Without it, check 2 floods with German course names and false-positive class 3 stops being a closed list a reviewer can eyeball — which is how the real German leak in `services/groups/validation.ts` got through last time. `ALLOW_LIST` already carries `units.ts`, `ingredients.ts`, `numbers.ts`, `text.ts`, `duration.ts`, `seed.ts` for the same reason. |

**One deliberate content-inside-interface case.** If the recipe form's course field ships as a
free-text/combobox rather than a `<Select>` over existing course tags, its example placeholder must
name a German course in **both** locales (`de` `"z. B. Hauptspeise"`, `en` `"e.g. Hauptspeise"`) —
the value the user types is stored German vocabulary, so translating the example to "Main course"
would teach an English-UI user to create a tag that produces no eyebrow. §6.3 ships the `<Select>`
shape, which needs no placeholder; the note stands if that changes.

**Ops output stays English literals and unkeyed**, unchanged by this redesign: `console.*`
everywhere, `apps/api/src/env.ts`'s boot validation, `services/mail/smtp.ts`'s thrown connection
errors, `ConsoleMailer`'s ASCII box, and every CLI in `apps/api/scripts/`. One language in a log is
a feature.

**Import errors are untouched.** `ImportApiError`'s `title`/`hint` stay `ImportErrorText`
(`{ key, values? }` or `{ text }`), `describeError()` keeps returning the same, rendering stays with
`useImportError(error)` / `resolveDescribedError(t, error)` in `lib/importErrorText.ts`, and
`Error.message` keeps holding the KEY. `T9.1` is a restyle only. **This redesign adds no
`ImportErrorText` and no `import.*` key.** If a later change does add one, `passThroughOr()` is
still required for the empty-pass-through case and `test/…/importErrors.test.ts` must assert the new
key exists in BOTH catalogs — `tsc` cannot cover `{ text }`, which is untyped by design.

---

## 5 — `ui` namespace — `apps/web/src/lib/i18n/catalogs/ui.{de,en}.ts` (T6.1)

### 5.1 Added (4)

| Key | `de` | `en` |
| --- | --- | --- |
| `ui.nav.plan` | `Plan` | `Plan` |
| `ui.nav.planNewBadge` | `Neu` | `New` |
| `ui.nav.organiseLabel` | `Organisieren` | `Organise` |
| `ui.sidenav.accountAction` | `Konto und Einstellungen` | `Account and settings` |

- `ui.nav.plan` is the same word in both locales. That is fine and is **not** a missing
  translation — say so in a comment above it, exactly as `cards.de.ts` does for the symbology
  names, so nobody "fixes" it.
- `ui.nav.organiseLabel` is used **twice** in `SideNav` (`specs/05 §3.5`): as the visible eyebrow
  `<span>` and as the second `<nav aria-label>`. One key, two slots, one sentence.
- `ui.sidenav.accountAction` is the footer user row's `aria-label`. The row's *visible* name is the
  user's own name, which does not say where the link goes; the gear is inside the link, not a
  second button (`specs/05 §3.6`).
- **`ui.create.*` is NOT added.** `specs/05 §8` proposed `ui.create.title` /
  `ui.create.triggerLabel` / `ui.create.newRecipeHint` / `ui.create.importHint`, but the component
  is `apps/web/src/features/recipes/components/LibraryCreateMenu.tsx`, so those keys belong to the
  `recipes` namespace (§6.2). `PLAN.md` `T6.2` agrees. A component may freely *read* a `ui.*` key;
  what follows the directory is which catalog **file** gains the key.

### 5.2 Deleted (3) — exactly `PLAN.md` R29's three, no more

| Key | Why it loses its only call site |
| --- | --- |
| `ui.topbar.searchRecipes` | `TopBar` is deleted (`specs/05 §6`); the design draws no magnifier — the library's search field is always visible. |
| `ui.topbar.newRecipe` | `TopBar` is deleted; the `+` moves into the library header and opens a sheet. |
| `ui.sidenav.logout` | The sidebar loses its logout `IconButton` (R34); the footer row links to `/settings`, which has the sign-out card. |

A deletion is **safe to prescribe**: `t()`'s key type is `keyof C & string`, so removing a key that
a component still references is a compile error, not a silent blank. If `tsc` complains, the
deletion was wrong — restore it rather than editing the component.

### 5.3 Kept, and why each one is not orphaned

| Key | Its call site after the redesign |
| --- | --- |
| `ui.nav.import` | the `+` sheet's second item (`PLAN.md` R29 requires this: "`ui.nav.import` is **kept** — the `+` sheet reuses it"). |
| `ui.sidenav.newRecipe` (`Neues Rezept`) | the `+` sheet's first item **and** the desktop library header's primary button (`specs/05 §3.6`: "stays in use … no orphaned key"). |
| `ui.nav.recipes` / `.shopping` / `.profile` / `.groups` / `.collections` / `.tags` / `.mainNavLabel` | `NAV_ITEMS` + `SECONDARY_NAV_ITEMS`, resolved with `t(item.labelKey)` at RENDER time. |
| `ui.time.justNow`, `ui.common.dash` | `formatRelative` **and** the new `formatRelativeShort` (§3.1). |
| `ui.installPrompt.description` | must keep naming the offline deal exactly as today; if the offline story changes, the copy changes in the same commit. |
| `ui.session.*`, `ui.offlineBanner.*`, `ui.updateBanner.*`, `ui.errorState.*`, `ui.actionMenu.triggerLabel`, `ui.dialog.close`, `ui.toast.*`, `ui.spinner.*`, `ui.label.optional`, `ui.confirmDialog.*` | the four banners, `ActionMenu`, `Dialog`, `Toast`, `Spinner`, `ConfirmDialog` — all restyle-only. |
| `ui.skeletonList.loadingRecipes` | `SkeletonList variant="editorial"`. |

`NAV_ITEMS` entries keep carrying `labelKey: MessageKey`, never a translated string. Resolving at
import time freezes the tab bar and the sidebar at whichever locale loaded first — the one rule in
`nav-items.ts` that a refactor keeps trying to break.

**The five new `components/ui` primitives add zero `ui` keys.** `ProgressBar`, `SectionHeader`,
`Stat`/`StatRow`, `Chip` and `Stepper` take ready-to-render strings (`label`, `title`,
`decreaseLabel`, `increaseLabel`) as required props and call no `t()` of their own
(`specs/01 §4.3`). A primitive that invented `ui.progressBar.label` would produce one generic
sentence for a shopping bar and an upload bar. The accessible names come from the calling screen's
own namespace — which is why `shopping.lists.progressAriaLabel` and
`recipes.scaler.decreaseAction` (existing) are where they are.

---

## 6 — `plan` namespace — NEW files `apps/web/src/lib/i18n/catalogs/plan.{de,en}.ts` (T6.1)

Covers `apps/web/src/features/plan/**`: `PlanPage`, `PlanDayCard`, `PlanWeekNav`,
`PlanRecipePicker`, `PlanServingsDialog` **and `WeekStrip`** (the library's four-day strip, whose
file is `features/plan/components/WeekStrip.tsx`).

File shape, matching the eight existing pairs exactly:

```ts
// plan.de.ts
import type { NamespaceCatalog } from "@toon/shared";
export const planDe = { /* … */ } as const satisfies NamespaceCatalog<"plan">;
export type PlanCatalog = typeof planDe;

// plan.en.ts
import type { LocaleCatalog } from "@toon/shared";
import type { PlanCatalog } from "./plan.de.ts";
export const planEn: LocaleCatalog<PlanCatalog> = { /* … */ };
```

**Every value here is new copy with no base-tree counterpart** — the whole file is
`i18n-check` false-positive class 1, exactly like `cards.de.ts`. Put that in the file header, as
`cards.de.ts` does, so the next reader does not go looking for the base-tree original.

### 6.1 Page + week navigation (7)

| Key | `de` | `en` |
| --- | --- | --- |
| `plan.title` | `Wochenplan` | `Meal plan` |
| `plan.weekRange` | `{start} – {end}` | `{start} – {end}` |
| `plan.thisWeek` | `Diese Woche` | `This week` |
| `plan.prevWeek` | `Vorherige Woche` | `Previous week` |
| `plan.nextWeek` | `Nächste Woche` | `Next week` |
| `plan.loading` | `Wochenplan wird geladen` | `Loading meal plan` |
| `plan.offlineHint` | `Planen braucht eine Verbindung.` | `Planning needs a connection.` |

- `plan.weekRange` uses an **en dash** (U+2013) with spaces, not a hyphen. `{start}`/`{end}` are
  `formatDate()` output (§3.2).
- `plan.title` is `"Wochenplan"` while the **nav label** stays `"Plan"` (`ui.nav.plan`). Deliberate:
  a tab bar has ~10 characters, a page heading does not.
- `plan.thisWeek` and `plan.strip.heading` (§6.4) carry the same German word in different slots.
  Two keys, on purpose — one is a button that jumps to the current week, the other a section
  heading, and a translator may want them to diverge.
- `plan.prevWeek` / `plan.nextWeek` are `IconButton` `label`s (`ChevronLeft` / `ChevronRight`).
- `plan.offlineHint` is the `title` on every disabled plan write. Planner writes are online-only
  and `/plan` **does** use `useCanMutate()` — the opposite of the shopping screens.

### 6.2 Day card (6)

| Key | `de` | `en` |
| --- | --- | --- |
| `plan.day.eyebrow` | `{weekday} {day}` | `{weekday} {day}` |
| `plan.day.empty` | `Planen` | `Plan` |
| `plan.day.addAriaLabel` | `Rezept für {day} einplanen` | `Plan a recipe for {day}` |
| `plan.day.today` | `heute` | `today` |
| `plan.day.cooked` | `gekocht` | `cooked` |
| `plan.day.more` | one: `+{count} weiteres Rezept` · other: `+{count} weitere Rezepte` | one: `+{count} more recipe` · other: `+{count} more recipes` |

- `plan.day.eyebrow` is filled with `formatWeekdayShort(date)` and `formatDayOfMonth(date)` and
  rendered through `.eyebrow` (uppercase is CSS, not copy). It is a key rather than a template
  literal in the component because some locales put the number first (R-A).
- **`plan.day.empty` is `"Planen"`, not `specs/05 §10.8`'s `"+ Planen"`** — the `+` is a lucide
  `Plus` icon (R-C). The empty card is a whole `<button>`, so its visible label does not say which
  day; `plan.day.addAriaLabel` does, with `{day}` = `formatShortWeekdayDate(date)`.
- `plan.day.cooked` is `"gekocht"` with a lucide `Check`, never `"gekocht ✓"` (R-C).
- `plan.day.today` / `plan.day.cooked` are lower-case because they are appended to the meta line
  after `formatMinutes(...)` and a `·` separator — matching the mock's `"15 min · today"` and
  `"1 h 15 · cooked ✓"`. **The meta line is composed in the component from those parts**, per
  `T8.3` ("it consumes the raw fields … and composes the meta sentence itself — the API sends no
  pre-composed `meta`"). If a reviewer wants that composition keyed as one sentence, the key is
  `plan.day.meta` = `"{time} · {state}"` — noted, not shipped, because the two suffixes are
  independently optional and a three-way conditional key set costs more than it buys.
- `plan.day.more` is R36's `+N` on the library strip when a day holds several entries.

### 6.3 Empty state, picker, entry menu, dialogs, toasts (27)

| Key | `de` | `en` |
| --- | --- | --- |
| `plan.empty.title` | `Diese Woche ist noch nichts geplant.` | `Nothing is planned for this week yet.` |
| `plan.empty.description` | `Tippe auf einen Tag, um ein Rezept einzuplanen.` | `Tap a day to plan a recipe.` |
| `plan.picker.title` | `Rezept für {day} wählen` | `Choose a recipe for {day}` |
| `plan.picker.search` | `Rezepte durchsuchen` | `Search recipes` |
| `plan.picker.searchAriaLabel` | `Rezepte durchsuchen` | `Search recipes` |
| `plan.picker.empty` | `Keine Rezepte gefunden.` | `No recipes found.` |
| `plan.picker.loading` | `Rezepte werden geladen` | `Loading recipes` |
| `plan.entry.menuLabel` | `Aktionen für {title}` | `Actions for {title}` |
| `plan.entry.openRecipe` | `Rezept öffnen` | `Open recipe` |
| `plan.entry.servings` | `Portionen ändern` | `Change servings` |
| `plan.entry.markCooked` | `Als gekocht markieren` | `Mark as cooked` |
| `plan.entry.move` | `Auf einen anderen Tag verschieben` | `Move to another day` |
| `plan.entry.addToList` | `Zutaten zur Einkaufsliste` | `Ingredients to the shopping list` |
| `plan.entry.remove` | `Vom Plan entfernen` | `Remove from the plan` |
| `plan.servings.title` | `Portionen für {day}` | `Servings for {day}` |
| `plan.servings.reset` | `Rezept-Portionen verwenden` | `Use the recipe's servings` |
| `plan.servings.submit` | `Speichern` | `Save` |
| `plan.move.title` | `„{title}“ verschieben` | `Move “{title}”` |
| `plan.move.dateLabel` | `Neues Datum` | `New date` |
| `plan.move.submit` | `Verschieben` | `Move` |
| `plan.action.cancel` | `Abbrechen` | `Cancel` |
| `plan.toast.planned` | `Eingeplant.` | `Planned.` |
| `plan.toast.moved` | `Verschoben.` | `Moved.` |
| `plan.toast.cooked` | `Als gekocht markiert.` | `Marked as cooked.` |
| `plan.toast.removed` | `Vom Plan entfernt.` | `Removed from the plan.` |
| `plan.toast.failed` | `Konnte nicht gespeichert werden.` | `Could not be saved.` |
| `plan.remove.confirmTitle` | `„{title}“ vom Plan entfernen?` | `Remove “{title}” from the plan?` |

- `plan.picker.search` (placeholder) and `plan.picker.searchAriaLabel` are two keys with the same
  German value on purpose: an `<Input>` needs both, and a placeholder is not an accessible name.
- `plan.entry.remove` is the `ActionMenu` item (`variant: "danger"`);
  `plan.remove.confirmTitle` is the `ConfirmDialog` that guards it. `ConfirmDialog`'s buttons use
  the existing `ui.confirmDialog.confirm` / `.cancel`.
- German quotes are **`„low-high“`** (U+201E / U+201C) and English are **`“…”`** (U+201C / U+201D),
  matching every existing catalog. They are part of the string.
- `{day}` in `plan.picker.title` / `plan.servings.title` is `formatShortWeekdayDate(date)`.
- **Nothing in `plan.*` may contain a German recipe term.** The day cards render recipe titles and
  course eyebrows, which are CONTENT and arrive from the API (`T6.1`'s own gotcha).

### 6.4 The library week strip (2)

| Key | `de` | `en` |
| --- | --- | --- |
| `plan.strip.heading` | `Diese Woche` | `This week` |
| `plan.strip.link` | `Planen` | `Plan` |

`plan.strip.link` renders with a lucide `ArrowRight`, never the literal `→` (R-C, and `T8.3` says
so explicitly). `PLAN.md` `T6.2` assigns `Diese Woche` + the `Plan →` label to the **`recipes`**
namespace; overruled — `WeekStrip.tsx` lives in `features/plan/components/`, and
`docs/i18n.md §9`'s ownership boundary is per directory, so keying it in `recipes` would put a
`recipes.*` key inside a `features/plan` file. Recorded in §14 (C4).

---

## 7 — `shopping` namespace — `apps/web/src/lib/i18n/catalogs/shopping.{de,en}.ts` (T6.3)

The largest delta. Every pre-existing German value in this file **must stay byte-identical** —
umlauts, `„low-high“` quotes, en-dashes, trailing colons and ellipses are part of the string. A
restyled label is **not** new copy; only a key the design actually invents may be new. That
distinction is the whole point of `i18n-check` check 1, and a reworded existing string looks
byte-identical in its output to a genuinely new one.

### 7.1 Overview header + list cards (10 added)

| Key | `de` | `en` |
| --- | --- | --- |
| `shopping.lists.sharedSummary` | `Geteilt mit {group} · {members}` | `Shared with {group} · {members}` |
| `shopping.lists.sharedSummarySynced` | `Geteilt mit {group} · {members} · {synced}` | `Shared with {group} · {members} · {synced}` |
| `shopping.lists.syncedRelative` | `{relative} synchronisiert` | `Synced {relative}` |
| `shopping.lists.shopperActive` | `{name} kauft gerade ein` | `{name} is shopping right now` |
| `shopping.lists.counts` | `{open} offen · {bought} heute gekauft` | `{open} to buy · {bought} bought today` |
| `shopping.lists.openList` | `Öffnen` | `Open` |
| `shopping.lists.previewMore` | one: `+{count} weitere` · other: `+{count} weitere` | one: `+{count} more` · other: `+{count} more` |
| `shopping.lists.progressAriaLabel` | `Fortschritt: {percent} %` | `Progress: {percent}%` |
| `shopping.lists.cardMenuLabel` | `Aktionen für „{name}“` | `Actions for “{name}”` |
| `shopping.lists.allLists` | `Alle Listen` | `All lists` |

- **`{members}` is a composite count phrase** (R-B.1): fill it with
  `t("groups.count.members", { count })`, which already exists and already reads
  `"{count} Mitglieder"` / `"{count} members"`. Two pluralised numbers in one sentence cannot be
  one plural entry.
- **Two whole-sentence variants** rather than one key with a conditional `{synced}` placeholder: a
  key whose placeholder may be empty renders a dangling `·`. Same pattern as
  `shopping.listRecipe.remove.description` vs `…descriptionExclusive`.
- `shopping.lists.syncedRelative`'s `{relative}` is `formatRelativeShort(query.dataUpdatedAt)` —
  `"vor 2 Min. synchronisiert"` / `"Synced 2 min ago"`. **No backend** (R33).
- `shopping.lists.shopperActive` renders **only** when the newest `bought` row is younger than 15
  minutes **and** by someone else; otherwise neither line renders. No websocket, no presence table.
- `shopping.lists.previewMore` is declared as a plural entry even though both German forms are
  identical, so a language with a different rule can diverge without a schema change. Its
  `other` form carries `{count}` in both locales, which is what the placeholder-parity test reads.
- **`shopping.lists.heading` stays `"Einkaufen"`.** `specs/04 §11` wants the design's shorter
  `"Einkauf"` and reports today's value as `"Einkaufslisten"` — it is actually `"Einkaufen"`, the
  `en` value is already `"Shopping"` (which is what the artboard draws), and rewording a one-word
  German heading buys nothing while costing a parity hit indistinguishable from an accident.
- **`shopping.lists.subtitle` stays and is kept in use** as the phone fallback when neither derived
  line renders. Deleting it would leave a first-time phone user with no explanation of the screen.
- `shopping.lists.create` (`"Liste anlegen"`) is **reused** for the design's `+ New list`, with a
  lucide `Plus` (R-C). No new key.

### 7.2 List detail header (10 added)

| Key | `de` | `en` |
| --- | --- | --- |
| `shopping.detail.backToListsShort` | `Listen` | `Lists` |
| `shopping.detail.subtitle` | `{open} offen · {bought} heute gekauft · zum Abhaken antippen` | `{open} to buy · {bought} bought today · tap to tick off` |
| `shopping.detail.subtitleShort` | `{open} offen · {bought} gekauft · zum Abhaken antippen` | `{open} to buy · {bought} bought · tap to tick off` |
| `shopping.detail.share` | `Teilen` | `Share` |
| `shopping.detail.shareCopiedToast` | `In die Zwischenablage kopiert` | `Copied to clipboard` |
| `shopping.detail.shareUnavailableToast` | `Teilen nicht möglich` | `Sharing not possible` |
| `shopping.detail.sort.label` | `Sortierung` | `Sort` |
| `shopping.detail.sort.position` | `Reihenfolge` | `List order` |
| `shopping.detail.sort.newest` | `Neueste zuerst` | `Newest first` |
| `shopping.detail.sort.alpha` | `A–Z` | `A–Z` |

- `shopping.detail.backToLists` (`"Alle Listen"`) already exists and stays for desktop; the mobile
  short form is the new key. Both render with a lucide `ArrowLeft`, never `←` (R-C).
- The two subtitles are **one key each** even though they assemble three clauses — R-A. `{open}`
  and `{bought}` are bare numbers (neither German nor English pluralises `offen` /
  `bought today` here), so no composite phrase is needed.
- Three sort options only (R32), client-side over the already-loaded array, **default
  `position`** — do not build a menu with one item, and do not add a `?sort=` param to the list
  detail (a request-dependent order defeats the "every mutation returns the whole list" contract).
  `shopping.detail.sort.alpha` uses an **en dash** in `A–Z`, matching `recipes.sort.title`.
- `shopping.detail.share` is `navigator.share({ title, text })` of the list as plain text through
  the existing `shareOrCopy` helper, with a clipboard fallback and **no backend** (R40). The two
  toast keys mirror `recipes.detail.shareCopiedToast` / `…shareUnavailableToast` in value; that
  duplication across namespaces is correct — a key belongs to the file whose screen renders it.

### 7.3 Section headers + the bought section (19 added)

| Key | `de` | `en` |
| --- | --- | --- |
| `shopping.toBuy.heading` | `Zu kaufen` | `To buy` |
| `shopping.toBuy.headingWithCount` | `Zu kaufen · {count}` | `To buy · {count}` |
| `shopping.bought.heading` | `Heute gekauft` | `Bought today` |
| `shopping.bought.headingWithCount` | `Heute gekauft · {count}` | `Bought today · {count}` |
| `shopping.bought.collapse` | `Gekauftes einklappen` | `Collapse bought items` |
| `shopping.bought.expand` | `Gekauftes ausklappen` | `Expand bought items` |
| `shopping.bought.clear` | `Gekauftes leeren` | `Clear bought` |
| `shopping.bought.clearConfirm.title` | `Gekaufte Artikel aus dieser Ansicht entfernen?` | `Remove bought items from this view?` |
| `shopping.bought.clearConfirm.description` | `Die Artikel bleiben in der Einkaufshistorie — nur diese Ansicht wird geleert.` | `The items stay in the bought history — only this view is cleared.` |
| `shopping.bought.clearConfirm.confirm` | `Aus der Ansicht entfernen` | `Remove from view` |
| `shopping.bought.clearedToast` | `Ansicht geleert` | `View cleared` |
| `shopping.bought.rowMeta` | `{who} · {when}` | `{who} · {when}` |
| `shopping.bought.you` | `Du` | `You` |
| `shopping.bought.unknownBuyer` | `Unbekannt` | `Unknown` |
| `shopping.bought.buyers` | `{first} +{count}` | `{first} +{count}` |
| `shopping.bought.undo` | `Zurück auf die Liste` | `Back on the list` |
| `shopping.bought.undoMergeHint` | `Wenn „{name}“ schon wieder auf der Liste steht, werden die Mengen zusammengerechnet.` | `If “{name}” is on the list again, the amounts are added together.` |
| `shopping.bought.undoSuccess` | `„{name}“ steht wieder auf der Liste` | `“{name}” is back on the list` |
| `shopping.bought.undoFailed` | `Konnte nicht zurückgelegt werden` | `Could not be put back` |

- **`Gekauftes leeren` is not destructive** (R31): not red, and its confirm says
  *"aus dieser Ansicht entfernen"*, **never** "löschen". `POST …/bought/clear` moves a watermark;
  every log row stays readable by the history panel. The copy is what decides this, which is why it
  is spelled out here.
- `shopping.bought.rowMeta` is one key (R-A). `{who}` is the buyer's first name, or
  `shopping.bought.you` for the viewer's own still-queued check-off (rendered non-interactive at
  `opacity-70`, reading `Du · gerade eben`), or `shopping.bought.unknownBuyer` when
  `boughtBy` is `null` — the column is nullable with `ON DELETE set null` (R17) so a group's
  purchase history survives a member deleting their account. `{when}` is
  `formatRelativeShort(boughtAt)`.
- `shopping.bought.buyers` is the history panel's two-or-more-buyers form (`"Eric +2"`).
- The undo copy is deliberately **not** "Undo": the action re-adds the line, which **may merge**
  with whatever is on the list now (`applyAdditions` folds by `shoppingItemKey`), so undoing a
  bought `500 g Mehl` onto a list that has since gained `200 g Mehl` produces one `700 g` line.
  `shopping.bought.undoMergeHint` is shown in the row's detail/long-press sheet **before** the tap,
  not as a toast, so it is readable while the decision is still open.
- The collapse chevron (`▾` on artboard `1h`) is an `IconButton` with `ChevronDown` and the
  expand/collapse label as its `label` prop — no glyph in the key (R-C).
- `BoughtSection` renders **nothing at all**, `SectionHeader` included, when there are no bought
  entries. So there is no `shopping.bought.empty` key, on purpose.

### 7.4 Frequently bought (9 added, 2 existing kept)

| Key | `de` | `en` |
| --- | --- | --- |
| `shopping.frequentlyUsed.showAll` | `Alle {count} anzeigen` | `Show all {count}` |
| `shopping.frequentlyUsed.hideHint` | `Rechtsklick oder langes Drücken versteckt einen Vorschlag.` | `Right-click or long-press a chip to hide it.` |
| `shopping.frequentlyUsed.hideConfirm.title` | `„{name}“ nicht mehr vorschlagen?` | `Stop suggesting “{name}”?` |
| `shopping.frequentlyUsed.hideConfirm.description` | `Der Vorschlag verschwindet aus „Häufig gekauft“. Über „Alle anzeigen“ kannst du ihn wieder einblenden.` | `The suggestion disappears from “Frequently bought”. You can bring it back from “Show all”.` |
| `shopping.frequentlyUsed.hiddenToast` | `Wird nicht mehr vorgeschlagen` | `No longer suggested` |
| `shopping.frequentlyUsed.showHidden` | `Ausgeblendete anzeigen` | `Show hidden` |
| `shopping.frequentlyUsed.unhide` | `Wieder vorschlagen` | `Suggest again` |
| `shopping.frequentlyUsed.unhiddenToast` | `Wird wieder vorgeschlagen` | `Suggested again` |
| `shopping.frequentlyUsed.addAriaLabel` | `„{name}“ zur Liste hinzufügen` | `Add “{name}” to the list` |

- `shopping.frequentlyUsed.heading` (`"Häufig gekauft"`) is **reused** for the rail heading, the
  phone chip row's accessible name and the `Show all` sheet's title. One sentence, three slots.
- **The existing `shopping.frequentlyUsed.dismissAriaLabel` (`"{name} nicht mehr vorschlagen"`) and
  `…dismissTitle` (`"Nicht mehr vorschlagen"`) are KEPT and re-purposed**, not deleted: the
  per-chip `×` is gone (`SPEC.md §4.6`), but `dismissAriaLabel` becomes the chip's `title`
  attribute — which is what advertises the long-press affordance alongside the visible hint line —
  and `dismissTitle` becomes the `ConfirmDialog`'s confirm-button label. Byte-identical, zero
  parity churn.
- `shopping.suggestion.dismissError` (`"Vorschlag bleibt bestehen"`) stays as the failure toast.
- `showAll` is a plain string, not a plural entry: neither German nor English inflects
  `Alle {n} anzeigen` / `Show all {n}`.
- The **hide** call is `PATCH …/catalog/:entryId { hidden: true }`, both directions (R19), reached
  by long-press / right-click; `showHidden` toggles `GET …/catalog?includeHidden=1` inside the
  `Show all` sheet, which is online-only and not persisted (R20).
- `addAriaLabel` exists because a chip's visible label is a bare item name (`Milch`) and does not
  say what tapping it does. `Chip` takes `label` and has **no** `onDismiss` and no `×` — a dismiss
  slot on the primitive would let the deleted affordance creep back in.

### 7.5 "From this week's plan" (12 added)

| Key | `de` | `en` |
| --- | --- | --- |
| `shopping.fromPlan.title` | `Aus dem Wochenplan` | `From this week's plan` |
| `shopping.fromPlan.recipeCount` | one: `{count} Rezept` · other: `{count} Rezepte` | one: `{count} recipe` · other: `{count} recipes` |
| `shopping.fromPlan.ingredientCount` | one: `{count} Zutat` · other: `{count} Zutaten` | one: `{count} ingredient` · other: `{count} ingredients` |
| `shopping.fromPlan.missingCount` | one: `{count} Zutat noch auf keiner Liste` · other: `{count} Zutaten noch auf keiner Liste` | one: `{count} ingredient not yet on a list` · other: `{count} ingredients not yet on a list` |
| `shopping.fromPlan.subtitle` | `{recipes} · {ingredients}` | `{recipes} · {ingredients}` |
| `shopping.fromPlan.rowMeta` | `{weekday} · {ingredients}` | `{weekday} · {ingredients}` |
| `shopping.fromPlan.addAll` | `Alles auf „{list}“` | `Add everything to “{list}”` |
| `shopping.fromPlan.pickList` | `Andere Liste wählen` | `Choose another list` |
| `shopping.fromPlan.addedToast` | `Auf „{list}“ hinzugefügt` | `Added to “{list}”` |
| `shopping.fromPlan.addFailedToast` | `Konnte nicht hinzugefügt werden` | `Could not be added` |
| `shopping.fromPlan.empty` | `Vom Wochenplan fehlt nichts mehr auf der Liste.` | `Nothing from this week's plan is missing from the list.` |
| `shopping.fromPlan.noList` | `Für den Wochenplan brauchst du erst eine Einkaufsliste.` | `You need a shopping list before you can add the week's plan.` |

- `subtitle` is the desktop panel's `3 Rezepte · 22 Zutaten noch auf keiner Liste`, built from
  `recipeCount` + `missingCount` (R-B.1 — two pluralised numbers). The **mobile** variant is
  `missingCount` **alone**, which is why it is its own complete sentence rather than a fragment.
- `rowMeta` is the per-recipe `Di · 9 Zutaten`: `{weekday}` = `formatWeekdayShort(plannedOn)`,
  `{ingredients}` = `t("shopping.fromPlan.ingredientCount", { count })`.
- The per-row `Add` reuses the existing `shopping.action.add` (`"Hinzufügen"`). No new key.
- `addAll` **names the target list** — the target is the client's choice
  (`storageKeys.lastShoppingListId`, falling back to the alphabetically first list), never a
  server-side default (R9), so the button must say which list it means. `pickList` is the affordance
  when the group has more than one.
- `noList` renders with the existing `shopping.lists.create` action.

### 7.6 Bought history: panel + `/shopping/history` (10 added)

| Key | `de` | `en` |
| --- | --- | --- |
| `shopping.history.title` | `Einkaufshistorie` | `Bought history` |
| `shopping.history.titleShort` | `Historie` | `History` |
| `shopping.history.subtitle` | `Alles, was abgehakt wurde — nach Tag.` | `Everything that was ticked off, by day.` |
| `shopping.history.all` | `Alle` | `All` |
| `shopping.history.today` | `Heute` | `Today` |
| `shopping.history.itemCount` | one: `{count} Artikel` · other: `{count} Artikel` | one: `{count} item` · other: `{count} items` |
| `shopping.history.dayMeta` | `{items} · {who}` | `{items} · {who}` |
| `shopping.history.dayMetaShort` | `{day} · {count}` | `{day} · {count}` |
| `shopping.history.empty` | `Noch nichts gekauft.` | `Nothing bought yet.` |
| `shopping.history.loadMore` | `Mehr laden` | `Load more` |

- `shopping.history.title` serves the desktop panel heading **and** the `/shopping/history` page
  `h1` — one sentence, two slots. `titleShort` is artboard `1g`'s condensed mobile panel.
- `dayMeta` is `4 Artikel · Eric` (R-B.1: `{items}` = `t("shopping.history.itemCount", { count })`,
  `{who}` = one buyer's name or `t("shopping.bought.buyers", { first, count })`).
  `dayMetaShort` is `1g`'s `Sa 30. Aug · 6`.
- The day label itself is **`shopping.history.today` for today, otherwise
  `formatShortWeekdayDate(dayKey)`** — the label is interface, the bucket is a `PlanDate` from
  `groupByLocalDay` (§3.3).
- `shopping.history.all` links to `/shopping/history`; the screen reuses
  `shopping.lists.allLists` (§7.1) as its list filter's "all" option and
  `shopping.detail.backToLists` for its back link.
- The `/shopping/history` **screen file is not assigned to any task** in `PLAN.md` §2 — see §15,
  gap G1. Its keys are inventoried here regardless, because `T6.3` names the screen.

### 7.7 `ListRecipesPanel` + provenance (12 added)

| Key | `de` | `en` |
| --- | --- | --- |
| `shopping.item.sourcesMore` | `aus {name} +{count}` | `from {name} +{count}` |
| `shopping.listRecipe.heading` | `Rezepte auf dieser Liste` | `Recipes on this list` |
| `shopping.listRecipe.ingredientsOf` | `{onList} von {total} Zutaten` | `{onList} of {total} ingredients` |
| `shopping.listRecipe.meta` | `{ingredients} · {servings}` | `{ingredients} · {servings}` |
| `shopping.listRecipe.remove` | `Entfernen` | `Remove` |
| `shopping.listRecipe.addRecipe` | `Zutaten eines Rezepts hinzufügen` | `Add a recipe's ingredients` |
| `shopping.listRecipe.remove.title` | `„{title}“ von der Liste nehmen?` | `Take “{title}” off the list?` |
| `shopping.listRecipe.remove.description` | one: `Eine Position wird entfernt.` · other: `{count} Positionen werden entfernt.` | one: `One item will be removed.` · other: `{count} items will be removed.` |
| `shopping.listRecipe.remove.sharedNote` | one: `Eine Position bleibt, weil sie auch aus einem anderen Rezept kommt — ihre Menge ändert sich nicht.` · other: `{count} Positionen bleiben, weil sie auch aus anderen Rezepten kommen — ihre Mengen ändern sich nicht.` | one: `One item stays because it also comes from another recipe — its amount does not change.` · other: `{count} items stay because they also come from other recipes — their amounts do not change.` |
| `shopping.listRecipe.remove.descriptionExclusive` | one: `Die einzige Position von „{title}“ wird entfernt.` · other: `Alle {count} Positionen von „{title}“ werden entfernt.` | one: `The only item from “{title}” will be removed.` · other: `All {count} items from “{title}” will be removed.` |
| `shopping.listRecipe.removedToast` | `„{title}“ von der Liste genommen` | `“{title}” taken off the list` |
| `shopping.listRecipe.removeFailedToast` | `Entfernen fehlgeschlagen` | `Removing failed` |

- **The remove dialog is three keys, not `specs/03 §4.3`'s one** (R-B.2). A03 asked for
  `"{removed} werden entfernt. {shared} bleiben, weil …"` as a single sentence with two counts;
  the runtime selects a plural form from exactly one `count`, and a composite phrase produces
  `"1 Position werden entfernt"` — wrong German. So: `description` pluralises on the **removed**
  count, `sharedNote` pluralises on the **shared** count, and each is a whole sentence rendered as
  its own `<p>`. When `sharedCount === 0` the dialog renders `descriptionExclusive` alone, which is
  exactly the variant A03 already asked for as its own key. Recorded in §14 (C5).
- The dialog **must** state both counts before the tap: remove deletes what came only from that
  recipe and **keeps merged lines with their quantities unchanged**, because the merge is
  destructive by design and the two contributions are not recoverable. Saying so is the whole point
  of the copy.
- `shopping.listRecipe.remove` doubles as the `ConfirmDialog`'s confirm-button label. No extra key.
- `shopping.listRecipe.meta` is the rail row's `5 von 5 Zutaten · 4 Portionen`:
  `{ingredients}` = `t("shopping.listRecipe.ingredientsOf", { onList, total })`,
  `{servings}` = `formatServingsLabel(servings, servingsUnit)` — whose unit is **CONTENT**
  (`Portionen` comes from `ui.servings.defaultUnit` or the recipe's own German unit). When the join
  row's `servings` is `null`, render `ingredientsOf` **alone** — a complete sentence either way.
  `PLAN.md` `T8.6` requires the literal artboard (`shopping_list_recipes` ships, R10), which is why
  the servings half exists at all; `specs/04 §8.6` recommended dropping it and was overruled.
- `shopping.listRecipe.addRecipe` is the dashed button; the `+` is a lucide `Plus` (R-C). It opens
  the existing `AddRecipeToListDialog`, whose `<fieldset class="min-w-0">` and EXCLUDED-set
  tracking must not be removed.
- `shopping.item.sourcesMore` carries the preposition so it is a whole phrase; the single-source
  case **reuses the existing `shopping.item.sources`** (`"aus {sources}"`) with the recipe title as
  `{sources}`. `specs/03 §4.1` wrote the multi form as bare `"{name} +{count}"` — the `aus`/`from`
  is added so the two states read alike.

### 7.8 Add bar (1 added, 1 deleted)

| Key | `de` | `en` |
| --- | --- | --- |
| `shopping.addItem.placeholderExamples` | `Artikel hinzufügen — „500 g Mehl, 2 Zitronen, Milch“` | `Add an item — “500 g flour, 2 lemons, milk”` |

**Deleted: `shopping.addItem.placeholder`** (`"z. B. 500 g Mehl"`) — `AddItemBar` was its only call
site and both placements now use the longer form. The **em dash** and the `„low-high“` quotes are
part of the German string; the English form uses `“…”`.

Minting a new key and deleting the old one is deliberate rather than editing the value in place:
check 1 compares `de` values fragment-by-fragment against the base commit, so a **changed** value
and a **new** value look identical in its output. A new key plus a deletion reads as an intentional
copy change in the diff; an edited value reads as a possible accident. The same reasoning governs
§8.1 and is the rule to apply to any further value change.

The example words are translated in `en` (`Mehl` → `flour`), following the existing precedent in
this very file (`shopping.editItem.unit.placeholder` = `"g, ml, Stück …"` / `"g, ml, pcs …"`) and in
`recipes.de.ts` (`"Apfelkuchen vom Blech"` / `"Sheet-pan apple cake"`). A placeholder is an
*example of interface input*, not stored vocabulary — unlike the course field's example (§4).

`shopping.addItem.ariaLabel` (`"Artikel hinzufügen"`) is **kept** as the phone bar's 42 px `+`
button label, and `shopping.action.add` (`"Hinzufügen"`) as the desktop labelled button. No new
keys for either.

### 7.9 Kept verbatim, listed so nobody "restyles" the copy

`shopping.detail.allDone`, `shopping.detail.queuedCount`, `shopping.detail.clearList`,
`shopping.detail.offlineBanner`, `shopping.detail.empty.*`, `shopping.clear.*`,
`shopping.create.*`, `shopping.rename.*`, `shopping.delete.*`, `shopping.list.*`,
`shopping.action.*`, `shopping.addRecipe.*`, `shopping.editItem.*`, `shopping.item.*`,
`shopping.lists.rename`, `shopping.lists.delete`, `shopping.lists.offlineHint`,
`shopping.lists.empty.*` — all byte-identical.

`shopping.item.longPressHint` (`"Lange auf eine Karte tippen für Details."`) stays: the phone tile
grid keeps the long-press detail sheet.

---

## 8 — `recipes` namespace — `apps/web/src/lib/i18n/catalogs/recipes.{de,en}.ts` (T6.2)

Same byte-identity rule as §7 for every pre-existing value.

### 8.1 Library (8 added, 1 deleted)

| Key | `de` | `en` |
| --- | --- | --- |
| `recipes.list.searchPlaceholder` | one: `{count} Rezept durchsuchen` · other: `{count} Rezepte durchsuchen` | one: `Search {count} recipe` · other: `Search {count} recipes` |
| `recipes.list.sharedSummary` | `Geteilt mit {group} · {members} · {recipes}` | `Shared with {group} · {members} · {recipes}` |
| `recipes.list.filterAction` | `Filter` | `Filters` |
| `recipes.list.filterActionWithCount` | `Filter · {count}` | `Filters · {count}` |
| `recipes.list.allRecipes` | `Alle Rezepte` | `All recipes` |
| `recipes.list.recentlyCooked` | `Kürzlich gekocht` | `Recently cooked` |
| `recipes.list.rowMeta` | `{time} · {servings}` | `{time} · {servings}` |
| `recipes.list.cookedRelative` | `Gekocht {relative}` | `Cooked {relative}` |

**Deleted: `recipes.filters.searchPlaceholder`** (`"Titel, Beschreibung oder Zutat …"`) —
`RecipeFilters.tsx` is deleted (`T8.2`) and the search field moves into `RecipeListPage` with the
count placeholder above. Same mint-and-delete reasoning as §7.8.
**`recipes.filters.searchAriaLabel`** (`"Rezepte durchsuchen"`) is **kept** and reused by the new
field — a placeholder is not an accessible name.

- `recipes.list.sharedSummary` is the desktop subtitle, one key (R-A) with **two** composite count
  phrases (R-B.1): `{members}` = `t("groups.count.members", { count })`, `{recipes}` =
  `t("groups.count.recipes", { count })`. Both already exist.
- `recipes.list.rowMeta` is the editorial row's `35 Min. · 4 Portionen` — one key, both
  placeholders, filled with `formatMinutes()` and `formatServingsLabel()`. The row's **eyebrow**
  is CONTENT (`recipeEyebrow()`) and its **title** must carry no clamp, no truncate and no fixed
  height.
- `recipes.list.cookedRelative` is the `RecentlyCookedShelf` card's caption; `{relative}` is
  `formatRelativeShort(lastCookedAt)`. `recipes.list.recentlyCooked` doubles as the scroller's
  accessible region name.
- `recipes.list.filterActionWithCount` renders when `countActiveFilters() > 0` (the function is
  preserved and re-exported from the rail module). The mobile trigger is a text button, not an icon.
- `recipes.list.title` (`"Rezepte"`) is reused for the `h1` **and** the desktop detail breadcrumb.
- `recipes.list.groupSummary`, `resultsCount`, `loadMore`, `refreshing`, `empty.*`,
  `importAction`, `newAction` all stay byte-identical and stay in use — see §8.2 for the last two.

### 8.2 The `+` create sheet (3 added)

| Key | `de` | `en` |
| --- | --- | --- |
| `recipes.create.triggerLabel` | `Rezept hinzufügen` | `Add recipe` |
| `recipes.create.newRecipeHint` | `Von Hand eingeben` | `Enter by hand` |
| `recipes.create.importHint` | `Aus URL, Foto oder PDF` | `From a URL, photo or PDF` |

`LibraryCreateMenu` (`features/recipes/components/LibraryCreateMenu.tsx`) is an `ActionMenu`
composed **entirely of existing keys plus these three hints**:

| Slot | Key |
| --- | --- |
| trigger `label` (44 px `--brand` `+` `IconButton`) | `recipes.create.triggerLabel` (new) |
| sheet `title` | `recipes.list.newAction` (existing, `"Neu"`) |
| item 1 label | `ui.sidenav.newRecipe` (existing, `"Neues Rezept"`) → `/recipes/new` |
| item 1 description | `recipes.create.newRecipeHint` (new) |
| item 2 label | `ui.nav.import` (existing, `"Importieren"`) → `/import` |
| item 2 description | `recipes.create.importHint` (new) |

Desktop library header: `recipes.list.importAction` (existing, `"Importieren"`) +
`ui.sidenav.newRecipe` (existing, `"Neues Rezept"`).

**This is what keeps R29's deletion list at exactly three.** `PLAN.md` `T6.2` names a
`recipes.create.newRecipe` key and `specs/05 §8` names four `ui.create.*` keys; either would orphan
`ui.sidenav.newRecipe` and `ui.nav.import`, contradicting R29 and `specs/05 §3.6`'s explicit "no
orphaned key". Recorded in §14 (C6).

This sheet is now the **only** route to `/import` and `/recipes/new` on a phone. It is **hidden**,
not disabled, while `useEmailVerificationBlock()` is set — an `<a>` cannot carry a disabled state or
a tooltip, and `UnverifiedEmailBanner` is what explains the absence.

### 8.3 Filter rail + sheet (6 added)

| Key | `de` | `en` |
| --- | --- | --- |
| `recipes.filters.sheetTitle` | `Filter` | `Filters` |
| `recipes.filters.courseLegend` | `Gänge` | `Course` |
| `recipes.filters.courseAny` | `Alle Gänge` | `All courses` |
| `recipes.filters.moreFilters` | `Mehr Filter` | `More filters` |
| `recipes.filters.manageCollections` | `Sammlungen verwalten` | `Manage collections` |
| `recipes.filters.manageTags` | `Tags verwalten` | `Manage tags` |

- **`recipes.filters.courseLegend` is the rail's HEADING and is interface; the course NAMES inside
  it are CONTENT and never go through `t()`.** This is the single most important line in this
  document. The per-course counts are bare numbers.
- Course is **single-select** because the API forces it (`tagIds` is AND-combined, so two selected
  courses return zero rows every time), hence `courseAny` as the "no course" option.
- `manageCollections` / `manageTags` go in **both** the rail and the sheet (R30). The sheet's copy
  is the **only phone route** to `/collections` and `/tags`, both of which have been unreachable on
  a phone since the sidebar-only decision — `CLAUDE.md`'s claim that the "Erweiterte Suche" panel
  reaches them is false, and this is the D3 correction that makes it true.
- `recipes.filters.tagsLegend`, `tagsEmpty`, `tagsAllRequired`, `sort.label`, `collection.*`,
  `maxDuration.*`, `difficulty.*`, `resultsCount`, `reset`, `advancedToggle` are all **kept
  byte-identical** and move into the rail / the `Mehr Filter` disclosure unchanged.
  `advancedToggle` (`"Erweiterte Suche"`) keeps its call site only if the sheet still uses it;
  if `T8.2` finds it orphaned, delete it in that commit and note it — do not leave dead copy.

### 8.4 Sort (1 added)

| Key | `de` | `en` |
| --- | --- | --- |
| `recipes.sort.lastCooked` | `Zuletzt gekocht` | `Last cooked` |

`SORT_LABELS` in `apps/web/src/features/recipes/lib/format.ts` gains
`lastCooked: "recipes.sort.lastCooked"`. It stays a map of **keys**, resolved with `t()` at render
time — never a map of literals (§3.4). `RecipeSort` gains the wire value `"lastCooked"` in
`packages/shared`; the wire value is locked, only the label lives here. `RECIPE_FILTER_PARAMS` is
**not** touched — `sort` is already listed, so `?sort=lastCooked` survives `pick()`.

### 8.5 Recipe detail (17 added)

| Key | `de` | `en` |
| --- | --- | --- |
| `recipes.detail.planDayAction` | `Für einen Tag planen` | `Plan for a day` |
| `recipes.detail.cookedAction` | `Gekocht` | `Cooked` |
| `recipes.detail.markCookedAriaLabel` | `Als gekocht markieren` | `Mark as cooked` |
| `recipes.detail.cookedToast` | `Als gekocht markiert` | `Marked as cooked` |
| `recipes.detail.cookedUndo` | `Rückgängig` | `Undo` |
| `recipes.detail.cookedUndoneToast` | `Rückgängig gemacht` | `Undone` |
| `recipes.detail.cookedFailedToast` | `Konnte nicht gespeichert werden` | `Could not be saved` |
| `recipes.detail.meta.lastCooked` | `Zuletzt gekocht` | `Last cooked` |
| `recipes.detail.meta.cooked` | `Gekocht` | `Cooked` |
| `recipes.detail.meta.never` | `noch nie` | `never` |
| `recipes.detail.stepCount` | one: `{count} Schritt` · other: `{count} Schritte` | one: `{count} step` · other: `{count} steps` |
| `recipes.detail.addAllToShoppingList` | one: `{count} Zutat zur Einkaufsliste` · other: `Alle {count} Zutaten zur Einkaufsliste` | one: `Add {count} ingredient to shopping` · other: `Add all {count} ingredients to shopping` |
| `recipes.detail.addAllToShoppingListShort` | `Alles zur Liste` | `All to list` |
| `recipes.detail.tabs.ingredients` | `Zutaten · {count}` | `Ingredients · {count}` |
| `recipes.detail.tabs.steps` | `Zubereitung · {count}` | `Method · {count}` |
| `recipes.detail.backAriaLabel` | `Zurück` | `Back` |
| `recipes.detail.planDialogTitle` | `„{title}“ einplanen` | `Plan “{title}”` |

- `recipes.detail.cookedAction` is the desktop header button **and** the phone 52 px square's
  visible/`sr-only` label; `markCookedAriaLabel` is the square's `aria-label`, because a
  check-glyph button needs a verb.
- **Two different mutation gates on one screen, and they must not be unified** (R38):
  `recipes.detail.addToShoppingList` (existing) keeps `useEmailVerificationBlock()` because it
  queues offline; `cookedAction` and `planDayAction` take `useCanMutate()` because they are
  online-only. The `title` on a disabled one comes from `ui.session.offlineSaveBlocked` /
  `ui.session.emailUnverifiedBlocked`, both existing.
- `cookedUndo` is R18's 10-minute, own-row-only undo, offered in the success `Toast`.
- `meta.lastCooked` (desktop, roomy) and `meta.cooked` (phone 4-up grid, 83.5 px per cell) are two
  keys with the same English word in different slots — `specs/04 §11` allowed sharing one; they are
  split so a translator can shorten the phone caption without touching the desktop one.
  `meta.never` is the value when `lastCookedAt` is `null` (`formatRelative*` would render
  `ui.common.dash`, which reads as missing data rather than "not yet").
- `tabs.*` are **one key each** (R-A) — the `·` and the count are part of the label.
- `addAllToShoppingList` is a plural entry whose German `one` form drops the "Alle"; both `other`
  forms carry `{count}`, satisfying the placeholder-parity test.
- `recipes.detail.meta.servings` / `.prep` / `.cook` / `.total` stay **byte-identical in both
  locales** (`Portionen`/`Arbeitszeit`/`Backzeit`/`Gesamt`, `Servings`/`Prep time`/`Cook
  time`/`Total`). The artboard's `Prep` / `Cook` are one word shorter, but at the eyebrow's
  10.5 px/700 the extra word costs nothing and matching a mock's abbreviation is not a product
  requirement.
- `recipes.ingredients.heading` (`Zutaten`) and `recipes.steps.heading` (`Zubereitung` / `Method`)
  already match the artboards — note `1a` says "Method", i.e. `Zubereitung`, **not** `Schritte`.
- `recipes.detail.actionsMenuLabel` + the six `recipes.detail.actions.*` keys stay: the header gets
  **one** overflow trigger (`ActionMenu`) and the three labelled desktop buttons above the title are
  not the trap the gotcha describes.
- The desktop breadcrumb reuses `recipes.list.title`; the separator is markup.

### 8.6 Recipe form: the course field (3 added)

| Key | `de` | `en` |
| --- | --- | --- |
| `recipes.form.course.label` | `Gang` | `Course` |
| `recipes.form.course.none` | `Keine Angabe` | `Not specified` |
| `recipes.form.course.hint` | `Ein Rezept hat genau einen Gang. Alles andere sind Tags.` | `A recipe has exactly one course. Everything else is a tag.` |

- A **single-select** `<Select>` over the group's `kind === "course"` tags plus the `none` option.
  This is where the "one course per recipe" invariant actually lives — no DB constraint enforces it
  (`specs/02 §4.3`).
- The option **labels are the German tag names, rendered verbatim** — CONTENT. Only `label`,
  `none` and `hint` are interface.
- `recipes.form.course.none` duplicates the value of `recipes.form.difficulty.none`
  (`"Keine Angabe"`) on purpose: two fields, two translator decisions.
- It writes `CreateRecipeRequest.course` — a tag **NAME**, not an id — because routing the course
  through `tags` would create it with `kind: 'free'` and silently lose the eyebrow.

### 8.7 Not added

- **No relative-time keys** (§3.1, C3).
- **No key for the eyebrow.** `CourseEyebrow` renders `recipeEyebrow(tags)` and returns `null` when
  there is no course tag — **no element, not an empty one**.
- **No `recipes.plan.*` prefix.** `specs/06 §7.3` recommended putting the planner copy here under
  that prefix; overruled (C2).

---

## 9 — `groups` namespace — `apps/web/src/lib/i18n/catalogs/groups.{de,en}.ts`

Owner per `docs/i18n.md §9`: `features/groups` **plus** `collections` **plus** `tags`. Phase 9
(`T9.2`) needs the `tags.kind` toggle, which is how an existing library adopts the eyebrow — there
is deliberately **no name-matching migration backfill** (R41), so the UI is the only path.

### 9.1 Added (9)

| Key | `de` | `en` |
| --- | --- | --- |
| `groups.tags.kindLegend` | `Art` | `Kind` |
| `groups.tags.kindCourse` | `Gang` | `Course` |
| `groups.tags.kindFree` | `Tag` | `Tag` |
| `groups.tags.kindToggleLabel` | `Art von „{name}“ ändern` | `Change the kind of “{name}”` |
| `groups.tags.kindHint` | `Ein Gang erscheint als Kategorie über dem Rezepttitel. Jedes Rezept hat höchstens einen.` | `A course appears as the category above the recipe title. A recipe has at most one.` |
| `groups.tags.kindChangedToast` | `Art geändert` | `Kind changed` |
| `groups.tags.kindChangeFailedToast` | `Ändern fehlgeschlagen` | `Could not be changed` |
| `groups.tags.sectionCourses` | `Gänge` | `Courses` |
| `groups.tags.sectionFree` | `Tags` | `Tags` |

- `groups.tags.kindFree` is the word "Tag" in both locales — the same word, not a missing
  translation. Comment it like `ui.nav.plan`.
- `sectionCourses` / `sectionFree` are the two `SectionHeader` titles if `/tags` renders the split
  (`specs/05 §12.3`: "if the course/free split is rendered, it is an R6 section header per kind, and
  the course *names* are **CONTENT**").
- **The tag names on `/tags` are CONTENT** — German, never through `t()`. Only the screen's chrome
  and this toggle's labels are interface.
- `groups.tags.namePlaceholder` (`"Vegetarisch"`) stays exactly as it is.

### 9.2 Not added

- The sidebar group-switcher needs **nothing new**: `specs/05 §4.3` confirms the existing
  `t("groups.count.members") · t("groups.count.recipes")` line already *is* the artboard's
  "2 members · 37 recipes". Do not re-key it.
  **Known deviation from R-A, deliberately left alone:** `GroupSwitcher.tsx:53–54` assembles that
  line from two keys joined by a literal `·{" "}` in JSX. It predates the redesign, the word order
  is identical in both locales, and each half is a self-contained count phrase, so the composite is
  R-B.1 with the separator in markup instead of in a key. Converting it would rewrite two working
  German values for no behavioural gain. If it is ever touched, the fix is one
  `groups.switcher.summary` = `"{members} · {recipes}"` key — noted, not shipped.
- `/collections` and `/groups` are restyle-only (`T9.2`, `T9.3`); every existing key stays. The role
  and active-group `Badge`s **stay badges** — status, not category — so no eyebrow keys.
- `InvitePanel` keeps its **three-state** delivery copy exactly as is (`sent` / `not_configured` /
  `failed` from `mailDeliveryOf()`), rendered in three visually distinct ways. A restyle that
  unifies them into one green "Einladung gesendet" is a correctness regression, not a visual one:
  `delivered` alone is not "a mail went out" — `ConsoleMailer` resolves too.

---

## 10 — `cards` and `auth`

### 10.1 `cards` — 1 added, 1 deleted

| Key | `de` | `en` |
| --- | --- | --- |
| `cards.link.panelTitle` | `Treuekarten` | `Loyalty cards` |

**Deleted: `cards.link.title`** (`"Karten"`) — `CardsCard.tsx:43` is its only call site and the
artboard titles that panel "Loyalty cards". Mint-and-delete rather than an in-place value change,
for the auditability reason in §7.8.

`cards.link.description` and `cards.link.action` (`"Karten verwalten"`) stay **byte-identical**;
the artboard's shorter `Manage` is not worth rewording a working German label in a panel that has
the room. `cards.heading` (`"Karten"`) stays as the `/shopping/cards` page `h1`.

**`CardsCard` must keep its `AppLink to="/shopping/cards"`** — it is the only phone route to the
wallet, exactly like `GroupsCard` on `/settings`. Deleting either panel orphans a feature on
mobile.

`specs/05 §12.5` says to keep this title byte-identical and `specs/04 §11` says the design
lengthens it; `PLAN.md` `T6.3` lists `Treuekarten` in the **shopping** inventory. Resolved in §14
(C7): the copy changes, and the key lives in `cards` because `CardsCard.tsx` is in
`features/cards/components/`.

Every other `cards.*` key is untouched, including the seven `cards.format.*` symbology names, which
are **identical in both catalogs on purpose** — they are the labels printed on the physical cards
("EAN-13", "Code 128"), not descriptions, and a user comparing the app to their card has to find
the same string. `BarcodeImage` is exempt from every colour, radius and scaling rule and gains no
keys.

**Deferred (no key minted):** `specs/04 §11` lists a `Barcode zeigen` row inside the shopping list's
right rail. No task in `PLAN.md` creates it (`T8.6`'s file list has no cards component) — see §15,
gap G2. If it ships, the key is `cards.tile.showBarcode` = `"Barcode zeigen"` / `"Show barcode"`
in the `cards` namespace; the existing `cards.tile.show` (`"Karte zeigen"`) stays with the wallet
tile.

### 10.2 `auth` — nothing

`T9.5` is a restyle of `AuthLayout`, the six public screens and `/settings`. No copy changes.
Three existing behaviours the restyle must not touch, because each is a copy-shaped correctness
rule:

- **`EmailVerificationCard` branches on the TIMESTAMP `emailVerifiedAt`, never the boolean.** Every
  pre-flow account is `emailVerified = 1, email_verified_at = NULL`, so a boolean branch shows a
  green checkmark to exactly the users sent to that screen to fix it. It also reports
  `mailDeliveryOf()`'s three states distinctly.
- **`LanguageCard`'s third state is `"system"` and is not a synonym for `de`.** Absent from
  `localStorage` means system; `setLocalePreference("system")` *removes* the key; the
  `languagechange` listener only acts while the preference is `"system"`; the PATCH to
  `users.locale` sends the **resolved** locale, fire-and-forget. Restyle the control, never the
  state model.
- **`auth.settings.language.de` / `.en` are autonyms and byte-identical across both catalogs** —
  `i18n.test.ts` asserts it. A user who switched to a language they cannot read needs a way back.

---

## 11 — `server` namespace — `packages/shared/src/i18n/catalogs/server.{de,en}.ts` (phase 2)

Server-side messages carry a typed `ServerKey`, never a sentence, and render in the locale the
request negotiated (`localeMiddleware` → `requestLocale(c)` → `ApiError.toBody()` → `serverText()`).
The call site passes an `ErrorText` — a `ServerKey` or `{ key, values }` — and `tsc` rejects a
literal. There is deliberately **no pass-through variant** on this side; that was rejected as the
loophole that would keep German in handlers.

These keys live in `packages/shared`, next to the schemas that reference them via `refineKey()`, so
they land in **phase 2**, not phase 6 (`PLAN.md` §1).

### 11.1 Added (7)

| Key | `de` | `en` |
| --- | --- | --- |
| `server.plan.entryNotFound` | `Eintrag im Wochenplan nicht gefunden` | `Meal plan entry not found` |
| `server.plan.invalidDate` | `Bitte ein Datum im Format JJJJ-MM-TT angeben` | `Please provide a date in the format YYYY-MM-DD` |
| `server.plan.rangeInvalid` | `Das Startdatum muss vor dem Enddatum liegen` | `The start date must be before the end date` |
| `server.plan.rangeTooLong` | `Der Zeitraum darf höchstens 62 Tage umfassen` | `The range may cover at most 62 days` |
| `server.plan.dayFull` | `Für einen Tag sind nicht mehr als {max} Rezepte möglich` | `No more than {max} recipes can be planned for one day` |
| `server.plan.alreadyPlanned` | `Dieses Rezept steht an diesem Tag schon auf dem Plan` | `This recipe is already planned for that day` |
| `server.recipes.nothingToUndo` | `Es gibt keinen Kochvorgang, der zurückgenommen werden kann` | `There is no cook entry that can be undone` |

Placement: a new `/* ------- meal plan ------- */` block after `server.invite.*`, in **both** files;
`server.recipes.nothingToUndo` goes inside the existing `server.recipes.*` block in both.

- **`server.plan.invalidDate` spells the format in the reader's own convention** — German
  `JJJJ-MM-TT`, English `YYYY-MM-DD`. The *wire* format is `YYYY-MM-DD` either way; only the
  explanation is localised.
- **`server.plan.rangeTooLong` carries the number inline, with no `{max}` placeholder, on purpose.**
  `refineKey()` takes a bare `ServerKey` and passes no values, so a `{max}` there would render
  unsubstituted. Put a comment above the key saying it must move together with
  `PLAN_LIMITS.rangeDays` (62). The alternative — plumbing values through `refineKey` — changes the
  i18n runtime for one string.
- **`server.plan.dayFull` keeps `{max}`** because it is raised from a handler, which can supply
  values: `ApiError.conflict("meal_plan_day_full", { key: "server.plan.dayFull", values: { max: PLAN_LIMITS.entriesPerDay } })`
  — exactly like the existing `server.shopping.tooManyLists`.
- `server.recipes.nothingToUndo` is required because `PLAN.md` R18 **adopts** the cooked undo
  (`DELETE …/recipes/:recipeId/cooked`, own row only, 10-minute window). `specs/02 §6.2` listed it
  as conditional.

### 11.2 `ERROR_CODES` — exactly one addition

`packages/shared/src/schemas/common.ts`:

```ts
/** A single day already holds `PLAN_LIMITS.entriesPerDay` planned recipes. */
"meal_plan_day_full",
```

A code is a **wire contract and is never renamed**, so mint as few as possible. Everything else
reuses an existing code with the right catalog key:

| Failure | Code | Key |
| --- | --- | --- |
| plan entry / recipe not found | `not_found` | `server.plan.entryNotFound` / `server.recipes.recipeNotFound` |
| same recipe moved onto a day that already has it | `conflict` | `server.plan.alreadyPlanned` |
| bad date, reversed range, over-long range, no changes | `validation_failed` (422, via Zod) | `server.plan.invalidDate` / `…rangeInvalid` / `…rangeTooLong` / `server.validation.noChanges` |
| unconfirmed address on a planner or shopping write | `email_unverified` (403) | existing middleware |
| nothing to undo | `not_found` | `server.recipes.nothingToUndo` |
| shopping list, item or suggestion not found | `not_found` | existing `server.shopping.listNotFound` / `…itemNotFound` / `…suggestionNotFound` |
| list full on an undo | `shopping_list_full` (409) | existing `server.shopping.listFull` |

**No new server keys and no new codes for the shopping workstream** (`specs/03 §7`).
`server.shopping.boughtNotFound` is deliberately **not** added: an unknown `boughtId` is a 200
no-op, like an already-checked item, and an unknown recipe id on
`DELETE …/recipes/:recipeId` is a 200 no-op too — never a 404, because a replayed offline delete
must not fail.

### 11.3 The one German literal to hunt for while in these files

The `details` slot, not the message slot. `services/groups/validation.ts` shipped a German literal
inside `validationFailed`'s `details` and went out on the wire untranslated — `tsc` could not see
it and check 2 was the only thing that could. **Every new endpoint's `details` payload carries
machine values only** (`reason`, ids, counts), never prose, and `reason` itself is a machine
contract like `code`: never keyed, never translated, never renamed.

`server.mail.*` gains nothing — the redesign sends no new mail.

---

## 12 — Per-file summary: who edits what

Work the files in this order. Each row is one edit set; `de` and `en` **always move together in the
same commit**, or `tsc` fails.

| # | Task | File pair | Added | Deleted | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | **phase 2** | `packages/shared/src/i18n/catalogs/server.de.ts` + `server.en.ts` | 7 | 0 | §11.1. Lands with the schemas that `refineKey()` them. |
| 2 | **phase 2** | `packages/shared/src/schemas/common.ts` | 1 code | 0 | §11.2. Not a catalog. |
| 3 | `T6.1` | `apps/web/src/lib/i18n/catalogs/plan.de.ts` + `plan.en.ts` | **42 (new files)** | — | §6. `as const satisfies NamespaceCatalog<"plan">` / `LocaleCatalog<PlanCatalog>`. Sections: page + week nav 7 · day card 6 · picker/menu/dialogs/toasts 27 · library strip 2. |
| 4 | `T6.1` | `apps/web/src/lib/i18n/catalogs/index.ts` | 2 imports + 2 spreads | 0 | §2.1. FINAL-file exception — **flag it in the PR**. |
| 5 | `T6.1` | `apps/web/src/lib/i18n/i18n.test.ts` | `"plan."` in the prefix array | 0 | §2.1. **The test fails without it.** |
| 6 | `T6.1` | `apps/web/src/lib/i18n/catalogs/ui.de.ts` + `ui.en.ts` | 4 | 3 | §5. |
| 7 | `T6.2` | `apps/web/src/lib/i18n/catalogs/recipes.de.ts` + `recipes.en.ts` | 38 | 1 | §8. Sections: library 8 (§8.1) · create sheet 3 (§8.2) · filters 6 (§8.3) · sort 1 (§8.4) · detail 17 (§8.5) · form 3 (§8.6). Deletes `recipes.filters.searchPlaceholder`. |
| 8 | `T6.3` | `apps/web/src/lib/i18n/catalogs/shopping.de.ts` + `shopping.en.ts` | 83 | 1 | §7. Sections: overview 10 (§7.1) · detail header 10 (§7.2) · bought section 19 (§7.3) · frequently bought 9 (§7.4) · from-plan 12 (§7.5) · history 10 (§7.6) · list recipes 12 (§7.7) · add bar 1 (§7.8). Deletes `shopping.addItem.placeholder`. |
| 9 | `T6.3` *(or `T8.5`)* | `apps/web/src/lib/i18n/catalogs/cards.de.ts` + `cards.en.ts` | 1 | 1 | §10.1. Assign it to whoever edits `CardsCard.tsx`, and say so in the PR — it is one key. |
| 10 | `T9.2` | `apps/web/src/lib/i18n/catalogs/groups.de.ts` + `groups.en.ts` | 9 | 0 | §9.1. Ships with the `/tags` kind toggle. |
| 11 | `T8.1` | `apps/web/src/lib/format.ts` | 4 exported functions | 0 | §3.1/§3.2. `formatRelativeShort`, `formatWeekdayShort`, `formatDayOfMonth`, `formatShortWeekdayDate`, all through the memoised `formatters()` builder. |
| 12 | `T8.1` | `apps/web/src/features/recipes/lib/format.ts` | 1 `SORT_LABELS` line | 0 | §8.4. Key map, never a literal map. |
| 13 | `T10.1` | `docs/i18n.md` | its §9 namespace note + its §11 parity paragraph | 0 | §2.2 and §13 of this file. |
| 14 | `T10.2` | `scripts/i18n-check.ts` | `packages/shared/src/tags.ts` in `ALLOW_LIST` | 0 | §4, R43. |

`auth.{de,en}.ts` and `import.{de,en}.ts` are **not touched by the redesign**. Do not open them.

**The one sanctioned multi-writer rule** (`PLAN.md` phase 6): if a phase 7/8/9 task genuinely needs
a key nobody anticipated, it adds it to **both** files of that namespace, in the namespace's
existing section position, without reformatting anything else. Catalogs are append-only key/value
blocks with no cross-references, so this is safe. Everything else in the plan has exactly one owner.

---

## 13 — `bun run i18n:check`: what to expect, and how to read it

`i18n:check` is grep-shaped and **exits non-zero even when the tree is correct**. Read the output,
never just the exit code.

```bash
bun run i18n:check 2>&1 | grep -vE ':[0-9]+: *(\*|//|/\*)'
```

**Check 1 (parity)** greps each `de` catalog value, fragment by fragment, against
`git merge-base HEAD origin/main`. After this redesign it is the *dominant* output: roughly **185
new German values** (42 `plan` + 38 `recipes` + 83 `shopping` + 9 `groups` + 4 `ui` + 1 `cards` + 7 `server`) have no base-tree counterpart by definition. Every one of them is
false-positive class 1.

**The procedure, and it is the only part that matters.** For each listed key, decide whether it is
*new* copy or a *reworded existing* string. A reworded string is a **genuine failure** and looks
byte-identical in the output to a new one. Concretely, everything in these lists is expected:

- the whole of `plan.de.ts` (42 keys, a new namespace — same situation as `cards.de.ts`);
- the new `recipes.*`, `shopping.*`, `groups.tags.kind*`, `ui.nav.plan*`, `ui.nav.organiseLabel`,
  `ui.sidenav.accountAction`, `cards.link.panelTitle`, `server.plan.*`,
  `server.recipes.nothingToUndo` rows in this document;
- nothing else.

Anything **not** in this document that appears under check 1 is either a key a screen agent invented
without updating this file, or a reworded existing value — both need a decision, not a shrug.

**Do NOT bulk-add these keys to `NEW_GERMAN`** in `scripts/i18n-check.ts`. That set is one entry per
key with a reason (it currently holds eleven previously-English Zod defaults); ~185 entries turns it
into a mute button and destroys the check's only real job, which is catching a *reworded* existing
string. **Do NOT set `I18N_CHECK_BASE`** either: on the `redesign` branch
`git merge-base HEAD origin/main` resolves to the pre-redesign commit, which is exactly what makes
check 1 meaningful; pointing it at a redesign commit quiets the output and destroys the check.

**Check 2 (no German left in a ported tree)** must stay clean apart from the three documented
classes: comment hits (dropped by the `grep -vE` above), and content vocabulary
(`UNIT_SUGGESTIONS`, the ingredient/step paste placeholders, `STEP_HEADING_RE`,
`html/entities.ts`'s umlaut table) — plus **one new entry**: the course vocabulary, which is why
`packages/shared/src/tags.ts` must join `ALLOW_LIST` (§4, R43). Without that, class 3 stops being a
closed list a reviewer can eyeball, and the check gets ignored.

`docs/i18n.md §11` gains a paragraph naming the redesign as a large new source of class 1 and
recording the read procedure above (`T10.1`).

---

## 14 — Contradictions and corrections recorded (D3 and otherwise)

Each is a place where this inventory departs from a source document. `PLAN.md` §2's rule — "if your
task contradicts an area spec, this file wins" — is honoured; where `PLAN.md` itself is internally
inconsistent, the more specific and self-consistent statement wins and the reason is given.

| # | Source | What it says | This inventory | Reason |
| --- | --- | --- | --- | --- |
| **C1** | `PLAN.md` `T6.1` tests | "`packages/shared/test/i18n.test.ts` already asserts the merge is order-independent … it must still pass" | The file that breaks is **`apps/web/src/lib/i18n/i18n.test.ts:22`**, whose hard-coded prefix array needs `"plan."`. The shared test only compares the two server catalogs' key sets and needs no change. | Read both files. Without the edit, `bun test` fails on every `plan.*` key. |
| **C2** | `specs/06 §7.3` | Do **not** add a ninth namespace; put planner copy under `recipes.plan.*` | A real ninth `plan` namespace, files + registry + test edit | `PLAN.md` `T6.1` creates `plan.{de,en}.ts` explicitly and `specs/05 §10.8` specifies its keys; the plan wins. The planner is a whole feature directory (`features/plan/**`) with its own screen, and namespace = directory is what keeps five screen agents out of each other's catalog files. |
| **C3** | `PLAN.md` `T6.2` | Add `gerade eben`, `vor {n} Min.`, `vor {n} Std.`, `vor {n} Tagen` as keys for `formatRelative` | **No such keys.** `formatRelative` (existing) and the new `formatRelativeShort` produce exactly those strings from `Intl.RelativeTimeFormat` in both locales | Verified against this repo's ICU (§3.1). `Intl` also gets `gestern` / `letzte Woche` / plural rules right, which four hand-written German phrases would not. Keying formatted values is the thing the task brief forbids. |
| **C4** | `PLAN.md` `T6.2` | `Diese Woche` + the `Plan →` label belong to the `recipes` namespace | `plan.strip.heading` / `plan.strip.link` in the **`plan`** namespace | `WeekStrip.tsx` is created by `T8.3` under `features/plan/components/`. `docs/i18n.md §9`'s ownership boundary is per directory; a `recipes.*` key inside a `features/plan` file is the cross-namespace edit the layout exists to prevent. |
| **C5** | `specs/03 §4.3` | One key: `"{removed} werden entfernt. {shared} bleiben, weil …"` | Three whole-sentence keys: `remove.description`, `remove.sharedNote`, `remove.descriptionExclusive` | The runtime selects a plural form from exactly one `count`; a composite phrase yields `"1 Position werden entfernt"` — wrong German. R-B.2. A03's `descriptionExclusive` variant is kept as it stands. |
| **C6** | `PLAN.md` `T6.2` + `specs/05 §8` | `recipes.create.newRecipe` (T6.2) / four `ui.create.*` keys (A05) | Three hint keys only; the sheet reuses `ui.sidenav.newRecipe`, `ui.nav.import` and `recipes.list.newAction` | Either alternative orphans `ui.sidenav.newRecipe` and `ui.nav.import`, contradicting R29's exact three deletions and `specs/05 §3.6`'s explicit "no orphaned key". §8.2. |
| **C7** | `specs/05 §12.5` vs `specs/04 §11` vs `T6.3` | "keep `cards.link.title` byte-identical" / "the design lengthens it" / lists `Treuekarten` under **shopping** | New `cards.link.panelTitle` (`Treuekarten`), old `cards.link.title` deleted, key stays in the **`cards`** namespace | The artboard titles the panel "Loyalty cards", so the copy does change; the file is `features/cards/components/CardsCard.tsx`, so the key is a `cards.*` key. Mint-and-delete keeps the change auditable in check 1's output. §10.1. |
| **C8** | `specs/04 §11`, `specs/05 §10.8` | Keys written with glyphs inline: `Planen →`, `+ Planen`, `+ Neue Liste`, `+ Karte hinzufügen`, `← Alle Listen`, `gekocht ✓` | Words only; every glyph is a `lucide-react` icon with `aria-hidden` | `PLAN.md` phase 9 forbids a raw `→ ← ✓ ▾` in the tree and `T8.3`/`T8.5` say "an `ArrowRight` icon, never `→`". A glyph baked into copy also cannot be mirrored for RTL and reads aloud as "right arrow". R-C. |
| **C9** | `specs/05 §10.8` | `plan.weekNumber` = `"KW {week}"` | **Dropped** | `PLAN.md` R2 does not implement `isoWeekNumber` ("nothing needs a week number") and rules the week label to be `formatDate` of the two bounds. A key with no data source is dead copy. |
| **C10** | `specs/04 §11` | `Einkauf` as the shopping `h1`; "today's is `Einkaufslisten`" | `shopping.lists.heading` stays `"Einkaufen"` (its actual current value); `en` is already `"Shopping"` | Rewording a one-word German heading costs a parity hit that is indistinguishable from an accident and buys nothing. The `en` value already matches the artboard. |
| **C11** | `specs/04 §8.6` | Drop `von 5` and `4 Portionen` from `ListRecipesPanel`; derive from `sources` | `shopping.listRecipe.meta` + `ingredientsOf` render the literal artboard | `PLAN.md` R10 ships `shopping_list_recipes`, so both numbers exist. A04 wrote its recommendation before that ruling. |
| **C12** | `PLAN.md` `T6.3` | "`Treuekarten`" listed in the shopping inventory | It is a `cards` key (C7) | See C7. |

### 14.1 `CLAUDE.md` edits this area requires (D3) — for the later agent, **not written here**

`PLAN.md` §5 owns the `CLAUDE.md` rewrite (`T10.3`). Two entries are affected by *this* area, and
neither is a "design beats repo" case — both are **corrections of statements that are now false**:

1. **The nav gotcha's claim that "Sammlungen / Tags ← the 'Erweiterte Suche' panel on `/`".**
   Replacement rationale to record: the panel offered a collection *filter* and tag *chips*, never
   links, so the claim has been false since the sidebar-only decision; `RecipeFilterRail` **and**
   `RecipeFilterSheet` now both carry `recipes.filters.manageCollections` /
   `recipes.filters.manageTags`, and the **sheet's** copy is the phone route. The entry must also
   drop `Importieren` from the tab list and name the `+` sheet in the library header as the phone
   route to `/import` and `/recipes/new`, with `ui.nav.import` explicitly still in use.

2. **The i18n gotcha's namespace count.** It says the catalogs are hand-rolled and typed; it does
   not enumerate namespaces, so the only edit needed is a sentence recording that **`plan` is the
   ninth namespace** and that `apps/web/src/lib/i18n/catalogs/index.ts` plus
   `apps/web/src/lib/i18n/i18n.test.ts`'s prefix array are the two places a new namespace must be
   registered — the second being the one that is easy to miss because `tsc` cannot see it.

Everything else in the i18n gotcha stays **verbatim** and is reinforced by this inventory: the
interface-vs-content split, "one key per whole sentence", the wire-key fallback rule, "a label map
frozen at import time cannot follow a locale switch", `translate()` being for outside React only,
and the `"system"` locale preference being a third state rather than a synonym for `de`.

---

## 15 — Gaps and open items, with a recommendation each

Nothing below is invented into the inventory; each is flagged so it is decided rather than guessed.

**G1 · No task creates `apps/web/src/features/shopping/ShoppingHistoryPage.tsx`.** `T5.2` declares
the `/shopping/history` route and `SHOPPING_HISTORY_PARAMS`, `T8.5` links `Alle` to it, `T6.3`
inventories its copy — but `PLAN.md` §2 assigns the screen file to nobody.
*Recommendation:* add it to `T8.5` (same feature, same task that builds the panel linking to it),
and keep the ten `shopping.history.*` keys as specified. One-line reason: a route with no component
is a lazy import that throws on click, and the panel's `Alle` link is what makes the route
reachable at all.

**G2 · The shopping list rail's `Barcode zeigen` row has no owner.** `SPEC.md §4.7` says the design
keeps the wallet "in the list rail"; `specs/04 §11` lists the string; `T8.6`'s file list contains no
cards component. *Recommendation:* **omit it in this pass** and mint no key — `CardsCard` on
`/shopping` already satisfies the phone-reachability rule, and a second entry point into the wallet
is not what any gate is measuring. The key, if it ships later, is `cards.tile.showBarcode` (§10.1).

**G3 · `recipes.filters.advancedToggle` (`"Erweiterte Suche"`) may be orphaned.** The desktop rail
is permanent (no disclosure) and the phone uses a `Filter` sheet trigger; whether the *inner*
`Mehr Filter` disclosure reuses the old key or the new `recipes.filters.moreFilters` decides it.
*Recommendation:* `Mehr Filter` is the new key (it is the design's word), and if `T8.2` finds
`advancedToggle` with no call site it **deletes it in that commit** and says so in the PR. One-line
reason: a key with no call site is copy nobody will ever review again, and `tsc` cannot flag it.

**G4 · `plan.day.meta` is not keyed.** The day card's meta line (`"1 Std. 15 Min. · heute · gekocht"`)
is composed in the component from `formatMinutes()` plus two optional suffixes. Strictly, R-A wants
one sentence key. *Recommendation:* leave it composed and revisit only if a translator asks — a
three-way-conditional key set (`meta`, `metaToday`, `metaCooked`, `metaTodayCooked`) is four keys
for a line whose parts are all independently optional, and both suffixes are single lower-case
words that slot after a `·` identically in German and English. Flagged, not hidden.

**G5 · `shopping.detail.subtitle` vs `subtitleShort` differ only in one word** (`heute gekauft` vs
`gekauft`). *Recommendation:* keep both, because the phone has 358 px and the desktop 1204 px and a
translator must be able to shorten only one. If the reviewer prefers one key, drop `subtitleShort`
and use the long form on both — a one-line change, and the reason it is two keys is width, not
meaning.

**G6 · `Intl.RelativeTimeFormat`'s English short form is `3 days ago`, not the artboard's
`3 d ago`.** `style: "narrow"` gives `3 days ago` too; only German narrows further, and badly
(`vor 10 m`). *Recommendation:* accept `3 days ago`. Hand-keying an abbreviation per unit per locale
is exactly the anti-pattern R-D exists to prevent, and the phone stat cell fits it at 83.5 px in the
eyebrow size.

**G7 · The exact German for `plan.entry.addToList`.** `"Zutaten zur Einkaufsliste"` is a noun
phrase in a menu of verb phrases (`Portionen ändern`, `Als gekocht markieren`, `Vom Plan
entfernen`). *Recommendation:* keep it — it matches the existing
`recipes.detail.addToShoppingList` (`"Zur Einkaufsliste"`), which is the same action from the
recipe screen, and consistency across two surfaces beats internal grammatical symmetry in one menu.

**G8 · Two keys carry the identical word in both locales** (`ui.nav.plan` = `Plan`/`Plan`,
`groups.tags.kindFree` = `Tag`/`Tag`). *Recommendation:* ship them with a comment saying so,
following `cards.de.ts`'s precedent for the symbology names. Without the comment, the next reader
"fixes" a translation that is already correct.
