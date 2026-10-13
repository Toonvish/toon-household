# 04 — Frontend: the four designed screens + the reconstructed desktop library

**Area owner:** the six screens the artboards cover (or imply):

| # | Screen | Source |
| --- | --- | --- |
| A | Recipe library · desktop | **RECONSTRUCTED** — no artboard (`SPEC.md` §1) |
| B | Recipe library · mobile | `1e` |
| C | Recipe detail · desktop | `1a` (captioned "library", content is detail) |
| D | Recipe detail · mobile | `1f` |
| E | Shopping overview | `1c` desktop / `1g` mobile |
| F | Shopping list detail | `1d` desktop / `1h` mobile |

**Not in this spec** (other workstreams; this spec only states what it *consumes* from
them, and §15 lists every point where they must agree with me). All `§4.x` references
below are sections of `docs/redesign/SPEC.md`; bare `§n` references are sections of this
file.

- the two new tokens + Newsreader/Figtree — **foundations** (`SPEC.md` §2)
- `SideNav` / `TopBar` / `BottomTabBar` / `nav-items.ts` — **shell** (`SPEC.md` §4.7)
- the planner endpoints (§4.1), cook tracking (§4.2), the bought-state tables (§4.3),
  `tags.kind` (§4.4), the week-plan diff (§4.5), the catalog `hidden_at` (§4.6)
- the German **key inventory** — a later agent owns keys; §11 below lists the *strings*
  each screen needs, with context, and names nothing.

Every hex in this document is written as the semantic token it resolves to
(`SPEC.md` §2 did that mapping hex by hex). Do not write a hex into a component: the two
genuinely new ones are `--bg-sunken` (`#130f0c`) and `--fg-body` (`#e8dccd`), and the
foundations workstream defines them plus their light twins.

---

## 1 — THE ONE REAL CONFLICT: `max-w-5xl` cannot express a 1440px artboard

`apps/web/src/components/layout/AppShell.tsx` currently renders

```
<SideNav />                                  <!-- fixed, w-64 = 256px -->
<div className="… lg:pl-64">
  <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-gutter pt-4 pb-tabbar lg:pt-8 lg:[--gutter:2rem]">
```

The desktop artboards are **1440px wide with a 236px sidebar**, so `<main>` is 1204px
(1140px of content inside its own 32px padding). `max-w-5xl` is 1024px. Every desktop
artboard — `1a`'s `minmax(0,1fr) 420px` hero row, `1c`'s three-column grid, `1d`'s
`minmax(0,1fr) 340px` — is drawn against 1140px and collapses at 1024. The design's own
stated fix is *"Empty space: content spans the full width"*. There is no way to implement
these four artboards without changing `AppShell`.

**Required changes to `AppShell.tsx`** (a shell file — coordinate with the shell
workstream; this spec is the reason it must change):

1. `theme.css` gains `--sidebar-w: 236px;` and `--content-max: 75.25rem;` (1204px) next to
   the existing `--tabbar-h` / `--topbar-h`, and `styles/index.css`'s `@theme inline` maps
   them: `--spacing-sidebar: var(--sidebar-w);` and `--container-content: var(--content-max);`.
   Tokens, not arbitrary values, because three files need the sidebar width (`SideNav`,
   `AppShell`'s `lg:pl-*`, and the reconstructed library's rail arithmetic).
2. `SideNav`: `w-64` → `w-sidebar`. `AppShell`: `lg:pl-64` → `lg:pl-sidebar`.
3. `<main>`: `max-w-5xl` → `max-w-content`. At exactly 1440px the render is
   pixel-identical to the artboards; above it the column centres.
4. `pt-4 pb-tabbar px-gutter lg:pt-8 lg:[--gutter:2rem]` all stay exactly as they are.
   The desktop artboards' `main` padding is `30px 32px` ≈ `pt-8` + `--gutter:2rem`.

**What that does to every other screen, and the mitigation.** Fifteen screens that were
laid out against a 1024px measure now get 1140px, and a single-column form or a paragraph
of prose at 1140px is unreadable. So `AppShell.tsx` must also export a measure wrapper and
the non-designed screens must adopt it:

```tsx
/** The old 1024px measure, for form and prose screens. `<main>` is now full-bleed. */
export function PageColumn({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto flex w-full max-w-5xl flex-1 flex-col", className)}>{children}</div>;
}
```

It deliberately carries **no** `px-gutter`, `pt-*` or `pb-tabbar` — those still belong to
`<main>` alone, so the CLAUDE.md rule survives intact. Screens that need it (not mine):
`features/auth/*`, `features/settings/*`, `features/groups/*`, `features/collections/*`,
`features/tags/*`, `features/import/*`, `RecipeFormPage`s. **None of my six screens use
it** — all six are full-bleed by design.

This is a **cross-area conflict**, recorded in §15. It is also a **CLAUDE.md rewrite**
(§13, edit 1): the "page roots are plain `flex flex-col gap-4`" gotcha names `max-w-5xl` as
the shell's own value.

### 1.1 — Two new CSS utilities the artboards force

Both go in `apps/web/src/styles/index.css`'s `@layer utilities`, next to `.px-gutter`.

```css
/*
 * Breaks a child OUT of <main>'s px-gutter — a full-bleed hero (1f), a bordered
 * header rail (1a), a gradient bottom bar (1h). The negative margin must be the
 * SAME max() expression px-gutter uses, or a notched phone in landscape bleeds by
 * the wrong amount. NEVER combine with px-4/px-safe — see the .px-safe note above.
 */
.bleed-gutter {
  margin-inline: calc(-1 * max(var(--gutter, 1rem), env(safe-area-inset-left, 0px)));
}
/* .bleed-gutter plus the gutter restored inside — for a bleeding bar with content. */
.bleed-gutter-inset {
  margin-inline: calc(-1 * max(var(--gutter, 1rem), env(safe-area-inset-left, 0px)));
  padding-left: max(var(--gutter, 1rem), env(safe-area-inset-left, 0px));
  padding-right: max(var(--gutter, 1rem), env(safe-area-inset-right, 0px));
}
```

`-mx-4` (which `AddItemBar` uses today) is **wrong** for these and always was: it assumes
the gutter is exactly 1rem, which it is not at `lg` (`--gutter:2rem`) and not on a notched
device. Existing `AddItemBar` usages migrate to `.bleed-gutter-inset` as part of screen F.

---

## 2 — Shared building blocks (new / restyled), with paths

New files, all under `apps/web/src`:

| Path | What | Used by |
| --- | --- | --- |
| `features/recipes/components/RecipeEditorialRow.tsx` | The 84px-thumb editorial row: thumb · course eyebrow · **unclamped** serif title · `time · servings` (+ `description` on desktop) | A, B |
| `features/recipes/components/CourseEyebrow.tsx` | The honey uppercase eyebrow. Renders **nothing** when the recipe has no `kind:"course"` tag | A, B, C, D |
| `features/recipes/components/RecipeFilterRail.tsx` | Desktop-only left rail: Gänge (single-select, with counts) · Tags (multi-select) · Mehr Filter disclosure | A |
| `features/recipes/components/RecipeFilterSheet.tsx` | The same controls in a `Dialog`, opened by the mobile "Filter" affordance | B |
| `features/recipes/components/RecipeStatRow.tsx` | Desktop 5-up bordered stat row / mobile 4-up grid, one component with a `layout` prop | C, D |
| `features/recipes/components/RecipeHeroMobile.tsx` | The 300px bleeding hero with scrim, back button, `ActionMenu`, eyebrow + h1 | D |
| `features/recipes/components/RecipeDetailBottomBar.tsx` | Sticky `Kochmodus` + square `Gekocht` bar | D |
| `features/plan/components/WeekStrip.tsx` | The 7-day (desktop) / 4-day (mobile) planner strip, three card states | A, B |
| `features/recipes/components/RecentlyCookedShelf.tsx` | Horizontal "Kürzlich gekocht" carousel | A |
| `features/shopping/components/ShoppingListPreviewCard.tsx` | The overview's list card: icon · name · counts · `Öffnen →` · progress bar · item preview | E |
| `features/shopping/components/ShoppingProgressBar.tsx` | 6px `rounded-full` track + `--success` fill | E |
| `features/shopping/components/WeekPlanPanel.tsx` | "Aus dem Wochenplan" (desktop rows / mobile thumbs) | E |
| `features/shopping/components/BoughtHistoryPanel.tsx` | "Einkaufshistorie" / mobile "Historie" | E |
| `features/shopping/components/BoughtSection.tsx` | "Heute gekauft" header + rows (desktop) / tiles (mobile) + collapse | F |
| `features/shopping/components/SectionHeader.tsx` | eyebrow · hairline rule · trailing count-or-action. Used 4× | E, F |
| `features/shopping/components/ListRecipesPanel.tsx` | "Rezepte auf dieser Liste" right-rail panel | F |

Restyled primitives in `components/ui/`:

- **`Tabs.tsx`** — add `tone?: "surface" | "brand"`, default `"surface"`. `"brand"` makes
  the active segment `bg-brand-soft text-brand-soft-fg` with no `shadow-soft`, which is
  what `1f` draws. Default keeps `GroupDetailPage.tsx:113` (the only other `<Tabs>` in the
  app) byte-identical.
- **`Card.tsx`** — add `radius?: "card" | "sheet"`. The artboards use 16px on desktop
  panels (`--radius-card`, already 1rem) and **18px** on the mobile shopping cards
  (`1g`). `--radius-sheet` is already 1.25rem = 20px; add `--radius-panel: 1.125rem`
  (18px) to `@theme inline` and map `radius="panel"`. Do not hard-code `rounded-[18px]`.
- **`Skeleton.tsx` / `SkeletonList`** — `variant` gains `"editorial"` (84px square +
  three text bars) and `"tiles"` (2-up 24-tall boxes). See §11.

No other primitive changes. `Button`, `IconButton`, `Input`, `Select`, `Dialog`,
`ActionMenu`, `EmptyState`, `ErrorState`, `Badge`, `ConfirmDialog`, `Toast` are used
as-is; the artboards' button shapes (`38px`/`40px`/`42px`/`52px` heights, `10px`/`12px`/
`14px` radii) map onto `size="sm" | "md" | "lg"` and `rounded-xl` closely enough that a
new variant is not justified under D2 — and `size="lg"`'s `min-h-13` is already exactly the
52px the two bottom bars want.

---

## 3 — Screen A · Recipe library, DESKTOP (RECONSTRUCTED)

**There is no artboard.** Every decision below is tagged with which of `SPEC.md` §1's four
sources drove it: **S1** = `1e`'s content order · **S2** = the unused `renderVals()` data
(`recipes`, `week`, `recent`, `courseFilters`, `tagFilters`) · **S3** = the `#t1` intro
copy · **S4** = the shared 236px desktop chrome from `1a`/`1c`/`1d`. Anything marked
**[RECON]** with no source is my judgement and the one-line reason is given.

File: `apps/web/src/features/recipes/RecipeListPage.tsx` — rewritten. It keeps
`useUrlRecipeFilters("/")`, `useRecipeList`, `flattenPages`, `totalCount`, `useTags`,
`useCollections`, and `useIsWideViewport()`; everything below `<header>` is new markup.

```
RecipeListPage.tsx                                      root: flex flex-col gap-6
│                                                        (gap-6 = 24px, S4: 1c/1d main gap:24px)
├─ <header>  flex items-end gap-4                        [RECON: mirrors 1c/1d's h1 row exactly]
│  ├─ div
│  │  ├─ <h1> font-display text-[38px] leading-[1.1] font-medium text-fg
│  │  │        "Rezepte"                                 (S4: 1c/1d h1 = 500 38px/1.1)
│  │  └─ <p>  mt-1.5 text-sm text-fg-subtle
│  │           "Geteilt mit {group} · {n} Mitglieder · {n} Rezepte"   (S4: 1c subtitle)
│  └─ div  ml-auto flex shrink-0 gap-2                   canCreate only
│     ├─ AppLink to="/import"     buttonClasses({variant:"outline"})   "Importieren"
│     └─ AppLink to="/recipes/new" buttonClasses({variant:"primary"})  "Neues Rezept"
│        [RECON: 1e draws a single `+` because the phone tab bar lost Import (§4.7);
│         the desktop sidebar keeps Import, so two labelled buttons are correct here]
│
├─ <Input type="search"> leftIcon={<Search/>} containerClassName="max-w-[520px]"
│     h-11 rounded-xl border-line bg-surface text-[15px]
│     placeholder "{n} Rezepte durchsuchen"              (S1: 1e "Search 37 recipes")
│     NO "Filter" affordance — the rail is permanent      (S3: "tags move to the filter rail")
│
└─ <div> grid grid-cols-[220px_minmax(0,1fr)] gap-9 items-start
   ├─ <RecipeFilterRail>                                 sticky top-8 self-start
   └─ <div> flex min-w-0 flex-col gap-8
      ├─ <WeekStrip variant="desktop">                    (S2: week[7]; S3 "Week planner strip")
      ├─ <RecentlyCookedShelf>                            (S2: recent[5]; S3 "Recently cooked carousel")
      ├─ <section>  "Alle Rezepte"                        (S1: 1e "All recipes" + count)
      │  ├─ header flex items-baseline gap-2.5
      │  │   <h2> font-display text-xl font-medium  "Alle Rezepte"
      │  │   <span> text-[12.5px] text-fg-subtle  {total}
      │  └─ <ul> flex flex-col                            divide-y divide-line
      │      └─ <li><RecipeEditorialRow recipe density="desktop"/></li>   × n
      ├─ resultsCount <p> + "Mehr laden" <Button variant="outline"> (kept verbatim)
      └─ refreshing <Spinner> (kept verbatim)
```

### 3.1 — `RecipeFilterRail.tsx`

`grid-cols-[220px_…]`: **[RECON]** 220px is the sidebar's own nav-item width
(236 − 2×14 padding = 208) rounded up, so the two rails read as one system (S4). Reason it
is not 236: a nested second 236px column at 1140px leaves 884px of content, and the
editorial rows want the width.

```
<aside> flex flex-col gap-7 text-sm
├─ fieldset  flex min-w-0 flex-col gap-1        ← min-w-0 REQUIRED (§10.6)
│  ├─ legend  text-[11px] font-semibold uppercase tracking-[.08em] text-toon-sand-600
│  │           "Gänge"                            (S3: courseFilters split from tagFilters)
│  └─ per course tag (tags.data filtered to kind === "course"):
│     <button> flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left
│              text-fg-muted hover:bg-surface-2 hover:text-fg
│       active: bg-brand-soft text-brand-soft-fg font-semibold
│       ├─ <span class="min-w-0 flex-1 truncate">{tag.name}</span>
│       └─ <span class="shrink-0 text-xs tabular-nums text-fg-subtle">{tag.recipeCount}</span>
│                                                 (S2: courseFilters carry `n`)
├─ fieldset  "Tags"   min-w-0                     (S2: tagFilters[8])
│  └─ same rows, MULTI-select, no counts unless `recipeCount` is present
└─ <details> "Mehr Filter"                        [RECON, see below]
   └─ Select ×3: Sammlung · Schwierigkeit · Max. Zeit   (the existing three)
```

**Course is single-select, and that is forced by the API, not a taste call.**
`RecipeListFilters.tagIds` is AND-combined ("a recipe must carry all", see
`RecipeFilters.tsx`'s `recipes.filters.tagsAllRequired` hint), so two selected courses
return zero rows every time. `toggleCourse(id)` therefore *replaces* whichever
`kind:"course"` id is currently in `filters.tagIds`; `toggleTag(id)` keeps today's
add/remove behaviour. Both write through the existing
`onFiltersChange({...filters, tagIds})`.

**`RECIPE_FILTER_PARAMS` does NOT change for this screen.** A course is a tag, so it
travels in the existing `tags` param and `pick()` in `router.tsx` keeps working — and
`/search` keeps forwarding it without touching its own `validateSearch`. (§4.2's
`?sort=lastCooked` *is* a change, but it is a new value of the existing `sort` param, so
still no new line in `RECIPE_FILTER_PARAMS`; it needs a line in `SORTS` in
`lib/url-filters.ts` and in `SORT_LABELS` in `lib/format.ts`.)

**The "Mehr Filter" disclosure is [RECON] and the design's real gap.** The artboards draw
courses and tags and nothing else, but Sammlung / Schwierigkeit / Max. Zeit already exist
in the URL contract and cannot be silently dropped — a deep link carrying
`?difficulty=schwer` would show a filtered list with no visible control that says so.
Recommendation: a closed `<details>` in the rail, force-open when any of the three is set
(the same `activeCount > 0 → setAdvancedOpen(true)` effect `RecipeFilters.tsx` has today).
Sort moves to the header row as a `<Select>` — **[RECON]**, one-line reason: `1d` puts
"Sort: newest" in its h1 row, which is the only sort control the design draws anywhere.

### 3.2 — `WeekStrip.tsx` (`variant="desktop"`)

```
<section> flex flex-col gap-2.5
├─ header flex items-baseline gap-2.5
│  ├─ <h2> font-display text-xl font-medium  "Diese Woche"
│  └─ AppLink to="/plan"  ml-auto text-[12.5px] font-semibold text-brand-hover  "Planen →"
└─ <ol> grid grid-cols-7 gap-2                 ← 7 tracks, each minmax(0,1fr)
   └─ per day: <li> min-w-0
      <AppLink|button> flex min-h-[86px] flex-col gap-1.5 rounded-xl border p-2.5
        planned : border-line bg-surface        day label text-brand-hover  title text-fg
        empty   : border-surface-2 bg-transparent  day label + title text-toon-sand-600
        today   : border-brand bg-brand-soft    day label text-brand-soft-fg title text-fg
                                                 (S2: the three spread objects verbatim)
      ├─ <span> text-[10.5px] font-bold uppercase tracking-[.06em]   "MO 1"
      ├─ <span> font-display text-[13.5px] leading-[1.25] font-medium
      │          {recipe title} | "+ Planen" when empty
      └─ <span> text-[11px] text-fg-subtle  {meta}
                 [RECON: 1e's card template renders no meta line, but S2 carries `meta`
                  ("1 h 15 · cooked ✓") and the desktop card has the height for it]
```

`grid-cols-7` with `minmax(0,1fr)`, **not** `1e`'s fixed 132px: 7 fixed cards at 132px +
gaps = 972px, which does not fit the 884px content column. Each card must be able to
shrink, hence `min-w-0` on the `<li>` (§10.6).

Data: `features/plan/lib/queries.ts` (§4.1's workstream). This component takes a
`readonly PlanDay[]` prop and renders nothing but skeletons while pending — it must never
be the reason the library fails to render, so its query error is swallowed into "no plan
yet" rather than an `ErrorState`. Day cards render `thumbnailUrl()` **only** if the
planner workstream puts a thumb on the day card; the artboards do not draw one, so the
default is text-only.

### 3.3 — `RecentlyCookedShelf.tsx`

**[RECON]** — S2 gives the data (`recent[5]`, each `title` + `when`), S3 names the feature
("Recently cooked carousel"), and no artboard draws it.

```
<section> flex flex-col gap-2.5
├─ <h2> font-display text-xl font-medium  "Kürzlich gekocht"
└─ <ul> scroll-x no-scrollbar flex gap-3 pb-1
   └─ <li> w-[180px] shrink-0
      <AppLink to="/recipes/$recipeId"> flex flex-col gap-2
      ├─ img src={thumbnailUrl(recipe)} aspect-4/3 w-full rounded-xl object-cover bg-surface-2
      │      loading="lazy" decoding="async"            ← thumbnail, never imageUrl (§10.3)
      ├─ <span> font-display text-[15px] leading-tight font-medium  {title}   ← NOT clamped
      └─ <span> text-xs text-fg-subtle  {formatRelative(lastCookedAt)}
```

**Placement: between the week strip and "Alle Rezepte".** [RECON, reason:] "Alle Rezepte"
is the infinite-scroll list with "Mehr laden" at its foot, so nothing may sit below it —
a shelf underneath would move down the page every time a page is fetched.

`w-[180px]` is a literal because there is no artboard measurement to token-ise; it is the
only arbitrary width in this spec and is deliberate.

### 3.4 — `RecipeEditorialRow.tsx` (`density="desktop"`)

```
<AppLink to="/recipes/$recipeId" params={{recipeId}}>
  grid grid-cols-[84px_minmax(0,1fr)] items-center gap-3.5 py-3.5
  text-fg hover:bg-surface-2/50 rounded-xl -mx-2 px-2
  focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring
├─ image slot  aspect-square w-[84px] rounded-xl bg-surface-2 object-cover
│    <img src={thumbnailUrl(recipe)} loading="lazy" decoding="async"/>          ← §10.3
│    fallback: <span class="grid place-items-center text-fg-subtle"><UtensilsCrossed class="size-6"/></span>
└─ <div> flex min-w-0 flex-col gap-0.5
   ├─ <CourseEyebrow tags={recipe.tags}/>      text-[10.5px] font-bold uppercase
   │                                            tracking-[.07em] text-accent
   ├─ <h3> font-display text-[21px] leading-[1.2] font-medium text-pretty
   │        {recipe.title}                      ← NO line-clamp, NO truncate, NO `block` (§10.1)
   ├─ <p>  text-sm text-fg-muted  {recipe.description}     desktop only, S2 carries `desc`
   │        may wrap to 2 lines naturally; no clamp
   └─ <p>  text-[12.5px] text-fg-subtle
            "{optionalMinutes(...)} · {optionalServings(...)}"    ← "·" only when both exist
```

`density="mobile"` differs in exactly three ways: title `text-[17px]`, no
`description`, and the eyebrow at `text-[10.5px]` unchanged (S1 gives all three).

Deliberately gone from both densities: the tag chip row and the rating star.
S3 — *"cards show **one** category; tags move to the filter rail"* — is the whole point of
the redesign, and neither artboard draws a chip in a list row.

`grid-cols-[84px_minmax(0,1fr)]`: the second track is `minmax(0,1fr)` and the inner div
carries `min-w-0`, because a long unbroken German compound in the title would otherwise
set the track's min-content width and push the row past the column (§10.6).

---

## 4 — Screen B · Recipe library, MOBILE (artboard `1e`)

Same file, the `!wide` branch of `RecipeListPage.tsx`.

```
root: flex flex-col gap-4                     (AppShell owns mx-auto/px-gutter/pt-4/pb-tabbar)
├─ (the group chip + brand `+` at 1e's top ARE AppShell's TopBar — see §4.1)
├─ <h1> font-display text-[34px] leading-[1.05] font-medium text-fg  "Rezepte"
├─ <div> flex gap-2
│  ├─ <Input type="search" leftIcon={<Search/>} containerClassName="min-w-0 flex-1">
│  │     h-[46px] rounded-xl   placeholder "{n} Rezepte durchsuchen"
│  └─ <button> shrink-0 self-center px-1 text-xs font-semibold text-brand-hover
│        "Filter"   → opens <RecipeFilterSheet>
│        (1e draws this as text INSIDE the field's right edge; rendering it as a sibling
│         keeps the <Input> primitive untouched and the tap target ≥44px. [RECON])
├─ <WeekStrip variant="mobile">
│    header: "Diese Woche" font-display text-xl + "Planen →" text-[12.5px] text-brand-hover
│    row: <ol class="scroll-x no-scrollbar bleed-gutter-inset flex gap-2">
│         └─ <li class="w-[132px] shrink-0"> … same three card states, min-h-[86px]
│         4 days shown by scroll position, NOT by slicing to 4: 1e's `week.slice(3,7)`
│         is the mock cropping its own frame. Render all 7 and let it scroll. [RECON]
├─ <section> "Alle Rezepte" + {total}          same header as desktop, h2 text-xl
│  └─ <ul class="flex flex-col divide-y divide-line">
│     └─ <RecipeEditorialRow density="mobile"/>  × n
├─ resultsCount / "Mehr laden" / Spinner        kept verbatim
└─ <RecipeFilterSheet open=… />                 Dialog size="md", the rail's controls
                                                 stacked; each <fieldset> min-w-0
```

### 4.1 — What belongs to the shell, not here

`1e`'s top row (`MR Meine Rezepte ▾` + a 40px `--brand` `+` button) is
`components/layout/TopBar.tsx`, which already renders `GroupSwitcher` + a magnifier + a
brand `+`. The design draws **no magnifier** (the library has a real field) and the `+`
opens a create sheet rather than linking straight to `/recipes/new` (§4.7: Import lost its
tab). Both are `TopBar` edits and belong to the shell spec; this screen only requires that
the `+` exists and that the page's own search field is not duplicated in the bar.

### 4.2 — `SkeletonList` variants must follow the branch

`RecipeListPage` today renders `<SkeletonList variant={wide ? "cards" : "rows"} count={wide ? 6 : 8}/>`.
Both variants are now wrong: there is no card grid and no 64px row any more. Replace with
`variant="editorial"` for **both** branches and `count={wide ? 8 : 6}`; the skeleton's
thumb must be `size-[84px]` and it must show three text bars (eyebrow, title, meta), or
the list visibly jumps when data lands (§10.2). `"cards"` and `"rows"` become dead — see
§9.

---

## 5 — Screen C · Recipe detail, DESKTOP (artboard `1a`)

File: `apps/web/src/features/recipes/RecipeDetailPage.tsx` — rewritten into two branches
on `useIsWideViewport()`. Everything above the return (`useRecipe`, `scaleIngredients`
memo, `canEdit`, `share`/`copyIngredients`/`duplicate`, `AddRecipeToListDialog`,
`ConfirmDialog`, `CookMode`, `useCheckedSteps`) is kept unchanged.

```
<article class="recipe-print flex flex-col">          ← keep .recipe-print, print.css unchanged
├─ HEADER RAIL  bleed-gutter-inset -mt-8 flex items-center gap-2.5 border-b border-surface-2 py-3.5
│  │   (bleeds to <main>'s edges and sits flush under TopBar/SideNav, as 1a draws it)
│  ├─ breadcrumb  text-[13px] text-fg-subtle
│  │     AppLink to="/" "Rezepte"  ·  <span>/</span>  ·  <span class="min-w-0 truncate text-fg-muted">{title}</span>
│  └─ <div class="ml-auto flex shrink-0 gap-2"> data-print="hide"
│     ├─ <Button variant="outline" size="sm" class="min-h-[38px]" leftIcon={<CalendarDays/>}>
│     │     "Für einen Tag planen"                   → PlanForDayDialog (§4.1 workstream)
│     ├─ <Button variant="outline" size="sm" class="min-h-[38px]" leftIcon={<ShoppingBasket/>}>
│     │     "Zur Einkaufsliste"                      → setShoppingOpen(true)
│     ├─ <Button size="sm" class="min-h-[38px] bg-success-soft text-success-soft-fg
│     │           border border-success-soft hover:brightness-110" leftIcon={<Check/>}>
│     │     "Gekocht"                                → POST …/recipes/:id/cooked (§4.2)
│     └─ <ActionMenu label=… title={title} items={[edit?, share, copyText, print, duplicate, delete?]}/>
│           38px square trigger — the existing component, unchanged
│
├─ HERO ROW  grid grid-cols-[minmax(0,1fr)_420px] gap-9 items-start pt-7
│  ├─ <div class="flex min-w-0 flex-col gap-3.5">
│  │  ├─ <CourseEyebrow>  text-xs font-bold uppercase tracking-[.08em] text-accent
│  │  │      "Hauptspeise · Eintopf"  = course tag, then the first free tag, joined " · "
│  │  ├─ <h1> font-display text-[46px] leading-[1.05] font-medium tracking-[-0.01em] text-balance
│  │  ├─ <p>  max-w-[640px] text-base leading-[1.55] text-fg-muted text-pretty   {description}
│  │  ├─ <RecipeStatRow layout="desktop">
│  │  └─ <p> flex flex-wrap gap-1.5 text-xs text-fg-subtle
│  │        tags joined with "·" (plain text, NOT TagChip — 1a shows a quiet tag LINE)
│  │        + <span class="text-toon-sand-600">"· von {author}, {formatRelative(updatedAt)}"</span>
│  └─ <img src={mediaUrl(recipe.imageUrl)} class="aspect-4/3 w-full rounded-2xl object-cover bg-surface-2"/>
│        ← the BIG image. Detail keeps imageUrl (§10.3). Fallback = the existing
│          UtensilsCrossed placeholder block at the same aspect/radius.
│
└─ BODY  grid grid-cols-[400px_minmax(0,1fr)] gap-10 items-start pt-8
   ├─ <Card padding="none" class="flex flex-col gap-3.5 rounded-2xl p-5 lg:sticky lg:top-8">
   │  ├─ header flex items-center gap-3
   │  │   <h2> font-display text-2xl font-medium "Zutaten"
   │  │   <span class="text-[13px] text-fg-subtle">{ingredients.length}</span>
   │  │   <ServingsScaler class="ml-auto" …/>    ← restyled: see §5.2
   │  ├─ <IngredientList>                        ← restyled: see §5.1
   │  └─ <Button variant="outline" fullWidth class="min-h-[42px] bg-surface-inset">
   │       "Alle {n} zur Einkaufsliste"          disabled={unverified !== undefined} title={unverified}
   └─ <div class="flex min-w-0 flex-col gap-4.5">
      ├─ header flex items-center gap-3
      │   <h2> font-display text-2xl font-medium "Zubereitung"
      │   <span class="text-[13px] text-fg-subtle">{n} Schritte</span>
      │   {checked.doneCount > 0 && <Button variant="ghost" size="sm">"{n} zurücksetzen"</Button>}
      │   <Button class="ml-auto min-h-10 font-bold" leftIcon={<Play/>}>"Kochmodus"</Button>
      ├─ <StepList>                              ← restyled: see §5.3
      ├─ Notizen <Card>       kept as-is, restyled to rounded-2xl
      └─ Quelle  <Card>       kept as-is (safeHttpUrl + hostFromUrl unchanged)
```

**The three labelled buttons + `⋯` are correct here and are NOT the CLAUDE.md trap.**
That gotcha is about *five icon buttons on a 390px phone stealing ~240px from the `<h1>`
beside them*. This header is 1140px wide, the buttons are labelled, and they sit in their
own rail above the title, not beside it — the title's wrapping cannot change as `canEdit`
resolves. The `⋯` **is** `ActionMenu` and keeps its two load-bearing behaviours: it closes
before running an item and defers by one `requestAnimationFrame`, because the panel is a
portal **outside `.recipe-print`** and `window.print()` from the same handler would print
the open menu over the recipe. The mobile screen (D) does collapse to one trigger.

### 5.1 — `IngredientList.tsx` (restyled)

Row becomes `grid grid-cols-[78px_minmax(0,1fr)] gap-3 border-t border-surface-2 py-2.5
text-[15px] leading-[1.35]` (mobile: `grid-cols-[70px_minmax(0,1fr)] py-2.5`, from `1f`).
The amount span: `text-right font-semibold tabular-nums`, coloured
**`text-accent` for a real amount and `text-fg-subtle` for a vague one** — the mock's
`qtyColor` is `#eab54f` vs `#9c8b79`, and `isVagueAmount(item)` from `@toon/shared`
(already used by `ShoppingItemCard`) is the existing predicate for exactly that. The name
span keeps `{name}` + `<span class="text-fg-subtle"> {note}</span>` but drops the
parentheses the current version adds — `1a`/`1f` render the note bare.

**Keep the `scaled` prop**, but stop recolouring: `text-accent` is now the amount colour
unconditionally, so a second colour meaning would be ambiguous. The scaled signal is the
existing `recipes.detail.scaledNote` status line above the list, which stays.
`groupBySection` and the section `<h3>` are unchanged (the artboards show no sections
because the fixture has none; `Für den Teig` recipes still need them).

### 5.2 — `ServingsScaler.tsx` (restyled)

`1a` draws an inline 36px box: `flex h-9 items-center rounded-xl border border-line
bg-surface-inset`, a 36px `−` button, `text-[13.5px] font-semibold` output, a 36px `+`
button. `1f` draws the same at 40px. So: add `size?: "sm" | "md"` (36 / 40px) and change
the shape from `rounded-full` to `rounded-xl`, keeping the `useId` label, the
`aria-live="polite"` `<output>`, the 0.5-step logic and the reset button (which moves to a
`ghost` `size="sm"` button beside the box, as it is today). The `min-w-24` on the output
stays — it is what stops the box resizing as the number changes.

### 5.3 — `StepList.tsx` (restyled)

`1a` draws `grid-cols-[44px_minmax(0,1fr)] gap-4`, the number as
`font-display text-[30px] leading-none font-medium text-brand pt-0.5`, and the text as
`text-[16.5px] leading-[1.6] text-fg-body text-pretty`. No card, no border, no background,
`gap-[22px]` between steps.

**The design draws no done state; keeping it is a deliberate extrapolation** (dropping
`useCheckedSteps` would be a functional regression — it is `sessionStorage`-backed and
survives navigation). So the `<li>` stays a `<button aria-pressed>` filling the grid, and
done means: numeral `text-success`, text `text-fg-subtle line-through decoration-1`, plus
the existing `sr-only` "erledigt / als erledigt markieren". The card border and
`bg-success-soft/60` are removed.

### 5.4 — `RecipeStatRow.tsx` (`layout="desktop"`)

```
<dl class="flex gap-7 border-y border-surface-2 py-3.5 text-sm">
  per cell: <div class="min-w-0">
    <dt class="block text-[11px] font-bold uppercase tracking-[.08em] text-toon-sand-600">
    <dd class="font-display text-xl font-medium">        ← tabular-nums on every quantity
  cells, in order: Portionen · Vorbereitung · Kochen · Gesamt
  then <div class="ml-auto min-w-0 text-right"> "Zuletzt gekocht" / {formatRelative(lastCookedAt)}
       in text-success-soft-fg                            (§4.2's derived lastCookedAt)
```
Cells with no value are omitted entirely (today's `metaItems` array already does this);
the "Zuletzt gekocht" cell is omitted when `lastCookedAt` is null. The existing
`Card padding="none"` + `divide-x` grid is replaced outright.

---

## 6 — Screen D · Recipe detail, MOBILE (artboard `1f`)

Same file, `!wide` branch.

```
<article class="recipe-print flex flex-1 flex-col gap-4">
├─ <RecipeHeroMobile>
│    <div class="bleed-gutter -mt-4 relative h-[300px] bg-surface-2">
│    ├─ <img src={mediaUrl(recipe.imageUrl)} class="h-full w-full object-cover"/>   ← BIG image
│    ├─ scrim <div class="pointer-events-none absolute inset-0"
│    │           style bg-[linear-gradient(to_bottom,var(--overlay)_0%,transparent_35%,transparent_55%,var(--bg)_100%)]>
│    │      (1f's literal gradient; the top stop is rgba(bg,.55) → --overlay is the token)
│    ├─ back    <IconButton variant="surface" class="absolute left-4 top-4 size-[38px]
│    │              rounded-full bg-overlay backdrop-blur-sm"> <ChevronLeft/>
│    ├─ <ActionMenu triggerVariant="surface" class="absolute right-4 top-4 size-[38px] rounded-full
│    │              bg-overlay backdrop-blur-sm" items={[edit?, share, copyText, print, duplicate, delete?]}/>
│    └─ <div class="absolute inset-x-5 bottom-0 flex flex-col gap-2">
│       ├─ <CourseEyebrow> text-[11px] … text-accent
│       └─ <h1> font-display text-[28px] leading-[1.1] font-medium text-balance   ← no clamp
│    NOTE: 1f's `top:50px` is the phone frame's status bar; in the app TopBar occupies
│    that space, so the buttons sit at `top-4` inside the hero. [RECON]
├─ <RecipeStatRow layout="mobile">              4-up grid, see §6.1
├─ <Tabs tone="brand" items={[{value:"ingredients",label:"Zutaten · {n}"},
│                             {value:"steps",label:"Zubereitung · {n}"}]} …/>
│    wrapper: rounded-xl border border-line bg-surface p-1, active segment bg-brand-soft
├─ ingredients panel (when value === "ingredients")
│  ├─ <div class="flex items-center gap-2.5">
│  │   <ServingsScaler size="md"/>   +   <button class="ml-auto text-[13px] font-semibold
│  │                                        text-brand-hover">"Alles zur Liste"</button>
│  └─ <IngredientList>   grid-cols-[70px_minmax(0,1fr)]
├─ steps panel  (when value === "steps") → <StepList> + Notizen + Quelle
├─ <div class="flex-1"/>                        ← THE SPACER (§10.4)
└─ <RecipeDetailBottomBar>
     sticky bottom-tabbar z-20 flex gap-2.5
     ├─ <Button size="lg" fullWidth class="rounded-2xl font-bold shadow-pop">"Kochmodus"</Button>
     └─ <button class="grid size-13 shrink-0 place-items-center rounded-2xl border
                       border-success-soft bg-success-soft text-success-soft-fg shadow-pop"
                 aria-label="Als gekocht markieren"> <Check class="size-5" strokeWidth={2.6}/>
```

### 6.1 — The 4-up stat grid is the 390px danger (§10.6)

`390 − 2×16` gutter `= 358`, minus `3×8` gaps `= 334 / 4 = 83.5px per cell.`

- `grid grid-cols-4 gap-2` — Tailwind's `grid-cols-4` is `repeat(4,minmax(0,1fr))`, which
  is already the safe form. Do **not** rewrite it as `[1fr_1fr_1fr_1fr]`.
- every cell carries `min-w-0`; the `<dd>` is `leading-tight text-balance` and **wraps**
  rather than truncating.
- **The phone shows four cells and `Gesamt` is not one of them.** `1f` draws
  Serves · Prep · Cook · **Cooked** — the artboard already made the trade. When
  `lastCookedAt` is null, substitute `Gesamt` into the fourth slot rather than showing
  three cells (a 3-of-4 grid leaves a hole).
- values use the short forms `formatMinutes` already produces (`35 Min.`, `1 Std. 15 Min.`)
  and `formatRelative` for the cooked cell (`vor 3 Tagen`). `1 Std. 15 Min.` does not fit
  on one line at 83px; it wraps to two, which is why the row's height is set by
  `items-start` and not fixed. **Verify this cell in a real browser at 390px** — reading
  the classes is not enough (§10.7).

### 6.2 — The bottom bar is a new instance of two traps

- `bottom-tabbar`, never `bottom-0`: `BottomTabBar` is `fixed inset-x-0 bottom-0 z-30`
  and `AppShell` renders it **after** `<main>`, so a `bottom-0` bar is painted underneath
  it and cannot be tapped. This is literally what once made an import uncommittable from a
  phone.
- an unbroken flex chain **plus** the `flex-1` spacer: `AppShell`'s column is `min-h-dvh`,
  `<main>` is `flex-1 flex flex-col`, this page root is `flex flex-1 flex-col`, and the
  spacer `<div class="flex-1"/>` sits directly above the bar. `min-h-full` on the page
  root reads as equivalent and measurably is not — a percentage min-height needs a
  definite parent height and a flex-grown item is not one.
- **No `-mx-*` and no `-mb-4` here**, unlike `AddItemBar`: `1f` draws this bar *inset*
  (`left:20px;right:20px;bottom:24px`) with `shadow-pop`, so it keeps the page gutter and
  the 1rem of breathing room inside `pb-tabbar` is exactly the `bottom:24px` the design
  wants. Screen F's bar is the full-bleed one.

---

## 7 — Screen E · Shopping overview (`1c` desktop / `1g` mobile)

File: `apps/web/src/features/shopping/ShoppingListsPage.tsx` — rewritten.
`useShoppingLists`, `useCreateShoppingList`, `useRenameShoppingList`,
`useDeleteShoppingList` and the three dialogs at the bottom of the file are kept verbatim.

```
root: flex flex-col gap-4  (mobile) / gap-6 (desktop)
├─ <header class="flex items-end gap-4">
│  ├─ <div>
│  │  ├─ <h1> font-display font-medium text-[34px] leading-[1.05] sm:text-[38px] sm:leading-[1.1]
│  │  │        "Einkauf"
│  │  └─ <p>  mt-1.5 text-[13px] sm:text-sm text-fg-subtle
│  │        desktop 1c: "Geteilt mit {group} · {n} Mitglieder · {syncedLine}"
│  │        mobile 1g:  "{syncedLine} · {shopperLine}"        ← both are OPEN ITEMS, §14.3
│  └─ desktop: <Button class="ml-auto min-h-[42px] rounded-xl font-bold">"+ Neue Liste"</Button>
│     mobile:  <button class="ml-auto text-[13px] font-semibold text-brand-hover">"+ Neue Liste"</button>
│     disabled={!canManage} title={manageHint}        ← the existing canManage, see §10.8
│
├─ desktop: <div class="grid grid-cols-[1.25fr_minmax(0,1fr)_minmax(0,1fr)] gap-4 items-start">
│  mobile:  a single flex column (same children, in the same order)
│  ├─ COLUMN 1  flex flex-col gap-4
│  │  └─ <ShoppingListPreviewCard list={l} variant={i === 0 ? "full" : "compact"}/>  × lists
│  ├─ COLUMN 2  <WeekPlanPanel/>
│  └─ COLUMN 3  flex flex-col gap-4
│     ├─ <CardsCard/>            ← restyled, see §7.4. MUST NOT BE DELETED (phone-only route)
│     └─ <BoughtHistoryPanel/>
└─ mobile only: the last two live in <div class="grid grid-cols-2 gap-3"> (1g), each child min-w-0
```

`grid-cols-[1.25fr_minmax(0,1fr)_minmax(0,1fr)]`: the first track keeps `1.25fr` (it holds
no controls, only text that already truncates); tracks 2 and 3 hold buttons and therefore
use `minmax(0,1fr)` (§10.6).

**`1c` draws ONE list card and the app has N.** [RECON, reason:] the mock's fixture has one
list. Column 1 renders every list, with the first (the one the API returns first —
see §14.6 on which "the" list is) as `variant="full"` and the rest as `variant="compact"`
(icon · name · counts · chevron, no progress bar, no item preview). Deleting the other
lists to match the mock would orphan them; there is no other route to a list.

### 7.1 — `ShoppingListPreviewCard.tsx`

```
<AppLink to="/shopping/$listId" params={{listId}}>
  flex flex-col gap-3.5 rounded-2xl border border-line bg-surface p-5 text-fg
  sm:gap-3.5  (mobile: <Card radius="panel"> p-[18px] gap-3)
  hover:border-line-strong hover:shadow-pop
├─ <div class="flex items-center gap-3">
│  ├─ <span class="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-hover">
│  │      <ShoppingBasket class="size-5"/>
│  ├─ <div class="min-w-0">
│  │  ├─ <span class="block font-display text-[21px] sm:text-[22px] font-medium truncate">{name}</span>
│  │  └─ <span class="text-[12.5px] sm:text-[13px] text-fg-subtle">
│  │         "{openCount} offen · {boughtTodayCount} heute gekauft"
│  └─ desktop: <span class="ml-auto shrink-0 text-[13px] font-semibold text-brand-hover">"Öffnen →"</span>
│     mobile:  <ChevronRight class="ml-auto size-5 shrink-0 text-fg-subtle"/>
├─ <ShoppingProgressBar value={boughtTodayCount} total={openCount + boughtTodayCount}/>
└─ item preview — variant="full" only:
   desktop  <ul class="hidden sm:grid grid-cols-2 gap-x-[18px] gap-y-1.5 text-sm text-fg-body">
              <li class="flex items-baseline gap-2 truncate">
                <span class="min-w-[38px] shrink-0 tabular-nums text-fg-subtle">{qty}</span>{name}
            + <span class="text-[13px] text-fg-subtle">"+{n} weitere"</span>
   mobile   <span class="text-[13.5px] leading-[1.5] text-fg-muted sm:hidden">
              {names.join(", ")} <span class="text-toon-sand-600">+{n}</span>
```

**This is the one place a `sm:hidden` pair is allowed.** The JS branch rule
(`useIsWideViewport`) exists *because a `display:none` `<img>` is still fetched*; this
preview has no images, so two text renderings cost nothing and a CSS branch is simpler.
Say so in the file comment or a reviewer will "fix" it.

Preview size 8 with `+n` — see §14.6: it must come from the list endpoint, not from a
per-list item fetch. `qty` is `formatShoppingAmount(item, formatQuantity)`.

### 7.2 — `ShoppingProgressBar.tsx`

```
<div class="h-1.5 overflow-hidden rounded-full bg-surface-2"
     role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}
     aria-label="…">
  <span class="block h-full bg-success" style={{ width: `${pct}%` }}/>
```
`pct` is **not** computed in the component: `SPEC.md` §5 requires pure logic in
`packages/shared`. Add `shoppingProgressPercent(bought: number, open: number): number` to
`packages/shared/src/shopping.ts` with a unit test, returning `0` when the denominator is
0 (an empty list must render an empty bar, never `NaN%`). Denominator = `bought + open`,
which is what `4 / (10 + 4) = 29%` in `1c` confirms (§14.5).

### 7.3 — `WeekPlanPanel.tsx`

```
desktop (1c)  <Card class="rounded-2xl p-5 flex flex-col gap-3.5">
├─ <div> <span class="block font-display text-[22px] font-medium">"Aus dem Wochenplan"</span>
│        <span class="text-[13px] text-fg-subtle">"{r} Rezepte · {i} Zutaten noch auf keiner Liste"</span>
├─ <ul class="flex flex-col gap-2.5 text-sm">
│  └─ <li class="flex items-center gap-2.5">
│     ├─ <img src={thumbnailUrl(recipe)} class="size-9 shrink-0 rounded-lg bg-surface-2 object-cover"/>   ← §10.3
│     ├─ <span class="min-w-0 flex-1">
│     │     <span class="block truncate font-display text-[15px] font-medium">{title}</span>
│     │     <span class="text-xs text-fg-subtle">"{weekdayShort} · {n} Zutaten"</span>
│     └─ <button class="shrink-0 text-xs font-semibold text-brand-hover">"Hinzufügen"</button>
└─ <Button variant="outline" class="min-h-10 bg-surface-inset">"Alles zu {listName} hinzufügen"</Button>

mobile (1g)  <Card radius="panel" class="p-[18px] flex flex-col gap-3">
├─ heading (19px serif) + "{i} Zutaten noch auf keiner Liste"
├─ <ul class="flex gap-2">  3 × <li class="min-w-0 flex-1">
│      <img class="h-[52px] w-full rounded-lg bg-surface-2 object-cover"/>   ← §10.3
└─ <Button variant="outline" fullWidth class="min-h-11 rounded-xl bg-surface-inset">
```

Both write through the existing `POST …/shopping-lists/:listId/recipes`, whose
`ingredientIds` subset stays **optional** — omitted means the whole recipe, which is what
keeps an older client and a queued offline replay working. Do not start sending an explicit
full id list. Gating: `useEmailVerificationBlock()`, **not** `useCanMutate()` (§10.8) —
but a bulk add is a real write, so it *is* disabled offline: this panel takes `isOnline`
explicitly for the buttons, the same way list create/rename/delete does, because a queued
bulk add against a plan that has since changed would replay the wrong thing.

### 7.4 — `CardsCard.tsx` (restyled, NOT replaced, NOT deleted)

`1c` right rail: heading `Treuekarten` (22px serif) + a `Verwalten` link, then a
`flex gap-2.5` row of tiles — a real card tile
(`flex-1 aspect-[1.6] rounded-xl` with the card's gradient/label, `items-end p-2.5`,
`text-[13px] font-bold`) and a dashed `+ Karte hinzufügen` tile
(`border-[1.5px] border-dashed border-line-strong grid place-items-center text-[13px]
text-fg-subtle`). `1g` shows the same as one tile in the 2-up grid.

Three things must not change:
- **it stays on `/shopping`.** It is the only route to `/shopping/cards` on a phone (no
  sidebar below `lg`, the tab bar is full and about to lose Import to Plan). Deleting the
  panel orphans the wallet.
- **the cards half uses `useCanMutate()`**, the exact opposite of everything else on this
  screen (§10.8). `+ Karte hinzufügen` is an online-only, online-mutation write.
- **showing a barcode is a READ and is never gated** — not by `canMutate`, not by
  `unverified`. `CardDisplayDialog` opens offline, at the till, which is the whole point.
  `POST /api/cards/:id/used` behind it stays fire-and-forget.

The gradient tile: `Card` entities have no colour field. Render the existing chip styling
inside the tile shape rather than inventing a per-brand gradient — the `#2a5ea8→#1d3f75`
Payback blue in the mock is mock furniture, not a token (`SPEC.md` §2 says the same about
the recipe `tone` swatches). **[RECON]** Recommendation: `bg-surface-2` tile with the
label in `text-fg` and the symbology name in `text-fg-subtle`; one-line reason: a fake
brand gradient per card is a maintenance trap and would be wrong for every card that is
not Payback.

### 7.5 — `BoughtHistoryPanel.tsx`

```
desktop (1c)  <Card class="rounded-2xl p-5 flex flex-col gap-2.5">
├─ <div class="flex items-baseline">
│    <span class="font-display text-[22px] font-medium">"Einkaufshistorie"</span>
│    <AppLink class="ml-auto text-[13px] font-semibold text-brand-hover">"Alle"</AppLink>   ← §14.4
└─ <ul class="text-[13.5px] text-fg-muted">
   └─ <li class="flex justify-between border-t border-surface-2 py-[7px]">
        <span>{dayLabel}</span><span class="text-fg-subtle">"{n} Artikel · {name}"</span>

mobile (1g)   <Card radius="panel" class="p-4 flex flex-col gap-2 text-[13px] text-fg-muted">
├─ <span class="font-display text-[17px] font-medium text-fg">"Historie"</span>
└─ 3 × <span>"{dayLabel} · {n}"</span>
```

`dayLabel` is `Heute` for today and `formatDate`-style `Sa 30. Aug` otherwise — that is a
locale-aware **interface** format, so it goes through `lib/format.ts` (add
`formatShortWeekdayDate(iso)` using the existing per-locale `Intl` singleton `Map`; do not
construct a formatter per row — a history panel formats 3 dates but the same helper will
serve the planner's 7). Data comes from §4.3's workstream.

---

## 8 — Screen F · Shopping list detail (`1d` desktop / `1h` mobile)

File: `apps/web/src/features/shopping/ShoppingListDetailPage.tsx` — rewritten. All eight
hooks (`useShoppingList`, `useAddShoppingItems`, `useCheckShoppingItem`,
`useRemoveShoppingItem`, `useUpdateShoppingItem`, `useClearShoppingList`,
`useAddShoppingSuggestion`, `useDismissShoppingSuggestion`), the `useIsMutating` queued
counter, `detailsId`-by-id lookup, `EditItemDialog`, `ItemDetailDialog` and the clear
`ConfirmDialog` are kept.

### 8.1 — Desktop (`1d`)

```
root: flex flex-1 flex-col
└─ <div class="grid grid-cols-[minmax(0,1fr)_340px] gap-10 content-start">
   ├─ LEFT  flex min-w-0 flex-col gap-4.5
   │  ├─ AppLink to="/shopping"  text-[13px] text-fg-subtle  "← Alle Listen"
   │  ├─ <div class="flex items-end gap-4">
   │  │  ├─ <div class="min-w-0">
   │  │  │  ├─ <h1> font-display text-[38px] leading-[1.1] font-medium   {list.name}   ← truncate OK here
   │  │  │  └─ <p>  mt-1.5 text-sm text-fg-subtle
   │  │  │        "{open} offen · {boughtToday} heute gekauft · zum Abhaken antippen"
   │  │  └─ <div class="ml-auto flex shrink-0 gap-2">
   │  │     ├─ <Select> or <Button variant="outline" size="sm" class="min-h-[38px]">  "Sortierung: neueste"  ← §14.2
   │  │     └─ <Button variant="outline" size="sm" class="min-h-[38px]">"Teilen"</Button>   ← §14.1
   │  ├─ <AddItemBar placement="inline"/>          ← THE ADD BAR MOVES TO THE TOP on desktop
   │  ├─ <SectionHeader tone="muted" label="Zu kaufen" trailing={open}/>
   │  ├─ <ul class="flex flex-col gap-1.5">
   │  │   └─ <ShoppingItemCard>  × items                ← restyled, see §8.3
   │  ├─ <SectionHeader tone="success" label="Heute gekauft"
   │  │        trailing={<button class="text-xs font-semibold text-brand-hover">"Gekauftes leeren"</button>}/>
   │  └─ <BoughtSection layout="rows" entries={bought}/>
   └─ RIGHT  <aside class="flex flex-col gap-6.5 pt-11">
      │        (pt-11 = 1d's `padding-top:44px`, which clears the h1 block)
      ├─ <FrequentlyUsed>                ← restyled + RELOCATED, see §8.5
      ├─ <ListRecipesPanel>              ← NEW, see §8.6
      └─ loyalty card row: <span class="font-display text-xl font-medium">"Treuekarten"</span>
         + one compact tile per card, `Barcode zeigen` on the right — reuse
           `CardsCard`'s tile with a `layout="row"` prop rather than a second component
```

`grid-cols-[minmax(0,1fr)_340px]`: the left track holds the add input and must be able to
shrink (§10.6). `content-start` reproduces `1d`'s `align-content:start`.

**`AddItemBar` gains `placement?: "docked" | "inline"`.** `1d`'s caption says "add bar on
top" and draws it under the header: a 52px `rounded-xl border-line-strong bg-surface`
row with a leading `Plus` glyph, the placeholder, and a 40px `rounded-lg bg-brand` "Add"
pill on the right. `"inline"` renders exactly that, in flow, with **no** sticky, no bleed
and no negative margins. `"docked"` is today's behaviour, restyled per §8.4. The page picks
by `wide`, which it already computes.

### 8.2 — Mobile (`1h`)

```
root: flex flex-1 flex-col gap-3.5
├─ <div class="flex items-center gap-2.5 text-[13px] text-fg-subtle">
│  ├─ AppLink to="/shopping" "← Listen"
│  └─ <button class="ml-auto font-semibold text-brand-hover">"Teilen"</button>       ← §14.1
├─ <div>
│  ├─ <h1> font-display text-[30px] leading-[1.05] font-medium  {list.name}
│  └─ <p>  mt-1 text-[13px] text-fg-subtle
│         "{open} offen · {boughtToday} gekauft · zum Abhaken antippen"
├─ the unverified / offline banner   ← kept verbatim (see §10.8)
├─ <SectionHeader tone="muted" label={`Zu kaufen · ${open}`}/>
├─ <ul class="grid grid-cols-2 gap-2">  <ShoppingItemTile/> × items   ← §8.3, §10.6
├─ <p class="text-xs text-fg-muted">  the long-press hint — kept
├─ <SectionHeader tone="success" label={`Heute gekauft · ${boughtToday}`}
│        trailing={<button aria-expanded>▾</button>}/>            collapse, default OPEN
├─ <BoughtSection layout="tiles" collapsed={…}/>
├─ <div class="flex-1"/>                                          ← THE SPACER (§10.4)
└─ THE BOTTOM BAR
   <div class="bottom-tabbar sticky z-20 -mb-4 bleed-gutter-inset flex flex-col gap-2.5 pt-7 pb-5
               bg-[linear-gradient(to_top,var(--bg)_70%,transparent)]">
   ├─ <ul class="scroll-x no-scrollbar flex gap-2">              ← the chip row, §8.5
   └─ <AddItemBar placement="docked"/>                            ← 54px, rounded-2xl, shadow-pop
```

`-mb-4` swallows the 1rem of breathing room inside `<main>`'s `pb-tabbar`, or a strip of
page background shows under a bar whose gradient is supposed to reach the tab bar.
`bleed-gutter-inset`, **never** `-mx-4` (§1.1) and **never** `px-4 px-safe` on the same
element — `.px-safe` is a flat override emitted after Tailwind and would leave the bar with
no horizontal padding at all.

### 8.3 — `ShoppingItemCard.tsx` / `ShoppingItemTile.tsx` (both restyled)

**Card (desktop row, `1d`):**
`grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-3.5 min-h-14 rounded-xl
border border-surface-2 bg-surface px-4 py-2 hover:border-line-strong`.
- col 1: `text-[15px] font-semibold tabular-nums text-right`, `text-accent` for a real
  amount / `text-fg-subtle` when `isVagueAmount(item)`.
- col 2: `<span class="min-w-0">` → name `block text-base font-medium`, note
  `block truncate text-[12.5px] text-fg-subtle`.
- col 3: **the `from` provenance label**, `text-xs text-toon-sand-600`. `1d` shows one
  recipe name, not today's `"Aus: a, b"`: render `item.sources[0].title` truncated to the
  column, plus `+{n-1}` when there are more. Empty when `sources` is empty.
- the whole row stays the check-off `<button>`; the `ticking` beat
  (`border-success bg-success-soft opacity-70`) stays.
- the overlaid edit/remove `IconButton`s stay (desktop has the room) — the `pr-24` /
  `pr-4` swap becomes `pr-2`, since col 3 now occupies the right edge: put the buttons in
  a fourth `auto` track that only renders when `canMutate && !pending`, rather than
  absolutely positioning them over the provenance label.

**Tile (mobile, `1h`):** `flex flex-col gap-0.5 min-w-0 rounded-xl border border-surface-2
bg-surface px-3 py-2.5`.
- name: `text-[15px] font-medium leading-[1.25]`
- second line: `text-xs tabular-nums text-accent` for the amount + `<span
  class="text-fg-subtle"> {note}</span>`
- **the design truncates both lines to one** (`white-space:nowrap;text-overflow:ellipsis`).
  Today's tile uses `line-clamp-3` on an 18px name. **Recommendation: `line-clamp-2` on the
  name, `truncate` on the amount line** — one-line reason: at 173px a truncated German
  compound is unreadable at a shelf (`Rinderhackfl…`), and this is the one screen whose
  whole job is being readable in a supermarket. Set `min-h-[4.5rem]` so a 1-line and a
  2-line tile keep the grid even. This is a *deliberate 1-line deviation from the artboard*
  — flag it in the PR; if the owner prefers the artboard, `truncate` on both lines is the
  literal transcription.
- `useLongPress` → `ItemDetailDialog` stays, including the `sr-only` fallback button and
  the `press.consume()` guard.
- **`line-clamp-2` must not be paired with a `block` utility** — `line-clamp-N` works by
  setting `display:-webkit-box` and a `block` on the same element silently wins (§10.1).

### 8.4 — `AddItemBar.tsx` (restyled, two placements)

Both placements keep: the parser preview line, `parseShoppingInputBlock` on submit,
refocus after submit, `enterKeyHint="done"`, `disabled` from the page.

- `placement="inline"` (desktop, `1d`): `flex items-center gap-2.5 rounded-xl border
  border-line-strong bg-surface pl-4 pr-1.5 min-h-[52px]` with a leading `Plus` glyph in
  `text-fg-subtle`, the `<Input>` unstyled-in-place (`border-none bg-transparent`), and a
  `h-10 rounded-lg` primary "Hinzufügen" button. No sticky, no bleed.
- `placement="docked"` (mobile, `1h`): the same shape at `min-h-[54px] rounded-2xl
  shadow-pop`, with a 42px square `rounded-lg bg-brand` `+` button instead of a labelled
  one. It no longer owns the sticky positioning: the **bar wrapper** in the page (§8.2)
  owns `bottom-tabbar sticky -mb-4 bleed-gutter-inset`, because the chip row has to sit
  inside the same gradient. Remove the `-mx-4 -mb-4 border-t bg-surface/95 backdrop-blur`
  from the component and its comment block with them; move that comment (updated) onto the
  page's wrapper.

The parser preview line still renders under the field in `placement="inline"`. In
`placement="docked"` it renders *above* the field inside the bar wrapper, so it does not
grow the bar downwards over the tab bar.

### 8.5 — `FrequentlyUsed.tsx` (restyled, relocated, and the `×` is deleted)

Two placements again, and neither is where it sits today (below the list):
- desktop → the right rail, under a `font-display text-xl font-medium` "Häufig gekauft"
  heading with `Alle {n} anzeigen` (`text-[12.5px] font-semibold text-brand-hover`) on the
  right, then `flex flex-wrap gap-2` of chips.
- mobile → a `scroll-x no-scrollbar flex gap-2` row **inside the bottom bar**, chips
  `h-9 shrink-0`.

Chip: `flex h-[38px] items-center gap-1.5 rounded-full border border-line bg-surface
pl-2.5 pr-3.5 text-[13.5px] font-medium text-fg-body`, `hover:border-brand
hover:text-brand-soft-fg`, with a leading `Plus class="size-3.5 text-fg-subtle"`.
Mobile chips are `h-9 px-3.5 text-[13px]` and render the `+` as part of the label row.

**The per-chip `×` is removed.** It is `SPEC.md` §4.6's stated fix for chip clutter.
Dismissal moves to long-press / right-click, which this feature already has a hook for:
reuse `features/shopping/lib/useLongPress.ts` on the chip and also wire
`onContextMenu` (with `preventDefault`) to the same handler, then confirm through a small
`ConfirmDialog` — a long press that silently deletes a suggestion is worse than the `×`
was. The hint line `Rechtsklick oder langes Drücken versteckt einen Vorschlag.`
(`text-xs text-toon-sand-600`) is what advertises it; it is drawn on `1d` only.

**Selection and ordering are two different things** and the code must say which is which:
the *top 8 by `useCount`* are selected (server-side, existing ranking), then they are
*displayed alphabetically*. Alphabetical over German names must fold umlauts with
`foldText()` from `@toon/shared` and not `localeCompare` alone, or `Ä` sorts after `Z`.
Put the sort in `packages/shared/src/shopping.ts` (`sortCatalogAlphabetically`) with a unit
test, per `SPEC.md` §5 — not in the component. `hidden_at` and the `Alle {n} anzeigen`
destination belong to §4.6's workstream; this component takes `entries` and
`totalCount` as props.

### 8.6 — `ListRecipesPanel.tsx` — NEW, and it needs data nothing else specifies

`1d` draws rows of `44px thumb · serif title 15px · "5 von 5 Zutaten · 4 Portionen" ·
Entfernen`, then a dashed `+ Zutaten eines Rezepts hinzufügen` button.

**`SPEC.md` §4 does not cover this panel and two of its three facts are not stored:**
"5 **von 5** Zutaten" needs the recipe's total ingredient count, and "4 Portionen" needs
the servings used *at add time*, which no column records.

**Recommendation (no schema change):** derive the panel entirely from
`item.sourceRecipeIds` / `item.sources`, which the list detail payload already carries.
Group items by source recipe id, take the title from `sources`, and render
`"{n} Zutaten auf der Liste"` — dropping "von 5" and the Portionen. `Entfernen` removes
the items whose **only** source is that recipe (a merged line belonging to two recipes
stays, and the button's confirm copy says so). The dashed button opens the existing
`AddRecipeToListDialog`. One-line reason: the panel's value is "what is this list for",
which provenance already answers; the two missing numbers would each cost a column.
Flag it as a gap in the PR — if the owner wants the literal artboard, `4 Portionen` needs
`shopping_list_recipes(list_id, recipe_id, servings, added_at)`, which is a table
`SPEC.md` never asked for.

### 8.7 — `BoughtSection.tsx` — NEW

```
layout="rows" (1d)   <ul class="flex flex-col">
  <li class="grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-3.5 min-h-11
             px-4 py-1 text-fg-subtle">
    <span class="text-right text-sm tabular-nums">{qty}</span>
    <span class="min-w-0 truncate text-[15px] line-through">{name}</span>
    <span class="shrink-0 text-xs text-toon-sand-600">"{who} · {when}"</span>
  no card, no border — the absence of a surface is what separates it from "Zu kaufen"

layout="tiles" (1h)  <ul class="grid grid-cols-2 gap-2">
  <li class="flex min-w-0 flex-col gap-0.5 rounded-xl border border-surface-2 px-3 py-2.5 text-fg-subtle">
    <span class="truncate text-[15px] line-through">{qty} {name}</span>
    <span class="text-xs text-toon-sand-600">"{who} · {when}"</span>
  bordered, NO background — 1h's tile has `border` and no `bg`, which is the whole
  visual difference from a to-buy tile
```

`{who}` is the buyer's first name, `{when}` is `formatRelative(boughtAt)` (`gerade eben`,
`vor 10 Min.`, `vor 2 Std.`) — interface formatting, already in `lib/format.ts`.
`collapsed` (mobile only) is local `useState`, default **open**: the section is the
feedback for the tap that just happened, so it must be visible the first time.

Both layouts render **nothing at all** (not an empty state) when there are no bought
entries — `1d`/`1h` both have entries, and an empty "Heute gekauft" header with nothing
under it on a fresh list is noise. Hide the `SectionHeader` with it.

### 8.8 — `Gekauftes leeren` must not delete history

`SPEC.md` §4.3 already flags this: it clears the *section*, not the log the overview's
history panel reads. From this screen's side that means the action is **not**
destructive-red and its confirm copy says "aus dieser Ansicht entfernen", not "löschen".
The watermark-vs-`cleared_at` decision belongs to §4.3's workstream.

---

## 9 — Component disposition: restyled · replaced · new · dead

| File | Fate |
| --- | --- |
| `features/recipes/RecipeListPage.tsx` | **rewritten** (A, B) — hooks kept, markup new |
| `features/recipes/RecipeDetailPage.tsx` | **rewritten** (C, D) — logic kept, two branches |
| `features/recipes/components/RecipeCard.tsx` | **DEAD — delete.** The redesign has no card grid anywhere; the "Try next: make 1a a grid instead of rows" line confirms rows are the decision. Grep first: `CollectionDetailPage.tsx` renders its own row, not this. |
| `features/recipes/components/RecipeRow.tsx` | **replaced** by `RecipeEditorialRow.tsx`. Delete after migrating; check `CollectionDetailPage.tsx:206` (its own markup — same 64px thumb; bring it onto `RecipeEditorialRow` in the extrapolation pass, not here). |
| `features/recipes/components/RecipeFilters.tsx` | **replaced** by `RecipeFilterRail` + `RecipeFilterSheet`. Keep and re-export `countActiveFilters` from the rail module — nothing else imports the component. |
| `features/recipes/components/IngredientList.tsx` | restyled (§5.1) |
| `features/recipes/components/StepList.tsx` | restyled (§5.3) |
| `features/recipes/components/ServingsScaler.tsx` | restyled + `size` prop (§5.2) |
| `features/recipes/components/CookMode.tsx` | **unchanged in this spec** — extrapolation pass. Keep its `px-safe` (it is a full-screen overlay whose only padding IS the inset). |
| `features/recipes/lib/format.ts` | `SORT_LABELS` gains `lastCooked` when §4.2 lands. `optionalMinutes` / `optionalServings` / `groupBySection` unchanged. |
| `features/recipes/lib/url-filters.ts` | `SORTS` gains `"lastCooked"`. **No new URL param** (§3.1). |
| `features/shopping/ShoppingListsPage.tsx` | **rewritten** (E) — dialogs kept |
| `features/shopping/ShoppingListDetailPage.tsx` | **rewritten** (F) — all hooks kept |
| `features/shopping/components/ShoppingItemCard.tsx` | restyled (§8.3) |
| `features/shopping/components/ShoppingItemTile.tsx` | restyled (§8.3) |
| `features/shopping/components/AddItemBar.tsx` | restyled + `placement` prop (§8.4) |
| `features/shopping/components/FrequentlyUsed.tsx` | restyled, relocated, `×` deleted (§8.5) |
| `features/shopping/components/ItemDetailDialog.tsx` | restyled only (type steps + radii); its close-then-act + `requestAnimationFrame` stays |
| `features/shopping/components/EditItemDialog.tsx` | restyled only |
| `features/shopping/components/AddRecipeToListDialog.tsx` | restyled only. Its `<fieldset class="min-w-0">` already exists — do not remove it. Its EXCLUDED-set tracking stays (a recipe that gains a line stays all-on). |
| `features/cards/components/CardsCard.tsx` | restyled (§7.4), **never deleted** |
| `components/ui/Tabs.tsx` | `tone` prop added |
| `components/ui/Card.tsx` | `radius` prop added |
| `components/ui/Skeleton.tsx` | `SkeletonList` variants `"editorial"` / `"tiles"` added; `"cards"` and `"rows"` become **dead** once `RecipeCard`/`RecipeRow` go — delete them in the same commit or the union lies about what the app can render |
| `components/layout/AppShell.tsx` | width tokens + `PageColumn` export (§1) |
| `components/layout/{SideNav,TopBar,BottomTabBar,nav-items}.tsx` | shell workstream; this spec only requires §1's width change and §4.1's TopBar note |
| `styles/index.css` | two new utilities (§1.1), `--container-content`, `--spacing-sidebar`, `--radius-panel` |

---

## 10 — Cross-cutting rules the artboards force

### 10.1 — TITLES NEVER TRUNCATE, and the fix is REMOVAL

`SPEC.md` §1 source 3: *"Titles never truncate: editorial rows give titles a full line."*
So `RecipeEditorialRow`'s `<h3>` carries **no** `line-clamp-*`, **no** `truncate`, **no**
`overflow-hidden`, and **no** fixed row height. `text-pretty` (and `text-balance` on the
detail `<h1>`) is the only text-flow utility on them.

The trap next door: **`block` beats `line-clamp-N`.** `line-clamp-N` works by setting
`display:-webkit-box`, and a `block` utility on the same element wins in the cascade and
silently kills the clamp. That matters here in the *opposite* direction from usual — the
temptation when a title looks long is to "keep the clamp and add `block` for the
breakpoint", which produces a clamp that does nothing and a reviewer who cannot see why.
**For titles the answer is to delete the clamp, not to reorder it.** Where a clamp is still
right (`ShoppingItemTile`'s name, `GroupsPage`, `CollectionsPage`) it must be the only
`display` utility on that element.

Current sites to strip: `RecipeCard.tsx:67` (`line-clamp-2` on the title — the file goes
anyway), `RecipeRow.tsx:59` (`line-clamp-2` on the title — replaced),
`RecipeCard.tsx:72` (description clamp — the editorial row lets the description wrap).

### 10.2 — The `sm` branch is IN JS, and the skeleton must match it

`useIsWideViewport()` (`lib/viewport.ts`, `(min-width: 40rem)`) picks *one* markup tree.
It is not decoration: a `display:none` `<img>` is still fetched, so rendering the desktop
row and the mobile row together would load every recipe's thumbnail twice — 24 per page.
Keep the JS branch on: the recipe list (A/B), the recipe detail (C/D), the shopping list
detail's items (F). The ONE exception is a text-only branch with no images —
`ShoppingListPreviewCard`'s item preview (§7.1) — where `sm:hidden` is allowed and
cheaper.

`SkeletonList`'s `variant` must match whichever branch will replace it, or the list
visibly jumps when data lands: `"editorial"` for A and B (84px square + 3 bars),
`"tiles"` for F's mobile grid, and F's desktop keeps its existing `h-18` row skeletons.
The current `<div class={wide ? "flex flex-col gap-2" : "grid grid-cols-2 gap-2"}>`
skeleton block in `ShoppingListDetailPage` already gets this right — keep the pattern.

### 10.3 — List images are `thumbnailUrl()`, never `imageUrl`

A hero is routinely 2–5 MB and a list asks for 24 of them. `thumbnailUrl(recipe)` from
`lib/api.ts` (480px WebP, ~30 KB, falls back to `imageUrl`) covers **every** image in
this spec except the two detail heroes:

| Image | Source |
| --- | --- |
| library editorial row, 84px square (A, B) | `thumbnailUrl()` |
| planner day-card thumb, if the planner adds one (A, B) | `thumbnailUrl()` |
| "Kürzlich gekocht" shelf card (A) | `thumbnailUrl()` |
| "Aus dem Wochenplan" 36px row thumb (E desktop) | `thumbnailUrl()` |
| "Aus dem Wochenplan" 52px mobile thumb (E mobile) | `thumbnailUrl()` |
| "Rezepte auf dieser Liste" 44px thumb (F desktop) | `thumbnailUrl()` |
| **recipe detail hero, `1a` 420px 4:3 (C)** | `mediaUrl(recipe.imageUrl)` |
| **recipe detail hero, `1f` 300px full-bleed (D)** | `mediaUrl(recipe.imageUrl)` |

Every `<img>` in a list also carries `loading="lazy" decoding="async"` and a
`bg-surface-2` ground, and every image slot has the `UtensilsCrossed` fallback rather
than a broken `<img>`.

### 10.4 — Bottom bars: two new instances of two traps

`1f` (Kochmodus + Gekocht) and `1h` (chips + add bar) are both bottom bars, and both trip
the same two rules:

1. **`.bottom-tabbar`, never `bottom-0`.** `BottomTabBar` is `fixed inset-x-0 bottom-0
   z-30` and `AppShell` renders it *after* `<main>`, so a `bottom-0` bar inside a page is
   painted underneath it and simply cannot be tapped on a phone. That is exactly what hid
   Speichern/Verwerfen on the import review screen and made a URL import uncommittable
   from a phone. `.bottom-tabbar` resets to `bottom:0` from `lg`. Prefer `sticky` over
   `fixed` so the bar stays in flow and `pb-tabbar` on `<main>` is all the clearance
   needed. **Grep `bottom-0` before adding a bar.**
2. **A sticky bottom bar needs an unbroken flex chain plus a `flex-1` spacer**, or it
   floats mid-screen on a short page (empty list, short recipe — the common case). The
   chain: `AppShell`'s column `min-h-dvh` → `<main>` `flex-1 flex flex-col` → page root
   `flex flex-1 flex-col` → a `<div class="flex-1"/>` immediately above the bar.
   **`min-h-full` on the page root is NOT equivalent** — a percentage min-height needs a
   definite parent height and a flex-grown item is not one; Chromium leaves the root at
   its content height (493px inside a 695px `<main>`) and the bar stays put. The comment
   in `AddItemBar.tsx` currently *says* `min-h-full`; the code correctly uses `flex-1`.
   Fix the comment while you are in the file.

Difference between the two: `1f`'s bar is **inset** (no bleed, no `-mb-4`), `1h`'s is
**full-bleed with a gradient** (`bleed-gutter-inset -mb-4`). Do not copy one onto the
other.

### 10.5 — Page roots re-apply nothing

`AppShell`'s `<main>` already applies `mx-auto max-w-content px-gutter pt-4 pb-tabbar`
(`max-w-5xl` before §1). **No page root re-applies any of the four.** Roots in this spec
are `flex flex-col gap-*` or `flex flex-1 flex-col gap-*` and nothing else. Ten pages had
drifted back to `pb-tabbar` once — on the shopping list that stranded the sticky add bar a
whole tab-bar height above the tab bar — and the tree is currently clean (verified: no
`.tsx` outside `AppShell` and `styles/index.css` mentions it). **Do not add an eleventh.**

Where a page needs to escape the gutter it uses `.bleed-gutter` / `.bleed-gutter-inset`
(§1.1), never `-mx-4`, and never a second `px-*` next to `px-safe`.

### 10.6 — 390px safety

The two riskiest layouts in the design are `1h`'s 2-up item grid and `1f`'s 4-up stat
grid. Budget: `390 − 2×16 = 358px` of content.

- **`minmax(0,1fr)`, never a bare `1fr`, for any track that holds a control.** A form
  control's intrinsic width is ~20 characters (~200px with our padding) and a grid/flex
  item's automatic minimum size is its content's min-content width, so `w-full` alone does
  not let an input shrink. Tailwind's `grid-cols-N` already expands to
  `repeat(N,minmax(0,1fr))` — use it and do not "clarify" it into `[1fr_1fr]`. Explicit
  templates in this spec that hold controls all say `minmax(0,1fr)`:
  `grid-cols-[220px_minmax(0,1fr)]` (A), `grid-cols-[minmax(0,1fr)_420px]` and
  `grid-cols-[400px_minmax(0,1fr)]` (C), `grid-cols-[1.25fr_minmax(0,1fr)_minmax(0,1fr)]`
  (E), `grid-cols-[minmax(0,1fr)_340px]` and `grid-cols-[64px_minmax(0,1fr)_auto]` (F).
- **`min-w-0` on every grid/flex item that holds arbitrary content** — a recipe title, a
  German item name, a horizontal scroller. `controlClasses` in `components/ui/Input.tsx`
  already carries `min-w-0`; do not remove it.
- **a `<fieldset>` needs `min-w-0` EXPLICITLY.** It carries the browser's own
  `min-inline-size: min-content`, so it ignores the rule you would apply to any other
  item — which is how the tag row in "Erweiterte Suche" grew its fieldset to 580px on a
  390px phone and made the whole page scroll sideways. Both `RecipeFilterRail`'s fieldsets
  and `RecipeFilterSheet`'s need it, and `AddRecipeToListDialog`'s existing one must not
  lose it.
- 2-up tile grid arithmetic: `(358 − 8) / 2 = 175px` per tile. 4-up stat grid:
  `(358 − 24) / 4 = 83.5px` per cell. Both are tight; §6.1 and §8.3 say what gives.

### 10.7 — Verify in a real browser, not by reading classes

Both of the layout bugs the gotchas describe measured wrong on the first attempt and only
screenshots showed it. There is no browser tooling in this repo on purpose; install
Playwright in a scratch dir outside it, log in with a `fetch` to `/api/auth/login` from the
page context, then assert at 390×844:
`documentElement.scrollWidth === clientWidth` (no horizontal overflow),
`getComputedStyle(main).padding*`, and the gap between each bottom bar and `nav.fixed`.
**Do not match the tab bar by its `aria-label`** — `SideNav` carries the same one and,
being `display:none` on a phone, reports an all-zero rect that reads as a plausible wrong
number. Screens to check: B, D (hero bleed + 4-up grid + bottom bar), F mobile (2-up grid
+ gradient bar + chip scroller), E mobile (2-up card grid).

### 10.8 — `useCanMutate()` vs `useEmailVerificationBlock()`, per screen

`useCanMutate()` returns **false when offline**, which is backwards for the one feature
that works offline. Per screen:

| Screen | Gate | Why |
| --- | --- | --- |
| A, B (library) | `useEmailVerificationBlock() === undefined` → `canCreate` | today's behaviour; the create links are `<a>`s and are **hidden**, not disabled, because a link cannot carry a disabled state or a tooltip |
| C, D (detail) | `canModifyOwn(role, user.id, recipe.createdBy) && unverified === undefined` | today's `canEdit`. Deliberately **not** `useCanMutate()`: this screen keeps its edit entry point visible without a signal and the form refuses the save. "Zur Einkaufsliste" is *disabled* with `title={unverified}` (the dialog's whole job is a write). "Gekocht" and "Für einen Tag planen" are **online-only** writes → also gated on `isOnline`, like list create. |
| E (overview) | `canManage = isOnline && unverified === undefined` for list create/rename/delete and for the bulk plan add; `manageHint = unverified ?? offlineHint` with the address winning | today's behaviour, unchanged. A signal comes back on its own; a confirmation click does not. |
| E — the `CardsCard` half | **`useCanMutate()`** | opposite rule: card writes are ordinary online mutations with no outbox. Showing a barcode is a read and is never gated. |
| F (list detail) | **`useEmailVerificationBlock()` ONLY** → `canMutate` | items are the offline-editable feature. `useCanMutate()` here would disable the screen in the shop. The unverified banner wins over the offline banner in the copy. |
| F — "Gekauftes leeren", "Teilen", the sort control | `canMutate` (unverified) — they are cheap and idempotent | `Gekauftes leeren` is an online-only write in practice; gate it on `isOnline` too and say so in its `title`, the same way list create does |

An unverified account must never be able to *queue* a shopping mutation: the server 403s
it and it can never succeed, so it must not enter the outbox at all. That is why F takes
`useEmailVerificationBlock()` **directly** rather than folding it into `canMutate` from
`useCanMutate()`.

### 10.9 — Offline state on the list: what a queued check-off looks like

Today, `removeFromCache(current, itemId, { asBought: true })` in
`features/shopping/lib/offline.ts` deletes the item from the cached detail payload and
bumps (or invents) a `pending:` catalog entry, so a checked item vanishes from the grid and
appears under "Häufig gekauft" — the online behaviour, reproduced offline. **The new
"Heute gekauft" section makes that incomplete: an item would leave the To-buy grid and
appear nowhere.**

Required change in `offline.ts`'s `check` default (§4.3's wire shape is the other
workstream's; this is the client half):

1. `onMutate` prepends a synthetic bought entry to the payload's new `bought` array:
   `{ id: "pending:" + itemId, name, quantity, unit, boughtBy: <the current user's own
   name>, boughtAt: new Date().toISOString() }`. The item is removed from `items` and the
   catalog bump stays exactly as it is.
2. On screen: the tile leaves "Zu kaufen", the two header counts change
   (`{open} offen · {boughtToday} gekauft`), the progress bar fill grows, and a
   struck-through row/tile appears under "Heute gekauft" reading **"Du · gerade eben"**
   (the current user, because the server has not told us who yet — and it will agree, since
   it is this session doing the write).
3. That row is **not interactive while pending**: `isPendingItemId(entry.id)` is true, it
   has no server id, so no undo affordance and no `Gekauftes leeren` participation. It
   renders at `opacity-70` — the same visual language `ticking` already uses.
4. The header's existing `useIsMutating({ mutationKey: ["toon","shopping"] })` counter
   already renders `{n} wartet` with a `WifiOff` glyph next to the counts. Keep it — it is
   the only thing on screen that says the state is not yet the server's.
5. It survives a reload because it lives in the persisted TanStack blob
   (`shouldPersistQuery` already allows `["toon","group",…,"shopping-list",…]`), and
   `resumePausedMutations()` replays the delete on reconnect. **The detail payload gains a
   field, so `PERSIST_BUSTER` in `lib/persist.ts` must be bumped** (`v2` → `v3`) or a
   restored blob feeds the new UI a payload with no `bought` array.
6. The four things that make offline editing safe are untouched: `setMutationDefaults`
   registration by mutation key, `networkMode:"offlineFirst"`, `shouldPersistMutation`
   persisting only paused `["toon","shopping",…]` mutations, and the client-minted
   `mutationId` generated at **call** time. The log append happens inside the same
   mutation, so `mutationId` idempotency already covers it — drop that and a request that
   reached the server but lost its response is applied twice, and because items MERGE the
   symptom is "500 g Mehl" quietly becoming "1 kg".
7. `/api/groups/:groupId/shopping-lists` stays `NetworkOnly` in the service worker. A
   `NetworkFirst` hit would hand TanStack a stale body that looks like a fresh success and
   `onSuccess` would write it over the optimistic state — silently un-ticking items the
   user just checked off. The new bought/history reads must **not** be added to
   `runtimeCaching` either.

### 10.10 — Offline reads these screens need on the allow-list

`shouldPersistQuery` is an **allow**-list keyed on the 4th segment
(`PERSISTED_GROUP_SEGMENTS` in `lib/persist.ts:163`), so a new endpoint is excluded until
listed. Currently listed: `recipes recipe tags collections collection detail
shopping-lists shopping-list` (+ `me`/bootstrap and `cards`).

- **`"plan"` must be added** or the library's week strip (A, B) is blank on a cold offline
  start while every recipe row around it renders — which reads as a bug, not as "no
  signal". The planner is *written* online-only; that is a different question from being
  *read* offline.
- **bought history** (`"bought-history"` or whatever §4.3 names it): recommend **not**
  persisting. It is a review screen, not a shopping screen, and a stale "Heute · 4
  Artikel" is misleading in a way an absent panel is not.
- The bought-today entries on the list detail come inside the existing `shopping-list`
  payload, so they are already covered — which is another reason §4.3 should put them
  there rather than on a second endpoint.
- `PERSIST_BUSTER` bumps once, for the payload shape change (§10.9).

### 10.11 — Type scale, as used by these six screens

For reference while implementing; the foundations workstream owns the font families. Every
quantity (`tabular-nums`) and every eyebrow is listed.

| Role | Size / weight / tracking | Where |
| --- | --- | --- |
| display 46 | `font-display text-[46px] leading-[1.05] font-medium tracking-[-0.01em]` | C `<h1>` |
| display 38 | `font-display text-[38px] leading-[1.1] font-medium` | A/E/F desktop `<h1>` |
| display 34 | `font-display text-[34px] leading-[1.05] font-medium` | B/E mobile `<h1>` |
| display 30 | `font-display text-[30px] leading-[1.05] font-medium` | F mobile `<h1>`; C step numeral (`leading-none text-brand`) |
| display 28 | `font-display text-[28px] leading-[1.1] font-medium` | D `<h1>` (over the hero) |
| display 24 | `font-display text-2xl font-medium` | C section `<h2>` (Zutaten / Zubereitung) |
| display 22 | `font-display text-[22px] font-medium` | E desktop panel titles, list name |
| display 21 | `font-display text-[21px] leading-[1.2] font-medium` | A editorial title; E mobile list name |
| display 20 | `font-display text-xl font-medium` | A/B section `<h2>`; F rail panel titles; C stat value |
| display 17 | `font-display text-[17px] leading-[1.2] font-medium` | B editorial title; D stat value; E mobile panel title |
| display 15 | `font-display text-[15px] font-medium` | thumbnail row titles (E, F rails) |
| display 13.5 | `font-display text-[13.5px] leading-[1.25] font-medium` | planner day-card title |
| eyebrow | `text-[10.5px]`–`text-xs` `font-bold uppercase tracking-[.06em]`–`[.08em]` | course eyebrow (`text-accent`), section headers (`text-toon-sand-600` / `text-success`), stat labels |
| body 16.5 | `text-[16.5px] leading-[1.6] text-fg-body` | C step text |
| body 16 | `text-base leading-[1.55]` | C description; F desktop item name |
| body 15 | `text-[15px] leading-[1.35]` | ingredient rows; F item name mobile |
| body 14 / 13.5 / 13 / 12.5 / 12 / 11 | `text-sm` … `text-xs` … `text-[11px]` | metas, subtitles, provenance |

`font-variant-numeric: tabular-nums` on: ingredient amounts, item amounts, stat values,
sidebar/section counts, progress percentages, the servings output. Tailwind's
`tabular-nums` utility.

---

## 11 — German copy needed, per screen

**Do not invent keys** — a later agent owns the key inventory. These are the strings, with
context. New copy has no base-tree counterpart, so `i18n:check` parity will flag every one
of them; that is expected (read the output, never the exit code). One key per **whole
sentence**, never per fragment — several of these assemble a `·`-joined line from parts and
must be **one** key with placeholders, or a language with different word order cannot be
translated.

**Screen A + B (library)**

| String | Context |
| --- | --- |
| `Rezepte` | `<h1>` — already exists as `recipes.list.title` |
| `{count} Rezepte durchsuchen` | search placeholder, plural |
| `Filter` | mobile sheet trigger |
| `Diese Woche` | week-strip heading |
| `Planen →` | link to `/plan` (the arrow is part of the string) |
| `+ Planen` | empty day-card title |
| `Kürzlich gekocht` | shelf heading |
| `Alle Rezepte` | list heading |
| `Gänge` | filter-rail legend (the **heading** is interface; the course *names* are CONTENT and never go through `t()`) |
| `Tags` | filter-rail legend — exists |
| `Mehr Filter` | disclosure |
| `{time} · {servings}` | editorial row meta — ONE key, both placeholders |
| `Geteilt mit {group} · {members} Mitglieder · {recipes} Rezepte` | desktop subtitle — ONE key |
| `Neues Rezept`, `Importieren`, `Mehr laden`, `{shown} von {count}` | exist |

**Screen C + D (detail)**

| String | Context |
| --- | --- |
| `Für einen Tag planen` | header button (desktop) |
| `Zur Einkaufsliste` | header button — exists as `recipes.detail.addToShoppingList` |
| `Gekocht` | header button / mobile square button label |
| `Als gekocht markieren` | the mobile square button's `aria-label` |
| `Zuletzt gekocht` | stat label |
| `Gekocht` | mobile stat label (4th cell) — same word, different slot; may share the key |
| `Portionen` / `Vorbereitung` / `Kochen` / `Gesamt` | stat labels — exist |
| `Zutaten` / `Zubereitung` | section headings — exist as `recipes.ingredients.heading` / `recipes.steps.heading`; note `1a` says "Method", i.e. `Zubereitung`, not `Schritte` |
| `{count} Schritte` | step count |
| `Kochmodus` | primary button — exists |
| `Alle {count} zur Einkaufsliste` | ingredients-card button, plural |
| `Alles zur Liste` | mobile short form of the same action |
| `Zutaten · {count}` / `Zubereitung · {count}` | the two mobile tab labels — ONE key each |
| `von {author}, {date}` | byline tail — exists as `recipes.detail.byline` |
| `Zurück` | hero back button `aria-label` |

**Screen E (shopping overview)**

| String | Context |
| --- | --- |
| `Einkauf` | `<h1>` — today's is `Einkaufslisten`; the design shortens it |
| `Geteilt mit {group} · {count} Mitglieder · {synced}` | desktop subtitle — ONE key |
| `vor {time} synchronisiert` / `{name} kauft gerade ein` | **OPEN ITEM** §14.3 — do not build until decided |
| `+ Neue Liste` | primary action (the `+` is part of the string) — `Neue Liste` exists |
| `{open} offen · {bought} heute gekauft` | list card counts — ONE key, both plural |
| `Öffnen →` | list card link |
| `+{count} weitere` | preview overflow |
| `Aus dem Wochenplan` | panel title |
| `{recipes} Rezepte · {ingredients} Zutaten noch auf keiner Liste` | panel subtitle — ONE key |
| `{ingredients} Zutaten noch auf keiner Liste` | mobile subtitle variant |
| `{weekday} · {count} Zutaten` | plan row meta — ONE key |
| `Hinzufügen` | per-recipe add |
| `Alles zu {list} hinzufügen` | bulk add |
| `Treuekarten` | cards panel title — today's is `Karten`; the design lengthens it |
| `Verwalten` | cards panel link |
| `+ Karte hinzufügen` | dashed tile |
| `Einkaufshistorie` / `Historie` | history panel title (desktop / mobile) |
| `Alle` | history link — **OPEN ITEM** §14.4 |
| `Heute` | history day label for today |
| `{count} Artikel · {name}` | history row — ONE key, plural |
| `Fortschritt: {percent} %` | progress bar `aria-label` |

**Screen F (shopping list detail)**

| String | Context |
| --- | --- |
| `← Alle Listen` / `← Listen` | back link, desktop / mobile |
| `{open} offen · {bought} heute gekauft · zum Abhaken antippen` | desktop subtitle — ONE key |
| `{open} offen · {bought} gekauft · zum Abhaken antippen` | mobile subtitle — ONE key |
| `Sortierung: neueste` | sort control — **OPEN ITEM** §14.2 |
| `Teilen` | share — **OPEN ITEM** §14.1 |
| `Zu kaufen` / `Zu kaufen · {count}` | section header, desktop / mobile |
| `Heute gekauft` / `Heute gekauft · {count}` | section header, desktop / mobile |
| `Gekauftes leeren` | section action |
| `Gekaufte Artikel aus dieser Ansicht entfernen?` + a body sentence saying the history keeps them | the confirm (§8.8) |
| `{name} · {when}` | bought-row provenance — ONE key |
| `Du` | the buyer's name for an own, still-queued check-off (§10.9) |
| `Häufig gekauft` | rail heading — exists |
| `Alle {count} anzeigen` | catalog link |
| `Rechtsklick oder langes Drücken versteckt einen Vorschlag.` | the hint that replaces the per-chip `×` |
| `{name} nicht mehr vorschlagen?` | the dismiss confirm |
| `Rezepte auf dieser Liste` | rail panel title |
| `{count} Zutaten auf der Liste` | per-recipe count (§8.6) |
| `Entfernen` | per-recipe remove |
| `+ Zutaten eines Rezepts hinzufügen` | dashed button |
| `Barcode zeigen` | the rail's card row |
| `Artikel hinzufügen — „500 g Mehl, 2 Zitronen, Milch“` | add-bar placeholder. **The „low-high“ quotes and the em dash are part of the string** |
| `Hinzufügen` | add button (desktop labelled form) |
| `Alles erledigt`, `{count} wartet`, the offline/unverified banners, the long-press hint | exist |

**CONTENT that must never be routed through `t()`** and appears on these screens: the
course vocabulary (`Hauptspeise`, `Beilage`, `Dessert`, `Suppe`, `Auflauf`, …), every unit
(`g EL Bund Pck. Dose Portionen`), every ingredient and item name, `n. B.`, section
headings inside a recipe (`Für den Teig`), and `recipes.language`. `formatDuration(minutes,
locale)` and `formatRelative` are **interface** and take a locale; `parseDuration` is
content and does not.

---

## 12 — Gotchas this area is most likely to trip

Named, with how the spec above avoids each:

1. **`block` beats `line-clamp-N`** → §10.1: titles drop the clamp entirely; the two
   surviving clamps (`ShoppingItemTile` name) carry no other `display` utility.
2. **A `display:none` `<img>` is still fetched** → §10.2: the `sm` branch stays in JS for
   every image-bearing list; the one CSS branch (§7.1) is text-only and says so.
3. **`SkeletonList.variant` must match the branch** → §4.2, §10.2: new `"editorial"` /
   `"tiles"` variants, and the dead `"cards"`/`"rows"` go in the same commit.
4. **A list renders `thumbnailUrl()`, never `imageUrl`** → §10.3, with a table of all
   eight image slots.
5. **`bottom-0` is painted under `BottomTabBar`** → §10.4: both new bars use
   `.bottom-tabbar`; grep before adding.
6. **A sticky bottom bar needs an unbroken flex chain + a `flex-1` spacer; `min-h-full` is
   not equivalent** → §10.4, and the stale comment in `AddItemBar.tsx` gets fixed.
7. **Page roots must not re-apply `mx-auto max-w-* px-gutter pt-4 pb-tabbar`** → §10.5;
   §1's `PageColumn` deliberately carries none of the paddings.
8. **`px-4 px-safe` on one element = no horizontal padding at all** → §1.1's new utilities
   use the same `max()` expression `px-gutter` does and are never paired with a `px-*`.
9. **`minmax(0,1fr)` never a bare `1fr`; `min-w-0` on items; `<fieldset>` needs it
   explicitly** → §10.6, with the two riskiest grids measured.
10. **A header gets ONE overflow trigger** → §5: the desktop header's three *labelled*
    buttons are not the trap (1140px, above the title, not beside it); the `⋯` is
    `ActionMenu`, which closes before acting and defers one `requestAnimationFrame`
    because it is a portal outside `.recipe-print`.
11. **`useCanMutate()` must not be used on the shopping screens; the cards screens do the
    opposite** → §10.8, decided per screen.
12. **The four things that keep offline editing safe** (`setMutationDefaults` by key,
    `offlineFirst`, `shouldPersistMutation`, call-time `mutationId`) → §10.9, all four
    preserved; the bought-log append rides the same mutation so `mutationId` still covers
    it.
13. **`shopping-lists` stays `NetworkOnly` in the SW** → §10.9.7; a `NetworkFirst` hit
    would silently un-tick items.
14. **`shouldPersistQuery` is an allow-list** → §10.10: `"plan"` must be added or the week
    strip is blank offline; `PERSIST_BUSTER` bumps once.
15. **Interface vs content language** → §11's last paragraph: the course vocabulary and
    every unit stay German literals; only the rail's *heading* is interface.
16. **`autoFocus` only acts on mount** → the mobile filter sheet and the add bar both want
    focus on open; a `Dialog` mounts fresh so `autoFocus` is fine there, but the add bar's
    refocus-after-submit must stay the existing `inputRef.current?.focus()`, not an
    `autoFocus` toggle.
17. **Verify a phone layout in a real browser** → §10.7, with the four screens to check
    and the `aria-label` trap on `nav.fixed`.

---

## 13 — `CLAUDE.md` edits this area requires (D3)

I do **not** write these; a later agent does. Recorded here with the replacement rationale.

**Edit 1 — the `max-w-5xl` gotcha.** Current text: *"A page component must NOT re-apply
`mx-auto max-w-5xl px-gutter pt-4 pb-tabbar` — `AppShell`'s `<main>` already does all
four."* The rule survives; the **value** does not. Replacement rationale: `<main>` is now
`mx-auto max-w-content px-gutter pt-4 pb-tabbar`, where `--content-max` is 1204px — the
width of the 1440px artboards' main column minus the 236px sidebar. `max-w-5xl` (1024px)
could not express the desktop artboards at all: `1a`'s `1fr 420px` hero, `1c`'s three
columns and `1d`'s `1fr 340px` are all drawn against 1140px of content, and the design's
stated fix is *"content spans the full width"*. Form and prose screens keep the old measure
through `PageColumn` from `components/layout/AppShell.tsx`, which carries `mx-auto
max-w-5xl` and deliberately **no** padding utilities, so the "page roots re-apply nothing"
half of the rule is unchanged. The sidebar is `w-sidebar` (236px, was `w-64`) and
`AppShell` pads `lg:pl-sidebar`.

**Edit 2 — the recipe-list markup gotcha.** Current text: *"The recipe list switches
MARKUP at `sm`, in JS … The row exists because a card leads with a 4:3 image: on a 390 px
phone that is ~380 px per recipe, i.e. one recipe per screen."* Replacement rationale: the
JS branch and its reason (a `display:none` `<img>` is still fetched) are unchanged and
still load-bearing, but there is **no card grid any more** — `RecipeCard` is deleted and
both branches render `RecipeEditorialRow`, which differs only in title size and whether the
description shows. The branch now exists so the desktop row can carry a description and a
21px title while the phone row stays at 17px, and so `SkeletonList variant="editorial"`
can size its 84px thumb correctly. `SkeletonList`'s `"cards"` and `"rows"` variants are
gone with it.

**Edit 3 — the title/`line-clamp` gotcha.** Current text ends: *"`block` beats
`line-clamp-N`. … Drop `block`, and when a breakpoint needs single-line truncation instead
use `sm:line-clamp-none sm:block sm:truncate`."* The cascade fact is unchanged and stays.
Replacement rationale to append: **a recipe title never truncates at all** — the design's
stated fix is that editorial rows give a title a full line, so `RecipeEditorialRow`'s
`<h3>` and the two detail `<h1>`s carry no clamp, no `truncate` and no fixed height, and
the fix for a long title is removal rather than reordering. The `sm:line-clamp-none
sm:block sm:truncate` recipe still applies to the places that legitimately clamp
(`ShoppingItemTile`, `GroupsPage`, `CollectionsPage`).

**Edit 4 — locked decision 7's check-off sentence.** Already required by `SPEC.md` §4.3;
from this area's side the addition is that the check-off's optimistic update now moves the
line into a **"Heute gekauft"** section (with `Du · gerade eben` for the pending own row)
instead of making it vanish, and that the detail payload gaining a `bought` array is what
forces `PERSIST_BUSTER` to bump.

**Edit 5 — `AddItemBar`'s `-mx-4`.** The bottom-bar gotcha names `-mx-4` as the way a bar
swallows the page gutter. Replacement rationale: `-mx-4` assumes the gutter is exactly
1rem, which it is not at `lg` (`--gutter:2rem`) and not on a notched device in landscape;
`.bleed-gutter-inset` uses the same `max(var(--gutter), env(safe-area-inset-*))` expression
`.px-gutter` does. `-mb-4` is unchanged and still needed. Also: the same gotcha's sentence
*"the page root is `min-h-full` with a `flex-1` spacer"* contradicts the flex-chain gotcha
two bullets later and contradicts the code — it is `flex-1`, and `min-h-full` is
specifically the thing that does not work.

---

## 14 — Open questions (each with a recommendation)

1. **`Share` on a shopping list** (`1d`/`1h` headers). Undefined in the design.
   *Recommendation:* `navigator.share({ title, text })` of the list rendered as plain text
   (the same shape `recipeToPlainText` produces), with a clipboard fallback and the
   existing `shareOrCopy` helper from `features/recipes/lib/hooks.ts`. No backend. Reason:
   a real share token is a new unauthenticated read surface and nothing else in the design
   implies one.
2. **`Sortierung: neueste`** (`1d`) is the only sort the design names, and items carry
   `position`. *Recommendation:* three options — `neueste` (default, `position` desc),
   `älteste`, `alphabetisch` (folded with `foldText()`); render as a `<Select>`, not a
   one-item menu. It is a client-side sort of an already-loaded array, so no API change.
3. **"Lena kauft gerade ein"** (`1g`) and **"vor 2 Min. synchronisiert"** (`1c`).
   *Recommendation:* derive both from the newest `shopping_bought_items.bought_at` for the
   group — "synchronisiert" from the query's own `dataUpdatedAt` (TanStack already has it),
   "kauft gerade ein" only when the newest bought row is < 15 min old and by someone else;
   otherwise render neither. Do **not** add a websocket for a subtitle.
4. **`Einkaufshistorie → Alle`** (`1c`) has no destination artboard. *Recommendation:*
   `/shopping/history`, extrapolated from the panel's own row shape (day header + rows),
   or — cheaper and honest — make `Alle` expand the panel in place and defer the screen.
   Flag whichever you pick in the PR.
5. **Progress-bar denominator.** `29%` with `10 to buy · 4 bought today` = `4/14`, so it
   is "bought today ÷ (open + bought today)", not the list's lifetime total. Confirmed by
   arithmetic; `shoppingProgressPercent` in `packages/shared` encodes it with a test.
6. **The overview preview is 8 items with `+2`, and it must come from the list endpoint.**
   Fetching the full item list per list card to render 8 names would be N+1 requests on the
   overview. *Recommendation:* §4.3's list response carries `previewItems` (first 8, name +
   amount only) alongside `openCount` / `boughtTodayCount`. Also: **which list is "the"
   list** (the mock has one; `1c`'s bulk-add button says "zu Einkaufsliste") —
   recommendation: the group's first list by `createdAt`, exposed as `isDefault` on the
   wire so the client does not re-derive it in three places.
7. **`Rezepte auf dieser Liste`** needs two facts nothing stores (§8.6).
   *Recommendation:* derive from `sources`, drop "von 5" and "4 Portionen". The literal
   artboard needs a `shopping_list_recipes` table `SPEC.md` never asked for.
8. **The mobile item tile truncates in the design** (§8.3). *Recommendation:*
   `line-clamp-2` with a fixed `min-h`, because a truncated German compound is unreadable
   at a shelf and this screen exists to be read at a shelf. A deliberate 1-line deviation;
   the owner may overrule it.
9. **`Treuekarten` tile colour** (§7.4). The mock's Payback blue is not a token and cards
   have no colour field. *Recommendation:* `bg-surface-2` tile with the label in `text-fg`;
   no per-brand gradients.
10. **The desktop library's filter rail width (220px), the "Mehr Filter" disclosure, the
    sort control's new home, the "Kürzlich gekocht" placement, and the day card's meta
    line** are all reconstructions with no artboard. Each is tagged `[RECON]` in §3 with
    its source and reason. If the owner draws the desktop library later, these are the five
    places to check first.

---

## 15 — Conflicts other workstreams must agree with

1. **Shell workstream — `AppShell` width (§1).** `max-w-5xl` → `max-w-content` (1204px),
   `w-64`/`lg:pl-64` → `w-sidebar`/`lg:pl-sidebar` (236px), plus the exported `PageColumn`.
   Without it none of the four desktop artboards can be built. *Recommendation:* the shell
   workstream lands the change and the token definitions; every non-designed screen adopts
   `PageColumn` in the same commit, or fifteen screens ship with a 1140px prose measure.
2. **Shell workstream — `TopBar` (§4.1).** The mobile library's group chip + `+` button IS
   `TopBar`; the design draws no magnifier there and the `+` opens a create sheet rather
   than linking to `/recipes/new`. *Recommendation:* `TopBar` owns both, since Import
   losing its tab is the shell's own decision.
3. **Foundations workstream — `--fg-body` and `--bg-sunken`.** `--fg-body` (`#e8dccd`) is
   used by C's step text, E's preview list and F's chips; `--bg-sunken` (`#130f0c`) by the
   sidebar and tab bar only. Both need light twins. *Recommendation:* land them before this
   area, or these screens have to use `--fg` and read too bright.
4. **Foundations workstream — `--radius-panel` (18px) and `--container-content`.**
   `Card radius="panel"` (§2) needs the first. *Recommendation:* add both to
   `@theme inline` next to `--radius-card`/`--radius-sheet`.
5. **Planner workstream (§4.1) — the shape `WeekStrip` consumes.** It needs, per day:
   `date` (the calendar date, already resolved in the user's timezone — the strip must not
   do UTC arithmetic), `state: "planned"|"empty"|"today"`, `recipe: {id,title,thumbnailUrl}
   | null`, and a `meta` string the *server* did not build (the strip composes
   `formatMinutes` + `cooked ✓` itself, so the API sends `totalMinutes` and `cookedAt`, not
   a sentence). *Recommendation:* `"plan"` goes in `PERSISTED_GROUP_SEGMENTS` (§10.10).
6. **Cook-tracking workstream (§4.2) — `lastCookedAt` on both DTOs.** C/D's stat cell needs
   it on `RecipeDetail`; the "Kürzlich gekocht" shelf needs it on `RecipeListItem` **and**
   needs `?sort=lastCooked`. *Recommendation:* denormalise `recipes.last_cooked_at` written
   from the log — a per-row grouped max on the list path is exactly the mistake the
   pre-folded search columns exist to prevent, since the envelope's `total` is a `count(*)`
   that cannot stop early. Measure it.
7. **Bought-state workstream (§4.3) — what the wire must carry.** List detail:
   `bought: BoughtEntry[]` **inside the existing `shopping-list` payload** (so it is
   persisted and optimistically patchable in one place), each
   `{id,name,quantity,unit,boughtBy:{id,name},boughtAt}`. List summary:
   `openCount`, `boughtTodayCount`, `previewItems[8]`, `isDefault`. Overview history:
   `[{date,itemCount,byName}]`. *Recommendation:* do not put bought entries on a second
   endpoint — a separate query would need its own optimistic patch, its own allow-list
   entry and its own busted blob.
8. **Course workstream (§4.4) — `tags.kind` must reach the client on `Tag`.** `CourseEyebrow`
   and `RecipeFilterRail` both branch on `tag.kind === "course"`; `TagSchema` in
   `packages/shared/src/schemas/recipe.ts` needs the field, and `recipeCount` (already
   optional there) must be populated in the tag *listing* for the rail's counts.
   *Recommendation:* `kind` non-optional on the wire with the `'free'` default, so a client
   never has to guess; the eyebrow renders **nothing** (not an empty span) when there is no
   course tag.
9. **Week-plan-diff workstream (§4.5) — `WeekPlanPanel`'s shape.** Needs
   `{recipes:[{id,title,thumbnailUrl,plannedOn,missingIngredientCount}],
   totalMissingIngredients, targetListId, targetListName}`. *Recommendation:* the target is
   the `isDefault` list from item 7, so the panel never picks one itself.
10. **Catalog workstream (§4.6) — `FrequentlyUsed` props.** Needs `entries` (top 8 by
    `useCount`, **server-selected**), `totalCount` (for `Alle {n} anzeigen`) and a hide
    mutation. The alphabetical *display* order is client-side and lives in
    `packages/shared` (§8.5). *Recommendation:* keep selection on the server and ordering on
    the client, and name both in the code so nobody "fixes" the ranking by sorting the SQL.
