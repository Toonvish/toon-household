# 01 — Design system: typography, tokens, and the `components/ui` delta

Area owner spec for the `redesign` branch. Read `docs/redesign/SPEC.md` (the contract, D1–D7)
and `CLAUDE.md` first — this file does not restate either.

**Scope.** Fonts, the type scale, the token layer (`styles/theme.css` + `styles/index.css`),
and every file in `apps/web/src/components/ui/`. Plus the extrapolation rules the other
areas apply to the ~15 screens the design never drew (D6).

**Out of scope.** Per-screen layout (areas 04/05), nav/shell structure, the new tables and
endpoints. Where a rule here constrains another area it is called out under
[§7 Cross-area contracts](#7--cross-area-contracts).

**This area lands FIRST.** Everything else consumes it. Nothing in areas 02–07 can be
implemented against the old `font-display`/`shadow-card`/`rounded-xl` shapes and then
retro-fitted.

---

## 0 — What was audited, and how

Every number below was extracted from `docs/redesign/design.dc.html`, not estimated:

```
grep -o 'font:[^;"]*Newsreader[^;"]*' design.dc.html | sort | uniq -c    # 14 serif sizes, ALL weight 500
grep -o 'font-weight:[0-9]*'          design.dc.html | sort | uniq -c    # 500 x17, 600 x47, 700 x32
grep -o 'font-size:[0-9.]*px'         design.dc.html | sort | uniq -c    # 14 sans sizes, 9px..18px
grep -o 'letter-spacing:[^;"]*'       design.dc.html | sort | uniq -c    # -0.01em x2, .06em, .07em, .08em x18
grep -o 'border-radius:[^;"]*'        design.dc.html | sort | uniq -c    # 10px x44 is the mode
grep -o '#[0-9a-f]\{6\}'              design.dc.html | sort | uniq -c    # 36 distinct hexes
```

Colour classification and the light-mode derivations were computed from the WCAG relative
luminance formula; every ratio quoted in §3 is a measured number, not a guess.

---

## 1 — Typography: the two families

### 1.1 What the artboards actually use

**Newsreader (`--font-display`): ONE face. Weight 500, upright, no italic.**
All 14 serif sizes in the file are `font:500 …px Newsreader`. There is no `600`, no `400`,
no `font-style:italic`, and the single `<em>` in the document sits in the canvas's own intro
prose (`#t1`), not in an artboard. The app has no `<em>` and no `italic` class anywhere
(`grep -rn "<em>\|italic" apps/web/src` → 0 hits).

**Figtree (`--font-sans`): four weights. 400, 500, 600, 700. No italic.**
400 is the implicit body weight (`body{font-family:Figtree}` with no `font-weight`), and
`font-weight:` appears as 500 (x17), 600 (x47), 700 (x32).

The Google Fonts `<link>` at the top of the design file requests `Newsreader` 400/500/600
plus italic 400 and `Figtree` 400/500/600/700. **Ignore the link — it is what the canvas
tool emitted, not an inventory.** Shipping Newsreader 400, 600 and italic 400 would be
three unused faces in a precached PWA bundle.

### 1.2 Variable vs static — different answer per family

| Family | Faces needed | Ship | Why |
| --- | --- | --- | --- |
| **Figtree** | 4 weights (400–700), 1 style | **Variable, `wght` 400–700** | One `wght` axis. A `wght`-only VF subset to latin is ~24 KB and covers all four weights *and* every value between them; four static instances are ~4 × 12 KB latin + 4 × 4 KB latin-ext ≈ 64 KB across 8 files (8 `@font-face` blocks, 8 cache entries, 8 possible preloads). VF wins on bytes, on file count and on future-proofing. |
| **Newsreader** | 1 weight, 1 style | **Static instance, `wght 500`** | Newsreader's VF has **two** axes (`opsz 6..72`, `wght 200..800`); a two-axis latin VF is ~90 KB against ~28 KB for one static instance. We need exactly one weight, so a VF buys only optical sizing — which *would* genuinely help a family used from 15 px to 46 px, but not for 60 KB in a PWA whose whole point is that the shopping list renders at a till with no signal. |

**Rejected alternative, recorded so it is not relitigated:** Newsreader VF with
`font-optical-sizing: auto`. It is the typographically better choice and the wrong
engineering choice here. If the precache budget is ever revisited, this is the first thing
to reconsider — and it is a drop-in swap (one `@font-face`, one `src`, add
`font-variation-settings` nothing else).

### 1.3 Files

Create `apps/web/public/fonts/` with exactly four files:

```
apps/web/public/fonts/
  figtree-latin.woff2            variable, wght 400..700, unicode-range: latin
  figtree-latin-ext.woff2        variable, wght 400..700, unicode-range: latin-ext
  newsreader-500-latin.woff2     static instance wght 500, unicode-range: latin
  newsreader-500-latin-ext.woff2 static instance wght 500, unicode-range: latin-ext
```

How to produce them (both families are SIL OFL 1.1 — commit the `OFL.txt` of each next to
the files as `apps/web/public/fonts/LICENSE-figtree.txt` /
`LICENSE-newsreader.txt`):

1. Take the upstream `Figtree[wght].ttf` and `Newsreader[opsz,wght].ttf`.
2. Narrow / pin the axes:
   ```
   fonttools varLib.instancer Figtree[wght].ttf wght=400:700 -o figtree-400-700.ttf
   fonttools varLib.instancer 'Newsreader[opsz,wght].ttf' wght=500 opsz=18 -o newsreader-500.ttf
   ```
   `opsz=18` because the *median* serif size in the artboards is 20–21 px; pinning at the
   hero size would make the 15 px row titles spindly.
3. Subset each to the two ranges with `pyftsubset --flavor=woff2 --layout-features='*'`
   (keep `*` — see the `tnum` note in §2.5).

`unicode-range` values (Google's, verbatim — do not shorten them, the tails carry the
punctuation the design uses):

```
latin:      U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC,
            U+0304, U+0308, U+0329, U+2000-206F, U+2074, U+20AC, U+2122, U+2191,
            U+2193, U+2212, U+2215, U+FEFF, U+FFFD
latin-ext:  U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF,
            U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020,
            U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF
```

German content (`ä ö ü ß`), `·` U+00B7, `–` U+2013, `„ “` U+201E/U+201C, `…` U+2026,
`›` U+203A and `−` U+2212 are all inside **latin**. `latin-ext` earns its place for
user-entered names and imported recipe text (`č ł ő ș`), and costs nothing until such a
character appears.

### 1.4 GLYPHS THE DESIGN USES THAT ARE IN NEITHER SUBSET

**This is a real bug waiting to happen, and it must be fixed at transcription time, not
found in the browser.** Four characters the artboards type as text fall outside both
`unicode-range`s. They will silently render from the *fallback* family (or as tofu, if the
fallback lacks them too), which is exactly the reflow the self-hosting decision exists to
prevent:

| Char | Codepoint | Where the design uses it | REPLACE WITH |
| --- | --- | --- | --- |
| `→` | U+2192 | `Plan →` (1e), `Open →` (1c) | `<ArrowRight />` from `lucide-react` |
| `←` | U+2190 | `← All lists` (1d), `← Lists` (1h) | `<ArrowLeft />` |
| `✓` | U+2713 | `cooked ✓` on a planner day card, the `Cooked` button | `<Check />` |
| `▾` | U+25BE | group-switcher chip (1e/1g), `Bought today ▾` (1h) | `<ChevronDown />` |

The design's `−` / `+` stepper glyphs (U+2212 / U+002B) *are* in latin, but use
`<Minus />` / `<Plus />` anyway — `ServingsScaler` already does, and an icon is the only
way to get a 44 px target with a centred mark.

**Rule: no arrow, chevron, check or ellipsis-menu mark is ever a text character in this
app.** Every one is a `lucide-react` icon.

### 1.5 `@font-face` — new file `apps/web/src/styles/fonts.css`

Kept out of `index.css` so that file stays readable; `@import` must precede other rules,
so it goes immediately after the Tailwind import.

```css
/* apps/web/src/styles/index.css — first three lines become: */
@import "tailwindcss";
@import "./fonts.css";
@import "./theme.css";
```

```css
/*
 * apps/web/src/styles/fonts.css
 *
 * SELF-HOSTED, NOT fonts.googleapis.com. This is an offline-first PWA whose shopping
 * list has to render at a supermarket till: a webfont that 404s offline reflows every
 * screen from Newsreader/Figtree to Georgia/system-ui, which changes line counts and
 * therefore layout. The four files are precached by the service worker (see the
 * `woff2` entry in vite.config.ts globPatterns) so after the first install they are
 * never fetched again.
 *
 * WEIGHT RANGES ARE DELIBERATE IN BOTH BLOCKS AND MEAN DIFFERENT THINGS:
 *   - Figtree really is variable over 400..700.
 *   - Newsreader is ONE static 500 instance declared over 400..700 on purpose. A face
 *     declared for a weight RANGE is never synthetically emboldened for a request
 *     inside that range, so a `font-semibold` that survives the migration renders as
 *     the real 500 rather than as smeared fake bold. 600 and 700 are intentionally
 *     indistinguishable from 500 in the display family.
 */

/* ---------------------------------- Figtree ------------------------------------ */
@font-face {
  font-family: "Figtree";
  font-style: normal;
  font-weight: 400 700;
  font-display: swap;
  src: url("/fonts/figtree-latin.woff2") format("woff2");
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA,
    U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+2074, U+20AC, U+2122, U+2191,
    U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
@font-face {
  font-family: "Figtree";
  font-style: normal;
  font-weight: 400 700;
  font-display: swap;
  src: url("/fonts/figtree-latin-ext.woff2") format("woff2");
  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF,
    U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020,
    U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF;
}

/* --------------------------------- Newsreader ---------------------------------- */
@font-face {
  font-family: "Newsreader";
  font-style: normal;
  font-weight: 400 700; /* one 500 instance — see the header note */
  font-display: swap;
  src: url("/fonts/newsreader-500-latin.woff2") format("woff2");
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA,
    U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+2074, U+20AC, U+2122, U+2191,
    U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
@font-face {
  font-family: "Newsreader";
  font-style: normal;
  font-weight: 400 700;
  font-display: swap;
  src: url("/fonts/newsreader-500-latin-ext.woff2") format("woff2");
  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF,
    U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020,
    U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF;
}
```

`font-display: swap` per SPEC §2, and the preload in §1.6 keeps the swap window to
roughly the parse time of a same-origin 24 KB file. `optional` was considered and rejected:
on a cold first load it would render the whole first session in the fallback, and this app's
first session is a sign-up flow that people judge it by.

### 1.6 The two fallback stacks stay exactly as they are — as fallbacks

`apps/web/src/styles/index.css`, `@theme inline` block, replace only the two lines:

```css
  --font-sans:
    Figtree, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
    "Helvetica Neue", Arial, "Noto Sans", sans-serif;
  --font-display:
    Newsreader, "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, ui-serif,
    serif;
```

Nothing is removed. `body { font-family: var(--font-sans) }` in `@layer base` keeps
working unchanged, and so do the 26 `font-display` call sites (see §2.4). A device that
somehow gets no woff2 still renders Palatino/Georgia and system-ui, i.e. today's app.

### 1.7 `index.html` — preload

Add, after the `<link rel="mask-icon">` line and **before** the inline theme script:

```html
    <!--
      Preload only the two LATIN files. `crossorigin` is required even for a same-origin
      font or the preload is fetched twice (once anonymously for the preload, once with
      the CORS mode the CSS font fetch uses). latin-ext is deliberately NOT preloaded: it
      only matters once a non-Latin-1 character appears, and preloading it would spend
      ~11 KB of the critical path on most sessions for nothing.
    -->
    <link rel="preload" href="/fonts/figtree-latin.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="preload" href="/fonts/newsreader-500-latin.woff2" as="font" type="font/woff2" crossorigin />
```

Do **not** add `<link rel="stylesheet" href="https://fonts.googleapis.com/…">`, and do not
"optimise" the preloads away — the stylesheet that declares the faces is a hashed
`/assets/*.css`, so without a preload the font request cannot start until that CSS has
parsed.

### 1.8 `vite.config.ts` — precache

One character-level change, in `workbox.globPatterns`:

```ts
          globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest,woff2}"],
```

Extend the existing comment above it, because the file currently explains at length why
`wasm` is *absent* and a reader will reasonably ask why `woff2` is not the same case:

```
          // `woff2` IS PRESENT and `wasm` is not, for opposite reasons. The four font
          // files total ~55 KB, are needed by EVERY screen, and are needed OFFLINE —
          // an unavailable webfont reflows the shopping list at the till. zxing-wasm is
          // 1.1 MB, is needed by one screen, once per card, at home, with a connection.
```

`maximumFileSizeToCacheInBytes` (4 MB) needs no change. The precache grows by ~55 KB,
which is the cost of the decision in SPEC §2 and is paid once per deploy.

---

## 2 — The type scale

### 2.1 What the design contains

14 sans sizes (9, 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15, 16, 16.5, 18) and
14 serif sizes (13.5, 15, 17, 19, 20, 21, 22, 24, 28, 30, 34, 38, 44, 46). That is not a
scale; it is a mockup drawn at pixel precision. Half-pixel steps (13 vs 13.5, 20 vs 21 vs 22)
carry no information and cannot be reproduced consistently by five agents.

**Below is the smallest set that keeps every distinct ROLE.** Every collapse is listed with
the design values it absorbs, so a transcription can be checked against the artboard.
Sizes not in this table are not available: no `text-[13px]`, ever.

### 2.2 Sans steps

Two new steps; everything else is an existing Tailwind v4 utility.

| Utility | px / rem | line-height | Absorbs | Role |
| --- | --- | --- | --- | --- |
| `.eyebrow` (composite, §2.3) | 11 / `0.6875rem` | 1.1 | 9, 10, 10.5, 11 | every uppercase label |
| `text-xs` *(existing)* | 12 / `0.75rem` | 1.35 | 11.5, 12, 12.5 | quiet meta: counts, `+2 more`, `from` provenance, `who · when`, hints, note lines |
| **`text-control`** *(NEW)* | 13.5 / `0.84375rem` | 1.2 | 13, 13.5 | interactive labels: buttons, chips, segmented tabs, sidebar secondary nav, breadcrumb, `Sort: newest` |
| `text-sm` *(existing)* | 14 / `0.875rem` | 1.5 | 14, 14.5 | primary sidebar nav, page subtitles, body copy in panels, form labels |
| **`text-item`** *(NEW)* | 15 / `0.9375rem` | 1.35 | 15 | ingredient rows, shopping-item names, list-preview lines |
| `text-base` *(existing)* | 16 / `1rem` | 1.6 | 16, 16.5 | the recipe description and the method step prose — the only long-form reading text in the app |

- 18 px in the design is the `−` / `+` stepper glyph. That is an icon, not type: use
  `<Minus className="size-5" />` (§1.4). No step.
- `text-base`'s 1.6 line-height replaces the design's `line-height:1.6` on step text and
  `1.55` on descriptions. One value; the 0.05 difference is not visible at 16 px.

`apps/web/src/styles/index.css`, inside the existing `@theme inline` block:

```css
  /* --- type scale: the two sans steps Tailwind has no stop for ---------------- */
  --text-control: 0.84375rem; /* 13.5px — buttons, chips, tabs, secondary nav */
  --text-control--line-height: 1.2;
  --text-item: 0.9375rem; /* 15px — ingredient + shopping-item rows */
  --text-item--line-height: 1.35;
```

### 2.3 The eyebrow — a hand-written composite utility, not a size token

10.5–11 px / 700 / `uppercase` / `letter-spacing:.06–.08em` appears **20 times** across the
artboards (`.08em` x18, `.07em` x1, `.06em` x1 — collapse all three to `.08em`). It bundles
five declarations, one of which (`text-transform`) Tailwind's font-size namespace cannot
carry, so it is a hand-written utility rather than a `--text-*` token.

`apps/web/src/styles/index.css`, inside the existing `@layer utilities` block:

```css
  /*
   * The uppercase micro-label: recipe category, stat captions, section headers,
   * "Organise", "To buy", "Bought today". Bundles five declarations because they are
   * never used apart, and `text-transform` cannot live in a Tailwind --text-* token.
   *
   * Named `.eyebrow`, NOT `.text-eyebrow`: the hand-written utilities in this file are
   * emitted after everything Tailwind generates, so a name in the `text-*` shape would
   * silently override a real size utility on the same element. NEVER combine `.eyebrow`
   * with a `text-*` size utility for the same reason — `.eyebrow` would win.
   *
   * COLOUR IS NOT PART OF IT: the design uses three, semantically distinct.
   *   text-accent-strong  the recipe's course/category  (the one eyebrow that is content)
   *   text-fg-faint       structural labels: stat captions, "Organise", "To buy"
   *   text-success        "Bought today"
   */
  .eyebrow {
    font-size: 0.6875rem;
    line-height: 1.1;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
```

`.eyebrow` replaces the 11 existing ad-hoc spellings of the same idea
(`text-sm font-semibold tracking-wide uppercase`, `text-xs tracking-wide uppercase`,
`tracking-widest`) — grep `tracking-wide\|tracking-widest` under `apps/web/src` and convert
every hit. `tracking-wide` is 0.025em and `tracking-widest` is 0.1em; the design is 0.08em,
so both are wrong today.

### 2.4 Display (serif) steps

Eight steps. All weight 500, all `font-display`.

| Utility | px / rem | line-height | tracking | Absorbs | Role (artboard) |
| --- | --- | --- | --- | --- | --- |
| **`text-display-xs`** | 15 / `0.9375rem` | 1.25 | — | 13.5, 15 | serif titles inside compact rows and tiles: planner day card, "Tomaten Kritharaki" in the week panel, the recipe row in the list rail |
| **`text-display-sm`** | 17 / `1.0625rem` | 1.2 | — | 17 | phone editorial row title (1e), phone 4-up stat values (1f), phone tile headings "Cards"/"History" (1g) |
| **`text-display-md`** | 21 / `1.3125rem` | 1.2 | — | 19, 20, 21, 22 | section headings ("This week", "All recipes", "Frequently bought", "Recipes on this list", "Loyalty cards", "Bought history"), panel titles ("Einkaufsliste", "From this week's plan"), desktop stat values, the `Rezepte` wordmark |
| **`text-display-lg`** | 24 / `1.5rem` | 1.2 | — | 24 | desktop column headings: `Ingredients`, `Method` |
| **`text-display-xl`** | 28 / `1.75rem` | 1.1 | — | 28, 30 | phone recipe-detail `h1`, phone shopping-list `h1`, the desktop method step numeral |
| **`text-display-2xl`** | 34 / `2.125rem` | 1.05 | -0.01em | 34 | phone page `h1` — `Recipes`, `Shopping` |
| **`text-display-3xl`** | 38 / `2.375rem` | 1.1 | — | 38 | desktop page `h1` — `Shopping`. Reached as `lg:text-display-3xl` on top of `2xl` |
| **`text-display-4xl`** | 46 / `2.875rem` | 1.05 | -0.01em | 44, 46 | the desktop recipe-detail hero `h1`, and nothing else |

**The two collapses worth arguing about, both accepted:**

- **19/20/21/22 → 21 px.** Four values within 3 px, split across "desktop panel heading"
  (22) and "desktop rail heading" (20) with no rule distinguishing them. Collapsing costs
  at most 1 px on any single element, including the wordmark.
- **28/30 → 28 px.** The phone shopping-list `h1` drops 2 px. Chosen in this direction, not
  the other, because the *recipe-detail* `h1` at 28 is a long German title wrapping on a
  390 px screen and 30 px would risk an extra line for no gain.

**Kept apart deliberately:** 34 (`2xl`) and 38 (`3xl`) are the phone and desktop rendering
of the *same* element and are the most-seen type in the app; and 38 vs 46 are a page title
against an article hero title, which is a real role difference.

`apps/web/src/styles/index.css`, inside `@theme inline`:

```css
  /* --- display (serif) scale — always weight 500, always with `font-display` ---- */
  --text-display-xs: 0.9375rem;
  --text-display-xs--line-height: 1.25;
  --text-display-sm: 1.0625rem;
  --text-display-sm--line-height: 1.2;
  --text-display-md: 1.3125rem;
  --text-display-md--line-height: 1.2;
  --text-display-lg: 1.5rem;
  --text-display-lg--line-height: 1.2;
  --text-display-xl: 1.75rem;
  --text-display-xl--line-height: 1.1;
  --text-display-2xl: 2.125rem;
  --text-display-2xl--line-height: 1.05;
  --text-display-2xl--letter-spacing: -0.01em;
  --text-display-3xl: 2.375rem;
  --text-display-3xl--line-height: 1.1;
  --text-display-4xl: 2.875rem;
  --text-display-4xl--line-height: 1.05;
  --text-display-4xl--letter-spacing: -0.01em;
```

### 2.5 THE 26 `font-display font-semibold` SITES ALL CHANGE

Today **every** `font-display` call site in the app also carries `font-semibold`:

```
$ grep -rn "font-display" apps/web/src | grep -v styles/ | wc -l              # 26
$ grep -rn "font-display" apps/web/src | grep -v styles/ | grep -c "font-semibold\|font-bold"   # 26
```

Newsreader ships **only weight 500** here. Every one of those 26 must become
`font-display font-medium` plus the right `text-display-*` step. The `font-weight: 400 700`
range in the `@font-face` block (§1.5) is the safety net that keeps a *missed* site from
rendering synthetic fake bold — it is not permission to leave one.

The 26 sites, for the agent doing the sweep (each is also restyled by whichever area owns
the screen; this list is the completeness check):

```
components/ui/Card.tsx                              CardHeader title  -> text-display-md
components/ui/Dialog.tsx                            title             -> text-display-md
components/ui/EmptyState.tsx                        title             -> text-display-md
components/ui/ErrorState.tsx                        heading           -> text-display-md
features/cards/CardsPage.tsx:76,205
features/collections/CollectionDetailPage.tsx:118
features/collections/CollectionsPage.tsx:34,81
features/groups/GroupDetailPage.tsx:87,206,279
features/groups/GroupsPage.tsx:38,83
features/recipes/RecipeDetailPage.tsx:245,354,404,433
features/recipes/RecipeEditPage.tsx:100
features/recipes/RecipeListPage.tsx:47
features/recipes/RecipeNewPage.tsx:72
features/recipes/components/CookMode.tsx:106
features/recipes/components/IngredientsEditor.tsx:110
features/recipes/components/RecipeCard.tsx:67
features/recipes/components/RecipeForm.tsx:186
features/recipes/components/StepsEditor.tsx:69
features/shopping/ShoppingListDetailPage.tsx:132
features/shopping/ShoppingListsPage.tsx:64,116
features/tags/TagsPage.tsx:58
```

(`Dialog`/`EmptyState`/`ErrorState`/`CardHeader` do not currently use `font-display` at all —
they use `text-lg font-semibold` sans. They gain it; see §4.)

### 2.6 `tabular-nums` — a rule, not a new utility

`font-variant-numeric: tabular-nums` appears 6 times in the design and always on a
**quantity**: the ingredient qty column, the shopping-item qty, the list-preview qty, the
bought-row qty. Tailwind already has `tabular-nums`; **do not alias it.** The rule is:

> Any number that sits in a column with other numbers, or that changes in place, carries
> `tabular-nums`. That is every ingredient amount, every shopping quantity, every count,
> every servings value, every percentage, every duration in a stat block.

The existing 10 `tabular-nums` sites are already correct and stay.

**Verify after the fonts land** that Figtree's subset actually contains a `tnum` feature —
`pyftsubset --layout-features='*'` (§1.3) keeps it, `--layout-features=''` would silently
drop it and `tabular-nums` would then be a no-op with no error. Check with
`fonttools ttx -t GSUB -o - figtree-latin.woff2 | grep -c tnum`. If `tnum` is genuinely
absent upstream, say so in the PR and give the qty columns a fixed `ch` width instead —
do not leave the class on and assume it works.

### 2.7 THE DESIGN'S 14.5/15 px INPUT TEXT CANNOT SHIP AS DRAWN

`apps/web/src/styles/index.css` `@layer base` has, deliberately:

```css
  input, select, textarea, button { font: inherit; font-size: max(1rem, 16px); }
  /* iOS zooms any input with a font-size below 16px on focus. */
```

The design draws the library search field at 14.5 px and the shopping add bar at 15 px.
Rendering those literally means every focus on a phone zooms the viewport, which on the
shopping list — a `sticky bottom-tabbar` bar (SPEC §5) — also shifts the bar under the
keyboard.

**Decision: inputs stay at ≥16 px.** Use `text-base` on `Input`/`Textarea`/`Select`
regardless of what the artboard says. The visual delta is 1–1.5 px on placeholder text;
the alternative is a viewport zoom on every tap. The `max(1rem, 16px)` base rule stays
exactly as it is, and a `text-item` on an `<input>` is a review-blocking mistake.

This applies only to *focusable text controls*. The 15 px on a shopping-item **name**
(a `<span>` inside a button) is fine and uses `text-item`.

### 2.8 `text-wrap`

The design uses `text-wrap:balance` twice (both `h1`) and `text-wrap:pretty` four times
(the recipe description, the method step, the editorial row title, the intro copy).
`@layer base` already has `h1,h2,h3 { text-wrap: balance }`. Add one rule next to it:

```css
  p {
    text-wrap: pretty;
  }
```

and use the `text-pretty` utility on the non-`<p>` case (the editorial row title `<span>`).

---

## 3 — Tokens

### 3.1 Verifying SPEC §2's claim

SPEC §2 says the palette needs no work and names two additions. **The hex-by-hex audit is
correct** — I re-ran it mechanically and every one of the 36 distinct hexes in the design
file is accounted for:

| Class | Hexes | Verdict |
| --- | --- | --- |
| Already a semantic token in `theme.css` | 20 (`#dc7051`, `#eb9d84`, `#f6c5b4`, `#3b1f13`, `#24120a`, `#eab54f`, `#3a2c0f`, `#7ba05b`, `#26301b`, `#a9c68c`, `#17120f`, `#201a15`, `#2a221c`, `#382e26`, `#4a3d33`, `#f6ece1`, `#b8a693`, `#9c8b79`, …) | no work |
| Recipe `tone` placeholders for a missing photo (`#4a3320`, `#2f3a22`, `#3a2b1e`, `#5a3a1a`, `#3a3326`, `#5c2e1c`, `#3d4020`, `#3b2a3f`, `#3a4a2a`, `#5a4014`, `#4a3a22`) + the detail hero slot `#3b2a1a` | 12 | **not tokens.** In the app this slot is `thumbnailUrl()`; the image-less fallback is the existing `bg-surface-2` + `<UtensilsCrossed />` that `RecipeCard`/`RecipeRow` already render. Do not add per-recipe tint. |
| Canvas chrome (`#0f0c0a`, the artboard body ground) | 1 | not app colour |
| Loyalty-card tile gradient `#2a5ea8 → #1d3f75` | 2 | **a gap, not a token** — see §3.2 |
| Genuinely new | `#130f0c`, `#e8dccd` | see §3.3 |

**But the count of tokens to ADD is three, not two, plus one derivation-only addition.**
SPEC §2 maps `#6b5c4b` to "`--toon-sand-600`" and therefore counts it as existing. It exists
as a *raw ramp variable*, and `theme.css`'s own header forbids components from touching
those ("components only ever reference the semantic Tailwind tokens"). `#6b5c4b` is used
**24 times** in the artboards — the stat captions, `Organise`, `To buy`, the `from`
provenance label, `+2 more`, `who · when` on a bought tile, the "long-press a chip" hint —
so it needs a semantic name or five agents will each reach for `text-[var(--toon-sand-600)]`
and light mode will be whatever falls out.

Additions: **`--bg-sunken`**, **`--fg-body`**, **`--fg-faint`**, and **`--accent-strong`**
(the last one exists only because the design uses honey *as text*, which light mode cannot
do at the current `--accent`; see §3.4).

### 3.2 The loyalty-card tile gradient — an open gap

The design draws every card tile as `linear-gradient(135deg,#2a5ea8,#1d3f75)` labelled
"Payback". **The `cards` table has no colour column** (`apps/api/src/db/schema.ts`, `cards`:
`id, userId, label, format, value, note, lastUsedAt, createdAt, updatedAt`) and nothing in
the design implies one.

**Recommendation (one line, owner to confirm):** do not add `cards.color`; derive the two
gradient stops deterministically from `card.id` over a fixed set of six dark, warm-palette-
compatible pairs, in a pure helper in `packages/shared` with a unit test — because a colour
picker is a feature nobody asked for and the artboard's blue is one mock instance, not a
Payback brand requirement. This is **not** a palette addition: the six pairs are a
display-only lookup table, not tokens, and they must not go in `theme.css`.

Flagged as a conflict with the cards area.

### 3.3 The three new semantic tokens, with derived light twins

**How the light twins were derived.** Not by walking the ramp the same number of steps —
that produces unreadable light text, because the two ends of a warm ramp are not
perceptually symmetric. Each light value was chosen to **match the dark value's measured
contrast ratio against its own theme background**. Where that lands on a hex that already
has another name in light mode, the two collapse; that is documented, not a bug.

| Token | Dark | measured | Light | measured | Used for |
| --- | --- | --- | --- | --- | --- |
| `--bg-sunken` | `#130f0c` (as drawn) | 1.03:1 vs `--bg` | `var(--toon-sand-100)` `#f3ebe0` | 1.09:1 vs `--bg` | the desktop sidebar ground and the phone tab-bar ground. One step *below* the page in both themes; the separation people actually see is the `border-r`/`border-t` in `--line`, and the ground only has to stop reading as the same plane. |
| `--fg-body` | `#e8dccd` (as drawn) | 12.75:1 on `--surface` | `var(--toon-sand-700)` `#4c4036` | 10.03:1 on `--surface` | the method step prose and chip labels — one notch softer than `--fg` for long-form reading. |
| `--fg-faint` | `#8d7c67` **(deviates)** | 4.61:1 on `--bg` | `#7f6f5b` | 4.47:1 on `--bg` | the quietest tier: stat captions, `Organise`, `To buy`, `from`, `+2 more`, `who · when`, the chip hint. |

**`--fg-faint` deviates from the artboard on purpose, and this is the one place in this spec
where the design does not win.** The drawn `#6b5c4b` measures **2.88:1 on `--bg`** and
**2.67:1 on `--surface`**. At 11 px / 700 that is under WCAG AA for normal text (4.5:1) and
under the large-text floor (3:1) as well, and `components/ui/index.ts` already commits the
primitives to "focus-visible rings everywhere, no hover-only affordances", i.e. accessibility
is a stated convention here rather than a nice-to-have. `#8d7c67` is the next stop up the
ramp (`--toon-sand-500`), clears 4.5:1 on `--bg`, and still leaves five distinguishable
foreground tiers: `--fg` 15.9 → `--fg-body` 12.8 → `--fg-muted` 7.9 → `--fg-subtle` 5.7 →
`--fg-faint` 4.6.

> **Owner decision needed.** Honour `#6b5c4b` exactly and accept 2.88:1, or take `#8d7c67`.
> This spec assumes `#8d7c67`. It is a one-line change in `theme.css` either way, so it can
> be flipped after the branch is reviewable — do not fork the implementation over it.

### 3.4 `--accent-strong` — the design uses honey as TEXT, and light mode cannot

The design puts `#eab54f` (`--accent` in dark) on the page ground as text in three
recurring places: the course/category eyebrow (11 px / 700), the ingredient quantity
(15 px / 600) and the shopping-list quantity (15 px / 600 and 12 px on a phone tile).

In dark that is **9.93:1** — excellent. In light, `--accent` is `--toon-accent-500`
`#d99a24`, which measures **2.25:1 on `--bg`**: invisible. Bumping light `--accent` itself
is the wrong fix, because `--accent` is also a *background* (`Button variant="accent"`
paints `#241d18` on it).

So add a token whose only job is "accent, used as text on the page ground", and add the
ramp stop it needs:

```
--toon-accent-700: #9a6710          (new ramp stop)

--accent-strong   dark  var(--toon-accent-400)  #eab54f   9.93:1 on --bg   <- identical to
                                                                              --accent in dark,
                                                                              so ZERO visual
                                                                              change from the
                                                                              artboard
                  light var(--toon-accent-700)  #9a6710   4.48:1 on --bg
                                                          4.86:1 on --surface
```

`.eyebrow` on a category, and every quantity the design paints honey, uses
`text-accent-strong`. `text-accent` remains available and remains correct for an *icon* or a
2 px rule, where 3:1 is the bar.

### 3.5 Two light-mode values that the redesign now depends on

The design makes `--success` load-bearing as **text** (the `Bought today` eyebrow at 11 px /
700, the `Cooked · 3 d ago` stat) where it previously was only a fill and an icon.

- Light `--success` is `--toon-herb-500` `#5b8040` = **4.20:1** on `--bg`. Just under AA.
  **Change light `--success` to `var(--toon-herb-600)`** `#47652f` = **6.11:1**. Safe:
  `bg-success` has exactly two call sites in the app and a darker green fill is fine; the
  dark value is untouched.
- Inline text links (`Open →`, `Add`, `Filters`, `Plan →`, `Show all 24`, `Clear bought`,
  `Manage`, `All`) are `#eb9d84` in the artboards, i.e. `--brand-hover`, matching the
  canvas's own `a{color:#eb9d84} a:hover{color:#f6c5b4}`. **That maps cleanly and needs no
  token:** use `text-brand-hover hover:text-brand-soft-fg`. It happens to derive correctly
  in *both* directions — dark 8.57 → lighter on hover; light `#a44121` 5.77 → `#82331b`
  7.94, darker on hover. Do not use `text-brand` for an inline link (it is the *button*
  fill) and do not invent a `--link` token.

### 3.6 THEME.CSS DEFINES THE PALETTE FOUR TIMES AND TWO OF THE BLOCKS ARE ALREADY WRONG

This is a pre-existing bug the redesign will otherwise amplify, and fixing it is part of
this area. The four blocks are `:root` (light), `@media (prefers-color-scheme: dark) :root`,
`:root[data-theme="light"]` and `:root[data-theme="dark"]`. Specificity: the attribute
selectors are `(0,2,0)` and beat both `:root` rules, but **only for tokens they actually
define** — the media block's value stands for anything they omit.

Measured (`python3` diff of the four blocks over the 35 semantic tokens):

```
data-theme=light  MISSING 14: --accent --accent-soft --accent-soft-fg --danger-hover
                              --success --success-soft --success-soft-fg
                              --warning --warning-soft --warning-soft-fg --ring
                              --elevation-soft --elevation-card --elevation-pop
data-theme=dark   MISSING 3:  --elevation-soft --elevation-card --elevation-pop
```

Consequences, both real today:

- A user who picks **light** on a device whose OS is **dark** gets dark accent, success,
  warning, ring and *shadow* values on a light page. The `--elevation-*` case is the visible
  one: black 70 %-opacity shadows under white cards.
- A user who picks **dark** on a **light** OS gets the light `--elevation-*` — the soft
  6 %-black shadows tuned for a white page, which are invisible on `#17120f`. That directly
  breaks the design: `--elevation-pop` is what lifts the phone Cook-mode button (1f) and
  the phone add bar (1h) off the page.

**Required fix, and the standing rule.** Complete both attribute blocks so that all four
blocks define **the same 39 semantic tokens** (35 existing + the 4 added here). Then add a
header comment to `theme.css`:

```css
/*
 * FOUR BLOCKS, ONE LIST. The palette is declared four times — :root (light), the
 * prefers-color-scheme:dark media query, :root[data-theme="light"] and
 * :root[data-theme="dark"] — and the two attribute blocks only override what they
 * NAME. A token added to some of them is a silent bug: the media query's value stands
 * for anything [data-theme] omits, so "light theme on a dark phone" renders that
 * token's DARK value. This is not hypothetical — [data-theme="light"] was missing
 * accent/success/warning/ring and all three --elevation-*, and [data-theme="dark"] was
 * missing the elevations, which is why an explicitly-dark app on a light OS had no
 * card shadows. ADD EVERY NEW TOKEN TO ALL FOUR BLOCKS.
 */
```

### 3.7 The concrete `theme.css` diff

Ramp addition, in `:root`, after `--toon-accent-600`:

```css
  --toon-accent-700: #9a6710;
```

Semantic additions — **in all four blocks**:

```css
/* :root  and  :root[data-theme="light"]  (light) */
  --bg-sunken: var(--toon-sand-100);
  --fg-body: var(--toon-sand-700);
  --fg-faint: #7f6f5b;
  --accent-strong: var(--toon-accent-700);
/* light-mode correction, same two blocks: */
  --success: var(--toon-herb-600);

/* @media (prefers-color-scheme: dark) :root  and  :root[data-theme="dark"]  (dark) */
  --bg-sunken: #130f0c;
  --fg-body: #e8dccd;
  --fg-faint: #8d7c67;
  --accent-strong: var(--toon-accent-400);
```

Plus the 14 + 3 tokens listed in §3.6 copied into the two attribute blocks from their
same-mode counterpart. **Do not "simplify" this by deleting a block** — the two attribute
blocks are what makes an explicit choice win over the OS in both directions, which is the
same three-state contract as the language picker (`CLAUDE.md`, "The language picker's third
state is `system`").

### 3.8 `index.css` `@theme inline` — colour mapping

Add next to the existing `--color-*` lines:

```css
  --color-bg-sunken: var(--bg-sunken);
  --color-fg-body: var(--fg-body);
  --color-fg-faint: var(--fg-faint);
  --color-accent-strong: var(--accent-strong);
```

Nothing else in that block changes. `lib/theme.ts`'s `applyTheme()` keeps writing
`#17120f`/`#faf5ee` to `<meta name="theme-color">`, and the `index.html` boot script keeps
the same two hexes — **both stay `--bg`, not `--bg-sunken`.** The browser chrome should
match the page, not the sidebar.

### 3.9 Radius: one new token

Design radii (app-relevant, excluding the 32 px phone bezel and the canvas badges):
`6, 8, 9, 10 (x44), 12 (x16), 14, 16 (x6), 18, 99`.

| Utility | Value | Absorbs | Role |
| --- | --- | --- | --- |
| `rounded-md` *(existing, 6)* | 6 | 6 | nothing in the app; do not use |
| `rounded-lg` *(existing, 8)* | 8 | 8 | the 28/22 px avatar square, small thumbs |
| **`rounded-control`** *(NEW, 10)* | `0.625rem` | 9, 10 | **buttons, icon buttons, sidebar nav items, the segmented control's active pill, small icon tiles** — the single most common radius in the design |
| `rounded-xl` *(existing, 12)* | 12 | 12, 14 | inputs, list rows, item tiles, the phone bottom-bar buttons |
| `rounded-card` *(existing, 16)* | `1rem` | 16, 18 | every panel and card |
| `rounded-full` | — | 99 | chips, pills, progress track, circular avatars |

```css
/* index.css, @theme inline, next to --radius-card */
  --radius-control: 0.625rem; /* 10px — the design's button/nav radius */
```

`--radius-sheet` (20 px) is untouched: the design draws no dialog, so `Dialog` keeps what
it has.

---

## 4 — The `components/ui` delta

All 21 files, classified. **`interactive`/`padding`/`variant`/`size` prop *values* are never
removed** — every existing call site must keep compiling, because D6 means all ~15
undesigned screens get restyled in parallel and a removed variant is a merge conflict in
five branches at once.

### 4.1 The design's recurring shapes → where each lands

| Shape in the design | Answer | New primitive? |
| --- | --- | --- |
| pill chip with a leading `+` (1d rail x8, 1h row x5, the phone group-switcher chip) | **`Chip.tsx`** | **yes** |
| segmented two-tab control (`Ingredients · 15` / `Method · 6`, 1f) | `Tabs` `variant="segmented"`, restyled | no |
| thin progress bar (6 px, 1c/1g) | **`ProgressBar.tsx`** | **yes** |
| section header: eyebrow + hairline rule + trailing count/action (1d x2, 1h x2) | **`SectionHeader.tsx`** | **yes** |
| stat block: uppercase eyebrow over a serif value (1a 5-up, 1f 4-up) | **`Stat.tsx`** + `StatRow` | **yes** |
| stepper `−  value  +` (1a, 1f) | **`Stepper.tsx`**; `ServingsScaler` becomes a wrapper | **yes** |
| card, 16 px radius, `--line` border, **no shadow** | `Card`, restyled (default `shadow="none"`) | no |
| eyebrow label | `.eyebrow` utility (§2.3) | no — a `<span>` with five declarations is not a component |
| icon button over a hero photo (1f, two 38 px scrim circles) | `IconButton` `shape="circle" variant="scrim"` | no |
| honey `New` pill in the sidebar | `Badge variant="accent" size="sm"` | no |
| `+ Add a recipe's ingredients` dashed button (1d) | `Button variant="dashed"` | no |
| `Cooked` success button (1a, 1f) | `Button variant="success"` | no |
| loyalty-card tile with a gradient | **gap** — §3.2 | no (belongs to the cards area) |

Five new files. D2 sets a high bar; each of the five is justified inline below, and two of
them (`ProgressBar`, `Chip`) exist to *delete* a private duplicate that is already in the
tree.

### 4.2 File-by-file

| File | Verdict | What changes |
| --- | --- | --- |
| `ActionMenu.tsx` | **unchanged** | Inherits `IconButton`'s new radius. The desktop detail header in 1a shows three buttons + a `⋯`; the `⋯` is this. Keep the close-then-`requestAnimationFrame` behaviour verbatim — it is why `window.print()` doesn't print the open panel. |
| `Avatar.tsx` | **extended** | Design has **two** avatar shapes: a rounded-square group avatar (28 px desktop / 22 px phone, `--brand-soft` on `--brand-soft-fg`, initials "MR") and a **circular** user avatar (32 px, `--accent` ground with `--brand-fg` text, "ES"). Add `shape?: "circle" \| "square"` (default `"circle"`), `tone?: "brand" \| "accent"` (default `"brand"`), and two sizes: `sizes` becomes `{ "2xs": "size-5.5 text-[9px]", xs: "size-7 text-[11px]", sm: "size-8 text-xs", md: "size-10 text-sm", lg: "size-14 text-base" }`. `sm`/`md`/`lg` keep their current values, so no existing caller changes. Square uses `rounded-lg`. |
| `Badge.tsx` | **unchanged** | `variant="accent" size="sm"` is already the honey `New` pill (11.2 px, `--accent-soft` ground). The design's `#eab54f` text is one shade brighter than `--accent-soft-fg`; keep the token pair — it has better contrast and is what light mode needs. `color` (tag hex) path untouched. |
| `Button.tsx` | **restyled + extended** | Restyle: `rounded-xl` → `rounded-control`; base `font-medium` → keep, but `primary`/`accent`/`danger` add `font-bold` (design paints every filled button at 700) and `secondary`/`outline`/`ghost`/`success`/`dashed` at `font-semibold`; sizes gain `text-control` on `sm` and `md` (`sizes.sm = "min-h-9 px-3 text-control"`, `sizes.md = "min-h-11 px-4 text-control"`, `sizes.lg = "min-h-13 px-5 text-sm"`); drop `shadow-soft` from `primary`/`danger`/`accent` (the design's buttons are flat; only the phone Cook-mode button is lifted, and it asks for `shadow-pop` explicitly). Extend `ButtonVariant` with **`success`** (`"border border-success/40 bg-success-soft text-success-soft-fg hover:border-success"`) and **`dashed`** (`"border border-dashed border-line-strong bg-transparent text-fg-muted hover:border-brand hover:text-fg"`). **Sizes stay 36/44/52** — the design's 38/40/42 px buttons all round up to the 44 px touch floor that `index.ts` commits to; 38 px desktop toolbar buttons use `size="sm"`, which is what its "sm is for dense desktop toolbars" comment already means. `buttonClasses()` picks all of this up for free. |
| `Card.tsx` | **restyled** | **Drop `shadow-card` from the base.** The design's panels are flat: `background:#201a15;border:1px solid #382e26;border-radius:16px`, no `box-shadow`, in all four desktop artboards and all four phone ones. Add `shadow?: "none" \| "card" \| "pop"`, default `"none"`. A hairline on a near-black ground *is* the texture; a shadow on top reads as a different app. `interactive` keeps `hover:shadow-pop`? **No** — change it to `hover:border-line-strong` only (which is exactly the artboards' `style-hover="border-color:#4a3d33"`). Paddings unchanged (`lg` = 20/24 px matches the design's `20px 22px`; `md` = 16 px matches the phone's 18 px and the small tiles' 16 px). `CardHeader`: title becomes `font-display text-display-md font-medium` (was `text-base font-semibold`), `description` becomes `text-xs text-fg-muted`, `action` slot unchanged — it is already the design's trailing `Manage` / `All` / `Show all 24` link. |
| `ConfirmDialog.tsx` | **unchanged** | Inherits `Dialog` + `Button`. |
| `Dialog.tsx` | **restyled** | Title `text-lg leading-tight font-semibold` → `font-display text-display-md font-medium`; `description` → `text-sm text-fg-muted` (unchanged in effect). Nothing structural: the design draws no dialog, and Escape / focus trap / scroll lock / the `openDialogs` counter are load-bearing. `--radius-sheet` stays 20 px. |
| `EmptyState.tsx` | **restyled** | Title → `font-display text-display-md font-medium`. Keep the `border-dashed border-line-strong` frame — it now matches the design's `+ Add card` / `+ Add a recipe's ingredients` dashed language. `bg-surface/60` → `bg-transparent` (flat, like every other surface). |
| `ErrorState.tsx` | **restyled** | Heading → `font-display text-display-md font-medium`. `inline` banner: `rounded-xl` stays. No API change. |
| `Field.tsx` | **restyled** | `FieldShell`'s hint and error paragraphs `text-sm` → `text-xs`. **Do not touch the aria wiring** (`useControlAria`, the `${id}-error` / `${id}-hint` suffixes, `role="alert"`) — the file's own comment explains why four copies of this frame is the bug it exists to prevent. |
| `IconButton.tsx` | **restyled + extended** | `rounded-xl` → `rounded-control`. Add `shape?: "square" \| "circle"` (circle → `rounded-full`), because 1f draws two 38 px circular buttons on top of the hero photo. Add `variant="scrim"`: `"bg-bg/70 text-fg backdrop-blur-sm hover:bg-bg/85"` — the artboard's `rgba(23,18,15,.7)`, i.e. `--bg` at 70 %, which is why it is expressible as a token opacity and needs no new colour. Sizes unchanged (36/44/52). |
| `index.ts` | **extended** | Export the five new primitives and their prop types. Keep the header comment and extend the conventions list with: "type comes from the scale in styles/index.css — `text-control`/`text-item`/`text-display-*` and the `.eyebrow` utility, never an arbitrary `text-[13px]`". |
| `Input.tsx` | **restyled + extended** | `controlClasses`: drop `shadow-soft` (flat), keep `rounded-xl` (12 px = the design's field radius), keep **`min-w-0`** — it is load-bearing and its comment says why. Add `size?: "md" \| "lg"` to `Input`: `md` = `min-h-11` (today's behaviour, the default), `lg` = `min-h-13` for the design's 52/54 px add bar and 46 px search field. `rightSlot`'s padding must follow the size (`pr-11` at `md`, `pr-14` at `lg`) or the design's 40/42 px `--brand` submit block inside the field overlaps the text. Font size stays `text-base` — see §2.7. `PasswordInput` unchanged. |
| `Label.tsx` | **restyled** | `text-sm` → `text-control`. `ui.label.optional` and the `*` marker unchanged. |
| `Select.tsx` | **restyled** | Inherits `controlClasses`. `size` prop mirrored from `Input` for symmetry. Stays a native `<select>` — the OS picker on mobile is the right control and the design draws no custom one. |
| `Skeleton.tsx` | **restyled** | `SkeletonList variant="rows"` must become the design's **editorial row**: an `84px` square (`size-21`, i.e. `size-[5.25rem]`) plus three bars (eyebrow / title / meta), **no card border, no shadow** — matching the artboard's borderless `grid-template-columns:84px 1fr`. `variant="cards"` keeps the grid shape for the collections screen but drops `border`→ keeps `border-line` and drops the shadow. `radii` gains nothing. **`variant` must still match whatever branch the list actually renders** or the list jumps when data lands — see the conflict note in §7. |
| `Spinner.tsx` | **unchanged** | |
| `Switch.tsx` | **restyled** | Label `text-sm` → `text-control`; description `text-sm` → `text-xs`. Real-checkbox implementation untouched. |
| `Tabs.tsx` | **restyled** | The `segmented` variant becomes the design's control (1f): container `"rounded-xl border border-line bg-surface p-1"` (was `rounded-xl bg-surface-2 p-1`); active tab `"rounded-control bg-brand-soft text-brand-soft-fg"` (was `bg-surface text-fg shadow-soft`); inactive `"rounded-control text-fg-subtle hover:text-fg"`; label `text-control font-semibold` and `min-h-10` → `min-h-11`. **The `badge` renders inline as `· N`, not as a pill** — the design writes `Ingredients · 15`, and there is exactly one existing caller (`GroupDetailPage.tsx:68`, the members count), which reads correctly as "Mitglieder · 3". So no new prop: replace the badge `<span>`'s classes with `"text-fg-subtle before:content-['·_']"` — or, clearer, render `{item.badge !== undefined ? <span className="text-fg-subtle">· {item.badge}</span> : null}`. `underline` variant untouched. Keep the arrow-key handling. |
| `Textarea.tsx` | **restyled** | Inherits `controlClasses`. `leading-relaxed` stays. |
| `Toast.tsx` | **unchanged** | Title stays sans 600 — a toast is a system message, not editorial. It already uses `shadow-pop`, which the completed `[data-theme="dark"]` block (§3.6) finally makes correct. |

### 4.3 The five new primitives

Each is a new file in `apps/web/src/components/ui/`, exported from `index.ts`.

**Every one takes ready-to-render strings and calls no `t()` of its own.** That is a
deliberate departure from `Spinner`/`Label`/`Dialog` (which own catalog keys) and it means
**this area adds zero keys to `ui.de.ts` / `ui.en.ts`** — the accessible names all come from
the calling screen, whose catalog already owns the surrounding copy. A primitive that
invented `ui.progressBar.label` would produce one generic sentence for a shopping
progress bar and an upload progress bar.

#### `ProgressBar.tsx` — **new**

```
Props: value: number; max?: number (default 100); label: string;   // aria-label, required
       tone?: "brand" | "success" | "accent";                      // default "success"
       size?: "sm" | "md";                                         // 6px / 8px
       className?: string
```

- Track `bg-surface-2 rounded-full overflow-hidden`, 6 px at `sm` (`h-1.5` — the design's
  1c/1g bar) and 8 px at `md` (`h-2` — what `UploadProgress` uses today).
- Fill `rounded-full bg-success` (or `bg-brand` / `bg-accent`), width as a percentage,
  `transition-[width] duration-200 ease-out`.
- `role="progressbar"` with `aria-valuemin/max/now` and `aria-label={label}`; clamp
  `value` into `[0, max]` and round for `aria-valuenow`.
- **Justification:** drawn on 1c and 1g, and
  `features/import/components/UploadProgress.tsx` already contains a private copy of exactly
  this markup. It must be rewritten to compose `ProgressBar` (keeping its own
  `indeterminate` handling and file row) — a second implementation is what
  `components/ui/index.ts` exists to prevent.
- **Percentage arithmetic goes in `packages/shared`, not here.** SPEC §4.3 needs
  `bought / (toBuy + bought)`; that is a pure function with a unit test (SPEC §5,
  "Pure logic … belongs in packages/shared"). `ProgressBar` only paints a number.

#### `SectionHeader.tsx` — **new**

```
Props: title: string;                        // rendered through `.eyebrow`
       tone?: "faint" | "success" | "accent";// default "faint" -> text-fg-faint
       count?: ReactNode;                     // right of the rule, text-xs text-fg-faint
       action?: ReactNode;                    // right of the rule, e.g. `Clear bought`
       id?: string;                           // so a section can aria-labelledby it
       className?: string
```

Renders `<div class="flex items-center gap-2.5 pt-3.5 pb-1.5">` → `<span class="eyebrow …">`
→ `<span class="h-px flex-1 bg-surface-2">` (the hairline; `--surface-2` `#2a221c` is exactly
what the design uses) → `count` / `action`.

- **Justification:** four instances across 1d and 1h (`To buy` + `Bought today` at both
  sizes) and it is the shape every restyled screen needs for a heading that is *not* a card
  heading. `CardHeader` cannot serve: it has no rule, is `mb-3` inside a card, and its title
  is the serif display step. Nothing else in the tree draws a hairline-rule header.
- The `▾` collapse affordance on 1h's bought header is **not** part of this primitive —
  pass an `<IconButton shape="circle" variant="ghost" size="sm" icon={<ChevronDown />} />`
  as `action`.

#### `Stat.tsx` — **new** (exports `Stat` and `StatRow`)

```
Stat:    label: string; value: ReactNode; tone?: "default" | "success"; className?: string
StatRow: children; columns?: number;      // 4 (phone grid) | undefined (desktop flex row)
         divided?: boolean;               // the 1a border-top/border-bottom pair
         className?: string
```

- `Stat` renders `<div class="min-w-0">` → `<span class="eyebrow block text-fg-faint">` →
  `<span class="font-display text-display-sm font-medium tabular-nums">` (phone) /
  `text-display-md` (desktop, via `StatRow`'s context or a `size` prop — pick one and stay
  with it). `tone="success"` colours only the value `text-success-soft-fg`, which is the
  design's `Last cooked` / `Cooked · 3 d ago`.
- `StatRow` with `columns={4}` renders
  `grid grid-cols-[repeat(4,minmax(0,1fr))] gap-2` — **`minmax(0,1fr)`, never a bare `1fr`**
  (`CLAUDE.md`: a bare track holding content demands its min-content width). Without
  `columns` it renders `flex flex-wrap gap-7`. `divided` adds
  `border-y border-surface-2 py-3.5`.
- **Justification:** the design draws this twice with different arities (5-up desktop with a
  `margin-left:auto` last item, 4-up phone grid) and `RecipeDetailPage.tsx:340` currently
  hand-rolls a `<dt>/<dd>` version. It is also the shape SPEC §5 flags as at risk on a
  390 px screen — putting `minmax(0,1fr)` + `min-w-0` in one place is the point of the
  primitive.
- The desktop 5th stat (`Last cooked`, right-aligned) is `className="ml-auto text-right"`
  on the `Stat`, not a prop.

#### `Chip.tsx` — **new**

```
Props: label: string;
       onSelect?: () => void;             // omitted -> renders a non-interactive <span>
       leadingIcon?: ReactNode;           // the design's `+`
       selected?: boolean;
       disabled?: boolean;
       size?: "sm" | "md";                // 36px | 38px
       onContextMenu?: …                  // 1d's "right-click or long-press to hide"
       className?: string
```

`"inline-flex items-center gap-1.5 rounded-full border border-line bg-surface pr-3.5 pl-2.5 text-control font-medium text-fg-body"`,
`min-h-9` / `min-h-10`, hover `hover:border-brand hover:text-brand-soft-fg` (the artboard's
`style-hover="border-color:#dc7051;color:#f6c5b4"`), `selected` → `border-brand bg-brand-soft text-brand-soft-fg`,
`focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring`.

- **THERE IS NO `onDismiss` AND NO `×`.** The design's stated fix for "Frequently bought"
  clutter is that the chips carry no per-chip `×` (SPEC §4.6); hiding moves to a
  context-menu / long-press. A `Chip` with a dismiss slot would let the old affordance creep
  back in.
- **Justification:** 1d (8 chips), 1h (5-chip scroller), and the phone group-switcher chip.
  `features/shopping/components/FrequentlyUsed.tsx` already contains a private
  implementation, which the shopping area replaces with this — same reason as `ProgressBar`.
- Minimum target: `min-h-9` (36 px) is below the 44 px floor. That is the design's value and
  it is acceptable **only** because a chip is a shortcut whose action is also available from
  the always-present add bar next to it. Note it in the file's header comment so it is not
  "fixed" by copying `min-h-11` from `Button`.

#### `Stepper.tsx` — **new**, and `ServingsScaler` becomes a wrapper

```
Props: value: number; onChange: (next: number) => void;
       min?: number; max?: number; step?: number | ((v: number) => number);
       format?: (v: number) => string;    // default String(v)
       decreaseLabel: string; increaseLabel: string;  // aria-labels, required
       srLabel?: string;
       size?: "sm" | "md";                // 36px (desktop 1a) | 40px (phone 1f)
       className?: string
```

Renders the design's rectangular control: `inline-flex items-center rounded-control border border-line bg-surface-inset`
(desktop 1a sits it on `#17120f` = `--surface-inset` inside a `--surface` card; phone 1f
sits it on `--surface` — pass `className="bg-surface"` there), a `size-9`/`size-10`
`<Minus />` button, an `<output aria-live="polite">` in `text-control font-semibold tabular-nums`,
a `<Plus />` button. Uses `useId()` for the `srLabel`, not a constant.

- `ServingsScaler.tsx` keeps **all** of its own logic — the halves-below-4 `step()`, the
  `clamp()`, `formatQuantity`, the `noun` resolution, the reset-to-`baseValue` button, and
  its `recipes.scaler.*` keys — and delegates the `− value +` frame to `Stepper`. Its
  generated-`useId` comment ("two scalers can be on screen at once") moves into `Stepper`.
- **Justification:** the recipe detail screen and the planner (SPEC §4.1,
  `meal_plan_entries.servings`) both need it, i.e. two areas. Leaving it in
  `features/recipes/components/` guarantees the planner agent copies it, and a copied
  stepper is how the two stop agreeing about the touch target. Promoting the *frame* while
  leaving the *servings semantics* in the feature is the split that keeps
  `packages/shared`'s `scaleIngredients` the single source of the arithmetic.

### 4.4 `features/import/lib/shell.tsx` stays a typing seam

`shell.tsx` is the import feature's only coupling to the shell and its header says why: it
holds **casts**, never implementations. If an import screen needs `ProgressBar`, `Chip`,
`SectionHeader`, `Stat` or `Stepper`, add a `ComponentType<…>` re-export there in the
existing style. **Do not add a fallback, a wrapper with markup, or a second variant table.**
`UploadProgress` is not in `shell.tsx` and does not need to be — it imports from
`@/components/ui` directly, like the rest of `features/import/components/`.

---

## 5 — Extrapolation rules for the undesigned screens (D6)

**This section is the contract five agents restyle five different screens against.** If a
pattern is not here and not in the artboards, ask — do not invent a sixth answer.

The screens with no artboard, all of which must land on these rules:

```
features/recipes/RecipeNewPage.tsx      features/groups/GroupsPage.tsx
features/recipes/RecipeEditPage.tsx     features/groups/GroupDetailPage.tsx
features/recipes/components/RecipeForm.tsx (+ IngredientsEditor, StepsEditor,
                                            RecipeImagePicker, RecipeFilters, CookMode)
features/import/ImportPage.tsx          features/auth/AccountSettingsPage.tsx
features/import/ImportReviewPage.tsx    features/cards/CardsPage.tsx
features/collections/CollectionsPage.tsx  features/auth/LoginPage.tsx
features/collections/CollectionDetailPage.tsx  features/auth/RegisterPage.tsx
features/tags/TagsPage.tsx              features/auth/ForgotPasswordPage.tsx
components/layout/NotFoundPage.tsx      features/auth/ResetPasswordPage.tsx
                                        features/auth/VerifyEmailPage.tsx
                                        features/auth/InvitePage.tsx
                                        features/auth/OAuthCallbackPage.tsx
                                        (+ the new /plan screen — SPEC §4.1)
```

### 5.1 The lookup table

| Pattern | Token | Type step | Primitive / classes |
| --- | --- | --- | --- |
| Page root | — | — | `flex flex-col gap-4` **and nothing else.** `AppShell`'s `<main>` already applies `mx-auto max-w-5xl px-gutter pt-4 pb-tabbar`; re-applying any of the four is the `ImportReviewPage` bug. Grep `pb-tabbar` before adding one. |
| Page `h1` | `text-fg` | `font-display text-display-2xl lg:text-display-3xl font-medium` | plain `<h1>`; `text-wrap: balance` comes from `@layer base` |
| Page subtitle under the `h1` | `text-fg-subtle` | `text-sm` | `<p class="mt-1.5">` |
| Article/detail hero `h1` (desktop only) | `text-fg` | `font-display text-display-2xl lg:text-display-4xl font-medium` | recipe detail only |
| Card / panel heading | `text-fg` | `font-display text-display-md font-medium` | `CardHeader title=` |
| Column heading (`Ingredients`, `Method`) | `text-fg` | `font-display text-display-lg font-medium` | plain `<h2>` + a `text-xs text-fg-subtle` count beside it |
| Sub-heading inside a card (`Für den Teig`) | `text-fg-faint` | `.eyebrow` | `<h3 class="eyebrow text-fg-faint">` |
| Section header with a rule | `text-fg-faint` | `.eyebrow` | **`<SectionHeader />`** |
| Recipe course / category | `text-accent-strong` | `.eyebrow` | `<span class="eyebrow text-accent-strong">`. **CONTENT** — the vocabulary is German and never goes through `t()` (SPEC §4.4). A recipe with no `kind='course'` tag renders **no element**, not an empty one. |
| Editorial row title (list, planner, rails) | `text-fg` | `font-display text-display-sm font-medium text-pretty` | **no `line-clamp`** — the design's stated fix is that titles never truncate |
| Compact row title inside a panel | `text-fg` | `font-display text-display-xs font-medium` | |
| Long-form prose (description, step text) | `text-fg-body` | `text-base` (lh 1.6) | `<p>`; `text-wrap: pretty` from base |
| Body copy in a panel | `text-fg-muted` | `text-sm` | |
| Metadata line (`30 min · 4 Portionen`, `who · when`, `Tue · 9 ingredients`) | `text-fg-subtle` | `text-xs` | |
| Quietest label / provenance (`from`, `+2 more`, hints) | `text-fg-faint` | `text-xs` | |
| A quantity, anywhere | `text-accent-strong`; `text-fg-faint` when there is no amount | `text-item font-semibold tabular-nums` | right-aligned in a fixed track (`grid-cols-[78px_minmax(0,1fr)]` desktop, `[70px_minmax(0,1fr)]` phone) |
| Stat block | see `Stat` | `.eyebrow` + `text-display-sm`/`md` | **`<Stat />` / `<StatRow />`** |
| Interactive control label | inherits | `text-control font-semibold` | `Button`, `Chip`, `Tabs`, nav items |
| Form label | `text-fg` | `text-control font-medium` | `Label` (already) |
| Form hint / field error | `text-fg-muted` / `text-danger` | `text-xs` | `FieldShell` (already) |
| Input / select / textarea | `bg-surface border-line` | **`text-base` — never smaller** (§2.7) | `controlClasses`; `size="lg"` for a search or add bar |
| Card / panel surface | `bg-surface border border-line` | — | `<Card>` — **flat, `shadow="none"`** |
| Inset surface inside a card | `bg-surface-inset` | — | the stepper's ground, a code/preview block |
| Sidebar / tab-bar ground | `bg-bg-sunken` | — | `SideNav`, `BottomTabBar` (nav area) |
| Hairline | `bg-surface-2` (as a 1 px block) or `border-surface-2` | — | `--surface-2` `#2a221c`, **not** `--line` `#382e26`: the design uses the darker one for internal rules and the lighter one for card borders. Both, correctly, in both themes. |
| Card / panel radius | `rounded-card` (16) | — | |
| Button / nav-item radius | `rounded-control` (10) | — | |
| Row / tile / input radius | `rounded-xl` (12) | — | |
| Chip / pill / progress radius | `rounded-full` | — | |
| Primary action | `bg-brand text-brand-fg` | `text-control font-bold` | `<Button>` |
| Quiet action | `bg-surface border-line-strong text-fg` | `text-control font-semibold` | `<Button variant="outline">` |
| Positive/confirmed action | `bg-success-soft text-success-soft-fg` | | `<Button variant="success">` |
| "Add something" affordance | dashed `border-line-strong` | | `<Button variant="dashed">` |
| Destructive action | `bg-danger text-danger-fg` | | `<Button variant="danger">` |
| Inline text link | `text-brand-hover hover:text-brand-soft-fg` | inherits | `<Link>` / `<a>` |
| Overflow actions in a header | — | — | **ONE `<ActionMenu>`**, never a row of `IconButton`s |
| Icon over a photo | `bg-bg/70` | — | `<IconButton shape="circle" variant="scrim">` |
| Empty state | dashed `border-line-strong`, transparent | `font-display text-display-md` | `<EmptyState>` |
| Error state | `bg-surface border-line` | same | `<ErrorState>` |
| Loading a list | `bg-skeleton` | — | `<SkeletonList variant=…>` — the variant must match the branch that replaces it |
| Bottom action bar | `bg-surface border-t border-line`, `shadow-pop` | — | `sticky bottom-tabbar -mb-4`, an unbroken flex chain and a `flex-1` spacer above it. **Never `bottom-0`.** |
| Arrow / chevron / check / ellipsis | `currentColor` | — | a `lucide-react` icon, never a text glyph (§1.4) |
| Elevation | — | — | **only two things are lifted**: the phone bottom action bars (`shadow-pop`) and `Dialog`/`Toast` (already). Every other surface is flat. |

### 5.2 The five rules that decide whether five screens look like one app

1. **Flat surfaces, hairline borders.** If you are reaching for a shadow, you are wrong
   unless the thing floats over content.
2. **Serif for names, sans for everything else.** A recipe title, a list name, a collection
   name, a group name, a section/panel heading, a stat value: `font-display font-medium`.
   A label, a button, a count, a date, a hint, an error: sans. Never serif on a control.
3. **Five foreground tiers, used in order.** `--fg` (names, values) → `--fg-body` (prose) →
   `--fg-muted` (secondary copy) → `--fg-subtle` (metadata) → `--fg-faint` (structural
   labels, provenance). Never skip a tier to "make it quieter"; never use a raw
   `--toon-*` ramp variable in a component.
4. **Honey means quantity or category. Green means done. Paprika means action.**
   `--accent-strong` for amounts and course eyebrows, `--success` for cooked/bought,
   `--brand` for the thing you tap. Nothing else gets a colour.
5. **Verify at 390 px in a real headless browser, not by reading classes.** `CLAUDE.md`
   says both layout bugs it documents measured wrong on the first attempt and only the
   screenshots showed it. Assert `documentElement.scrollWidth === clientWidth`, the
   computed `<main>` padding, and the gap between any bottom bar and `nav.fixed` — and do
   not match the tab bar by its `aria-label`, since `SideNav` carries the same one.

### 5.3 Screens that need a specific call

- **The auth screens** (`Login`, `Register`, `ForgotPassword`, `ResetPassword`,
  `VerifyEmail`, `Invite`, `OAuthCallback`) render outside `AppShell` in `AuthLayout`. They
  get rules 1–4 and the type scale, and **nothing from the sidebar**: no `--bg-sunken`, no
  nav. The heading is `font-display text-display-2xl font-medium` on `--bg`.
- **`CookMode`** is a full-bleed overlay with its own `px-safe` (one of the two places
  `.px-safe` is legitimately the whole padding). Step text goes to `text-base text-fg-body`;
  the step-number eyebrow keeps `text-brand` and moves from `tracking-widest` to `.eyebrow`.
- **`ImportReviewPage`** is the screen the "page root must not re-apply `AppShell`'s
  padding" gotcha was written about, and its footer bar is one of the three
  `bottom-tabbar` instances. Restyle only; do not touch the `ImportErrorText`
  key-not-sentence machinery.
- **`RecipeFilters`'s "Erweiterte Suche" panel** is the only route to Collections and Tags
  on a phone, and its tag row is a `<fieldset>` wrapping a horizontal scroller — it needs
  `min-w-0` explicitly, because a `<fieldset>` carries the browser's own
  `min-inline-size: min-content` and ignores the rule you would apply to any other item.
- **`/plan`** has no artboard at all (SPEC §4.1). It is built from the day-card states in
  the library's "This week" strip plus §5.1, and the PR must say so.

---

## 6 — Gaps, and what I recommend

| # | Gap | Recommendation |
| --- | --- | --- |
| 1 | `#6b5c4b` measures **2.88:1** and the design uses it for 24 pieces of 11 px copy. | Ship `--fg-faint` at `#8d7c67` (4.61:1) — one ramp step, five tiers still distinguishable, and `index.ts` already commits the primitives to accessibility. Owner may overrule with a one-line `theme.css` change; do not fork over it. |
| 2 | The loyalty-card tile has a gradient and `cards` has no colour column. | Derive two stops from `card.id` over a fixed 6-pair table in `packages/shared` with a unit test. No migration, no colour picker. Belongs to the cards area. |
| 3 | The design's 14.5/15 px input text vs the iOS 16 px zoom floor. | Inputs stay `text-base`. The floor is already enforced in `@layer base` and exists for a reason. |
| 4 | Newsreader static-500 vs a two-axis VF with real optical sizing. | Static. Revisit only if the precache budget is reopened; it is a drop-in swap. |
| 5 | Does Figtree's subset actually carry `tnum`? | Cannot verify without the files. Check with `fonttools ttx -t GSUB` after downloading and report in the PR; if absent, use fixed `ch` widths rather than a no-op class. |
| 6 | 19/20/21/22 px serif headings collapsed to 21; 28/30 collapsed to 28. | Accepted, ≤1 px on any element except the phone shopping `h1` (−2 px). Flagged rather than hidden. |
| 7 | `--radius-sheet` (20 px) has no artboard counterpart. | Leave. The design draws no dialog and `Dialog` is not a screen. |
| 8 | Both list breakpoints are editorial rows in the design, which may make `useIsWideViewport()`'s markup branch pointless. | **Area 04's call, not mine.** `SkeletonList`'s `variant` must match whatever it decides; if the branch collapses, `variant="cards"` survives for the collections grid and the `rows` skeleton becomes the only recipe-list skeleton. Do not delete `useIsWideViewport()` without also removing the `display:none`-`<img>`-still-fetched hazard it exists for. |
| 9 | A metrics-matched fallback (`size-adjust`/`ascent-override` on a `local("Georgia")` face) would remove the swap CLS entirely. | Not prescribed — the override values have to be measured against the actual shipped files. Worth a follow-up; do not guess the numbers. |

---

## 7 — Cross-area contracts

| With | Contract |
| --- | --- |
| **02 / shell + nav** | `--bg-sunken` is the sidebar and tab-bar ground in both themes. `Avatar shape="square" tone="brand"` is the group avatar; `shape="circle" tone="accent"` is the user avatar. The sidebar `New` pill is `Badge variant="accent" size="sm"`. Nav items are `rounded-control text-sm`; the secondary "Organise" group's items are `text-control`, and its label is `.eyebrow text-fg-faint`. `BottomTabBar` keeps `.px-safe` (one of the two legitimate uses). |
| **04 / recipes screens** | `Stat`/`StatRow` replaces `RecipeDetailPage.tsx:340`'s hand-rolled `<dt>/<dd>`. `Stepper` lands in `components/ui` and `ServingsScaler` becomes its wrapper — area 04 must not restyle `ServingsScaler`'s frame independently. `SkeletonList variant` must match the list's markup branch (gap 8). Editorial row titles drop `line-clamp-2` (`RecipeCard.tsx:67`, `RecipeRow.tsx`). |
| **05 / shopping screens** | `Chip` replaces `features/shopping/components/FrequentlyUsed.tsx`'s private chip **and drops its per-chip `×`** (SPEC §4.6). `ProgressBar` is the 1c/1g bar; its denominator is a pure function in `packages/shared`, not inline JSX. `SectionHeader` is the `To buy` / `Bought today` header. The add bar is `Input size="lg"` at `text-base` — not the design's 15 px. |
| **import** | `features/import/components/UploadProgress.tsx` must be rewritten to compose `ProgressBar` rather than keep its own bar. `features/import/lib/shell.tsx` may gain typed re-exports of the new primitives and **must not gain an implementation**. |
| **cards** | Gap 2 (the tile gradient) is yours. `useCanMutate()` still applies on the cards screens (the opposite of shopping) — nothing here changes that. |
| **all** | Zero new keys in `ui.de.ts` / `ui.en.ts` from this area: the new primitives take ready-to-render strings. Any accessible name a new primitive needs is a **required prop**, supplied from the screen's own namespace. |

---

## 8 — Verification for this area

Beyond the five gates (`bun install`, `bun run typecheck`, `bun test`, `bun run build`,
`bun run i18n:check` — and read `i18n:check`'s output, never just its exit code):

1. **Fonts actually load and are actually precached.** `bun run build` then
   `grep -c woff2 apps/web/dist/sw.js` → 4. Open the preview with the network throttled and
   confirm no request to `fonts.googleapis.com` and no request to `/fonts/*` on the *second*
   load.
2. **No synthetic bold on the serif.** `grep -rn "font-display" apps/web/src | grep -c
   "font-semibold\|font-bold"` → **0**.
3. **No arbitrary type sizes.** `grep -rnE 'text-\[[0-9.]+(px|rem)\]' apps/web/src` returns
   only the deliberate avatar-initial sizes named in §4.2.
4. **No raw ramp variables in components.** `grep -rn "toon-sand\|toon-brand\|toon-accent\|
   toon-herb" apps/web/src --include=*.tsx` → 0 hits.
5. **All four theme blocks agree.** Re-run the block diff (§3.6) and assert all four define
   the same 39 semantic tokens.
6. **Light mode still works, in both of its states.** Check `/`, `/recipes/$id`, `/shopping`
   and `/shopping/$listId` in four combinations: OS-light + no `data-theme`, OS-dark +
   `data-theme="light"`, OS-light + `data-theme="dark"`, OS-dark + no `data-theme`. The
   third combination is the one that was broken (§3.6) and the one nobody checks.
7. **390 px, real browser.** Per §5.2 rule 5, on the 4-up `StatRow`, the chip scroller, and
   any `<fieldset>` that wraps one.
8. **Glyph sweep.** `grep -rn '→\|←\|✓\|▾' apps/web/src` → 0 hits.
