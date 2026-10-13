# 05 — Frontend shell, navigation, `/plan`, and the undesigned screens

Area owner: the app frame. Read `docs/redesign/SPEC.md` (the contract) and `CLAUDE.md`
(locked decisions + gotchas) first; this file does not restate either.

**What this spec owns**

- `apps/web/src/components/layout/**` — `AppShell`, `SideNav`, `TopBar` (deleted),
  `BottomTabBar`, `nav-items.ts`, the four banners, `Logo`, `NotFoundPage`.
- `apps/web/src/features/groups/GroupSwitcher.tsx` (its two chrome variants).
- `apps/web/src/router.tsx` — the `/plan` route and its search params.
- The whole `/plan` screen (`apps/web/src/features/plan/**`, new) — D7, **no artboard**.
- Restyling briefs for the ~15 undesigned screens (D6): `import/`, `collections/`,
  `tags/`, `groups/`, `cards/`, `auth/`, `settings`.
- The nav-reachability audit.

**What this spec does NOT own** (named here so nobody builds it twice)

| Not mine | Whose |
| --- | --- |
| `--font-display`/`--font-sans` swap, the two new tokens (`--bg-sunken`, `--fg-body`), the type-scale utilities, the eyebrow/tabular-nums helpers | area 01 (foundation) |
| `meal_plan_entries` table, migration, `/api/groups/:groupId/plan` handlers and DTOs | the planner backend area |
| `RecipeListPage`, `RecipeDetailPage`, `ShoppingListsPage`, `ShoppingListDetailPage` and their components (incl. the library "This week" strip and the `+` button's *placement inside that header*) | area 04 (designed screens) |
| `tags.kind`, `recipe_cook_log`, `shopping_bought_items` | their own areas |

I consume area 01's tokens and area 04's screens; where I need something from them the
requirement is stated as a **PREREQ** line so the ordering is explicit.

---

## 1 — Prerequisites this spec assumes from area 01

Implement these first or the shell cannot be built as specified.

**PREREQ-01a — two new colour tokens.** `#130f0c` → `--bg-sunken` and `#e8dccd` →
`--fg-body`, defined in `apps/web/src/styles/theme.css` for **both** light and dark
(light twins: `--bg-sunken: var(--toon-sand-100)` — one step *below* the light `--bg`,
which is `--toon-sand-50`, so it still reads as "sunken"; `--fg-body:
var(--toon-sand-700)`), and mapped in `styles/index.css`'s `@theme inline` block as
`--color-bg-sunken: var(--bg-sunken)` / `--color-fg-body: var(--fg-body)`. The shell uses
`bg-bg-sunken` for the sidebar and the tab bar and `text-fg-body` nowhere itself — it is
the step/chip tone area 04 needs.

**PREREQ-01b — two new layout scales**, in `styles/index.css`'s `@theme inline`, next to
the existing `--spacing-tabbar` / `--spacing-topbar`:

```css
/* 236px — the artboards' sidebar. Tailwind emits w-sidebar / pl-sidebar / lg:pl-sidebar. */
--spacing-sidebar: 14.75rem;
/* 1204px = 1440 - 236: the artboards' content column. Tailwind emits max-w-content. */
--container-content: 75.25rem;
```

`--spacing-topbar` stays defined even though `TopBar` is deleted (§6): `Toast` and
`Dialog` may still reference it; grep before removing it.

**PREREQ-01c — display-serif heading utilities.** The shell needs `font-display` on the
wordmark and on `/plan`'s `h1`, at the artboards' sizes. If area 01 introduces named
utilities, use them; otherwise this spec writes the raw sizes and area 01 replaces them
in one pass. Sizes used below: 22px sidebar wordmark, 38px desktop `h1`, 34px phone `h1`,
20px section heading, 13.5–17px day-card title.

**PREREQ-01d — the eyebrow.** `10.5–11px / weight 700 / letter-spacing .06–.08em /
uppercase / text-fg-subtle` appears in the sidebar's "Organise" label and on every
`/plan` day card. If area 01 does not ship a utility, write it inline as
`text-[0.66rem] font-bold tracking-[0.08em] uppercase`.

---

## 2 — `AppShell` — the new frame, and the width conflict resolved

### 2.1 The conflict

The desktop artboards are `1440 × grid-template-columns: 236px 1fr`, with the content
column full-bleed inside `padding: 24–30px 32px`. `AppShell` today is
`lg:pl-64` (256px) + `<main className="mx-auto flex w-full max-w-5xl …">` (1024px). So
today's content column is 1024px on a 1440px screen with ~160px of dead margin on each
side — which is literally the "Empty space" pain the design intro names.

### 2.2 The resolution (concrete)

1. **The sidebar is 236px, not 256px.** `SideNav` becomes `w-sidebar`, and the shell's
   inner column becomes `lg:pl-sidebar`. Those two must always change together — a
   mismatch overlaps the content or leaves a strip of `--bg` beside the sidebar.
2. **`max-w-5xl` dies in `AppShell` and is replaced by `max-w-content` (1204px).** At
   exactly 1440px the layout is then pixel-identical to the artboards (236 + 1204). Above
   1440px the column stays centred instead of stretching to a 4K monitor, which no
   artboard covers and which would make the editorial recipe rows unreadably wide.
   `mx-auto` is kept for that reason.
3. **`max-w-5xl` survives nowhere in `apps/web/src/components/layout/**`.** It survives
   *per screen*, self-applied, only where a screen is a form or prose — see the table in
   §2.4. Grep `max-w-5xl` after the change; the only remaining hit must be
   `ImportReviewPage.tsx`'s sticky footer, which is retargeted to `max-w-content` (§12.1).

### 2.3 The new `AppShell`

`apps/web/src/components/layout/AppShell.tsx`:

```tsx
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-bg">
      <SideNav />
      <div className="flex min-h-dvh flex-col pt-safe lg:pl-sidebar lg:pt-0">
        <OfflineBanner />
        <UnverifiedEmailBanner />
        <UpdateBanner />
        <main className="mx-auto flex w-full max-w-content flex-1 flex-col px-gutter pt-4 pb-tabbar lg:pt-8 lg:[--gutter:2rem]">
          <InstallPrompt />
          {children}
        </main>
      </div>
      <BottomTabBar />
    </div>
  );
}
```

Four things about that snippet are load-bearing and must not be "tidied":

- **`<TopBar />` is gone** (§6) and `pt-safe` moved onto the inner column in its place.
  `TopBar` used to carry `pt-safe`; without this move a home-screen install renders the
  first banner under the status bar. `lg:pt-0` because from `lg` the sidebar owns the top
  edge and the inset is 0 there anyway — keeping `pt-safe` unconditional is harmless but
  the explicit reset documents the intent.
- **`px-gutter` + `lg:[--gutter:2rem]`, never a second padding utility.** `.px-gutter`
  and `.px-safe` are hand-written utilities emitted after everything Tailwind generates,
  so `lg:px-8` would lose to `.px-gutter` (a media query adds no specificity) and desktop
  would silently keep the 1rem phone gutter. 2rem is the artboards' 32px.
- **`<main>` stays `flex-1 flex flex-col`.** It is the flex chain that lets a page root
  say `flex-1` and push a sticky bottom bar down to the tab bar on a short page.
  `min-h-full` is not equivalent (measured: root stuck at 493px inside a 695px main).
- **`pb-tabbar` stays on `<main>` and on nothing else.** A page root that re-applies it
  strands every sticky bottom bar a tab-bar height too high. Ten page roots had already
  drifted back to it once — grep `pb-tabbar` under `features/` after this change; the
  only legitimate hits are the two bottom action bars' *clearance* comments.

`PageHeader` (exported from the same file) is **kept** and restyled by area 01/04: `h1`
becomes `font-display`, and the description becomes `text-fg-muted` at 14px. Do not
delete it — `AccountSettingsPage` is its only current consumer and §12.6 keeps it.

### 2.4 What the width change means for every screen

The screens do not *depend* on 1024px for correctness (they are all `flex-col` or
responsive grids), but forms and prose stretched to 1204px read badly. Each screen below
either goes full-bleed or applies its own cap **as the page root's own class**, never by
reintroducing one in `AppShell`.

| Screen | Root file | Width after |
| --- | --- | --- |
| `/` recipe library | `features/recipes/RecipeListPage.tsx` | full `max-w-content` (area 04) |
| `/recipes/$recipeId` | `features/recipes/RecipeDetailPage.tsx` | full (area 04's two-column grid) |
| `/recipes/new`, `/recipes/$recipeId/edit` | `RecipeNewPage.tsx`, `RecipeEditPage.tsx` | `mx-auto w-full max-w-3xl` on the page root |
| `/plan` | `features/plan/PlanPage.tsx` (new) | full |
| `/import` | `features/import/ImportPage.tsx` | `mx-auto w-full max-w-3xl` (already; see §12.1 — it must SHED its other classes) |
| `/import/$draftId` | `features/import/ImportReviewPage.tsx` | full; sticky footer inner wrapper `max-w-content` |
| `/collections` | `features/collections/CollectionsPage.tsx` | full; grid gains `xl:grid-cols-4` |
| `/collections/$collectionId` | `CollectionDetailPage.tsx` | full |
| `/tags` | `features/tags/TagsPage.tsx` | `mx-auto w-full max-w-3xl` (a single-column list) |
| `/groups` | `features/groups/GroupsPage.tsx` | `mx-auto w-full max-w-3xl` |
| `/groups/$groupId` | `features/groups/GroupDetailPage.tsx` | `mx-auto w-full max-w-3xl` |
| `/settings` | `features/auth/AccountSettingsPage.tsx` | `mx-auto w-full max-w-3xl` |
| `/shopping`, `/shopping/$listId` | `features/shopping/*` | full (area 04) |
| `/shopping/cards` | `features/cards/CardsPage.tsx` | full; grid gains `lg:grid-cols-3` |
| auth screens | `features/auth/AuthLayout.tsx` | unchanged `max-w-md` — outside the shell |

`max-w-3xl` = 48rem = 768px, which is the measured comfortable form width already used by
`ImportPage`. Use that one value everywhere in the table so nobody invents a third.

---

## 3 — `SideNav` — full component spec (artboards 1a / 1c / 1d)

`apps/web/src/components/layout/SideNav.tsx`, rewritten. The artboard's sidebar is
identical in all three desktop boards, so it is transcribed, not extrapolated.

### 3.1 Container

```
aside: fixed inset-y-0 left-0 z-30 hidden w-sidebar flex-col gap-[22px]
       border-r border-surface-2 bg-bg-sunken px-3.5 py-5 lg:flex
```

- `bg-bg-sunken` (`#130f0c`), **not** `bg-bg-elevated` — the artboard's sidebar is one
  step *below* `--bg`, and `--bg-elevated` in dark is `--toon-sand-900` (`#211b16`), i.e.
  lighter than the page. Using it inverts the intended depth.
- `border-surface-2` — the artboard's divider is `#2a221c` = `--surface-2`, not `--line`
  (`#382e26`). Every internal divider in the sidebar is `--surface-2` too, which is why it
  reads quieter than a card border.
- `px-3.5 py-5` = the artboard's `padding: 20px 14px`. `gap-[22px]` = its `gap: 22px`.

### 3.2 Row 1 — logo + serif wordmark

```tsx
<Link to="/" className="flex items-center gap-2.5 px-1.5">
  <Logo className="size-8" />
  <span className="font-display text-[1.375rem] font-medium text-fg">Rezepte</span>
</Link>
```

`Logo` is unchanged (it already draws the artboard's mark verbatim, and the artboard's
`rect fill="#dc7051"` / stroke `#24120a` are exactly its `var(--brand)` /
`var(--brand-fg)`). 22px, weight 500, `font-display`. **"Rezepte" stays a bare literal,
not a catalog key** — it is the product name, identical in both locales, and `Logo`'s
`title` prop already defaults to it.

### 3.3 Row 2 — the group-switcher button

Rendered as `<GroupSwitcher variant="block" />`; the changes live in that component (§4).
The artboard's shape: `bg-surface`, `border border-line`, `rounded-[10px]`, `p-2 px-2.5`,
a 28px `rounded-lg bg-brand-soft text-brand-soft-fg` initials tile, then a two-line
stack (13px semibold name / 11.5px `text-fg-subtle` "2 members · 37 recipes"), then a
14px `ChevronDown` in `text-fg-subtle`.

### 3.4 Row 3 — primary nav, with counts and the "New" pill

Driven by `NAV_ITEMS` (§7). One `<nav aria-label={t("ui.nav.mainNavLabel")}>` with a
`flex flex-col gap-0.5` list. Item shape:

```
inactive: flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-sm font-medium
          text-fg-muted hover:bg-surface-2 hover:text-fg
active:   bg-brand-soft text-brand-soft-fg hover:bg-brand-soft   (+ aria-current="page")
icon:     size-[18px], strokeWidth 2 (2.3 when active)
```

The trailing slot (`ml-auto`) is per item and is **not** part of `NavItem`:

| Item | Trailing slot |
| --- | --- |
| Recipes | `text-xs tabular-nums` count. `text-brand-hover font-medium` when the item is active, `text-fg-subtle` otherwise (the artboard shows both states). |
| Plan | the honey **New** pill (below) |
| Shopping | same count treatment as Recipes |
| — | Import is no longer in `NAV_ITEMS` (§7), so it has no row here |

The pill:

```tsx
<span className="rounded-full bg-accent-soft px-[7px] py-0.5 text-[0.69rem] font-semibold text-accent">
  {t("ui.nav.planNewBadge")}
</span>
```

`bg-accent-soft` = `#3a2c0f`, `text-accent` = `#eab54f`. **The pill must be able to go
away**, or "New" is permanent and stops meaning anything: render it only while
`readStorage(storageKeys.planVisited) === null`, and write `"1"` on the first
`/plan` visit. Add `planVisited: \`${PREFIX}planVisited\`` to `storageKeys` in
`apps/web/src/lib/storage.ts`, and set it from `PlanPage`'s mount effect (§10.7). A
missing localStorage (private Safari) means the pill stays — acceptable, it is a badge.

**Where the counts come from.** `SECTION 4.7` of SPEC.md forbids computing them per render
from a full list fetch. Both are already available cheaply:

- Recipes: `useSession().activeGroup?.recipeCount` — it ships on `GroupWithRole` from
  `/api/auth/me` (`packages/shared/src/schemas/group.ts:36`), which is already fetched,
  cached and persisted. Zero extra requests.
- Shopping: the sum of `itemCount` over `useShoppingLists(groupId)`
  (`ShoppingListResponse.itemCount` is optional — treat `undefined` as 0 and render no
  count at all if every entry is `undefined`, so an older server does not show `0`).
  That query is a small list-of-lists payload, is already on `shouldPersistQuery`'s
  allow-list and is the same query `/shopping` uses, so the sidebar warms it. It is
  `NetworkOnly` in the service worker — unchanged, do not add it to `runtimeCaching`.

Render **no** trailing slot while a count is `undefined`. A flashing `0` next to
"Einkauf" while the query loads is worse than nothing, and the sidebar renders on every
desktop screen.

### 3.5 Row 4 — the "Organise" group

```
div:   flex flex-col gap-0.5 border-t border-surface-2 pt-3.5
label: <span> eyebrow (PREREQ-01d) in text-toon-sand-600 → use text-fg-subtle;
       px-3 pb-1.5; text = t("ui.nav.organiseLabel")
items: SECONDARY_NAV_ITEMS, same link shape as §3.4 but px-3 py-2, text-[0.84rem],
       icon size-4, no trailing slot
```

The label is a `<span>`, not an `<h2>` — it labels a visual group inside an existing
`<nav>` and a heading here would land in the document outline above the page's own `h1`.
Put the three items in a **second** `<nav>` with `aria-label={t("ui.nav.organiseLabel")}`
so the grouping is exposed without a heading.

The artboard's folder glyph has **no heart**: `FolderHeart` → `Folder` in
`SECONDARY_NAV_ITEMS` (§7).

### 3.6 Row 5 — the footer user row

```
div (mt-auto): flex items-center gap-2.5 border-t border-surface-2 px-2 py-2.5
Link to="/settings", full-row, min-w-0 flex-1:
  <Avatar name={user?.name} src={user?.avatarUrl} size="sm" tone="accent" />
  <span className="min-w-0">
    <span className="block truncate text-[0.81rem] font-semibold text-fg">{name}</span>
    <span className="block truncate text-[0.72rem] text-fg-subtle">{email}</span>
  </span>
  <Settings className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
```

Three consequences to accept explicitly:

- **The gear is inside the link, not a separate button.** The artboard draws one row. So
  the link's accessible name must carry the action: `aria-label={t("ui.sidenav.accountAction")}`
  on the `<Link>` (the visible name is the user's own name, which does not say where the
  row goes).
- **`Avatar` gains a `tone` prop.** The artboard's footer avatar is `--accent` ground with
  `--brand-fg` initials; `Avatar`'s fallback is `bg-brand-soft text-brand-soft-fg`. Add
  `tone?: "brand" | "accent"` to `AvatarProps` (`components/ui/Avatar.tsx`), default
  `"brand"` so nothing else changes, `"accent"` → `bg-accent text-brand-fg`. **Do not do
  this with a `className` override**: `lib/cn.ts` is plain `clsx` with **no
  tailwind-merge**, so `className="bg-accent"` does not remove `bg-brand-soft` — both are
  emitted and Tailwind's own stylesheet order decides the winner. Every "just pass a
  className" instinct in this repo has to be checked against that.
- **The "Neues Rezept" button and the logout `IconButton` leave the sidebar.** The
  artboard's sidebar has neither. Consequences, both accepted:
  - Creating a recipe from a non-library desktop screen is now two clicks (Recipes → the
    header buttons). The design chose density; area 04 keeps the explicit
    "Importieren" + "Neues Rezept" buttons in the desktop library header, so the action is
    not lost, only relocated.
  - Logout lives on `/settings` only, where `AccountSettingsPage`'s sign-out card already
    is (`features/auth/AccountSettingsPage.tsx:140`). The footer row links straight there.
  - `ui.sidenav.newRecipe` stays in use (the `+` sheet, §8) — no orphaned key.
    `ui.sidenav.logout` becomes unused: **delete it from both catalogs in the same
    commit**, or it is dead copy that `i18n:check` will keep proving parity for.

### 3.7 What moves out of `TopBar` into where

| `TopBar` had | Now |
| --- | --- |
| `GroupSwitcher variant="bar"` | `PhoneHeaderRow` (§6.2), per screen, scrolls with the page |
| the magnifier `Link to="/"` | deleted. The library's search field is always visible at the top of `/`; a magnifier that navigates to the screen you are on was already a scroll-to-top affordance in disguise, and no artboard draws it. |
| the `+` `Link to="/recipes/new"` | the 40/44px `--brand` `+` in the library header, which now opens a sheet (§8) instead of navigating straight to the form |

---

## 4 — `GroupSwitcher` — two chrome variants

`apps/web/src/features/groups/GroupSwitcher.tsx`. The dialog half (the group list, the
role badges, "Gruppen verwalten") is unchanged and keeps working — it is also one of the
two phone routes to `/groups` (§9).

Changes:

1. **`variant` becomes `"chip" | "block"`.** `"bar"` is renamed to `"chip"` and restyled;
   nothing else uses `"bar"` once `TopBar` is deleted, so this is a rename, not an
   addition. Update both call sites (`PhoneHeaderRow`, `SideNav`).
2. **`"chip"` (artboards 1e/1g).** Not a bordered control any more — a quiet inline chip:
   ```
   flex items-center gap-2 rounded-lg text-[0.81rem] font-semibold text-fg-muted
   min-h-11 pr-1            /* the 44px target survives; the chip just has no ground */
   avatar tile: size-[22px] rounded-md bg-brand-soft text-brand-soft-fg
                text-[0.56rem] font-bold — initials(group.name), NOT the Users icon
   name:        truncate
   chevron:     ChevronDown size-3.5 text-fg-subtle
   ```
   The 22px tile is below the icon-legibility floor, which is exactly why the artboard
   puts **initials** there and not a glyph. Use `initials()` from `lib/format.ts` (it
   already exists and is what `Avatar` uses).
3. **`"block"` (sidebar).** Keep the bordered button, swap the `Users` icon for the same
   `initials(group.name)` tile at 28px (`size-7 rounded-lg`), and keep the two-line
   name/summary stack. Sizes per §3.3. The existing
   `t("groups.count.members") · t("groups.count.recipes")` line is already the artboard's
   "2 members · 37 recipes" — do not re-key it.
4. The `Users` import may become unused in this file; drop it.

---

## 5 — `BottomTabBar` — four tabs, the 44×28 pill

`apps/web/src/components/layout/BottomTabBar.tsx`. The structure is already right; three
changes.

1. **The active pill is 44×28, not 40×28.** `h-7 w-10` → `h-7 w-11`. The artboard's
   `width:44px;height:28px;border-radius:99px;background:#3b1f13` is exactly
   `h-7 w-11 rounded-full bg-brand-soft` — the class is already there and only the width
   is wrong.
2. **Ground and border follow the sidebar**: `bg-surface/95 border-line` →
   `bg-bg-sunken border-surface-2`. The artboard's tab bar is `#130f0c` with a `#2a221c`
   top border, i.e. the same two values as the sidebar. **Drop `backdrop-blur-md`** — it
   only ever mattered because the ground was translucent, and an opaque
   `--bg-sunken` bar is what the artboard draws.
3. **Active colour**: the label and icon go `text-brand-soft-fg` (`#f6c5b4`), not
   `text-brand`. Inactive stays `text-fg-subtle` (`#9c8b79`) — currently `text-fg-muted`,
   which is one step too bright against the new darker ground.

Everything else is unchanged and must stay: `fixed inset-x-0 bottom-0 z-30`, `pb-safe`,
`px-safe` on the `<ul>` (this is one of the two places where the inset *is* the whole
padding, so `.px-safe` is correct here and only here), `lg:hidden`, `h-tabbar` per tab,
`flex-1` + `truncate` labels, and `t(item.labelKey)` resolved at RENDER time.

`--tabbar-h` stays `3.75rem` (60px). The artboard's `height:84px` includes
`padding-bottom:22px`, i.e. the home-indicator inset that `pb-safe` supplies at runtime;
60 + 22 ≈ 82. Do not hard-code 84px, and do not add the inset twice.

---

## 6 — `TopBar` is deleted

### 6.1 Why, and what that costs

No artboard draws a global phone top bar. 1e and 1g put the group chip and the screen's
primary action *inside the page header*, above the `h1`, where it scrolls away; 1h has
`← Lists / Share` and no group chip at all. A sticky top bar would also eat 56px of a
844px phone on every screen for a control two screens need.

Delete `apps/web/src/components/layout/TopBar.tsx`, its `AppShell` usage, and its export
from `components/layout/index.ts`. Then delete the two keys it owned,
`ui.topbar.searchRecipes` and `ui.topbar.newRecipe`, from `ui.de.ts` and `ui.en.ts` —
the `+` sheet gets its own label key (§8) and the magnifier is gone.

Cost, stated plainly: on `/recipes/$recipeId`, `/shopping/$listId`, `/settings` and every
undesigned screen the phone no longer has a persistent group indicator. That is what the
artboards show (1f/1h have none), and the active group is still visible on both tab
screens that read group content. Accept it; do not re-add a sticky bar for it.

### 6.2 The replacement: `PhoneHeaderRow`

New file `apps/web/src/components/layout/PhoneHeaderRow.tsx`, exported from
`components/layout/index.ts`.

```tsx
/**
 * The phone-only row above a screen's <h1>: the active-group chip on the left, one
 * screen-specific action on the right (artboards 1e, 1g). Hidden from `lg`, where the
 * sidebar carries the group switcher.
 *
 * It scrolls with the page ON PURPOSE — no `sticky`, no `pt-safe`. AppShell's inner
 * column owns the status-bar inset now that TopBar is gone, and a second `pt-safe`
 * here would double it.
 */
export function PhoneHeaderRow({ action }: { action?: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 lg:hidden">
      <GroupSwitcher variant="chip" className="min-w-0 flex-1" />
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
```

Consumers (owned by area 04, listed here so the contract is one-sided and clear):

| Screen | `action` |
| --- | --- |
| `/` library | the `+` sheet trigger from §8 |
| `/shopping` overview | the existing "+ Neue Liste" button, rendered `variant="ghost" size="sm"` per artboard 1g's text-only `+ New list` |
| everything else | omit `PhoneHeaderRow` entirely |

---

## 7 — `nav-items.ts`

`apps/web/src/components/layout/nav-items.ts`. Full replacement of the two arrays plus
the `to` union.

```ts
export interface NavItem {
  to:
    | "/"
    | "/plan"          // NEW
    | "/shopping"
    | "/settings"
    | "/groups"
    | "/collections"
    | "/tags";         // "/import" LEAVES the union — it is no longer a nav destination
  labelKey: MessageKey;
  icon: LucideIcon;
  exact: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { to: "/",         labelKey: "ui.nav.recipes",  icon: BookOpen,     exact: true  },
  { to: "/plan",     labelKey: "ui.nav.plan",     icon: CalendarDays, exact: false },
  { to: "/shopping", labelKey: "ui.nav.shopping", icon: ShoppingBasket, exact: false },
  { to: "/settings", labelKey: "ui.nav.profile",  icon: CircleUser,   exact: false },
];

export const SECONDARY_NAV_ITEMS: readonly NavItem[] = [
  { to: "/collections", labelKey: "ui.nav.collections", icon: Folder, exact: false },
  { to: "/tags",        labelKey: "ui.nav.tags",        icon: Tag,    exact: false },
  { to: "/groups",      labelKey: "ui.nav.groups",      icon: Users,  exact: false },
];
```

- **Order matters in `SECONDARY_NAV_ITEMS`**: the artboard's "Organise" group reads
  Collections / Tags / Groups. The current file is Groups / Collections / Tags.
- Icons match the artboards' glyphs: `CalendarDays` (rect + two ticks + a rule),
  `CircleUser` (circle head + shoulder arc — **not** `Settings`; the design's point is that
  Profile is a person, not a preferences screen), `Folder` (plain folder, no heart).
  `ScanText` and `Settings` and `FolderHeart` become unused imports here — remove them.
- **`labelKey` stays a `MessageKey`, never a translated string.** Resolving at import time
  freezes the tab bar and the sidebar at whichever locale loaded first; both consumers
  call `t(item.labelKey)` inside their render. This is the one rule in this file that a
  refactor keeps trying to break.
- **Rewrite the module doc comment.** It currently explains "four labels also means
  'Importieren' fits again" and "Gruppen moved into Profil", both of which stop being
  true. The replacement must say: Plan took Import's slot; Import is now the `+` sheet in
  the library header (§8); every `SECONDARY_NAV_ITEMS` entry needs a phone route, and
  where each one is, is the audit in §9.

New catalog keys: `ui.nav.plan` (de `"Plan"`, en `"Plan"` — the word is the same in both,
which is fine and not a missing translation) and `ui.nav.planNewBadge` (de `"Neu"`, en
`"New"`). `ui.nav.import` is **kept** — the `+` sheet reuses it.

---

## 8 — The `+` sheet: where Import went

SPEC.md §4.7 settles it: Import leaves the tab bar and becomes the 40px `--brand` `+`
button in the library header (artboard 1e), which opens a sheet offering "Neues Rezept"
and "Importieren".

**Reuse `ActionMenu`** (`components/ui/ActionMenu.tsx`). It is `Dialog`-based, so Escape,
the focus trap, the scroll lock, the bottom-sheet-on-phone / centred-panel-from-`sm`
behaviour and the close-then-act frame all come free. Do **not** build a second menu.

New file `apps/web/src/features/recipes/components/LibraryCreateMenu.tsx` (it belongs to
the recipes feature, not to `layout/` — the shell only defines the slot):

```tsx
export function LibraryCreateMenu() {
  const t = useT();
  const navigate = useAppNavigate();                 // features/recipes/lib/nav.tsx
  const canCreate = useEmailVerificationBlock() === undefined;
  if (!canCreate) return null;                       // see the note below
  return (
    <ActionMenu
      label={t("ui.create.triggerLabel")}
      title={t("ui.create.title")}
      icon={<Plus />}
      triggerVariant="brand"
      triggerSize="md"
      items={[
        {
          label: t("ui.sidenav.newRecipe"),
          description: t("ui.create.newRecipeHint"),
          icon: <PenLine />,
          onSelect: () => navigate({ to: "/recipes/new" }),
        },
        {
          label: t("ui.nav.import"),
          description: t("ui.create.importHint"),
          icon: <ScanText />,
          onSelect: () => navigate({ to: "/import" }),
        },
      ]}
    />
  );
}
```

Details that will otherwise be got wrong:

- **`triggerSize="md"` = 44px, not the artboard's 40px, and that is deliberate.** Every
  primitive in this repo keeps a ≥44px touch target; the `+` is the single most-tapped
  control on the library. And `className="size-10"` would **not** shrink it: `lib/cn.ts`
  is plain `clsx`, so `size-10` and `size-11` both survive into the class list and
  Tailwind's stylesheet order picks the winner. If the 4px genuinely matters, area 01
  must add a `size="brandFab"` entry to `IconButton`'s `sizes` map — not a caller-side
  override.
- **`triggerVariant="brand"` already is the artboard's fill**: `bg-brand text-brand-fg
  hover:bg-brand-hover shadow-soft`. The artboard's `border-radius:12px` matches
  `IconButton`'s `rounded-xl`.
- **Returning `null` while the address is unconfirmed** matches what `RecipeListPage`
  already does with its two header links today (`RecipeListPage.tsx:58` — hidden, not
  disabled, because an `<a>` cannot carry a disabled state or a tooltip, and the
  `UnverifiedEmailBanner` is what explains the absence). Keep that behaviour; do not
  switch it to a disabled button.
- **Phones only, or both?** Both. On `sm`+ the library header keeps the explicit
  "Importieren" / "Neues Rezept" buttons (area 04) and the `+` is redundant, so render
  `LibraryCreateMenu` **only inside `PhoneHeaderRow`'s `action` slot**, which is already
  `lg:hidden`. Note the seam: `PhoneHeaderRow` is `lg:hidden` but the explicit buttons
  appear from `sm` — between `sm` and `lg` both are visible. That is correct and matches
  the current file (the header's buttons are unconditional today); it is a tablet showing
  two routes to the same place, not a bug.

New keys (namespace `ui`): `ui.create.title` (de `"Neu"`), `ui.create.triggerLabel`
(de `"Rezept hinzufügen"`), `ui.create.newRecipeHint` (de `"Von Hand eingeben"`),
`ui.create.importHint` (de `"Aus URL, Foto oder PDF"`). All four are genuinely new copy
and will therefore trip `i18n:check`'s parity grep — expected, class 1.

---

## 9 — Nav reachability audit

CLAUDE.md's rule: **everything not in the phone tab bar must still be reachable from a
tab screen, or it is unreachable on a phone.** There is no sidebar below `lg`.

Verified against the tree at `redesign` HEAD by grepping every `to="/…"` in
`apps/web/src`. Two rows are already broken *before* this redesign touches anything.

| Route | Phone tab? | Reached on a phone from | Status after this spec |
| --- | --- | --- | --- |
| `/` | ✔ Recipes | — | ok |
| `/plan` | ✔ Plan (new) | — | ok |
| `/shopping` | ✔ Shopping | — | ok |
| `/settings` | ✔ Profile | — | ok |
| `/recipes/new` | — | `+` sheet on `/` (§8) | ok — **new route, replaces the deleted `TopBar` `+`** |
| `/recipes/$recipeId` | — | recipe rows on `/`, `/collections/$id`, `/plan` day cards | ok |
| `/recipes/$recipeId/edit` | — | `ActionMenu` on the detail screen | ok |
| `/import` | — | `+` sheet on `/` (§8) | ok — **the whole reason the sheet exists** |
| `/import/$draftId` | — | `PendingDraftsList` on `/import` | ok |
| `/shopping/$listId` | — | list cards on `/shopping` | ok |
| `/shopping/cards` | — | `CardsCard` panel on `/shopping` (`ShoppingListsPage.tsx:152`) | **must keep** — the only route to the wallet on a phone |
| `/groups` | — | `GroupsCard` on `/settings` (`AccountSettingsPage.tsx:125,189`) **and** "Gruppen verwalten" in the `GroupSwitcher` dialog | **must keep the GroupsCard** — the switcher dialog is a bonus, not a substitute (it is a modal, not a destination) |
| `/groups/$groupId` | — | rows on `/groups` | ok |
| `/collections` | — | **NOTHING.** The only in-app links are on `/collections/$id` itself (`CollectionDetailPage.tsx:84,113`), which is only reachable from `/collections`. | **BROKEN TODAY — fix in this area, §9.1** |
| `/tags` | — | **NOTHING.** Zero `to="/tags"` outside `nav-items.ts`. | **BROKEN TODAY — fix in this area, §9.1** |
| `/search` | — | redirect only | ok (and it must keep declaring `RECIPE_FILTER_PARAMS`) |

### 9.1 The two orphans, and the fix

CLAUDE.md asserts "**Sammlungen / Tags** ← the 'Erweiterte Suche' panel on `/`". That is
**false**. `RecipeFilters.tsx`'s advanced panel offers a *collection filter `Select`* and
*tag filter chips*; it contains no link to `/collections` or `/tags`. So on a phone, tag
and collection management have been unreachable since the sidebar-only decision was made.

Fix, and it must land in this area's commit because moving the nav around would otherwise
get blamed for it: **add two management links to the bottom of `RecipeFilters`'s advanced
panel**, in the same row as the existing reset/result-count footer:

```tsx
<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
  <AppLink to="/collections" className="text-fg-muted hover:text-fg">
    {t("recipes.filters.manageCollections")}
  </AppLink>
  <AppLink to="/tags" className="text-fg-muted hover:text-fg">
    {t("recipes.filters.manageTags")}
  </AppLink>
</div>
```

Two new keys in the `recipes` namespace: `recipes.filters.manageCollections`
(de `"Sammlungen verwalten"`), `recipes.filters.manageTags` (de `"Tags verwalten"`).

Why there and not on `/settings`: the panel is where a phone user is already thinking
about tags and collections, and it makes the sentence CLAUDE.md already claims actually
true. It is also where the desktop design puts the organise-adjacent surface (the filter
rail). `RecipeFilters` is area 04's file — **coordinate**; this is recorded as a conflict.

---

## 10 — `/plan` (D7) — **EXTRAPOLATED, no artboard exists**

SPEC.md §4.1 states it outright: "The `/plan` screen is the one screen with no artboard at
all". Everything below is derived, and the derivation is named per element so a reviewer
can check the reasoning rather than the taste.

### 10.1 What it is extrapolated FROM

| Element | Source |
| --- | --- |
| Day-card states (planned / empty / today) and their exact colours | `renderVals()`'s `planned` / `empty` / `today` objects and the `weekMobile` `sc-for` in artboard 1e |
| Card content order (eyebrow `MON 1` → serif title → meta) | the same `sc-for` |
| `cooked ✓` marker and the `meta` strings `"1 h 15 · cooked ✓"`, `"15 min · today"` | `renderVals().week` |
| Page header shape (`h1` 38px desktop / 34px phone display serif + a 14px `--fg-subtle` subtitle + a right-aligned primary action) | artboards 1c and 1g, which are the only "overview destination" boards in the file |
| Right-hand rail width (340px) and its `gap: 26px` | artboard 1d's `grid-template-columns: 1fr 340px` |
| Section headers ("To buy" pattern: eyebrow + `flex-1` hairline + trailing count) | artboard 1d |
| The picker sheet | `ActionMenu` / `Dialog`, the repo's existing sheet model |
| Type scale, radii, tokens | area 01 |

**Everything in §10.4–§10.6 that is not in that table is invented.** Say so in the PR, as
SPEC.md §4.1 requires.

### 10.2 The date boundary — decide once, here

`planned_on` is a **calendar date in the viewer's timezone**. Store and transport it as a
`YYYY-MM-DD` **text** column and a `YYYY-MM-DD` string on the wire.

Reason: an integer unix-ms midnight is a midnight *somewhere*, and "Thursday" then drifts
for anybody not on the server's offset — a flatshare in Berlin looking at a UTC server sees
the wrong day for two hours every evening. A text date has no offset to be wrong about,
`(group_id, planned_on)` still indexes, and lexicographic ordering is chronological. The
cost is that it is the one column in the schema that is not an integer timestamp; that is
the trade, and it is worth naming in the migration comment. **`created_at`, `updated_at`
and `cooked_at` stay integer unix ms** — they are instants, not dates.

This is the planner backend area's column, so this is a **recommendation with a reason**,
not a unilateral decision. Recorded as a conflict.

### 10.3 Week maths lives in `packages/shared`

New file `packages/shared/src/plan.ts` + `packages/shared/src/plan.test.ts`, exported from
`packages/shared/src/index.ts`. Pure, no `Date` ambiguity, ISO-week (Monday-first — German
convention, and `renderVals().week` starts on Mon):

```ts
export type IsoDate = string;                                  // "YYYY-MM-DD"
export function toIsoDate(date: Date): IsoDate;                // LOCAL parts, never toISOString()
export function isoDateToday(now?: Date): IsoDate;
export function startOfIsoWeek(date: IsoDate): IsoDate;        // the Monday
export function shiftIsoWeek(weekStart: IsoDate, weeks: number): IsoDate;
export function isoWeekDays(weekStart: IsoDate): readonly IsoDate[];  // exactly 7
export function isoWeekNumber(date: IsoDate): number;          // 1..53
```

`toIsoDate` must build the string from `getFullYear/getMonth/getDate`. **Never
`date.toISOString().slice(0,10)`** — that is UTC and is exactly the drift §10.2 exists to
avoid. Test that specifically, with a `Date` set to 23:30 local in a positive-offset zone.

Pure logic in `packages/shared` with unit tests, never in a route handler or a component —
the repo rule, and the reason `formatDuration`/`parseDuration` live there.

### 10.4 Route, data and files

```
apps/web/src/features/plan/PlanPage.tsx                  default export, the screen
apps/web/src/features/plan/components/PlanDayCard.tsx    the three states
apps/web/src/features/plan/components/PlanWeekNav.tsx    ‹ · week label · › · "Diese Woche"
apps/web/src/features/plan/components/PlanRecipePicker.tsx   Dialog + search + rows
apps/web/src/features/plan/components/PlanServingsDialog.tsx Dialog + ServingsScaler
apps/web/src/features/plan/lib/queries.ts                query + 4 mutations
apps/web/src/features/plan/index.ts                      barrel, matching the other features
```

`lib/queries.ts` (this feature's file, mirroring `features/shopping/lib/queries.ts`):

- Query key: add `plan: (groupId, weekStart) => [ROOT,"group",groupId,"plan",weekStart]`
  to `queryKeys` in `apps/web/src/lib/queries.ts`, plus
  `invalidate.plan(qc, groupId)` invalidating `[ROOT,"group",groupId,"plan"]` (prefix, so
  a write invalidates every cached week).
- `usePlanWeek(groupId, weekStart)` → `GET /api/groups/:groupId/plan?from=&to=`, the two
  bounds being `isoWeekDays(weekStart)[0]` and `[6]`. `staleTime: STALE.list`.
- Mutations, all **ordinary online mutations** — no `setMutationDefaults`, no outbox, no
  `mutationId`: `usePlanEntryCreate`, `usePlanEntryUpdate` (servings and/or `plannedOn`),
  `usePlanEntryDelete`, `usePlanEntryCooked`. SPEC.md §5 is explicit: planner writes are
  online-only, treated like shopping-list create/rename. Getting this wrong is how a
  queued mutation that can never succeed ends up failing loudly on every reconnect.
- `useCanMutate()` **is** the right hook on this screen (opposite of the shopping screens,
  same as the cards screens): it is false offline, and offline is exactly when planning
  must be disabled.

Offline read: add `"plan"` to `PERSISTED_GROUP_SEGMENTS` in `apps/web/src/lib/persist.ts`.
The library's week strip has to render offline or the strip is a hole in the home screen.
**No `PERSIST_BUSTER` bump** — adding an allow-listed key does not change the blob's shape,
and the buster is for shape changes.

Service worker: nothing to do. `/api/**` stays out of `runtimeCaching` and in
`navigateFallbackDenylist`; `/plan` is a navigation path and must **not** be added to the
denylist.

**Assumed endpoint contract** (owned by the planner backend area — verify before coding):

```
GET    /api/groups/:groupId/plan?from=YYYY-MM-DD&to=YYYY-MM-DD
       -> { items: MealPlanEntry[], total, limit, offset }
POST   /api/groups/:groupId/plan            { recipeId, plannedOn, servings? }
PATCH  /api/groups/:groupId/plan/:entryId   { plannedOn?, servings? }
DELETE /api/groups/:groupId/plan/:entryId
POST   /api/groups/:groupId/recipes/:recipeId/cooked   { mealPlanEntryId? }   (§4.2's endpoint)

MealPlanEntry = { id, plannedOn: IsoDate, servings: number | null,
                  cookedAt: string | null,
                  recipe: { id, title, thumbnailUrl, imageUrl, totalMinutes,
                            servings, courseTag } }
```

The **embedded recipe summary is the important part**: without it the screen needs 7
recipe fetches to draw a week, and the artboards' day cards need a title, a duration and a
thumbnail. Recorded as a conflict with the planner backend area.

### 10.5 `router.tsx` changes

```ts
/** Search params of /plan. `pick()` drops anything not listed — same rule as
 *  RECIPE_FILTER_PARAMS. `week` is the ISO date of the displayed Monday. */
const PLAN_SEARCH_PARAMS = ["week"] as const;

const planRoute = createRoute({
  getParentRoute: () => groupScopedRoute,          // the GROUP owns the plan (decision 1)
  path: "/plan",
  validateSearch: (search: Record<string, unknown>) => pick(search, PLAN_SEARCH_PARAMS),
  component: lazyRouteComponent(() => import("@/features/plan/PlanPage")),
});
```

- **`groupScopedRoute`, not `appRoute`.** `meal_plan_entries.group_id` → the screen needs
  an active group, and `RequireActiveGroup` is what supplies the onboarding card when
  there is none.
- **`lazyRouteComponent`, never a hand-rolled `React.lazy` wrapper.** The router preloads
  via `component.preload()`, a property only `lazyRouteComponent` attaches; a wrapper
  silently turns `defaultPreload: "intent"` into a no-op and loses the one-shot reload on
  a missing chunk after a service-worker deploy.
- Export the screen as its module's **default** export.
- Register it in `groupScopedRoute.addChildren([...])` (after `recipeEditRoute` reads
  naturally) and add `plan: planRoute` to the `routes` const.
- Update the route-map comment at the top of `router.tsx`: add `/plan` to the `guarded`
  line.
- `week` must be **validated, not trusted**: `PlanPage` runs the raw value through
  `startOfIsoWeek()` and falls back to `startOfIsoWeek(isoDateToday())` when it is not a
  parseable date. A URL is user input; a `NaN` week renders seven `Invalid Date` cards.

### 10.6 Layout

Page root: `<div className="flex flex-col gap-4">` — nothing else. `AppShell`'s `<main>`
already owns `mx-auto max-w-content px-gutter pt-4 pb-tabbar`.

```
PhoneHeaderRow  — NOT rendered. /plan has no per-screen primary action in any artboard,
                  and the group is visible on the two tab screens that show its content.

header (flex flex-wrap items-end gap-4):
  div:  h1  font-display text-[2.125rem] leading-[1.1] lg:text-[2.375rem]   "Wochenplan"
        p   mt-1.5 text-sm text-fg-subtle   t("plan.weekRange", { start, end })
  PlanWeekNav  ml-auto

PlanWeekNav (flex items-center gap-1):
  IconButton label=t("plan.prevWeek") icon={<ChevronLeft/>} variant="surface" size="md"
  Button     variant="outline" size="sm"  t("plan.thisWeek")     (hidden when already there)
  IconButton label=t("plan.nextWeek") icon={<ChevronRight/>} variant="surface" size="md"

week body:
  phone  (default)  : flex flex-col gap-2      — one full-width day card per row
  sm                : grid grid-cols-2 gap-3
  lg                : grid grid-cols-7 gap-3   with grid-template-columns repeat(7, minmax(0,1fr))
```

- **`minmax(0,1fr)`, never a bare `1fr`.** Seven tracks holding titles that must not
  truncate on a 1204px column is precisely the trap the `controlClasses` gotcha describes;
  a bare `1fr` uses each track's min-content width and the grid overflows. Write it as
  `grid-cols-[repeat(7,minmax(0,1fr))]`, not `grid-cols-7`.
- **A phone gets a vertical list, not the library's horizontal strip.** The strip on
  artboard 1e shows `week.slice(3,7)` — four days, a *peek*. `/plan` is the destination
  where the whole week must be scannable, and a 132px card cannot hold a title that never
  truncates. This is the largest single extrapolation on this screen; it follows the
  design's own stated fix ("Titles never truncate: editorial rows give titles a full
  line"), which is why the phone layout is a row per day.
- Each phone row is `grid-cols-[56px_minmax(0,1fr)_auto]`: date block · title/meta ·
  `ActionMenu`. Each desktop card is the artboard's vertical card.
- Empty state: when the whole week is empty, still render seven cards (they are the
  affordance) and put `EmptyState`-style copy **above** them —
  `t("plan.empty.title")` / `t("plan.empty.description")` as a `Card padding="md"`
  hint, not the `EmptyState` primitive (which replaces content; here the content is
  the point).
- **No sticky bottom bar on this screen.** If a later iteration adds one it must use
  `.bottom-tabbar` and the unbroken flex chain — never `bottom-0`, which paints under
  `BottomTabBar` and cannot be tapped.

### 10.7 `PlanDayCard`

Props: `{ date: IsoDate; entry: MealPlanEntry | null; isToday: boolean; canMutate: boolean; reason?: string }`.

| State | When | Classes (desktop card) |
| --- | --- | --- |
| planned | `entry !== null && !isToday` | `rounded-xl border border-line bg-surface p-2.5 min-h-[86px]`; eyebrow `text-brand-hover`; title `text-fg` |
| empty | `entry === null && !isToday` | `rounded-xl border border-surface-2 bg-transparent p-2.5 min-h-[86px]`; eyebrow **and** title `text-fg-subtle`; title = `t("plan.day.empty")` |
| today | `isToday` (planned or not) | `rounded-xl border border-brand bg-brand-soft p-2.5 min-h-[86px]`; eyebrow `text-brand-soft-fg`; title `text-fg` |

Those are the artboard's `planned` / `empty` / `today` objects mapped hex-for-hex through
SPEC.md §2's audit table (`#382e26`→`--line`, `#2a221c`→`--surface-2`, `#201a15`→
`--surface`, `#eb9d84`→`--brand-hover`, `#6b5c4b`→`--fg-subtle`, `#dc7051`→`--brand`,
`#3b1f13`→`--brand-soft`, `#f6c5b4`→`--brand-soft-fg`).

Content:

```
eyebrow (PREREQ-01d):  `${formatWeekdayShort(date)} ${formatDayOfMonth(date)}`
title:                 font-display text-[0.84rem] leading-[1.25]   (lg card)
                        font-display text-[1.0625rem] leading-[1.2]  (phone row)
                        NO line-clamp — the design says titles never truncate
meta (text-xs text-fg-subtle, tabular-nums):
   formatMinutes(entry.recipe.totalMinutes)
   + isToday ? " · " + t("plan.day.today") : ""
   + entry.cookedAt ? " · " + t("plan.day.cooked") + " ✓" : ""
thumbnail: thumbnailUrl(entry.recipe), 56px square rounded-lg — PHONE ROW ONLY.
   NEVER imageUrl. A hero image is 2–5 MB and this screen asks for seven.
```

Two new formatters in `apps/web/src/lib/format.ts`, added to the memoised `formatters()`
builder next to `date`/`dateTime`/`relative` (so the `Intl` objects are cached per locale
like the existing ones):

```ts
/** "Mo" ("de") / "Mon" ("en") — INTERFACE, so it takes the locale. */
export function formatWeekdayShort(iso: string): string;
/** "1" — the day of month, no separator. */
export function formatDayOfMonth(iso: string): string;
```

Both are interface, not content: they render for the *viewer*, exactly like
`formatDuration(minutes, locale)` and unlike `parseDuration`.

Interaction:

- **empty card** → the whole card is a `<button>`; opens `PlanRecipePicker` for that date.
  `disabled={!canMutate} title={reason}` — a plan write is online-only.
- **planned card** → the title is an `AppLink` to `/recipes/$recipeId`; the card also
  carries **one** `ActionMenu` (never a row of icon buttons — a header gets one overflow
  trigger). Items, falsy-filtered so `canMutate && {…}` gates them:
  `t("plan.entry.servings")` → `PlanServingsDialog`;
  `t("plan.entry.markCooked")` → `usePlanEntryCooked` (hidden when `cookedAt != null`);
  `t("plan.entry.move")` → a date `Select`/`Input type="date"` in a small dialog →
  `usePlanEntryUpdate({ plannedOn })`;
  `t("plan.entry.addToList")` → the existing `AddRecipeToListDialog`
  (`features/shopping/components/AddRecipeToListDialog.tsx`) — reuse it, do not
  reimplement; it already ticks every ingredient by default and tracks the EXCLUDED set;
  `t("plan.entry.remove")` → `variant: "danger"`, `usePlanEntryDelete`.
- **`ActionMenu` closes before it acts** and defers by one `requestAnimationFrame` — that
  is already in the primitive; do not bypass it.

`PlanServingsDialog`: a `Dialog size="sm"` containing `ServingsScaler`
(`features/recipes/components/ServingsScaler.tsx`, already controlled:
`value` / `baseValue` / `unit` / `onChange`) with `baseValue = entry.recipe.servings.amount`
and `value = entry.servings ?? baseValue`, plus a "Rezept-Portionen verwenden" reset that
PATCHes `servings: null`. `servings` is nullable in the schema precisely so "unset" is
expressible; do not write the recipe's own number into the column.

`PlanRecipePicker`: `Dialog size="md"` + an `Input` bound to a debounced `q` +
`useRecipeList(groupId, { q })` (the existing hook) rendering compact rows —
84px-thumb-style, `thumbnailUrl()`, title + `time · servings`. Reuse
`features/recipes/components/RecipeRow.tsx` if area 04's restyled version accepts an
`onSelect`; otherwise a local row, and say so. Do **not** add a second recipe-list hook.

`PlanPage` mount effect: `writeStorage(storageKeys.planVisited, "1")` — that is what
retires the sidebar's "New" pill (§3.4).

### 10.8 New `plan` i18n namespace

New files `apps/web/src/lib/i18n/catalogs/plan.de.ts` and `plan.en.ts`, following the
existing shape exactly:

```ts
// plan.de.ts
export const planDe = { "plan.title": "Wochenplan", … } as const satisfies NamespaceCatalog<"plan">;
// plan.en.ts
export const planEn: LocaleCatalog<typeof planDe> = { … };
```

`apps/web/src/lib/i18n/catalogs/index.ts` says "**FINAL** — a port agent extends its own
two namespace files, never this one". A *new namespace* cannot register itself, so this is
the sanctioned exception: add the two imports and both spread positions, and nothing else.
Flag it in the PR so it is not read as the rule being broken.

Keys (de values; the `en` twin is required or `tsc` fails — that is the enforcement):

```
plan.title                 "Wochenplan"
plan.weekRange             "{start} – {end}"          (en-dash, not a hyphen)
plan.weekNumber            "KW {week}"
plan.thisWeek              "Diese Woche"
plan.prevWeek              "Vorherige Woche"
plan.nextWeek              "Nächste Woche"
plan.day.empty             "+ Planen"
plan.day.today             "heute"
plan.day.cooked            "gekocht"
plan.empty.title           "Diese Woche ist noch nichts geplant."
plan.empty.description     "Tippe auf einen Tag, um ein Rezept einzuplanen."
plan.picker.title          "Rezept für {day} wählen"
plan.picker.search         "Rezepte durchsuchen"
plan.picker.empty          "Keine Rezepte gefunden."
plan.entry.menuLabel       "Aktionen für {title}"
plan.entry.servings        "Portionen ändern"
plan.entry.markCooked      "Als gekocht markieren"
plan.entry.move            "Auf einen anderen Tag verschieben"
plan.entry.addToList       "Zutaten zur Einkaufsliste"
plan.entry.remove          "Vom Plan entfernen"
plan.servings.title        "Portionen für {day}"
plan.servings.reset        "Rezept-Portionen verwenden"
plan.toast.planned         "Eingeplant."
plan.toast.removed         "Vom Plan entfernt."
plan.toast.failed          "Konnte nicht gespeichert werden."
plan.offlineHint           "Planen braucht eine Verbindung."
```

Rules that apply: **one key per whole sentence**, never per fragment (a language with
different word order cannot reassemble fragments). `"Wochenplan"` is the screen's German
title while the *nav label* stays `"Plan"` — that is deliberate: a tab bar has ~10
characters, a page heading does not. All of this is new copy with no base-tree
counterpart, so `i18n:check` parity flags every line — class 1, expected.

---

## 11 — Shell banners: placement and behaviour

All four already render inside `AppShell` and their **order does not change**. What
changes is only what they sit inside.

| Banner | Where, after | Notes |
| --- | --- | --- |
| `OfflineBanner` | first child of the inner column, **below** `pt-safe`, above `<main>` | Full-bleed across the content column (not inside `max-w-content`), so it spans edge to edge beside the sidebar — which is what makes it read as chrome. On a phone it is now the topmost element on screen, where `TopBar` used to be; that is an improvement (it was previously pushed below a 56px bar). Restyle only: `bg-warning-soft text-warning-soft-fg`, unchanged tokens. |
| `UnverifiedEmailBanner` | second | Unchanged behaviour: `useEmailVerificationBlock()`, `undefined` → renders null; links to `/settings`; taller than `OfflineBanner` on purpose because it is an instruction, not a status. Do **not** collapse the two. |
| `UpdateBanner` | third | **Behaviour must not change at all.** `skipWaiting` is off; `lib/pwa.ts` applies a waiting worker automatically when `hasUnsavedWork()` is false, so this banner renders *only* while something on screen is unsaved. It has no dismiss button by design (dismissing would leave the app on a version it knows is stale with no way back to the offer) and there is deliberately no fallback reload timer (a blind reload would retry a failing swap on every launch — a boot loop). Placement and tokens only. |
| `InstallPrompt` | first child **inside** `<main>`, above `{children}` | Stays inside the content column: it is a dismissible card, not chrome, and full-bleed would make it look permanent. `mb-4` stays. Its copy must keep naming the offline deal exactly as today ("Rezepte anschauen offline, Einkaufsliste offline abhaken, Bearbeiten/Importieren brauchen Internet") — if the offline story changes, the copy changes in the same commit. |

Interactions to get right:

- **Sidebar.** The three chrome banners are inside `lg:pl-sidebar`, so they start at the
  sidebar's right edge and never run under it. Do not move them outside the inner column
  to "span the whole window" — a banner under a `z-30 fixed` sidebar is a rendering bug
  waiting to happen.
- **Tab bar.** The banners are at the top; they never collide with `BottomTabBar`. The
  only thing that can is a page's own sticky bottom bar, which must use `.bottom-tabbar`.
- **Stacking.** Two or three banners can be visible at once (offline + unverified is the
  common pair on a phone in a basement). They are static flow content, not `fixed`, so
  they simply stack and push `<main>` down. Do not make any of them `sticky` — three
  sticky bars on an 844px phone leaves no screen.
- **`Toast` and `Dialog`** keep their `pt-safe` / z-index and are unaffected; `Toast`'s
  `pt-safe` now resolves against a page that no longer has a `TopBar`, which is correct
  (it was compensating for it, not stacking with it — verify visually once).

---

## 12 — The undesigned screens (D6): restyling briefs

The extrapolation rules from area 01 that these briefs invoke, in one place:

- **R1 — the display serif.** Every screen `h1` and every card/section heading becomes
  `font-display font-medium` at the artboards' sizes (`h1` 34px phone / 38px desktop for a
  destination screen, 24px for a card heading, 20px for a rail heading). Weight **500**,
  not 600/700 — the artboards are `font:500` throughout. `tracking-[-0.01em]` on the
  largest only.
- **R2 — cards.** `rounded-card` (already 1rem = the artboards' 16px) `border border-line
  bg-surface`. `Card`'s existing classes are already correct; the change is that panels
  currently hand-rolling `rounded-xl border border-line` become `<Card>`.
- **R3 — editorial rows.** A list of content becomes `grid-cols-[84px_minmax(0,1fr)]`
  (thumb · eyebrow/serif-title/meta), no `line-clamp` on the title, `divide-y divide-line`
  or `gap-3` between rows. A list of *settings* stays a `Card padding="none"` +
  `divide-y divide-line` list.
- **R4 — eyebrows** (PREREQ-01d) replace `Badge` wherever the badge was only categorising,
  and `text-accent` when the category is honey.
- **R5 — tabular numerals** (`tabular-nums`) on every quantity, count, duration and price.
- **R6 — section headers**: eyebrow + `flex-1 h-px bg-surface-2` hairline + a trailing
  count or action, replacing a plain `<h2>` inside a long screen.

### 12.1 `features/import/` — `/import`, `/import/$draftId`

- **Fix the AppShell violation first.** `ImportPage.tsx:361` is
  `<div className="mx-auto w-full max-w-3xl space-y-5 px-4 pb-28 pt-4 lg:pb-8">`. `px-4`,
  `pt-4` and `pb-28` are all re-applied on top of `<main>`'s own `px-gutter pt-4
  pb-tabbar` — that costs a 390px phone 32px of horizontal room and doubles the bottom
  padding. Replace with `<div className="mx-auto w-full max-w-3xl flex flex-col gap-5">`.
- `h1` (line 363) → R1 at 34px/38px. The four `h2`s (lines 408, 518, 591, 747) are
  currently `text-sm font-semibold` — they become R1 card headings at 24px inside their
  `<Card>`s, or R6 section headers if area 01 prefers hairlines. Pick R1 (they head cards).
- The three source panels (URL / Foto / Dokument) become `<Card>` per R2.
  `OcrProgressPanel`, `UploadProgress`, `ImportErrorPanel`, `PendingDraftsList` all take
  R2. `PendingDraftsList` becomes an R3 editorial row list (a draft has a title and a
  source — it is content).
- **`features/import/lib/shell.tsx` must never gain a second implementation.** It is a
  *typing* seam that widens a few prop unions onto `@/components/ui` and casts once. If a
  restyle needs a new primitive prop, add it to the primitive and widen the seam — never
  put markup in `shell.tsx`.
- **`ImportReviewPage.tsx:370`**: the sticky footer's inner wrapper is
  `mx-auto flex max-w-5xl items-center gap-2 px-safe` → `max-w-content`. Its bar keeps
  `.bottom-tabbar` (this is the bar that was invisible on phones until it did) and keeps
  `px-safe` as its only horizontal padding.
- **Import errors keep carrying KEYS, not sentences.** `ImportApiError`'s `title`/`hint`
  are `ImportErrorText`; render through `useImportError(error)` in a component or
  `resolveDescribedError(t, error)` where a hook cannot go. A restyle must not "simplify"
  a rendered error into a literal — `importApi.ts` has no `useT()` and the ambient
  `translate()` there would freeze copy at throw time while `useAutosave` holds the error
  in state for as long as the review screen is open.
- `ImportPage`'s "Getestet mit chefkoch.de und …" hint: keep the whole sentence inside
  **one** `<span>`. In a `flex` `<p>` every bare text run becomes its own flex item, gets
  the container's gap around it and wraps independently.

### 12.2 `features/collections/` — `/collections`, `/collections/$collectionId`

- `CollectionsPage.tsx:34` `h1` → R1. The grid
  `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` gains `xl:grid-cols-4` now that the column
  is 1204px.
- Each collection tile is already a hand-rolled card (line ~80: `rounded-card border
  border-line bg-surface p-4 … shadow-card`) — it matches R2 already; the only change is
  the title to R1 at 22px (`font-display text-[1.375rem] font-medium`) and the recipe count
  to R5 (`tabular-nums`).
- `line-clamp-2` on the description **stays** (a description may truncate; the design's
  "titles never truncate" is about titles). Check no `block` utility sits on the same
  element — `block` beats `line-clamp-N` because the clamp works via
  `display:-webkit-box`.
- `CollectionDetailPage.tsx:118` `h1` → R1; its recipe list is area 04's restyled row/card
  branch — **reuse it**, and keep `useIsWideViewport()` picking one branch in JS. Do not
  render both with `sm:hidden`: a `display:none` `<img>` is still fetched, so every recipe
  would load its image twice. `SkeletonList`'s `variant` must match the branch or the list
  visibly jumps.

### 12.3 `features/tags/` — `/tags`

- Page root gains `mx-auto w-full max-w-3xl` (a single-column list should not be 1204px).
- `h1` → R1. The `Card padding="none"` + `divide-y divide-line` list is already the right
  shape (R3's settings-list variant); the per-row recipe count takes R5.
- `TagChip` keeps its colour dot and its per-tag colour — that is data, not theme.
- **`kind='course'` tags will start arriving here (D5).** Not this area's feature, but the
  list must not break on the new field: if the course/free split is rendered, it is an R6
  section header per kind, and the course *names* are **CONTENT** — German-only, never
  through `t()`. Only the section heading is interface.

### 12.4 `features/groups/` — `/groups`, `/groups/$groupId`

- Both page roots gain `mx-auto w-full max-w-3xl`.
- `GroupsPage.tsx:38` and `GroupDetailPage.tsx:87` `h1` → R1;
  `GroupDetailPage.tsx:206,279` `h2` → R1 card headings at 24px.
- The `Badge`s that show the role and the active group **stay badges** — they are status,
  not category, so R4 does not apply.
- `MemberList` becomes an R3-ish row list: `Avatar size="sm"` · name/e-mail stack · role
  `Badge` · `ActionMenu` for the per-member actions. If it currently shows a row of icon
  buttons per member, collapse them into one `ActionMenu` per row (a header gets one
  overflow trigger; the same reasoning applies to a dense row).
- `InvitePanel` keeps its **three-state** delivery reporting exactly as is:
  `sent` / `not_configured` / `failed` from `mailDeliveryOf()`, coloured differently, and
  the last two **must never render as success**. A restyle that unifies them into one
  green "Einladung gesendet" is a correctness regression, not a visual one.
- The danger zone (`GroupDetailPage.tsx:279`) keeps `text-danger` and its
  `ConfirmDialog`; give it `border-danger/30` per R2 rather than a red fill.

### 12.5 `features/cards/` — `/shopping/cards`, `CardsCard`

- `CardsPage.tsx:76` `h1` → R1. The grid `grid-cols-1 sm:grid-cols-2` gains
  `lg:grid-cols-3`.
- `CardTile` takes R2 and gains the artboard's card look from 1c/1g: `aspect-[1.6]`
  rounded-lg tile, label bottom-left, and the "+ Add card" affordance as a
  `border-[1.5px] border-dashed border-line-strong` tile (artboard 1c draws exactly that).
- `CardsCard` (the `/shopping` panel) takes R2 and R1's 22px heading, and **must keep its
  `AppLink to="/shopping/cards"`** — per §9 it is the only phone route to the wallet.
  Artboard 1c titles it "Loyalty cards" with a `Manage` link, which is what it already is;
  keep the German copy byte-identical (`cards.link.title` / `cards.link.action`).
- **`BarcodeImage` IS NOT RESTYLED. AT ALL.** `features/cards/components/BarcodeImage.tsx`
  hard-codes `#000` / `#fff` and the surfaces behind it are `bg-white`; it is the one place
  in the app that ignores the colour tokens, because a dark-mode barcode is unreadable to
  half the hand scanners in use and an iPhone at a till is the most likely device. Its
  `viewBox` is in module units and `shapeRendering="crispEdges"` is load-bearing — an
  anti-aliased module boundary is a misread digit. Do not tokenise its colours, do not
  round its corners, do not scale it non-integrally, do not put it on a themed surface.
  `CardDisplayDialog` may be restyled *around* it as long as the barcode's own container
  stays `bg-white` with white padding on all four sides (the quiet zone).
- The cards screens **do** use `useCanMutate()` — the opposite of the shopping screens.
  A card is written at home, online; it is only *read* offline. Keep it.
- `ScannerDialog` / `lib/scan.ts`: restyle the dialog chrome only. `lib/scan.ts` stays the
  ONLY `zxing-wasm` caller, lazily imported, and the wasm stays out of `globPatterns`.
  `CardFormDialog` keeps its ref-based one-shot focus effect for "Nummer eintippen" —
  `autoFocus` only acts on mount and cannot move focus into a field already on screen
  (verified in a real browser: focus stayed on a button).

### 12.6 `features/auth/` — the public screens and `/settings`

- **`AuthLayout`** (`features/auth/AuthLayout.tsx`) is outside `AppShell` and keeps
  `max-w-md` and its centred `min-h-dvh` frame. Changes: the `h1` (line 21) → R1 at 34px
  `font-display`, `Logo` stays `size-14`, the `<Card padding="lg">` already satisfies R2.
  Keep `px-gutter` — **not** `px-4 px-safe`, which is a flat override that leaves zero
  padding in portrait.
- `LoginPage`, `RegisterPage`, `ForgotPasswordPage`, `ResetPasswordPage`,
  `VerifyEmailPage`, `InvitePage`, `OAuthCallbackPage`: no structural change. Their forms
  are `Field`/`Input`/`Button` and inherit area 01's control restyle for free.
  `OAuthButtons` keeps its provider marks as-is (brand assets, not theme).
- **`/settings` = `AccountSettingsPage.tsx`.** Page root gains `mx-auto w-full max-w-3xl`.
  It already uses `PageHeader` (line 99) — keep it; it gets R1 from §2.3. Every
  `*Card` in the file (`GroupsCard`, `EmailVerificationCard`, `AppearanceCard`,
  `LanguageCard`, `PasswordCard`, `ConnectedAccountsCard`, `SessionsCard`) takes R2 and an
  R1 24px heading via `CardHeader`. Specific constraints:
  - **`GroupsCard` must not be deleted or demoted.** §9: it is the only route to group
    management on a phone. Its `AppLink to="/groups"` (line 189) is load-bearing.
  - **`EmailVerificationCard` branches on the TIMESTAMP** (`emailVerifiedAt`), never on
    the boolean `emailVerified` — every pre-flow account is `emailVerified = 1,
    email_verified_at = NULL`, so a boolean branch shows a green checkmark on the very
    screen the user was sent to to fix it. And it reports the three mail-delivery states,
    same rule as `InvitePanel`.
  - **`LanguageCard`'s third state is `"system"`, not a synonym for `de`.** Absent from
    `localStorage` means system; `setLocalePreference("system")` *removes* the key. The two
    language names are autonyms and identical in every catalog — a user who switched to a
    language they cannot read needs a way back. Restyle the control, never the state model.
  - `SessionsCard`'s list is an R3 settings list.
  - The sign-out card (line 140) stays — it is now the only logout in the app on desktop
    (§3.6).
- **`NotFoundPage`** (`components/layout/NotFoundPage.tsx`): R1 on the `h1`, R2 on the
  `Card`, keep the `404` eyebrow (it is already R4-shaped: `text-sm font-semibold
  tracking-wide uppercase` → move to PREREQ-01d's sizes).
- **`ErrorBoundary`**'s fallback: R1/R2 the same way, and it keeps using `translate()`
  rather than `useT()` — it must not depend on the context tree that may be what broke.

---

## 13 — Verification

The five gates, plus what this area specifically has to look at:

```bash
bun install
bun run typecheck      # three web TS projects + api + shared; scripts/typecheck.ts lists them
bun test
bun run build
bun run i18n:check     # read the OUTPUT, never just the exit code
```

`i18n:check` will report parity misses for every new key in §8, §9.1 and §10.8 — class 1
(genuinely new copy has no base-tree counterpart). Read it with
`grep -vE ':[0-9]+: *(\*|//|/\*)'` and confirm everything left is new copy or list-3
content vocabulary.

**Then verify the phone layout in a real headless browser at 390×844, not by reading
Tailwind classes.** Both layout gotchas in CLAUDE.md measured wrong on the first attempt
and only screenshots showed it. Install Playwright in a scratch dir outside the repo, log
in with a `fetch` to `/api/auth/login` from the page context, and assert:

1. `documentElement.scrollWidth === documentElement.clientWidth` on `/`, `/plan`,
   `/shopping/$listId`, `/import`, `/collections`, `/tags`, `/settings` — the seven-column
   plan grid and the widened content column are the new overflow risks.
2. `getComputedStyle(main).paddingLeft` is 16px at 390px and 32px at 1440px (the
   `--gutter` variable, not a second padding utility).
3. The gap between any sticky bottom bar and `nav.fixed` is 0. **Do not match the tab bar
   by its `aria-label`** — `SideNav`'s `<nav>` carries the same one and, being
   `display:none` on a phone, reports an all-zero rect that reads as a plausible wrong
   number. Match `nav.fixed.bottom-0` or add a `data-testid`.
4. With `TopBar` gone, the first banner's top edge is at `env(safe-area-inset-top)`, not
   at 0 under a status bar. This one needs a **real home-screen install on iOS** to see;
   `apple-mobile-web-app-status-bar-style: black-translucent` stays banned from
   `index.html`.
5. At 1440px: sidebar is exactly 236px, content column 1204px, and no strip of `--bg`
   shows between them (the `w-sidebar` / `lg:pl-sidebar` pair).

Nothing in this area touches the API, the Dockerfile, the compose stack or
`middleware/staticWeb.ts`, so no image build or migration run is required — **except** the
`packages/shared/src/plan.ts` addition, which needs `bun test` to cover the local-vs-UTC
date case explicitly (§10.3).

---

## 14 — `CLAUDE.md` entries this area invalidates (D3 — someone else writes the edit)

| Entry | Current claim | What the replacement must say |
| --- | --- | --- |
| **"Navigation (four tabs, and what is deliberately NOT one)"**, the table | Tabs are `Rezepte /` · `Einkauf /shopping` · `Importieren /import` · `Profil /settings` | Tabs are `Rezepte /` · `Plan /plan` · `Einkauf /shopping` · `Profil /settings`. Plan took Import's slot because the planner is a daily destination and importing is not; the active tab is a 44×28 `--brand-soft` pill and Profil is a user-circle glyph, not a gear. |
| Same section, the bullet list | "**Sammlungen / Tags** ← the 'Erweiterte Suche' panel on `/`." | This was **false** — the panel offered filters, not links, so both screens were unreachable on a phone. It is now true: `RecipeFilters`'s advanced panel carries "Sammlungen verwalten" / "Tags verwalten" links. Keep the sentence and note that it is the enforcement, not a description. |
| Same section | Nothing about Import's phone route | Add: **Importieren** ← the 40/44px `--brand` `+` in the library header, which opens an `ActionMenu` sheet with "Neues Rezept" and "Importieren". Deleting that button orphans both create paths on a phone. |
| Same section | "Search is not a destination." | Unchanged and still true. Keep it verbatim. |
| **File layout**, `apps/web/src/components/layout/` line | Lists "AppShell, TopBar, BottomTabBar, SideNav, InstallPrompt, ErrorBoundary" | `TopBar` is **deleted** (no artboard draws a global phone top bar; the group chip and the screen's primary action live in each screen's own header). `PhoneHeaderRow` replaces it. `AppShell`'s inner column now owns `pt-safe`. |
| **Gotcha: "A page component must NOT re-apply `mx-auto max-w-5xl px-gutter pt-4 pb-tabbar`"** | Names `max-w-5xl` as the shared cap | `<main>` is now `mx-auto max-w-content px-gutter pt-4 pb-tabbar` (1204px = the artboards' 1440 − 236 sidebar). The rule is unchanged — a page root still re-applies **none** of them — only the token's name changed. Also: a screen that *is* a form applies its own `max-w-3xl`, and that is the one cap a page root may carry. |
| **Gotcha: `controlClasses` / `minmax(0,1fr)`** | Cites the 2-up and 4-up grids | Add the `/plan` seven-column week grid as the widest instance: `grid-cols-[repeat(7,minmax(0,1fr))]`, never `grid-cols-7`, or seven never-truncating titles overflow a 1204px column. |
| **Locked decision 2** ("One React PWA … Bottom tab bar on phones, sidebar from `lg`") | Says nothing about widths | Add: the sidebar is **236px** (`--spacing-sidebar`) and the content column caps at **1204px** (`--container-content`), both from the 1440px artboards. |

Not invalidated, and the rewrite must **not** touch them: the `skipWaiting`-is-off update
policy and `UpdateBanner`'s no-dismiss/no-timer behaviour; `lib/unsavedWork.ts` as a
counter; the barcode black-on-white rule; `useCanMutate()` being banned on the shopping
screens and required on the cards screens; the `.px-safe` / `.px-gutter` split;
`.bottom-tabbar`; `lazyRouteComponent`; the `NAV_ITEMS`-carry-keys rule.

---

## 15 — Open items and gaps (flagged, not papered over)

1. **`/plan` has no artboard.** §10 is extrapolated; §10.1 names every source. The single
   biggest invention is the **phone layout being a vertical list of seven day rows rather
   than the library's horizontal 4-day strip**. Recommendation: ship it as specified — a
   132px strip card cannot hold a title that never truncates, and the design's own intro
   makes non-truncating titles a goal.
2. **`planned_on` as `YYYY-MM-DD` text.** SPEC.md §4.1 leaves the choice open and demands
   it be documented. Recommendation: text (§10.2) — an integer UTC midnight makes
   "Thursday" wrong for two hours every evening in CET. The planner backend area owns the
   column; this is a recommendation with a reason, and both areas must agree before either
   writes code.
3. **The `MealPlanEntry` DTO must embed a recipe summary** (`title`, `thumbnailUrl`,
   `totalMinutes`, `servings`, `courseTag`, `id`). Without it a week costs seven recipe
   fetches. Recommendation: embed it, exactly as `ShoppingListResponse` embeds `itemCount`.
4. **The sidebar's shopping count needs a source.** Recommendation: sum
   `ShoppingListResponse.itemCount` from the existing `shopping-lists` query, and render
   nothing while it is `undefined`. The alternative — a new `openShoppingItemCount` field
   on the group summary — is cheaper per render but adds a field to `/api/auth/me`, which
   is persisted and on the critical boot path. Prefer the sum; revisit if the sidebar's
   query proves noisy.
5. **The `+` button is 44px, not the artboard's 40px.** Recommendation: keep 44px (the
   repo's touch-target floor). If 40px is required, area 01 adds an `IconButton` size
   entry — a caller-side `className="size-10"` does **not** work, because `lib/cn.ts` has
   no tailwind-merge.
6. **Losing one-click logout on desktop.** The artboard's sidebar footer draws a gear and
   no sign-out. Recommendation: accept it; the footer row links to `/settings`, which has
   the sign-out card. If it turns out to be missed, the honest fix is an `ActionMenu` on
   the footer row (profile / sign out), not a second icon button.
7. **`ui.sidenav.logout`, `ui.topbar.searchRecipes`, `ui.topbar.newRecipe` become dead
   keys.** Recommendation: delete them from both catalogs in the same commit. A key with
   no call site is copy nobody will ever review again.
8. **`catalogs/index.ts` is marked FINAL and this area edits it** (to register the `plan`
   namespace). Unavoidable — a namespace cannot register itself. Flag it in the PR; the two
   imports and two spread entries are the entire change.
9. **Between `sm` and `lg` the library shows both the `+` sheet and the explicit
   Importieren/Neues-Rezept buttons.** Recommendation: leave it. Two routes to the same
   place on a tablet is harmless; hiding the `+` above `sm` would mean `PhoneHeaderRow`
   needs a second breakpoint and the group chip would vanish at `sm` while the sidebar only
   appears at `lg`, leaving 640–1024px with no group indicator at all.
10. **`/plan` needs an "add to shopping list" bulk action to match §4.5's panel**, but
    which list is "the" list is SPEC.md §6's open item. Recommendation: **do not** put a
    bulk action on `/plan` in this pass. Per-entry "Zutaten zur Einkaufsliste" via the
    existing `AddRecipeToListDialog` already covers the journey and forces no decision
    about a default list.
