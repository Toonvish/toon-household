# M4 — design pass: plan

**Status: DONE (2026-10-14).** Section 9 is the integration record, section 10 "what changed vs plan"
(no deviation from SPEC §1, no ADR; ADR 0004 gained one consequence bullet). Final tree after the review
fix: `bun test` 1832 pass in 106 files, typecheck and build green.

Milestone M4 of `docs/SPEC.md` §8, written by the planner of the `build-household` workflow. Paths:
`H` = `/home/erics/software/toon-household` (this repo), `R` = `/home/erics/software/toon-recipe`,
`F` = `/home/erics/software/toon-finance` (both READ-ONLY: `cat`, `grep`, `git log` only; never run
`bun install`, `bun test` or any script inside them).

## 1. Context

State of `H` at plan time (`0bee16c`, M3 closed): `bun run typecheck` OK; `bun test` **1749 pass in
96 files** (re-run by the planner, 17 s); `bun run i18n:check` parity OK, leftover half 137 classified
false positives. Two modules on both sides (`API_MODULES` / `WEB_MODULES` = `[recipe, finance]`).

What M4 builds on (all of it exists and is NOT rebuilt):

- **Shell** (`apps/web/src/components/layout/`): `AppShell` (`<main>` owns `mx-auto max-w-content
  px-gutter pt-4 pb-tabbar`, flex chain), `BottomTabBar` (fixed, `data-app-shell`, items from
  `useNavItems()`), `SideNav` (236px, logo, `HouseholdSwitcher variant="block"`, `ModuleSwitcher
  variant="segmented"`, primary + "Organisieren" items, account row), `ModuleSwitcher` (phone chip →
  a hand-built `Dialog` sheet mimicking `ActionMenu`; sidebar segmented group), `PhoneHeaderRow`
  (`<header data-app-shell>`, household chip + module chip + one action, `lg:hidden`),
  `nav-items.ts` (`primaryNavItems`: inside a module its three `navItems` + Profil; outside Home ·
  enabled modules (max two) · Profil — **the module-less tab bar already exists**),
  `module-switcher-items.ts`, `NotFoundPage` (still R's `CookingPot` icon).
- **Home** (`core/features/home/`): `HomePage` (PhoneHeaderRow, eyebrow, household name as
  content, "Module verwalten", `md:grid-cols-2` grid of each enabled module's `homeCard`, the
  empty state), `ModuleCards` (enable cards, `enableDialog`), `ManageModulesDialog`.
- **Home cards, first versions**: `modules/recipe/HomeCard.tsx` (a list of up to five planned titles
  + Plan / Einkauf buttons with the summed open-item count — no week strip),
  `modules/finance/HomeCard.tsx` (balance sentence via `viewerBalanceCents`, this month's expense
  total, two links; non-participant line).
- **Design system** (D5): `styles/theme.css` four blocks, each of the three override blocks defines
  the same 39 semantic tokens (`:root` additionally holds the `--toon-*` palette and the layout
  variables `--tabbar-h`, `--topbar-h`); `styles/index.css` `@theme inline` (type scale
  `--text-control`, `--text-item`, `--text-display-{xs..4xl}`, radii, `--container-content`) and the
  hand-written utilities (`.px-safe`, `.px-gutter`, `.bleed-gutter`, `.bleed-gutter-inset`,
  `.pb-tabbar`, `.bottom-tabbar`, `.eyebrow`, …); `styles/fonts.css` + `public/fonts/` (Figtree,
  Newsreader 500; preloaded in `index.html`; no `fonts.googleapis` anywhere in `H`, checked).
- **PWA**: `apps/web/vite.config.ts` `VitePWA` manifest (name/short_name "Haushalt", R's pot icons
  under `public/icons/`, `theme_color` R's brand `#c2532c`, **no `shortcuts`**); `index.html` inline
  pre-paint script and `lib/theme.ts` `applyTheme` both hard-code `#17120f` / `#faf5ee` for
  `<meta name="theme-color">`; `components/layout/Logo.tsx` is R's pot.
- **print.css**: `modules/recipe/features/recipes/print.css` hides `header|nav|aside[data-app-shell]`
  and `[data-print="hide"]`; `PhoneHeaderRow` (header), `BottomTabBar` (nav), `SideNav` (aside) carry
  the attribute. Never verified by printing in H.

Measured design-system state (planner's greps on `0bee16c`):

- Arbitrary `text-[<n>px|rem]` sizes outside comments: **34**, all inherited from R (R has 36; H's
  `SideNav` already dropped its two): `components/layout/BottomTabBar.tsx` 1 (`text-[0.68rem]`, R's
  tab label), `components/ui/Avatar.tsx` 2 (deliberate initials), and 31 in `modules/recipe`
  (`import/components/ConfidenceBadge.tsx` 1, `import/components/ParsedRecipeEditor.tsx` 4,
  `import/components/SourceViewer.tsx` 5, `import/ImportPage.tsx` 2, `plan/components/WeekStrip.tsx`
  1, `recipes/components/IngredientList.tsx` 1, `recipes/components/RecentlyCookedShelf.tsx` 1,
  `recipes/components/RecipeEditorialRow.tsx` 2, `recipes/components/StepList.tsx` 2,
  `recipes/RecipeDetailPage.tsx` 4, `recipes/RecipeListPage.tsx` 1,
  `shopping/components/BoughtSection.tsx` 1, `shopping/components/ListRecipesPanel.tsx` 1,
  `shopping/components/ShoppingItemCard.tsx` 2, `shopping/ShoppingListDetailPage.tsx` 3; paths under
  `apps/web/src/modules/recipe/features/`). **These are "the documented pre-existing recipe
  exceptions"** of the exit criterion (R/CLAUDE.md "THE DISPLAY FAMILY SHIPS EXACTLY ONE WEIGHT":
  converting them changes drawn screens; open in R `docs/redesign/PR.md`). Finance and the core have
  none.
- Hand-rolled uppercase labels (`text-sm font-semibold tracking-wide … uppercase`): exactly R's four
  (`IngredientList`, `StepList`, `RecipeDetailPage`, `ItemDetailDialog`), the R/CLAUDE.md-documented
  exceptions.
- Text arrows: only R's documented `←` in the values of `household.detail.backLink` and
  `recipe.collectionDetail.backLink` (de + en: four catalog lines).
- `bottom-0`: `BottomTabBar` itself (`fixed inset-x-0 bottom-0`, the bar every other bar must clear)
  and `RecipeHeroMobile`'s `absolute inset-x-5 bottom-0` text overlay inside the hero (not a bar).
- **Finance violations found** (all in `modules/finance/features/transactions` and
  `modules/finance/components`): the two "Buchen"/"Speichern" bars use `-mx-gutter … px-gutter …
  lg:mx-0` — `-mx-gutter` is not a utility in H (there is no `--spacing-gutter`), so the bar never
  bleeds; `TransactionList`'s sticky day header uses `top-topbar` (the TopBar is gone, so the header
  sticks 3.5rem below the top edge) plus the same `-mx-gutter`; the "no other participant" empty
  states wrap the page root in `mx-auto w-full max-w-md p-4` (re-applies padding, a cap other than
  the one allowed `max-w-3xl`); `PageHeader`'s `leading-[1.05]`/`lg:leading-[1.1]` duplicate the
  display steps' own line-heights; `AmountText` `lg: "text-xl"`, `xl: "text-4xl"` and `AmountInput`
  `text-4xl font-semibold` put amounts on the sans scale instead of the display scale.
- Core: `core/features/households/components/InvitePanel.tsx` `sm:grid-cols-[1fr_11rem]` (a bare
  `1fr` track holding an `Input`, R/CLAUDE.md "`controlClasses` carries `min-w-0`"). Note Tailwind
  v4's `grid-cols-<n>` already compiles to `repeat(n, minmax(0, 1fr))`; only arbitrary templates
  can hold a bare `1fr`.

Open items carried INTO M4 (CLAUDE.md "Open findings" and "Obligations"), each mapped to a task:

| Item | Source | Task |
| --- | --- | --- |
| Finding A: slot-1 leaver on an empty ledger → `slot1UserId` 500 for the survivor | M3 §10 | T01 |
| Finding B: plan `payerId` / income `personId` not checked against `finance_participants` | M3 §10 | T01 |
| Recipe screens without `PhoneHeaderRow` + a guard like finance's | M3 §9.11 | T07 |
| Phone module chip as a real `ActionMenu` sheet | CLAUDE.md M4 | T02 |
| `NotFoundPage`'s recipe icon | CLAUDE.md M4 | T02 |
| R's sidebar per-item counts and the Plan "Neu" pill | CLAUDE.md M4 | T02 |
| Home cards' final design | SPEC §5, CLAUDE.md M4 | T04 |
| PWA manifest `shortcuts`, icons, theme-color sync | SPEC §8 M4, CLAUDE.md M4 | T03 |
| Token-by-token D5 audit of finance screens | SPEC §8 M4 | T05, T06 |
| "N changes waiting" indicator for the finance outbox | M3 §9.8 | T06 |
| print-to-PDF verification of `print.css` | CLAUDE.md M4 | T09 |
| `scrollWidth` measurement with the scrollbar gutter | CLAUDE.md M4 | T09 |
| Screenshots in all four width/scheme combinations | SPEC §8 M4 | T09 |
| "Gruppe" vs "Haushalt" copy | CLAUDE.md M4 | decision 2 (no change) |

### Decisions this plan takes (binding for the tasks below)

1. **Findings A and B are fixed first, in M4-T01** (CLAUDE.md "fix them first"), server-side only.
   A: when the slot-1 participant's seat is deleted by `assertParticipantMayLeave` (empty ledger),
   the remaining participant, if seated in slot 2, is moved to slot 1 in the same call (the unique
   index and the CHECK allow it once slot 1 is free); the anchor `slot1UserId` then always resolves.
   ADR 0004's rules are unchanged; T01 appends one "Consequences" bullet to ADR 0004 naming the
   re-seat. B: `PUT/PATCH …/finance/plan` (`payerId`) and the income create/update routes
   (`personId`) answer **422 `validation_failed`** with a field detail on `payerId` / `personId` and
   the new server key `server.finance.personNotParticipant` ("Diese Person nimmt an der
   Haushaltskasse dieses Haushalts nicht teil." / "This person does not take part in this
   household's budget.") unless the id is one of the household's `finance_participants`; the check
   lives in the plan SERVICE (toon-finance gotcha 47: validate in the service). The new key goes to
   the core catalogs' finance section and to `NEW_GERMAN`. D8 stays: the household comes from the
   path only.
2. **"Gruppe" stays.** The German values keep "Gruppe" and `DEFAULT_HOUSEHOLD_NAME` stays "Meine
   Rezepte" (D10 byte-identity). Renaming to "Haushalt" is an owner decision that needs an ADR; M4
   does not take it and lists it in section 7.
3. **The documented pre-existing recipe exceptions stay and are pinned, not converted**: the 34
   arbitrary text sizes listed above, the four uppercase labels, the four `←` catalog lines,
   `RecipeHeroMobile`'s overlay `bottom-0`. M4-T08's guard test pins them by file and count, so a new
   violation anywhere fails `bun test`, and a later fix must update the pinned record (which is the
   documentation). R's own `-mx-4` bars (`RecipeForm`, `ImportReviewPage`) are R's shape and are not
   touched (R/CLAUDE.md lists them; section 7).
4. **No new token is expected.** Home cards, switcher, sync note and the audit all use the existing
   39 semantic tokens. If a task needs one anyway, it goes into all four `theme.css` blocks in the
   same commit (R/CLAUDE.md "THE PALETTE IS DECLARED FOUR TIMES"); T08's test enforces equality of
   the four sets.
5. **The phone module chip uses `ActionMenu` itself.** `ActionMenu` (`components/ui/ActionMenu.tsx`)
   gains two optional, backwards-compatible props: `renderTrigger?: (trigger: { onClick: () => void;
   "aria-haspopup": "dialog"; "aria-expanded": boolean }) => ReactNode` (replaces the default
   `IconButton` when given) and, per item, `current?: boolean` (active row: `bg-brand-soft
   text-brand-soft-fg`, `aria-current="true"`, trailing lucide `Check`). The `ModuleSwitcher` chip
   variant becomes an `ActionMenu` with `title={t("home.moduleSwitcher.title")}`, the chip as its
   trigger and `onSelect` → navigate. Every existing `ActionMenu` call site keeps compiling unchanged.
6. **Sidebar trailing slots are part of `NavItem`.** `NavItem` (`components/layout/nav-items.ts`)
   gains `trailing?: ComponentType<{ isActive: boolean }>`; `SideNav` renders it in the primary list
   (`ml-auto`), the tab bar ignores it (R draws counts in the sidebar only). The recipe manifest gives
   Rezepte the household's recipe count (`useHouseholdRecipeCount`, ADR 0001's module-owned count),
   Plan the "Neu" pill (`Badge variant="accent" size="sm"`, key `common.nav.planNewBadge`, which
   exists in both core catalogs), Einkauf the summed `itemCount` of the household's lists (R's
   `SideNav` rule: `undefined` when any list lacks `itemCount`, rendered as nothing, never a
   flashing `0`). The components live in `modules/recipe/nav-trailing.tsx`, a static manifest import,
   so it obeys the shell-free graph rule (no `@/modules`, no `@/components/layout`). Finance declares
   none. SPEC §2's `navItems` prose is updated by T09.
7. **The finance outbox indicator is module-local.** `modules/finance/components/PendingSyncNote.tsx`
   counts paused mutations whose key starts `["toon","finance","tx"]` (`useMutationState` with a
   `predicate` on `state.isPaused`) and renders `finance.common.syncPending` (F's text, already in the
   catalog: "1 Änderung wartet auf Übertragung." / "{count} Änderungen warten auf Übertragung.") in
   a slim `role="status"` warning-soft line; nothing when the count is 0. `FinanceGate` renders it
   for participants above the outlet **as a Fragment sibling, never inside a wrapper `div`** (a
   wrapper breaks `<main>`'s flex chain and the "Buchen" bar floats, R/CLAUDE.md "A `sticky bottom-*`
   bar can only be pushed UP"). F put it in its shell's `OfflineBanner`; in H the core cannot know a
   module's mutation namespaces, and recipe's shopping list already shows its own count. No new
   German.
8. **Home cards reuse existing copy only.** Recipe: `common.nav.recipes`, `recipe.plan.strip.heading`
   ("Diese Woche"), `recipe.plan.strip.link` ("Planen"), `common.nav.shopping`,
   `recipe.shopping.list.itemCount`. Finance: `finance.module.name`, `finance.balance.*`,
   `finance.balance.month.total`, `finance.nav.create`, `finance.participants.notParticipantBody`.
   Recipe titles and shopping-list names are CONTENT (never `t()`), recipe titles never truncate
   (R/CLAUDE.md "A RECIPE TITLE NEVER TRUNCATES AT ALL"). The recipe card's strip is a new, compact,
   read-only `HomeWeekStrip` (7 day cells + the next planned titles), NOT R's `WeekStrip` (which
   carries `PlanDayCard`, its `ActionMenu`s and dialogs, and would pull the planner into the
   manifest's static graph). The "active shopping list" is the first list in `shoppingListsQuery`
   order (the order `/recipe/shopping` shows).
9. **PWA.** The manifest is static per build, so "the household name" is the app's name: `name`
   and `short_name` stay "Haushalt" (= `home.appName`), plus a German `description` ("Rezepte,
   Einkauf und Haushaltskasse für deinen Haushalt."; vite config, not a catalog: the manifest has no
   locale). Shortcuts, German copied byte-identical from the sources: "Rezept importieren" /
   "Importieren" → `/recipe/import` and "Neues Rezept" / "Neu" → `/recipe/recipes/new` (R's two
   shortcuts, R `apps/web/vite.config.ts` lines 188–201, URLs re-prefixed), "Buchung erfassen" /
   "Erfassen" → `/finance/new` (F's `transactions.new.title` / `nav.create` values). A shortcut into a
   module the household has not enabled lands on Home with the module-disabled toast (existing
   `RequireModule` behaviour). New icon set: a house glyph (lucide `House` geometry, ISC) in
   `--brand-fg`-coloured strokes on the `#c2532c` tile, generated by `scripts/icons.ts` from
   `public/favicon.svg` (+ a maskable variant inside the 80% safe zone) with `sharp` resolved from
   `@toon/api`'s dependencies; the PNGs are committed. `Logo.tsx` draws the same mark.
   **Theme colour has one source**: `apps/web/src/lib/theme-colors.ts` exports `THEME_COLORS = {
   light: "#faf5ee", dark: "#17120f" }` (= `--bg` of the light and dark blocks); `lib/theme.ts`,
   the manifest (`theme_color` and `background_color` = `light`) and a test that reads
   `index.html`'s inline script and `theme.css` keep the four places equal. The manifest object
   moves to `apps/web/pwa-manifest.ts` (no type import from `vite-plugin-pwa`; plain `as const`
   object), imported by `vite.config.ts`, so a test can read it without loading Vite. It sits outside
   `PORTED_ROOTS`, so its German shortcut names are not leftover-German hits.
10. **Recipe phone header (T07).** Every lazily loaded recipe screen renders `<PhoneHeaderRow`
    (directly; recipe has no module `PageHeader`) as the first child of its page root, in the loaded
    state and in any early-returned loading/error/not-found branch that renders a page root.
    **Exemption: `RecipeDetailPage`** — artboard 1f draws the hero to the top edge with its own
    scrim back control (to `/recipe`, whose header carries the chips), and print relies on that
    layout; the guard test lists the exemption with this reason. A screen's existing primary action
    stays where it is; `PhoneHeaderRow`'s `action` slot is used only where the screen's header had
    exactly one action that would otherwise sit beside the `<h1>` on a phone.
11. **Screenshots** (T09): `docs/plans/screenshots/m4/<screen>-<width>-<scheme>.png`, viewport-only
    (not full page), `<width>` ∈ {390, 1440} (viewports 390×844, 1440×900), `<scheme>` ∈ {light,
    dark} via Playwright `colorScheme` with no stored preference. The **exit set** (all four
    combinations each, 36 files): `home`, `switcher` (390: the module chip's sheet open on `/recipe`;
    1440: `/recipe` with the sidebar's segmented switcher), `recipe-library` (`/recipe`),
    `recipe-plan`, `recipe-shopping`, `finance-overview`, `finance-transactions`, `finance-new`,
    `settings`. **Every other screen** at `390-light` and `1440-dark` (section 4, T09). If the PNG
    total exceeds 25 MB, the non-exit set is stored as JPEG (quality 82) under the same names with
    `.jpg`; the exit set stays PNG.
12. **"`scrollWidth === clientWidth`" is measured, and explained when it differs.** T09 records both
    numbers per screen and asserts (a) `documentElement.scrollWidth <= documentElement.clientWidth`
    and (b) no element's `getBoundingClientRect().right` exceeds `innerWidth` (+0.5px), i.e. no
    horizontal overflow. Where (a) holds but the two numbers differ, T09 shows once (a page with
    `document.documentElement.style.scrollbarGutter = "auto"` set from the script, never in the app)
    that the difference is the `scrollbar-gutter: stable` gutter (H/CLAUDE.md gotcha) and records it
    in section 9; R's `scrollbar-gutter: stable` stays.
13. **Four colour combinations.** The two schemes are screenshotted; the four combinations
    (OS light / OS dark × no preference / the opposite explicit `toon.theme`) are MEASURED by T09 on
    `/` and `/finance` at 390: computed `--bg`, `--surface`, `--bg-sunken`, `--fg-faint` and
    `--elevation-card` on `documentElement` equal the expected block's values from `theme.css`, `body`
    background equals `--bg`, and `<meta name="theme-color">` equals `THEME_COLORS[resolved]`.
14. **print.css is verified by printing** (T09): `page.emulateMedia({ media: "print" })` + `page.pdf()`
    of a seeded recipe's detail at 390 and 1440, `pdftotext` on the result: the first ingredient and
    the last method step are present; the shell labels "Profil", "Start", "Modul wechseln" and the
    household name chip are absent. The PDFs stay in `data/` (not committed).
15. **Commit hygiene.** Each task commits with a body naming the SPEC decision or source file served;
    no pushes; a fix found by T09 is its own commit naming the failing check.

## 2. Design rules (Table D) — the audit checklist

Every UI task (T02, T04–T08) applies these to every file it touches; T05/T06/T08 apply them to every
file they own. Source of each rule in brackets; read the source text, not only this table.

| # | Rule | Source |
| --- | --- | --- |
| D-1 | Type comes from `text-xs`/`text-sm`/`text-base` (sans body), `text-control` (13.5px), `text-item` (15px), `font-display` + `text-display-{xs,sm,md,lg,xl,2xl,3xl,4xl}` **always with `font-medium`** (never `font-semibold`/`font-bold` beside `font-display`: Newsreader ships one weight), and `.eyebrow` for every uppercase label (never a hand-rolled `uppercase tracking-*`). No arbitrary `text-[…]` size. No `leading-[…]` on a display step (each step carries its own line-height and letter-spacing). Headings and hero/total amounts use the display scale; list-row amounts stay sans `tabular-nums`. Inputs stay ≥16px. | R/CLAUDE.md "THE DISPLAY FAMILY SHIPS EXACTLY ONE WEIGHT", R/docs/redesign/SPEC.md §2 |
| D-2 | A page root is `flex flex-col gap-4` (or `flex flex-1 flex-col` when it carries a sticky bottom bar) and re-applies none of `mx-auto max-w-content px-gutter pt-4 pb-tabbar`, and no `p-*`/`px-*`. The only cap a page root may carry is `mx-auto w-full max-w-3xl` (forms/prose). | R/CLAUDE.md "A page component must NOT re-apply …" |
| D-3 | Horizontal bleed only via `.bleed-gutter` / `.bleed-gutter-inset` (never `-mx-4`, never `-mx-gutter`, which does not exist in H). Never `px-<n>` beside `.px-safe`. A hand-written utility (`.bleed-gutter*`, `.px-gutter`, `.px-safe`) cannot be undone by a `lg:` utility on the same element (they are emitted after Tailwind's), so never pair `.bleed-gutter-inset` with `lg:mx-0`/`lg:px-0`: bleed at every width. | R/CLAUDE.md "NEVER write `px-4 px-safe`", `styles/index.css` notes |
| D-4 | A grid track holding a control uses `minmax(0,1fr)`, never a bare `1fr` (Tailwind v4 `grid-cols-<n>` is already `minmax(0,1fr)`; arbitrary templates are the risk). Flex/grid items holding arbitrary text carry `min-w-0`; every `<fieldset>` wrapping arbitrary content carries `min-w-0`. | R/CLAUDE.md "`controlClasses` carries `min-w-0`", "A `<fieldset>` carries …" |
| D-5 | A bottom action bar is `sticky bottom-tabbar` (z-10/z-20), never `bottom-0`; it needs the unbroken flex chain (`flex-1` page root, a `flex-1` spacer above it) and, when it bleeds, `-mb-4`. A sticky TOP element uses `top-0` (there is no TopBar any more; `top-topbar` is dead). | R/CLAUDE.md "A bottom action bar needs `bottom-tabbar`", "A `sticky bottom-*` bar can only be pushed UP"; F gotcha 15 |
| D-6 | One overflow trigger per header (`ActionMenu`), never a row of icon buttons; the phone row carries at most one action. | R/CLAUDE.md "A header gets ONE overflow trigger" |
| D-7 | No arrow, chevron, check or ellipsis-menu glyph as text (`→ ← ✓ ▾ ⋯`): lucide icons with `aria-hidden`. (`…` U+2026 inside German copy is fine: it is in the latin subset and is copy, not an icon.) | R/CLAUDE.md same rule |
| D-8 | Colours only through semantic tokens (`bg-surface`, `text-fg-muted`, …), never raw hex, palette classes or `dark:` variants in components (brand marks such as the Google "G" excepted). | R/docs/redesign/SPEC.md §2 consequence (b) |
| D-9 | Text next to an icon in a flex row is ONE child (wrap the sentence in one `<span>`). | R/CLAUDE.md "Text next to an icon in a `flex` `<p>` must be ONE child" |
| D-10 | Content never goes through `t()`; new UI strings are catalog keys in de + en (en typed against de), one key per whole sentence; no new German unless the task says so. | R/docs/redesign/SPEC.md §5 "i18n"; SPEC D10 |
| D-11 | Lists render `thumbnailUrl()` / `listImageUrlFor()`, never `imageUrl`; recipe titles carry no clamp, no `truncate`, no fixed height (`text-pretty` only). | R/CLAUDE.md "A LIST never renders `imageUrl`", "`block` beats `line-clamp-N`" |

## 3. Task list and waves

List order is the structured-output order; the orchestrator takes up to three ready tasks per wave in
that order. Waves shown for `maxParallel = 3`; deps are what is binding. Every pair of tasks without a
dependency path between them has disjoint `files` (so any `maxParallel` is safe).

| Wave | Task | Tier | Title | Deps |
| --- | --- | --- | --- | --- |
| 1 | M4-T01 | build | Finance findings A and B (API) + ADR 0004 consequence | — |
| 1 | M4-T02 | core | Shell: ActionMenu-based module chip, sidebar trailing slots, NotFound icon | — |
| 1 | M4-T03 | build | PWA: manifest, shortcuts, icons, one theme-colour source | — |
| 2 | M4-T04 | build | Home cards: recipe week strip + shopping count, finance balance + period spend | — |
| 2 | M4-T05 | build | Finance audit A: transactions screens + module components | — |
| 2 | M4-T06 | build | Finance audit B: overview, plan, categories, participants + outbox note | — |
| 3 | M4-T07 | build | Recipe phone header rows + guard test | — |
| 4 | M4-T08 | build | Core screens audit + the design-system guard test | T02, T03, T04, T05, T06, T07 |
| 5 | M4-T09 | build | Integration: gates, headless screenshots, four combinations, print, PWA, docs | all |

**Shared files and their single owner.** `scripts/i18n-check.ts`,
`packages/shared/src/core/i18n/catalogs/server.{de,en}.ts`, `docs/adr/0004-*.md` — T01;
`apps/web/src/components/ui/ActionMenu.tsx`, `components/layout/{ModuleSwitcher,SideNav,
nav-items,NotFoundPage}`, `apps/web/src/modules/recipe/{index.ts,manifest.test.ts}` — T02; root
`package.json`, `apps/web/{vite.config.ts,index.html}`, `components/layout/Logo.tsx` — T03;
`core/features/home/{HomePage,ModuleCards}.tsx`, both `HomeCard.tsx` — T04;
`modules/finance/components/{AmountText,KindBadge,PageHeader,PeriodLabel}.tsx` — T05;
`modules/finance/phone-header.test.ts`, `modules/finance/components/PendingSyncNote.tsx` — T06;
`apps/web/src/styles/design-system.test.ts`, the other `core/features/**` files — T08; `CLAUDE.md`,
`docs/SPEC.md`, this plan's sections 9 and 10 — T09. No task adds a dependency (`bun.lock`
unchanged).

**Common checks** (run under `bash -c`: in zsh an unquoted `--include=*.tsx` is a glob error, and
`ls` is an alias in the user's zsh):

`LINKS_REC`, `LINKS_FIN`, `NOROUTER`, `NOCORE` are H/CLAUDE.md's greps ("The route tree is strict,
with one hole", "The finance greps") rewritten with `grep -P` and `\x27` / `\x60` for the single quote
and backtick, so they nest inside `bash -c '…'` (planner-tested: LINKS_REC finds 67 lines in R's tree
like the `-E` original and none in H; LINKS_FIN 25 in F, none in H; NOCORE 328 in F's features, none
in H):

```sh
cd /home/erics/software/toon-household && bash -c '! grep -rnP "(\bto[=:] ?|\bgo\(|\bgoTo\()[\"\x27\x60]/(recipes|plan|shopping|import|collections|tags|search|groups)\b|\bto[=:] ?[\"\x27]/[\"\x27]|useUrlRecipeFilters\([\"\x27]/[\"\x27]\)" apps/web/src/modules/recipe'
cd /home/erics/software/toon-household && bash -c '! grep -rnP "(\bto[=:] ?|\bgo\(|\bgoTo\()[\"\x27\x60]/(transactions|new|plan|categories|household)\b|\bto[=:] ?[\"\x27]/[\"\x27]" apps/web/src/modules/finance'
cd /home/erics/software/toon-household && bash -c '! grep -rnE "\b(Link|useNavigate|useParams|useBlocker)\b[^;]*from \"@tanstack/react-router\"" apps/web/src/modules/finance/features apps/web/src/modules/finance/components'
cd /home/erics/software/toon-household && bash -c '! grep -rnP "[\"\x27\x60](common|nav|transactions|categories|plan|balance|settings)\.[a-zA-Z]" apps/web/src/modules/finance --include="*.ts" --include="*.tsx" --exclude-dir=catalogs'
```

`NOGRAPH` (static manifest graph stays shell-free, SPEC §2): no file a manifest imports statically
imports `@/modules` (the registry) or `@/components/layout`:

```sh
cd /home/erics/software/toon-household && bash -c '! grep -nE "from \"@/modules\"|from \"@/components/layout" apps/web/src/modules/recipe/index.ts apps/web/src/modules/recipe/routes.tsx apps/web/src/modules/recipe/HomeCard.tsx apps/web/src/modules/finance/index.ts apps/web/src/modules/finance/routes.tsx apps/web/src/modules/finance/HomeCard.tsx $(ls apps/web/src/modules/recipe/nav-trailing.tsx apps/web/src/modules/recipe/features/plan/components/HomeWeekStrip.tsx apps/web/src/modules/recipe/features/plan/lib/home-week.ts 2>/dev/null)'
```

`FINAUDIT <dirs>` (D-1/D-2/D-3/D-5 violations outside comments; a hit fails):

```sh
cd /home/erics/software/toon-household && bash -c 'grep -rnE -e "-mx-gutter|-mx-4|top-topbar|leading-\[|text-\[[0-9]|bottom-0|px-safe|max-w-md p-4|font-display[^\"]*font-(semibold|bold)|font-(semibold|bold)[^\"]*font-display|uppercase" <dirs> | grep -vE "^[^:]+:[0-9]+:[[:space:]]*(\*|//|/\*|\{/\*)" | grep -q . && exit 1 || exit 0'
```

(Planner-tested on `0bee16c`: over `features/transactions` + `components` it reports the six lines
listed in section 1 and fails; over `features/{overview,plan,categories,participants}` + `HomeCard.tsx`
it passes already.)

**Parity check of i18n** (the parity half must say OK; the leftover half is read and classified):

```sh
cd /home/erics/software/toon-household && mkdir -p data && { bun run i18n:check > data/m4-i18n.log 2>&1; true; } && sed -n '/1\/2 German catalog parity/{n;p;}' data/m4-i18n.log | grep -qx '\[i18n:check\] OK'
```

Every brief also implies: read `H/docs/SPEC.md` §1, §2, §5, `H/CLAUDE.md` (Conventions, Gotchas in
use), this plan §1–§3, and the files named. Web tests are co-located `*.test.ts(x)` under
`apps/web/tsconfig.test.json` (no DOM in `bun test`: test pure helpers, or call a hook-free component
and inspect the element tree as `modules/layout.test.tsx` does, or read sources as
`modules/finance/phone-header.test.ts` does). API tests live in `apps/api/test/` (never `tests/`).

## 4. Tasks

### M4-T01 — Finance findings A and B (API) + ADR 0004 consequence (build)

**Goal.** Close the two medium server findings of M3 §10 with a regression test each (decision 1).

**Read.** SPEC D3, D8, D13; `H/docs/adr/0004-finance-participant-churn-rules.md`; `H/docs/plans/
m3-finance-module.md` §10 "Open findings at close"; H/CLAUDE.md "A seated participant cannot leave
while the ledger has rows", "Participants and the gate", "The finance test harness gives
toon-finance's names H semantics", "Finance server catalog (ADR 0002)"; F/CLAUDE.md gotchas 33, 38, 47;
F `docs/spec.md` §2.4 (balance anchor); H `apps/api/src/modules/finance/services/participants/
participants.service.ts` (`assertParticipantMayLeave`, `slot1UserId`, `otherMemberId`),
`services/plan/plan.service.ts` (the `payerId` patch near line 192, `personId` near line 298),
`routes/plan.ts`, `apps/api/src/lib/` (`ApiError` and how `validation_failed` details are built),
`apps/api/test/finance-participants.test.ts` (cases (h)…(h5)), `apps/api/test/finance-plan.test.ts`,
`apps/api/test/finance-transactions.test.ts` line ~145 (the solo-ledger booking case and what it
asserts), `apps/api/test/support/finance-harness.ts`.

**Work.**
1. A: in `assertParticipantMayLeave`, after deleting the leaver's seat on an empty ledger, if the
   leaver held slot 1 and the remaining participant holds slot 2, update that row to `member_slot = 1`
   (same `db` handle, so it is inside the caller's transaction). Keep the plan-payer handover. Update
   the doc comment.
2. A test in `finance-participants.test.ts` (next free label after (h5)): two participants, empty
   ledger, slot 1 leaves through the core leave/remove route; the survivor gets 200 on `GET …/balance`
   (balance 0) and on `GET …/transactions`, `GET …/participants` shows them in slot 1, and a booking
   behaves exactly as the solo-ledger case in `finance-transactions.test.ts` does (assert the same
   status and body shape that test asserts). A second case: slot 2 leaves → slot 1 unchanged (no
   re-seat). Both via the HTTP API, not the service.
3. B: in `plan.service.ts`, before writing a `payerId` (plan update) or a `personId` (income create
   and update), check the id against `finance_participants` for the household; otherwise throw the
   422 `validation_failed` with a details entry on the field and the key
   `server.finance.personNotParticipant`. Use the existing `ApiError` validation helper and detail
   shape (read `apps/api/src/lib/`; do not invent a second shape).
4. Tests in `finance-plan.test.ts`: for the plan payer and for income create and income update, a
   household member WITHOUT a slot (`createPlainHousehold` + `addMember`, or the harness's third
   member) and a user from another household each get 422 with that key in `details`; a participant
   still succeeds (existing tests cover it; add one assertion if none does).
5. Catalogs: add `"server.finance.personNotParticipant"` to the finance section of
   `packages/shared/src/core/i18n/catalogs/server.de.ts` ("Diese Person nimmt an der Haushaltskasse
   dieses Haushalts nicht teil.") and `server.en.ts` ("This person does not take part in this
   household's budget."); add the key with a one-line reason to `NEW_GERMAN` in
   `scripts/i18n-check.ts` (next to the M3 finance server keys).
6. ADR 0004: append one bullet to "Consequences": the survivor of a slot-1 leave on an empty ledger is
   re-seated in slot 1 (M4-T01), so the balance anchor always exists; incomes and the plan payer
   only name participants (finding B). No SPEC text changes (D3 already says "otherwise loses the
   seat").

**Files.** `apps/api/src/modules/finance/services/participants/participants.service.ts`,
`apps/api/src/modules/finance/services/plan/plan.service.ts`, `apps/api/src/modules/finance/routes/plan.ts`
(only if the route must pass the household's id), `apps/api/test/finance-participants.test.ts`,
`apps/api/test/finance-plan.test.ts`, `packages/shared/src/core/i18n/catalogs/server.de.ts`,
`packages/shared/src/core/i18n/catalogs/server.en.ts`, `scripts/i18n-check.ts`,
`docs/adr/0004-finance-participant-churn-rules.md`.

**Acceptance.** The new tests fail on `0bee16c` (the survivor gets 500; a non-participant payer is
accepted) and pass after the fix; every other finance test is unchanged and green; i18n parity OK
(the new key is in `NEW_GERMAN`); `import-order.test.ts` green.

**Verify.** `cd H && bun run typecheck`; `cd H && bun test apps/api/test/finance`;
`cd H && bun test apps/api/test/import-order.test.ts apps/api/test/households.test.ts`; the i18n
parity check (section 3); `cd H && grep -q 'personNotParticipant' packages/shared/src/core/i18n/catalogs/server.en.ts`.

---

### M4-T02 — Shell: ActionMenu-based module chip, sidebar trailing slots, NotFound icon (core)

**Goal.** SPEC D6/§5 chrome finished: the phone module chip is a real `ActionMenu` sheet, the sidebar
carries R's per-item counts and the Plan "Neu" pill, the 404 page is module-neutral, and the
module-less tab bar is pinned by tests (decisions 5, 6).

**Read.** SPEC D5, D6, §2 (the static-graph rule), §5; R/docs/redesign/SPEC.md §4.7 ("Shell, nav and
counts"); R `apps/web/src/components/layout/SideNav.tsx` lines 25–110 (the count slot, the
`planNewBadge` pill, the `shoppingCount` reduce); H/CLAUDE.md "No module-level constants over
`WEB_MODULES`", "A module owns its layout route and its static import graph stays shell-free",
"The library's recipe count is the module's own query (ADR 0001)"; H `components/ui/ActionMenu.tsx`,
`components/ui/Badge.tsx`, `components/layout/{ModuleSwitcher,SideNav,BottomTabBar,nav-items,
module-switcher-items,NotFoundPage}.ts(x)` and their tests, `modules/recipe/{index.ts,
manifest.test.ts}`, `modules/recipe/features/recipes/lib/queries.ts` (`useHouseholdRecipeCount`),
`modules/recipe/lib/queries.ts` (`shoppingListsQuery`); Table D rules D-1, D-6, D-7, D-9.

**Work.**
1. `ActionMenu`: add `renderTrigger` and `ActionMenuItem.current` exactly as decision 5 says; default
   behaviour unchanged; update the doc comment.
2. `ModuleSwitcher` chip variant → `ActionMenu` (`title` = `home.moduleSwitcher.title`, items from
   `moduleSwitcherItems`, `current` on the active one, `icon` = the item's lucide icon at `size-5`,
   `onSelect` → `navigate({ to: linkTo(item.to) })`; the trigger keeps today's chip markup, its
   `aria-label` (`${title}: ${label}`), `min-h-11`, and the classes; spread the trigger props). Delete
   the hand-built `Dialog` and its `select`/`useState`. The segmented variant is unchanged.
3. `NavItem.trailing?: ComponentType<{ isActive: boolean }>` in `nav-items.ts` (doc comment: sidebar
   only; a component, so hooks run inside it); `primaryNavItems` passes items through untouched.
   `SideNav`'s primary list renders `{item.trailing ? <item.trailing isActive={isActive} /> : null}`
   after the label (the trailing component positions itself with `ml-auto`).
4. `modules/recipe/nav-trailing.tsx` (static manifest import: imports only `@/components/ui`,
   `@/lib/*`, `@/modules/recipe/lib/*`, `@/modules/recipe/features/recipes/lib/queries`, `@toon/shared`):
   `RecipeCountTrailing` (`useActiveHousehold().householdId` → `useHouseholdRecipeCount`), `PlanNewTrailing`
   (`<Badge variant="accent" size="sm" className="ml-auto">{t("common.nav.planNewBadge")}</Badge>`),
   `ShoppingCountTrailing` (`useQuery(shoppingListsQuery(id))`, `sumItemCounts`), each count rendered
   as R does (`ml-auto text-xs font-medium tabular-nums`, `text-brand-hover` when active else
   `text-fg-subtle`, nothing while `undefined`); export the pure `sumItemCounts(lists)` (R's reduce:
   `undefined` if any `itemCount` is missing). Wire them as `trailing` on the three recipe `navItems`
   in `modules/recipe/index.ts`.
5. `NotFoundPage`: lucide `Compass` instead of `CookingPot` (the 404 is reachable outside any module).
6. Tests: `nav-items.test.ts` — outside a module with both modules enabled the primary items are
   Start · Rezepte · Finanzen · Profil (by `to` and `labelKey`), recipe only → Start · Rezepte ·
   Profil, none → Start · Profil, inside `/finance/transactions` → the three finance items · Profil,
   inside `/recipe/plan` → the three recipe items · Profil; `trailing` survives `primaryNavItems`.
   `modules/recipe/nav-trailing.test.ts` — `sumItemCounts` ([] → 0; all present → sum; one missing →
   `undefined`). `modules/recipe/manifest.test.ts` — the three navItems carry `trailing`, secondary
   items do not; the manifest still imports first without `@/modules` (existing test shape).

**Files.** `apps/web/src/components/ui/ActionMenu.tsx`,
`apps/web/src/components/layout/{ModuleSwitcher.tsx,SideNav.tsx,nav-items.ts,nav-items.test.ts,
NotFoundPage.tsx}`, `apps/web/src/modules/recipe/{index.ts,nav-trailing.tsx,nav-trailing.test.ts,
manifest.test.ts}`.

**Acceptance.** Typecheck green; the tests above pass; every existing `ActionMenu` call site compiles
unchanged; `ModuleSwitcher.tsx` no longer imports `Dialog`; `NOGRAPH` passes (nav-trailing included);
no new catalog key.

**Verify.** `cd H && bun run typecheck`; `cd H && bun test apps/web/src/components apps/web/src/modules`;
`cd H && bash -c '! grep -n "components/ui/Dialog\|<Dialog" apps/web/src/components/layout/ModuleSwitcher.tsx'`;
`NOGRAPH`; `LINKS_REC`; `cd H && bun run build`.

---

### M4-T03 — PWA: manifest, shortcuts, icons, one theme-colour source (build)

**Goal.** The installable household app: manifest with name, description, the household icon set and
three shortcuts; one source for the theme colour (decision 9).

**Read.** SPEC D5, D9, §8 (M4); R/CLAUDE.md "`apple-mobile-web-app-status-bar-style:
black-translucent` is banned", "`sw.js` and `index.html` must never be cached … `.webmanifest` needs
`application/manifest+json`", the `woff2`/`wasm` precache note; R `apps/web/vite.config.ts` lines
160–202 (manifest and `shortcuts`); F `apps/web/vite.config.ts` manifest block; F
`apps/web/src/lib/i18n/catalogs/transactions.de.ts` (`transactions.new.title`) and `nav.de.ts`
(`nav.create`); H `apps/web/{vite.config.ts,index.html}`, `apps/web/public/{favicon.svg,icons/}`,
`apps/web/src/lib/theme.ts`, `apps/web/src/styles/theme.css` (`--bg` in the four blocks),
`apps/web/src/components/layout/Logo.tsx`, `apps/web/tsconfig*.json` (three programs),
`apps/api/package.json` (`sharp`).

**Work.**
1. `apps/web/src/lib/theme-colors.ts`: `export const THEME_COLORS = { light: "#faf5ee", dark:
   "#17120f" } as const` with a comment naming the four places that must agree. `lib/theme.ts`
   uses it. `index.html`'s inline script keeps literal hexes (it cannot import) with a comment
   pointing at `theme-colors.ts`.
2. `apps/web/pwa-manifest.ts`: the manifest object (moved out of `vite.config.ts`), `as const`, no
   import from `vite-plugin-pwa`: `id`, `name`/`short_name` "Haushalt", `description` (decision 9),
   `lang`, `dir`, `start_url`, `scope`, `display`, `display_override`, `orientation`,
   `background_color` and `theme_color` = `THEME_COLORS.light` (imported relatively from
   `./src/lib/theme-colors.ts`), `categories`, `icons` (the same six files, new artwork), and
   `shortcuts`: `{ name: "Rezept importieren", short_name: "Importieren", url: "/recipe/import" }`,
   `{ name: "Neues Rezept", short_name: "Neu", url: "/recipe/recipes/new" }`, `{ name: "Buchung
   erfassen", short_name: "Erfassen", url: "/finance/new" }`, each with `icons: [{ src:
   "/icons/icon-192.png", sizes: "192x192", type: "image/png" }]` (R's shape). `vite.config.ts`
   imports it (`manifest: PWA_MANIFEST`); everything else in `vite.config.ts` is unchanged.
3. Artwork: `apps/web/public/favicon.svg` redrawn — `viewBox="0 0 48 48"`, `<rect width="48"
   height="48" rx="11" fill="#c2532c"/>`, then `<g transform="translate(6 6) scale(1.5)" fill="none"
   stroke="#faf5ee" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` with lucide
   `House`'s two paths (`M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8` and `M3 10a2 2 0 0 1
   .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z`; ISC,
   comment it). `scripts/icons.ts` (root script `"icons": "bun run scripts/icons.ts"` in
   `package.json`): loads `sharp` with `createRequire(new URL("../apps/api/package.json",
   import.meta.url))("sharp")`, renders `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` (180),
   `favicon-32.png` from the SVG, and `maskable-192.png`/`maskable-512.png` from a maskable variant
   (square, no `rx`, glyph at `translate(9.6 9.6) scale(1.2)` so it sits inside the 80% safe circle);
   run it once and commit the PNGs. `index.html`'s `mask-icon` colour stays `#c2532c`.
4. `components/layout/Logo.tsx`: the same house mark (tile `fill="var(--brand)"`, strokes
   `var(--brand-fg)` or `currentColor` when `bare`), default `title` "Haushalt"; props unchanged.
5. Tests: `apps/web/src/lib/theme-colors.test.ts` — reads `src/styles/theme.css` and resolves `--bg`
   in each of the four blocks (follow one `var(--toon-…)` indirection to the palette in `:root`):
   light blocks = `THEME_COLORS.light`, dark blocks = `THEME_COLORS.dark`; reads `apps/web/index.html`
   and finds both hexes in the inline script and `content="#faf5ee"` on the meta.
   `apps/web/src/pwa-manifest.test.ts` — imports `../pwa-manifest.ts`: name/short_name "Haushalt",
   `theme_color`/`background_color` = `THEME_COLORS.light`, the three shortcut URLs exactly, every
   icon and shortcut-icon `src` exists under `apps/web/public` and its PNG IHDR width/height (bytes
   16–23) equals the declared `sizes`; one `purpose: "maskable"` pair present.

**Files.** `apps/web/vite.config.ts`, `apps/web/pwa-manifest.ts`, `apps/web/index.html`,
`apps/web/public/favicon.svg`, `apps/web/public/icons/{icon-192,icon-512,apple-touch-icon,favicon-32,
maskable-192,maskable-512}.png`, `apps/web/src/lib/{theme.ts,theme-colors.ts,theme-colors.test.ts}`,
`apps/web/src/pwa-manifest.test.ts`, `apps/web/src/components/layout/Logo.tsx`, `scripts/icons.ts`,
`package.json` (root, the `icons` script only).

**Acceptance.** Typecheck (all three web programs) green; both tests pass; `bun run build` emits
`apps/web/dist/manifest.webmanifest` containing the three shortcuts and `"theme_color":"#faf5ee"`;
no `fonts.googleapis`; `bun.lock` unchanged.

**Verify.** `cd H && bun run typecheck`; `cd H && bun test apps/web/src/lib apps/web/src/pwa-manifest.test.ts`;
`cd H && bun run build`; `cd H && grep -q '/finance/new' apps/web/dist/manifest.webmanifest && grep -q '/recipe/import' apps/web/dist/manifest.webmanifest && grep -q '"theme_color":"#faf5ee"' apps/web/dist/manifest.webmanifest`;
`cd H && git diff --quiet HEAD -- bun.lock`;
`cd H && bash -c '! grep -rn "fonts.googleapis" apps/web/index.html apps/web/vite.config.ts apps/web/src'`.

---

### M4-T04 — Home cards: recipe week strip + shopping count, finance balance + period spend (build)

**Goal.** SPEC §5 Home with real data in the design system: the recipe card shows this week as a
strip and the active list's count, the finance card the balance line and the current period's spend
(decision 8).

**Read.** SPEC D5, D6, §2 (static graph), §5; R/docs/redesign/SPEC.md §4.1 (day-card states: planned
`--surface`/`--line`, empty transparent `--fg-faint`, today `--brand-soft` ground + `--brand`
border), §5 (layout, titles never truncate); R/CLAUDE.md "A RECIPE TITLE NEVER TRUNCATES AT ALL", "A
LIST never renders `imageUrl`"; F/CLAUDE.md gotcha 38 (never a raw sign) and F `docs/spec.md` §4.3
(Übersicht: balance first); H `core/features/home/{HomePage,ModuleCards}.tsx`,
`modules/recipe/HomeCard.tsx`, `modules/recipe/features/plan/components/{WeekStrip,PlanDayCard}.tsx`
(states and classes to mirror, not to import), `modules/recipe/lib/{queries,format}.ts`,
`apps/web/src/lib/format.ts` (`formatWeekdayShort`, `formatDayOfMonth`), `packages/shared/src/core/
calendar.ts` (`planWeek`, `planWeekRange`, `todayPlanDate`), `packages/shared/src/modules/recipe/
schemas/shopping.ts` (`ShoppingList`: `name`, `itemCount?`), `modules/finance/HomeCard.tsx`,
`modules/finance/components/{AmountText,PeriodLabel}.tsx`, `modules/finance/lib/{queries,format}.ts`,
`modules/finance/features/overview/components/BalanceHero.tsx` (the sentence logic); Table D D-1, D-4,
D-7, D-9, D-10, D-11.

**Work.**
1. Pure helpers `modules/recipe/features/plan/lib/home-week.ts` + `home-week.test.ts`:
   `homeWeekDays(entries, week: PlanDate[], today: PlanDate)` → seven `{ date, state: "today" |
   "planned" | "empty", count }` (today wins over planned); `upcomingEntries(entries, today, max = 3)`
   → entries with `plannedOn >= today`, sorted by `plannedOn` then `position`;
   `activeShoppingList(lists)` → the first list or `null`. Tests cover today on Monday and on
   Sunday, several entries on one day, an empty week, an empty list array.
2. `modules/recipe/features/plan/components/HomeWeekStrip.tsx` (static manifest graph: imports only
   `@/components/ui`, `@/lib/*`, `@/modules/recipe/lib/*`, `@toon/shared`, lucide): header row with
   `<p className="eyebrow text-fg-faint">` `recipe.plan.strip.heading` and an `AppLink` to
   `/recipe/plan` (`recipe.plan.strip.link` + lucide `ArrowRight`, `aria-hidden`); a `grid
   grid-cols-7 gap-1` of day cells, each an `AppLink` to `/recipe/plan` with the weekday
   (`formatWeekdayShort`, `.eyebrow`) and the day of month (`text-control tabular-nums`), state
   classes after R §4.1 (today: `bg-brand-soft text-brand-soft-fg ring-1 ring-brand`; planned:
   `bg-surface-2 text-fg` + a `size-1.5 rounded-full bg-brand` dot per entry up to 3; empty:
   `text-fg-faint`), `min-w-0` on every cell; below it up to three `upcomingEntries` as rows
   "weekday · title" (title is content, `text-sm text-fg text-pretty`, NO truncate) linking to
   `/recipe/recipes/$recipeId`. Skeleton while the plan query is pending.
3. `modules/recipe/HomeCard.tsx`: header (icon tile + `h2 font-display text-display-md font-medium`
   linking to `/recipe`), `HomeWeekStrip`, then the shopping line: `activeShoppingList` → an
   `AppLink` to `/recipe/shopping/$listId` with lucide `ShoppingBasket`, the list name (content) and
   " · " + `recipe.shopping.list.itemCount` (only when `itemCount` is defined) as ONE text child;
   no lists → a `buttonClasses({ variant: "secondary", size: "sm" })` link "Einkauf"
   (`common.nav.shopping`) to `/recipe/shopping`. Remove the old five-title list.
4. `modules/finance/HomeCard.tsx`: same header pattern (Wallet); participant: eyebrow
   `finance.balance.title` + the balance line (unchanged logic, `AmountText size="lg"`), then a row
   with `PeriodLabel` of `currentPeriod(Date.now())` and `finance.balance.month.total` on the left and
   `AmountText cents={totalExpenseCents} size="md"` on the right (`flex items-baseline
   justify-between gap-3`, `min-w-0` on the label side), then the two links (`/finance`, and
   `/finance/new` with lucide `Plus` + `finance.nav.create`). Non-participant line and the
   no-ledger-query rule unchanged.
5. `HomePage`: cards in `grid gap-4 md:grid-cols-2` with each card `min-w-0` (wrap in nothing; pass
   `className` only if the card accepts it); header unchanged. `ModuleCards`: Table D pass only.
6. No catalog file changes (decision 8). If a string seems missing, use the closest existing key and
   record it in the commit body.

**Files.** `apps/web/src/modules/recipe/HomeCard.tsx`,
`apps/web/src/modules/recipe/features/plan/components/HomeWeekStrip.tsx`,
`apps/web/src/modules/recipe/features/plan/lib/{home-week.ts,home-week.test.ts}`,
`apps/web/src/modules/finance/HomeCard.tsx`, `apps/web/src/core/features/home/{HomePage,ModuleCards}.tsx`.

**Acceptance.** Typecheck green; `home-week.test.ts` passes; `manifest.test.ts` / `persist.test.ts` of
both modules still pass (manifest imports first, no TDZ); `NOGRAPH` passes; no catalog file in the
diff; no `truncate`/`line-clamp` on a recipe title in the two new/changed recipe files.

**Verify.** `cd H && bun run typecheck`; `cd H && bun test apps/web/src/modules apps/web/src/core`;
`NOGRAPH`; `LINKS_REC`; `LINKS_FIN`; the i18n parity check (section 3: a new German key that is
not in `NEW_GERMAN` fails it, which is what "no new German" needs);
`FINAUDIT apps/web/src/modules/finance/HomeCard.tsx apps/web/src/modules/recipe/HomeCard.tsx apps/web/src/modules/recipe/features/plan/components/HomeWeekStrip.tsx`;
`cd H && bun run build`.

---

### M4-T05 — Finance audit A: transactions screens + module components (build)

**Goal.** The transactions feature and the four module components brought onto D5 token by token
(Table D), with the violations measured in section 1 fixed.

**Read.** SPEC D5, D13; Table D (all rules) and its sources: R/CLAUDE.md "`controlClasses` carries
`min-w-0`", "THE DISPLAY FAMILY SHIPS EXACTLY ONE WEIGHT", "NEVER write `px-4 px-safe`", "A page
component must NOT re-apply …", "A `sticky bottom-*` bar can only be pushed UP", "A header gets ONE
overflow trigger", "A `<fieldset>` carries …", "A bottom action bar needs `bottom-tabbar`";
R/docs/redesign/SPEC.md §2 and §5; F/CLAUDE.md gotchas 15 (Buchen bar), 38 (sign); M3 plan Table R
(section 2 of `m3-finance-module.md`, what M3 already restyled); `apps/web/src/styles/index.css`
(the utilities and the `@theme inline` scale); R `apps/web/src/features/shopping/
ShoppingListDetailPage.tsx` (H copy: `modules/recipe/features/shopping/ShoppingListDetailPage.tsx`
line ~349: the reference bleeding sticky bar `bottom-tabbar sticky z-20 -mb-4 bleed-gutter-inset`);
every file in **Files**.

**Work.** Walk every file in Files against Table D; concretely at least:
1. `NewTransactionPage` / `EditTransactionPage` bars: `sticky bottom-tabbar z-20 -mb-4
   bleed-gutter-inset border-t border-line bg-bg/95 py-3 backdrop-blur-sm` (drop `-mx-gutter`,
   `px-gutter`, `lg:mx-0`, `lg:rounded-b-card`: decision/D-3, the bar bleeds at every width), keep the
   `flex-1` spacer and the `flex flex-1 flex-col` roots.
2. Their "no other participant" branches: drop the `mx-auto w-full max-w-md p-4` wrapper; render a
   `flex flex-col gap-4` root with the module `PageHeader` (title as the loaded state's) and the
   `EmptyState` (so the phone chips are there too).
3. `TransactionList` day header: `sticky top-0 z-10 bleed-gutter-inset … eyebrow text-fg-faint`
   (drop `top-topbar`, `-mx-gutter`, `px-gutter`, the `lg:` resets); opaque `bg-bg` or `bg-bg/95
   backdrop-blur-sm`.
4. `components/PageHeader.tsx` `h1`: `font-display text-display-2xl font-medium text-fg
   lg:text-display-3xl` (the steps carry 1.05 / 1.1; the `leading-[…]` go).
5. `components/AmountText.tsx` sizes: `sm: "text-sm"`, `md: "text-base"` (list rows, sans,
   `tabular-nums` kept), `lg: "font-display text-display-lg font-medium"`, `xl: "font-display
   text-display-4xl font-medium"`; check every call site's visual intent (BalanceHero uses `xl`).
   `AmountInput`: `text-4xl font-semibold` → `font-display text-display-4xl font-medium` (still
   ≥16px), currency suffix stays `text-display-lg`.
6. `TransactionFilters`: every `<fieldset>` gets `min-w-0`; any arbitrary grid template gets
   `minmax(0,1fr)`; one overflow trigger in the screen header (`TransactionsPage`,
   `TransactionDetailPage`); text next to icons as one child; `KindBadge`/`KindPicker`/`CategorySheet`
   chips: `text-control`/`text-xs`, `min-w-0` + `truncate` on category names (content, not titles).
7. Any `font-semibold` on a heading → `font-display text-display-* font-medium` or plain
   `font-medium`; never semibold beside `font-display`.
8. Keep behaviour: `mutationId` minted at the call site, `optimistic` payloads, `useUnsavedWork`, the
   kind kept after booking, every catalog key; German strings untouched.

**Files.** `apps/web/src/modules/finance/features/transactions/{TransactionsPage,NewTransactionPage,
EditTransactionPage,TransactionDetailPage}.tsx`,
`apps/web/src/modules/finance/features/transactions/components/{AmountInput,CategorySheet,KindPicker,
TagInput,TransactionFilters,TransactionFormFields,TransactionList,TransactionRow}.tsx`,
`apps/web/src/modules/finance/components/{AmountText,KindBadge,PageHeader,PeriodLabel}.tsx`.

**Acceptance.** `FINAUDIT` over the two directories passes (it fails on `0bee16c`); `phone-header.test.ts`,
`offline.test.ts`, `queries.test.ts`, `format.test.ts` and both module manifest tests still pass;
`LINKS_FIN`, `NOROUTER`, `NOCORE` pass; no catalog change.

**Verify.** `cd H && bun run typecheck`; `cd H && bun test apps/web/src/modules/finance`;
`FINAUDIT apps/web/src/modules/finance/features/transactions apps/web/src/modules/finance/components`;
`LINKS_FIN`; `NOROUTER`; `NOCORE`; the i18n parity check; `cd H && bun run build`.

---

### M4-T06 — Finance audit B: overview, plan, categories, participants + outbox note (build)

**Goal.** The rest of the finance screens on D5 (Table D), and the "N Änderungen warten" indicator
(decision 7).

**Read.** As T05 (Table D and its sources), plus F/CLAUDE.md gotchas 7–11 (the offline outbox) and F
`apps/web/src/components/layout/OfflineBanner.tsx` + `lib/pwa.ts` `usePendingSyncCount` (F's
indicator, behaviour reference); H `modules/finance/features/transactions/lib/offline.ts` (the
mutation keys, read-only), `modules/finance/catalogs/common.{de,en}.ts` (`finance.common.syncPending`),
`modules/finance/phone-header.test.ts` (counts `<PhoneHeaderRow />` per file — keep the counts or
update the test in this task), `modules/finance/routes.tsx` (FinanceGate is the pathless
`participant-gate` route), every file in Files.

**Work.**
1. Table D pass over every file in Files (BalanceHero, FixedCostCard, MonthSummaryCard,
   RecentTransactionsCard, SettleDialog, SpendByCategoryCard, OverviewPage; PlanPage, PlanSummary,
   FixedCostItemList, IncomeList, PlanPeriodList, RecalculateDialog; CategoriesPage, CategoryRow,
   DeleteCategoryDialog; FinanceGate, NonParticipantState, ParticipantsSection,
   EnableFinanceDialog): display-scale amounts and headings with `font-medium`, `.eyebrow` labels,
   `min-w-0` on flex/grid text items, one overflow trigger per header, lucide glyphs, no page-root
   padding. Confirm the plan payer and income person pickers list `finance_participants` only
   (they read `useHouseholdMembers`, which maps participants; after T01 the API refuses anyone else).
2. `modules/finance/lib/pending-sync.ts` + `pending-sync.test.ts`: `isFinanceOutboxMutation(key)`
   (key starts `["toon","finance","tx"]`) and `countPendingFinanceSync(states: Array<{ mutationKey?:
   readonly unknown[]; isPaused: boolean }>)`; tests: paused finance tx counted, unpaused not, a
   paused recipe shopping mutation not, an empty list 0.
3. `modules/finance/components/PendingSyncNote.tsx`: `useMutationState({ filters: { predicate: (m) =>
   isFinanceOutboxMutation(m.options.mutationKey) && m.state.isPaused }, select: () => 1 })`, count →
   `null` at 0, else `<p role="status" className="flex items-center gap-2 rounded-control
   bg-warning-soft px-3 py-1.5 text-xs font-medium text-warning-soft-fg">` with lucide `CloudUpload`
   (`size-4 shrink-0`, `aria-hidden`) and ONE `<span>` holding `t("finance.common.syncPending", {
   count })`.
4. `FinanceGate`: for a participant render `<><PendingSyncNote /><Outlet /></>` (Fragment, decision
   7); loading/error/non-participant branches unchanged (their `PhoneHeaderRow` counts stay).
5. `phone-header.test.ts`: keep green; add one test that `FinanceGate.tsx` renders `<PendingSyncNote`
   inside a Fragment (source contains `<>` immediately before it), so a later wrapper `div` is caught.

**Files.** `apps/web/src/modules/finance/features/overview/{OverviewPage.tsx,components/BalanceHero.tsx,
components/FixedCostCard.tsx,components/MonthSummaryCard.tsx,components/RecentTransactionsCard.tsx,
components/SettleDialog.tsx,components/SpendByCategoryCard.tsx}`,
`apps/web/src/modules/finance/features/plan/{PlanPage.tsx,components/PlanSummary.tsx,
components/FixedCostItemList.tsx,components/IncomeList.tsx,components/PlanPeriodList.tsx,
components/RecalculateDialog.tsx}`,
`apps/web/src/modules/finance/features/categories/{CategoriesPage.tsx,components/CategoryRow.tsx,
components/DeleteCategoryDialog.tsx}`,
`apps/web/src/modules/finance/features/participants/{FinanceGate,NonParticipantState,ParticipantsSection,
EnableFinanceDialog}.tsx`, `apps/web/src/modules/finance/components/PendingSyncNote.tsx`,
`apps/web/src/modules/finance/lib/{pending-sync.ts,pending-sync.test.ts}`,
`apps/web/src/modules/finance/phone-header.test.ts`.

**Acceptance.** `FINAUDIT` over the four feature directories passes; `pending-sync.test.ts` and
`phone-header.test.ts` pass; `ParticipantsSection` and `EnableFinanceDialog` (static manifest
imports) still import neither `@/modules` nor `@/components/layout` nor `PageHeader`; no catalog
change; `LINKS_FIN`, `NOROUTER`, `NOCORE` pass.

**Verify.** `cd H && bun run typecheck`; `cd H && bun test apps/web/src/modules/finance`;
`FINAUDIT apps/web/src/modules/finance/features/overview apps/web/src/modules/finance/features/plan apps/web/src/modules/finance/features/categories apps/web/src/modules/finance/features/participants`;
`cd H && bash -c '! grep -nE "from \"@/modules\"|@/components/layout|components/PageHeader" apps/web/src/modules/finance/features/participants/ParticipantsSection.tsx apps/web/src/modules/finance/features/participants/EnableFinanceDialog.tsx apps/web/src/modules/finance/components/PendingSyncNote.tsx'`;
`LINKS_FIN`; `NOROUTER`; `NOCORE`; the i18n parity check; `cd H && bun run build`.

---

### M4-T07 — Recipe phone header rows + guard test (build)

**Goal.** Every recipe screen opens with the household and module chips on a phone (SPEC D6, §5;
M3 §9.11 obligation; decision 10), guarded like finance.

**Read.** SPEC D6, §5; H/CLAUDE.md M4 obligation "recipe screens without a `PhoneHeaderRow`";
`H/docs/plans/m3-finance-module.md` §9.11; H `components/layout/PhoneHeaderRow.tsx` (its print
reason: `<header data-app-shell>`), `modules/finance/phone-header.test.ts` (the pattern to copy),
`modules/recipe/routes.tsx` (the lazy screen list), `modules/recipe/features/recipes/
RecipeListPage.tsx` and `features/shopping/ShoppingListsPage.tsx` (the two screens that already render
it: placement reference); R/CLAUDE.md "A page component must NOT re-apply …", "A `sticky bottom-*`
bar …" (do not break `ShoppingListDetailPage`'s flex chain), "print.css is invisible to all five
gates" (the detail screen's exemption); R/docs/redesign/SPEC.md §1 (artboard 1f); every file in Files.

**Work.**
1. Add `import { PhoneHeaderRow } from "@/components/layout/PhoneHeaderRow";` and render
   `<PhoneHeaderRow />` as the first child of the page root in: `features/plan/PlanPage.tsx`,
   `features/recipes/{RecipeNewPage,RecipeEditPage}.tsx`, `features/import/{ImportPage,
   ImportReviewPage}.tsx`, `features/collections/{CollectionsPage,CollectionDetailPage}.tsx`,
   `features/tags/TagsPage.tsx`, `features/cards/CardsPage.tsx`, `features/shopping/
   {ShoppingListDetailPage,ShoppingHistoryPage}.tsx` — also in every early return that renders a page
   root (loading skeleton, error, not found). Where a screen's header has exactly one action that
   crowds the `<h1>` on a phone, it MAY move into `action` (decision 10); otherwise leave headers as
   they are. Do not add a wrapper element around the page root; `ShoppingListDetailPage`'s root stays
   `flex-1` with the spacer and sticky bar last.
2. `modules/recipe/phone-header.test.ts` (copy the finance test's shape): read `routes.tsx`, collect
   the `import("./features/…")` screens, assert ≥ 14 screens, and for each screen not in
   `EXEMPT = { "./features/recipes/RecipeDetailPage.tsx": "artboard 1f: the hero owns the top edge;
   its scrim back control leads to /recipe, which has the chips; print.css relies on this layout" }`
   assert the source matches `/<PhoneHeaderRow[\s/>]/`; assert the exemption's file exists (so a
   rename cannot silently widen it).

**Files.** `apps/web/src/modules/recipe/features/plan/PlanPage.tsx`,
`apps/web/src/modules/recipe/features/recipes/{RecipeNewPage,RecipeEditPage}.tsx`,
`apps/web/src/modules/recipe/features/import/{ImportPage,ImportReviewPage}.tsx`,
`apps/web/src/modules/recipe/features/collections/{CollectionsPage,CollectionDetailPage}.tsx`,
`apps/web/src/modules/recipe/features/tags/TagsPage.tsx`,
`apps/web/src/modules/recipe/features/cards/CardsPage.tsx`,
`apps/web/src/modules/recipe/features/shopping/{ShoppingListDetailPage,ShoppingHistoryPage}.tsx`,
`apps/web/src/modules/recipe/phone-header.test.ts`.

**Acceptance.** The guard passes for every non-exempt screen; no `text-[…]` count changes in these
files (section 1's pinned numbers); `LINKS_REC` passes; no catalog change; screens stay lazy (the
manifest graph is untouched).

**Verify.** `cd H && bun run typecheck`; `cd H && bun test apps/web/src/modules/recipe`; `LINKS_REC`;
`NOGRAPH`; the i18n parity check; `cd H && bun run build`.

---

### M4-T08 — Core screens audit + the design-system guard test (build)

**Goal.** The core screens pass Table D, and one `bun test` file makes the exit criteria's greps and
the pinned recipe exceptions permanent (decisions 3, 4).

**Read.** Table D and its sources; R/CLAUDE.md "THE PALETTE IS DECLARED FOUR TIMES …",
"`features/recipes/print.css` is invisible to all five gates"; SPEC D5; H `styles/{theme.css,
index.css}`, `modules/recipe/features/recipes/print.css`, `core/features/{settings,households,auth}/**`,
`core/features/home/ManageModulesDialog.tsx`, section 1 of this plan (the measured lists).

**Work.**
1. Table D pass over every core file in Files; at least `InvitePanel.tsx`
   `sm:grid-cols-[1fr_11rem]` → `sm:grid-cols-[minmax(0,1fr)_11rem]`; `SettingsPage`'s theme/language
   `grid-cols-3` button groups: `min-w-0` + `truncate` on labels; headings on the display scale with
   `font-medium`; `font-semibold` never beside `font-display`. German strings untouched (decision 2).
2. `apps/web/src/styles/design-system.test.ts` (reads files with `node:fs` relative to
   `import.meta.dir`; ignores comment lines — trimmed line starting with `*`, `//`, `/*`, `{/*`):
   (a) `theme.css`: split into the four blocks (`:root {` first; `@media (prefers-color-scheme:
   dark)`; `:root[data-theme="light"]`; `:root[data-theme="dark"]`); the custom-property sets of the
   three override blocks are equal (today 39) and `:root` contains that set; every `var(--x)` used by
   a `--color-*` / `--shadow-*` line of `index.css`'s `@theme inline` is in the set or in `:root`.
   (b) No `fonts.googleapis` / `fonts.gstatic` in `apps/web/index.html`, `apps/web/vite.config.ts`,
   `apps/web/pwa-manifest.ts` or any file under `apps/web/src` (this test file excepted).
   (c) Arbitrary text sizes `/text-\[\d[\d.]*(px|rem|em)\]/g` in `src/**/*.{ts,tsx}` (non-comment
   lines): the per-file counts EQUAL the pinned `RECIPE_EXCEPTIONS` map (section 1: 34 hits in 18
   files incl. `components/layout/BottomTabBar.tsx` 1 and `components/ui/Avatar.tsx` 2); a comment
   above the map names R/CLAUDE.md and R `docs/redesign/PR.md` as the record.
   (d) `bottom-0` inside a string literal only in `components/layout/BottomTabBar.tsx` and
   `modules/recipe/features/recipes/components/RecipeHeroMobile.tsx` (reason in the map).
   (e) No string literal holding `font-display` together with `font-semibold`/`font-bold`.
   (f) No string literal holding `px-safe` together with `px-<n>`/`px-gutter`; no `-mx-gutter` and no
   `top-topbar` anywhere; no string literal holding `bleed-gutter` together with `lg:mx-0`/`lg:px-0`.
   (g) Hand-rolled `uppercase` + `tracking-` in one string literal only in the four R files
   (`IngredientList`, `StepList`, `RecipeDetailPage`, `ItemDetailDialog`).
   (h) The glyphs `→ ← ✓ ▾ ⋯` outside comments only on the four pinned catalog lines
   (`household.detail.backLink` de/en, `recipe.collectionDetail.backLink` de/en).
   (i) An arbitrary grid template never holds a bare `1fr` (`grid-cols-\[` … `1fr` not preceded by
   `minmax(0,`).
   (j) `data-app-shell` appears only on `<header`, `<nav`, `<aside` JSX elements, and `print.css`
   still lists `header[data-app-shell]`, `nav[data-app-shell]`, `aside[data-app-shell]`,
   `[data-print="hide"]`.
   Each assertion's failure message names the file:line and the Table D rule.

**Files.** `apps/web/src/core/features/settings/SettingsPage.tsx`,
`apps/web/src/core/features/households/{HouseholdsPage,HouseholdDetailPage,HouseholdSwitcher}.tsx`,
`apps/web/src/core/features/households/components/{InvitePanel,MemberList}.tsx`,
`apps/web/src/core/features/auth/{AuthLayout,LoginPage,RegisterPage,ForgotPasswordPage,
ResetPasswordPage,VerifyEmailPage,InvitePage,OAuthCallbackPage,OAuthButtons}.tsx`,
`apps/web/src/core/features/home/ManageModulesDialog.tsx`, `apps/web/src/styles/design-system.test.ts`.

**Deps.** T02, T03, T04, T05, T06, T07 (the test pins the final tree).

**Acceptance.** `design-system.test.ts` passes on the merged tree and fails when a violation is
introduced (demonstrate once locally by adding `text-[13px]` to a finance file, run, revert; note
it in the commit body); the core grep `FINAUDIT apps/web/src/core` passes except the hits the test
pins (none expected in core).

**Verify.** `cd H && bun run typecheck`; `cd H && bun test apps/web/src/styles apps/web/src/core`;
`FINAUDIT apps/web/src/core`; `cd H && bun test`; `cd H && bun run build`.

---

### M4-T09 — Integration: gates, headless screenshots, four combinations, print, PWA, docs (build)

**Goal.** Prove the M4 exit criteria on the merged tree, record them in section 9, sync the docs.

**Read.** SPEC §5, §7, §8 (M4 exit); this plan §1, §5–§8; H/CLAUDE.md "Headless runs",
"`scrollbar-gutter: stable`", "Service worker", "The offline queue survives a second reload",
"Long commands"; R/CLAUDE.md "Verify a phone layout in a real headless browser", "print.css …",
"`.webmanifest` needs `application/manifest+json`"; `H/docs/plans/m3-finance-module.md` §9.6–§9.7
(how the M3 headless and offline runs were done, incl. §9.9's pitfalls).

**Work.**
1. Gates, each to `data/m4-t09-<gate>.log` ending `exit=$?` (backgrounded, polled): `bun install
   --frozen-lockfile`, `bun run typecheck`, `bun test`, `bun run build`, `bun run i18n:check` (parity
   OK; classify every leftover hit: expected the 137 classes of M3 plus any comment quote added in
   M4; a German literal in code is a bug).
2. Fresh `data/m4.db` (`DATABASE_URL=file:./data/m4.db`, a 32-hex `SESSION_SECRET`): `bun run
   db:migrate`, `bun run seed` twice. Start the built app (`WEB_DIST_DIR=./apps/web/dist bun run
   start`, port 3001; log to `data/m4-t09-server.log`). Curl: `/manifest.webmanifest` has
   `content-type: application/manifest+json`, the three shortcuts, every icon URL answers 200
   `image/png`; finding A/B smoke (kim as payer → 422 `validation_failed` with
   `server.finance.personNotParticipant`).
3. Headless (Playwright installed in a scratch directory OUTSIDE the repo, one log ending `exit=$?`;
   log in once per user with `fetch("/api/auth/login")` and reuse `storageState`; mind the login rate
   limit and the persisted `["toon","me"]` pitfalls in H/CLAUDE.md): screenshots per decision 11 into
   `docs/plans/screenshots/m4/`. Exit set (390 and 1440 × light and dark): `home`, `switcher`,
   `recipe-library`, `recipe-plan`, `recipe-shopping`, `finance-overview`, `finance-transactions`,
   `finance-new`, `settings`. Other screens (390-light and 1440-dark): `recipe-detail`,
   `recipe-edit`, `recipe-new`, `recipe-import`, `recipe-collections`, `recipe-collection-detail`,
   `recipe-tags`, `recipe-cards`, `recipe-shopping-detail`, `recipe-shopping-history`,
   `finance-transaction-detail`, `finance-transaction-edit`, `finance-plan`, `finance-categories`,
   `finance-non-participant` (as kim), `households`, `household-detail`, `login`, `register`,
   `not-found`; `recipe-import-review` only if a draft can be created as M2's run did (else record
   why not). On EVERY captured page: rendered (no "Diese Seite gibt es nicht" except `not-found`), no
   console errors, decision 12's two overflow assertions with raw numbers logged. Chrome checks:
   at 390 on `/` the tab bar (`nav.fixed`) reads Start · Rezepte · Finanzen · Profil; inside
   `/recipe` Rezepte · Plan · Einkauf · Profil; inside `/finance` Übersicht · Buchungen · Erfassen ·
   Profil; the module chip opens a sheet (`role="dialog"`) listing Start, Rezepte, Finanzen with the
   current one `aria-current`, and choosing Finanzen lands on `/finance`; at 1440 the sidebar's
   segmented switcher lists the same three and the recipe items show the recipe count, the "Neu"
   pill on Plan and the shopping count. Home: the recipe card shows seven day cells and the active
   list's count; the finance card shows the balance sentence and the period spend. Every phone
   screen except `recipe-detail` shows the household chip (`header[data-app-shell]`). The "Buchen" bar
   on `/finance/new` at 390 sits above the tab bar (bounding boxes do not overlap) and spans the
   viewport width (bleed: left 0, right 390 ± 1).
4. Four combinations per decision 13 (log the computed values).
5. Print per decision 14 (`pdftotext` from poppler; PDFs in `data/`).
6. Offline note on the built app with the service worker active: as demo on `/finance/new`,
   `setOffline(true)`, book one row → `PendingSyncNote` shows "1 Änderung wartet auf Übertragung.";
   `setOffline(false)` → the note disappears and the API shows exactly one row.
7. Docs: `CLAUDE.md` — Status (M4 done; next M5), "What exists" (Home cards, switcher as ActionMenu,
   sidebar trailing slots, PWA icons/shortcuts, theme-colour source, PendingSyncNote, the design-system
   test, the recipe phone-header guard), Layout additions (`pwa-manifest.ts`, `theme-colors.ts`,
   `nav-trailing.tsx`, `HomeWeekStrip`, `home-week.ts`, `PendingSyncNote`, `pending-sync.ts`,
   `design-system.test.ts`, `scripts/icons.ts`, `docs/plans/screenshots/m4/`), Commands (`bun run
   icons`), Gotchas (the design-system test is the gate for Table D; hand-written utilities vs `lg:`;
   `-mx-gutter` does not exist; `top-topbar` is dead; Fragment around `PendingSyncNote`; ActionMenu
   `renderTrigger`/`current`), remove "Open findings" A and B (fixed by T01), Obligations (close the
   M4 ones; carry M5–M7). `docs/SPEC.md` §2 prose: `NavItem.trailing` (sidebar-only slot, added in M4);
   §5 prose: the Home cards as built and the finance outbox note. This plan: section 9 (gate
   results, i18n classes, curl, every headless check with numbers, the screenshot index with sizes,
   four-combination values, print results, offline note) and section 10 ("what changed vs plan").

**Files.** `CLAUDE.md`, `docs/SPEC.md` (§2, §5 prose only), `docs/plans/m4-design-pass.md`,
`docs/plans/screenshots/m4/*`, and any file a failing check requires (each fix its own commit naming
the failing check).

**Deps.** M4-T01 … M4-T08.

**Acceptance.** Every exit criterion of SPEC §8 M4 with evidence in section 9: the 36 exit screenshots
exist and are non-empty; no-overflow on every captured screen; `fonts.googleapis` absent;
`design-system.test.ts` green (no `text-[` outside the pinned exceptions, no `bottom-0` bar, four
blocks equal); print and four-combination results recorded; CLAUDE.md names no file that does not
exist.

**Verify.** `cd H && bun install --frozen-lockfile`; `cd H && bun run typecheck`; `cd H && bun test`;
`cd H && bun run build`; the i18n parity check (section 3, with log `data/m4-t09-i18n.log`);
`cd H && bash -c 'for s in home switcher recipe-library recipe-plan recipe-shopping finance-overview finance-transactions finance-new settings; do for w in 390 1440; do for c in light dark; do test -s docs/plans/screenshots/m4/$s-$w-$c.png || { echo missing $s-$w-$c; exit 1; }; done; done; done'`;
`cd H && bash -c '! grep -rn "fonts.googleapis" apps/web/index.html apps/web/vite.config.ts apps/web/pwa-manifest.ts apps/web/src --exclude=design-system.test.ts'`;
`cd H && grep -q '## 9. Integration record' docs/plans/m4-design-pass.md`; `cd H && grep -q 'M4 design pass' CLAUDE.md`;
`LINKS_REC`; `LINKS_FIN`; `NOROUTER`; `NOCORE`; `NOGRAPH`.

## 5. Risks

1. **`ActionMenu` is a shared primitive** (20+ call sites). `renderTrigger` and `current` are optional
   and default to today's behaviour; typecheck is the proof that no call site changed. The chip's
   `onSelect` runs after one `requestAnimationFrame` (ActionMenu's close-first rule), which is also
   what the old chip did.
2. **Static manifest graph.** `nav-trailing.tsx`, `HomeWeekStrip.tsx` and `home-week.ts` become static
   imports of the recipe manifest; one `@/components/layout` or `@/modules` import re-enters the
   registry (TDZ). `NOGRAPH` and the manifest tests (which import the manifest first) are the checks.
   `useHouseholdRecipeCount` lives in `features/recipes/lib/queries.ts`, already reachable from
   `HomeCard`'s graph through `lib/queries`; if the manifest test shows a cycle, move the count hook's
   call into `nav-trailing.tsx` over `recipesQuery` from `modules/recipe/lib/queries` instead.
3. **Hand-written utilities vs breakpoints.** `.bleed-gutter-inset` cannot be reset at `lg`; the
   finance bars therefore bleed at every width. If T09's 1440 screenshots show that as wrong, the fix
   is a `@utility`-based variant in `index.css` (owner: the fix commit in T09), not a `lg:mx-0`.
4. **Flex chain around FinanceGate.** A wrapper element around the outlet would float the "Buchen"
   bar mid-screen on a short page; T06's source test and T09's bar measurement are the checks.
5. **AmountText on the display scale** changes every hero amount's face (Newsreader). M3 Table R
   already put `MonthSummaryCard`/`FixedCostCard` totals on the display scale; T05 aligns the
   component with them. List rows stay sans.
6. **Icon rendering.** `sharp` is a dependency of `@toon/api` and ships librsvg in its prebuilt
   binaries; if it cannot render the SVG, `scripts/icons.ts` falls back to the system `rsvg-convert`
   (present on the planner's machine) and the commit body says which was used. The PNGs are
   committed either way; CI never runs the script.
7. **Screenshot size in git.** ~80 viewport PNGs; decision 11's 25 MB rule bounds it.
8. **Headless staleness pitfalls** (persisted `["toon","me"]`, login rate limit, active household in
   `localStorage`) cost M3 three runs; T09 follows H/CLAUDE.md "Headless runs" literally.
9. **Finding A test path.** The leave route is core (`removeMember` / leave); the test must go through
   HTTP so the `onMemberRemoving` hook order is what is proven, not the service in isolation.
10. **Exact-count pinning** (T08 (c)) makes a later recipe cleanup edit the test; that is intended (the
    test is the record), and the failure message says so.

## 6. Deviations expected (to be confirmed in "what changed vs plan")

From SPEC §1: **none.** No ADR is expected; ADR 0004 gains one consequence bullet (T01), which records
a fix inside its own rules.

Plan-level choices recorded here (not deviations): decision 2 ("Gruppe" stays), decision 3 (the
recipe exceptions are pinned, not converted), decision 7 (the outbox note is module-local, not in the
shell's banner as in F), decision 9 (manifest `theme_color` is the light `--bg` instead of R's brand
`#c2532c`, so the pre-paint meta, the runtime meta and the manifest agree), decision 10 (the recipe
detail screen has no phone header row), decision 12 (no-overflow is asserted as `<=` plus element
bounds; equality is explained by the stable scrollbar gutter where it differs).

New German: one server string (`server.finance.personNotParticipant`, T01, listed in `NEW_GERMAN`)
and the manifest `description` (vite config, not a catalog). Every other string is reused.

## 7. Out of this milestone

- Renaming "Gruppe" to "Haushalt" in the UI copy and `DEFAULT_HOUSEHOLD_NAME` (owner decision + ADR).
- Converting R's pinned exceptions (34 arbitrary sizes, four uppercase labels, two `←` backLink
  values, R's `-mx-4` bars in `RecipeForm` and `ImportReviewPage`): changes drawn screens; R's
  `docs/redesign/PR.md` keeps them open.
- A per-household PWA name or icon (the manifest is static per build); a real iOS home-screen
  install check (needs a device; R/CLAUDE.md iOS note).
- A shell-wide sync badge (recipe's shopping screen has its own count; finance's note is
  module-local).
- Print styles for finance screens (neither source had them).
- `migrate:legacy` (M5); old-path redirects and Docker (M6); `docs/API.md`, `docs/modules/*.md` (M7).

## 8. Obligations

Closed by M4 (T09 confirms each in section 9): findings A and B; the recipe phone header and its
guard; the ActionMenu chip; the NotFound icon; the sidebar counts and the "Neu" pill; the Home cards'
final design; the manifest shortcuts and icons; theme-colour sync; the finance D5 audit; the outbox
indicator; print-to-PDF verification; the `scrollWidth` measurement with the gutter; dark/light
screenshots and the four-combination measurement.

Handed on unchanged: M5 (`migrate:legacy`, plan m3 decision 2 mapping, the balance invariant, the fold
backfill), M6 (old-path redirects incl. the `/plan` collision, `WITH_OCR=1 WITH_PDF=0`), M7
(`docs/API.md` incl. `onMemberRemoving`, `member_has_ledger`, `finance_participant_in_use`,
`personNotParticipant`; `docs/modules/*.md`; the temp-file test DB of ADR 0003).

## 9. Integration record

Written by M4-T09 on the merged tree (`main`), run on 2026-10-14. Logs are in `data/` (not committed):
`m4-t09-{install,typecheck,test,build,i18n,db,curl,server,headless,combos,print,offline}.log`, the PDFs
`m4-t09-print-{390,1440}.pdf` with their `pdftotext` output. The Playwright scripts lived in a scratch
directory outside the repo (Playwright 1.64, Chromium 1248, de-DE, `Europe/Berlin`, one login per user,
`storageState` reused).

### 9.1 Fixes found by the integration run (each its own commit, each with the failing check)

1. `8d01dfb` **`.bottom-tabbar` clears the tab bar's border.** Check: the Buchen bar on `/finance/new` at 390
   must sit above `nav.fixed`. Measured bar bottom 784 against nav top 783: the nav is `h-tabbar` items under a
   1px `border-t` (61px), `.bottom-tabbar` pinned bars at exactly `--tabbar-h` (60px). Now 783 against 783.
2. `3e6f668` **`PhoneHeaderRow` on Settings, Gruppen and Gruppe detail.** Check: every phone screen except the
   recipe detail shows `header[data-app-shell]`; the three core screens had none (count 0). New guard
   `core/features/phone-header.test.ts` (4 tests).
3. `ec15465` **`print.css` reveals the hidden phone panels from inside `@layer base`.** Check: print-to-PDF
   (decision 14), the last method step was absent. The shell's `[hidden]{display:none!important}` is layered and
   an unlayered `!important` loses to a layered one, so the old `.recipe-print [hidden]` override measured
   `display: none` in print media. Guard `print-css.test.ts` (3 tests). toon-recipe's `print.css` is identical
   and its `[hidden]` reset sits in the same place, so it very likely has the same latent defect (read-only source,
   not touched, not verified there).
4. `4d2cc8d` **`useMediaQuery` holds the screen value while printing.** Check: print-to-PDF at 390, still no last
   step after fix 3 (1459 characters, 2 pages): during a print the browser evaluates media queries against the
   paper width (A4, about 794 CSS px), `useIsWideViewport` flipped the phone markup to the desktop markup in the
   middle of the snapshot and the PDF was a truncated two-column hybrid (steps 3 to 7 missing). The hook keeps the
   last on-screen value while `matchMedia("print")` matches. After: 390 prints 1684 characters on 2 pages with both
   panels, 1440 prints 2211 characters on 4 pages (unchanged).

### 9.2 Gates (final tree, after the four fixes)

| Gate | Result | Log |
| --- | --- | --- |
| `bun install --frozen-lockfile` | exit 0, "Checked 436 installs across 625 packages (no changes)" | `m4-t09-install.log` |
| `bun run typecheck` | exit 0, five projects, `[typecheck] OK` | `m4-t09-typecheck.log` |
| `bun test` | exit 0, **1828 pass, 0 fail**, 9884 `expect()` calls, 105 files, 17.4 s (M3 closed at 1749 in 96 files; 1821 in 103 before T09's fixes; T09's two guard files add 4 + 3) | `m4-t09-test.log` |
| `bun run build` | exit 0 (Vite build plus the generated service worker) | `m4-t09-build.log` |
| `bun run i18n:check` | exit 1 by design; step 1/2 (catalog parity) `[i18n:check] OK`; step 2/2 reports **138** hits | `m4-t09-i18n.log` |
| `design-system.test.ts` | green inside `bun test` (no `text-[` outside the 34 pinned hits in 17 files, no `bottom-0` bar, four theme blocks equal, no `fonts.googleapis`) | `m4-t09-test.log` |
| `grep fonts.googleapis` over `index.html`, `vite.config.ts`, `pwa-manifest.ts`, `src` (the test excluded) | no hit | task verify |
| `LINKS_REC`, `LINKS_FIN` (hard-coded unprefixed module links) | no hit | task verify |

### 9.3 `i18n:check` leftover hits, all classified (138)

M3 closed at 137 hits; the one new hit is a comment quote added in M4, nothing else changed (diff of the two
hit lists by file and text, line numbers ignored: exactly one added line).

- **128 German labels or umlaut examples quoted in doc comments** (M3's 127 plus
  `modules/finance/components/PendingSyncNote.tsx`: the comment quoting "N Änderungen warten auf Übertragung").
  False positives.
- **10 lines of recipe content vocabulary** (the ingredient-paste placeholder in `IngredientsEditor.tsx`,
  `UNIT_SUGGESTIONS` in `ParsedRecipeEditor.tsx`, `STEP_HEADING_RE` in `draftEdit.ts`, the seven umlaut
  entities of `html/entities.ts`). German recipe content is content, never `t()`. False positives.
- A JSX comment quoting "Tomaten, geschält, aus der Dose" in `AddRecipeToListDialog.tsx` is counted in the 128.
- No German literal in code, no new German outside `NEW_GERMAN`.

### 9.4 Fresh database and curl (`data/m4.db`, built app on `:3001`, `IMPORT_ALLOW_PRIVATE_HOSTS=1` for the import fixture only)

`db:migrate`, `seed`, `seed` again: exit 0, the second run reports "already present" for every recipe and the
ledger (idempotent). `data/m4-t09-curl.log`:

- `GET /manifest.webmanifest`: `200`, `Content-Type: application/manifest+json; charset=utf-8`; `name` "Haushalt",
  `theme_color` and `background_color` `#faf5ee`; **three shortcuts**: Rezept importieren to `/recipe/import`,
  Neues Rezept to `/recipe/recipes/new`, Buchung erfassen to `/finance/new`; four icons
  (`icon-192.png` 3427 B, `icon-512.png` 10830 B, `maskable-192.png` 2029 B, `maskable-512.png` 6018 B): every
  URL answers `200 image/png`.
- **Finding B smoke** (kim is a household member without a seat): `PATCH …/finance/plan { payerId: kim }`,
  `POST …/finance/plan/incomes { personId: kim }` and `PATCH …/plan/incomes/:id { personId: kim }` each answer
  **`422 validation_failed`** with `details[0].path` `payerId` / `personId` and
  `i18n.key` `server.finance.personNotParticipant` ("Diese Person nimmt an der Haushaltskasse dieses Haushalts nicht
  teil."); the control `PATCH { payerId: <current payer> }` answers 200.
- Finding A is proved by `apps/api/test/finance-participants.test.ts` over HTTP (T01); the curl run does not
  re-enact a leave.

Fixture data added through the API as demo for the screenshots: three open items on "Rewe" (so the list reads
"4 Positionen"), the collection "Herbstklassiker", one card, and an import draft from a local URL fixture
(`:4599`, the `chefkoch-jsonld.html` test fixture).

### 9.5 Headless run (`data/m4-t09-headless.log`, **424 of 424 checks pass**, exit 0)

Contexts: 390x844 is a mobile context (`isMobile`, `hasTouch`: overlay scrollbars, so no gutter strip in the
screenshots), 1440x900 a desktop context, each in `colorScheme` light and dark with no stored `toon.theme`. 78
screenshots (36 exit set, 42 others) plus a desktop-Chromium 390 pass without screenshots (28 pages) that
reproduces M3's classic-scrollbar numbers.

**Every captured page** (106 pages: 39 at 390, 39 at 1440, 28 at desktop 390): rendered (no "Diese Seite gibt es
nicht" except `not-found`, where it is expected), the expected content text present where one is defined, **no
console error and no page error** (`console` type error, `pageerror`). The only tolerated line is the pre-login
`401 /api/auth/me` on `login` and `register` (the app asking whether a session exists; the log prints it as
"allowed"). The import-review fixture's external image URL (a fake CDN host in the test fixture) is answered by a
route in the script; without it that single 404 would be a console error that has nothing to do with the app.

**No horizontal overflow** (decision 12: `documentElement.scrollWidth <= clientWidth` and no element's
`getBoundingClientRect().right` above `innerWidth` + 0.5, elements inside an `overflow-x` clipper excluded; every
page prints its numbers in the log):

| Context | pages | `scrollWidth` | `clientWidth` | `innerWidth` | max element right |
| --- | --- | --- | --- | --- | --- |
| 390, mobile (overlay scrollbar) | 39 | 390 | 390 | 390 | 390 |
| 1440, desktop | 39 | 1425 | 1440 | 1440 | 1425 |
| 390, desktop (classic scrollbar) | 28 | 375 | 390 | 390 | 375 |

The difference is the `scrollbar-gutter: stable` gutter (15px), shown from the script and never in the app: on
the Home page with `documentElement.style.scrollbarGutter = "auto"` the numbers become **1440 == 1440** at 1440
and **390 == 390** at desktop 390 (before: 1425/1440 and 375/390). The mobile contexts have no gutter and read
390/390 on every page (`scrollWidth === clientWidth`, SPEC §8). No offender element on any page.

**Chrome checks** (390 mobile, light unless noted):

- Tab bar (`nav.fixed`): on `/` Start, Rezepte, Finanzen, Profil; in `/recipe` Rezepte, Plan, Einkauf, Profil; in
  `/finance` Übersicht, Buchungen, Erfassen, Profil.
- The module chip (`button[aria-label^="Modul wechseln"]` in `header[data-app-shell]`) opens a `role="dialog"`
  sheet listing Start, Rezepte, Finanzen; exactly one `aria-current` element, "Rezepte" (checked on `/recipe`);
  choosing Finanzen lands on `/finance`.
- 1440: the sidebar's segmented group (`aside[data-app-shell] [role=group]`) lists Start, Rezepte, Finanzen. Sidebar
  rows on `/recipe`: `Rezepte 3` (the recipe count), `Plan Neu` (the pill), `Einkauf 4` (open items of the
  lists), then Profil, and under Organisieren Sammlungen, Tags, Gruppen.
- Home: the recipe card has **seven day cells** (`.grid-cols-7 > a`) and reads "Rezepte DIESE WOCHE Planen MO 12
  … SO 18 Mi · Schneller Schokokuchen Mi · Zwiebelkuchen vom Blech Sa · Klassische Pfannkuchen Rewe · 4
  Positionen"; the finance card reads "Finanzen SALDO 1.288,24 € Robin schuldet dir 1.288,24 € Ausgaben · Oktober
  2026 722,35 € Finanzen Erfassen" (the balance sentence and the period spend; the figures include the one
  booking of 9.7).
- `header[data-app-shell]` (the household chip row) is visible on all 26 phone screens that have the shell, i.e.
  every screen except `recipe-detail` (count 0, exempt by decision 10) and the three that have no shell
  (`login`, `register`, `not-found`); that includes `settings`, `households`, `household-detail` after fix 2.
- **The Buchen bar** on `/finance/new` at 390: bar box left 0, right 390, top 714, bottom 783; tab bar top 783,
  bottom 844: **no overlap** (after fix 1) and the bar spans the viewport (0 to 390). In the desktop 390 context
  the bar ends at 375 beside the gutter and at 390 with `scrollbar-gutter: auto`.

### 9.6 Screenshot index (`docs/plans/screenshots/m4/<screen>-<width>-<scheme>.png`, KB)

78 viewport-only PNGs, **4.38 MB** in total (under the 25 MB limit, so nothing is stored as JPEG). The nine exit
screens exist in all four combinations (36 files, all non-empty); the other 21 screens at 390 light and 1440
dark. `switcher` is the open module sheet on `/recipe` at 390 and `/recipe` with the sidebar's segmented
switcher at 1440. `finance-non-participant` is `/finance` as kim. `recipe-import-review` exists: the draft was
created from the URL fixture as in M2's run.

| screen | 390 light | 390 dark | 1440 light | 1440 dark |
|---|---|---|---|---|
| `home` | 43 | 43 | 63 | 64 |
| `switcher` | 32 | 31 | 112 | 113 |
| `recipe-library` | 44 | 44 | 112 | 113 |
| `recipe-plan` | 36 | 36 | 57 | 57 |
| `recipe-shopping` | 51 | 51 | 91 | 92 |
| `finance-overview` | 45 | 46 | 83 | 84 |
| `finance-transactions` | 58 | 57 | 98 | 98 |
| `finance-new` | 47 | 47 | 72 | 72 |
| `settings` | 39 | 39 | 65 | 65 |
| `finance-categories` | 46 | - | - | 81 |
| `finance-non-participant` | 19 | - | - | 42 |
| `finance-plan` | 46 | - | - | 88 |
| `finance-transaction-detail` | 35 | - | - | 64 |
| `finance-transaction-edit` | 49 | - | - | 77 |
| `household-detail` | 41 | - | - | 62 |
| `households` | 25 | - | - | 46 |
| `login` | 25 | - | - | 30 |
| `not-found` | 15 | - | - | 19 |
| `recipe-cards` | 26 | - | - | 48 |
| `recipe-collection-detail` | 37 | - | - | 69 |
| `recipe-collections` | 25 | - | - | 48 |
| `recipe-detail` | 50 | - | - | 143 |
| `recipe-edit` | 39 | - | - | 60 |
| `recipe-import` | 52 | - | - | 78 |
| `recipe-import-review` | 43 | - | - | 102 |
| `recipe-new` | 36 | - | - | 56 |
| `recipe-shopping-detail` | 41 | - | - | 100 |
| `recipe-shopping-history` | 42 | - | - | 66 |
| `recipe-tags` | 49 | - | - | 87 |
| `register` | 34 | - | - | 40 |

### 9.7 Four colour combinations (decision 13, `data/m4-t09-combos.log`, **56 of 56 pass**)

390 mobile, `/` and `/finance`, OS scheme x stored `toon.theme`. Expected values are parsed from `theme.css`
(`:root[data-theme="light"]` / `"dark"` blocks, `--toon-*` references resolved); computed values come from
`getComputedStyle(documentElement)`; colours are compared as 8-bit RGBA because the built CSS is minified
(`#fff`, `#291f180d` for `rgb(41 31 24 / 5%)`).

| Token | light block | dark block |
| --- | --- | --- |
| `--bg` | `#faf5ee` | `#17120f` |
| `--surface` | `#ffffff` | `#201a15` |
| `--bg-sunken` | `#f3ebe0` | `#130f0c` |
| `--fg-faint` | `#7f6f5b` | `#8d7c67` |
| `--elevation-card` | `0 1px 2px rgb(41 31 24 / 5%), 0 4px 14px -6px rgb(41 31 24 / 12%)` | `0 1px 2px rgb(0 0 0 / 40%), 0 6px 18px -8px rgb(0 0 0 / 55%)` |

| Combination | resolved | `data-theme` | the five tokens | `body` background | `<meta name="theme-color">` |
| --- | --- | --- | --- | --- | --- |
| OS light, no preference | light | none | light block | `rgb(250, 245, 238)` = `--bg` | `#faf5ee` |
| OS dark, no preference | dark | none | dark block | `rgb(23, 18, 15)` = `--bg` | `#17120f` |
| OS light, explicit dark | dark | `dark` | dark block | `rgb(23, 18, 15)` = `--bg` | `#17120f` |
| OS dark, explicit light | light | `light` | light block | `rgb(250, 245, 238)` = `--bg` | `#faf5ee` |

Identical on `/` and `/finance`; exactly one `theme-color` meta in the page. The two explicit combinations are
the ones R's missing-token bug broke (R CLAUDE.md "THE PALETTE IS DECLARED FOUR TIMES"): all five tokens,
including `--elevation-card`, follow the stored preference.

### 9.8 Print (decision 14, `data/m4-t09-print.log`, **16 of 16 pass**, PDFs in `data/`)

`page.emulateMedia({ media: "print" })` and `page.pdf()` (A4) of the seeded "Zwiebelkuchen vom Blech", then
`pdftotext -layout`:

| Viewport | markup | pages | text | first ingredient (Mehl, Type 405) | last step ("Lauwarm servieren") | "Profil", "Start", "Modul wechseln", "Familie" |
| --- | --- | --- | --- | --- | --- | --- |
| 390 | phone, both panels | 2 | 1684 chars | present | present | absent |
| 1440 | desktop | 4 | 2211 chars | present | present | absent |

In print media the computed `display` of `nav.fixed` and `aside[data-app-shell]` is `none`, and no
`header[data-app-shell]` is rendered on the detail screen. Before fixes 3 and 4 the 390 PDF lacked steps 3 to 7
(table in 9.1). Observation, not fixed (print.css is toon-recipe's, the screen is the recipe module's): the
printed phone detail still shows the servings scaler and "Zur Einkaufsliste", which carry no `data-print="hide"`.

### 9.9 Offline note on the built app (decision 7, `data/m4-t09-offline.log`, **8 of 8 pass**)

Service worker active and controlling the page (after one reload). Online: no note. `setOffline(true)`, 7,77 and
"M4 Offline-Buchung …" on `/finance/new`, Buchen: **"1 Änderung wartet auf Übertragung."** is visible in a
`role="status"` line; `setOffline(false)`: the note is gone and the API holds **exactly one row** with that
description, still one row after settling; no page error. (M3's two-reloads-offline replay is unchanged and was
not repeated; this run is the indicator.)

### 9.10 Exit criteria (SPEC §8 M4, this plan's section 1) against the evidence

- Home cards with real data, the switcher, the module-less tab bar: 9.5 (seven day cells, active list count,
  balance sentence, period spend, tab bars of Home / recipe / finance, the sheet and the sidebar group).
- Finance screens token by token against D5: `design-system.test.ts` green (9.2); the finance screens are in the
  screenshot set; no `text-[` outside the 34 pinned recipe hits, the four theme blocks equal, `.eyebrow`, sticky
  bars on `bottom-tabbar` (9.1 fix 1 closed the last 1px).
- print.css verified by printing: 9.8. PWA manifest and icons: 9.4 (content type, three shortcuts, four icons).
- Dark and light in all four combinations: 9.6 (screenshots) and 9.7 (measurement).
- Screenshots at 390 and 1440 in `docs/plans/screenshots/m4/`: 9.6. `scrollWidth === clientWidth` on every screen:
  9.5 (390/390 on all 39 mobile pages; 1425/1440 explained by the gutter and equal with it switched off).
- No `fonts.googleapis`: 9.2.

## 10. What changed vs plan

- **No deviation from SPEC §1, no ADR.** ADR 0004 gained one consequence bullet (T01), as planned.
- **T09 found four defects the plan did not foresee** (9.1): the 1px tab-bar border under the pinned bars, the
  missing phone header row on three core screens, and two print defects (the layered `!important` and the
  mid-print markup flip). The plan expected print to be a verification only ("verified by printing, no
  defect expected"); it was the only check that failed for a reason outside M4's own diff (both causes are
  inherited from toon-recipe).
- **The plan's chrome check "every phone screen except `recipe-detail` shows the household chip" needed a code
  change for Settings, Gruppen and Gruppe detail** (M4-T08's "core screens audit" did not add the row);
  `core/features/phone-header.test.ts` now guards them (decision 10 had only covered recipe).
- **390 screenshots use a mobile context**, not a desktop viewport of 390 px: a desktop Chromium reserves the
  stable scrollbar gutter and draws a 15px strip at the right edge, which would be a misleading phone
  screenshot. Decision 12 is still satisfied both ways (9.5: mobile 390/390, desktop 375/390 explained).
- **Decision 3's count**: T08's commit records that its "18 files" was a miscount (the plan's own list sums to
  17 files and 34 hits) and pinned 17. Decisions 6 and 9: unchanged. Decision 7: `PendingSyncNote` as a Fragment sibling
  (T06), confirmed on the built app (9.9). Risk 3 (finance bars bleeding at every width): confirmed, the
  1440 screenshots show it as intended, no `@utility` variant was needed. Risk 6: `sharp` rendered the SVG itself
  (`rsvg-convert` was not needed). Risk 8 (headless staleness): followed H/CLAUDE.md literally; the only new
  lesson is that a login-per-run script gets `429` (storageState is now reused across runs) and that
  `pkill -f` can match its own shell.
- **Plan-level additions to the exit evidence**: the 28-page desktop-390 pass (the M3 numbers reproduced), the
  gutter demonstration at both widths, the `data-theme` and meta checks in the four-combination table.
- **New files beyond the plan's list**: `core/features/phone-header.test.ts`,
  `modules/recipe/features/recipes/print-css.test.ts`.
- **Handed on** (CLAUDE.md "Obligations"): M5 `migrate:legacy`, M6 redirects and Docker, M7 docs; the owner
  decisions of section 7 stay open; the printed phone detail's scaler and shopping link (9.8).
- **Gate numbers after the review fix**: section 9.2 records the tree before it; the final tree has 1832
  pass in 106 files (the fix added `AmountInput.test.ts` cases, 1828 before). One full `bun test` run under
  load reported 1 fail that did not reproduce on two reruns (1832 pass, 0 fail); no test was changed for it.
- **Review fix (medium): the euro sign overlapped the amount in `AmountInput`.** The input was `px-4` and the
  glyph an `absolute inset-y-0 right-4 my-auto` span, so it sat in the same right-hand 1rem as the right-aligned
  digits and, with no height of its own, stuck to the top. The input now reserves `pr-12` and the glyph is
  centred with `flex items-center`. `AmountInput.test.ts` reads the source (reserved gutter at least offset plus
  glyph width, no `my-auto`, no symmetric `px-*`). A headless run on the built app measured the real boxes at
  390 and 1440, light and dark, empty and typed ("1.234,56"): glyph left 342 vs content right 325 (390) and 1361
  vs 1344 (1440), glyph centre within 1px of the input centre, no console error. The four `finance-new` and the
  two `finance-transaction-edit` screenshots were retaken.
