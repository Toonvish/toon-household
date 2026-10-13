# Redesign — implementation plan

**Inputs.** `docs/redesign/SPEC.md` (the contract; D1–D7 are settled), `CLAUDE.md` (locked
decisions + gotchas), `docs/redesign/design.dc.html` (the artboards), and the six area specs
under `docs/redesign/specs/`. This file **reconciles** those six: where two of them disagree,
§4 rules once and every task references the ruling.

**How to use it.** Find your task id in §2. Implement exactly the files it names. If you need a
file another task owns (§3), stop and say so in the PR rather than editing it. If your task
contradicts an area spec, this file wins — the area specs were written independently and did not
see each other.

**Branch + commits (D1).** Everything lands on `redesign`, one commit per PHASE, reviewed as a
single diff at the end. `main` stays clean.

**Four rules that bind every task.**

1. **`bun run db:generate` is run by exactly one agent, once, in phase 3.** drizzle-kit writes
   `drizzle/meta/_journal.json` as a sequential list plus one snapshot per migration; two agents
   generating produce two `0006_*` files and a journal that cannot be applied.
2. **`apps/web/src/lib/persist.ts` is touched by exactly one task (T5.2), which sets
   `PERSIST_BUSTER = "v3"` once.** Three areas each had a reason to bump it; three bumps churn
   the value and invalidate every device on every intermediate build.
3. **No new dependency.** Fonts are files under `apps/web/public/fonts/`; Playwright is installed
   in a scratch dir outside the repo. `bun install` must report no changes.
4. **Every screen task ships its STATES, not just its populated look.** The artboards draw one
   state per screen — populated, online, permitted, dark — so a task that transcribes only that
   produces a branch that looks right in a screenshot and wrong on a real install. Empty, loading,
   error, offline and read-only are named per screen in R44 and are part of "done when", not a
   follow-up. Two of the new components (`RecentlyCookedShelf`, `WeekStrip`) are **empty on day one
   for every existing install**, because R41 deliberately ships no `tags.kind` and no
   `last_cooked_at` backfill.

---

## 1 — Ordered phases

| # | Phase | Depends on | Parallel with | Why here |
| --- | --- | --- | --- | --- |
| 1 | **Foundation**: fonts, tokens, type scale, `components/ui` | — | 2 | Every other phase renders through these shapes. A screen built against `font-display font-semibold` / `shadow-card` / `rounded-xl` and retro-fitted later is a second full pass. |
| 2 | **Shared package**: pure logic, Zod wire schemas, `ERROR_CODES`, server catalogs | — | 1 | `apps/api/src/db/schema.ts` imports `TagKind` from `@toon/shared`, and every API handler validates against these schemas. Pure and dependency-free, so it does not need phase 1. |
| 3 | **DB schema + migrations + seed** | 2 | — | `schema.ts` needs `TagKind`; the migrations need the drizzle tables. **Strictly serial, one agent** (rule 1). |
| 4 | **API services, routes, API tests** | 3 | 5, 6 | Handlers need the tables. |
| 5 | **Web platform seams**: `lib/api.ts`, `lib/queries.ts`, `lib/persist.ts`, `router.tsx`, `vite.config.ts`, shopping `offline.ts` | 2 | 4, 6 | Needs only the wire TYPES, not a running server, so it does not wait on phase 4. Screens need real query keys and fetchers to bind to. |
| 6 | **i18n copy**: the four web catalog pairs + the `plan` namespace + the registry | 2 | 4, 5 | Deliberate departure from "catalogs after screens": `en` is typed `LocaleCatalog<typeof de>`, so a key added in one file and not the other is a **compile** error. Landing all the copy first means every screen task is read-only against the catalogs and no two screen agents edit the same catalog file. Unused keys break nothing. |
| 7 | **Shell + nav + `/plan`** | 1, 5, 6 | — | `AppShell`'s width change is what makes the desktop artboards expressible (§4 ruling R1), and every phase-8 screen renders inside it. `PhoneHeaderRow` must exist before the library header consumes it. **T7.5 (`RecipeEditorialRow` + `CourseEyebrow`) is here, not in phase 8**, because `/plan`'s recipe picker consumes it — see §1 "what must be sequential". |
| 8 | **The designed screens** (library ×2, detail ×2, shopping overview, shopping list) **+ `/shopping/history`** | 1, 5, 6, 7 | — | The whole point; consumes everything above. `/shopping/history` (T8.8) is here rather than in 9 because it is a shopping screen consuming T4.3's endpoint and T8.5's link, not a D6 extrapolation of an existing screen. |
| 9 | **The undesigned screens (D6)** + `UploadProgress` | 1, 7 | — | After 8 so the designed screens are the reference the extrapolation copies, and because `RecipeForm`/`RecipeFilters`-adjacent files settle in 8. |
| 10 | **Docs + dead-code cleanup + the `CLAUDE.md` rewrite (D3)** | 1–9 | — | The `CLAUDE.md` edits describe what actually shipped; writing them earlier means writing them twice. |
| 11 | **Verification** | 10 | — | Five gates + the headless runbook, in the order in §6. |

**Departures from the suggested order, and why.**

- **i18n is phase 6, before the screens, not after.** The typing is the enforcement: `de` + `en`
  must move together or `tsc` fails, so copy cannot trail the screens. Putting it in one phase
  also gives each catalog file a single owner, which is the only way five screen agents can run
  in parallel without colliding in `recipes.de.ts`.
- **Phases 1 and 2 run in parallel**; 4, 5 and 6 run in parallel. Everything else is sequential.
- **Server-side catalog keys (`server.plan.*`) are in phase 2, not 6**, because they live in
  `packages/shared/src/i18n/catalogs/` next to the schemas that reference them via `refineKey()`.

**The gates are green at phase 11, not at every phase — and that is deliberate.**
`CLAUDE.md` says all five gates must be clean before calling anything **done**, and phase 11 is
where "done" is. Three of the phase boundaries are red by construction and must not be "fixed" by
reordering: `TagSchema.kind` becomes **required** in T2.2 while the mapper that supplies it lands in
T4.2; `ShoppingListDetailResponseSchema.bought`/`recipes` become required in T2.4 before T4.3
supplies them; and every new `de` key is a compile error in its `en` twin until both halves of a
T6.x edit exist. Each phase commit must still **build the files it owns** and must not leave a
DANGLING IMPORT or a route pointing at a missing module — that class of breakage is a planning
error, not a type-system one, and §6's "failure to EXPECT" list now names the difference.

**What must be sequential, restated bluntly.**

- Phase 3 is one agent. No exceptions (rule 1).
- Within phase 2, tasks T2.1 → T2.2 → T2.3 are sequential because each appends one line to
  `packages/shared/src/index.ts`. T2.4 and T2.5 are parallel with them.
- T5.2 lands **last in phase 5** (it is the `PERSIST_BUSTER` commit and it needs the query keys
  T5.1 adds).
- T7.1 (nav items + `GroupSwitcher`) lands **before** T7.2 (shell frame), which reads `NAV_ITEMS`.
- **T7.5 (`RecipeEditorialRow` + `CourseEyebrow`) lands before T7.4 (`/plan`)**, whose
  `PlanRecipePicker` reuses the row, and before T8.1/T8.2/T8.3/T9.2, which all consume it. It sits
  in phase 7 rather than phase 8 because phase 8 depends on phase 7 and a phase-7 task may not
  import a phase-8 file. T8.1 then **consumes** the row, deletes `RecipeCard`/`RecipeRow`, and owns
  `features/recipes/index.ts`.
- **T6.1 ADDS the `ui` keys; T7.2 DELETES the three that lose their call site** (R29). Deleting
  them in phase 6 breaks the build in phase 6, because `TopBar.tsx` — their only consumer — is
  deleted in T7.2. The two halves are one decision split across two commits; both task entries say
  so.
- **`features/recipes/index.ts` is edited twice, sequenced**: T8.1 drops the `RecipeCard` /
  `RecipeRow` exports and adds `RecipeEditorialRow` / `CourseEyebrow` / `RecipeStatRow`; T8.2 drops
  the `RecipeFilters` export and re-adds `countActiveFilters` from `RecipeFilterRail`. Same shape
  as the `Skeleton.tsx` hand-off, one phase apart instead of eight.

### 1.1 — i18n: `i18n-keys.md` is the key contract, and the catalogs land first

**`docs/redesign/i18n-keys.md` is the authoritative inventory** of every catalog key the redesign
adds, changes or deletes, with **both** locale values, per namespace and per file. Where its tables
and this file's task prose disagree, **`i18n-keys.md` wins on keys, values and namespaces** and its
§14 records why (it overrules T6.2's hand-written relative-time keys in favour of
`Intl.RelativeTimeFormat`, moves the `WeekStrip` copy from `recipes` to `plan`, drops
`plan.weekNumber`, and keeps three existing `shopping` keys that looked deletable). This file
remains authoritative on **who edits which file and when**.

**Why the catalogs must land before the screens, restated as a hard ordering rule.** `t()`'s key
type is `keyof C & string`. A component that references a key which does not exist yet is a
**compile error**, not a blank string — so no phase 7/8/9 screen task can be started before its
namespace's phase-6 task has landed. That is the whole reason i18n is phase 6 rather than a
follow-up, and it is also why a **deletion** is safe to prescribe: if `tsc` complains about a
deleted key, the deletion was wrong and the key goes back, rather than the component being edited.

Three consequences a screen agent must know:

1. **Read `i18n-keys.md` instead of inventing a key.** Every key a phase 7–9 task needs is already
   in it, with its German and English value and its placeholder set.
2. **The `plan` namespace is new** and needs `apps/web/src/lib/i18n/catalogs/index.ts` (marked
   FINAL) **and** `apps/web/src/lib/i18n/i18n.test.ts` edited in the same commit as the two new
   catalog files — the test hard-codes the namespace prefix list and fails on the first `plan.*`
   key. Both are T6.1's, and the registry edit is flagged in the PR.
3. **`i18n-keys.md` §3 is the list of strings that get NO key** because `Intl` renders them, and
   §4 is the list of German strings that stay German for every viewer. Adding a key for either is
   the damaging edit `CLAUDE.md` warns about, in the two directions it warns about it.

---
## 2 — Tasks

**51 tasks in 11 phases.** Phase 1 has nine, phase 2 five, phase 3 two, phase 4 four, phase 5
three, phase 6 three, phase 7 five, phase 8 eight, phase 9 seven, phase 10 three, phase 11 two.
**Phases 1 and 2 run in parallel; 4, 5 and 6 run in parallel; everything else is sequential.**
Inside a phase, tasks are parallel except where a `Depends on` line or §1's sequential list says
otherwise — the binding ones are phase 3 (one agent, no exceptions), `packages/shared/src/index.ts`
(T2.1 → T2.2 → T2.3, append-only), T5.2 last in phase 5, T7.1 before T7.2, T7.5 before T7.4, and
T8.1 before T8.2/T8.3/T8.5.

Every task lists: **creates / modifies** (the exact file set — nothing else), **done when**,
**tests**, **gotchas** (named from `CLAUDE.md`), and — for a screen — its **states** (R44). A task
that finds it needs a file it does not own stops and says so in the PR.

Shorthand: `SPEC §n` = `docs/redesign/SPEC.md`; `A01 §n` = `docs/redesign/specs/01-design-system.md`
(likewise A02…A06); `R<n>` = a ruling in §4 of this file.

### Phase 1 — Foundation

#### T1.1 — Self-hosted fonts

- **Creates:** `apps/web/public/fonts/figtree-latin.woff2`,
  `apps/web/public/fonts/figtree-latin-ext.woff2`,
  `apps/web/public/fonts/newsreader-500-latin.woff2`,
  `apps/web/public/fonts/newsreader-500-latin-ext.woff2`,
  `apps/web/public/fonts/LICENSE-figtree.txt`, `apps/web/public/fonts/LICENSE-newsreader.txt`,
  `apps/web/src/styles/fonts.css`
- **Modifies:** `apps/web/index.html` (two `<link rel="preload">` lines only)
- **Done when:** the four woff2 exist with the subsets and axis pinning in A01 §1.3
  (`fonttools varLib.instancer` then `pyftsubset --flavor=woff2 --layout-features='*'`; Figtree
  variable `wght 400..700`, Newsreader a **static** `wght=500 opsz=18` instance); `fonts.css`
  declares four `@font-face` blocks verbatim from A01 §1.5 with `font-display: swap`, both
  families declared `font-weight: 400 700`, and Google's full `unicode-range` strings; the two
  **latin** files are preloaded in `index.html` after `<link rel="mask-icon">` and **before** the
  inline theme script, each with `crossorigin`.
- **Tests:** none (asset task). Report `fonttools ttx -t GSUB -o - figtree-latin.woff2 | grep -c tnum`
  in the PR — if `tnum` is absent, say so and fall back to fixed `ch` widths on qty columns
  (A01 §2.6). Report the four file sizes.
- **Also record, in the PR, that the single-origin Docker path already serves these files** and
  why no `middleware/staticWeb.ts` edit is needed: `".woff2": "font/woff2"` is already in its
  `CONTENT_TYPES` map (verified) and `NEVER_CACHE` does not cover `/fonts/*`. Two facts follow and
  must be stated rather than discovered later: `/fonts/*` falls to the default
  `public, max-age=86400` (only `/assets/` is `immutable`), and the four filenames are **unhashed**,
  so **replacing a font file without renaming it leaves devices up to a day behind**. If a font is
  ever re-subset, rename it. T11.1 asserts the served content type.
- **Gotchas:** *"`apple-mobile-web-app-status-bar-style: black-translucent` is banned from
  `index.html`"* — do not touch anything else in that file. **No `fonts.googleapis.com` link**
  (SPEC §2: an offline 404 reflows the shopping list at a till). Files go in `public/fonts/`, never
  imported from `src/` — an import emits `dist/assets/<name>-<hash>.woff2`, the glob still matches,
  the build stays green and the preload 404s with no error from any gate (A06 §8.4).

#### T1.2 — `theme.css`: four blocks, one list

- **Modifies:** `apps/web/src/styles/theme.css` (sole owner)
- **Done when:**
  1. `--toon-accent-700: #9a6710` added to the ramp in `:root`.
  2. Four new semantic tokens defined **in all four blocks**: `--bg-sunken`, `--fg-body`,
     `--fg-faint`, `--accent-strong`. Values per A01 §3.3/§3.4 — dark `#130f0c` / `#e8dccd` /
     `#8d7c67` / `var(--toon-accent-400)`; light `var(--toon-sand-100)` / `var(--toon-sand-700)` /
     `#7f6f5b` / `var(--toon-accent-700)`. `--fg-faint` is **`#8d7c67`, not the artboard's
     `#6b5c4b`** — see R11 and open item O1.
  3. Light `--success` corrected to `var(--toon-herb-600)` in `:root` **and**
     `:root[data-theme="light"]` (the design uses it as 11px text).
  4. **The pre-existing bug fixed:** `:root[data-theme="light"]` gains the 14 tokens it omits
     (`--accent`, `--accent-soft`, `--accent-soft-fg`, `--danger-hover`, `--success`,
     `--success-soft`, `--success-soft-fg`, `--warning`, `--warning-soft`, `--warning-soft-fg`,
     `--ring`, `--elevation-soft`, `--elevation-card`, `--elevation-pop`) and
     `:root[data-theme="dark"]` gains the three `--elevation-*`. After the edit all four blocks
     define the same 39 semantic tokens. **This is a user-visible change on ~15 unrelated screens**
     for anyone running an explicit `data-theme` against the opposite OS setting — it is a bug fix,
     not a redesign, and T10.1 names it in the known-gaps section so it is not read as a regression.
  5. The "FOUR BLOCKS, ONE LIST" header comment from A01 §3.6 is added verbatim.
- **Tests:** none automated. In the PR paste the output of a script that parses the four blocks and
  asserts identical key sets (A01 §8.5).
- **Gotchas:** the two `[data-theme]` blocks are `(0,2,0)` and beat both `:root` rules **only for
  tokens they name** — the media query's value stands for anything omitted, which is why
  "dark on a light laptop" had no card shadows and would silently kill the two `shadow-pop` phone
  bars the redesign adds. Do not delete a block to "simplify".

#### T1.3 — `index.css`: Tailwind theme layer, type scale, new utilities

- **Modifies:** `apps/web/src/styles/index.css` (sole owner)
- **Depends on:** T1.1 (`fonts.css` must exist), T1.2 (tokens must exist)
- **Done when:**
  1. `@import "./fonts.css";` sits between `@import "tailwindcss";` and `@import "./theme.css";`.
  2. `--font-sans` gains `Figtree,` and `--font-display` gains `Newsreader,` at the head of the
     existing stacks. **Nothing is removed** from either fallback stack.
  3. `@theme inline` gains: `--color-bg-sunken`, `--color-fg-body`, `--color-fg-faint`,
     `--color-accent-strong`; `--text-control: 0.84375rem` + its line-height; `--text-item:
     0.9375rem` + line-height; the eight `--text-display-*` steps with their line-heights and the
     two `letter-spacing`s (A01 §2.4); `--radius-control: 0.625rem`; `--spacing-sidebar: 14.75rem`;
     `--container-content: 75.25rem`.
  4. `@layer utilities` gains `.eyebrow` (A01 §2.3, five declarations, **no colour**) and
     `.bleed-gutter` / `.bleed-gutter-inset` (A04 §1.1, both using the same
     `max(var(--gutter,1rem), env(safe-area-inset-*))` expression `.px-gutter` uses).
  5. `@layer base` gains `p { text-wrap: pretty; }` next to the existing `h1,h2,h3` balance rule.
  6. **`--radius-panel` is NOT added** and `input,select,textarea,button { font-size: max(1rem,16px) }`
     is **untouched** (R13, R12).
- **Tests:** none. `bun run build` must succeed and `grep -c woff2 apps/web/dist/sw.js` → 4 after T5.2.
- **Gotchas:** *"NEVER write `px-4 px-safe`"* — the new bleed utilities are never paired with a
  `px-*`. `.eyebrow` is deliberately **not** `.text-eyebrow`: hand-written utilities in this file
  are emitted after Tailwind's, so a `text-*`-shaped name would silently override a real size
  utility on the same element. Keep `.px-safe` and `.px-gutter` exactly as they are.

#### T1.4 — `components/ui`: Button, IconButton, Card, Avatar, Tabs, Skeleton

- **Modifies:** `apps/web/src/components/ui/Button.tsx`, `IconButton.tsx`, `Card.tsx`,
  `Avatar.tsx`, `Tabs.tsx`, `Skeleton.tsx` (sole owner of all six)
- **Done when:** each matches A01 §4.2 exactly, plus these rulings:
  - `Button`: `rounded-xl` → `rounded-control`; filled variants `font-bold`, quiet ones
    `font-semibold`; `sizes.sm`/`md` gain `text-control`, `lg` gains `text-sm`; `shadow-soft`
    dropped from `primary`/`danger`/`accent`; **new variants `success` and `dashed`**; sizes stay
    36/44/52. No existing variant or size value is removed.
  - `IconButton`: `rounded-control`; new `shape?: "square" | "circle"`; new `variant="scrim"`
    (`bg-bg/70 … backdrop-blur-sm`). Sizes stay 36/44/52 — **no 40px entry** (R14).
  - `Card`: `shadow-card` dropped from the base; new `shadow?: "none" | "card" | "pop"` default
    `"none"`; `interactive` hover becomes `hover:border-line-strong` only; `CardHeader` title →
    `font-display text-display-md font-medium`, description → `text-xs text-fg-muted`.
    **No `radius` prop and no `--radius-panel`** (R13).
  - `Avatar`: new `shape?: "circle" | "square"` (default circle, square → `rounded-lg`) and
    `tone?: "brand" | "accent"` (default brand); `sizes` gains `2xs` (22px) and `xs` (28px);
    `sm`/`md`/`lg` keep today's values so no caller changes.
  - `Tabs`: the `segmented` variant is restyled to the artboard (container
    `rounded-xl border border-line bg-surface p-1`, active `rounded-control bg-brand-soft
    text-brand-soft-fg`, inactive `rounded-control text-fg-subtle hover:text-fg`, label
    `text-control font-semibold`, `min-h-11`), and `badge` renders inline as `· N`.
    **No `tone` prop** (R15) — `GroupDetailPage`'s members tabs change appearance deliberately.
    Keep the arrow-key handling.
  - `Skeleton`: `SkeletonList.variant` gains **`"editorial"`** (84px square + 3 bars, borderless,
    matching the artboard's `84px 1fr`), **`"tiles"`** (2-up) and **`"daycards"`** (a row of
    equal-width day cards — 7 at `lg`, 4 below, matching `WeekStrip`'s own branch, so the strip does
    not pop in after the rows around it have landed). `"cards"` and `"rows"` are kept
    and marked `@deprecated` in the doc comment with a pointer to T10.2, which deletes them
    (R16) — deleting them here would break `RecipeListPage` before phase 8.
- **Tests:** none new (no test files exist for `components/ui`). `bun run typecheck` is the gate.
- **Gotchas:** *"A header gets ONE overflow trigger"* — `ActionMenu` is untouched, including its
  close-then-`requestAnimationFrame` behaviour. *`SkeletonList.variant` must match the branch* —
  that match is T8.1's job, not this task's. A restyled primitive must keep every existing
  `variant`/`size`/`padding` VALUE compiling: D6 restyles ~15 screens in parallel and a removed
  variant is a merge conflict in five branches at once.

#### T1.5 — `components/ui`: form controls

- **Modifies:** `apps/web/src/components/ui/Input.tsx`, `Select.tsx`, `Textarea.tsx`,
  `Label.tsx`, `Field.tsx`, `Switch.tsx` (sole owner of all six)
- **Done when:** `controlClasses` drops `shadow-soft`, keeps `rounded-xl`, **keeps `min-w-0` and
  its comment**; `Input` gains `size?: "md" | "lg"` (`md` = `min-h-11` default, `lg` = `min-h-13`)
  with `rightSlot` padding following the size (`pr-11` / `pr-14`); `Select` mirrors the `size`
  prop and stays a native `<select>`; `Label` → `text-control`; `FieldShell`'s hint and error
  → `text-xs`; `Switch` label → `text-control`, description → `text-xs`. **Font size stays
  `text-base` on every focusable text control** (R12).
- **Tests:** none new.
- **Gotchas:** *`controlClasses` carries `min-w-0`, and removing it breaks phone layouts* — a
  control's intrinsic width is ~20 characters and `w-full` alone does not let a grid/flex item
  shrink. **Do not touch `Field.tsx`'s aria wiring** (`useControlAria`, the `${id}-error` /
  `${id}-hint` suffixes, `role="alert"`) — its own comment says why four copies of that frame is
  the bug it exists to prevent. The iOS 16px zoom floor in `@layer base` is load-bearing.

#### T1.6 — `components/ui`: overlay + state components

- **Modifies:** `apps/web/src/components/ui/Dialog.tsx`, `EmptyState.tsx`, `ErrorState.tsx`
  (sole owner)
- **Done when:** each title/heading becomes `font-display text-display-md font-medium`;
  `EmptyState` keeps its `border-dashed border-line-strong` frame but goes `bg-transparent`;
  `ErrorState`'s inline banner keeps `rounded-xl`. `--radius-sheet` stays 20px.
- **Tests:** none new.
- **Gotchas:** Escape handling, the focus trap, the scroll lock and the `openDialogs` counter in
  `Dialog.tsx` are load-bearing — restyle only.

#### T1.7 — The five new primitives

- **Creates:** `apps/web/src/components/ui/ProgressBar.tsx`, `SectionHeader.tsx`, `Stat.tsx`
  (exports `Stat` + `StatRow`), `Chip.tsx`, `Stepper.tsx`
- **Modifies:** `apps/web/src/components/ui/index.ts` (sole owner)
- **Done when:** each matches its prop table in A01 §4.3, and:
  - **`SectionHeader` lives in `components/ui/`, not in `features/shopping/`** (R7).
  - **`ProgressBar` lives in `components/ui/`; there is no `ShoppingProgressBar`** (R7).
    Percentage arithmetic is `shoppingProgressPercent` from `@toon/shared` (T2.5) — this component
    only paints a number.
  - **`Chip` has NO `onDismiss` and no `×`** (SPEC §4.6 — removing the per-chip `×` is the design's
    stated fix). Its 36px `min-h-9` is below the 44px floor and its header comment says why that is
    acceptable here and must not be "fixed" to `min-h-11`.
  - `StatRow` with `columns={4}` renders `grid grid-cols-[repeat(4,minmax(0,1fr))]` —
    **never a bare `1fr`** — and every `Stat` root carries `min-w-0`.
  - `Stepper` renders the rectangular `− value +` frame with `size?: "sm" | "md"` (36/40px) and an
    `<output aria-live="polite">`; the `useId` comment about two scalers on screen at once moves
    here from `ServingsScaler`.
  - **Every one takes ready-to-render strings and calls no `t()`.** This task adds **zero** keys to
    `ui.de.ts` / `ui.en.ts`; accessible names are required props supplied by the calling screen.
  - `index.ts` exports all five plus their prop types, and its conventions comment gains: type comes
    from `text-control` / `text-item` / `text-display-*` / `.eyebrow`, never `text-[13px]`.
- **Tests:** none new.
- **Gotchas:** no arrow / chevron / check / ellipsis is ever a text character — `→` U+2192,
  `←` U+2190, `✓` U+2713, `▾` U+25BE all fall outside both font subsets and would render from the
  fallback family or as tofu. Use `lucide-react` `ArrowRight`/`ArrowLeft`/`Check`/`ChevronDown`
  (A01 §1.4). No component may reference a raw `--toon-*` ramp variable.

#### T1.8 — Adopt `Stepper` and `ProgressBar` in the two files that duplicated them

- **Modifies:** `apps/web/src/features/recipes/components/ServingsScaler.tsx`,
  `apps/web/src/features/import/components/UploadProgress.tsx`
- **Depends on:** T1.7
- **Done when:** `ServingsScaler` keeps **all** of its own semantics (the halves-below-4 `step()`,
  the `clamp()`, `formatQuantity`, the noun resolution, the reset-to-base button, its
  `recipes.scaler.*` keys) and delegates only the frame to `Stepper`, passing `size` through;
  `UploadProgress` composes `ProgressBar` and keeps its own `indeterminate` handling and file row.
- **Tests:** none new.
- **Gotchas:** `features/import/lib/shell.tsx` is a **typing seam** and must not gain an
  implementation — `UploadProgress` imports from `@/components/ui` directly, like the rest of
  `features/import/components/`. `packages/shared`'s `scaleIngredients` stays the single source of
  the scaling arithmetic.

#### T1.9 — `components/ui`: the five primitives nothing else claimed

- **Modifies:** `apps/web/src/components/ui/Badge.tsx`, `ConfirmDialog.tsx`, `ActionMenu.tsx`,
  `Toast.tsx`, `Spinner.tsx` (sole owner of all five)
- **Depends on:** T1.3 (`text-control`, `.eyebrow`, `--radius-control`)
- **Why it exists:** phase 1 claims `components/ui`, and T1.4–T1.7 cover 16 of the directory's 21
  files. These five were unclaimed, and every one of them is on a redesigned screen: `Badge` is the
  sidebar's honey "New" pill (T7.2) **and** every tag chip; `ActionMenu` is the sheet behind **six**
  new call sites (T7.4's day cards, T8.4's `⋯`, T8.6's chip hide, T8.7's `+`, T8.5's list-card menu,
  T9.3's member rows); `ConfirmDialog` renders R31's and R10's new confirm copy; `Toast` carries the
  new undo actions; `Spinner` sits in every new loading state. D6 means none of them may keep the
  old look.
- **Done when:**
  - `Badge`: `sizes.sm`'s **`text-[0.7rem]` is replaced** — it is a raw arbitrary size and T10.2's
    own grep gate (`text-\[[0-9.]+(px|rem)\]` → only the deliberate avatar-initial sizes) fails on
    it. Use `text-[length:var(--text-control)]`-free wording: `sm` becomes `px-2 py-0.5 text-xs`
    and `md` becomes `px-2.5 py-1 text-control`. Both keep `rounded-full`. Every existing
    `variant` value still compiles.
  - `ConfirmDialog`: title → `font-display text-display-md font-medium`, body → `text-sm
    text-fg-muted`; **the non-destructive path must stay non-destructive** — `Gekauftes leeren`
    (R31) passes no `danger` tone and must not be styled red by a default.
  - `ActionMenu`: item labels → `text-control`, any uppercase group label → `.eyebrow`, panel
    radius `--radius-sheet` on a phone (sheet) and `rounded-card` from `sm` (centred panel).
    **Its close-before-act + one-`requestAnimationFrame` defer is load-bearing and untouched** — it
    is a portal outside `.recipe-print`, so `window.print()` fired from the same handler prints the
    open menu over the recipe.
  - `Toast`: keeps `pt-safe` (it resolves to 0 in portrait standalone), gains an optional
    **action slot** so T8.4's cooked-undo and T8.6's bought-undo can offer one tap rather than a
    second dialog; the action is a `Button variant="quiet" size="sm"` and takes a ready-to-render
    label, no `t()` of its own.
  - `Spinner`: tokenised only; its `ui.spinner.*` label keys are unchanged.
- **Tests:** none new. `bun run typecheck` is the gate.
- **Gotchas:** *a restyled primitive must keep every existing `variant`/`size`/`tone` VALUE
  compiling* — D6 restyles ~15 screens in parallel and a removed variant is a merge conflict in five
  branches at once. *Escape handling, the focus trap, the scroll lock and the `openDialogs` counter
  live in `Dialog.tsx` (T1.6) and are reached through it* — `ActionMenu` and `ConfirmDialog` must
  keep composing `Dialog` and must never grow a second overlay implementation.

### Phase 2 — Shared package

#### T2.1 — `calendar.ts`: the one date module

- **Creates:** `packages/shared/src/calendar.ts`, `packages/shared/test/calendar.test.ts`
- **Modifies:** `packages/shared/src/index.ts` (append one `export * from "./calendar.ts";`)
- **Done when:** the file exports **one** merged API (R2) — there is no `plan.ts`:
  ```ts
  export type PlanDate = string;                       // "YYYY-MM-DD"
  export function isPlanDate(value: string): boolean;
  export function toPlanDate(date?: Date): PlanDate;   // LOCAL calendar; clients only
  export function todayPlanDate(): PlanDate;
  export function planDateToDate(value: PlanDate): Date;        // UTC noon, for Intl only
  export function addPlanDays(value: PlanDate, delta: number): PlanDate;
  export function planDaysBetween(a: PlanDate, b: PlanDate): number;
  export function startOfPlanWeek(value: PlanDate): PlanDate;   // Monday, hardcoded
  export function planWeek(value: PlanDate): PlanDate[];        // exactly 7, Mon..Sun
  export function shiftPlanWeek(weekStart: PlanDate, weeks: number): PlanDate;
  export function planWeekRange(date?: Date): { from: PlanDate; to: PlanDate };
  export function startOfLocalDay(at: Date | number): number;   // unix ms, device local
  export function groupByLocalDay<T>(rows: readonly T[], at: (row: T) => string):
    Array<{ dayKey: PlanDate; rows: T[] }>;
  ```
  Names dropped on purpose: `localDayKey` (= `toPlanDate`), `localWeekRange` (= `planWeekRange`),
  `isoDateToday` (= `todayPlanDate`), `startOfIsoWeek` (= `startOfPlanWeek`), `isoWeekDays`
  (= `planWeek`), `weekStart`/`weekDays`/`planDateKey`. `isoWeekNumber` is **not** implemented —
  nothing needs a week number; the week label is `formatDate` of the two bounds (R2).
  The file header carries the two rules verbatim from A02 §1.3: `toPlanDate` reads the **local**
  calendar (never `toISOString().slice(0,10)`), and all arithmetic is `Date.UTC` on the parsed
  Y/M/D. Monday is hardcoded with a one-line reason; **no `weekStartsOn` parameter**.
- **Tests (`packages/shared/test/calendar.test.ts`):** the `toISOString()` trap at `new Date(2026,8,8,23,30)`
  and `new Date(2026,8,8,0,30)`; the spring-forward pair `addPlanDays("2026-03-28",1)` →
  `"2026-03-29"` → `"2026-03-30"` and the autumn pair around `2026-10-25`; month/year/leap
  boundaries (`2026-01-31`, `2026-12-31`, `2028-02-28`); `startOfPlanWeek` for all seven days of a
  week; `planWeek` returns 7 ascending dates starting Monday; `isPlanDate` rejects `"2026-02-31"`,
  `"2026-2-3"`, `"26-02-03"`, `"2026-02-03T00:00:00Z"`, `""`; `planDaysBetween` signed and 0 for
  equal dates; `groupByLocalDay` preserves newest-first order within a bucket.
- **Gotchas:** *pure logic belongs in `packages/shared` with unit tests, never in a route handler
  or a component*. Tests live in **`packages/shared/test/`**, not `src/` (R3) — that is where the
  other ten test files are. Do **not** commit a `TZ`-dependent test: `bun test` reads `TZ` at
  process start and one file cannot set it for itself; run `TZ=Pacific/Kiritimati bun test
  packages/shared/test/calendar.test.ts` by hand once and report it in the PR.

#### T2.2 — Recipe wire schema: `tags.kind`, `course`, `lastCookedAt`, sorts

- **Creates:** `packages/shared/src/tags.ts`, `packages/shared/test/tags.test.ts`
- **Modifies:** `packages/shared/src/schemas/recipe.ts` (sole owner),
  `packages/shared/src/index.ts` (append `export * from "./tags.ts";`)
- **Depends on:** T2.1
- **Done when:**
  - `schemas/recipe.ts` gains `TagKindSchema = z.enum(["course","free"])` + `TagKind`;
    `TagSchema.kind` **required** (every row has one after migration `0006`);
    `CreateTagRequestSchema.kind` optional (server default `free`);
    `CreateRecipeRequestSchema.course: z.string().trim().min(1).max(60).nullish()` with the doc
    comment from A02 §4.2 (absent = untouched, `null` = unlink, a name = get-or-create as
    `kind:'course'`); `RecipeSchema.lastCookedAt: IsoDateSchema.nullish()` (read-only, derived);
    `RecipeSortSchema` gains `"lastCooked"`; `RecipeListQuerySchema` gains
    `hasCooked: z.enum(["0","1"]).optional().transform(v => v === undefined ? undefined : v === "1")`
    — **never `z.coerce.boolean()`**, which turns `"0"` into `true`.
  - `tags.ts` exports `recipeEyebrow(tags): { course: string | null; detail: string | null }` —
    first `kind:'course'` tag, then the first free tag; **returns raw German names, never keyed**.
    Its doc comment states that a `{ course: null }` result must render **no element at all**.
- **Tests (`packages/shared/test/tags.test.ts`):** course + first free tag; course only; **no course
  → `{ course: null }`**; two course tags → alphabetically first (input is already
  `asc(tags.name)`-ordered, which is why the function needs no sort); empty array.
- **Gotchas:** **INTERFACE vs CONTENT is the most damaging edit in this repo.** The course
  vocabulary (`Hauptspeise`, `Beilage`, `Dessert`, `Suppe`, `Auflauf`, `Eintopf`) is German
  CONTENT, exactly like `units.ts` — never routed through `t()`, never keyed, never dependent on
  `users.locale`. Only the filter rail's *heading* is interface. `course` must **not** be added to
  `keepOnlySentKeys` in `routes/recipes.ts` (that list exists only for child arrays carrying
  `.default([])`; `course` is `nullish()` with no default, so absent really is `undefined`).

#### T2.3 — Planner wire schema, `ERROR_CODES`, server catalogs

- **Creates:** `packages/shared/src/schemas/plan.ts`
- **Modifies:** `packages/shared/src/schemas/common.ts` (one `ERROR_CODES` entry),
  `packages/shared/src/i18n/catalogs/server.de.ts`,
  `packages/shared/src/i18n/catalogs/server.en.ts` (sole owner of both),
  `packages/shared/src/index.ts` (append `export * from "./schemas/plan.ts";`)
- **Depends on:** T2.1, T2.2
- **Done when:**
  - `schemas/plan.ts` matches A02 §2.4: `PLAN_LIMITS` (`entriesPerDay: 12`, `rangeDays: 62`, **`fromPlanEntries: 60`** — the cap T4.3's `from-plan` diff honours),
    `PlanDateSchema`, `PlanRecipeSchema` (**`thumbnailUrl` only — no `imageUrl`**),
    `MealPlanEntrySchema` (with the embedded `recipe`), `MealPlanRangeQuerySchema`,
    `CreateMealPlanEntryRequestSchema`, `UpdateMealPlanEntryRequestSchema`,
    **`MealPlanRangeResponseSchema = { from, to, items }` — NOT the paginated envelope** (R5),
    `MealPlanEntryResponseSchema`, `MarkCookedRequestSchema` (`{ plannedOn?, mealPlanEntryId? }`,
    everything optional so a bare `{}` works), `RecipeCookedResponseSchema`.
  - `ERROR_CODES` gains exactly one entry: `"meal_plan_day_full"`. Everything else reuses
    `not_found` / `conflict` / `validation_failed` / `email_unverified`.
  - Both server catalogs gain the six `server.plan.*` keys and `server.recipes.nothingToUndo`
    (values in A02 §6.2). **`server.plan.rangeTooLong` inlines the number 62** rather than using a
    `{max}` placeholder, because `refineKey()` takes a bare key with no values and would render
    `{max}` unsubstituted; a comment above the key ties it to `PLAN_LIMITS.rangeDays`.
- **Tests:** extend `packages/shared/test/schemas.test.ts` with: a valid/invalid `plannedOn`;
  `to < from` rejected; a range of exactly `rangeDays` rejected; `MarkCookedRequestSchema.parse({})`
  succeeds.
- **Gotchas:** *the i18n typing is the enforcement* — a key in `de` and not in `en` is a **compile**
  error; add both in this task. *A code is a wire contract, never renamed* — mint as few as
  possible. `plannedOn` passes to the wire **verbatim**; putting it through `toIso()` would hand the
  client a `T00:00:00.000Z` it mis-renders west of Greenwich.

#### T2.4 — Shopping wire schema

- **Modifies:** `packages/shared/src/schemas/shopping.ts` (sole owner)
- **Done when:** matches A03 §7 — `SHOPPING_LIMITS` gains `boughtSectionMax: 100` and
  `listPreviewItems: 8`; new `ShoppingItemPreviewSchema`, `ShoppingBoughtItemSchema`,
  `ShoppingListRecipeSchema`, `ShoppingBoughtListResponseSchema`,
  `ShoppingCatalogListResponseSchema`, `UpdateShoppingCatalogEntryRequestSchema` (`{ hidden: boolean }`),
  `PlanShoppingPreviewRecipeSchema`, `PlanShoppingPreviewResponseSchema`;
  `ShoppingListSchema` gains optional `boughtCount`, `boughtClearedAt`, `previewItems`
  (**no `isDefault`** — R9); `ShoppingCatalogEntrySchema` gains `hiddenAt`;
  `ShoppingListDetailResponseSchema` gains **required** `bought` and `recipes` arrays.
  `AddRecipeToShoppingListRequestSchema`, `CheckShoppingItemRequestSchema`,
  `AddShoppingItemsRequestSchema` and `UpdateShoppingItemRequestSchema` are **unchanged**.
  The file header's "there is no `checked` field anywhere" paragraph gains the log sentence.
- **Tests:** extend `packages/shared/test/schemas.test.ts`: a detail response without `bought`
  fails to parse (proving the field is required, which is what forces `PERSIST_BUSTER`).
- **Gotchas:** the offline outbox's persisted mutations must not change meaning — none of the four
  request schemas above is touched, so a mutation dehydrated by the old build replays correctly.

#### T2.5 — Shopping pure logic

- **Modifies:** `packages/shared/src/shopping.ts` (sole owner),
  `packages/shared/test/shopping.test.ts` (sole owner)
- **Done when:** three functions exist with **these exact names** (R8):
  `shoppingProgressPercent(toBuy, bought)`, `selectMostBoughtEntries(entries, limit = FREQUENT_CHIP_COUNT)`,
  `sortEntriesByFoldedName(entries)`, plus `export const FREQUENT_CHIP_COUNT = 8`.
  Selection and display order are **two separately named functions** and the chip row is exactly
  `sortEntriesByFoldedName(selectMostBoughtEntries(catalog))` — a single `sortBy` reverts the
  design's stated fix and code review rejects it.
- **Tests:** `shoppingProgressPercent`: `(10,4) === 29` (the mock's 29%), `(0,0) === 0`,
  `(0,7) === 100`, `(7,0) === 0`. `sortEntriesByFoldedName`: `["Zwiebel","Äpfel","Brot"]` →
  `Äpfel, Brot, Zwiebel`. `selectMostBoughtEntries`: ranks by `useCount` then `lastUsedAt`, caps
  at the limit, and does **not** alphabetise.
- **Gotchas:** ***`FOLD_PAIRS` cannot be completed and no new fold may be written in SQL.***
  `sortEntriesByFoldedName` folds with `foldText()` from `src/text.ts` and then compares — never
  `localeCompare` alone (`Ä` sorts after `Z`), and never a `foldSql()` ORDER BY (the parser
  overflows past 30 nested `replace()` calls and the table is deliberately half-finished).
  `shoppingItemKey`'s U+001F separator is untouched.

### Phase 3 — DB schema, migrations, seed

#### T3.1 — All three migrations (ONE agent, ONE task)

- **Creates:** `apps/api/drizzle/0006_tag_kind.sql`,
  `apps/api/drizzle/0007_meal_plan_and_cook_log.sql`,
  `apps/api/drizzle/0008_shopping_bought.sql`, plus the three
  `apps/api/drizzle/meta/000{6,7,8}_snapshot.json` files drizzle-kit writes
- **Modifies:** `apps/api/src/db/schema.ts` (sole owner),
  `apps/api/drizzle/meta/_journal.json`
- **Deliberately over the ~8-file guideline** because migration numbering and `schema.ts` are one
  ordered, shared resource (rule 1). Three `bun run db:generate` runs, in order, one agent.
- **Done when:**
  - **`0006_tag_kind`** — `ALTER TABLE tags ADD kind text DEFAULT 'free' NOT NULL;`. Drizzle:
    `kind: text("kind").notNull().default("free").$type<TagKind>()`. **The drizzle default is KEPT**
    (unlike the `*_fold` columns): `'free'` is right for every existing insert site, so there is no
    schema/DB divergence and `$inferInsert` stays unchanged. **No `(group_id, kind)` index** (R6) —
    `tags_group_id_idx` already narrows to the group and a group holds tens of rows.
  - **`0007_meal_plan_and_cook_log`** — `meal_plan_entries` **without the `note` column**
    (A02 §2.1 declares one; it is **dropped** — no artboard draws it, no endpoint reads it and no
    DTO carries it, and dead schema is how a second, differently-shaped `note` column gets added
    later. It is one migration line whenever `/plan` grows a note field), with
    `meal_plan_entries_group_date_recipe_unique`,
    `meal_plan_entries_group_date_idx (group_id, planned_on, position)` and
    `meal_plan_entries_recipe_id_idx`), then `recipe_cook_log` (A02 §3.1, with
    `meal_plan_entry_id … ON DELETE set null`), then
    `ALTER TABLE recipes ADD last_cooked_at integer;` and
    `CREATE INDEX recipes_group_last_cooked_idx ON recipes (group_id, last_cooked_at, created_at);`
    (three columns — R6). `planned_on` is **`text` holding `YYYY-MM-DD`** (R1). Cook-log FK order
    inside the file matters: `meal_plan_entries` first.
  - **`0008_shopping_bought`** — `shopping_bought_items` + its two indexes,
    `shopping_list_recipes` + its unique and list indexes (R10 — the table ships),
    `ALTER TABLE shopping_lists ADD bought_cleared_at integer;`,
    `ALTER TABLE shopping_list_catalog ADD hidden_at integer;`. `bought_by` is **nullable,
    `ON DELETE set null`** (R17). Indexes are declared **ascending** — no `.desc()` in a drizzle
    index (SQLite walks a composite index backwards when the leading column is an equality, so the
    plan is identical and `.desc()` is a version-dependent API this repo does not otherwise use).
  - `schema.ts` carries the full doc comments from A02 §2.2 / §3.1 and A03 §1.2 — in particular the
    paragraph on `meal_plan_entries.planned_on` (why it is the one non-instant column), the
    single-writer note on `recipes.last_cooked_at`, and the "history outlives the account" note on
    `bought_by`. Relations are added for symmetry.
  - **`apps/api/src/db/migrate.ts` is NOT edited.** None of the three needs a JS backfill:
    `recipe_cook_log` starts empty, NULL is correct for both new nullable columns, and
    `DEFAULT 'free'` fills every existing tag row. Each migration header says so, because `0003`'s
    presence sets the opposite expectation.
  - Filenames and their `tag` in `_journal.json` are renamed by hand to the speaking names above,
    the way `0003_folded_search_columns.sql` already is. **Snapshots are never hand-edited.**
- **Tests:** none in this task (phase 4 owns the behavioural tests). Two mandatory manual gates,
  reported in the PR:
  1. The `@libsql/client` DDL probe from A06 §4.5 against a scratch **file** DB, **populating each
     table before the `ALTER`** — that is the case SQLite actually rejects. Assert
     `sqlite_version()` is `3.45.1` and list the new index names.
  2. `bun run db:migrate` clean on a **fresh** `file:` DB **and** on a copy of a pre-redesign DB.
     Only the second exercises "ADD NOT NULL onto a populated table".
- **Gotchas:** *`bun:sqlite` is a newer SQLite (3.53) than the one the app uses (3.45.1)* — verify
  DDL through `@libsql/client` only. **No `GENERATED … STORED` anywhere**; `recipes.last_cooked_at`
  is a plain nullable column, never `NOT NULL DEFAULT 0` (0 is 1970 and would sort a never-cooked
  recipe as recently cooked). **`db:generate` runs with `strict: true, verbose: true` and will ask
  three things: decline the `*_fold` `DEFAULT ''` reconciliation all three times**; answer
  **"create column"**, never "rename", for `last_cooked_at` (offered against `created_at`) and
  `hidden_at` (offered against `last_used_at`) — a rename emits `ALTER TABLE … RENAME COLUMN` and
  destroys data; answer "create table" for `shopping_bought_items` against `shopping_list_items`.
  No partial index anywhere: the `(list_id, merge_key)` unique index must stay **total** so a
  re-added bought item merges normally.

#### T3.2 — Seed

- **Modifies:** `apps/api/scripts/seed.ts` (sole owner)
- **Depends on:** T3.1
- **Done when:** the three existing tags keep their names and become `kind: 'free'`; the course
  vocabulary `["Hauptspeise","Beilage","Dessert","Suppe","Auflauf"]` is seeded as `kind: 'course'`
  and one course is linked to each demo recipe (`DemoRecipe` gains `course: string`); a handful of
  `shopping_bought_items` rows across two days, one hidden `shopping_list_catalog` entry and one
  `shopping_list_recipes` row are seeded, so the history panel and the list rail are not empty on a
  fresh dev DB; every insert site that `tsc` now fails on is fixed. **Plus the two headline
  features' own data, which the first draft of this task omitted:**
  - **3–4 `meal_plan_entries` across the CURRENT week**, one of them on today, one of them carrying
    `cooked_at`. Dates are computed with `toPlanDate()` / `planWeek(todayPlanDate())` from
    `@toon/shared` — the seed is a CLI on a developer's machine, so it is a client for the purposes
    of the calendar-date boundary and may read the local calendar. **Never
    `new Date().toISOString().slice(0,10)`.**
  - **3–5 `recipe_cook_log` rows** spread over the last two weeks, with `recipes.last_cooked_at`
    written to `max(cooked_at)` per recipe **in the same script** — that is the invariant T4.2's
    agreement test asserts, and a seed that violates it makes a real test look like a real bug.
  Without these, a fresh dev DB renders an empty week strip, an empty "Kürzlich gekocht", an empty
  `1c` "Aus dem Wochenplan" panel and an empty `/plan` — i.e. nothing for T11.2 to screenshot on
  the one screen whose screenshots **are** its reference.
- **Tests:** none. `bun run seed` against a fresh `file:` DB must succeed and the README curl
  walkthrough must still pass.
- **Gotchas:** the seeded German names are **CONTENT** and never go through `t()`; the script's own
  `console.*` output stays **English literals** (ops output is one language). `seed.ts` is already
  in `scripts/i18n-check.ts`'s `ALLOW_LIST`, so it needs no new entry.

### Phase 4 — API services + routes

#### T4.1 — Planner service and router

- **Creates:** `apps/api/src/services/plan/plan.service.ts`, `apps/api/src/services/plan/mappers.ts`,
  `apps/api/src/routes/plan.ts`, `apps/api/test/plan.test.ts`
- **Modifies:** `apps/api/src/index.ts` (one `app.route` line)
- **Done when:**
  - `routes/plan.ts` is mounted as `app.route("/api/groups/:groupId/plan", planRoutes)`
    **above** the `/api/groups/:groupId` catch-all recipes router, next to `imports` and
    `shopping`. Router middleware is `use("*")` for all three of `requireSession()`,
    `requireGroupRole("member")`, `requireVerifiedEmail()` — the uniform `recipeRoutes` pattern,
    not the per-route `groupRoutes` pattern.
  - Four endpoints, **paths exactly as in R4** (no `/entries` segment):
    `GET /?from&to` → `MealPlanRangeResponse` (200);
    `POST /` → 201 new / **200 when already planned** (the unique index is the whole idempotency
    story — planner writes are online-only, so there is no `mutationId` ledger), 409
    `meal_plan_day_full`, 404 for a recipe outside the group;
    `PATCH /:entryId` → 200, 409 `conflict` + `server.plan.alreadyPlanned` when the move collides
    (never a silent merge of two entries);
    `DELETE /:entryId` → 204.
  - **Any member may plan and unplan any entry** — a shared week is shared property, the same rule
    `updateShoppingList` applies to renaming a list. Do not call `assertCanModifyOwned`.
  - **Three functions are exported from `plan.service.ts` because other tasks consume them**, and
    all three are part of this task's "done when" so T4.2 and T4.3 do not stall on a file they do
    not own:
    - `listPlanEntries(db, groupId, from: PlanDate, to: PlanDate)` — **one query with an
      `innerJoin` on `recipes`**, ordered `asc(plannedOn), asc(position)`. Consumed by T4.3's
      `from-plan` read.
    - `loadPlanEntryRow(db, groupId, entryId): Promise<MealPlanEntryRow | undefined>` — scoped by
      `and(eq(id), eq(groupId))`, so a cross-group id is `undefined` rather than a leak. Consumed
      by T4.2's `recordCooked` to verify a client-supplied `mealPlanEntryId`.
    - `findPlanEntryForRecipeOnDay(db, groupId, recipeId, plannedOn: PlanDate)` — the entry to
      stamp when the client names a **date** rather than an entry id; returns `undefined` when the
      recipe is not planned that day. It is the **only** place a date-to-entry resolution happens,
      and it takes the date as a parameter precisely because the server never derives one.
  - `toPlanRecipe` mints `signUploadUrl(thumbnailUrlFor(row.imageUrl))`; `toMealPlanEntry` passes
    `plannedOn` through **verbatim** and uses `toIso`/`toIsoOrNull` for the instants.
  - `entryId` is **not** added to `RESOURCE_PARAMS` in `middleware/group.ts` — the service scopes
    by `and(eq(id), eq(groupId))`, so a cross-group id answers 404 rather than leaking.
- **Tests (`apps/api/test/plan.test.ts`):** every case in A02 §7.2's plan block —
  `plannedOn` returned verbatim as `"2026-09-10"`; double POST → 200 + one row + the second call's
  `servings` applied; day cap → 409 with the message asserted in **both** negotiated locales;
  cross-group recipe → 404 that never names the other group; PATCH re-tails `position` on the
  target day; collision → 409; GET range flat and ordered, empty days simply absent; `to < from`,
  an over-long range and `from=2026-02-31` all 422; the verified-email gate 403s POST/PATCH/DELETE
  and lets GET through; cascades from recipe and group deletion; and an
  **`explain query plan` assertion** that the range read uses `meal_plan_entries_group_date_idx`
  and contains no `TEMP B-TREE` (copy the shape of `test/recipes-search.test.ts`'s title-sort test).
- **Gotchas:** *order matters* — `plan` before the catch-all recipes router. *Tests live in
  `apps/api/test/`, never `tests/`* (tsconfig includes `test/**` only). *A test file that calls
  `setVerifiedEmailRequired()` must hand it back in `afterAll(() => setVerifiedEmailRequired(null))`*
  — `bun test` runs every file in one process. **The server never derives a calendar date**: no
  `new Date()` decides what day it is anywhere in this task. *A list renders `thumbnailUrl`, never
  `imageUrl`.* *Signed `/uploads` URLs are minted where a row is serialised* — `toPlanRecipe` joins
  that list. `withTransaction` degrades to sequential statements on `file::memory:`, so the
  statement ORDER in the tests is the real write path even though rollback is missing.

#### T4.2 — Cook tracking + the course dimension (recipes router and services)

- **Creates:** `apps/api/src/services/recipes/cookLog.ts`, `apps/api/test/recipes-cooked.test.ts`,
  `apps/api/test/tags-kind.test.ts`
- **Modifies:** `apps/api/src/routes/recipes.ts`, `apps/api/src/services/recipes/recipes.service.ts`,
  `apps/api/src/services/recipes/mappers.ts`, `apps/api/src/services/recipes/tags.service.ts`
  (sole owner of all four)
- **Depends on:** T4.1 (`findPlanEntryForRecipeOnDay`, `loadPlanEntryRow`)
- **Done when:**
  - `cookLog.ts` is the **only writer of `recipes.last_cooked_at`**, exporting `recordCooked` and
    `undoCooked`. `recordCooked`, in one `withTransaction`: load the recipe (404), insert the log
    row with `cookedAt: nowMs()` and `cookedBy: userId`, resolve the plan entry to stamp
    (`mealPlanEntryId` if sent and verified in-group and pointing at this recipe, else
    `findPlanEntryForRecipeOnDay` **if and only if `plannedOn` was sent**, else null), plain-`set`
    `recipes.last_cooked_at` to that timestamp, and **do not touch `recipes.updated_at`** (with the
    comment — a cook is not an edit and bumping it would reorder `?sort=newest`).
  - `POST /recipes/:recipeId/cooked` (body `MarkCookedRequestSchema`, `{}` valid) and
    `DELETE /recipes/:recipeId/cooked` (R18 — undo ships): deletes the **caller's own** most recent
    log row for that recipe if younger than `COOK_UNDO_WINDOW_MS` (10 min), clears the plan entry's
    `cooked_at` when that row stamped it, and **recomputes** `last_cooked_at` from
    `max(cooked_at)` (NULL when none remain). 404 + `server.recipes.nothingToUndo` otherwise.
  - `recipes.service.ts`: `orderFor` gains `case "lastCooked": return [desc(recipes.lastCookedAt),
    desc(recipes.createdAt)]` **with no `is null` leading term** (SQLite puts NULLs last under
    DESC, which is what makes the index usable — `?sort=rating` pays a temp b-tree for its
    `is null` and this must not); `listRecipes` gains
    `if (query.hasCooked === true) conditions.push(isNotNull(recipes.lastCookedAt))` — a column
    predicate, **never a subquery**, so the `count(*)` half stays an index-narrowed count.
    `replaceTags` deletes **only free links** (A02 §4.2's `inArray` sub-select) and a sibling
    `replaceCourse(tx, groupId, recipeId, courseName)` replaces the single `kind:'course'` link.
  - `mappers.ts`: `toRecipe` gains `lastCookedAt: toIsoOrNull(row.lastCookedAt)`; `toTag` passes
    `kind: row.kind` through.
  - `tags.service.ts`: `createTag`/`updateTag` accept `kind`; `getOrCreateTagIds` gains a fourth
    parameter `kind: TagKind = "free"` **applied only to tags it CREATES** — it must never update
    the kind of a tag it found (an old client sending the course name in `tags` then links the
    existing course tag without flipping it).
  - `routes/recipes.ts`: the two cooked routes after `/image`; `course` handled in create/patch.
    **`course` is not added to `keepOnlySentKeys`.**
- **Tests:** `recipes-cooked.test.ts` — one log row per POST with the caller as `cooked_by`;
  `last_cooked_at` equals it; `lastCookedAt` on **both** list item and detail, `null` before the
  first cook; with `plannedOn` the entry is stamped and returned, **without `plannedOn` and without
  `mealPlanEntryId` nothing is stamped and `mealPlanEntry` is `null`** (this is the test that pins
  "the server never guesses today"); `mealPlanEntryId` pointing at another recipe's entry → 404;
  `?sort=lastCooked` puts cooked first and never-cooked **last**; `?hasCooked=1` returns only
  cooked and `total === items.length`; `recipes.updated_at` unchanged by a cook; deleting a plan
  entry leaves the log row with `meal_plan_entry_id IS NULL`; the **agreement test** (for every
  recipe, `last_cooked_at === max(cooked_at)` of its log rows, or NULL); undo inside and outside
  the window; and an `explain query plan` assertion for
  `where group_id = ? order by last_cooked_at desc, created_at desc limit 24` naming
  `recipes_group_last_cooked_idx` with no `TEMP B-TREE`.
  `tags-kind.test.ts` — default `free`; `POST /tags {kind:"course"}`; `PATCH` promotes a free tag;
  `POST /recipes {course:"Dessert", tags:["Backen"]}` creates one of each kind and links both;
  `PATCH {tags:[…]}` **keeps** the course link; `PATCH {course:null}` unlinks and leaves the tag
  row; `GET /tags` returns `kind` + per-tag `recipeCount` in one response; the old-client shape
  does not flip an existing course tag's kind.
- **Gotchas:** *Recipe search reads PRE-FOLDED columns; the fold is never computed per row* —
  `last_cooked_at` is the same lesson in a new place: the `total` half of the list envelope is a
  `count(*)` that cannot stop early, so the derivation is stored, not joined. **One writer:**
  `recipePatch()` must not gain a branch for `last_cooked_at`, the same rule that keeps
  `updateUser()` from patching `email_verified_at`. *Course names are CONTENT* — nothing in this
  task calls `t()` on a tag name. Also **measure and record** the three medians from A02 §3.3
  (correlated subquery / grouped-max join / stored column, 2000 recipes on a scratch **file** DB
  through `@libsql/client`) in the `recipes.last_cooked_at` schema comment; the committed
  regression guard is the plan assertion, not the timing.

#### T4.3 — Shopping API: bought log, catalog hiding, list recipes, from-plan

- **Creates:** `apps/api/src/services/shopping/bought.service.ts`,
  `apps/api/src/services/shopping/fromPlan.service.ts`,
  `apps/api/test/shopping-bought.test.ts`, `apps/api/test/shopping-from-plan.test.ts`
- **Modifies:** `apps/api/src/services/shopping/items.service.ts`,
  `apps/api/src/services/shopping/lists.service.ts`,
  `apps/api/src/services/shopping/mappers.ts`, `apps/api/src/routes/shopping.ts`,
  `apps/api/test/shopping.test.ts` (sole owner of all five)
- **Depends on:** T4.1 (`listPlanEntries`)
- **Deliberately nine files / one agent**: `routes/shopping.ts` and `items.service.ts` cannot be
  split between two agents, and file ownership beats task size.
- **Done when, in four steps:**
  1. **Check-off restructure.** `checkShoppingItem` takes a new `boughtBy: string` parameter (the
     route passes `requireUser(c).id`) and becomes `DELETE … RETURNING`; **the log append is bound
     to that statement actually removing a row**, not to the request arriving. `appendBoughtItem`
     copies `name`/`quantity`/`unit`/`note`/`sourceRecipeIds`. `pruneBoughtLog(db)` runs after the
     transaction next to `pruneMutationLedger(db)`, with `BOUGHT_LOG_TTL_MS = 90 days`. This also
     fixes the pre-existing double `use_count` bump under a two-member race.
  2. **Bought section + history.** `getShoppingListDetail` gains `bought` (rows with
     `bought_at >= (bought_cleared_at ?? 0)`, newest first, ≤ `SHOPPING_LIMITS.boughtSectionMax`,
     each with `boughtBy` + resolved `boughtByName`) and `recipes` (§3 below).
     `POST /:listId/bought/clear` sets the watermark (R19 — **`POST …/clear`, not
     `DELETE …/bought`**: DELETE reads as "delete the log", which is exactly what it must not do).
     `POST /:listId/bought/:boughtId/undo` runs A03 §1.5 verbatim: claim the mutation, delete the
     log row `RETURNING`, re-add through the **same `applyAdditions`** (so 500 g undone onto 200 g
     becomes one 700 g line), decrement `use_count` **floored at 0**, bump the list.
     `GET /bought?listId&limit&offset` is the group-wide archive — standard
     `{ items, total, limit, offset }`, limit default 24 / max 100, newest first, **watermark
     ignored**, `listId` optional.
  3. **List index extras.** `listShoppingLists` gains `boughtCount` (one grouped count against
     `max(coalesce(bought_cleared_at,0), ?since)`), `boughtClearedAt`, and `previewItems`
     (≤ 8, `position` order, via one `row_number() over (partition by list_id …)` query).
     An optional `?since=<ISO>` is parsed with `IsoDateSchema.safeParse`, **ignored on failure
     rather than 422** (a bad query param must not blank a screen), and clamped to
     `[now - 7d, now]`. Three bounded queries per fetch, **never a per-list N+1**.
  4. **List recipes + catalog hiding + from-plan.** `addRecipeToShoppingList` takes `userId` and
     upserts `shopping_list_recipes` (`onConflictDoUpdate` on `(list_id, recipe_id)` — re-adding at
     a different portion count is the newest intent); `clearShoppingList` deletes the list's
     `shopping_list_recipes` rows; `DELETE /:listId/recipes/:recipeId` deletes items whose **only**
     source is that recipe, leaves shared lines with **quantities unchanged** and the id dropped
     from `sourceRecipeIds`, and removes the join row.
     `PATCH /:listId/catalog/:entryId` (`{ hidden: boolean }`) sets/clears `hidden_at`;
     `getShoppingListDetail`'s catalog query gains `isNull(hiddenAt)`;
     `GET /:listId/catalog?includeHidden&limit&offset` is the unhide surface (R20).
     `GET /:listId/from-plan?from&to` (**both required**, R21) implements A03 §5 — diff against the
     stored `merge_key`s, de-duplicate plan entries by recipe keeping the earliest `plannedOn`,
     return `missingIngredientIds` + a distinct-key `missingCount`, omit fully-covered recipes.
  5. **Route registration order in `routes/shopping.ts`:** `GET /bought` **before** `GET /:listId`,
     and the file header gains that note next to the existing "mounted before the catch-all
     recipes router" one.
- **`from-plan` is the one new read that needs a measured plan and a bound**, and R23 refuses a
  `/summary` endpoint by citing exactly the rule that applies here (*a local libSQL file is ONE
  SERIALISED LANE… the lever is making queries cheaper, never adding concurrency*). Three things
  are part of "done when":
  1. An **`explain query plan` assertion** in `shopping-from-plan.test.ts` that the plan-entry range
     scan uses `meal_plan_entries_group_date_idx` and the ingredient join uses
     `recipe_ingredients`' recipe index, with **no `TEMP B-TREE`** — the same shape as T4.1's and
     T4.2's assertions.
  2. A **measured median** in the PR at a realistic week (7 entries × ~12 ingredients) against a
     scratch **file** DB through `@libsql/client`, next to the three medians T4.2 records.
  3. A **cap on the entries it will diff**: `PLAN_LIMITS.rangeDays` (62) allows ~62 × 12 entries,
     so `from-plan` diffs at most `PLAN_LIMITS.fromPlanEntries = 60` plan entries (earliest
     `plannedOn` first) and returns the recipes it covered. The PR must **state whether a rate limit
     is wanted** — `enforceRateLimit` is a stated rule for the import endpoints only, so this is a
     judgement call and belongs on the record either way. Recommendation: no rate limit, because the
     read is authenticated, group-scoped, bounded by the cap and fetched once per `/shopping` focus;
     the cap is the actual protection.
- **Tests:** all thirteen cases in A03 §8 in `shopping-bought.test.ts`, plus the from-plan cases in
  `shopping-from-plan.test.ts`; `shopping.test.ts` is updated for the `checkShoppingItem` /
  `addRecipeToShoppingList` signature changes and keeps every existing assertion (including "the
  ledger is scoped per list"). The route-order test must assert **both** halves — that `/bought`
  answers the envelope **and** that a real list id still resolves — or it passes by accident
  whenever hono happens to rank statics first.
- **Gotchas:** *THE SHOPPING LIST IS THE ONE THING EDITABLE OFFLINE, and four pieces make that
  safe* — all four are untouched: the check-off endpoint, path and body are unchanged, so a
  persisted `v2` outbox entry keeps meaning "delete this row". *The `(list_id, merge_key)` unique
  index stays TOTAL* — no partial index. *`RETURNING` on DELETE needs SQLite ≥ 3.35 and libSQL
  ships 3.45.1* — verified through `@libsql/client`, which a `bun test` against `file::memory:`
  does; keep the test that pins it. *`FOLD_PAIRS`* — **no SQL fold is added anywhere**; the
  alphabetical chip order is the client's job. *A rail thumb is a LIST image* —
  `signUploadUrl(thumbnailUrlFor(...))`. *`requireVerifiedEmail` only blocks non-GET* and the
  router-level `use("*")` already covers every new write, so no per-route decision is needed here
  (unlike `routes/groups.ts`). `ingredientTotal` counts the recipe **as it is today** (R22) — say
  so in the field's comment so "5 of 6" does not read as a bug.

#### T4.4 — `docs/API.md` for the new endpoints

- **Modifies:** `docs/API.md` (sole owner)
- **Depends on:** T4.1, T4.2, T4.3
- **Done when:** a new "Meal plan" section carries the four endpoints, that `plannedOn` is a
  calendar date and **whose** calendar it is, that the range response is deliberately **not** the
  paginated envelope, that POST is idempotent (200 vs 201) and that any member may edit any entry.
  "Recipes" gains `POST`/`DELETE …/cooked`, the derived read-only `lastCookedAt`, `?sort=lastCooked`,
  `?hasCooked=1`, the `course` PATCH semantics and the "`tags` replaces only FREE links" rule plus
  the older-client note. "Shopping lists" gains one row per new endpoint and three notes: the
  bought log + watermark (D4), the `since` param and why day grouping is client-side, and the
  two-step frequently-bought ordering. The tables appendix gains `meal_plan_entries`,
  `recipe_cook_log`, `shopping_bought_items`, `shopping_list_recipes`, the two new unique indexes,
  and one paragraph naming `meal_plan_entries.planned_on` as the single non-instant date column.
- **Tests:** none.
- **Gotchas:** every new endpoint's `details` payload carries **machine values only** (`reason`,
  ids, counts), never prose — German in a `details` slot is the leak `tsc` cannot see and only
  `i18n:check` catches. `reason` is a machine contract like `code`: never keyed, never translated.

### Phase 5 — Web platform seams

#### T5.1 — `lib/api.ts`, `lib/queries.ts`, `lib/storage.ts`

- **Modifies:** `apps/web/src/lib/api.ts`, `apps/web/src/lib/queries.ts`,
  `apps/web/src/lib/storage.ts` (sole owner of all three)
- **Done when:**
  - `lib/api.ts` gains a fetcher per new endpoint (plan range/create/update/delete, mark cooked,
    undo cooked, bought history, clear bought, undo bought, catalog page, set catalog hidden,
    remove recipe from list, from-plan preview), each `credentials: "include"`. **No `fetch`
    outside this file** (the one existing exception is `features/import/lib/importApi.ts`).
  - `lib/queries.ts` gains keys, `queryOptions` and `invalidate.*` helpers, hierarchical so a
    prefix invalidates a subtree:
    `plan(groupId, {from,to})` + `planRoot(groupId)`, `planShopping(groupId, listId)`,
    `boughtHistory(groupId, query)`, `catalogPage(groupId, listId, query)`.
    **`groupSummary` is NOT added** (R23 — there is no summary endpoint).
    `planQuery` is `networkMode: "offlineFirst"`; `boughtHistoryQuery`, `catalogPageQuery` and
    `planShoppingQuery` use the default online mode.
    `invalidateAfterPlanMutation(qc, groupId)` invalidates `planRoot` + `planShopping`.
    **`invalidate.me(qc)` is added to `invalidateAfterRecipeMutation`'s `Promise.all`** — the
    sidebar and the group switcher read `recipeCount` from `["toon","me"]`, so today the count
    sticks at 37 after the 38th recipe. **No "recently cooked" key**: the carousel is
    `recipesQuery(groupId, { sort: "lastCooked", hasCooked: true, limit: 5 })`.
  - `lib/storage.ts` gains `lastShoppingListId`, stored as `"<groupId>:<listId>"` so switching
    groups cannot carry a foreign list id across (the same discipline as `activeGroupId`).
- **Tests:** none new here (T5.2 owns the persist test).
- **Gotchas:** *no `fetch` outside `lib/api.ts`*. *An idle TanStack mutation reports `error: null`,
  not `undefined`* — any new error-rendering path must test `error == null`.

#### T5.2 — Offline allow-list, `PERSIST_BUSTER`, router, service worker

- **Creates:** nothing
- **Modifies:** `apps/web/src/lib/persist.ts`, `apps/web/src/lib/persist.test.ts`,
  `apps/web/src/router.tsx`, `apps/web/vite.config.ts` (sole owner of all four)
- **`apps/web/src/lib/persist.test.ts` ALREADY EXISTS** (164 lines, with populated allow/deny
  `describe` blocks — one of them already uses `"meal-plan"` as its "an UNKNOWN key" example, which
  is why the chosen `"plan"` segment does not collide with it). **Extend its existing blocks; do
  not overwrite the file.** A "Creates" on a file that exists is how an implementer deletes tests.
- **Depends on:** T5.1 (the keys must exist)
- **Lands last in phase 5.**
- **Done when:**
  - `persist.ts`: `PERSISTED_GROUP_SEGMENTS` gains **`"plan"`** and **`"shopping-bought"`** and
    nothing else (R24 — no `"summary"`, no `"plan-shopping"`, no `"shopping-catalog"`);
    `PERSIST_BUSTER = "v3"` with a `v3:` line in the comment naming the reason
    (`ShoppingListDetailResponse` gained required `bought`/`recipes`; `RecipeResponse` gained
    `lastCookedAt`; `TagResponse` gained `kind`). `PERSISTED_MUTATION_KEYS` stays
    `new Set(["shopping"])` — `undo-bought`'s key is `["toon","shopping","undo-bought"]`, so
    `shouldPersistMutation` already allows it.
  - `router.tsx`: two new lazy routes under `groupScopedRoute` — `/plan` with
    `PLAN_SEARCH_PARAMS = ["week"]` and `/shopping/history` with
    `SHOPPING_HISTORY_PARAMS = ["listId","offset"]` — both `lazyRouteComponent(() => import(...))`
    with a **default** export, both added to `groupScopedRoute.addChildren([...])` and to the
    exported `routes` object, `/shopping/history` declared next to `cardsRoute` above
    `shoppingListRoute`. `RECIPE_FILTER_PARAMS` is **unchanged** — `sort` is already listed, so
    `?sort=lastCooked` survives `pick()` (only `RecipeSortSchema` widened, in T2.2), the course
    rail reuses the existing `tags` param (R25), and `hasCooked` is deliberately **not** a URL
    param (R26). The route-map comment at the top gains `/plan` and `/shopping/history` on the
    `guarded` line. `/import` and `/import/$draftId` stay declared exactly as they are.
  - `vite.config.ts`: `globPatterns` gains `woff2` with the comment from A01 §1.8 explaining why
    this is the **opposite** case from `wasm` (55 KB, every screen, needed offline vs 1.1 MB, one
    screen, once per card, at home). One new `NetworkOnly` rule
    `urlPattern: /\/api\/groups\/[^/]+\/plan/` inserted **after** the `shopping-lists` rule and
    **before** the `NetworkFirst` `(recipes|tags|collections)` rule. Nothing else changes:
    `navigateFallbackDenylist` stays `[/^\/api\//, /^\/uploads\//]`, `skipWaiting` stays **off**,
    `maximumFileSizeToCacheInBytes` stays 4 MB, and **the PWA manifest's `theme_color` /
    `background_color` are NOT edited** (R27 — the palette is not being rewritten).
- **Tests (`apps/web/src/lib/persist.test.ts`):** a **positive and a negative** assertion per key —
  `["toon","group","g","plan","…"]` and `["toon","group","g","shopping-bought","…"]` persist;
  `["toon","group","g","plan-shopping","…"]` and `["toon","group","g","shopping-catalog","…"]` do
  not; a `pending` query and a `null` payload are never persisted; `PERSIST_BUSTER === "v3"` is
  asserted so the value cannot be lost in a merge.
- **Gotchas:** *`shouldPersistQuery` is an ALLOW-list* — a new endpoint is excluded until named.
  *`/api` and `/uploads` must stay in `navigateFallbackDenylist` and out of `runtimeCaching`* —
  and `/plan` is a **navigation** path, so it must never go in the denylist. *`shopping-lists`
  stays `NetworkOnly`*: a `NetworkFirst` hit hands TanStack a stale body that looks like a fresh
  success and `onSuccess` writes it over the optimistic state, silently un-ticking items. *A
  `NetworkOnly` rule that comes second is never consulted.* *`skipWaiting` is OFF, and turning it
  back on breaks code splitting* — two new lazy chunks make that likelier, and the swap stays owned
  by `lib/pwa.ts` with **no fallback timer** (a blind reload retries a failing swap on every launch,
  i.e. a boot loop). *`lazyRouteComponent`, not a hand-rolled `React.lazy` wrapper* — the router
  preloads via `component.preload()`, which only `lazyRouteComponent` attaches; and do not wrap the
  new pages in a guard component, because `groupScopedRoute` is a pathless layout route precisely
  so the lazy component stays the route's `component`. *A URL is user input* — `week` runs through
  `startOfPlanWeek()` with a today fallback and `offset` through `Number.parseInt` with `NaN → 0`.
  Web test files belong to `tsconfig.test.json`; `scripts/typecheck.ts` needs no new line.

#### T5.3 — Shopping offline module

- **Creates:** `apps/web/src/features/shopping/lib/offline.test.ts`
- **Modifies:** `apps/web/src/features/shopping/lib/offline.ts`,
  `apps/web/src/features/shopping/lib/queries.ts` (sole owner)
- **Depends on:** T5.1
- **Done when:**
  - `SHOPPING_MUTATION_KEYS` gains `undoBought: ["toon","shopping","undo-bought"]`, registered with
    `setMutationDefaults` (a dehydrated mutation keeps its variables but **not** its `mutationFn`,
    so a replay without a registration throws). `onMutate` removes the row from `current.bought`
    and merges its `{name, quantity, unit, note}` into `current.items` with the existing
    `mergeIntoCache` — the same algebra the server runs, so the merged 700 g shows immediately and
    does not jump. `onError` → `rollbackCache`, `onSuccess` → `commit`.
  - **`removeFromCache(current, itemId, { asBought: true })` additionally PREPENDS an optimistic
    bought row**: `id: "pending:" + itemId`, `boughtAt: new Date().toISOString()`, and
    `boughtBy`/`boughtByName` from the **variables** (a new `boughtBy: { id, name }` field on the
    check mutation's variables, resolved at CALL time in `features/shopping/lib/queries.ts` from
    the cached `["toon","me"]` payload — **never read inside `mutationFn`**, which re-runs on
    replay). Without this an offline check-off makes the item vanish instead of moving, which reads
    as data loss on the one screen that has to be trustworthy offline.
  - `clearBought`, `setCatalogHidden` and `removeRecipeFromList` are **ordinary online mutations**
    and stay out of `offline.ts` entirely (R28).
  - The `commit` closure also invalidates the lists index (it already does) — nothing else.
- **Tests (`apps/web/src/features/shopping/lib/offline.test.ts`):** `removeFromCache(..., {asBought:true})`
  removes from `items`, prepends exactly one `pending:` bought row with the passed buyer name, and
  still bumps the catalog entry; the undo default's `onMutate` merges a restored line into an
  existing one rather than adding a second; a replay of the same variables is a no-op on the cache.
- **Gotchas:** the four pieces, all of which must survive — registration by mutation key (not
  inline in `useMutation`), `networkMode: "offlineFirst"`, `shouldPersistMutation` persisting only
  **paused** `["toon","shopping",…]` mutations, and a client-minted `mutationId` generated at CALL
  time. Drop the last one and a request that reached the server but lost its response is applied
  twice — and because items MERGE, the symptom is "500 g Mehl" quietly becoming "1 kg". This file
  is imported by `app.tsx` **for its side effect**; the defaults must exist before the persister
  restores. **An unverified account must never be able to queue a shopping mutation** — the server
  403s it and it can never succeed.

### Phase 6 — i18n copy

**Take every key, both values and every placeholder from `docs/redesign/i18n-keys.md`** — it is the
authoritative inventory (§1.1) and it wins over the task prose below on keys, values and
namespaces. The prose here says which FILES each task owns and in what order; it does not restate
the tables.

All three tasks add keys to **both** locale files of their namespace in the same edit; `en` is
typed `LocaleCatalog<typeof de>`, so a missing, extra or mis-shaped key is a compile error. One key
per **whole sentence**, never a fragment per clause. New German copy has no base-tree counterpart
and **will** be reported by `i18n:check` check 1 — that is expected (class 1).

**The one sanctioned multi-writer file class.** If a phase 7/8/9 task genuinely needs a key nobody
anticipated, it adds it to both files of that namespace, in the namespace's existing section
position, without reformatting anything else. Catalogs are append-only key/value blocks with no
cross-references, so this is safe; every other file in this plan has exactly one owner.

#### T6.1 — `ui` + `plan` namespaces and the registry

- **Creates:** `apps/web/src/lib/i18n/catalogs/plan.de.ts`, `apps/web/src/lib/i18n/catalogs/plan.en.ts`
- **Modifies:** `apps/web/src/lib/i18n/catalogs/ui.de.ts`, `ui.en.ts`,
  `apps/web/src/lib/i18n/catalogs/index.ts`, **`apps/web/src/lib/i18n/i18n.test.ts`**
  (sole owner of all four)
- **The web-side test edit is mandatory and was missing from the first draft.**
  `apps/web/src/lib/i18n/i18n.test.ts:21` hard-codes
  `const prefixes = ["auth.","recipes.","import.","shopping.","cards.","groups.","ui."]` and
  asserts `matches.length === 1` for **every** key in `CATALOGS.de`; every `plan.*` key scores 0
  and the test fails. Append `"plan."` to that array **in this same commit**. (The earlier draft
  named `packages/shared/test/i18n.test.ts` — that file exists but only compares the two **server**
  catalogs and needs no change. See `i18n-keys.md` §14 C1.)
- **Done when:**
  - `plan.de.ts` is `as const satisfies NamespaceCatalog<"plan">` and `plan.en.ts` is annotated
    `LocaleCatalog<typeof planDe>`. Keys cover: the page `h1` and subtitle, the week nav
    (`‹`/`›` are icons, so only "Diese Woche" and the week label format need keys), the three day
    states including the empty card's `+ Plan`, the per-card `ActionMenu` items
    (`plan.entry.markCooked`, `plan.entry.changeServings`, `plan.entry.moveDay`,
    `plan.entry.remove`, `plan.entry.openRecipe`, `plan.entry.addToShoppingList`), the picker
    dialog, the servings dialog, the empty/error/offline states, and the aria labels the new
    primitives require as props.
  - `ui.de.ts`/`ui.en.ts`: **add the four keys in `i18n-keys.md` §5.1** — `ui.nav.plan`
    (de `"Plan"`, en `"Plan"`: the same word in both is fine, is **not** a missing translation, and
    carries a comment saying so, as `cards.de.ts` does for the symbology names),
    `ui.nav.planNewBadge`, `ui.nav.organiseLabel` and `ui.sidenav.accountAction`.
    **The three DELETIONS move to T7.2** (`ui.topbar.searchRecipes`, `ui.topbar.newRecipe`,
    `ui.sidenav.logout`, R29): their only call sites are `TopBar.tsx` and `SideNav`'s logout
    button, both of which T7.2 deletes, so removing the keys here breaks the build in phase 6.
    One decision, two commits — T7.2's entry carries the other half. `ui.nav.import` is **kept**
    in both tasks — the `+` sheet reuses it.
  - `catalogs/index.ts` registers the `plan` namespace: two imports and two spread entries, and
    nothing else. This file is marked FINAL; a namespace cannot register itself, so the edit is
    unavoidable — **flag it in the PR** so it is not read as the rule being broken.
- **Tests:** `apps/web/src/lib/i18n/i18n.test.ts` must pass **after** the prefix-array edit, and
  its other three assertions constrain every row in `i18n-keys.md` (identical key sets, an `other`
  form on every plural in both locales, and an identical placeholder set per key compared on the
  plural's `other` form). `packages/shared/test/i18n.test.ts` compares only the server catalogs and
  needs no change.
- **Gotchas:** *`NAV_ITEMS` entries carry catalog KEYS, never labels.* *The two language names are
  autonyms and identical in every catalog.* Nothing in `plan.*` may contain a German recipe term —
  the day cards render recipe titles and course eyebrows, which are CONTENT and arrive from the API.

#### T6.2 — `recipes` namespace

- **Modifies:** `apps/web/src/lib/i18n/catalogs/recipes.de.ts`, `recipes.en.ts` (sole owner)
- **Done when:** the copy inventory in A04 §11 (library + detail) and A05 §8/§9.1 exists:
  the library header and group summary line, the search field, the `Filter` affordance and the
  filter sheet/rail headings (**`Gänge`/`Course` is the rail's HEADING — interface; the course
  names inside it are CONTENT and never keyed**), `Mehr Filter`, the sort labels including a
  `lastCooked` entry in the `*_LABEL_KEYS` map, `Diese Woche` + `Plan →`'s label,
  `Kürzlich gekocht`, `Alle Rezepte`, the create sheet's title and its two items
  (`recipes.create.newRecipe`, reusing `ui.nav.import` for the other),
  `recipes.filters.manageCollections` (`"Sammlungen verwalten"`) and `recipes.filters.manageTags`
  (`"Tags verwalten"`) — the two links that de-orphan `/collections` and `/tags` on a phone (R30) —
  the detail stat captions including `Zuletzt gekocht`, the `Gekocht`/`Kochmodus` buttons,
  `Für einen Tag planen`, and the cooked-undo copy (the `Rückgängig` label plus the toast, T8.4).
  **The four relative-time labels the first draft asked for are NOT added** —
  `gerade eben` / `vor {n} Min.` / `vor {n} Std.` / `vor {n} Tagen` come from
  `Intl.RelativeTimeFormat` through `formatRelative` and the new `formatRelativeShort`, which
  already produce exactly those strings in both locales **plus** the `gestern` / `letzte Woche`
  special cases a hand-keyed set gets wrong. Four hand-written German time phrases are four future
  parity hits for nothing (`i18n-keys.md` §3.1, C3). The only pre-existing key involved is
  `ui.time.justNow`.
  **The library search field is a plural key with a count**, not a static string: the artboard reads
  `Search 37 recipes`, so `recipes.list.searchPlaceholder` takes `{count}` from `totalCount` and
  falls back to a count-less variant while the total is `undefined` (render nothing, never `0`).
- **Tests:** none.
- **Gotchas:** ***German copy is a REFACTOR, not a rewrite: every `de` value that existed before
  must stay byte-identical*** — umlauts, `„low-high“` quotes, en-dashes, trailing colons and
  ellipses are part of the string. A restyled label is **not** new copy; only a key the design
  actually invents may be new. That distinction is the whole point of `i18n:check` check 1 and a
  reworded existing string looks byte-identical to a new one in its output. *A label map frozen at
  import time cannot follow a locale switch* — `SORT_LABELS` stays a `*_LABEL_KEYS` map of catalog
  keys; do not re-add a `roleLabels`-style map. `formatRelative` is **interface** and takes a
  locale, exactly like `formatDuration(minutes, locale)`; `parseDuration` is content and does not.

#### T6.3 — `shopping` namespace

- **Modifies:** `apps/web/src/lib/i18n/catalogs/shopping.de.ts`, `shopping.en.ts` (sole owner)
- **Done when:** the inventory in A03 §1.5/§4.3/§5.2 and A04 §11 exists: the two section headers
  (`Zu kaufen`, `Heute gekauft`), the counts line, `Gekauftes leeren` and its confirm copy — which
  says **"aus dieser Ansicht entfernen"**, never "löschen", because it clears the section and not
  the log (R31) — `shopping.bought.undo` (`"Zurück auf die Liste"`),
  `shopping.bought.undoMergeHint` (shown in the row's sheet **before** the tap, because the undo
  may merge amounts), `shopping.bought.undoSuccess`, `shopping.bought.unknownBuyer`
  (`"Unbekannt"`), `shopping.bought.buyers`, the history panel + `Alle`, the `/shopping/history`
  screen, `Häufig gekauft` + `Alle {n} anzeigen` + the long-press hint + the hide/unhide actions,
  `Rezepte auf dieser Liste` + `shopping.listRecipe.ingredientsOf` (`"{onList} von {total} Zutaten"`)
  + the three Remove-dialog keys (including the `shared: 0` variant as its **own** key),
  `Aus dem Wochenplan` + `shopping.fromPlan.addAll` (`"Alles auf „{list}“"`) + its per-row `Add`,
  the three sort options (R32), the share action, `Treuekarten`, and the derived
  "vor {n} Min. synchronisiert" / "{name} kauft gerade ein" strings (R33).
  **Three additions the first draft missed, all drawn:**
  - `1c`'s subtitle is `Shared with Meine Rezepte · 2 members · synced 2 min ago` — the GROUP NAME
    and `memberCount` are part of it, and both are already on `GroupWithRole`. Ship
    `shopping.lists.sharedSummary` **and** `shopping.lists.sharedSummarySynced` as two whole
    sentences (a key whose `{synced}` placeholder may be empty renders a dangling `·`), with
    `{members}` filled by the existing `groups.count.members` plural — two pluralised numbers cannot
    be one plural entry.
  - `1g`'s history rows read `Today · 4` (no buyer) where `1c`'s read `4 items · Eric`. Both
    spellings ship: `shopping.history.dayMeta` for the desktop panel and
    `shopping.history.dayMetaShort` for the phone one, selected by `BoughtHistoryPanel`'s
    `compact` prop (T8.5) — not by re-keying one string.
  - `1c`'s loyalty panel draws a `Manage` link and a dashed `+ Add card` tile: reuse the existing
    `cards.*` keys for both rather than minting `shopping.*` twins (`i18n-keys.md` §9).
- **Tests:** none.
- **Gotchas:** same byte-identity rule as T6.2. The seeded and user-entered item names, units and
  `n. B.` are **CONTENT** and stay German literals outside the catalogs. Day labels are interface
  (`Heute` from the catalog for the current day key, otherwise `formatDate`'s `Intl` output) while
  the day **bucket** is a date key from `groupByLocalDay` — the label is interface, the bucket is
  data.

### Phase 7 — Shell, nav, `/plan`

#### T7.1 — `nav-items.ts` + `GroupSwitcher`

- **Modifies:** `apps/web/src/components/layout/nav-items.ts`,
  `apps/web/src/features/groups/GroupSwitcher.tsx` (sole owner)
- **Depends on:** T6.1
- **Lands before T7.2.**
- **Done when:**
  - `NavItem["to"]` gains `"/plan"` and **loses `"/import"`** (Import is no longer a nav
    destination). `NAV_ITEMS` = Recipes `/` (exact) · Plan `/plan` · Shopping `/shopping` ·
    Profile `/settings`, icons `BookOpen`, `CalendarDays`, `ShoppingBasket`, **`CircleUser`**
    (not `Settings` — the design's point is that Profile is a person).
    `SECONDARY_NAV_ITEMS` = Collections · Tags · Groups **in that order** (the artboard's
    "Organise" group), icons `Folder` (plain, not `FolderHeart`), `Tag`, `Users`.
    `ScanText`, `Settings` and `FolderHeart` become unused imports — remove them.
  - The module doc comment is rewritten: it currently claims "four labels also means Importieren
    fits again" and "Gruppen moved into Profil", both of which stop being true. The replacement
    states that Plan took Import's slot, that Import is now the `+` sheet in the library header,
    and that every `SECONDARY_NAV_ITEMS` entry needs a phone route (with where each one is).
  - `GroupSwitcher`: `variant` becomes `"chip" | "block"` (a **rename** of `"bar"`, not an
    addition — nothing else uses `"bar"` once `TopBar` is gone). `"chip"` is the artboards' quiet
    inline chip with a 22px `initials()` tile (`Avatar shape="square" tone="brand" size="2xs"`),
    a truncating name and a `ChevronDown`, keeping a 44px target. `"block"` keeps the bordered
    sidebar button with a 28px (`size="xs"`) initials tile and the two-line name/summary stack.
    The existing `groups.count.members` · `groups.count.recipes` line is already the artboard's
    "2 members · 37 recipes" — **do not re-key it.** Drop the now-unused `Users` import.
- **Tests:** none.
- **Gotchas:** ***`labelKey` stays a `MessageKey`, never a translated string*** — resolving at
  import time freezes the tab bar and the sidebar at whichever locale loaded first; both consumers
  call `t(item.labelKey)` inside their render. This is the one rule in this file a refactor keeps
  breaking. The 22px tile carries **initials, not a glyph**, because 22px is below the
  icon-legibility floor — that is why the artboard draws initials. `lib/cn.ts` is plain `clsx`
  with **no tailwind-merge**, so a `className` background does not override `Avatar`'s — use the
  `tone` prop T1.4 added.

#### T7.2 — Shell frame: `AppShell`, `SideNav`, `BottomTabBar`, `TopBar` deletion

- **Creates:** `apps/web/src/components/layout/PhoneHeaderRow.tsx`
- **Modifies:** `apps/web/src/components/layout/AppShell.tsx`,
  `apps/web/src/components/layout/SideNav.tsx`,
  `apps/web/src/components/layout/BottomTabBar.tsx`,
  `apps/web/src/components/layout/index.ts`,
  `apps/web/src/lib/i18n/catalogs/ui.de.ts`, `ui.en.ts` (**deletions only** — the second half of
  T6.1's decision); **deletes** `apps/web/src/components/layout/TopBar.tsx`
  (sole owner of all seven)
- **Depends on:** T1.3, T6.1, T7.1
- **Done when:**
  - **R1 implemented.** `SideNav` is `w-sidebar` (236px, was `w-64`); `AppShell`'s inner column is
    `lg:pl-sidebar` (was `lg:pl-64`); `<main>` is
    `mx-auto flex w-full max-w-content flex-1 flex-col px-gutter pt-4 pb-tabbar lg:pt-8 lg:[--gutter:2rem]`
    — only `max-w-5xl` → `max-w-content` changes. **`w-sidebar` and `lg:pl-sidebar` must always
    move together**: a mismatch either overlaps the content or leaves a strip of `--bg` beside the
    sidebar. **No `PageColumn` export** (R33b) — form and prose screens carry their own
    `mx-auto w-full max-w-3xl`, which phase 9 applies.
  - `<TopBar />` is gone from `AppShell` and `pt-safe` moves onto the inner column in its place
    (with `lg:pt-0`), or a home-screen install renders the first banner under the status bar.
    `TopBar.tsx` is deleted and its export removed from `layout/index.ts`.
  - `PhoneHeaderRow` is the replacement: `flex items-center gap-2.5 lg:hidden`, a
    `GroupSwitcher variant="chip"` and an optional `action` slot. It **scrolls with the page** —
    no `sticky`, no `pt-safe` (that would double the inset).
  - `SideNav` is transcribed from the artboards: `bg-bg-sunken` ground with a `border-r
    border-surface-2`, the logo + `Rezepte` wordmark in `font-display text-display-md font-medium`,
    `GroupSwitcher variant="block"`, primary nav at `rounded-control text-sm` with cheap counts
    (`Recipes {group.recipeCount}` from `useActiveGroup()`; `Shopping {sum of itemCount}` from the
    already-cached `shoppingListsQuery` — **render nothing, never `0`, while it is `undefined`**),
    a honey `Badge variant="accent" size="sm"` "New" pill on Plan, an `.eyebrow text-fg-faint`
    "Organise" label above `SECONDARY_NAV_ITEMS` at `text-control`, and a footer user row
    (`Avatar shape="circle" tone="accent"`, name, e-mail) that **links to `/settings`**.
    The sidebar's "Neues Rezept" button and its logout icon are removed (R34).
  - `BottomTabBar`: active pill `h-7 w-11` (44×28, was `w-10`), ground `bg-bg-sunken` with
    `border-surface-2`, **`backdrop-blur-md` dropped** (it only mattered for a translucent ground),
    active label + icon `text-brand-soft-fg`, inactive `text-fg-subtle`. Everything else is
    unchanged and must stay: `fixed inset-x-0 bottom-0 z-30`, `pb-safe`, **`px-safe` on the
    `<ul>`**, `lg:hidden`, `h-tabbar` per tab, `flex-1` + `truncate` labels, `t(item.labelKey)` at
    render time. `--tabbar-h` stays `3.75rem` — the artboard's 84px includes the 22px home-indicator
    inset that `pb-safe` supplies at runtime; do not hard-code 84px and do not add the inset twice.
  - `PageHeader` is **kept** (its only consumer is `AccountSettingsPage`) and restyled: `h1` →
    `font-display`, description → `text-fg-muted text-sm`.
  - **The three `ui` keys R29 deletes are deleted HERE**, in the same commit as their last call
    site: `ui.topbar.searchRecipes` and `ui.topbar.newRecipe` (both only in the deleted `TopBar`)
    and `ui.sidenav.logout` (only on the removed sidebar logout `IconButton`). If `tsc` complains
    about any of the three, a call site was missed — restore the key rather than editing the
    component. `ui.nav.import` is **kept**; T8.7's sheet reuses it.
  - **`data-app-shell` is now actually applied, and that is a bug fix the redesign has to make.**
    `apps/web/src/features/recipes/print.css` has always hidden `header[data-app-shell]`,
    `nav[data-app-shell]` and `aside[data-app-shell]` — and `grep -rn 'data-app-shell' apps/web/src`
    returns **nothing but that stylesheet**: no element has ever carried the attribute, so every
    print of a recipe has always included the app chrome. The redesign makes that far worse (a
    236px `--bg-sunken` sidebar on every printed page), so: put `data-app-shell` on `SideNav`'s
    `<nav>`, on `BottomTabBar`'s `<nav>` and on `PhoneHeaderRow`'s root. `TopBar` was the
    `header[data-app-shell]` that never existed; the selector stays in `print.css` (T8.4 owns that
    file) because a future header would want it.
  - **Sidebar counts are state-coloured**, per `1a` vs `1c`: the count on the ACTIVE row is
    `text-brand-hover`, on an inactive row `text-fg-subtle`. Both are `tabular-nums`, and while a
    count is `undefined` the element renders **nothing** — never `0`.
  - **`components/layout/Logo.tsx` is reused unchanged**: its SVG paths are already byte-for-byte
    the artboard's mark (verified path by path), and `public/favicon.svg` + `public/icons/*` keep
    the pre-redesign brand `#c2532c` because R27 leaves the palette alone. Do not redraw the mark
    and do not regenerate the icon set.
- **Tests:** none automated. The headless assertions in §6 cover it.
- **Gotchas:** *`px-gutter` + `lg:[--gutter:2rem]`, never a second padding utility* — the
  hand-written utilities are emitted after Tailwind's, so `lg:px-8` would lose (a media query adds
  no specificity) and desktop would silently keep the phone gutter. *`.px-safe` survives in exactly
  one shell place* — `BottomTabBar`'s `<ul>`, where the inset **is** the whole padding. *`<main>`
  stays `flex-1 flex flex-col`* — it is the flex chain that lets a page root say `flex-1` and push
  a sticky bottom bar to the tab bar; `min-h-full` is not equivalent (measured: root stuck at 493px
  inside a 695px main). *`pb-tabbar` stays on `<main>` and nothing else.* *`bottom-tabbar`, never
  `bottom-0`, for any bar inside a page.* The four banners keep their order
  (Offline → UnverifiedEmail → Update) and `UpdateBanner`'s no-dismiss / no-fallback-timer policy
  is **untouched** — placement and tokens only. `--spacing-topbar` stays defined; grep before
  removing it (`Toast`/`Dialog` may reference it).

#### T7.3 — `/plan`: data layer

- **Creates:** `apps/web/src/features/plan/lib/queries.ts`, `apps/web/src/features/plan/index.ts`
- **Depends on:** T5.1, T5.2, T6.1
- **`apps/web/src/features/plan/index.ts` is this task's file and stays this task's file.** T7.4
  and T8.3 add components under `features/plan/`; each **exports from its own module path** and
  neither edits the barrel, exactly as `features/recipes/index.ts` deliberately does not re-export
  route screens. If a barrel entry is genuinely wanted later it is one line, and it belongs to
  T7.3's owner.
- **Done when:** `usePlanWeek(groupId, weekStart)` calls `planQuery` with the two bounds from
  `planWeek(weekStart)[0]` and `[6]`; four mutations — `usePlanEntryCreate`, `usePlanEntryUpdate`
  (servings and/or `plannedOn`), `usePlanEntryDelete`, `usePlanEntryCooked` — are **ordinary
  online mutations**: inline in `useMutation`, **no `setMutationDefaults`, no outbox, no
  `mutationId`**, each invalidating via `invalidateAfterPlanMutation`. `usePlanEntryCooked` posts
  to `…/recipes/:recipeId/cooked` with `{ mealPlanEntryId }` and **reports failure with a toast**
  (it is not fire-and-forget — unlike `POST /api/cards/:id/used`, where the write must never stop
  the barcode from being on screen). A **fifth** mutation, `usePlanEntryCookedUndo`, calls
  `DELETE …/recipes/:recipeId/cooked` on the same terms — R18 ships the endpoint and T8.4/T7.4
  place the affordance, so the hook has to exist here or the undo has no caller.
- **Tests:** none.
- **Gotchas:** ***`useCanMutate()` IS the right hook on `/plan`*** — the cards-screen rule, not the
  shopping rule: planner writes are online-only, so `useCanMutate()`'s false-when-offline is
  exactly right here. This sits two files away from the opposite rule and must not be unified.
  *A queued offline mutation the server will 403 must never enter the outbox* — which is the other
  half of why none of these four is registered.

#### T7.4 — `/plan`: the screen (EXTRAPOLATED — no artboard)

- **Creates:** `apps/web/src/features/plan/PlanPage.tsx`,
  `apps/web/src/features/plan/components/PlanDayCard.tsx`,
  `apps/web/src/features/plan/components/PlanWeekNav.tsx`,
  `apps/web/src/features/plan/components/PlanRecipePicker.tsx`,
  `apps/web/src/features/plan/components/PlanServingsDialog.tsx`
- **Depends on:** T7.3, **T7.5** (`RecipeEditorialRow`, `CourseEyebrow`, the date formatters)
- **Done when:** `PlanPage` is the **default export**; the page root is `flex flex-col gap-4` and
  **nothing else**; the week comes from the `week` search param run through `startOfPlanWeek()`
  with a `todayPlanDate()` fallback; desktop is a seven-column grid
  **`grid-cols-[repeat(7,minmax(0,1fr))]` — never `grid-cols-7`** (seven never-truncating titles
  would size to their min-content width and overflow the 1204px column); phone is a **vertical
  list of seven day rows**, not a horizontal strip (R35); `PlanDayCard` renders the three drawn
  states (planned / empty / today) with the exact tokens from A05 §10.7, an `.eyebrow` `MON 1`
  label, an **unclamped** `font-display text-display-xs` title, a meta line the CLIENT assembles
  from `totalMinutes` + `cookedAt` (a `<Check />` icon, never `✓`), a `thumbnailUrl` thumb, and
  **one `ActionMenu`** per planned card; a day holding more than one entry renders the first plus a
  `+N` affordance (R36); `PlanServingsDialog` uses `ServingsScaler`; `PlanRecipePicker` reuses
  `RecipeEditorialRow` with an `onSelect` seam (**T7.5** provides it — that is why the row is a
  phase-7 task). A planned card's `ActionMenu` carries `plan.entry.markCooked` **and its undo**:
  after a successful cook the item becomes `Rückgängig` for `COOK_UNDO_WINDOW_MS`, calling
  `usePlanEntryCookedUndo` (T7.3).
- **States (R44), all five, none optional:**
  - **Empty week** — every day card renders its own drawn *empty* state (a whole `<button>` reading
    `plan.day.empty`), and **above** the grid `EmptyState` renders `plan.empty.title` +
    `plan.empty.description` **only when the week holds zero entries**. Seven `Planen` cards with
    no explanation is the day-one experience of every install.
  - **Loading** — `SkeletonList variant="daycards"` (T1.4), matching the branch: seven cards at
    `lg`, seven rows below (R35's vertical list, so the phone skeleton is rows, not a strip).
  - **Error** — `ErrorState` with a retry, **replacing** the grid rather than sitting above it.
  - **Offline** — `planQuery` is `offlineFirst` and `"plan"` is persisted (T5.2), so a restored week
    renders; every write affordance is disabled with `plan.offlineHint` as its `title`. Week
    navigation still works over the persisted cache and shows the empty state for a week that was
    never fetched.
  - **Read-only (unconfirmed address)** — `useCanMutate()` is false, so **every** day card's only
    action disappears. The screen must then render one explanation above the grid (the shell's
    `UnverifiedEmailBanner` is generic; a screen whose entire interaction is gated has to say so
    itself), never seven silent cards.
- **Tests:** none (the screen has no unit-testable logic; the week maths is T2.1's).
- **Gotchas:** *the whole screen is extrapolated* — the PR must say so and **attach 390px and
  1440px screenshots**, because it is the one screen no reviewer can compare against a reference.
  *`minmax(0,1fr)` never a bare `1fr`; `min-w-0` on items.* *A LIST renders `thumbnailUrl`, never
  `imageUrl`* — this screen asks for seven at once. *`block` beats `line-clamp-N`* — day-card
  titles carry no clamp at all. *A header gets ONE overflow trigger* — one `ActionMenu` per card,
  relying on its close-then-`requestAnimationFrame` behaviour. **No sticky bottom bar on `/plan`
  in this pass** (R37). *`PhoneHeaderRow` is NOT rendered here* — `/plan` has no per-screen primary
  action in any artboard.

#### T7.5 — The editorial row, the course eyebrow, and the four date formatters

- **Creates:** `apps/web/src/features/recipes/components/RecipeEditorialRow.tsx`,
  `apps/web/src/features/recipes/components/CourseEyebrow.tsx`
- **Modifies:** `apps/web/src/lib/format.ts` (sole owner)
- **Depends on:** T1.4, T1.7, T2.2 (`recipeEyebrow`), T6.2
- **Why it is phase 7 and not phase 8.** Four later tasks consume the row — T7.4's
  `PlanRecipePicker`, T8.1's `Alle Rezepte` list, T8.3's shelf and T9.2's `CollectionDetailPage` —
  and one of them is in phase 7. Phase 8 depends on phase 7, so a phase-7 task may not import a
  phase-8 file; the first draft had T7.4 depending on T8.1, and phase 7 could not compile.
- **Done when:**
  - `RecipeEditorialRow` is the **one** row every consumer renders, differing only in title step
    (`text-display-md` desktop / `text-display-sm` phone) and whether the description shows. Its
    `<h3>` carries **no `line-clamp`, no `truncate`, no `overflow-hidden` and no fixed height** —
    only `text-pretty`. The 84px square is `thumbnailUrl()` with `loading="lazy" decoding="async"`,
    a `bg-surface-2` ground and the existing `UtensilsCrossed` fallback.
  - It takes an optional `onSelect` **and** an `as` seam, so `/plan`'s picker (a button that
    selects) and the list pages (an `<a>` that navigates) share one implementation rather than
    forking a second row. `onSelect` and `as="button"` move together; the default is a link.
  - **`useIsWideViewport()`'s threshold is `SM_QUERY = "(min-width: 40rem)"`** (verified in
    `apps/web/src/lib/viewport.ts`) — 640px, **not** `lg`. State it in the row's header comment:
    in the 640–1024px band the desktop row renders with its description and **no sidebar**, which
    is intended and is what that whole band looks like.
  - `CourseEyebrow` renders `<span class="eyebrow text-accent-strong">` from `recipeEyebrow(tags)`
    and **returns `null` when there is no `kind:'course'` tag** — no element, not an empty one.
    **A recipe with no course therefore has a two-line stack, not three**, so the row is
    `grid-cols-[84px_minmax(0,1fr)]` with `items-start` and a plain flex text column: the 84px
    square must not be vertically centred against a variable-height stack, or the list looks ragged
    for a library that has not adopted courses — which is every install on day one (R41).
  - `apps/web/src/lib/format.ts` gains the **four** formatters `i18n-keys.md` §3.1/§3.2 specifies,
    all through the existing memoised `formatters()` builder and never constructed per row:
    `formatRelativeShort` (`Intl.RelativeTimeFormat` `{ numeric:"auto", style:"short" }` —
    **`"short"`, never `"narrow"`**, which renders German minutes as `vor 10 m`),
    `formatWeekdayShort`, `formatDayOfMonth` and `formatShortWeekdayDate`. Each reads the ambient
    locale at CALL time, exactly like `formatDuration(minutes, locale)`, and each keeps
    `formatRelative`'s `< 45 s → ui.time.justNow` and nullish/`NaN` → `ui.common.dash` guards.
    **This overrules §3's earlier ownership note** (which said `formatWeekdayShort` /
    `formatDayOfMonth` would not be added and `PlanDayCard` would format its own eyebrow): there
    are now four consumers — `PlanDayCard`, `WeekStrip`, `BoughtHistoryPanel` and `WeekPlanPanel`'s
    row meta — and an un-memoised per-row `Intl` construction in a seven-card grid is exactly the
    cost the builder exists to avoid.
- **Tests:** none new (no component tests exist in this tree). `packages/shared/test/tags.test.ts`
  (T2.2) covers `recipeEyebrow`'s branches.
- **Gotchas:** *`block` beats `line-clamp-N`* — the fix here is **removal**, not reordering.
  *A LIST never renders `imageUrl`.* *The course eyebrow is CONTENT* — never `t()`, never keyed,
  never locale-dependent. *A label map frozen at import time cannot follow a locale switch* — the
  formatters resolve the locale per call and must not cache a rendered string.

### Phase 8 — The designed screens

#### T8.1 — Recipe library: the list page (screens A + B)

- **Creates:** nothing (the editorial row and the course eyebrow are **T7.5**'s)
- **Modifies:** `apps/web/src/features/recipes/RecipeListPage.tsx`,
  `apps/web/src/features/recipes/lib/url-filters.ts`,
  `apps/web/src/features/recipes/lib/format.ts`,
  **`apps/web/src/features/recipes/index.ts`**; **deletes**
  `apps/web/src/features/recipes/components/RecipeCard.tsx` and
  `apps/web/src/features/recipes/components/RecipeRow.tsx` (sole owner of all six)
- **Depends on:** T1.4, T1.7, T6.2, T7.2, **T7.5**
- **`features/recipes/index.ts` is this task's file, and forgetting it is a red `tsc`.** The barrel
  re-exports all three components phase 8 deletes:
  `export { RecipeCard, type RecipeCardProps }`, `export { RecipeRow, type RecipeRowProps }` and
  `export { RecipeFilters, countActiveFilters }`. T8.1 removes the first two and adds
  `RecipeEditorialRow` + `CourseEyebrow` (and `RecipeStatRow` once T8.4 lands — T8.4 adds its own
  line, the one sanctioned second write, in the same style as the catalogs). **T8.2 then removes
  the `RecipeFilters` export and re-adds `countActiveFilters` from `RecipeFilterRail`** — sequenced,
  one phase apart, the same shape as the `Skeleton.tsx` hand-off. The barrel's header comment
  ("THE ROUTE SCREENS ARE DELIBERATELY NOT RE-EXPORTED HERE") stays verbatim: a static re-export of
  a lazy route screen pulls it into the main chunk and silently kills code splitting.
- **Done when:**
  - `RecipeEditorialRow` is the **one** row both breakpoints render, differing only in title step
    (`text-display-md` desktop / `text-display-sm` phone) and whether the description shows. It
    takes an optional `onSelect`/`as` seam so `/plan`'s picker and `CollectionDetailPage` can reuse
    it instead of forking a second row. Its `<h3>` carries **no `line-clamp`, no `truncate`, no
    `overflow-hidden` and no fixed height** — only `text-pretty`.
  - `CourseEyebrow` renders `<span class="eyebrow text-accent-strong">` from
    `recipeEyebrow(tags)` and **returns `null` when there is no `kind:'course'` tag** — no element,
    not an empty one.
  - `RecipeListPage` keeps `useUrlRecipeFilters("/")`, `useRecipeList`, `flattenPages`,
    `totalCount`, `useTags`, `useCollections` and `useIsWideViewport()`; the markup below the
    header is new per A04 §3/§4. It renders `PhoneHeaderRow` with the `+` sheet as its `action`,
    the `h1` + group summary, the search field (`Input size="lg"`, `text-base`), the `Filter`
    affordance, `WeekStrip` (T8.3), `RecentlyCookedShelf` (T8.3), the filter rail at `lg`
    (T8.2), and `Alle Rezepte` as `RecipeEditorialRow`s.
    `SkeletonList variant="editorial"` replaces the `wide ? "cards" : "rows"` branch.
  - `lib/url-filters.ts`: `SORTS` gains `"lastCooked"`. `features/recipes/lib/format.ts`: the sort
    label **key** map gains `lastCooked` (a key map, never a literal map — a map frozen at import
    time cannot follow a locale switch). **`apps/web/src/lib/format.ts` is NOT this task's file** —
    T7.5 owns it and added the four `Intl` formatters there, because `/plan` in phase 7 consumes
    three of them. **No new URL param** — `RECIPE_FILTER_PARAMS` is untouched (R25/R26).
  - `RecipeCard.tsx` and `RecipeRow.tsx` are deleted; grep first — `CollectionDetailPage` renders
    its own markup and is phase 9's problem.
- **States (R44):**
  - **A group with no recipes** — the existing `EmptyState` survives, and the header, the search
    field, the `Filter` affordance, `WeekStrip` and `RecentlyCookedShelf` **all still render**
    (they are not about the recipe list: a new group's first useful action may well be planning or
    importing). The filter rail renders with empty sections rather than disappearing.
  - **A filtered search with no hits** — a distinct empty state from "no recipes at all", offering
    "Filter zurücksetzen"; `countActiveFilters` already tells the two apart.
  - **Loading** — `SkeletonList variant="editorial"` replaces the `wide ? "cards" : "rows"` branch,
    and the variant must match the JS branch or the list visibly jumps when data lands.
  - **Error / offline** — the existing `ErrorState` and the persisted cache behaviour are unchanged;
    the create affordances are **hidden** (not disabled) when `useEmailVerificationBlock()` is set,
    because an `<a>` cannot carry a disabled state or a tooltip.
- **Tests:** none new (no component tests exist in this tree). `lib/validation.test.ts` must still
  pass.
- **Gotchas:** ***the `sm` branch stays in JS*** (`useIsWideViewport()`), because a `display:none`
  `<img>` is still fetched and rendering both trees would load 24 thumbnails twice; the branch's
  reason changes (desktop carries a description, phone stays compact) but the hazard does not
  (R16). *`SkeletonList`'s `variant` must match the branch or the list visibly jumps.* *A LIST
  never renders `imageUrl`* — the 84px squares are `thumbnailUrl()`, with `loading="lazy"
  decoding="async"`, a `bg-surface-2` ground and the existing `UtensilsCrossed` fallback. *`block`
  beats `line-clamp-N`* — the fix here is **removal**, not reordering. *A page root re-applies
  none of `mx-auto max-w-* px-gutter pt-4 pb-tabbar`* — grep `pb-tabbar` before adding one. *The
  course eyebrow is CONTENT* — never `t()`. *`useEmailVerificationBlock()` gates create, and the
  create affordances are **hidden**, not disabled*, because an `<a>` cannot carry a disabled state
  or a tooltip.

#### T8.2 — Recipe library: the filter rail and sheet

- **Creates:** `apps/web/src/features/recipes/components/RecipeFilterRail.tsx`,
  `apps/web/src/features/recipes/components/RecipeFilterSheet.tsx`
- **Modifies:** `apps/web/src/features/recipes/index.ts` (**the sequenced hand-off from T8.1** —
  drop the `RecipeFilters` export, re-add `countActiveFilters` from `RecipeFilterRail`);
  **deletes** `apps/web/src/features/recipes/components/RecipeFilters.tsx` (sole owner)
- **Depends on:** T8.1
- **Done when:** the rail is the desktop-only left column at 220px `[RECON]`, splitting
  **Gänge** (courses, `kind === "course"`, **single-select**, with per-course `recipeCount`) from
  **Tags** (free tags, multi-select) and holding a `Mehr Filter` disclosure for
  Sammlung / Schwierigkeit / Zeit; the sheet renders the same controls inside a `Dialog` for
  phones. Both write into the **existing `tags` URL param** (R25) — a course *is* a tag under D5
  and "must carry all" is already the right semantics. Course is single-select **because the API
  forces it**: `tagIds` is AND-combined, so two selected courses return zero rows every time —
  say that in a comment. `countActiveFilters` is preserved and re-exported from the rail module **and from the feature
  barrel** (T8.1's hand-off). **`recipes.filters.advancedToggle` (`"Erweiterte Suche"`) may now be
  orphaned** — the desktop rail is permanent and the phone uses a `Filter` sheet trigger, so if
  `grep` finds no call site after this task, **delete the key in this same commit** and say so in
  the PR; a key with no call site is copy nobody reviews again and `tsc` cannot flag it
  (`i18n-keys.md` §15 G3). `Mehr Filter` is the new key for the inner disclosure.
  **Both** the rail and the sheet carry the two management links
  (`recipes.filters.manageCollections` → `/collections`, `recipes.filters.manageTags` → `/tags`) —
  the sheet's copy is the only phone route to either screen, and it is what finally makes
  `CLAUDE.md`'s existing claim true (R30).
- **Tests:** none.
- **Gotchas:** ***a `<fieldset>` needs `min-w-0` EXPLICITLY*** — it carries the browser's own
  `min-inline-size: min-content` and ignores the rule you would apply to any other grid/flex item,
  which is exactly how the old tag row grew its fieldset to 580px on a 390px phone and made the
  page scroll sideways. *`autoFocus` only acts on MOUNT* — the sheet is a fresh `Dialog` mount so
  `autoFocus` is fine there. The rail's **heading** is interface; the course names in it are
  CONTENT. Per-course counts are group-wide and are **not** recomputed per filter state (that
  would be a `count(*)` per course per keystroke against a serialised write lane).

#### T8.3 — Library week strip + recently-cooked shelf

- **Creates:** `apps/web/src/features/plan/components/WeekStrip.tsx`,
  `apps/web/src/features/recipes/components/RecentlyCookedShelf.tsx`
- **Depends on:** T7.3 (queries), **T7.4** (`PlanDayCard`, which `WeekStrip` reuses), T7.5
  (`formatRelativeShort`), T8.1 (the page that mounts them)
- **Neither file edits `features/plan/index.ts`** — T7.3 owns that barrel and these components are
  imported by their own module path (`@/features/plan/components/WeekStrip`).
- **Done when:** `WeekStrip` renders 7 day cards on desktop and 4 on a phone
  (`week.slice(3,7)`, as the artboard does), reusing `PlanDayCard`'s three states, with a
  `Plan →` link (an `ArrowRight` icon, never `→`) to `/plan`; it consumes the raw fields
  (`plannedOn`, `state`, `recipe`, `totalMinutes`, `cookedAt`) and composes the meta sentence
  itself — the API sends no pre-composed `meta`. `RecentlyCookedShelf` is a horizontal scroller
  over `recipesQuery(groupId, { sort: "lastCooked", hasCooked: true, limit: 5 })`, each card
  showing `thumbnailUrl`, the serif title and `formatRelative(lastCookedAt, locale)`, and it sits
  **above** `Alle Rezepte` `[RECON: nothing may sit below an infinite list]`.
- **States (R44) — and these two components are EMPTY ON DAY ONE for every existing install,
  because R41 ships no `tags.kind` backfill and nothing back-dates `last_cooked_at`:**
  - **`RecentlyCookedShelf` with zero cooked recipes renders NOTHING AT ALL — heading included.**
    Same rule as `BoughtSection` (T8.6), and for the same reason: a heading over an empty
    horizontal scroller reads as a broken carousel, and "you have not cooked anything yet" is not
    a sentence a recipe app needs to say on its home screen. No key, on purpose.
  - **`RecentlyCookedShelf` while loading** renders nothing either (it is a secondary shelf over a
    5-item query); it must not reserve height, or the list below it jumps.
  - **`WeekStrip` with nothing planned renders the seven/four drawn *empty* day cards**, because
    the empty card is a drawn state and a tappable one — that is the affordance that gets a first
    entry into the plan. **On a phone `week.slice(3,7)` then shows four identical `Planen` cards**;
    that is accepted (it is four tap targets for the next four days, and the `plan.strip.link`
    beside the heading names the destination), and it is recorded here as a decision rather than an
    accident.
  - **`WeekStrip` while loading** uses `SkeletonList variant="daycards"` (T1.4) so the strip does
    not pop in after the rows around it have settled.
  - **`WeekStrip` offline** renders from the persisted `"plan"` segment; its day cards are
    read-only (tapping an empty card navigates to `/plan`, it does not open a picker inline), so
    there is no offline write path to gate.
- **Tests:** none.
- **Gotchas:** *the strip must not do UTC arithmetic* — every date comes from `@toon/shared`'s
  calendar module, which reads the **local** calendar. *`"plan"` must be on the persist allow-list*
  (T5.2 did it) or the strip is blank on a cold offline start while every recipe row around it
  renders, which reads as a bug rather than as "no signal". *A LIST renders `thumbnailUrl`.*

#### T8.4 — Recipe detail (screens C + D)

- **Creates:** `apps/web/src/features/recipes/components/RecipeStatRow.tsx`,
  `apps/web/src/features/recipes/components/RecipeHeroMobile.tsx`,
  `apps/web/src/features/recipes/components/RecipeDetailBottomBar.tsx`
- **Modifies:** `apps/web/src/features/recipes/RecipeDetailPage.tsx`,
  `apps/web/src/features/recipes/components/IngredientList.tsx`,
  `apps/web/src/features/recipes/components/StepList.tsx`,
  **`apps/web/src/features/recipes/print.css`**,
  `apps/web/src/features/recipes/index.ts` (**one line only**: the `RecipeStatRow` export, the
  sanctioned second write to T8.1's barrel) (sole owner of all eight)
- **Depends on:** T1.7, T1.9 (`ActionMenu`, `Toast`'s action slot), T6.2, T7.2, T7.5
- **Done when:** the desktop branch is A04 §5 (breadcrumb, `minmax(0,1fr) 420px` hero row,
  `text-display-4xl` `h1`, the bordered stat row, `grid-cols-[400px_minmax(0,1fr)]` ingredients +
  method columns, three **labelled** header buttons plus one `⋯`) and the phone branch is A04 §6
  (a 300px `bleed-gutter` hero with scrim, two 38px `IconButton shape="circle" variant="scrim"`
  controls, `text-display-xl` `h1`, the 4-up stat grid, a `Tabs variant="segmented"` control, and
  the sticky bottom bar). `RecipeStatRow` **composes `Stat`/`StatRow` from `components/ui` and
  contains no independent markup** (R7) — it owns only the recipe-specific mapping, including
  `Zuletzt gekocht` → `formatRelative(lastCookedAt, locale)` with `tone="success"`. The
  hand-rolled `<dt>/<dd>` stat block at the old `RecipeDetailPage.tsx:340` is gone.
  `ServingsScaler` is used with `size="sm"` (desktop) / `size="md"` (phone) and is **not**
  restyled here (T1.8 owns its frame). Both `<h1>`s carry **no clamp**. Plus these eight, each of
  which the first draft left unplaced:

  1. **The tag + attribution line under the desktop `h1`.** `1a` draws
     `Deutsch · Gemüse · Rind · Schmoren · Sommer · raffiniert oder preiswert` in `text-fg-subtle`
     followed by `· by Eric Stampa, 2 hours ago` in the fainter `--toon-sand-600` tier (so:
     `text-fg-faint`, R11's accessible value). Both halves are already on the wire —
     `RecipeDetail.author` is a `PublicUser` and `createdAt` an ISO instant — and the relative half
     is `formatRelative(createdAt, locale)` (T7.5). The tag names are CONTENT; only the
     `by {name}, {relative}` frame is a key.
  2. **The ingredient quantity is two-coloured, and it is the only conditional styling in the
     list.** `renderVals.ingredients[].qtyColor` is `#eab54f` (`--accent`, i.e. `text-accent`) for
     a real amount and `#9c8b79` (`--fg-subtle`) for `n. B.` **and for a blank** ("Salz und
     Pfeffer"). So: `quantity != null ? "text-accent" : "text-fg-subtle"`, with the existing schema
     rule intact — `quantity: null` means "no amount given" and must **never** render as `0`. On
     both `1a` and `1f`.
  3. **The phone branch keeps everything `1f` does not draw.** `1f` shows no description, no tag
     line, no source attribution and no rating/difficulty/notes, and `RecipeDetailPage` renders all
     of them today. They are **placed, not dropped**: the description goes under the phone stat
     grid; rating, difficulty, notes and the `sourceUrl` attribution go at the foot of the
     **Ingredients** panel. The `sourceUrl` attribution in particular is a licence-adjacent
     obligation on an imported recipe and may not vanish on a phone — and it still goes through
     `safeHttpUrl()` so a legacy row cannot produce a live `javascript:` link.
  4. **`Add all 15 to Einkaufsliste` names its target list, exactly like `WeekPlanPanel`.** Reuse
     **R9's** resolution (`storageKeys.lastShoppingListId` → the alphabetically first cached list →
     an empty state with a "Liste anlegen" action) for the button's label on both breakpoints, and
     keep `AddRecipeToListDialog` as the "choose a different list / choose ingredients" path.
     R9 only ruled the overview panel; the same ambiguity is on this screen's primary action.
  5. **The `Gekocht` button carries its undo.** R18 ships `DELETE …/recipes/:recipeId/cooked` and
     nothing placed it. After a successful POST the button becomes `Rückgängig` for
     `COOK_UNDO_WINDOW_MS` (10 min), **and** the success toast carries the same action through
     `Toast`'s new action slot (T1.9). Both call the same mutation; the button is the affordance
     that survives the toast timing out.
  6. **Both detail panels stay in the DOM and are toggled with `hidden`, not rendered
     conditionally.** The phone branch puts Method behind a `Tabs variant="segmented"` control, so
     a conditional render means **printing a recipe from a phone prints the ingredients only**.
     Toggle visibility with `el.hidden` / the `hidden` attribute (the shell's reset already carries
     `[hidden]{display:none!important}`) and let `print.css` reveal both.
  7. **`print.css` is updated in this task, and it has never worked.** `data-app-shell` is applied
     for the first time by T7.2. Here: mark the phone hero's scrim controls, the segmented control
     and `RecipeDetailBottomBar` with `data-print="hide"` (the stylesheet already hides that
     attribute); add a rule that clears `[hidden]` on the two detail panels inside `.recipe-print`
     so both print; and re-target the `.recipe-print h2` / `li` / `button` rules, which are written
     against the markup this task replaces. **Verify by printing to PDF from a real browser at
     390px and at 1440px** — a print stylesheet is invisible to all five gates, which is exactly how
     this one stayed dead.
  8. **The mock's own numbers are inconsistent and must not be transcribed.** `1a`'s Ingredients
     header reads `15` and its button `Add all 15`, while `renderVals.ingredients` holds **12**
     rows; Method reads `6 steps` over **4** entries. Both counts come from
     `recipe.ingredients.length` / `recipe.steps.length`. Hard-coding 15 or 6 is the failure this
     line exists to prevent.
- **States (R44):**
  - **A recipe with no image** — `1f`'s 300px hero and `1a`'s hero both draw a scrim gradient with
    the `h1` over it. With no image the scrim sits on nothing: render the existing image-less
    fallback ground (`bg-surface-2` + `UtensilsCrossed`) **and keep the scrim**, so the overlaid
    title keeps its contrast; do **not** collapse the hero to zero height, or the two circular
    scrim `IconButton`s lose their surface.
  - **A recipe with no course** — `CourseEyebrow` returns `null` (T7.5) and the breadcrumb/eyebrow
    row is one line shorter. Nothing else moves.
  - **Loading / error / not found** — unchanged from today's screen; only the tokens move.
  - **Read-only** — the two gates stay split per button (R38), and the phone bottom bar keeps
    `Kochmodus` (a read) enabled in every state.
- **Tests:** none.
- **Gotchas:** ***two different gates on one screen, and they must not be unified***: `Zur
  Einkaufsliste` keeps `useEmailVerificationBlock()` (it queues offline — the existing comment
  says why it is deliberately not `useCanMutate()`), while `Gekocht` and `Für einen Tag planen`
  take `useCanMutate()` because they are online-only (R38). *A header gets ONE overflow trigger* —
  the three labelled desktop buttons at 1140px above the title are **not** the trap the gotcha
  describes (five icon buttons beside a 390px `h1`); the `⋯` is `ActionMenu`, which closes before
  acting and defers one `requestAnimationFrame` because it is a portal outside `.recipe-print`.
  *The two detail heroes are the only `mediaUrl(imageUrl)` images in phases 7–9.* *A bottom action
  bar needs `.bottom-tabbar`, never `bottom-0`* (`BottomTabBar` is `z-30` and painted after
  `<main>`), **plus an unbroken flex chain and a `flex-1` spacer** — `1f`'s bar is inset (no bleed,
  no `-mb-4`). *The 4-up stat grid is one of the two riskiest 390px layouts* — `(358 − 24)/4 =
  83.5px` per cell, `minmax(0,1fr)` + `min-w-0` from `StatRow`. *`useIsWideViewport()` picks one
  tree* — do not render both.

#### T8.5 — Shopping overview (screen E)

- **Creates:** `apps/web/src/features/shopping/components/ShoppingListPreviewCard.tsx`,
  `apps/web/src/features/shopping/components/WeekPlanPanel.tsx`,
  `apps/web/src/features/shopping/components/BoughtHistoryPanel.tsx`
- **Modifies:** `apps/web/src/features/shopping/ShoppingListsPage.tsx`,
  `apps/web/src/features/cards/components/CardsCard.tsx`,
  `apps/web/src/lib/i18n/catalogs/cards.de.ts`, `cards.en.ts` (**one key added, one deleted** —
  `i18n-keys.md` §10.1/§12 row 9 leaves the owner to whoever edits `CardsCard.tsx`, which is this
  task; say so in the PR) (sole owner of all seven)
- **Depends on:** T1.7, T1.9, T5.1, T6.3, T7.2, **T8.1** (§1 requires T8.1 before T8.5 — this
  screen reuses the `+N`/preview idioms it settles and the barrel it owns), T7.5
- **Done when:** the page renders `PhoneHeaderRow` with the existing "+ Neue Liste" as its action,
  the `h1` + a derived "vor {n} Min. synchronisiert" line (from the query's own `dataUpdatedAt`,
  R33), a three-column grid at `lg`
  (`grid-cols-[1.25fr_minmax(0,1fr)_minmax(0,1fr)]`) and a 2-up card grid on a phone;
  `ShoppingListPreviewCard` shows the icon, the list name in `font-display text-display-md`, the
  counts (`{itemCount} zu kaufen · {boughtCount} heute gekauft`), an `Öffnen →` link (`ArrowRight`
  icon), a `ProgressBar` from `components/ui` fed by `shoppingProgressPercent(itemCount,
  boughtCount)` and hidden when the denominator is 0, and the ≤8 `previewItems` with
  `+{itemCount - previewItems.length} weitere`; `WeekPlanPanel` consumes `from-plan` for the
  target list chosen from `storageKeys.lastShoppingListId` falling back to the alphabetically
  first (R21) and names the target in its button; `BoughtHistoryPanel` groups the bought history
  with `groupByLocalDay` and links `Alle` to `/shopping/history` (T8.8); `CardsCard` is **restyled,
  never deleted** — it is the only phone route to the wallet. Plus:
  - **A group with several lists needs a rule, and `1c` draws exactly one preview cell.** Locked
    decision 7 is "several named lists per group" and T3.2 seeds more than one, so a literal
    transcription of `grid-cols-[1.25fr_minmax(0,1fr)_minmax(0,1fr)]` has nowhere to put list two.
    **Ruling (R46): column 1 becomes a vertical stack of `ShoppingListPreviewCard`s**, ordered
    last-opened first (`storageKeys.lastShoppingListId`, R9) then alphabetically; columns 2 and 3
    are fixed (`WeekPlanPanel` + `CardsCard` / `BoughtHistoryPanel`). The phone 2-up card grid is
    unchanged — it already handles N lists.
  - **`WeekPlanPanel` renders NOTHING when `!isOnline`**, and its file comment says why: the
    `from-plan` diff is deliberately **not** persisted (R24), and an unpersisted query on a
    persisted screen is a spinner that never resolves. Rendering nothing is the honest answer for a
    panel whose only affordance is an online-only bulk add — the opposite call from
    `BoughtHistoryPanel`, whose segment **is** persisted. R24 now states the asymmetry explicitly
    so it is not read as an oversight.
  - **`BoughtHistoryPanel` takes a `compact` prop.** `1c` draws `4 items · Eric`
    (`shopping.history.dayMeta`), `1g` draws `Today · 4` (`shopping.history.dayMetaShort`). One
    component, two drawn variants, selected by the prop — not two components and not a re-keyed
    string.
  - **The `1c` subtitle carries the group name and the member count**:
    `Geteilt mit {group} · {members} · {synced}`, with `{members}` from the existing
    `groups.count.members` plural and `{synced}` from `formatRelativeShort(query.dataUpdatedAt)`
    (R33). Both facts are already on `GroupWithRole`; there is no new endpoint.
  - **`CardsCard` renders the drawn `Manage` link and the dashed `+ Karte hinzufügen` tile**
    (`1c` draws both, `1g` draws the compact `Cards` tile). The dashed tile is
    `Button variant="dashed"` (T1.4), the `+` is a lucide `Plus`, and both are gated with
    `useCanMutate()` — the opposite rule from its host screen, because card writes are ordinary
    online mutations while showing a barcode is a read that is never gated.
- **States (R44):**
  - **No lists at all** — the existing `EmptyState` with "Liste anlegen"; `WeekPlanPanel` renders
    `shopping.fromPlan.noList` (R9's third fallback) rather than a broken target, and
    `BoughtHistoryPanel` renders nothing.
  - **A list with `itemCount === 0`** — the `ProgressBar` is hidden (denominator 0) **and** the
    preview list and the `+N` line render nothing at all; the card is then icon + name + `Öffnen`.
  - **`BoughtHistoryPanel` with no history** — renders nothing, heading included, same rule as
    `BoughtSection`. No `shopping.history.empty` on this screen; that key belongs to T8.8's page,
    which is a destination the user chose to open.
  - **Loading** — `SkeletonList variant="tiles"` for the list cards; the two rail panels render
    nothing while pending rather than two spinners in a three-column grid.
  - **Offline** — the lists index is persisted, so cards render; list create/rename/delete are
    disabled on `isOnline`, `WeekPlanPanel` is absent, `BoughtHistoryPanel` renders its persisted
    page.
  - **Read-only** — `canManage = isOnline && useEmailVerificationBlock() === undefined`, with the
    address hint winning over the offline hint in the `title`.
- **Tests:** none.
- **Gotchas:** ***`useCanMutate()` must NOT be used for the list/plan actions on this screen*** —
  `canManage = isOnline && useEmailVerificationBlock() === undefined`, with the address hint
  winning over the offline hint. ***The `CardsCard` half uses `useCanMutate()`*** — the opposite
  rule, on the same screen, because card writes are ordinary online mutations; showing a barcode is
  a read and is never gated. *The bulk add reuses `POST …/shopping-lists/:listId/recipes` with
  `ingredientIds` **omitted** when everything is selected* — omitted means "the whole recipe",
  which is what keeps an older client and a queued offline replay working; **mint one `mutationId`
  per recipe, at call time**, or the ledger applies the first and silently swallows the rest.
  *A panel thumb is `thumbnailUrl()`.* The item-preview list is the **one** place a `sm:hidden` CSS
  branch is allowed instead of the JS branch, because it is text-only — say so in the file comment.

#### T8.6 — Shopping list detail (screen F)

- **Creates:** `apps/web/src/features/shopping/components/BoughtSection.tsx`,
  `apps/web/src/features/shopping/components/ListRecipesPanel.tsx`
- **Modifies:** `apps/web/src/features/shopping/ShoppingListDetailPage.tsx`,
  `apps/web/src/features/shopping/components/ShoppingItemCard.tsx`,
  `apps/web/src/features/shopping/components/ShoppingItemTile.tsx`,
  `apps/web/src/features/shopping/components/AddItemBar.tsx`,
  `apps/web/src/features/shopping/components/FrequentlyUsed.tsx`,
  `apps/web/src/features/shopping/components/ItemDetailDialog.tsx` (sole owner of all eight)
- **Depends on:** T1.7, T1.9, T5.3, T6.3, T7.5, T8.5
- **Done when:** desktop is A04 §8.1 (`grid-cols-[minmax(0,1fr)_340px]`, the add bar at the TOP,
  `SectionHeader` for `Zu kaufen` and `Heute gekauft`, `grid-cols-[64px_minmax(0,1fr)_auto]` rows
  with the qty in `text-accent-strong … tabular-nums` and a right-aligned `from` provenance label,
  and the right rail holding **three** panels — `FrequentlyUsed`, `ListRecipesPanel` **and
  `CardsCard`**) and phone is A04 §8.2 (a 2-up tile grid at 175px per tile, a collapsible bought
  section, and a `bleed-gutter-inset -mb-4` bottom bar holding the chip scroller and the add bar).
  **`1d`'s right rail draws THREE panels, and the third was dropped:** verified in the artboard at
  `design.dc.html:231–232`, a "Loyalty cards" heading with a Payback pill and a `Show barcode`
  label, and `SPEC.md §4.7` says outright that the wallet stays "as 'Loyalty cards' on the overview
  **and in the list rail**". So render `CardsCard` (or a compact rail variant of it) as the third
  `lg` rail panel, applying R38's split: **showing a barcode is a read and is never gated**, card
  writes use `useCanMutate()`. The `Show barcode` row's key is `cards.tile.showBarcode`
  (`"Barcode zeigen"` / `"Show barcode"`), added by T8.5, which owns the `cards` catalog pair.
  **This overrules `i18n-keys.md` §15 G2**, which recommended omitting the row: D2 says the design
  wins on visuals and this one is drawn. Specifically:
  - `SectionHeader` and `Chip` and `ProgressBar` come from `components/ui` — **`FrequentlyUsed`'s
    private chip implementation is deleted and it composes `Chip`** (R7), which has **no `×`**;
    hiding moves to long-press / right-click via `onContextMenu` and the existing `useLongPress`,
    calling `PATCH …/catalog/:entryId { hidden: true }`. The chip row is exactly
    `sortEntriesByFoldedName(selectMostBoughtEntries(catalog))` — **two calls, two names** (R8).
    `Alle {n} anzeigen` expands the ≤24 entries **already in the cache** (no fetch, works offline);
    a `Ausgeblendete anzeigen` toggle **on that sheet's own header row** — not a second sheet
    inside it — fetches `GET …/catalog?includeHidden=1` for the unhide affordance (R20, amended:
    a sheet inside a sheet is two focus traps and two scroll locks for one hint sentence, and
    `Dialog.tsx`'s `openDialogs` counter is not a nesting contract).
  - `AddItemBar` gains `placement?: "docked" | "inline"` and its `-mx-4` becomes
    `.bleed-gutter-inset`; `-mb-4` stays. **Its stale `min-h-full` comment is corrected** to
    `flex-1` while you are in the file.
  - `BoughtSection` renders nothing at all (header included) when there are no bought entries, and
    a `pending:` row is non-interactive at `opacity-70` reading `Du · gerade eben`.
  - **The right-aligned `from` provenance label comes from `ShoppingItem.sources`, and the rule for
    0, 2 and N sources has to be stated.** `sources` is already on the wire as a resolved
    `[{ id, title }]` array, and `sourceRecipeIds` deliberately keeps ids whose recipe was deleted
    ("provenance survives a deletion without a dangling link") — so the two arrays disagree by
    design. Render: **nothing** when `sources` is empty, even if `sourceRecipeIds` is not; the
    first source's title alone when there is one; `shopping.item.sourcesMore`
    (`aus {name} +{count}`) beyond one. Never render a raw id, and never render a count derived
    from `sourceRecipeIds`.
  - `ListRecipesPanel` renders the literal artboard from the new `recipes` payload —
    `{onList} von {total} Zutaten · {servings} Portionen` — with `Entfernen` calling
    `DELETE …/recipes/:recipeId` behind a confirm that states **both** counts (R10).
  - `ShoppingItemTile`'s name is `line-clamp-2` with a fixed `min-h` so the grid stays even
    (R39 — a deliberate deviation from the artboard's single line).
  - `Gekauftes leeren` is **not** destructive-red and its confirm says "aus dieser Ansicht
    entfernen" (R31). `Teilen` is `navigator.share` of the list as plain text through the existing
    `shareOrCopy` helper, with a clipboard fallback and no backend (R40). The sort control is a
    `<Select>` with three client-side options (R32).
  - **The mock's `1d` counts are the mock's, not a requirement**: its section headers show live
    counts from `items.length` / `bought.length` and must not be hard-coded, the same trap as
    T8.4's `15`/`6 steps`.
- **States (R44):**
  - **An empty list** — this is the COMMON case and the one the sticky-bar gotcha is measured
    against: the `EmptyState` renders, the add bar still sits flush on the tab bar via the unbroken
    flex chain plus the `flex-1` spacer, and the chip row still renders if the catalog has entries
    (adding a frequent item is the fastest way to fill an empty list).
  - **`BoughtSection` with no bought entries** — renders nothing at all, `SectionHeader` included.
    No `shopping.bought.empty` key exists, on purpose.
  - **`ListRecipesPanel` with no recipes on the list** — renders the heading **and** the dashed
    `Zutaten eines Rezepts hinzufügen` button, and nothing else. Unlike the bought section, its
    empty state is the drawn affordance that creates its content.
  - **`FrequentlyUsed` with an empty catalog** (a brand-new group) — renders nothing, chip row and
    hint line included; the hint explains an affordance that has no target.
  - **Loading** — `SkeletonList variant="tiles"` on a phone, `"rows"`-shaped bars at `lg`; the rail
    panels render nothing while pending.
  - **Offline** — the whole to-buy section stays fully interactive (this is the one offline-editable
    feature); `Gekauftes leeren`, catalog hide/unhide and `Entfernen` are disabled with `isOnline`
    in their `title` (R28).
  - **Read-only** — `useEmailVerificationBlock()` **directly**, never `useCanMutate()`, and the
    whole screen goes read-only for it: a queued mutation the server will 403 must never enter the
    outbox.
- **Tests:** none new (T5.3 owns the offline-cache tests).
- **Gotchas:** ***this screen takes `useEmailVerificationBlock()` DIRECTLY and must never use
  `useCanMutate()`*** — items are the offline-editable feature and `useCanMutate()` is false
  offline. `Gekauftes leeren`, catalog hide/unhide and `Entfernen` are additionally gated on
  `isOnline` and say so in their `title` (R28). *A sticky bottom bar needs `.bottom-tabbar` plus an
  unbroken flex chain and a `flex-1` spacer* — on an empty list (the common case) it otherwise
  floats ~200px above the tab bar. *`minmax(0,1fr)` never a bare `1fr`* — the 2-up grid is
  `(358 − 8)/2 = 175px` per tile. *`AddRecipeToListDialog`'s existing `<fieldset class="min-w-0">`
  and its EXCLUDED-set tracking must not be removed* (a recipe that gains a line stays all-on).
  *`shopping-lists` stays `NetworkOnly` in the SW.* *`autoFocus` only acts on mount* — keep the add
  bar's `inputRef.current?.focus()` after submit rather than an `autoFocus` toggle. The unit names
  and `n. B.` are CONTENT.

#### T8.7 — The library create sheet (`+` → Neues Rezept / Importieren)

- **Creates:** `apps/web/src/features/recipes/components/LibraryCreateMenu.tsx`
- **Depends on:** T6.2, T8.1
- **Done when:** it is an `ActionMenu` (never a second menu implementation — `ActionMenu` is
  `Dialog`-based, so Escape, the focus trap, the scroll lock and the sheet-on-phone /
  centred-panel-from-`sm` behaviour come free) triggered by a 44px `--brand` `+`
  `IconButton size="md"`, offering "Neues Rezept" (`/recipes/new`) and "Importieren" (`/import`,
  reusing `ui.nav.import`). It is **hidden**, not disabled, while
  `useEmailVerificationBlock()` is set.
- **Tests:** none.
- **Gotchas:** **this sheet is now the ONLY route to `/import` and `/recipes/new` on a phone** —
  deleting the button orphans both create paths. The `+` stays at `IconButton`'s 44px `size="md"`,
  not the artboard's 40px (R14): `lib/cn.ts` has no tailwind-merge, so a caller-side
  `className="size-10"` would not override it anyway.

#### T8.8 — `/shopping/history`: the bought archive (EXTRAPOLATED — no artboard)

- **Creates:** `apps/web/src/features/shopping/ShoppingHistoryPage.tsx`
- **Depends on:** T5.1 (the `boughtHistory` query key), T5.2 (the route + `SHOPPING_HISTORY_PARAMS`),
  T6.3 (the ten `shopping.history.*` keys), T7.2, T8.5 (the panel whose `Alle` link is the only way
  in)
- **Why this task exists.** T5.2 declares `/shopping/history` with
  `lazyRouteComponent(() => import(...))`, T4.3 builds `GET …/bought`, T6.3 writes the copy and
  T8.5 links `Alle` to it — and the first draft assigned the **screen file to nobody**, so
  `bun run build` fails on the unresolved dynamic import. It is the destination of `1c`'s
  `Bought history → All`, which was never drawn (SPEC §6.4 lists it as an open item), so this is an
  extrapolated screen and the PR must say so. **Scope is fixed by R45** — read it before starting.
- **Done when:**
  - `ShoppingHistoryPage` is the **default export**; the page root is `flex flex-col gap-4` and
    **nothing else** (no `mx-auto`, no `max-w-*`, no `px-gutter`, no `pb-tabbar` — `AppShell`'s
    `<main>` already does all four).
  - A `PhoneHeaderRow`-less header: an `ArrowLeft` back link reusing
    `shopping.detail.backToLists`, the `h1` from `shopping.history.title`, and
    `shopping.history.subtitle` under it.
  - A list filter over the group's cached lists, defaulting to **all** and reusing
    `shopping.lists.allLists` as its "all" option, writing the `listId` search param.
  - Rows grouped by day with `groupByLocalDay` from `@toon/shared` (**never a UTC slice**), one
    `SectionHeader` per day whose label is `shopping.history.today` when
    `dayKey === todayPlanDate()` and `formatShortWeekdayDate(dayKey)` otherwise (the bucket is
    data, the label is interface). The day meta is `shopping.history.dayMeta`
    (`{items} · {who}`), reusing `BoughtHistoryPanel`'s composition, and each row is the `1c` bought
    row shape — struck-through name, quantity + unit, `{who} · {when}` from `formatRelativeShort`.
  - Paging is `offset` through the search param (`Number.parseInt`, `NaN → 0`), with
    `shopping.history.loadMore` appending the next page; `limit` stays the endpoint's default 24.
    **`total` comes from the envelope**, so the button hides itself at the end.
  - **The rows are read-only.** No undo, no per-row dismiss: undo lives on the list-detail bought
    section, where the item can actually merge back into a list, and the watermark that clears a
    section is a per-list concept this group-wide archive does not have.
- **States (R44):** empty (`shopping.history.empty`, and this is the one history surface that DOES
  render an empty state, because the user chose to open it); loading — a stack of plain `Skeleton`
  bars, **not** `SkeletonList variant="rows"`, so T10.2's deletion of the two deprecated variants
  stays safe; error
  (`ErrorState` with retry); offline — **`"shopping-bought"` is on the persist allow-list, so the
  first page renders from cache and `Mehr laden` is disabled with an offline `title`**.
- **Tests:** none.
- **Gotchas:** *the screen is extrapolated* — the PR attaches 390px and 1440px screenshots, like
  `/plan`. *`lazyRouteComponent`, not a hand-rolled `React.lazy` wrapper*, and **no guard wrapper**:
  `groupScopedRoute` is a pathless layout route precisely so the lazy component stays the route's
  `component`. *A page root re-applies none of the shell's four properties.* *A URL is user input.*
  *Day grouping is client-side and local* — the server's optional `?since` is an **instant**, and it
  is not used by this screen at all.

### Phase 9 — The undesigned screens (D6)

Every task in this phase applies **A01 §5.1's lookup table** and **A01 §5.2's five rules**
(flat surfaces + hairline borders · serif for names, sans for everything else · five foreground
tiers used in order · honey = quantity/category, green = done, paprika = action · verify at 390px
in a real browser). If a pattern is not in that table and not in an artboard, ask — do not invent
a sixth answer. Every task in this phase also:

- applies `mx-auto w-full max-w-3xl` on the page root **where the table below says so** (R33b) and
  **nothing else** — never `px-gutter`, `pt-*` or `pb-tabbar`;
- converts its `font-display font-semibold` sites to `font-display font-medium` + a
  `text-display-*` step;
- replaces every `tracking-wide` / `tracking-widest` uppercase label with `.eyebrow`;
- uses no raw `--toon-*` variable and no `→ ← ✓ ▾` text glyph.

#### T9.1 — Import screens

- **Modifies:** `apps/web/src/features/import/ImportPage.tsx`,
  `apps/web/src/features/import/ImportReviewPage.tsx`,
  `apps/web/src/features/import/components/PendingDraftsList.tsx`,
  **`apps/web/src/features/import/components/ParsedRecipeEditor.tsx`**,
  `apps/web/src/features/import/components/ImportErrorPanel.tsx`,
  `apps/web/src/features/import/components/OcrProgressPanel.tsx`,
  `apps/web/src/features/import/components/SourceViewer.tsx`,
  `apps/web/src/features/import/components/ImageCaptureButton.tsx`,
  `apps/web/src/features/import/components/ConfidenceBadge.tsx` (sole owner of all nine)
- **The six components were missing from the first draft, and `ParsedRecipeEditor.tsx` (37 KB) IS
  the body of the review screen** T9.1 was only re-framing — restyling the frame and leaving the
  content on the old type scale is the definition of a half-redesigned screen (D6). All six take
  phase 9's four blanket rules: the `max-w-3xl` decision above, `font-display font-medium` + a
  `text-display-*` step, `.eyebrow` in place of every `tracking-wide`/`tracking-widest` uppercase
  label, and no raw `--toon-*` variable or `→ ← ✓ ▾` glyph. `ConfidenceBadge` composes the
  restyled `Badge` (T1.9) rather than carrying its own pill.
- **Done when:** `ImportPage`'s root becomes `mx-auto w-full max-w-3xl flex flex-col gap-5` — it
  currently reads `mx-auto w-full max-w-3xl space-y-5 px-4 pb-28 pt-4 lg:pb-8`, which is a live
  instance of the forbidden re-apply and costs a 390px phone 32px of width and doubles the bottom
  padding. `ImportReviewPage` is full-bleed with its sticky footer's inner wrapper retargeted from
  `max-w-5xl` to `max-w-content`, still on `.bottom-tabbar`.
- **Tests:** none.
- **Gotchas:** ***do not touch the `ImportErrorText` key-not-sentence machinery*** —
  `ImportApiError`'s `title`/`hint` carry keys, `describeError()` returns the same,
  `useImportError` / `resolveDescribedError` do the rendering, `Error.message` deliberately holds
  the KEY, and `passThroughOr()` exists because an empty pass-through string must fall back to a
  key. Restyle only. *A bottom action bar needs `.bottom-tabbar`* — that footer is the original
  instance of the bug. *`features/import/lib/shell.tsx` is a typing seam* and may gain a
  `ComponentType<…>` re-export in the existing cast style but **never an implementation**.
  Text next to an icon in a flex `<p>` must be ONE child (the "Getestet mit chefkoch.de und …"
  hint) or every run becomes its own flex item and the punctuation starts its own line.

#### T9.2 — Collections + tags

- **Modifies:** `apps/web/src/features/collections/CollectionsPage.tsx`,
  `apps/web/src/features/collections/CollectionDetailPage.tsx`,
  `apps/web/src/features/tags/TagsPage.tsx` (sole owner)
- **Done when:** `CollectionsPage` is full-bleed with its grid gaining `xl:grid-cols-4`;
  `CollectionDetailPage` is full-bleed and its recipe list **reuses `RecipeEditorialRow`** behind
  `useIsWideViewport()` with a matching `SkeletonList variant`; `TagsPage` is
  `mx-auto w-full max-w-3xl` and **gains a `kind` toggle per tag** (course ↔ free) — that toggle is
  how an existing library adopts the eyebrow, and it replaces the rejected name-matching migration
  backfill (R41).
- **Tests:** none.
- **Gotchas:** *`block` beats `line-clamp-N`* — the collection **description** may keep
  `line-clamp-2`, but check that no `block` utility sits on the same element; a collection **name**
  never truncates. *A LIST renders `thumbnailUrl`.* ***The tag names on `/tags` are CONTENT*** —
  German, never through `t()`; only the screen's own chrome and the toggle's label are interface.

#### T9.3 — Groups

- **Modifies:** `apps/web/src/features/groups/GroupsPage.tsx`,
  `apps/web/src/features/groups/GroupDetailPage.tsx`,
  `apps/web/src/features/groups/components/MemberList.tsx`,
  `apps/web/src/features/groups/components/InvitePanel.tsx` (sole owner)
- **Done when:** both pages are `mx-auto w-full max-w-3xl`; `MemberList`'s per-row icon buttons
  collapse into one `ActionMenu` per row; `GroupDetailPage`'s `<Tabs>` inherits T1.4's restyle
  (its active pill becomes brand-soft — a deliberate, single-look change).
- **Tests:** none.
- **Gotchas:** ***`delivered` alone is not "a mail went out"*** — `InvitePanel` must keep rendering
  `mailDeliveryOf()`'s three states (`sent` / `not_configured` / `failed`) in three visually
  distinct ways and must **never** render the last two as success. *A header gets ONE overflow
  trigger.* `/settings`'s `GroupsCard` stays the phone route to `/groups` and is not this task's
  file — do not remove anything that links here.

#### T9.4 — Cards / the wallet

- **Modifies:** `apps/web/src/features/cards/CardsPage.tsx`,
  `apps/web/src/features/cards/components/CardDisplayDialog.tsx`,
  `apps/web/src/features/cards/components/CardFormDialog.tsx`,
  `apps/web/src/features/cards/components/ScannerDialog.tsx` (sole owner)
- **Done when:** `CardsPage` is full-bleed with `lg:grid-cols-3`; every tile is
  **`bg-surface-2` with the label in `text-fg` and the symbology in `text-fg-subtle`** — there is
  **no gradient, no `cards.color` column and no id-derived colour table** (R42).
- **Tests:** none.
- **Gotchas:** ***`BarcodeImage` is exempt from every colour, radius and scaling rule*** — a
  barcode is `#000` on `#fff` in **every** theme, the surfaces behind it are `bg-white`,
  `shapeRendering="crispEdges"` and whole modules are load-bearing, and the quiet zone stays. Do
  not touch it. *`autoFocus` only acts on MOUNT* — keep `CardFormDialog`'s ref-based one-shot focus
  effect for "Nummer eintippen". ***The cards screens DO use `useCanMutate()`*** — the opposite of
  the shopping screens. `features/cards/lib/scan.ts` stays the only `zxing-wasm` caller and the
  wasm stays out of `globPatterns`.

#### T9.5 — Auth screens + `/settings`

- **Modifies:** `apps/web/src/features/auth/AuthLayout.tsx`,
  `apps/web/src/features/auth/AccountSettingsPage.tsx`,
  **the seven screens inside the layout** — `apps/web/src/features/auth/LoginPage.tsx`,
  `RegisterPage.tsx`, `ForgotPasswordPage.tsx`, `ResetPasswordPage.tsx`, `VerifyEmailPage.tsx`,
  `InvitePage.tsx`, `OAuthCallbackPage.tsx` — and
  **`apps/web/src/features/auth/OAuthButtons.tsx`**,
  `apps/web/src/components/layout/NotFoundPage.tsx`,
  `apps/web/src/components/layout/ErrorBoundary.tsx`,
  `apps/web/src/components/layout/OfflineBanner.tsx`,
  `apps/web/src/components/layout/UnverifiedEmailBanner.tsx`,
  `apps/web/src/components/layout/UpdateBanner.tsx`,
  `apps/web/src/components/layout/InstallPrompt.tsx` (sole owner)
- **Done when:** the auth screens keep `AuthLayout`'s `max-w-md` and its `px-gutter`, get rules
  1–4 and the type scale, and take **nothing** from the sidebar (no `--bg-sunken`, no nav).
  **Restyling the layout without its seven screens leaves seven half-redesigned pages** — the
  layout carries the frame, each page carries its own headings, hints and buttons.
  **`OAuthButtons.tsx:109` carries `text-xs font-medium tracking-wide text-fg-subtle uppercase`**,
  which is the exact shape phase 9's rule 3 converts to `.eyebrow` (verified: it is the only
  `tracking-wide` uppercase label left in the tree, so T10.2's new grep gate is clean once this
  lands). No copy changes anywhere in this task — `i18n-keys.md` §10.2 records that the `auth`
  namespace is untouched by the redesign; the
  heading is `font-display text-display-2xl font-medium` on `--bg`. `AccountSettingsPage` is
  `mx-auto w-full max-w-3xl` and keeps `PageHeader`, the `GroupsCard`, the `LanguageCard` and the
  sign-out card. The four banners and the two error screens are tokenised only.
- **Tests:** none.
- **Gotchas:** ***`EmailVerificationCard` branches on `emailVerifiedAt`, the TIMESTAMP, never the
  boolean*** — on the boolean it would show a green checkmark to exactly the users sent there to
  fix it — and it must keep rendering `mailDeliveryOf()`'s three states distinctly. ***The language
  picker's third state is `"system"` and is not a synonym for `de`*** — absent from `localStorage`
  means system, `setLocalePreference("system")` REMOVES the key, the `languagechange` listener only
  acts while the preference is `"system"`, the PATCH to `users.locale` sends the RESOLVED locale
  fire-and-forget, and the two language names are autonyms identical in every catalog. Restyle the
  control only. ***`UpdateBanner` keeps no dismiss button and no fallback timer*** — a blind reload
  would retry a failing worker swap on every launch, i.e. a boot loop; `lib/unsavedWork.ts` stays a
  counter and `hasUnsavedWork()` still decides whether an update applies silently.

#### T9.6 — Recipe form + cook mode

- **Modifies:** `apps/web/src/features/recipes/RecipeNewPage.tsx`,
  `apps/web/src/features/recipes/RecipeEditPage.tsx`,
  `apps/web/src/features/recipes/components/RecipeForm.tsx`,
  `apps/web/src/features/recipes/components/IngredientsEditor.tsx`,
  `apps/web/src/features/recipes/components/StepsEditor.tsx`,
  `apps/web/src/features/recipes/components/RecipeImagePicker.tsx`,
  `apps/web/src/features/recipes/components/CookMode.tsx` (sole owner)
- **Done when:** both page roots are `mx-auto w-full max-w-3xl flex flex-col gap-4`;
  `RecipeForm`'s save bar is `sticky bottom-tabbar -mb-4` (never `bottom-0`) with a `flex-1`
  spacer above it; a **single-select course field** is added to the form, writing
  `CreateRecipeRequest.course` (a tag NAME, not an id) — this is where the "one course per recipe"
  invariant actually lives, since no DB constraint enforces it; `CookMode` keeps its own `px-safe`
  (one of the two places the inset **is** the whole padding), its step text becomes
  `text-base text-fg-body` and its step-number eyebrow moves from `tracking-widest` to `.eyebrow`
  while keeping `text-brand`.
- **Tests:** none new; `lib/validation.test.ts` must still pass.
- **Gotchas:** ***an idle TanStack mutation reports `error: null`, not `undefined`*** — keep
  `apiFieldErrors` returning `{}` for nullish and `RecipeForm` testing `error == null`, or the
  form greets the user with a red error above a form they have not submitted; `unknown` accepts
  `null`, so `tsc` will never catch a repeat and `lib/validation.test.ts` is the only guard.
  *`useNavigationGuard` registers with `lib/unsavedWork.ts`* — do not replace it with a bespoke
  `useState` + `beforeunload`, which compiles and still lets a pending worker update reload the
  document out from under the edit. `UNIT_SUGGESTIONS` and the ingredient paste placeholders are
  **CONTENT** and stay German literals. *`controlClasses` carries `min-w-0`* and every grid track
  holding a control is `minmax(0,1fr)`.

#### T9.7 — Shopping + tag dialogs (the four D6 files nothing else claimed)

- **Modifies:** `apps/web/src/features/shopping/components/AddRecipeToListDialog.tsx`,
  `apps/web/src/features/shopping/components/EditItemDialog.tsx`,
  `apps/web/src/features/tags/components/TagChip.tsx`,
  `apps/web/src/features/tags/components/TagCombobox.tsx` (sole owner of all four)
- **Depends on:** T1.5, T1.6, T1.9, T2.2 (`TagKind`), T8.6
- **Why it exists.** All four are D6 files, all four are reached from redesigned screens, and none
  was in any task's file list. `AddRecipeToListDialog` (14 KB) is the destination of the recipe
  detail screen's **primary** action and was referenced only inside a T8.6 *gotcha*; `TagChip` and
  `TagCombobox` both need `kind` awareness now that a tag can be a course.
- **Done when:**
  - Both dialogs take phase 9's four blanket rules and compose `Dialog` (T1.6) unchanged.
  - **`AddRecipeToListDialog` keeps every one of its correctness properties**, which is why it gets
    its own line rather than a restyle-by-grep: its `<fieldset class="min-w-0">` stays (a
    `<fieldset>` carries the browser's own `min-inline-size: min-content` and ignores the rule you
    would apply to any other flex/grid item); it keeps ticking **every** ingredient by default and
    tracking the **EXCLUDED** set, so a recipe that later gains a line stays all-on; and it keeps
    **omitting** `ingredientIds` entirely when nothing is excluded, because omitted means "the whole
    recipe" and that is what keeps an older client and a queued offline replay working.
  - It also gains the target-list resolution R9 defines, so it opens on the list the caller named
    (T8.4 item 4) rather than resetting to the first list every time.
  - `TagChip` gains a `kind` prop: a `kind="course"` chip renders in the honey accent family
    (`text-accent-strong`, `.eyebrow`-cased where it is a label rather than a control) and a free
    tag keeps today's neutral look — the same two-family split the filter rail draws.
  - `TagCombobox` groups its options into **Gänge** and **Tags** by `kind` (headings are interface,
    the names inside are CONTENT) and keeps its existing keyboard behaviour verbatim.
- **Tests:** none.
- **Gotchas:** *`controlClasses` carries `min-w-0`* and every grid track holding a control is
  `minmax(0,1fr)`. *`autoFocus` only acts on MOUNT* — a dialog is a fresh mount, so `autoFocus` is
  fine inside one; a field that is already on screen needs the ref-based one-shot effect.
  ***Tag names are CONTENT*** — German for every viewer, never through `t()`. *A `<fieldset>` needs
  `min-w-0` explicitly.*

### Phase 10 — Docs, cleanup, `CLAUDE.md`

#### T10.1 — `README.md` + `docs/i18n.md`

- **Modifies:** `README.md`, `docs/i18n.md` (sole owner)
- **Done when:** README's setup notes, the test count and the precache line
  (`115 entries (1359 KiB)`) are **re-measured from one real run** and set to the same numbers
  `CLAUDE.md` gets in T10.3 — the two files disagree today (934 vs 1058) and must be set from the
  same run, not incremented independently. The known-gaps section records: existing installs start
  with **no course eyebrows** until someone marks their tags on `/tags`, and with an **empty
  "Kürzlich gekocht" shelf and an empty week strip** until somebody cooks and plans (R41 ships no
  backfill for either, and both surfaces are designed to render nothing rather than an apology);
  `/plan` and `/shopping/history` are extrapolated screens with no artboard;
  `PERSIST_BUSTER` moving to `v3` costs one cold re-fetch per device; and **light mode changes
  visibly on ~15 unrelated screens** for anyone running an explicit `data-theme` against the
  opposite OS setting, because T1.2 item 4 fixes the 14 tokens `:root[data-theme="light"]` never
  defined — a bug fix, not a redesign, and worth naming so it is not reported as a regression. `docs/i18n.md` gains two lines: the new `plan` namespace, and that the
  course vocabulary is CONTENT with `packages/shared/src/tags.ts` named next to `units.ts`.
- **Tests:** none.
- **Gotchas:** ops output stays English; the release-note lines are user-facing prose in README and
  are not keyed.

#### T10.2 — Dead code + `i18n-check` allow-list + the glyph/token sweep

- **Modifies:** `apps/web/src/components/ui/Skeleton.tsx` (the **one** sequenced hand-off from
  T1.4 — see §3), `scripts/i18n-check.ts` (sole owner)
- **Done when:**
  - `SkeletonList`'s deprecated `"cards"` and `"rows"` variants are deleted, after
    `grep -rn "SkeletonList" apps/web/src` proves the only consumers pass `"editorial"` or
    `"tiles"`. Deleting them in the same commit as the last consumer's migration is what keeps the
    union from lying about what the app can render.
  - `scripts/i18n-check.ts`'s `ALLOW_LIST` gains `packages/shared/src/tags.ts` (R43) — the course
    vocabulary's helper — so check 2's false-positive class 3 stays a **closed list a reviewer can
    eyeball**. Nothing is added to `NEW_GERMAN` in bulk; if a key genuinely needs an entry it gets
    one line with a reason.
  - Four greps come back clean and their output goes in the PR:
    `grep -rn "font-display" apps/web/src | grep -c "font-semibold\|font-bold"` → **0**;
    `grep -rn "toon-sand\|toon-brand\|toon-accent\|toon-herb" apps/web/src --include=*.tsx` → **0**;
    `grep -rn '→\|←\|✓\|▾' apps/web/src` → **0**;
    `grep -rnE 'text-\[[0-9.]+(px|rem)\]' apps/web/src` → only the deliberate avatar-initial sizes
    (**`Badge`'s `text-[0.7rem]` must be gone** — T1.9 replaces it, and it is the one pre-existing
    violation of this gate).
    A fifth: `grep -rn "pb-tabbar\|max-w-5xl" apps/web/src` → only `AppShell.tsx` and
    `styles/index.css`.
    A **sixth**, which the first draft's four greps could not see at all:
    `grep -rn "tracking-wide\|tracking-widest" apps/web/src` → **0**. Phase 9's rule 3 converts
    every uppercase label to `.eyebrow`, and `OAuthButtons.tsx:109` was the last one (T9.5).
    A **seventh**: `grep -rn "data-app-shell" apps/web/src` → the `print.css` selectors **and** the
    three elements T7.2 now marks; before the redesign it matched only the stylesheet, which is why
    printing has always included the nav.
- **Tests:** none.
- **Gotchas:** *`i18n:check` is grep-shaped and exits non-zero even when the tree is correct* —
  read the output with `grep -vE ':[0-9]+: *(\*|//|/\*)'` and confirm everything left is genuinely
  new copy (class 1) or content vocabulary (class 3). **Do not set `I18N_CHECK_BASE`**: on
  `redesign` it resolves to the pre-redesign commit, which is what makes check 1 meaningful.

#### T10.3 — The `CLAUDE.md` rewrite (D3)

- **Modifies:** `CLAUDE.md` (sole owner — **no other task may touch it**)
- **Done when:** every entry in §5 of this file is rewritten as specified there, with its
  rationale, and **no old rationale is left standing next to new behaviour** (D3). The rewrite
  keeps the two kinds of edit visibly separate: "the design changed this" versus "this was never
  true" (the `Sammlungen / Tags ← Erweiterte Suche` claim and the `AddItemBar` `min-h-full`
  sentence are corrections of statements that were already false).
- **Tests:** none.
- **Gotchas:** the entries §5 marks **untouched** must stay verbatim — the OCR/PDF two-flag split,
  the mail/`delivered` rules, `/uploads` signing, the barcode encoders, the Docker/compose entries,
  the libSQL PRAGMA and one-lane entries, `FOLD_PAIRS`, `safeNextPath`, `skipWaiting`,
  `lib/unsavedWork.ts`, the language picker, `mock.module`, and the `bun test` seam discipline.

### Phase 11 — Verification

#### T11.1 — The five gates

- **Modifies:** nothing (a report task; fixes go back to the owning task)
- **Done when:** §6's gate order has been run and its output pasted into the PR, including the
  `i18n:check` reading (never just the exit code), the migration runs against a fresh **and** a
  pre-redesign DB, and the README curl walkthrough. **Plus one new check, because the fonts are the
  redesign's most likely silent failure and the dev server does not exercise the path that serves
  them in production:** start the API with `WEB_DIST_DIR` pointing at `apps/web/dist` and assert
  `curl -sI http://localhost:<port>/fonts/figtree-latin.woff2` returns
  `content-type: font/woff2` and a `cache-control` header. `middleware/staticWeb.ts` needs no edit
  (`.woff2` is already in its `CONTENT_TYPES` map and `NEVER_CACHE` does not cover `/fonts/*`), and
  that is exactly why it has to be **asserted** rather than assumed — the plan's claim that no image
  build is required rests on it.

#### T11.2 — The headless browser runbook

- **Modifies:** nothing (Playwright is installed in `~/.cache/toon-verify`, **outside the repo**)
- **Done when:** every assertion in §6.2 passes at 390×844 and 1440×900 on the eight named
  screens, and the 390px + 1440px screenshots of `/plan` (the one screen with no reference) are
  attached to the PR.
- **Gotchas:** ***do not match the tab bar by its `aria-label`*** — `SideNav`'s `<nav>` carries the
  same one and, being `display:none` on a phone, returns an all-zero rect that reads as a
  plausible wrong number. Match `nav.fixed` or a `data-testid`, and keep a permanent
  `height === 0` guard before using any rect.

---

## 3 — File ownership

**Exactly one task owns each file.** A task that needs a change in a file it does not own stops and
says so in the PR; it does not edit it. The table below lists only the files **two or more of the
six area specs claimed** — every other file is owned by the single task that names it in §2.

| File | Claimed by | Owner | Resolution |
| --- | --- | --- | --- |
| `apps/web/src/styles/theme.css` | A01, A04, A05 | **T1.2** | A04 wanted `--radius-panel` (refused, R13) and A04/A05 wanted `--sidebar-w`/`--content-max`; those two are **Tailwind scales**, so they live in `index.css`'s `@theme inline` (T1.3), not in `theme.css`. T1.2 therefore only adds colour tokens — and it is the only task allowed to, because all four blocks must move together. |
| `apps/web/src/styles/index.css` | A01, A04, A05 | **T1.3** | One task adds the `fonts.css` import, both font stacks, the four colour mappings, the whole type scale, `--radius-control`, `--spacing-sidebar`, `--container-content`, `.eyebrow`, `.bleed-gutter`, `.bleed-gutter-inset` and the `p` rule. T1.1 (fonts) and T1.2 (tokens) land first; nothing else touches this file. |
| `apps/web/index.html` | A01, A06 | **T1.1** | A06 only *asserts* the preloads (§6.2); it does not edit the file. |
| `apps/web/vite.config.ts` | A01, A06 | **T5.2** | A01 claimed the PWA manifest's `theme_color`/`background_color`. **R27: those do not change** — the palette is not being rewritten, so the file has one region and one owner. |
| `apps/web/src/components/ui/Skeleton.tsx` | A01, A04 | **T1.4**, with **one** sequenced hand-off to **T10.2** | T1.4 **adds** `editorial`/`tiles` and marks `cards`/`rows` deprecated; T10.2 **deletes** the two deprecated branches after the last consumer moved. This is the plan's only two-writer file, it is sequenced eight phases apart, and the second edit is a two-branch deletion. Removing them in T1.4 would break `RecipeListPage` for six phases. |
| `apps/web/src/components/ui/Tabs.tsx` | A01, A04 | **T1.4** | A04 wanted a `tone` prop to keep `GroupDetailPage` byte-identical; **R15 refuses it** — D6 means one look app-wide. |
| `apps/web/src/components/ui/Card.tsx` | A01, A04 | **T1.4** | `shadow` prop yes (A01), `radius` prop no (R13). |
| `apps/web/src/components/ui/Avatar.tsx` | A01, A05 | **T1.4** | A05 needed only `tone`; A01's edit is a superset (`shape` + `tone` + two sizes) and lands once. |
| `apps/web/src/components/ui/index.ts` | A01 (implicitly A04) | **T1.7** | The barrel is edited exactly once, by the task that creates the five new primitives. |
| `apps/web/src/features/recipes/components/ServingsScaler.tsx` | A01, A04 | **T1.8** | A01 promotes the frame to `Stepper`; A04 wanted a `size` prop. T1.8 does both in one edit — A04's screens then only pass `size`. |
| `apps/web/src/components/layout/AppShell.tsx` | A04, A05 | **T7.2** | R1 and R33b: the width change plus the `TopBar` removal are one edit, and there is **no `PageColumn`** export for a second task to fight over. |
| `apps/web/src/components/layout/nav-items.ts` | A05, A06 | **T7.1** | A06 only needed the `"/plan"` union member, which T7.1's rewrite includes. |
| `apps/web/src/router.tsx` | A02, A05, A06 | **T5.2** | A02 correctly concluded it needs **no** `RECIPE_FILTER_PARAMS` change; A05 wanted `/plan`; A06 wanted `/plan` + `/shopping/history`. One task declares both routes and both param arrays. |
| `apps/web/src/lib/queries.ts` | A02, A03, A04, A06 | **T5.1** | All four wanted keys. One task adds every key, every `queryOptions`, every `invalidate.*` and the `invalidate.me` fix. |
| `apps/web/src/lib/persist.ts` | A02, A03, A04, A06 | **T5.2** | Rule 2 and R24: one task, one `PERSIST_BUSTER` bump, both allow-list entries, and `lib/persist.test.ts` asserting the value so a merge cannot lose it. |
| `apps/web/src/lib/storage.ts` | A03, A05 | **T5.1** | One new key (`lastShoppingListId`). |
| `apps/web/src/features/recipes/lib/format.ts` | A02, A04, A05 | **T8.1** | The `lastCooked` sort label **key**. (`apps/web/src/lib/format.ts` moved to T7.5 — see the row below and §9's last paragraph; this table's earlier claim that `formatWeekdayShort`/`formatDayOfMonth` would not be added is superseded, there are four consumers.) |
| `apps/web/src/features/shopping/lib/offline.ts` | A03, A04, A06 | **T5.3** | The `undoBought` registration and the optimistic bought row are the same edit. |
| `apps/web/src/features/shopping/lib/queries.ts` | A03, A04 | **T5.3** | The `boughtBy` variable is minted here, at call time. |
| `apps/web/src/features/shopping/components/FrequentlyUsed.tsx` | A01, A03, A04 | **T8.6** | A01 supplies `Chip`; T8.6 deletes the private implementation and composes it. |
| `apps/web/src/features/import/components/UploadProgress.tsx` | A01 | **T1.8** | Composed onto `ProgressBar` in the same task that lands the primitive's other consumer. |
| `apps/web/src/features/recipes/components/RecipeFilters.tsx` | A04 (delete), A05 (add two links) | **T8.2** | R30: the file is **deleted**; the two management links go into `RecipeFilterRail` **and** `RecipeFilterSheet`, and the sheet is the phone route. |
| `apps/web/src/features/cards/components/CardsCard.tsx` | A04, A05 | **T8.5** | It lives on the shopping overview, so the screen that hosts it restyles it — and applies the **opposite** mutation gate from its host (R38). |
| `apps/api/src/db/schema.ts` | A02, A03, A06 | **T3.1** | Rule 1: one agent, three migrations, one `schema.ts` edit. |
| `apps/api/drizzle/meta/_journal.json` + the three snapshots | A02, A03, A06 | **T3.1** | Same. Snapshots are never hand-edited. |
| `apps/api/src/index.ts` | A02 | **T4.1** | One `app.route` line, above the catch-all. |
| `apps/api/src/routes/shopping.ts` | A02 (`plan-suggestions`), A03, A06 | **T4.3** | R21: the from-plan read lives here under A03's name; A02 only **exports** `listPlanEntries`. |
| `apps/api/src/services/shopping/items.service.ts` | A03 | **T4.3** | The `checkShoppingItem` restructure and the `shopping_list_recipes` upsert are one edit — which is why T4.3 is deliberately nine files. |
| `apps/api/src/services/recipes/mappers.ts` | A02 (twice: `lastCookedAt`, `toTag.kind`) | **T4.2** | Both fields in one edit, which is why cook tracking and the course dimension are one task. |
| `apps/api/test/shopping.test.ts` | A03, A06 | **T4.3** | Extended for the two signature changes; every existing assertion stays. |
| `apps/api/scripts/seed.ts` | A02, A03 | **T3.2** | Course tags, bought rows, a hidden catalog entry and a list-recipe row in one edit. |
| `packages/shared/src/index.ts` | A02, A03, A05 | **T2.1**, then T2.2, then T2.3, sequentially | Append-only, one `export * from` line per task, in that order. Stated as sequential in §1. |
| `packages/shared/src/calendar.ts` | A02, A03 (+ A05/A06 as `plan.ts`) | **T2.1** | R2/R3: one file, one merged API, no `plan.ts`, tests in `packages/shared/test/`. |
| `packages/shared/src/shopping.ts` | A03, A04, A06 | **T2.5** | R8: three functions, A03's names. |
| `packages/shared/src/schemas/recipe.ts` | A02, A04, A06 | **T2.2** | `kind`, `course`, `lastCookedAt`, `RecipeSortSchema`, `hasCooked` in one edit. |
| `packages/shared/src/schemas/shopping.ts` | A03, A04 | **T2.4** | One edit; A04 consumes the result. |
| `packages/shared/src/i18n/catalogs/server.{de,en}.ts` | A02 | **T2.3** | A03 adds **no** server keys, so there is no second writer. |
| `apps/web/src/lib/i18n/catalogs/ui.{de,en}.ts` | A05, A06 | **T6.1** | Two adds, three deletes, one task. |
| `apps/web/src/lib/i18n/catalogs/index.ts` | A05 | **T6.1** | The FINAL-marked registry is edited exactly once, for the `plan` namespace, and flagged in the PR. |
| `apps/web/src/lib/i18n/catalogs/recipes.{de,en}.ts` | A04, A05 | **T6.2** | All library/detail/filter/create copy in one task, before any screen reads it. |
| `apps/web/src/lib/i18n/catalogs/shopping.{de,en}.ts` | A03, A04 | **T6.3** | Same. |
| `docs/API.md` | A02, A03, A06 | **T4.4** | One doc task after all three API tasks. |
| `README.md`, `docs/i18n.md` | A06 | **T10.1** | Counts re-measured from one run and reconciled with `CLAUDE.md`. |
| `CLAUDE.md` | A01, A02, A03, A04, A05, A06 (all six proposed edits) | **T10.3** | D3: one agent writes every entry, last, from §5. |
| `scripts/i18n-check.ts` | A06 | **T10.2** | One `ALLOW_LIST` entry. |
| `apps/api/src/db/migrate.ts` | A02, A06 (both concluded "no edit") | **nobody** | Recorded so a later agent does not add a dead `backfillLastCookedAt()`. |
| `apps/web/src/features/recipes/index.ts` | nobody (the gap) | **T8.1**, with **one** sequenced hand-off to **T8.2** and **one** line from **T8.4** | The barrel re-exports `RecipeCard`, `RecipeRow` and `RecipeFilters`, all three of which phase 8 deletes. T8.1 drops the first two and adds `RecipeEditorialRow`/`CourseEyebrow`; T8.2 drops `RecipeFilters` and re-adds `countActiveFilters`; T8.4 adds `RecipeStatRow`. Unowned, this file is a red `tsc` mid-phase-8. |
| `apps/web/src/lib/i18n/i18n.test.ts` | nobody (the gap) | **T6.1** | Its hard-coded prefix array fails on the first `plan.*` key. The earlier draft named `packages/shared/test/i18n.test.ts`, which compares only the server catalogs. |
| `apps/web/src/features/recipes/print.css` | nobody (the gap) | **T8.4** | It hides `[data-app-shell]` elements that have never existed, and its `.recipe-print h2`/`li`/`button` rules are written against markup T8.4 replaces. T7.2 supplies the attribute. |
| `apps/web/src/lib/format.ts` | A02, A04, A05 | **T7.5** (moved out of T8.1) | `i18n-keys.md` §3.1/§3.2 needs four formatters, and `/plan` (phase 7) consumes three of them. Leaving the file in phase 8 recreated the backwards dependency T7.5 exists to remove. `features/recipes/lib/format.ts`'s `SORT_LABELS` line stays with T8.1. |
| `apps/web/src/components/ui/{Badge,ConfirmDialog,ActionMenu,Toast,Spinner}.tsx` | nobody (the gap) | **T1.9** | Phase 1 claims `components/ui`; T1.4–T1.7 covered 16 of 21 files. All five are on redesigned screens and `Badge`'s `text-[0.7rem]` fails T10.2's own grep gate. |
| `apps/web/src/features/plan/index.ts` | nobody (the gap) | **T7.3** | T7.4 and T8.3 write into `features/plan/components/` and import by module path; the barrel is edited once, by the task that creates it. |
| `apps/web/src/lib/persist.test.ts` | A06 (as a "create") | **T5.2** (a **modify** — the file exists) | 164 lines with populated allow/deny blocks; extend them, never overwrite. |
| `apps/web/src/lib/i18n/catalogs/cards.{de,en}.ts` | A04, A05 | **T8.5** | One key added, one deleted (`i18n-keys.md` §10.1), assigned to whoever edits `CardsCard.tsx`. T8.6's rail panel reads the same key. |
| `apps/web/src/features/shopping/ShoppingHistoryPage.tsx` | nobody (the gap) | **T8.8** | A route with no component is a build failure, and §7 admitted the screen was unspecified. |
| `apps/web/src/features/import/components/*` (six files) | nobody (the gap) | **T9.1** | `ParsedRecipeEditor.tsx` **is** the review screen's body; restyling only the frame is a half-redesigned screen. |
| `apps/web/src/features/auth/{Login,Register,ForgotPassword,ResetPassword,VerifyEmail,Invite,OAuthCallback}Page.tsx`, `OAuthButtons.tsx` | nobody (the gap) | **T9.5** | The layout carries the frame; each page carries its own headings and buttons. `OAuthButtons.tsx:109` is the last `tracking-wide` uppercase label in the tree. |
| `apps/web/src/features/shopping/components/{AddRecipeToListDialog,EditItemDialog}.tsx`, `apps/web/src/features/tags/components/{TagChip,TagCombobox}.tsx` | nobody (the gap) | **T9.7** | All four are D6 files reached from redesigned screens; the two tag components need `kind` awareness after D5. |

**The one deliberate multi-writer class**, restated: the four web catalog namespace pairs
(`recipes`, `shopping`, `ui`, `plan`) may take an unanticipated key from a phase 7–9 task, added to
**both** locale files in the namespace's existing section position with no reformatting. Catalogs
are append-only key/value blocks with no cross-references. Every other file above has one owner.

---

## 4 — Conflict resolutions

Every substantive disagreement between the six specs, ruled once. Tasks in §2 reference these by id.

### R1 — `AppShell`'s `max-w-5xl` cannot express a 1440px artboard (A04 §1 vs A05 §2, both raised it)

**Ruling.** `<main>` becomes `mx-auto flex w-full max-w-content flex-1 flex-col px-gutter pt-4
pb-tabbar lg:pt-8 lg:[--gutter:2rem]` with `--container-content: 75.25rem` (1204px);
`SideNav` becomes `w-sidebar` and `AppShell`'s inner column `lg:pl-sidebar` with
`--spacing-sidebar: 14.75rem` (236px). Both scales live in `index.css`'s `@theme inline` (owned by
T1.3, verified against the repo: `--spacing-tabbar`/`--spacing-topbar` already live there, not in
`theme.css`). Implemented once, by **T7.2**.

**Reason.** The desktop artboards are 1440px with a 236px sidebar, so the content column is 1204px
with 1140px inside its own 32px padding. `1a`'s `minmax(0,1fr) 420px` hero, `1c`'s three-column
grid and `1d`'s `minmax(0,1fr) 340px` are all drawn against 1140px and collapse at 1024px. There is
no way to build any of the four desktop artboards without this change, and the design's own stated
fix is *"content spans the full width"*. At exactly 1440px the result is pixel-identical to the
artboards; above it `mx-auto` keeps the column centred rather than stretching editorial rows across
a 4K monitor, which no artboard covers. `--spacing-sidebar` and `w-sidebar`/`lg:pl-sidebar` must
always move together: a mismatch either overlaps the content or leaves a strip of `--bg` beside the
sidebar. **This is a D3 case** — `CLAUDE.md`'s layout gotcha names `max-w-5xl` as the shell's own
value; §5 edit 6 rewrites it.

### R2 — One date module, one naming set (A02 `calendar.ts` vs A03 `calendar.ts` vs A05 `plan.ts` vs A06 `plan.ts`)

**Ruling.** **`packages/shared/src/calendar.ts`**, one file, the merged API in T2.1. There is no
`plan.ts`. `PlanDate` is the type name; `toPlanDate` / `todayPlanDate` / `addPlanDays` /
`planDaysBetween` / `startOfPlanWeek` / `planWeek` / `shiftPlanWeek` / `planWeekRange` /
`planDateToDate` / `isPlanDate` / `startOfLocalDay` / `groupByLocalDay` are the names. Dropped:
`localDayKey`, `localWeekRange`, `isoDateToday`, `startOfIsoWeek`, `isoWeekDays`, `weekStart`,
`weekDays`, `planDateKey`. `isoWeekNumber` is not implemented (nothing needs a week number).

**Reason.** Four specs invented four names for the same six functions; two of them put the file in
two different places. A duplicated date helper is exactly the failure mode where "Thursday" drifts
in one half of the app. A02's naming wins because it carries the meaningful type (`PlanDate` says
"this is a date, not an instant", which is the whole point) and because its header states the two
rules the file exists for. A03's `groupByLocalDay` and `startOfLocalDay` are genuinely different
operations and survive under their own names.

### R3 — Shared tests live in `packages/shared/test/`, not `src/` (A02 said `src/`)

**Ruling.** `packages/shared/test/calendar.test.ts`, `packages/shared/test/tags.test.ts`. Verified
against the repo: all ten existing shared test files are in `test/`, and `tsconfig.json` includes
both `src/**/*.ts` and `test/**/*.ts`, so `src/` would typecheck but break the convention.

### R4 — Planner endpoint paths (A02/A05 `/plan/:entryId` vs A06 `/plan/entries/:entryId`)

**Ruling.** `GET|POST /api/groups/:groupId/plan`, `PATCH|DELETE /api/groups/:groupId/plan/:entryId`.
No `/entries` segment. A02 owns the router and A05 assumed the same shape; A06 was the outlier.

### R5 — The plan range response is `{ from, to, items }`, not the list envelope (A02 vs A05/A06)

**Ruling.** `MealPlanRangeResponseSchema = { from, to, items }`. A05 and A06 both assumed
`{ items, total, limit, offset }` and must adapt.

**Reason.** The `{ items, total, limit, offset }` envelope is for **paginated** lists; a week is
bounded by its own `from`/`to` and has no page, so `total`/`limit`/`offset` would be three fields
that always say the same thing. `PLAN_LIMITS.rangeDays` (62) is the bound. `docs/API.md` says so
explicitly (T4.4) so nobody "fixes" it into a paginated list.

### R6 — Index shapes (A02 vs A06)

**Ruling.** `recipes_group_last_cooked_idx` is **`(group_id, last_cooked_at, created_at)`** (A02),
not two columns — the third column is the tie-break the `orderBy` actually uses, so it comes out of
the index too. **No `tags_group_kind_idx`** (A02, against A06): `tags_group_id_idx` already narrows
to the group, a group holds tens of tags, and a `(group_id, kind)` index would be dead weight on a
table written on every recipe save. `meal_plan_entries_group_date_idx` is
**`(group_id, planned_on, position)`** — `(group_id, planned_on)` is a prefix of it, so SPEC §4.1's
index is served and the `ORDER BY` comes free; the two-column index is **not** additionally created.
All indexes are declared **ascending** (A06's point): SQLite walks a composite index backwards when
the leading column is an equality, so `.desc()` buys nothing and is a drizzle-version-dependent API
this repo does not otherwise use.

### R7 — New primitives live in `components/ui/`, not in a feature (A01 vs A04)

**Ruling.** `ProgressBar`, `SectionHeader`, `Stat`/`StatRow`, `Chip`, `Stepper` are all in
`apps/web/src/components/ui/` (T1.7). A04's `features/shopping/components/SectionHeader.tsx` and
`features/shopping/components/ShoppingProgressBar.tsx` are **not created**.
`features/recipes/components/RecipeStatRow.tsx` **is** created but **composes** `Stat`/`StatRow`
and contains no independent markup — it owns only the recipe-specific field mapping.

**Reason.** `components/ui/` is *"the ONLY UI primitives — never re-implement one"*, and each of the
five appears in two or more features (`SectionHeader` 4× across two screens; `ProgressBar` on the
overview **and** in `UploadProgress`; `Stepper` on the detail screen **and** in the planner; `Chip`
in the rail, the phone scroller and the group switcher). A01's whole justification for each is that
leaving it feature-local guarantees a second copy — and `UploadProgress` and `FrequentlyUsed` are
the two copies that already exist.

### R8 — Frequently-bought: two functions, A03's names (A03 vs A04 vs A06)

**Ruling.** `selectMostBoughtEntries` then `sortEntriesByFoldedName`, both in
`packages/shared/src/shopping.ts`, called as two separate steps. A04's `sortCatalogAlphabetically`
and A06's `groupBoughtByDay`-adjacent naming are dropped. `shoppingProgressPercent` (A03/A04), not
`boughtProgress` (A06).

**Reason.** SPEC §4.6 makes it explicit that selection (frequency) and display order (alphabetical)
are two different operations and the code must say which is which. A single `sortBy` silently
reverts the design's stated fix, and code review must be able to reject it by name.

### R9 — No `isDefault` on the wire; the target list is the client's (A03 S5 vs A04 §14.6)

**Ruling.** `ShoppingListSchema` gains `boughtCount`, `boughtClearedAt` and `previewItems` and
**not** `isDefault`. No `shopping_lists.is_default` column. The client picks the target list:
`storageKeys.lastShoppingListId` (`"<groupId>:<listId>"`), falling back to the alphabetically first
list from the already-cached index, falling back to an empty state with a "Liste anlegen" action.
The panel **names the target in its button**.

**Reason.** A server-side default is state two flatmates can fight over, nothing else in the app has
a default-list concept, and "the one I last opened" is both what the mock implies and free.

### R10 — `shopping_list_recipes` ships (A03 vs A04 §8.6, which recommended dropping the two numbers)

**Ruling.** The table ships (T3.1) and `ListRecipesPanel` renders the literal artboard —
`{onList} von {total} Zutaten · {servings} Portionen`. **Escalated to the owner as open item O2**
with this as the recommendation.

**Reason.** D2 says the design wins on visuals and `1d` draws both numbers; `servings`-at-add-time
is the one fact no existing column can carry (`source_recipe_ids` is per-item and is rewritten by
every merge, so it cannot hold it). The table is six columns, additive, cascade-scoped to the list,
and bounded by lists × recipes. A04's alternative silently drops two of the panel's three facts,
which is the "paper over a gap" this pass exists to prevent. It is the one place the plan adds
persistent state SPEC §4 never listed as a workstream, which is why the owner is told.

Remove semantics are A03's and are the honest ones: delete the lines whose **only** source is that
recipe, keep shared lines with their **quantities unchanged**, and state both counts in the confirm.
The merge is destructive by design, so subtraction cannot be honest — a recipe may have been edited
since, and a hand-typed amount contributes no recipe id at all.

### R11 — `--fg-faint` is `#8d7c67`, not the artboard's `#6b5c4b` (A01 §3.3)

**Ruling.** Ship `#8d7c67` (dark) / `#7f6f5b` (light). **Escalated as open item O1**; it is a
one-line `theme.css` change either way and the implementation must not fork over it.

**Reason.** The drawn `#6b5c4b` measures 2.88:1 on `--bg` and 2.67:1 on `--surface`, and the design
uses it for 24 pieces of 11px/700 copy — under WCAG AA for normal text (4.5:1) and under the
large-text floor (3:1). `#8d7c67` is the next ramp stop, clears 4.61:1, and still leaves five
distinguishable foreground tiers (15.9 → 12.8 → 7.9 → 5.7 → 4.6).
`components/ui/index.ts` already commits the primitives to accessibility as a stated convention.

### R12 — Inputs stay at ≥16px (A01 §2.7)

**Ruling.** Every focusable text control is `text-base`, whatever the artboard drew (14.5px search
field, 15px add bar). `@layer base`'s `font-size: max(1rem, 16px)` is untouched. A `text-item` on
an `<input>` is a review-blocking mistake.

**Reason.** iOS zooms the viewport on focus below 16px, which on the shopping list — whose add bar
is `sticky bottom-tabbar` — also shifts the bar under the keyboard. The visual delta is ~1px of
placeholder text. The 15px on a shopping-item **name** (a `<span>` in a button) is fine and uses
`text-item`.

### R13 — No `--radius-panel`; 18px collapses to 16px (A01 §3.9 vs A04 §2)

**Ruling.** `Card` gains `shadow?: "none" | "card" | "pop"` (default `"none"`) and **no `radius`
prop**. The design's 18px mobile shopping cards render at `rounded-card` (16px).
`--radius-sheet` (20px) is untouched.

**Reason.** A01's radius audit collapses `16, 18` into one step deliberately; a 2px delta on one
card family is not worth a fourth radius token plus a prop plus four call sites deciding which to
use. The alternative A04 warns about — `rounded-[18px]` hard-coded in four places — is prevented by
the collapse, not by the prop.

### R14 — `IconButton` keeps 36/44/52; the artboard's 40px `+` renders at 44px (A05 open item 5)

**Ruling.** No 40px size entry. The library `+` is `IconButton size="md"`.

**Reason.** 44px is the repo's stated touch-target floor and `components/ui/index.ts` commits to it.
A caller-side `className="size-10"` would not work anyway: `lib/cn.ts` is plain `clsx` with **no
tailwind-merge** (verified), so both size classes would survive into the class list.

### R15 — `Tabs`' segmented variant is restyled outright; no `tone` prop (A01 vs A04)

**Ruling.** The `segmented` variant becomes the artboard's control for every caller.
`GroupDetailPage`'s members tabs change appearance deliberately.

**Reason.** D6: the app is never half-redesigned. A `tone` prop whose only purpose is to keep one
screen on the old look is a knob that exists to preserve an inconsistency. There is exactly one
other caller and "Mitglieder · 3" reads correctly in the new style.

### R16 — The `sm` markup branch survives; `SkeletonList` gains variants and loses two later (A01 gap 8, A04 §4.2/§10.2)

**Ruling.** `useIsWideViewport()` stays. Both branches render `RecipeEditorialRow`, differing in
title step and whether the description shows. `SkeletonList` gains `"editorial"` and `"tiles"` in
T1.4 (keeping `"cards"`/`"rows"` deprecated) and loses the two dead variants in T10.2.

**Reason.** A01 handed the branch decision to A04, which kept it — correctly: the hazard the branch
exists for (*a `display:none` `<img>` is still fetched*, 24 thumbnails loaded twice) is unchanged
even though the *reason for two trees* changes. Deleting the dead variants in T1.4 would break
`RecipeListPage`, which is the only consumer (verified: one call site).

### R17 — `shopping_bought_items.bought_by` is nullable with `ON DELETE set null` (A03 vs SPEC §4.3's sketch)

**Ruling.** Nullable, `set null`. The DTO falls back to `shopping.bought.unknownBuyer`.

**Reason.** This is a group's purchase HISTORY. A `cards`-style cascade would erase a departed
member's purchases from everyone else's history the day an account-deletion endpoint exists, and
`NOT NULL` leaves no third option. SPEC §4.3 sketched `not null` but explicitly delegated the
column details.

### R18 — Cooked gets an undo (A02 open item 1)

**Ruling.** Ship `DELETE /api/groups/:groupId/recipes/:recipeId/cooked`: the caller's own most
recent log row for that recipe, within `COOK_UNDO_WINDOW_MS` (10 min), clearing the plan entry's
`cooked_at` when that row stamped it and **recomputing** `last_cooked_at` from `max(cooked_at)`.

**Reason.** ~30 lines, no new wire code, no new error code. The alternative is a one-tap
irreversible write sitting next to "Cook mode" on a 390px phone.

**Amended: the endpoint now has named UI owners, which it did not in the first draft.** The
completeness pass found `DELETE …/cooked` shipping with no affordance anywhere — the strongest
argument for cutting it. It is kept, and placed: **T8.4** turns the `Gekocht` button into
`Rückgängig` for `COOK_UNDO_WINDOW_MS` after a successful POST **and** puts the same action in the
success toast (T1.9 adds `Toast`'s action slot); **T7.4** adds an undo item to a planned day card's
`ActionMenu`; **T7.3** owns the `usePlanEntryCookedUndo` hook. An endpoint with no caller is dead
code that still costs a constant, a `max(cooked_at)` recompute, a plan-entry unstamp, an error key
and four test cases — so either it is placed or it is cut, and this is the placement.

### R19 — `POST …/bought/clear`, not `DELETE …/bought` (A03 vs A06)

**Ruling.** `POST /api/groups/:groupId/shopping-lists/:listId/bought/clear`.

**Reason.** `DELETE` reads as "delete the log", which is precisely what the action must not do —
SPEC §4.3 flags that `Clear bought` must not destroy the rows the history panel reads. The
watermark (`shopping_lists.bought_cleared_at`) is one integer, one O(1) write, and cannot disagree
with itself. Catalog hiding is likewise `PATCH …/catalog/:entryId { hidden }` (A03), not A06's
`POST`/`DELETE …/hidden` pair — one endpoint, both directions, and it matches
`UpdateShoppingCatalogEntryRequestSchema`.

### R20 — `Show all` expands the cache; the catalog endpoint exists only to unhide (A03 vs A06)

**Ruling.** Both. `Alle {n} anzeigen` expands the ≤24 `catalog` entries **already in the detail
payload** — no fetch, works offline (A06's finding: `SHOPPING_LIMITS.catalogSuggestions` is already
24, verified). `GET …/catalog?includeHidden=1` is kept (A03) but is reached only by an
"Ausgeblendete anzeigen" toggle inside that sheet, is online-only and is **not** persisted.

**Reason.** A06 was right that the common path needs no endpoint, and wrong that no endpoint is
needed at all: the detail payload's `catalog` excludes hidden entries by design, so the unhide
affordance SPEC §4.6 requires has no data source without it. Splitting the two paths keeps the
frequent one offline-capable and the rare one honest.

**Amended: the toggle sits on the `Show all` sheet's own header row, NOT in a second sheet inside
it.** The first draft nested a sheet in a sheet for what the design draws as one hint sentence —
two focus traps, two scroll locks, and `Dialog.tsx`'s `openDialogs` counter is a counter, not a
nesting contract. The endpoint and its online-only, unpersisted status are unchanged.

### R21 — `from-plan` lives in the shopping router, under that name, with required bounds (A02 vs A03)

**Ruling.** `GET /api/groups/:groupId/shopping-lists/:listId/from-plan?from&to`, in
`routes/shopping.ts` (T4.3), importing `listPlanEntries` from `services/plan/plan.service.ts`.
A02's `plan-suggestions` name is dropped. Both bounds are **required** and a bad range is 422.

**Reason.** The diff is against a LIST, so it belongs to the list's router — and pathing it under
`…/shopping-lists/` is what makes the existing `NetworkOnly` service-worker rule cover it with no
new rule. `from`/`to` are required because the server must not guess where a week starts (R1 of the
calendar boundary, below); this is a screen's own request, unlike the optional `?since`, so failing
loudly is right.

### R22 — `ingredientTotal` counts the recipe as it is today

**Ruling.** Live count, documented in the field's comment and in `docs/API.md`.

**Reason.** A recipe that gained an ingredient after being added reads "5 von 6", which is exactly
the "add the missing one" prompt rather than a bug. Freezing it would need a snapshot column and
would make the panel lie about the recipe the user can open.

### R23 — There is no `GET /api/groups/:groupId/summary` (A02 §5 vs A06 §2.1)

**Ruling.** No summary endpoint, no `groupSummary` query key, no `"summary"` persist segment. The
sidebar's three numbers come from data the client already holds: `2 members · 37 recipes` and
`Recipes 37` from `GroupWithRole.memberCount`/`.recipeCount` on the persisted `["toon","me"]`
bootstrap, and `Shopping 10` from summing `ShoppingList.itemCount` over the already-cached,
key-shared `shoppingListsQuery`. The one real fix is `invalidate.me(qc)` inside
`invalidateAfterRecipeMutation` (verified missing — the function invalidates recipes/tags/
collections/groups and the recipe, but not `me`, so the count sticks at 37 after the 38th recipe).
Render **nothing**, never `0`, while a count is `undefined`.

**Reason.** A local libSQL file is ONE serialised lane, and a summary endpoint would add a third
query per screen for numbers two existing, already-persisted queries answer. Adding
`openShoppingItems` to `loadUserGroups` instead would make the **bootstrap** pay a join for every
group on every app start and reconnect, to render a number only visible while the sidebar is on
screen.

### R24 — The persist allow-list gains exactly two segments (A02, A03, A04, A06 all differed)

**Ruling.** `PERSISTED_GROUP_SEGMENTS` gains **`"plan"`** and **`"shopping-bought"`**.
Not persisted: `"plan-shopping"` (a server-computed diff whose only purpose is an online-only bulk
add — a persisted diff would offer an `Add` button that cannot run) and `"shopping-catalog"` (a
sheet opened deliberately; the chips come from the detail payload). No `"summary"` (R23).
`PERSIST_BUSTER` goes to `"v3"` **once**, in T5.2, which lands last in phase 5.

**Reason on `"shopping-bought"`** (A03 said persist, A04 said do not, A06 split it in two): one
segment, persisted. The history panel sits on `/shopping`, which is a persisted offline screen, and
an unpersisted panel on a persisted screen is a spinner that never resolves — A04's worry about a
stale "Heute · 4 Artikel" applies equally to every other persisted query on that screen. Splitting
into `bought-summary` + `bought-history` to keep deep pages out of the blob is real but small
(≤100 small rows per page, 7-day max age); one segment is simpler and `gcTime` drops old pages.
Say so in `persist.ts`'s comment.

**The asymmetry with `"plan-shopping"` is deliberate and has to be stated, because this ruling
argues both sides in one paragraph.** Two panels, same screen, same shape, opposite answers:
`shopping-bought` is persisted because its rows are **readable** offline and the panel is worth
reading with no signal; `plan-shopping` is not persisted because its **only** affordance is an
online-only bulk add, so a restored diff would render an `Add` button that cannot run. The
consequence, which the first draft left unsaid: **`WeekPlanPanel` renders nothing at all when
`!isOnline`** (T8.5), rather than a spinner that never resolves. "An unpersisted panel on a
persisted screen is a spinner that never resolves" is true — the fix for the unpersisted one is not
to persist it but to not render it.

### R25 — The course rail reuses the existing `tags` URL param (A04, A06 agreed; recorded because it looks like it needs one)

**Ruling.** No new search param, no `RECIPE_FILTER_PARAMS` edit, no `RecipeListQuery` field, no
second join. Course selections are written into `tags`, and the rail's two sections are a
presentational split driven by `kind` on the tag listing. **Course is single-select**, and that is
forced by the API, not by taste: `tagIds` is AND-combined, so two selected courses return zero rows
every time. Say that in a comment.

### R26 — `?hasCooked` stays out of `RECIPE_FILTER_PARAMS` (A02 §3.5)

**Ruling.** Out. It exists only for the "Kürzlich gekocht" carousel's own component-level query.
`?sort=lastCooked` needs no array edit either — `sort` is already listed (verified), so only
`RecipeSortSchema` widens. If a later phase adds a "nur schon gekochte" toggle to "Erweiterte
Suche", the array line lands **in that same commit** or `pick()` drops it and the bug reads as a
router fault.

### R27 — The PWA manifest's colours are not edited (A06 §8.6 flagged the risk)

**Ruling.** `apps/web/vite.config.ts`'s `background_color: "#faf5ee"` and
`theme_color: "#c2532c"` stay. `lib/theme.ts`'s `<meta name="theme-color">` hexes stay `--bg`
(`#17120f` / `#faf5ee`) and **not** `--bg-sunken` — the browser chrome matches the page, not the
sidebar.

**Reason.** SPEC §2's audit is that the palette needs no rewrite; the four new tokens are additions,
not replacements, so no shipped hex moves. That collapses A06's two-region conflict on
`vite.config.ts` into one owner (T5.2).

### R28 — Which shopping writes are online-only (A03, A04, A06 all listed slightly different sets)

**Ruling.** Queued through the outbox: item add / update / remove / **check-off** / clear-list /
add-recipe / add-suggestion (all existing) **plus** `undo-bought`. Ordinary online mutations, gated
on `isOnline` **+** `useEmailVerificationBlock()`: list create / rename / delete (existing),
`Clear bought`, catalog hide/unhide, `Remove recipe from list`, and every planner write, and
`Cooked`. **Never `useCanMutate()` on the shopping screens**; **always `useCanMutate()` on the
cards screens and on `/plan`**; and the recipe detail header carries **two different gates on one
screen** (R38).

**Reason.** A queued mutation the server will 403 must never enter the outbox — it can never
succeed, so queuing converts "read-only right now" into "your edit was silently discarded three
days later". And `useCanMutate()` is false offline, which is exactly backwards for the one feature
that works offline.

### R29 — Three `ui` keys are deleted, not left in place (A05 open item 7)

**Ruling.** Delete `ui.topbar.searchRecipes`, `ui.topbar.newRecipe` and `ui.sidenav.logout` from
both catalogs in T6.1. `ui.nav.import` is **kept** — the `+` sheet reuses it.

**Reason.** A key with no call site is copy nobody will ever review again. `tsc` cannot flag it and
`i18n:check` will keep asserting parity on it forever.

### R30 — `/collections` and `/tags` were already unreachable on a phone (A05 §9.1)

**Ruling.** `RecipeFilters.tsx` is deleted and replaced by `RecipeFilterRail` +
`RecipeFilterSheet` (A04), and **both** carry `Sammlungen verwalten` / `Tags verwalten` links —
the sheet's copy being the phone route. Verified: `grep` finds zero `to="/tags"` outside
`nav-items.ts` and no `to="/collections"` outside `CollectionDetailPage` itself.

**Reason.** `CLAUDE.md` claims the "Erweiterte Suche" panel reaches both screens; the panel offers a
collection **filter** and tag **chips**, not links, so the claim has been false since the
sidebar-only decision. Fixing it in this pass is what stops the nav restructure being blamed for a
pre-existing orphan. **This is a D3 correction, not a design change** — §5 edit 3 says so
explicitly so the next reader does not assume the panel used to have links and lost them.

### R31 — `Gekauftes leeren` is not destructive (A03, A04 agreed; recorded because the copy decides it)

**Ruling.** Not destructive-red, and its confirm says "aus dieser Ansicht entfernen", never
"löschen". The watermark leaves every log row readable by the history panel.

### R32 — The shopping-list sort is three client-side options, default unchanged (SPEC §6.2)

**Ruling.** A `<Select>` with `Reihenfolge` (today's `position` order, **the default**),
`Neueste zuerst` (`createdAt` desc) and `A–Z` (folded with `foldText()`), sorted client-side over
the already-loaded array. **No `?sort=` param on the list detail.**

**Reason.** A request-dependent order would defeat the "every mutation returns the whole list"
contract. The artboard's "Sortierung: neueste" is a mock's *current value*, not a statement about
the default — changing everyone's existing list order is a gratuitous change, so the default stays
`position`. And do not build a menu with one item.

### R33 — "synced 2 min ago" and "Lena is shopping now" are derived, with no socket (SPEC §6.3)

**Ruling.** "vor {n} Min. synchronisiert" comes from the TanStack query's own `dataUpdatedAt`
through `formatRelative` — **no backend at all**. "{name} kauft gerade ein" comes from the newest
`bought` row in the payload the screen already has, rendered **only** when it is younger than 15
minutes **and** by someone else; otherwise neither line renders. No websocket, no presence table.

### R33b — No `PageColumn`; form screens carry their own `max-w-3xl` (A04 §1 vs A05 §2.4)

**Ruling.** A05's approach. `AppShell` exports no `PageColumn`. Each form/prose screen applies
`mx-auto w-full max-w-3xl` **on its own page root** and nothing else — no `px-gutter`, no `pt-*`,
no `pb-tabbar`. The screens are enumerated in A05 §2.4 and assigned in phase 9.

**Reason.** 768px is the measured comfortable form width and `ImportPage` already uses exactly that
value; A04's `PageColumn` restores 1024px, which is worse typography for a single-column form. A
component that carries only a max-width is a component for nothing, and none of A04's own six
screens would use it. `max-w-3xl` on a page root is not the forbidden re-apply: the rule is about
the shell's four properties, and a max-width that is not the shell's own carries no padding.
§5 edit 6 records that this is the one cap a page root may carry.

### R34 — The sidebar loses its "Neues Rezept" button and its logout icon (A05 §3, open item 6)

**Ruling.** Both go. The footer user row links to `/settings`, which has the sign-out card.

**Reason.** The artboard's sidebar footer draws an avatar, a name, an e-mail and a gear — no
sign-out and no create button. If one-click logout turns out to be missed, the honest fix is an
`ActionMenu` on the footer row, not a second icon button (*a header gets ONE overflow trigger*).

### R35 — `/plan`'s phone layout is a vertical list of seven day rows (A05 open item 1)

**Ruling.** Vertical seven-row list on a phone, seven-column grid on desktop. The library's
horizontal four-day strip is a *strip*, not the screen.

**Reason.** A 132px strip card cannot hold a title that never truncates, and non-truncating titles
are one of the design's own stated fixes.

### R36 — A day may hold several entries; the strip shows the first plus `+N` (A02 open item 4)

**Ruling.** Keep the `position` capacity. The library strip renders the first entry plus a `+N`
affordance; `/plan`'s day column renders all of them.

**Reason.** A flatshare plans lunch and dinner, and the unique `(group_id, planned_on, recipe_id)`
index already stops the accidental duplicate. The design draws one card per day because the mock
has one entry per day, not because the schema should.

### R37 — `/plan` gets no sticky bottom bar and no bulk "add the week to a list" in this pass (A05 open item 10)

**Ruling.** Neither. Per-entry "Zutaten zur Einkaufsliste" through the existing
`AddRecipeToListDialog` covers the journey, and the shopping overview's `WeekPlanPanel` is where the
bulk add lives (with a named target list, R9).

### R38 — The recipe detail header carries two different mutation gates (A04 §10.8, A06 §2.7)

**Ruling.** `Zur Einkaufsliste` keeps `useEmailVerificationBlock()` (it queues offline);
`Gekocht` and `Für einen Tag planen` take `useCanMutate()` (online-only). **Do not unify them** —
the existing comment in `RecipeDetailPage` argues the opposite direction for the other button, so
the split needs its own line in `CLAUDE.md` (§5 edit 5).

### R39 — The mobile item tile is `line-clamp-2`, not the artboard's single line (A04 open item 8)

**Ruling.** `line-clamp-2` with a fixed `min-h` so the 2-up grid stays even. A deliberate deviation.

**Reason.** A truncated German compound ("Rinderhackfl…") is unreadable at 175px on the one screen
whose entire job is being read at a shelf. It is the only place in the plan where a clamp is added
rather than removed, and the clamp must be the only `display` utility on that element (*`block`
beats `line-clamp-N`*).

### R40 — Share is `navigator.share` of plain text, no backend (SPEC §6.1)

**Ruling.** `navigator.share({ title, text })` of the list rendered as plain text through the
existing `shareOrCopy` helper, with a clipboard fallback.

**Reason.** A real share token is a new **unauthenticated read surface** and nothing else in the
design implies one.

### R41 — No name-matching backfill for `tags.kind`; `/tags` gets a kind toggle (A02 open 5, A06 open 3)

**Ruling.** The migration's `DEFAULT 'free'` is the whole backfill. `/tags` gains a per-tag
course↔free toggle (T9.2), and the release notes say existing installs start with no eyebrows.
**No `bun run tags:mark-courses` script** (A06's escape hatch is declined).

**Reason.** Promoting a tag by name writes an irreversible guess about German content vocabulary
into somebody else's data, and would mis-mark a group's free tag named "Dessert". The UI is designed
for the absence (SPEC §4.4: no course tag renders **no** eyebrow), so nothing looks broken. A
one-shot CLI is a third way to do what the tag screen does, and it would need its own tests and
its own `--dry-run` review.

### R42 — The loyalty-card tile has no colour (A01 §3.2 vs A04 §14.9)

**Ruling.** A04's answer: `bg-surface-2`, label in `text-fg`, symbology in `text-fg-subtle`.
**No `cards.color` column, no id-derived six-pair gradient table, no palette addition.**

**Reason.** The artboard's Payback blue is one mock instance, not a brand requirement, and it is a
cold blue in a warm palette. A01's derived-gradient helper is a pure function with a unit test for
decoration nobody asked for, and it would put six arbitrary hexes into `packages/shared`.

### R43 — `packages/shared/src/tags.ts` joins the `i18n-check` allow-list (A06 §8.5)

**Ruling.** Add that exact path to `ALLOW_LIST` in `scripts/i18n-check.ts` (T10.2). Verified: the
list already carries `units.ts`, `ingredients.ts`, `numbers.ts`, `text.ts`, `duration.ts` and
`seed.ts` for the same reason.

**Reason.** Otherwise check 2 floods with course names and false-positive class 3 stops being a
closed list a reviewer can eyeball — which is how the real German leak in
`services/groups/validation.ts` got through last time.

### R44 — Empty / loading / error / offline / read-only are part of every screen task

**Ruling.** Seven tasks — **T7.4, T8.1, T8.3, T8.4, T8.5, T8.6, T8.8** — carry an explicit
**States** clause, and `SkeletonList` gains a `"daycards"` variant (T1.4) so the week strip has a
loading shape. Two rules bind all of them:

1. **A secondary shelf or panel with nothing to show renders NOTHING — heading included.**
   `RecentlyCookedShelf`, `BoughtSection`, `BoughtHistoryPanel` (the panel, not T8.8's page),
   `FrequentlyUsed` with an empty catalog, and `WeekPlanPanel` offline. No key, no apology, no
   reserved height.
2. **A screen the user navigated TO renders a real empty state.** `/plan` (its week), `/`
   (no recipes, and a separate one for no search hits), `/shopping` (no lists),
   `/shopping/$listId` (an empty list — the common case), `/shopping/history`.
   `ListRecipesPanel` is the one panel that renders an empty state, because its empty state **is**
   the dashed button that creates its content.

**Reason.** The artboards draw exactly one state per screen — populated, online, permitted, dark —
and a plan that transcribes only that produces branches that photograph correctly and are wrong on
a real install. Two of the new components are **empty for every existing install on day one**,
because R41 correctly refuses a `tags.kind` backfill and nothing back-dates `last_cooked_at`: an
empty horizontal scroller under a heading is the *default* outcome of the redesign, not an edge
case. This is the one class of gap that produces a wrong-looking branch rather than a red build, so
it is a ruling rather than a note.

### R45 — `/shopping/history` ships as a screen, at the smallest honest scope (owner item O4)

**Ruling.** Keep `GET …/bought`, keep the `/shopping/history` route and its
`SHOPPING_HISTORY_PARAMS`, and **add the screen as T8.8** — a read-only, day-grouped, `offset`-paged
archive with a list filter and no per-row actions. **Escalated as open item O4** with this as the
recommendation and the cheaper alternative costed.

**Reason.** `1c` draws an `All` link, SPEC §6.4 asks for the destination it points at, and §8.1
already decided a real route for a reason that still holds: a dialog cannot hold `offset`, cannot
be deep-linked, and loses its place on every re-render. The honest objection — that this is a
paginated group-wide archive derived from one drawn link, and the largest unbudgeted surface in the
plan — is why the scope is pinned to "read-only, no undo, no watermark" rather than a second
list-detail screen. **The alternative, if the owner prefers it:** `BoughtHistoryPanel`'s `Alle`
expands **in place** over the ≤100 rows the detail payload already carries, and the endpoint, the
route, the two search params, R24's persist reasoning for the deep pages and T8.8 all disappear.
That is a smaller diff and a real answer; it is not the default because it changes the behaviour of
a drawn element.

### R46 — The desktop shopping overview stacks its list previews; columns 2–3 are fixed

**Ruling.** `1c`'s `grid-cols-[1.25fr_minmax(0,1fr)_minmax(0,1fr)]` survives, and **column 1 is a
vertical stack of `ShoppingListPreviewCard`s** ordered last-opened-first (`lastShoppingListId`,
R9) then alphabetically. Columns 2 and 3 hold `WeekPlanPanel` and `CardsCard`/`BoughtHistoryPanel`.
The phone 2-up grid is unchanged.

**Reason.** `1c` draws exactly one preview cell because the mock has one list; several named lists
per group is **locked decision 7**, and T3.2 seeds more than one, so a literal transcription has
nowhere to put list two. Stacking is the only option that needs no new breakpoint and keeps the
drawn three-column proportions at one list — which is the case the artboard actually shows.

### The calendar-date boundary, stated once for both backend areas

A02 and A03 both need it and agreed; A05 and A06 both recommended the same. **Ruling, binding on
every task:**

> **A calendar date belongs to the CLIENT. The server never derives one.**

- `meal_plan_entries.planned_on` is **`text` holding `YYYY-MM-DD`** — not an integer unix-ms
  midnight. A plan entry is a date; an instant is not. A date derived from an instant is a day out
  whenever the container's UTC and the user's Europe/Berlin disagree (00:00–02:00 nightly), and
  local-time day arithmetic lands on 23:00 the previous day across a spring-forward boundary.
  Lexicographic order is chronological, so `meal_plan_entries_group_date_idx` serves both the range
  scan and the `ORDER BY` with no conversion, and the value is legible in the DB.
- **Every instant stays integer unix ms** and is serialised with `toIso()`/`toIsoOrNull()`:
  `cooked_at`, `created_at`, `updated_at`, `bought_at`, `bought_cleared_at`, `hidden_at`.
  `plannedOn` passes to the wire **verbatim** — `toIso()` would hand the client a
  `T00:00:00.000Z` it mis-renders west of Greenwich.
- The web app computes every date string from the **device's local calendar** via
  `packages/shared/src/calendar.ts` and sends it (`plannedOn`, `from`, `to`).
- The server has **no** notion of "today". The one place tempted to guess is the cook endpoint: it
  stamps a plan entry only when the client names one (`mealPlanEntryId`) or names a date
  (`plannedOn`), and otherwise stamps nothing. A server-side `new Date()` there would, between
  00:00 and 02:00 Berlin time, stamp yesterday's dinner.
- Day **grouping** for the bought history is client-side (`groupByLocalDay`); the server takes an
  optional `?since=<ISO>` **instant**, clamps it to `[now - 7d, now]`, and **ignores garbage rather
  than answering 422** (a bad query param must not blank a screen).
- The day **label** is interface (`Heute` from the catalog for the current day key, otherwise
  `formatDate`'s `Intl` output); the day **bucket** is a date key, i.e. data.
- This is a documented **extension** of `CLAUDE.md`'s timestamp convention, not an overturning of
  it — §5 edit 1.

---

## 5 — `CLAUDE.md` edits (D3) — for T10.3 only

> **`docs/redesign/claude-md-patch.md` is the file T10.3 applies.** It carries, per entry, the
> **exact current text** (quoted so the edit is mechanical), the **exact replacement**, and the
> rationale in the surrounding file's voice. Where it and the table below differ, **the patch file
> wins** — it was written after the completeness pass and it adds entries this table does not have
> (the new `/plan` + `/shopping/history` extrapolation gotcha, the print-stylesheet contract, the
> `states` rule, and the four-tab navigation's third reachability mechanism). This table stays as
> the index of *which* entries move and *why*.

D3: where the design contradicts a locked decision, **the design is the newer decision** — implement
it and rewrite the entry **including its rationale**, never leaving the old reason standing beside
new behaviour. Thirteen edits in this table, sixteen in the patch file. Two of them (3 and 6's second half) are **corrections of statements
that were already false**, not design changes; the rewrite must keep the two kinds visibly separate
so the next reader does not think the panel used to have links and lost them.

| # | Section / entry | The claim that is now false | What the replacement must say |
| --- | --- | --- | --- |
| 1 | **Conventions → IDs / Timestamps** | "**Timestamps** integer unix ms in SQLite, ISO strings on the wire (`toIso()`)." — complete as written. | Keep the rule and add the one stated exception with its reason: `meal_plan_entries.planned_on` is `text` `YYYY-MM-DD`, because a plan entry is a **calendar date** and not an instant, and the calendar is the **user's** — the server never derives one (`Date.now()` in a UTC container is a day out for two hours every night, and local-time day arithmetic lands on 23:00 the previous day across a spring-forward boundary). Every instant, `cooked_at`/`bought_at` included, stays integer unix ms with `toIso()`/`toIsoOrNull()`. Name `packages/shared/src/calendar.ts` as the only place the conversion lives, and note that `plannedOn` goes to the wire verbatim. |
| 2 | **Navigation (four tabs…)** — the table and the bullet list | Tabs are `Rezepte / Einkauf / Importieren / Profil`; `SECONDARY_NAV_ITEMS` is Gruppen/Sammlungen/Tags. | Tabs are `Rezepte / Plan / Einkauf / Profil`. Plan took Import's slot because the planner is a daily destination and importing is not; the active tab is a 44×28 `--brand-soft` pill and Profil is a user-circle glyph (`CircleUser`), not a gear. `SECONDARY_NAV_ITEMS` is now Sammlungen / Tags / Gruppen, in that order. `NavItem["to"]` gained `/plan` and **lost `/import`**. Keep "Search is not a destination" **verbatim**. |
| 3 | **Navigation** — the bullet "**Sammlungen / Tags** ← the 'Erweiterte Suche' panel on `/`" | **This was FALSE, and had been since the sidebar-only decision.** The panel offered a collection filter `Select` and tag filter chips, not links; `grep` finds zero `to="/tags"` outside `nav-items.ts` and no `to="/collections"` outside `CollectionDetailPage`. Both screens were unreachable on a phone. | Say plainly that this is a **correction**, not a design change. The sentence is now **true** because `RecipeFilterSheet` (and the desktop `RecipeFilterRail`) carry "Sammlungen verwalten" / "Tags verwalten" links. The replacement must state that the links **are the enforcement, not a description**, so a future refactor of that panel knows it cannot drop them. |
| 4 | **Navigation** — a new bullet | Nothing states how `/import` is reached on a phone (it was a tab). | Add: **Importieren** ← the 44px `--brand` `+` in the library header, which opens an `ActionMenu` sheet offering "Neues Rezept" and "Importieren". That sheet is the **only** phone route to both `/import` and `/recipes/new` now that the tab and the `TopBar` `+` are gone — the same shape of rule as `CardsCard` being the only route to the wallet. The reachability rule therefore names **three** mechanisms, not two. `/import` remains a declared route (the PWA manifest's `shortcuts` entry and shared deep links point at it). |
| 5 | **Gotcha: "`useCanMutate()` must NOT be used on the shopping screens"** | The two-case shopping/cards opposition. | Add a third case and a new **shape** of case. `/plan` **does** use `useCanMutate()` — planner writes are online-only, so the cards rule applies. And the recipe detail header carries **two different gates on one screen**: `Zur Einkaufsliste` keeps `useEmailVerificationBlock()` (it queues offline), while `Gekocht` and `Für einen Tag planen` take `useCanMutate()` (online-only). Say the split is **per button** and must not be unified, because the existing comment on that screen argues the opposite direction for the other button. Extend the list of online-only shopping writes: list create/rename/delete **plus** `Clear bought`, catalog hide/unhide and "Remove recipe from list" — all gated on `isOnline` + `useEmailVerificationBlock()`; undo of a check-off **is** queued and carries a `mutationId`. |
| 6 | **Gotcha: "A page component must NOT re-apply `mx-auto max-w-5xl px-gutter pt-4 pb-tabbar`"** | The VALUE `max-w-5xl`; and the entry's companion sentence "the page root is `min-h-full` with a `flex-1` spacer", which **contradicts both the flex-chain gotcha two bullets later and the code** — it is `flex-1`, and `min-h-full` is precisely the thing that does not work. | The rule survives; the value does not. `<main>` is now `mx-auto max-w-content px-gutter pt-4 pb-tabbar`, where `--container-content` is 1204px = the 1440px artboards' main column minus the 236px sidebar; `max-w-5xl` (1024px) could not express the desktop artboards at all (`1a`'s `1fr 420px` hero, `1c`'s three columns, `1d`'s `1fr 340px` are drawn against 1140px of content) and the design's stated fix is "content spans the full width". A page root still re-applies **none** of the four and is a plain `flex flex-col gap-4` — with one addition: a screen that **is** a form or prose applies its own `mx-auto w-full max-w-3xl`, and that is the only cap a page root may carry. Delete the `min-h-full` clause as a **correction** and keep `flex-1`. |
| 7 | **Gotcha: "The recipe list switches MARKUP at `sm`, in JS"** | "a card leads with a 4:3 image: on a 390px phone that is ~380px per recipe" — there is no card grid any more. | The JS branch and its reason (*a `display:none` `<img>` is still fetched*) are **unchanged and still load-bearing**. But `RecipeCard` is deleted and both branches render `RecipeEditorialRow`, differing only in title step and whether the description shows — the branch now exists so the desktop row can carry a description while the phone row stays compact, and so `SkeletonList variant="editorial"` sizes its 84px thumb correctly. The `"cards"` and `"rows"` skeleton variants are gone with it. The design's own "Try next: make 1a a grid instead of rows" line is what confirms rows are the decision. |
| 8 | **Gotcha: "`block` beats `line-clamp-N`"** | Nothing false; incomplete. | Keep the cascade fact verbatim. Append: **a recipe title never truncates at all** — the design's stated fix is that editorial rows give a title a full line, so `RecipeEditorialRow`'s `<h3>`, both detail `<h1>`s and every planner day-card title carry no clamp, no `truncate` and no fixed height, and the fix for a long title is **removal** rather than reordering. The `sm:line-clamp-none sm:block sm:truncate` recipe still applies where a clamp is legitimate (`ShoppingItemTile`'s name — now `line-clamp-2` with a `min-h`, a deliberate deviation from the artboard — plus `GroupsPage` and `CollectionsPage`). |
| 9 | **Locked decision 7 (shopping lists)** | "have no `checked` column"; "Checking an item off DELETES the row and bumps a `shopping_list_catalog` entry … the Bring behaviour, chosen deliberately over a flag." | The behaviour is **RETAINED** and gains its second half: the check-off **also** appends a `shopping_bought_items` row (D4), which is what draws "Heute gekauft" and the history panel. There is still no flag on the item row, and the reason is now two-part: the `(list_id, merge_key)` unique index must stay **total** so a re-added bought item merges normally (a partial `WHERE bought_at IS NULL` index is unverified on libSQL's SQLite 3.45.1), and a persisted offline outbox entry must keep meaning "delete this row". Add `shopping_lists.bought_cleared_at` as the `Clear bought` **watermark** (it clears the section, never the log) and the log's 90-day TTL pruned on write. Then the "Häufig gekauft" clause: a catalog entry can be **hidden** (`shopping_list_catalog.hidden_at`) without losing its `use_count`; the chips are the top 8 by `use_count` **displayed alphabetically by folded name** (two separately named operations, `selectMostBoughtEntries` then `sortEntriesByFoldedName`, both in `@toon/shared`); the per-chip `×` is gone and `DELETE …/catalog/:entryId` survives as a wire contract the UI no longer calls. |
| 10 | **Gotcha: "THE SHOPPING LIST IS THE ONE THING EDITABLE OFFLINE, and four pieces make that safe"** | Nothing false; it must not be "improved". | State explicitly that **all four pieces are unchanged** — that is what D4's shape was chosen for — so nobody rewrites the outbox while adding history. Then add two facts: the log append is bound to the check-off's `DELETE … RETURNING` **actually removing a row**, not to the request arriving, which is what makes it exactly-once **with** a `mutationId`, **without** one, and under two members checking the same item simultaneously (the same gate fixes a pre-existing double `use_count` bump); and the client's `removeFromCache(..., { asBought: true })` must now also push an optimistic `bought` row (`pending:<itemId>`, "Du · gerade eben", non-interactive at `opacity-70`), or an offline check-off makes the item **vanish** instead of moving and reads as data loss on the one screen that must be trustworthy offline. Note `RETURNING` needs SQLite ≥ 3.35 and libSQL ships 3.45.1, so verify it through `@libsql/client`, never `bun:sqlite`. |
| 11 | **Gotcha: "Recipe search reads PRE-FOLDED columns"** — as a sibling paragraph | Nothing false; incomplete. | Add `recipes.last_cooked_at` as the **second** derived-but-stored column, written by exactly one writer (`services/recipes/cookLog.ts`; `recipePatch()` deliberately cannot touch it, the same rule that keeps `updateUser()` from patching `email_verified_at`). It is **nullable** and therefore does **not** use the notNull-with-no-drizzle-default trick the fold columns use — "never cooked" is a real value, so a forgotten insert cannot make a recipe unfindable. It is stored because `?sort=lastCooked` through a grouped `max()` or a correlated subquery cannot use an index and sorts the whole group in a `TEMP B-TREE`, and because `?hasCooked=1` would put the derivation in the `WHERE` of the `count(*)` that cannot stop early. Record that SQLite puts NULLs **last** under `DESC`, which is what lets `recipes_group_last_cooked_idx (group_id, last_cooked_at, created_at)` serve the order with no `is null` leading term (unlike `?sort=rating`, which pays one), and paste in the three measured medians from T4.2. Note that a `GENERATED … STORED` column is not an option on 3.45.1. |
| 12 | **Gotcha: "The service worker is generated by `vite-plugin-pwa`"** + the `globPatterns` `wasm` paragraph in `vite.config.ts` | Nothing false; the `wasm` rationale reads as though it forbade every future glob entry. | Keep the `wasm` rationale **verbatim** — still correct, still why the till path is offline-proof. Add `woff2` and why it is the **opposite** case, not a violation of the same rule: the four self-hosted font files total ~55 KB, are needed by **every** screen and are needed **offline** — an unavailable webfont reflows the shopping list at a supermarket till, which is the exact failure the offline-first design exists to prevent; `zxing-wasm` is 1.1 MB, one screen, once per card, at home, with a connection. Record that the fonts live in `apps/web/public/fonts/` (a `fonts.googleapis.com` `<link>` is banned for the same offline reason) and are preloaded in `index.html`. Add `/api/groups/*/plan` to the `NetworkOnly` enumeration, for the same reason `shopping-lists` is there: its offline copy **is** the persisted TanStack cache, and a `NetworkFirst` hit would hand TanStack a stale week that looks like a fresh success. Note that a `NetworkOnly` rule placed after the `NetworkFirst` recipes rule is never consulted. |
| 13 | **Three enumerations that grow, plus two counts** | All incomplete rather than false. | (a) **Locked decision 1** — "Recipes, tags, collections and import drafts belong to a `group`" gains `meal_plan_entries`, `recipe_cook_log`, `shopping_bought_items` and `shopping_list_recipes`; decision 11 (cards belong to the USER) survives **verbatim** and is still the only exception — say so, so the new tables are not read as widening it. (b) **Gotcha: "A LIST never renders `imageUrl`"** — the enumeration gains the library's 84px editorial squares, the planner day cards, the "Aus dem Wochenplan" thumbs, the "Kürzlich gekocht" carousel and the list rail's "Rezepte auf dieser Liste" rows; only the two recipe-detail heroes stay `imageUrl`. (c) **The two bottom-bar gotchas** — mechanics unchanged, enumerations grow by the two new instances the design adds: the recipe detail screen's `Kochmodus` + `Gekocht` bar (`1f`, inset, no bleed) and the shopping list's chip row + add bar (`1h`, `bleed-gutter-inset -mb-4`); and `-mx-4` is replaced by `.bleed-gutter-inset`, because `-mx-4` assumes the gutter is exactly 1rem, which it is not at `lg` (`--gutter:2rem`) and not on a notched device. (d) **`FOLD_PAIRS`'s closing sentence** gains its first concrete example: the redesigned "Häufig gekauft" chips are **selected** by `use_count` in SQL and **ordered** alphabetically in JS with `foldText()` — two operations, deliberately on two sides — because a SQL fold would need the uppercase twin of every accent and `localeCompare` alone sorts `Ä` after `Z`. (e) **Locked decision 2** gains the two measurements: the sidebar is 236px (`--spacing-sidebar`) and the content column caps at 1204px (`--container-content`), and both must change together. (f) **Verification gates** — `bun test`'s count moves; re-measure from one real run and set `README.md` (which says 934) from the **same** run, since the two files already disagree. |
| 14 | **Two new gotchas the redesign creates** | Nothing in `CLAUDE.md` describes `theme.css`'s structure or the type layer. | (a) **THE PALETTE IS DECLARED FOUR TIMES AND THE TWO `[data-theme]` BLOCKS ONLY OVERRIDE WHAT THEY NAME.** `:root` (light), the `prefers-color-scheme: dark` media query, `:root[data-theme="light"]` and `:root[data-theme="dark"]`. The attribute selectors are `(0,2,0)` and beat both `:root` rules — but only for tokens they actually define, so the media query's value stands for anything omitted. Measured before the redesign: `[data-theme="light"]` was missing 14 tokens (accent/success/warning/ring and all three `--elevation-*`) and `[data-theme="dark"]` was missing the three elevations, so "light on a dark phone" rendered black 70%-opacity shadows under white cards and "dark on a light laptop" had no visible elevation at all — which would silently break the two phone bars the redesign lifts with `--elevation-pop`. **Every new token goes in all four blocks.** (b) **THE DISPLAY FAMILY SHIPS EXACTLY ONE WEIGHT**, so `font-display font-semibold` is now wrong everywhere (it was correct for the old Iowan/Palatino stack, and all 26 call sites carried it). Newsreader is a single static 500 instance declared over `font-weight: 400 700` **precisely so a missed site renders the real 500 instead of synthetic fake bold** — that range is a safety net, not permission. Record the scale contract too: type comes from `--text-control` / `--text-item` / `--text-display-*` and the `.eyebrow` utility, an arbitrary `text-[13px]` is a review-blocking mistake, `.eyebrow` is deliberately **not** named `.text-eyebrow` (the hand-written utilities are emitted after Tailwind's, so a `text-*`-shaped name would silently override a real size utility on the same element), and inputs stay at ≥16px whatever the artboard drew because `@layer base`'s `font-size: max(1rem, 16px)` exists to stop iOS zooming the viewport on focus. Also: no arrow, chevron, check or ellipsis is ever a text glyph — `→ ← ✓ ▾` all fall outside both font subsets. |

**Entries that must stay VERBATIM** (the rewrite must not drift into them): the OCR/PDF two-flag
split and everything under it; the Dockerfile / compose / `toon-edge` entries; the mail entries
(`trySendMail`, `mailDeliveryOf`'s three states, `delivered` alone is not "a mail went out",
`/password/forgot`'s 204-for-both); the unconfirmed-address read-only gate and "THE TIMESTAMP, NEVER
THE BOOLEAN"; OAuth never auto-linking; `safeNextPath`; `/uploads` signing and the thumbnail
derivative; the libSQL PRAGMA and one-serialised-lane entries; the `file::memory:` transaction
workarounds; `FOLD_PAIRS` cannot be completed (only its closing example grows); `bun:sqlite` is a
newer SQLite; `shoppingItemKey`'s U+001F; the barcode encoders and black-on-white rule;
`normalizeBarcodeValue` vs `checkBarcodeValue`; the card form's format+value pairing;
`routes/cards.ts` throwing the raw `ZodError`; `clientIp()` / `TRUST_PROXY`; the import rate limits;
`skipWaiting` is OFF; `lib/unsavedWork.ts` is a counter; the language picker's third state;
`apple-mobile-web-app-status-bar-style`; `mock.module` leaks in filesystem order; the three web TS
projects; `apps/api/tests/` must never exist; `envDir`/`envPrefix`; `build.sourcemap` is off; and
the "verify a phone layout in a real headless browser" entry (which the redesign only makes more
load-bearing).

---

## 6 — Verification

### 6.1 The five gates, in this order

```bash
bun install            # must report NO CHANGES — a new dependency is a review question
bun run typecheck      # packages/shared, apps/api, apps/web (three web projects, all three listed
                       # explicitly in scripts/typecheck.ts — nothing discovers them)
bun test               # re-measure the count; set README.md and CLAUDE.md from THIS run
bun run build          # vite + PWA; then: grep -c woff2 apps/web/dist/sw.js  -> 4
bun run i18n:check     # READ THE OUTPUT, never just the exit code
```

Then, because this touches persistence and auth:

```bash
rm -f data/redesign.db*
DATABASE_URL="file:./data/redesign.db" bun run db:migrate     # fresh: all 8 migrations
DATABASE_URL="file:./data/redesign.db" bun run seed
# and again against a COPY of a pre-redesign DB — only that exercises ADD NOT NULL on a
# populated table, which is the whole reason tags.kind carries a SQL-level DEFAULT
```
…then the curl walkthrough in `README.md` ("Smoke test against a real server").

**Nothing in this redesign touches the Dockerfile, `docker-compose.yml` or
`middleware/staticWeb.ts`, so no image build is required.** If a later task does touch one, the
image has to be built (**not through a pipe** — the pipeline's exit code is `tail`'s) and the stack
actually run against the external `toon-edge` network.

**Six failures to EXPECT, five of them the type system doing its job.** (a) `NavItem["to"]` does not
contain `"/plan"` — widen the union, never cast. (b) Every new `de` key is a compile error in its
`en` twin until both exist — that is the progress meter for the copy work. (c) Widening
`RecipeSortSchema` breaks every exhaustive `switch` over `RecipeSort` (the API's order-by map, the
web sort control) — and the label must be a `*_LABEL_KEYS` map of catalog keys, **never** a frozen
label map. (d) `tags.kind` produces **no** `$inferInsert` errors, because it carries a drizzle
`.default("free")`; if you do see them, the default was omitted and the column now behaves like the
fold columns, which is not what was decided. (e) A new co-located `*.test.ts` under `apps/web/src`
needs **no** config edit — `tsconfig.test.json` includes it and `scripts/typecheck.ts` already
lists all three projects; only a **fourth** project would need a line.
(f) **`bun run typecheck` and `bun test` are NOT green at every phase boundary, and that is
planned** — see §1's "the gates are green at phase 11". `TagSchema.kind` is required in phase 2
before T4.2's mapper supplies it; `ShoppingListDetailResponseSchema.bought`/`recipes` are required
in phase 2 before T4.3 supplies them; a `de` key is a compile error until its `en` twin lands in
the same task. What is **not** acceptable at a phase boundary is a **dangling import or a route
pointing at a missing module** — a planning error, not a type-system one. The first draft had three:
`/shopping/history` routed with no page (now T8.8), `features/recipes/index.ts` re-exporting three
deleted components (now T8.1/T8.2), and `i18n.test.ts`'s prefix array (now T6.1).

**How to read `i18n:check`.** It is grep-shaped and **exits non-zero even when the tree is
correct**. Filter the comment hits and check what is left:

```bash
bun run i18n:check 2>&1 | grep -vE ':[0-9]+: *(\*|//|/\*)'
```

Everything remaining must be on one of the three known false-positive lists: (1) **parity —
genuinely NEW German copy**, which after this redesign is the dominant output; (2) English comments
quoting a German UI label; (3) CONTENT vocabulary (`UNIT_SUGGESTIONS`, the ingredient paste
placeholders, `STEP_HEADING_RE`, `html/entities.ts`'s umlaut table, **and now
`packages/shared/src/tags.ts`**, allow-listed in T10.2). **The procedure that matters:** for every
parity hit, decide whether it is *new* copy or a *reworded existing* string. A reworded string is a
**genuine failure** and looks byte-identical in the output to a new one — any label the design
merely restyled must still be byte-identical, umlauts, `„low-high“` quotes, en-dashes, trailing
colons and ellipses included. **Do not set `I18N_CHECK_BASE`** (on `redesign` it resolves to the
pre-redesign commit, which is what makes check 1 meaningful) and **do not bulk-add to `NEW_GERMAN`**
(one entry per key with a reason, or it is a mute button). Actively hunt for the one failure `tsc`
cannot see: German prose in an `ApiError`'s `details` slot rather than its message slot — that is
exactly how the literal in `services/groups/validation.ts` went out on the wire untranslated.

### 6.2 The headless-browser runbook (T11.2)

**Verify a phone layout in a real browser, not by reading Tailwind classes.** Both layout bugs
`CLAUDE.md` documents measured wrong on the first attempt and only the screenshots showed it.

1. **Install Playwright OUTSIDE the repo** — `~/.cache/toon-verify`, `bun add -d playwright &&
   bunx playwright install chromium`. It drags ~115 MB of Chromium; it must never reach a
   workspace, and `bun install` in the repo must still report no changes (Bun 1.4's isolated linker
   means any dependency change rewrites the root plus two workspace symlink trees).
2. **Drive the dev servers** and log in with a `fetch` to `/api/auth/login` **from the page
   context** — same-site cookie, so `credentials: "include"` is enough.
3. **Assertions at 390×844** on `/`, `/recipes/$id`, `/shopping`, `/shopping/$listId`,
   `/shopping/history`, `/plan`, `/import`, `/collections`, `/settings`:
   - `documentElement.scrollWidth - documentElement.clientWidth === 0` — assert the **delta**, and
     the seven-column plan grid plus the widened content column are the new risks;
   - `getComputedStyle(main).paddingLeft === "16px"` at 390 and `"32px"` at 1440 (the `--gutter`
     variable, never a second padding utility);
   - **no element carries both `px-4`/`px-2` and `px-safe`**;
   - every `<fieldset>` reports `min-inline-size: 0px`;
   - every recipe title reports `webkitLineClamp: "none"` (the "titles never truncate" rule);
   - the page root re-applies none of `mx-auto` / `max-w-5xl` / `px-gutter` / `pb-tabbar`;
   - the gap between each sticky bottom bar and the tab bar is 0 — on the recipe detail
     (`Kochmodus` + `Gekocht`), the shopping list (chips + add bar), the recipe form's save bar and
     the import review footer.
   - **DO NOT match the tab bar by its `aria-label`.** `SideNav`'s `<nav>` carries the same one and,
     being `display:none` on a phone, returns an **all-zero rect that reads as a plausible wrong
     number**. Match `nav.fixed` or a `data-testid`, and keep a permanent `height === 0` guard
     before using any rect.
4. **Fonts actually resolved:** `document.fonts.check("500 21px Newsreader")` and
   `document.fonts.check("600 14px Figtree")` are both true, **no request to
   `fonts.googleapis.com`**, and no request to `/fonts/*` on the **second** load. This is the single
   most likely first-attempt failure of the whole redesign and it is invisible to every gate: a
   font emitted to `dist/assets/` still matches the glob, so the build is green while the
   `/fonts/...` preload 404s and every screen renders in the fallback stack.
5. **At 1440×900:** the sidebar is exactly 236px, the content column 1204px, and no strip of
   `--bg` shows between them.
6. **Light mode in all four states** on `/`, `/recipes/$id`, `/shopping`, `/shopping/$listId`:
   OS-light + no `data-theme`; OS-dark + `data-theme="light"`; **OS-light + `data-theme="dark"`**
   (the combination that was broken and that nobody checks); OS-dark + no `data-theme`.
7. **One production pass** (`bun run build && bun run preview`) to confirm the service worker
   precaches the four woff2 and that `/api/groups/*/plan` is never served from a cache.
8. **Attach the 390px and 1440px screenshots of `/plan` AND `/shopping/history`** to the PR —
   they are the two screens with no reference, so the screenshots *are* the reference.
9. **The fake-camera pass on the card form**, because T9.4 restyles `ScannerDialog.tsx` and
   `CLAUDE.md` says outright that this is the only way to cover the scanner at all. Chromium takes
   `--use-fake-device-for-media-stream` plus `--use-file-for-fake-video-capture=<file>.y4m` and
   Playwright's `permissions: ["camera"]` grants the prompt: render a barcode with the repo's **own**
   encoder through the dev server, screenshot it, `ffmpeg -loop 1 -i x.png -t 3 -r 15 -pix_fmt
   yuv420p -s 640x480 -f yuv4mpegpipe`, then open the card form and press Scannen. It covers what no
   unit test can — the `?url` wasm asset resolving, `locateFile` pointing at it, the decode loop
   reading frames, and the form being filled with the right FORMAT as well as the right value. It
   found the `<video>`-Safari-refuses-to-play bug the first time it was run. **If T9.4 ends up
   class-only** (no change inside `scanFromCamera` or `lib/scan.ts`), the task may say so in the PR
   and skip this step — but it has to be one or the other, not silence.
10. **The state matrix, not just the populated screen.** For each of the six screens R44 names,
    load it once with data and once empty (a fresh group is the cheapest way: create one through
    `/api/groups`, switch to it, and screenshot `/`, `/plan`, `/shopping`, `/shopping/$listId`).
    The empty pass is what catches the two components that are empty for every existing install.
11. **Print to PDF from the recipe detail screen at 390px and at 1440px** (Playwright's
    `page.pdf()` after `emulateMedia({ media: "print" })`), and assert the nav and the tab bar are
    absent and that **both** the ingredients and the method panels are present. `print.css` is
    invisible to all five gates, which is how it stayed dead.

**Not verifiable headless, and it must be said so in the PR:** the `pt-safe` move off the deleted
`TopBar` needs a **real iOS home-screen install** to see. `apple-mobile-web-app-status-bar-style:
black-translucent` stays banned.

---

## 7 — What is reconstructed or extrapolated

**This is the list the PR description has to be honest about (D6).** Nothing here has a drawn
reference; everything here was assembled from named sources and is the first place to re-check if
an artboard is ever drawn.

1. **The desktop recipe library** (screen A) — the one intended screen with no artboard
   (SPEC §1: seven artboards for eight screens). Assembled from four real sources, and every
   decision in A04 §3 is tagged with which one drove it: **S1** `1e`'s content order · **S2** the
   five unused `renderVals()` datasets (`recipes`, `week`, `recent`, `courseFilters`, `tagFilters`,
   which no artboard renders and which *are* this screen's data) · **S3** the `#t1` intro copy
   ("content spans the full width with a filter rail, planner strip and a two-column shopping
   layout", "titles never truncate", "tag clutter: cards show one category; tags move to the filter
   rail") · **S4** the 236px desktop chrome from `1a`/`1c`/`1d`, verbatim.
   **Five choices inside it have no source at all** and are tagged `[RECON]`: the filter rail's
   220px width; the "Mehr Filter" disclosure holding Sammlung/Schwierigkeit/Zeit; the sort
   control's move into the `h1` row; "Kürzlich gekocht" sitting **above** "Alle Rezepte" (nothing
   may sit below an infinite list); and the planner day card gaining a meta line.
2. **The `/plan` screen** — no artboard **at all** (SPEC §4.1 says so outright). Extrapolated from
   the three drawn day-card states in the library's "This week" strip, the page-header shape of
   `1c`/`1g`, the 340px rail and 26px gap of `1d`, `1d`'s section-header pattern, `ActionMenu` as
   the repo's existing sheet model, and phase 1's type scale. **The largest invention is the phone
   layout**: a vertical list of seven day rows rather than the library's horizontal four-day strip
   (R35). The 390px and 1440px screenshots attached to the PR are its only reference.
3. **`/shopping/history`** — the destination of `1c`'s `Bought history → All`, which was never
   drawn (SPEC §6.4). Extrapolated from the history panel's own row shape (day header + rows) plus
   the shell. Its data contract is T4.3's and **its screen is now T8.8's**, at the pinned scope in
   R45 (read-only, day-grouped, `offset`-paged, list filter, no per-row actions). It is the second
   screen whose PR screenshots **are** its reference, and R45 records the cheaper
   expand-in-place alternative as open item O4.
4. **The light-mode twins of the four new tokens** — the design is dark-only and light was never
   drawn. `--bg-sunken`, `--fg-body`, `--fg-faint` and `--accent-strong` each got a light value
   derived by **matching the dark value's measured contrast against its own theme ground**, not by
   walking the ramp the same number of steps (the two ends of a warm ramp are not perceptually
   symmetric). Light `--success` is additionally corrected from `--toon-herb-500` (4.20:1, just
   under AA) to `--toon-herb-600` (6.11:1) because the design makes it load-bearing as 11px text.
5. **`--fg-faint` deviates from the drawn hex on purpose** — `#8d7c67` instead of `#6b5c4b`, across
   24 pieces of 11px/700 copy (R11, open item O1). This is the **only place the plan knowingly does
   not match the artboards' colour**, and it is a one-line revert.
6. **The two type-scale collapses** — the design's 19/20/21/22px serif headings collapse to 21px and
   28/30px collapses to 28px. Worst case is ≤1px on any element except the phone shopping-list `h1`
   (−2px), and the direction was chosen so the long-German-title recipe-detail `h1` does **not**
   grow on a 390px screen. The 14 drawn sans sizes collapse to six steps and the 20 eyebrow
   spellings to one `.08em`.
7. **Two inputs render larger than drawn** — the library search field (14.5px) and the shopping add
   bar (15px) both ship at `text-base` (R12), because below 16px iOS zooms the viewport on focus,
   which on the shopping list also shifts the sticky bar under the keyboard.
8. **The mobile shopping tile clamps to two lines** where the artboard shows one (R39) — the only
   place the plan *adds* a clamp.
9. **The loyalty-card tile has no gradient** where the artboard draws a Payback blue (R42) —
   `cards` has no colour column and the blue is a cold hue in a warm palette.
10. **The ~15 screens the design never drew (D6)**, all brought onto the same tokens, type scale
    and component shapes by extrapolation from A01 §5.1's lookup table: `RecipeNewPage`,
    `RecipeEditPage`, `RecipeForm` (+ `IngredientsEditor`, `StepsEditor`, `RecipeImagePicker`,
    `CookMode`), `ImportPage`, `ImportReviewPage`, `PendingDraftsList`, `CollectionsPage`,
    `CollectionDetailPage`, `TagsPage`, `GroupsPage`, `GroupDetailPage`, `MemberList`,
    `InvitePanel`, `CardsPage` (+ `CardDisplayDialog`, `CardFormDialog`, `ScannerDialog`),
    `AccountSettingsPage`, `NotFoundPage`, `ErrorBoundary`, the four banners, and the seven auth
    screens under `AuthLayout`.
11. **Two server-side facts the design implies but never shows:** the `Clear bought` watermark
    (SPEC §4.3 asks for a decision and gets one) and the 90-day bought-log TTL.
    **`meal_plan_entries.note` is DROPPED** — the first draft kept a nullable column that no
    artboard draws, no endpoint reads and no DTO carries, on the argument that a column costs
    nothing. It costs the next person a decision: dead schema is how a second, differently-shaped
    `note` column gets added later, and adding this one is a single migration line whenever `/plan`
    actually grows a note field.
12. **`shopping_list_recipes`** — a table SPEC §4 never lists as a workstream, added so `1d`'s
    "5 von 5 Zutaten · 4 Portionen" rail can render literally (R10, open item O2).

---

## 8 — Open items

Decided here where the spec or the repo gave enough to decide, with the reason. Only three go to
the owner, and each has a default so the plan proceeds if nothing is said.

### 8.1 SPEC §6's six, all decided

| SPEC § | Item | Decision | Reason |
| --- | --- | --- | --- |
| 6.1 | **Share** on a shopping list | `navigator.share({title,text})` of the list as plain text through the existing `shareOrCopy` helper, clipboard fallback, **no backend** (R40) | A real share token is a new **unauthenticated read surface** and nothing else in the design implies one. |
| 6.2 | **`Sort: newest`** | Three client-side options in a `<Select>` — `Reihenfolge` (today's `position` order, **default**), `Neueste zuerst`, `A–Z` (folded with `foldText()`). No `?sort=` param (R32) | A request-dependent order would defeat the "every mutation returns the whole list" contract. The artboard's "neueste" is a mock's current value, not a default; changing everyone's existing order is gratuitous. And do not build a menu with one item. |
| 6.3 | **"Lena is shopping now" / "synced 2 min ago"** | Both derived, **no websocket** (R33): "synchronisiert" from the query's own `dataUpdatedAt`; the shopper line from the newest `bought` row when it is <15 min old **and** by someone else; otherwise neither renders | Real-time presence is not in this codebase and nothing else in the design needs a socket. Both facts are already in data the screen holds. |
| 6.4 | **`Bought history → All`** | A real route, **`/shopping/history`**, with `listId` + `offset` params (extrapolated screen — item 3 in §7) | It is a paginated, deep-linkable archive: a dialog cannot hold `offset`, cannot be linked from the phone list rail, and loses its place on every re-render. It hangs off `/shopping`, which **is** a tab, so the phone-reachability rule is satisfied without a new tab — the same argument that already justifies `/shopping/cards`. |
| 6.5 | **Progress-bar denominator** | **Confirmed: `bought / (toBuy + bought)`** — `4/(10+4) = 28.6% → 29%`, exactly the mock. `shoppingProgressPercent` in `@toon/shared` with a test pinning `(10,4) === 29` | Confirmed by the artboard's own arithmetic, and it means `Clear bought` honestly resets the bar to 0% rather than freezing it at a historical number. |
| 6.6 | **`+2 more` / preview size** | **Confirmed: 8 items, from the LIST index endpoint** (`previewItems` on `ShoppingList`), `+N` = `itemCount - previewItems.length` | A per-list detail fetch to render 8 names would make `/shopping` N+1 requests against a single serialised write lane. |

### 8.2 The area specs' open questions, decided

| Item | Decision | Reason |
| --- | --- | --- |
| Undo for `Cooked` | **Ship it** — `DELETE …/recipes/:recipeId/cooked`, own row only, 10-minute window, recompute `last_cooked_at` (R18) | ~30 lines, no new wire code; the alternative is a one-tap irreversible write beside "Cook mode" on a phone. |
| `meal_plan_entries.note` | **DROPPED** (reversed after the completeness pass) | It ships unused, which the first draft admitted. Dead schema invites a second, differently-shaped column later; adding it when `/plan` grows a note field is one migration line. |
| Empty / loading / offline states on the six new or rewritten screens | **Named per screen in R44**, plus a `"daycards"` `SkeletonList` variant | The artboards draw one state per screen. Two components are empty for every existing install on day one (R41 ships no backfill), so an empty shelf under a heading is the default outcome, not an edge case. |
| The three unclaimed `ui` primitives and ~20 unclaimed D6 files | **Given owners** — T1.9, T9.1 (six import components), T9.5 (seven auth pages + `OAuthButtons`), T9.7 (two shopping + two tag components) | D6 says the app is never half-redesigned; an unowned file on a redesigned path is a half-redesigned screen, and `Badge`'s `text-[0.7rem]` additionally fails T10.2's own grep gate. |
| `features/recipes/index.ts`, `print.css`, `lib/i18n/i18n.test.ts` | **Given owners** — T8.1/T8.2/T8.4, T8.4, T6.1 | Each is a red `tsc`, a red test or a silently broken feature (printing has never excluded the nav, because `data-app-shell` was on no element). |
| Several entries per day | **Keep the capacity**; strip shows the first + `+N`, `/plan` shows all (R36) | A flatshare plans lunch and dinner; the unique index already stops the accidental duplicate. |
| Auto-promoting existing tags to courses | **No backfill.** `/tags` gets a kind toggle; the release notes name the one-time step (R41) | Promoting by name writes an irreversible guess about German content into somebody else's data and would mis-mark a free tag named "Dessert". The UI is designed for the absence. |
| `?hasCooked` as a URL filter | **Out of `RECIPE_FILTER_PARAMS`** until a UI can clear it (R26) | A URL mode no UI can clear is worse than none. When the toggle lands, the array line lands in the same commit. |
| Newsreader static-500 vs its two-axis VF | **Static** (~28 KB vs ~90 KB latin; we need exactly one weight) | Recorded as a rejected alternative — it is a drop-in one-`@font-face` swap if the precache budget is ever reopened. |
| Whether Figtree's subset carries `tnum` | **Verify with `fonttools ttx -t GSUB` and report in the PR**; if genuinely absent, fixed `ch` widths, never a dead class | `pyftsubset --layout-features=''` would drop it silently and every `tabular-nums` would be a no-op with no error. |
| A metrics-matched fallback face (`size-adjust` / `ascent-override`) | **Out of scope, follow-up** | The override numbers must be measured against the actual shipped files; guessing them is worse than the swap CLS. |
| `--radius-panel` (18px) | **Not added**; 18 collapses to `rounded-card` (R13) | A 2px delta on one card family is not worth a token plus a prop plus four call sites choosing. |
| `IconButton` 40px | **Not added**; the `+` is 44px (R14) | 44px is the repo's stated touch-target floor, and `cn()` has no tailwind-merge so a caller override would not work anyway. |
| Desktop one-click logout | **Accepted loss** (R34) | The artboard's footer draws a gear and no sign-out; `/settings` has the card. If missed, the fix is an `ActionMenu` on the footer row, not a second icon button. |
| `catalogs/index.ts` (marked FINAL) being edited | **Sanctioned, once, in T6.1, flagged in the PR** | A namespace cannot register itself; the change is two imports and two spread entries. |
| Both the `+` sheet and the explicit buttons showing between `sm` and `lg` | **Leave it** | Hiding the `+` above `sm` needs a second breakpoint on `PhoneHeaderRow` and would leave 640–1024px with no group indicator at all, since the sidebar only appears at `lg`. |
| `/plan` bulk "add the week to a list" | **Not this pass** (R37) | Per-entry "Zutaten zur Einkaufsliste" covers the journey and forces no decision about a default list. |
| `bought_by` nullable vs SPEC's `not null` sketch | **Nullable, `ON DELETE set null`** (R17) | A group's purchase history must survive a member deleting their account. |
| `ingredientTotal` live vs frozen | **Live, documented** (R22) | "5 von 6" after a recipe gains an ingredient is exactly the "add the missing one" prompt. |
| A per-ROW dismiss on a bought line | **No** | The design offers only `Clear bought`; a per-row dismiss needs the rejected `cleared_at` column, not a hack on the watermark. |
| A per-list row cap on the bought log | **TTL only** | 500 items per list bounds one trip; if a cap is ever needed it is one `DELETE … WHERE id IN (SELECT … LIMIT n)` in `pruneBoughtLog`, never `pruneCatalog`'s per-row loop. |
| `GET …/summary` for the sidebar counts | **No endpoint** (R23) | Two existing, already-persisted queries answer all three numbers; the real bug is a missing `invalidate.me`. |
| Persisting the bought history | **Persist it** — one `"shopping-bought"` segment (R24) | It renders on `/shopping`, which is already a persisted offline screen; an unpersisted panel there is a spinner that never resolves. |
| `PageColumn` vs per-screen `max-w-3xl` | **Per-screen `max-w-3xl`** (R33b) | 768px is the measured comfortable form width; a wrapper component carrying only a max-width is a component for nothing. |
| The five `[RECON]` desktop-library choices | **Ship as specified in A04 §3, each tagged** | They are the first five places to re-check if the artboard is ever drawn — see open item O3. |

### 8.3 For the repo owner (four)

Each has a recommendation the plan already implements, so silence is a valid answer.

**O1 — `--fg-faint`: honour the drawn hex, or the accessible one?**
The artboard's `#6b5c4b` measures **2.88:1** on `--bg` and **2.67:1** on `--surface`, and the design
uses it for **24** pieces of 11px/700 copy (stat captions, `Organise`, `To buy`, the `from`
provenance label, `+2 more`, `who · when`, the chip hint). That is under WCAG AA for normal text
(4.5:1) **and** under the large-text floor (3:1).
*Options:* (a) `#8d7c67` — the next ramp stop, 4.61:1, five foreground tiers still distinguishable;
(b) `#6b5c4b` exactly as drawn.
*Recommendation and what the plan does:* **(a)**, because `components/ui/index.ts` already commits
the primitives to accessibility as a stated convention. It is **one line in `theme.css`** either
way, so it can be flipped after the branch is reviewable — the implementation must not fork over it.

**O2 — `shopping_list_recipes`: a new table for two numbers the artboard shows?**
`1d`'s right rail draws "5 von 5 Zutaten · 4 Portionen" per recipe. The ingredient total is
derivable; **the servings used at add time is not** — `source_recipe_ids` is per-item and is
rewritten by every merge. SPEC §4 never lists this table as a workstream, and it is the only
persistent state this plan adds that the contract did not ask for.
*Options:* (a) ship the table (6 columns, additive, cascades from the list) and render the artboard
literally; (b) drop both numbers, render "{n} Zutaten auf der Liste" derived from provenance, and
keep the schema untouched.
*Recommendation and what the plan does:* **(a)**, because D2 says the design wins on visuals and
"4 Portionen" is the fact that tells a flatmate whether the amounts on the list are the ones they
wanted. (b) is a real option if the owner would rather not grow the schema — it changes one panel
and one endpoint and nothing else.

**O3 — the desktop recipe library: draw `1b` first, or review the reconstruction?**
It is the one *intended* screen with no artboard, and five of its choices have no reference at all
(the 220px rail width, the "Mehr Filter" disclosure, the sort control's home, the shelf's placement,
the day card's meta line).
*Options:* (a) implement the reconstruction now and review it in the PR against A04 §3's
source tags; (b) draw the artboard first and hold phase 8's library tasks.
*Recommendation and what the plan does:* **(a)** — the reconstruction is assembled from four real
sources rather than invented, the five open choices are each tagged, and holding phase 8 would idle
the largest phase behind one canvas edit. (b) is cheap to switch to later: only T8.1–T8.3 would be
revisited, and nothing downstream of them depends on those five choices.

**O4 — `/shopping/history`: a real screen, or expand the panel in place?**
`1c` draws a `Bought history` panel with an `All` link and the destination was never drawn
(SPEC §6.4 lists it as an open item, not a requirement). Shipping it costs: one endpoint
(`GET …/bought`, T4.3), one route + two search params (T5.2), ten catalog keys (T6.3), one screen
(T8.8) and one more set of PR screenshots — the largest surface in the plan that the contract did
not ask for.
*Options:* (a) ship it at R45's pinned scope — read-only, day-grouped, `offset`-paged, list filter,
no per-row actions; (b) `Alle` expands the panel **in place** over the ≤100 rows the list-detail
payload already carries, and the endpoint, the route, the params, R24's deep-page reasoning and
T8.8 all disappear.
*Recommendation and what the plan does:* **(a)**, because `All` is a drawn element and (b) changes
what a drawn element does; and because "everything we bought, by day" is the fact a flatshare
actually argues about. (b) is a genuinely smaller diff and is a one-task deletion if the owner
prefers it — say so before phase 4, because the endpoint is T4.3's.

---

## 9 — Critic findings not actioned, and why

The completeness pass produced 39 findings. Thirty-six are folded into §2–§8 above, five of them as
new tasks (T1.9, T7.5, T8.8, T9.7 and the R44 states clause) and three as new rulings (R44, R45,
R46). These are the ones left standing, deliberately, so nothing is silently dropped.

**F32, third item — "`1d`'s right column opens `<div>` and closes `</aside>`". Not actioned: it is
not true.** `design.dc.html:216–234` opens `<!-- right column --> <aside …>` and closes `</aside>`,
and `grep -c '<aside'` / `grep -c '</aside>'` both return 4 across the file. The other two items in
that finding **are** real and are actioned in T8.4 (the `15`/`12` ingredient count and the
`6 steps`/`4` mismatch, both of which must come from `.length`).

**F36 — "cut `GET …/bought` + `/shopping/history` + its params + copy + screen". Not actioned as a
cut; actioned as a scope pin plus an owner decision.** The finding is right that this is the
largest surface the contract did not request, and right that the cheapest honest version is an
in-place expansion. It is not cut because `1c` draws an `All` link and SPEC §6.4 asks what it points
at — changing a drawn element's behaviour is a design deviation, and D2 gives the design the visuals.
Recorded as **R45** with the pinned scope, and as **open item O4** with the expand-in-place variant
costed, so the owner can take the smaller diff with one sentence. The blocker half of the finding
(the route had no component) is fixed either way, by **T8.8**.

**F37 — "cut `DELETE …/cooked` (R18)". Not actioned as a cut; actioned as a placement.** The
finding's real complaint is F7's: the endpoint shipped with no affordance anywhere, which is what
made it look like over-building. R18 is amended to name three owners (T8.4's button + toast, T7.4's
menu item, T7.3's hook). A one-tap irreversible write beside "Kochmodus" on a 390px phone is the
alternative, and ~30 lines with no new wire code and no new error code is the right price for not
shipping that.

**F39 — "T1.2 item 4 changes light mode on ~15 unrelated screens". Actioned as a note, not a
change.** The fix stays (all four `theme.css` blocks must define the same 39 tokens, or the two new
`shadow-pop` phone bars are invisible in one of the four theme states). It is now named as a
**user-visible change** in T1.2's own "done when" and in T10.1's known-gaps section, which is what
the finding actually asked for.

**F35 — `meal_plan_entries.note`. Actioned in full: the column is dropped** (T3.1, §7 item 11,
§8.2). Recorded here only because the first draft argued for keeping it and the reversal should be
visible rather than look like an omission.

**F8's `WeekStrip` sub-point — "four identical `+ Plan` cards on a phone must be a decision".
Actioned as a decision, not as a change.** The phone strip keeps `week.slice(3,7)` and keeps
rendering four empty day cards when nothing is planned: the empty card is a **drawn, tappable**
state and four tap targets for the next four days is the affordance that gets a first entry into
the plan. T8.3 records it as a decision so it is not read as an accident.

**F13's `AddRecipeToListDialog` sub-point — "referenced only in a gotcha".** Actioned by **T9.7**,
which owns the file — but the gotcha in T8.6 **stays** as well. It is the one place that states the
EXCLUDED-set invariant, and a reader of T8.6 has to know they may not touch it.

**One finding the pass did not make, folded in anyway.** `i18n-keys.md` §12 row 11 assigns four new
`Intl` formatters to T8.1 (phase 8) while `/plan` (phase 7) needs three of them — the same backwards
dependency as F5, one file over. `apps/web/src/lib/format.ts` moves to **T7.5**, and §3's ownership
row is corrected. §3 also said `formatWeekdayShort`/`formatDayOfMonth` would not be added at all;
there are four consumers, so they are.
