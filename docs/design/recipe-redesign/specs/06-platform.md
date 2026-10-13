# 06 — Platform: routing, offline/PWA, migrations, tests, docs, gates

**Area owner:** platform. **Reads:** `docs/redesign/SPEC.md` (the contract), `CLAUDE.md`
(gotchas), `docs/redesign/design.dc.html` (artboards).

This spec owns the *seams* the six feature areas plug into: the route tree, the offline
allow-lists, the service-worker config, the migration sequence, where each kind of test
goes, the headless verification runbook, the doc edits, and how each of the five gates
will fail on the first attempt. It does **not** own any screen, any endpoint handler, or
any catalog entry — where it names those, it names them so the owning area can wire to a
fixed shape rather than invent one.

**Nothing in here reopens D1–D7.** Where the redesign invalidates a `CLAUDE.md` entry,
§7.4 catalogues it; the entry itself is rewritten by a later agent (D3).

Three cross-area rules that come out of this area and bind everybody:

1. **`bun run db:generate` is serialised.** Three areas add DDL; drizzle-kit writes a
   sequential journal and one snapshot per migration, so two agents generating at once
   produce two `0006_*` files and a corrupt `_journal.json`. §4.2 fixes the order.
2. **`PERSIST_BUSTER` is bumped exactly once**, by the platform commit, last. §2.3.
3. **No new dependency.** Fonts are files under `apps/web/public/fonts/`; Playwright is
   installed outside the repo. §3.1, §6.1.

---

## 1 — Router

File: `apps/web/src/router.tsx`. Nothing else in the app declares a route.

### 1.1 New routes

| Route | Parent | Component | Params |
| --- | --- | --- | --- |
| `/plan` | `groupScopedRoute` | `lazyRouteComponent(() => import("@/features/plan/PlanPage"))` | `PLAN_PARAMS` |
| `/shopping/history` | `groupScopedRoute` | `lazyRouteComponent(() => import("@/features/shopping/ShoppingHistoryPage"))` | `SHOPPING_HISTORY_PARAMS` |

Add both to the `routeTree`'s `groupScopedRoute.addChildren([...])` array and to the
exported `routes` object as `plan` and `shoppingHistory`.

```ts
/**
 * The planner week. `week` is the ISO date (YYYY-MM-DD) of the week's MONDAY, so the
 * URL is shareable and a browser back button moves a week rather than re-rendering the
 * same one. Absent means "the current week", resolved by weekStart(new Date()) in
 * @toon/shared — never stored in the URL as a default, or every link would go stale.
 */
const PLAN_PARAMS = ["week"] as const;

/**
 * The bought archive. `listId` narrows to one list (the overview panel links without
 * it, a list's own "All" link links with it); `offset` pages the standard
 * { items, total, limit, offset } envelope.
 */
const SHOPPING_HISTORY_PARAMS = ["listId", "offset"] as const;
```

`pick()` coerces to `string | undefined`, so `offset` arrives as a string exactly as
`maxMinutes` already does; parse it at the call site with `Number.parseInt`, and treat
`NaN` as 0 rather than throwing — a hand-edited URL must not blank the screen.

**`/shopping/history` — SPEC open item 4, decided.** The design's `All` link (artboard
`1c`, "Bought history" panel) needs a destination and none was drawn.
**Recommendation: a real route, `/shopping/history`.** Reason: it is a paginated,
deep-linkable list whose whole purpose is scrolling back through weeks; a dialog would
have to hold `offset` in component state, could not be linked to from the phone list
rail, and would lose its place on every re-render. It satisfies `CLAUDE.md`'s nav rule
without a tab because it hangs off `/shopping`, which *is* a tab — the same argument
that already justifies `/shopping/cards`.

**Registration order.** `/shopping/history` and `/shopping/cards` are static segments and
TanStack ranks a static segment above `$listId` regardless of declaration order, so this
is documentation rather than load-bearing — but declare it next to `cardsRoute` and
above `shoppingListRoute`, for the same reason the file already does that for `cards`:
reading top to bottom, the more specific route has to appear first or the next reader
wonders whether `$listId` swallows it. **The server side of this is load-bearing** and is
covered in §4.1 and §5.1.

### 1.2 Changed params

`RECIPE_FILTER_PARAMS` — **the array itself does not need a new entry for the cooked
sort.** SPEC §4.2 says `?sort=lastCooked` "needs a line in `RECIPE_FILTER_PARAMS` … or it
is dropped by `pick()`"; `sort` is already listed, so what actually has to change is
`RecipeSortSchema` in `packages/shared/src/schemas/recipe.ts`
(`z.enum(["newest","oldest","title","rating","time"])` gains `"lastCooked"`). No router
edit. Recording this so nobody adds a redundant `"lastCooked"` string to the params
array and then wonders why `pick()` never sees it.

`RECIPE_FILTER_PARAMS` — **course filter: reuse `tags`, add nothing.**
**Recommendation.** The desktop library's left rail splits `courseFilters` from
`tagFilters` (SPEC §4.4), but under D5 a course *is* a row in `tags` with
`kind='course'`, and `tags` already means "a comma-separated list of tag **ids**; a
recipe must carry all". So the rail writes course selections into the existing `tags`
param and the rail's two sections are a *presentational* split of one filter, driven by
`kind` on `TagResponse`. Reason: zero new params, zero query-schema change, zero index,
and the "must carry all" semantics are already right for `Hauptspeise` + `Vegan`.
*Alternative, rejected:* a separate `course` param with single-select semantics — it
would need its own line in `RECIPE_FILTER_PARAMS`, its own field in `RecipeListQuery`,
and a second join in the list query, to express something the existing param already
expresses. Flagged as an open item (§8.4) because area 04 owns the rail.

**`/search` keeps declaring the same params, and gets that for free.** `searchRoute` and
`recipeListRoute` both spread the *same* `RECIPE_FILTER_PARAMS` const, so any edit to the
array reaches both. Do not give `/search` its own list. The rule stands unchanged:
`validateSearch` runs before `beforeLoad`, so a param missing from the array is stripped
before the redirect can forward it, and an old `/search?q=…` bookmark silently loses its
query. `/plan` and `/shopping/history` need no such mirror — nothing redirects into
them.

### 1.3 `/import` stays a route

Area 07 moves Import out of the phone tab bar into the `+` button's sheet in the library
header (SPEC §4.7). **That is a `nav-items.ts` change, not a router change.** `/import`
and `/import/$draftId` stay exactly as declared, stay children of `groupScopedRoute`, and
stay `lazyRouteComponent` — the PWA manifest's `shortcuts` entry in
`apps/web/vite.config.ts` points at `/import` and would 404 otherwise, and the deep link
in a mailed/shared URL has to keep resolving.

`NavItem["to"]` in `apps/web/src/components/layout/nav-items.ts` is a closed string
union and must gain `"/plan"`. `tsc` fails until it does — that is the type doing its
job, not a problem to work around (§8.2a).

### 1.4 `lazyRouteComponent`, and why a wrapper breaks preloading

Both new screens use `lazyRouteComponent` and export their page as the module's
**default** export. This is not stylistic. The router preloads by calling
`route.options.component.preload()` (router-core's `preloadComponent`), and `.preload` is
a property `lazyRouteComponent` *attaches to the component it returns*. A hand-rolled
`React.lazy` wrapper — or any component that renders a lazy one — is a different function
object with no `.preload`, so `defaultPreload: "intent"` silently becomes a no-op and
every navigation waits on a cold chunk fetch. It also loses the one-shot reload on a
missing module chunk, which is exactly the failure a service-worker deploy produces when
an old document asks for an `assets/PlanPage-<hash>.js` the new precache no longer has.

Corollary for `RequireActiveGroup`: `/plan` is a child of `groupScopedRoute`, the
pathless layout route — **do not wrap `PlanPage` in a guard component**. The guard is a
layout route precisely so the lazy component stays the route's `component` and keeps its
`.preload`. Same for `/shopping/history`.

---

## 2 — Offline

### 2.1 New query keys

Add to `queryKeys` in `apps/web/src/lib/queries.ts`, keeping the hierarchical layout so a
prefix invalidates a subtree:

```ts
  /** The planner. `filterKey({ week })` keeps the key stable and order-independent. */
  plan: (groupId: string, query?: { week?: string }) =>
    [ROOT, "group", groupId, "plan", filterKey(query)] as const,
  planRoot: (groupId: string) => [ROOT, "group", groupId, "plan"] as const,

  /** The week's planned recipes diffed against ONE list's merge keys (§4.5). */
  planShopping: (groupId: string, listId: string) =>
    [ROOT, "group", groupId, "plan-shopping", listId] as const,

  /** Sidebar/tab counts: recipe count + open shopping items (§4.7). */
  groupSummary: (groupId: string) => [ROOT, "group", groupId, "summary"] as const,

  /** The three day rows + today's count that draw the overview history panel. */
  boughtSummary: (groupId: string) => [ROOT, "group", groupId, "bought-summary"] as const,

  /** The paginated archive behind /shopping/history. */
  boughtHistory: (groupId: string, query?: { listId?: string; offset?: number }) =>
    [ROOT, "group", groupId, "bought-history", filterKey(query)] as const,
```

Matching `invalidate.*` helpers: `plan`, `planShopping`, `groupSummary`, `boughtSummary`,
`boughtHistory`. Two composite helpers, because these caches are coupled:

- `invalidateAfterPlanMutation(qc, groupId)` → `plan` + `planShopping` + `groupSummary`.
- Extend the existing shopping `commit` path (`features/shopping/lib/offline.ts`, the
  `commit` closure in `registerShoppingMutationDefaults`) to also invalidate
  `boughtSummary` and `groupSummary` — a check-off changes both the "4 bought today"
  count and the sidebar's shopping badge. It must **not** invalidate `boughtHistory`:
  that query is not persisted and not mounted, so invalidating it is a wasted round trip
  offline and a no-op online.

**Two keys deliberately NOT created:**

- **No "recently cooked" key.** SPEC §4.2's desktop carousel is a recipe list ordered by
  last-cooked. Use `recipesQuery(groupId, { sort: "lastCooked", limit: 5 })` — same
  endpoint, same envelope, same persistence, and the carousel inherits the list's
  thumbnail rules for free. A dedicated endpoint would duplicate
  `{ items, total, limit, offset }` for five rows.
- **No "full catalog" key for `Show all 24`.** `SHOPPING_LIMITS.catalogSuggestions` is
  **24** (`packages/shared/src/schemas/shopping.ts:26`) and
  `getShoppingListDetail` already returns up to 24 entries in
  `ShoppingListDetailResponse.catalog`
  (`apps/api/src/services/shopping/lists.service.ts:199-207`). The design's rail shows 8
  of them; `Show all 24` expands the array that is **already in the cache**. No endpoint,
  no key, no fetch — and it works offline, which a new endpoint would not. Tell area 03.

### 2.2 The offline table

`shouldPersistQuery` in `apps/web/src/lib/persist.ts` is an **allow-list**: a new endpoint
is excluded until its key segment is named in `PERSISTED_GROUP_SEGMENTS`.

| Key segment | Persisted (`PERSISTED_GROUP_SEGMENTS`) | Service worker `runtimeCaching` | `networkMode` | Why |
| --- | --- | --- | --- | --- |
| `plan` | **yes** — add `"plan"` | **`NetworkOnly`** — add a rule | `"offlineFirst"` | The week strip is on `/`, the first screen an offline cold start paints. Without persistence the strip is a permanent skeleton; without `offlineFirst` the query sits `pending` forever instead of rendering the restored copy. `NetworkOnly` for the reason rule 4 already documents: its offline copy **is** the persisted TanStack cache, and a `NetworkFirst` hit would hand TanStack a stale week that looks like a fresh success. |
| `summary` | **yes** — add `"summary"` | none needed (matches no pattern) | `"offlineFirst"` | Feeds the shell (sidebar counts, tab badge), so it is requested on every cold start including an offline one. Tiny payload. A stale count is strictly better than a blank one; render nothing, never `0`, when the value is absent. |
| `bought-summary` | **yes** — add `"bought-summary"` | already `NetworkOnly` (see §2.4) | `"offlineFirst"` | It renders on `/shopping`, which is on the offline path today (`shopping-lists` is persisted). An unpersisted panel on a persisted screen is a spinner that never resolves. |
| `bought-history` | **no** | already `NetworkOnly` (see §2.4) | default (online) | `/shopping/history` is an archive read at a desk, and it is paginated — persisting every page would grow the blob without bound. Default `networkMode` is what makes the screen show the offline banner instead of an empty archive that reads as data loss. |
| `plan-shopping` | **no** | none needed (matches no pattern) | default (online) | It is a server-computed diff whose only purpose is driving an **online-only** bulk add. Offline the panel hides; a persisted diff would offer an `Add` button that cannot run. |

`shouldPersistQuery`'s other two guards still apply and are why the table has no
exceptions: a `pending` or `error` query is never persisted (it would restore as "no
plan" rather than "not loaded"), and a `null`/`undefined` payload is never persisted.

**Nothing is added to `PERSISTED_MUTATION_KEYS`.** It stays `new Set(["shopping"])` —
see §2.5.

### 2.3 `PERSIST_BUSTER` must go to `"v3"`

Yes, and once. `PERSIST_BUSTER` is bumped "whenever a change would make an old blob
wrong (a query-key rename, a response-shape change)", and this redesign is a
response-shape change three times over:

- `ShoppingListDetailResponse` gains a `bought` array and the two counts behind
  `10 to buy · 4 bought today` (area 03).
- `RecipeResponse` gains `lastCookedAt` (area 02) and a course tag exposed through
  `kind` on its tags (area 04).
- `TagResponse` gains `kind`.

A restored `v2` blob hands the new components items with no `bought` array, and a
`bought.map()` on `undefined` is a white screen behind an `ErrorBoundary`, on the exact
screen that is supposed to work when nothing else does. Cost of the bump: one cold
re-fetch per device, once. That is the right trade and it is the same call the `v1 → v2`
comment already documents.

**Coordination (this is a real conflict, §8.5).** Three areas each have a reason to bump
it. If three commits each bump it the value churns (`v3`, `v4`, `v5`) and every
intermediate build invalidates every device again. **Rule: only the platform commit
touches `PERSIST_BUSTER`, it sets `"v3"`, and it lands last.** Areas 02/03/04 must not
edit `apps/web/src/lib/persist.ts` at all — including `PERSISTED_GROUP_SEGMENTS`, which
is also mine (§2.2), so the allow-list and the buster move together in one reviewable
diff.

### 2.4 Endpoint paths chosen so the existing SW rules already cover them

`RUNTIME_CACHING` in `apps/web/vite.config.ts` has a `NetworkOnly` rule matching
`/\/api\/groups\/[^/]+\/shopping-lists/`. Putting the bought endpoints **under that
prefix** means they inherit it with no new rule and no risk of a later widening of the
`NetworkFirst` recipes pattern claiming them:

```
GET    /api/groups/:groupId/shopping-lists/bought              -> group-level history + summary
DELETE /api/groups/:groupId/shopping-lists/:listId/bought      -> "Clear bought" (watermark)
POST   /api/groups/:groupId/shopping-lists/:listId/catalog/:entryId/hidden
DELETE /api/groups/:groupId/shopping-lists/:listId/catalog/:entryId/hidden
```

**`…/shopping-lists/bought` must be registered BEFORE `…/shopping-lists/:listId` in
`apps/api/src/routes/shopping.ts`.** This is the same ordering trap `CLAUDE.md` already
pins for `/invites/:token` and `/invites/accept` before `/:groupId` in `routes/groups.ts`:
without it, `bought` is parsed as a list id and answers 404 (or worse, 200 for a list
that happens to be named that). §5.1 names the test that pins it.

One new rule **is** needed, for the planner:

```ts
  {
    /**
     * The planner, NetworkOnly for the same reason shopping lists are: its offline copy
     * is the persisted TanStack cache (src/lib/persist.ts). A NetworkFirst hit would
     * hand TanStack a stale week body that looks like a fresh success and overwrite the
     * restored one. Must come before the recipes rule.
     */
    urlPattern: /\/api\/groups\/[^/]+\/plan/,
    handler: "NetworkOnly" as const,
  },
```

Insert it immediately after the existing `shopping-lists` rule and **before** the
`NetworkFirst` `(recipes|tags|collections)` rule — a `NetworkOnly` rule that comes second
is never consulted, which is the reason the file already orders `/api/auth/` first.

`/api/groups/:groupId/summary` matches no pattern and therefore goes straight to the
network, which is correct. **Do not "tidy" it into the `NetworkFirst` recipes rule** —
that rule's regex is `(recipes|tags|collections)` and widening it to `|summary` would
give the shell a cached count that contradicts the list beside it.

Unchanged and non-negotiable: `navigateFallbackDenylist: [/^\/api\//, /^\/uploads\//]`,
`/api/auth/*` and `/api/groups/*/imports` stay `NetworkOnly`, `/api/cards` stays
`NetworkOnly`, `/uploads/` stays `CacheFirst`.

### 2.5 Mutations: which get `setMutationDefaults`, which are ordinary

The four pieces that make offline shopping safe (`setMutationDefaults` registration ·
`networkMode: "offlineFirst"` · `shouldPersistMutation` · a call-time `mutationId`) are a
package. A mutation either gets all four or none. Decisions:

| Mutation | Registered in `features/shopping/lib/offline.ts`? | Decision and reason |
| --- | --- | --- |
| Create / update / delete a plan entry (`POST`/`PATCH`/`DELETE …/plan/entries[/:id]`) | **no** | **Ordinary online mutation**, inline in `useMutation`, gated on `useCanMutate()`. SPEC §5 already says "treat them like list create/rename". Planning is done at home; a replay of "plan Thursday" two days later is stale in a way that is *not* last-writer-wins-correct (the day has passed), and there is no merge algebra whose silent doubling the ledger would be protecting against. |
| `POST …/recipes/:recipeId/cooked` | **no** | **Ordinary online mutation.** Argued, because this button is pressed in a kitchen where the wifi is bad. Queuing it would need a `mutationId` (a double append is "cooked twice", which moves `lastCookedAt` and the carousel), a new `PERSISTED_MUTATION_KEYS` entry, and a ledger scope outside `shopping_mutations` — which is `list_id`-scoped and cascades from `shopping_lists`, so it cannot hold a recipe mutation. Three new pieces of machinery for one button whose worst failure is a wrong "Last cooked" date, not lost work. It must therefore **report** failure (a toast), not be fire-and-forget — unlike `POST /api/cards/:id/used`, where the write must never stop the barcode from being on screen. |
| `Clear bought` (`DELETE …/shopping-lists/:listId/bought`) | **no** | **Ordinary online mutation**, gated on `isOnline` exactly like list create/rename/delete already are on that screen. It moves a watermark; a replay two days later clears a section the user has since refilled. Housekeeping, not shopping. |
| Hide / unhide a suggestion chip (`…/catalog/:entryId/hidden`) | **no** | **Ordinary online mutation.** A long-press to hide is a preference; a hidden chip that reappears after a failed offline hide is self-explanatory, and it costs the user one more long-press. |
| Check off an item (`SHOPPING_MUTATION_KEYS.check`) | **yes — unchanged** | Keeps its key, its variables, its `mutationId` and its place in the outbox. Area 03's log append happens **server-side inside the same handler**, so a persisted `v2` outbox entry keeps its exact meaning — that is the whole point of D4's shape choice, and it is why `shopping_list_items` gains no `bought_at` and no partial index. |
| `Add all to Einkaufsliste` (plan panel, §4.5) | **reuses `SHOPPING_MUTATION_KEYS.addRecipe`** | Already registered and already persisted. **Mint one `mutationId` per recipe**, at call time, in the loop that fires the N mutations. Reusing one id across the N calls makes the ledger apply the first and silently swallow the rest, and the symptom is "Add all added one recipe" with no error anywhere. |

**One code change inside the offline module, and it is load-bearing.**
`removeFromCache(current, itemId, { asBought: true })` in
`apps/web/src/features/shopping/lib/offline.ts` currently deletes the line and bumps the
cached catalog entry. With a "Bought today" section on screen it must **also** push an
optimistic row into the new `bought` array, or an offline check-off makes the item vanish
instead of moving — which reads as data loss on the one screen that is supposed to be
trustworthy offline. The optimistic row carries: `id: "pending:" + <the item id>` (so
`isPendingItemId` can disable per-row actions on it), `boughtAt: new Date().toISOString()`,
and `boughtBy` = the session user's display name read from the cached `["toon","me"]`
payload, never from a fresh fetch. §5.3 names the test.

### 2.6 `unsavedWork`: no new registration, and the one condition that would change that

`apps/web/src/lib/unsavedWork.ts` is a **counter**, not a boolean, read outside React by
the service-worker update policy (`lib/pwa.ts`). Today two things register with it:
`useNavigationGuard` (`features/recipes/lib/nav.tsx`, which calls `useUnsavedWork`) and
`useDraftAutosave` (`features/import/lib/useAutosave.ts`, registering
`dirty|saving|error`).

**No new screen in this redesign needs a claim.** `/plan` as drawn-by-extrapolation is
pick-a-recipe-and-save through a dialog: no long-lived in-memory draft, so an update
reload loses nothing. The shopping list's add-bar text is unsent input and is already not
registered; queued shopping mutations are explicitly *not* unsaved work (they are in
IndexedDB and replay after the reload, and their `mutationId` makes a double delivery a
no-op).

**The trigger that would change this, written down so area 02 does not miss it:** if
`/plan` gains an inline multi-day editing mode with its own Save button — dragging
recipes between days and committing once — it **must** call
`useNavigationGuard(dirty && !pending)` from `features/recipes/lib/nav.tsx`, which
registers with `unsavedWork` for free. Wiring a bespoke `useState` + `beforeunload`
instead compiles, blocks the browser dialog, and still lets a pending service-worker
update reload the document out from under the edit — because `announce()` in `lib/pwa.ts`
applies an update immediately when `hasUnsavedWork()` is false, and it has no way to know
about a flag that never claimed.

### 2.7 The 403-outbox rule, restated

**A queued offline mutation the server will answer 403 must never enter the outbox at
all.** An account whose address is unconfirmed gets `403 email_unverified` on every
non-GET; a paused mutation waiting to replay into that 403 can never succeed, so queuing
it converts "this is read-only right now" into "your edit was silently discarded three
days later".

That is why the shopping screens take `useEmailVerificationBlock()` **directly** and go
read-only for it, and must **not** use `useCanMutate()` (which is also false offline —
exactly backwards for the one feature that works offline). Unchanged by this redesign,
and it now extends to the new surfaces:

- `/shopping`, `/shopping/$listId` — `useEmailVerificationBlock()`. Unchanged.
- `/shopping/history` — read-only screen, no gate needed.
- `/plan` — **`useCanMutate()`**, the cards-screen rule, because planner writes are
  online-only. This is the opposite of the shopping rule and sits two files away from it;
  it needs its own line in `CLAUDE.md` (§7.4, entry 5).
- **`/recipes/$recipeId` now needs a per-BUTTON split**, which is new. `Add to shopping`
  keeps `useEmailVerificationBlock()` (it queues offline — the existing comment at
  `RecipeDetailPage.tsx:154` says why it is deliberately not `useCanMutate()`), while
  `Cooked` takes `useCanMutate()` because it is online-only. Two different gates on one
  header. Do not unify them.

---

## 3 — Font precaching

### 3.1 `globPatterns`

Area 01 lands self-hosted woff2 under `apps/web/public/fonts/`. Vite copies `public/`
into `dist/` verbatim with stable filenames, so the workbox glob picks them up with one
edit in `apps/web/vite.config.ts`:

```ts
          globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest,woff2}"],
```

Extend the existing comment above it rather than replacing it — the paragraph explaining
why **`wasm` is deliberately absent** stays true and stays there, and its closing
sentence ("Adding `wasm` here is a real decision, not a typo fix") must not be left
reading as "never add anything to this list". Add: `woff2` is precached because the
display serif and the sans are the app's foundation — a webfont that 404s offline reflows
every screen, and the shopping list has to render at a supermarket till.

Three constraints on what area 01 may put there, because they are budget and build
constraints rather than design ones:

1. **Latin + latin-ext subsets only.** Every woff2 in `public/fonts/` is downloaded by
   every install and re-downloaded on every service-worker update. Newsreader (400, 500,
   600, italic 400) + Figtree (400, 500, 600, 700) at latin+latin-ext is ~8 files, ~25 KB
   each, ~200–250 KB added to the precache. Shipping full unicode ranges or unsubsetted
   variable fonts multiplies that by 5–10 and is the difference between an install that
   works on a train and one that does not.
2. **Stable filenames, under `public/fonts/`, not imported from `src/`.** A font imported
   from CSS in `src/` is emitted as `dist/assets/Newsreader-<hash>.woff2`. The glob still
   matches it, so the build passes and the precache looks right — and then the
   `<link rel="preload" href="/fonts/newsreader-500.woff2">` in `index.html` 404s in the
   browser with no build error at all. That silent failure is the reason for the rule.
3. **Preload only the faces above the fold** — Newsreader 500 and Figtree 400/500.
   Preloading all eight makes the browser fetch italics and 700 weights before the first
   paint and defeats the purpose. `font-display: swap` on every face.

**No `fonts.googleapis.com` link, ever** (SPEC §2). §6.4 turns that into an assertion: a
request to `fonts.googleapis.com` from any page in the verification run is a hard
failure.

### 3.2 What must not change

- `navigateFallbackDenylist: [/^\/api\//, /^\/uploads\//]` — unchanged. Fonts are
  same-origin `/fonts/*`, precached, and need no runtime rule.
- `/api` and `/uploads` stay out of `runtimeCaching` for the reasons already in the file
  (a cached API response is a data-correctness bug; `/uploads` is `CacheFirst` and that is
  a separate, deliberate entry, not a general `/api` rule).
- `maximumFileSizeToCacheInBytes: 4 * 1024 * 1024` — per file, so no woff2 comes near it.
  Do not raise it.

### 3.3 `skipWaiting` stays OFF

Not negotiable, and the redesign makes it *more* dangerous to flip, not less: `/plan` and
`/shopping/history` add two more lazy chunks.

With `skipWaiting: true` a newly installed worker activates immediately and claims a
document that is still running the **old** bundle. `cleanupOutdatedCaches: true` deletes
the old precache on activate. The next lazy route the user opens then asks the *new*
precache for an `assets/PlanPage-<oldhash>.js` that no longer exists → a lazy-import
failure into the `ErrorBoundary`. So the worker waits, and `apps/web/src/lib/pwa.ts` owns
the swap: `update()` on `visibilitychange`/`online`/30 min, then
`SKIP_WAITING` → `controllerchange` → reload, applied automatically only while
`hasUnsavedWork()` is false. Do not add a fallback timer to that reload — a blind reload
retries a failing swap on every launch, i.e. a boot loop.

Anyone who reaches for `skipWaiting` to "make the new font show up faster" is about to
reintroduce this. `font-display: swap` is the answer; the font arrives on the next
controlled load.

---

## 4 — Migrations

### 4.1 What the redesign adds

| Area | Object | Shape |
| --- | --- | --- |
| 04 / D5 | `tags.kind` | `text NOT NULL DEFAULT 'free'` (`'course' \| 'free'`) |
| 04 / D5 | index `tags_group_kind_idx` | `(group_id, kind)` — the rail's per-course counts |
| 02 / D7 | `meal_plan_entries` | new table; index `(group_id, planned_on)` |
| 02 | `recipe_cook_log` | new table; index `(recipe_id, cooked_at)`, `(group_id, cooked_at)` |
| 02 | `recipes.last_cooked_at` | `integer` **nullable** |
| 02 | index `recipes_group_last_cooked_idx` | `(group_id, last_cooked_at)` |
| 03 / D4 | `shopping_bought_items` | new table; index `(list_id, bought_at)` |
| 03 | `shopping_lists.bought_cleared_at` | `integer` nullable — the `Clear bought` watermark |
| 03 | `shopping_list_catalog.hidden_at` | `integer` nullable |

`shopping_list_items` and `shopping_list_catalog`'s identity columns are **unchanged**;
no partial index anywhere (D4 chose the log table specifically to avoid one, whose
support on SQLite 3.45.1 is unverified).

### 4.2 Three migrations, serialised, in this order

**Decision: three, one per schema-changing area, generated one agent at a time.**

```
0006_tag_kind.sql                 (area 04)
0007_meal_plan_and_cook_log.sql   (area 02)
0008_shopping_bought.sql          (area 03)
```

Why three and not one: D1 is one commit per phase, and a phase whose migration lives in
another phase's file cannot be applied or reviewed on its own. Why *serialised*: drizzle-kit
writes `apps/api/drizzle/meta/_journal.json` as a sequential list and one
`NNNN_snapshot.json` per migration. Two agents running `bun run db:generate` against the
same tree both produce `0006_*` plus a `0006_snapshot.json`, and the second one's journal
entry overwrites the first's. The failure surfaces later as `runMigrations` applying the
wrong file or skipping one — on a developer's DB, not in a test.

**So: exactly one agent holds the generate lock at a time, in the order above. Area 02
rebases onto area 04's commit before generating; area 03 rebases onto area 02's.** If an
area has to generate out of order, it must delete its `NNNN_*.sql`, its snapshot and its
journal entry, rebase, and re-generate — never hand-edit `_journal.json`.

Why this order and not another: none of the three depends on another's objects, so the
order is free and chosen to put the smallest, lowest-risk DDL first (`tags.kind` is one
`ALTER` + one index), which means the first agent through validates the whole generate →
review → apply loop cheaply.

Rejected alternative: one combined `0006_redesign.sql`. It is simpler to generate and it
makes area 03's commit un-applyable without area 02's schema, which contradicts D1's
"reviewed as a single diff at the end, one commit per phase".

### 4.3 The four SQLite constraints, applied

**(a) `NOT NULL` on a populated table needs a SQL-level `DEFAULT`.** Only `tags.kind` is
NOT NULL, and it gets `DEFAULT 'free'` in the SQL. **Unlike the `*_fold` columns, the
drizzle schema should ALSO carry the default** — `kind: text("kind").notNull().default("free")`
in `apps/api/src/db/schema.ts`. That is the opposite of migration `0003`'s deliberate
divergence, and for a concrete reason: the fold columns have no default in drizzle so
`$inferInsert` makes them **required** and `tsc` rejects an insert site that forgets one
(storing NULL there makes a recipe unfindable). `kind` has no such correctness need — a
tag created by name-upsert from `CreateRecipeRequest.tags` legitimately has no kind, and
`'free'` is the right answer. So there is **no schema/DB divergence for `kind`, and
`db:generate` will not offer to reconcile it.**

**(b) No `GENERATED … STORED`.** libSQL 0.18.0 bundles SQLite **3.45.1**, which rejects
`ALTER TABLE … ADD COLUMN … GENERATED ALWAYS AS (…) STORED` outright. So
`recipes.last_cooked_at` cannot be a generated `max(cooked_at)` over `recipe_cook_log`; it
is a plain nullable column written by the app in the same statement sequence as the log
append (SPEC §4.2's "denormalise and write it from the log"). Nullable, never `NOT NULL
DEFAULT 0` — `0` is 1 Jan 1970 and would sort a never-cooked recipe as "cooked 56 years
ago" under `?sort=lastCooked`.

**(c) A JS backfill runs WITHOUT a transaction.** `backfillFoldedColumns()` in
`apps/api/src/db/migrate.ts` documents why: `runMigrations` runs against `file::memory:`
in every integration test, and a commit there discarded the database on libSQL 0.17.4
(0.18.0 no longer does; the guard is kept because a downgrade would surface as
`no such table` mid-suite).

**And the finding: none of these three migrations needs a backfill at all.**
`apps/api/src/db/migrate.ts` requires **no edit**.

- `recipes.last_cooked_at` — `recipe_cook_log` starts empty on every existing install, so
  there is nothing to derive. A `backfillLastCookedAt()` would be dead code that runs a
  `SELECT` matching nothing on every boot.
- `shopping_lists.bought_cleared_at` / `shopping_list_catalog.hidden_at` — NULL is the
  correct value for every existing row (nothing has been cleared, nothing is hidden).
- `tags.kind` — the SQL `DEFAULT 'free'` fills every existing row correctly, and see (d).

**(d) `tags.kind` gets NO name-matching backfill. Recommendation, and it is a judgement
call worth flagging (§8.3).** It is tempting to promote every existing tag literally named
`Hauptspeise` / `Beilage` / `Dessert` / `Suppe` / `Auflauf` to `kind='course'`. Do not do
it in the migration: it writes a guess about German content vocabulary into user data,
cannot be undone, and would mark a group's free tag named "Dessert" (used as a collection
theme, say) as its course. The UI degrades correctly without it — SPEC §4.4 already
requires that "a recipe with no course tag must render without the eyebrow, not with an
empty one".

The consequence is honest and must be in the release notes: **on an existing install
every recipe starts with no eyebrow**, which is a visible difference from the artboards
until somebody marks their courses. The cheap escape hatch, if area 04 wants it, is an
**opt-in CLI** — `apps/api/scripts/mark-courses.ts`, `bun run tags:mark-courses`,
`--dry-run` first, English ops output per the ops-output rule — not a migration.

### 4.4 What `db:generate` will offer to "fix", and the answer

`apps/api/drizzle.config.ts` runs with `strict: true, verbose: true`, so every generate is
interactive. Three prompts to expect:

1. **The `*_fold` DEFAULT `''` divergence.** Migration `0003` added
   `title_fold`/`description_fold`/`name_fold` with a SQL-level `DEFAULT ''` while the
   drizzle schema declares them `notNull()` with no default — a deliberate divergence, and
   `db:generate` offers to reconcile it on **every** run. **Decline.** It will be offered
   three times across the three migrations; decline three times. Accepting it either drops
   the SQL default (and the next `ALTER` on a populated table fails) or adds a drizzle
   default (and `tsc` stops catching an insert site that forgets a fold, which makes a
   recipe unfindable).
2. **Rename detection.** With `strict`/`verbose`, drizzle asks whether a new column is a
   *rename* of an existing one when the names are close. `recipes.last_cooked_at` next to
   `recipes.created_at`/`updated_at`, and `shopping_list_catalog.hidden_at` next to
   `last_used_at`, are both close enough to be offered. **Always answer "create column",
   never "rename"** — a rename emits an `ALTER TABLE … RENAME COLUMN` that destroys the
   existing column's data.
3. **Table rename** for `shopping_bought_items` against `shopping_list_items` /
   `shopping_mutations`. Same answer: create.

### 4.5 Verify the DDL through `@libsql/client`, never `bun:sqlite`

`bun:sqlite` is SQLite **3.53**; the app runs libSQL's **3.45.1**. A statement 3.53
accepts can be rejected in production, and generated columns are exactly that trap.

Before committing a migration, run each raw statement through the real client. Put the
probe in the scratch dir, not the repo:

```ts
// ~/.cache/toon-verify/ddl-probe.ts   (run with: bun run ddl-probe.ts)
import { createClient } from "@libsql/client";
const db = createClient({ url: "file:./ddl-probe.db" });
await db.execute("select sqlite_version()").then((r) => console.log(r.rows));

// The case SQLite actually rejects is ADD NOT NULL on a POPULATED table, so populate first.
await db.execute(`create table if not exists tags (
  id text primary key, group_id text not null, name text not null,
  color text, created_at integer not null)`);
await db.execute(`insert into tags (id, group_id, name, created_at)
  values ('t1','g1','Hauptspeise',1)`);
await db.execute(`alter table tags add kind text default 'free' not null`);   // must succeed
await db.execute(`create index tags_group_kind_idx on tags (group_id, kind)`);
console.log((await db.execute("select id, kind from tags")).rows);            // kind = 'free'
```

Repeat for `0007` and `0008`. Two specific things to confirm rather than assume:

- **`ALTER TABLE tags ADD kind text DEFAULT 'free' NOT NULL` against a table with rows.**
  Without the default this is the error the constraint exists for; with it, it must
  succeed *and* backfill every existing row to `'free'`.
- **No `DESC` in an index declaration.** SPEC §4.3 writes `index (list_id, bought_at desc)`.
  Declare it **ascending** — `index("shopping_bought_items_list_bought_idx").on(table.listId, table.boughtAt)` —
  because SQLite walks an index backwards for `ORDER BY bought_at DESC` on a composite
  whose leading column is an equality (`list_id = ?`), so the plan is identical, and a
  `.desc()` in the index declaration is a drizzle-version-dependent API this repo does not
  otherwise use. If area 03 measures a `USE TEMP B-TREE` in the query plan, that is the
  moment to revisit — with an `EXPLAIN QUERY PLAN` in the commit message, the way the
  `title_fold` index was justified.

### 4.6 Applying them

```bash
rm -f data/redesign.db*
DATABASE_URL="file:./data/redesign.db" bun run db:migrate
DATABASE_URL="file:./data/redesign.db" bun run seed
```

`bun run db:migrate` must be clean on a **fresh** DB (all eight migrations from scratch)
**and** on a copy of a pre-redesign DB (three `ALTER`s onto populated tables). Test both;
only the second exercises constraint (a).

---

## 5 — Test strategy

### 5.1 API tests — `apps/api/test/`, never `tests/`

`apps/api/tsconfig.json` includes `test/**` only. A directory named `tests/` is invisible
to `bun run typecheck` and its type errors ship.

| File | What it must cover |
| --- | --- |
| **`apps/api/test/plan.test.ts`** (new) | Entry CRUD; `403` for a non-member (`requireGroupRole("member")`); `requireVerifiedEmail` answers `403 email_unverified` on non-GET and **does not** gate GET; the `planned_on` calendar boundary (§8.2 — an entry created at 23:30 Europe/Berlin is on the same day it was created, not the day before); cascade from `groups` **and** from `recipes` (deleting a recipe removes its plan entries, so the week strip cannot render a dangling title); the `{ items, total, limit, offset }` envelope; a week range query returning exactly the 7 requested days. |
| **`apps/api/test/cooked.test.ts`** (new) | `POST …/recipes/:recipeId/cooked` appends one `recipe_cook_log` row and updates `recipes.last_cooked_at`; it stamps today's `meal_plan_entries.cooked_at` when the recipe is on today's plan and leaves other entries alone; it does **not** stamp anything when the recipe is not planned; `lastCookedAt` appears on `RecipeResponse`; `?sort=lastCooked` orders cooked-most-recently first and puts **never-cooked recipes last, not first** (a NULL sorts first in SQLite by default — this is the assertion that catches it); two cooks of the same recipe leave one recipe row and two log rows. |
| **`apps/api/test/shopping-bought.test.ts`** (new) | The three-way D4 assertion, which is the point of the file: one check-off **deletes** the `shopping_list_items` row, **bumps** the `shopping_list_catalog` entry, and **appends** a `shopping_bought_items` row — all three, in one request. Then: a replayed `mutationId` appends **exactly one** log row (without the ledger covering the append, the history doubles while the list looks right); re-adding a bought item **merges** normally, proving the `(list_id, merge_key)` unique index stayed total; `Clear bought` moves `shopping_lists.bought_cleared_at` and **deletes no log rows** (the history panel still shows the cleared day); the group history endpoint's day grouping, buyer names and `limit`/`offset` envelope; the retention prune on write against the documented TTL. |
| **`apps/api/test/group-summary.test.ts`** (new) | `GET /api/groups/:groupId/summary` returns the recipe count and the open-item count summed across the group's lists; membership is required; the counts exclude another group's rows. Assert the numbers, not the timing — but do assert that the handler does not fetch item **rows** (e.g. by seeding 200 items and asserting the response body carries no item payload), which is what SPEC §4.7's "do not compute them per render from a full list fetch" is actually about. |
| **`apps/api/test/smoke.test.ts`** (extend) | **Route-order pins.** `GET …/shopping-lists/bought` must resolve to the history handler and **not** be parsed as a list id; and — the assertion that makes the test meaningful — a real list id must **still** resolve through `…/shopping-lists/:listId`. Only asserting the first half passes by accident whenever hono happens to rank statics first, which is exactly how this class of bug stays invisible. Same pair for `/plan`. |
| **`apps/api/test/verified-email-gate.test.ts`** (extend) | One row per new non-GET route: `POST …/plan/entries`, `PATCH`/`DELETE …/plan/entries/:id`, `POST …/recipes/:recipeId/cooked`, `DELETE …/shopping-lists/:listId/bought`, `POST`/`DELETE …/shopping-lists/:listId/catalog/:entryId/hidden`. And one row proving `GET …/plan` and `GET …/shopping-lists/bought` are **not** gated. This file sets `setVerifiedEmailRequired()` and **must** keep handing it back in `afterAll(() => setVerifiedEmailRequired(null))` — `bun test` runs every file in one process, and a leaked `true` 403s every write in every later file. |
| **`apps/api/test/recipes.test.ts`** (extend) | `describe("tags.kind")`: a tag created without `kind` defaults to `'free'`; the name-upsert path from `CreateRecipeRequest.tags` creates `'free'` tags; `kind` round-trips on `TagResponse`; whatever one-course-per-recipe invariant area 04 chooses is asserted here (and if it chooses none, assert that two course tags are *accepted*, so the behaviour is pinned either way). |
| **`apps/api/test/shopping.test.ts`** (extend) | `describe("hidden suggestions")`: hiding excludes an entry from `ShoppingListDetailResponse.catalog` while **keeping its `use_count`**; unhiding restores it; a hidden entry still merges normally if the name is re-added by hand. Extending the existing file rather than adding one keeps all catalog behaviour in one place. |

### 5.2 Pure logic in `packages/shared`, with unit tests

Tests live in **`packages/shared/test/`** (not co-located — that is the existing layout).
Every function takes its clock and timezone as **explicit parameters**; none reads
`Date.now()` or the ambient zone, which is what makes the tests deterministic and removes
any temptation to stub `Date`.

| New/extended module | Functions | Test file |
| --- | --- | --- |
| **`packages/shared/src/plan.ts`** (new) | `weekStart(date)` → the week's Monday; `weekDays(weekStart)` → the 7 `YYYY-MM-DD` keys; `planDateKey(date, timeZone)`; `parsePlanDate(key)`; `isSameDay(key, date, timeZone)` | **`packages/shared/test/plan.test.ts`** (new) |
| **`packages/shared/src/shopping.ts`** (extend) | `sortSuggestionsAlphabetically(entries)` — **selection is the server's job (top 8 by `use_count`), ordering is this function's**; folds with `foldText()` then breaks ties with `localeCompare(a, b, "de")` | `packages/shared/test/shopping.test.ts` (extend) |
| **`packages/shared/src/shopping.ts`** (extend) | `boughtProgress(toBuy, boughtToday)` → `{ percent, denominator }` | `packages/shared/test/shopping.test.ts` (extend) |
| **`packages/shared/src/shopping.ts`** (extend) | `groupBoughtByDay(rows, timeZone)` → day buckets, each with a date **key** (data), a count and the distinct buyer names | `packages/shared/test/shopping.test.ts` (extend) |

Cases that must be in those tests, because each is a bug this codebase would otherwise
ship:

- **`plan.test.ts` — Monday as the week start.** German convention; `Date.getDay()` returns
  0 for Sunday, so the naive `date - getDay()` is off by one for six days out of seven.
- **`plan.test.ts` — a DST transition week.** Europe/Berlin, the last Sunday in March and
  the last Sunday in October. A week computed by adding `86_400_000` ms seven times lands
  an hour early or late and a `planDateKey` derived from it flips to the previous day.
  This is SPEC §4.1's "or 'Thursday' drifts", and it is the reason the date column is text
  (§8.2).
- **`plan.test.ts` — a week spanning a year boundary** (Mon 29 Dec → Sun 4 Jan) and a leap
  day (29 Feb).
- **`shopping.test.ts` — `Ä` sorts with `A`, not after `Z`.** SPEC §4.6's stated risk.
  `foldText()` first, per `@toon/shared`'s `FOLD_PAIRS`; **never a SQL fold** — `foldSql()`
  overflows the parser past 31 nested `replace()` calls and genuinely disagrees with
  `foldText()` for an uppercase accent. Also cover `ß`/`ss`, mixed case, and stability for
  two names with the same fold.
- **`shopping.test.ts` — `boughtProgress` denominator.** SPEC open item 5 asks for
  confirmation; **the artboard confirms itself**: `10 to buy · 4 bought today` drawn at
  `29%` is `4/14 = 28.57%`. So the denominator is `toBuy + boughtToday`, **not** the list's
  lifetime total. Test `(10, 4) → 29` (rounded) and `(0, 0) → 0` with no division by zero.
- **`shopping.test.ts` — `groupBoughtByDay` across local midnight.** Two rows 20 minutes
  apart either side of local midnight must land in **different** buckets. And the i18n
  split: the bucket's **key is a date** (data), while `Today` / `Sat 30 Aug` is rendered by
  the caller through the catalog and `formatDate` (interface). The function must not return
  a label.

### 5.3 Web co-located tests — `apps/web/tsconfig.test.json`

`apps/web` is three TS projects. `tsconfig.json` (the browser app) **excludes**
`src/**/*.test.ts`; `tsconfig.test.json` adds `bun` and `exclude: []`. A new co-located
test file needs no edit anywhere — `scripts/typecheck.ts` already lists all three
projects, and it only grows a line if a **fourth project** appears (it should not).

| File | What |
| --- | --- |
| **`apps/web/src/lib/persist.test.ts`** (extend) | One assertion per new key, both directions: `"plan"`, `"summary"`, `"bought-summary"` persist; `"bought-history"` and `"plan-shopping"` do **not**. This test *is* the enforcement of §2.2 — without a negative line per excluded key, a later refactor that widens `PERSISTED_GROUP_SEGMENTS` silently persists a paginated archive and nothing notices. Also assert `PERSIST_BUSTER === "v3"` so the §2.3 bump cannot be lost in a merge. |
| **`apps/web/src/features/shopping/lib/offline.test.ts`** (new) | The first test for that module, and worth it — the offline check-off is the highest-consequence path in the app. Pure cache surgery against a hand-built `ShoppingListDetailResponse`, no network, no `QueryClient` needed beyond a throwaway one from `createQueryClient()`: `removeFromCache(current, id, { asBought: true })` removes the item, bumps the catalog entry, **and** pushes a `bought` row whose id satisfies `isPendingItemId`; with `{ asBought: false }` it removes the item and touches neither. Plus `mergeIntoCache` still merging `200 g + 200 g` into `400 g` (the algebra the optimistic update shares with the server), so an area-03 edit to the function cannot break it unnoticed. |

**No `apps/web/src/features/plan/lib/week.test.ts`.** Recommended against: every date
computation belongs in `packages/shared/src/plan.ts` per SPEC §5, so there is nothing
left on the web side to test. A web-side copy of the week maths is the beginning of two
definitions that disagree.

### 5.4 Seams, not `mock.module`

`mock.module` leaks across test files and bun never restores it, and the execution order
is **filesystem** order, not alphabetical — so the resulting failure appears on some
machines and not others. That is exactly how `ocr-segment.test.ts` broke
`pdf-rasterize.test.ts` in CI while passing locally.

**This area needs no new module stub.** Everything time-dependent takes `now` and
`timeZone` as parameters (§5.2), so no test needs to freeze a clock. Two rules for the
feature areas:

1. **If a handler must read the clock**, add an explicit seam next to it —
   `setPlanClock(fn)` in `apps/api/src/services/plan/`, on the pattern of `setMailer`,
   `setOcrEngine`, `setPdfRasterizer`, `setVerifiedEmailRequired` — and the test file that
   sets it **hands it back in `afterAll(() => setPlanClock(null))`**. A seam that cannot
   leak silently is the whole point; a `mock.module("node:...")` is not.
2. **Prefer passing the timestamp through the request.** A plan entry's `plannedOn` comes
   from the client anyway, so most of `plan.test.ts` needs no clock at all. Only the
   "stamps today's plan entry" branch of `cooked.test.ts` does, and that is the one place
   a seam earns itself.

Also unchanged: `bun test` forces `DATABASE_URL=file::memory:` (`NODE_ENV=test` in
`env.ts`), overridable with `TEST_DATABASE_URL`; a test needing a **real** transaction uses
a temp file DB, because `withTransaction()` degrades to sequential statements on memory
DBs; and `warmThumbnail()` is a no-op under `bun test` on purpose, so the new planner and
plan-panel thumbnails must go through the same `toRecipe` serialisation and must not
trigger a write into the shared `data/uploads`.

---

## 6 — Headless verification runbook

`CLAUDE.md` is emphatic and it is right: **both** of the documented phone-layout bugs
measured wrong on the first attempt, and only the screenshots showed it. Reading Tailwind
classes is not verification. This redesign rewrites every screen at both viewports, so the
runbook below is a loop over a screen list, not a spot check.

### 6.1 Install Playwright OUTSIDE the repo

```bash
mkdir -p ~/.cache/toon-verify && cd ~/.cache/toon-verify
bun init -y
bun add -d playwright
bunx playwright install chromium
```

It must never become a dependency of this repo: ~115 MB of Chromium, and under Bun 1.4's
isolated linker a stray dependency rewrites the root plus two workspace symlink trees.
The driver script lives here too — `~/.cache/toon-verify/verify.ts` — **not** in
`scripts/`. There is deliberately no browser tooling in this repo.

### 6.2 Drive the dev servers, and log in from the page context

```bash
cd /home/erics/software/toon-recipe
rm -f data/verify.db*
DATABASE_URL="file:./data/verify.db" bun run db:migrate
DATABASE_URL="file:./data/verify.db" bun run seed
DATABASE_URL="file:./data/verify.db" bun run dev        # API :3001 + web :5173
```

`PUBLIC_API_URL` defaults to `http://localhost:3001`, so the page at `localhost:5173` talks
cross-origin but **same-site** — the `SameSite=Lax` session cookie is still sent, which is
why a `fetch` with `credentials: "include"` from the page context is all the login needs:

```ts
await page.goto("http://localhost:5173/login");
await page.evaluate(async () => {
  const r = await fetch("http://localhost:3001/api/auth/login", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "demo@toon.local", password: "demo1234" }),
  });
  if (!r.ok) throw new Error(`login ${r.status}`);
});
await page.goto("http://localhost:5173/");
```

Set the theme **before** the first `goto`, because `lib/theme.ts` reads localStorage on
boot and `prefers-color-scheme` alone will not override an explicit preference:

```ts
await context.addInitScript(() => {
  try { localStorage.setItem("toon.theme", "light"); } catch { /* private mode */ }
});
```

The key is `toon.theme` (`storageKeys.theme` in `apps/web/src/lib/storage.ts`). Remove the
item — do not store `"system"` — to test the system-following state, exactly as the locale
preference works.

### 6.3 The three assertions

**(1) Horizontal overflow — on every screen, at 390.**

```ts
const overflow = await page.evaluate(() => {
  const d = document.documentElement;
  return d.scrollWidth - d.clientWidth;      // report the delta, not a boolean
});
if (overflow !== 0) throw new Error(`${label}: page is ${overflow}px too wide`);
```

Report the delta, not `true`/`false` — the number is what tells you whether it is a 1rem
`-mx-4` bleed or a 190px fieldset.

**(2) `<main>`'s padding, and that no page root re-applies it.**

```ts
const pad = await page.evaluate(() => {
  const main = document.querySelector("main")!;
  const root = main.firstElementChild as HTMLElement;
  const m = getComputedStyle(main), r = getComputedStyle(root);
  return { main: [m.paddingLeft, m.paddingRight, m.paddingTop, m.paddingBottom],
           rootPadX: [r.paddingLeft, r.paddingRight], rootMaxWidth: r.maxWidth };
});
```

Expect `16px` left/right at 390 (`.px-gutter` = `max(var(--gutter,1rem), env(...))`, and a
portrait phone reports an inset of 0), and `32px` from `lg` via
`lg:[--gutter:2rem]`. Expect `rootPadX` to be `["0px","0px"]` and `rootMaxWidth` to be
`"none"` — `AppShell`'s `<main>` already applies
`mx-auto max-w-5xl px-gutter pt-4 pb-tabbar`, and a page root that re-applies any of them
costs a 390px phone 32px of the 390 it has and doubles the bottom padding. Page roots are
plain `flex flex-col gap-4`. Also assert that **no element** carries both `px-4`/`px-2`
and `px-safe`, since `.px-safe` is a flat override emitted after Tailwind and wins:

```ts
const bad = await page.evaluate(() =>
  [...document.querySelectorAll<HTMLElement>("[class*='px-safe']")]
    .filter((el) => /\bpx-\d/.test(el.className)).map((el) => el.className));
```

**(3) The gap between a sticky bottom bar and the fixed tab bar.**

```ts
const gap = await page.evaluate(() => {
  const bar = document.querySelector<HTMLElement>('[data-testid="list-add-bar"]');
  const nav = document.querySelector<HTMLElement>('[data-testid="tabbar"]');
  if (!bar || !nav) return { error: "selector missed" };
  const b = bar.getBoundingClientRect(), n = nav.getBoundingClientRect();
  // A display:none element reports an all-zero rect that reads as a plausible number.
  if (n.height === 0 || b.height === 0) return { error: "zero-height rect" };
  return { gap: n.top - b.bottom };
});
```

Expect `gap` within ±1px of 0. **Do NOT match the tab bar by `aria-label`** — `SideNav`
carries the same one and, being `display:none` on a phone, returns an all-zero rect, so
`nav.top - bar.bottom` comes back as a large negative number that looks like a real
measurement of a real bar. The `height === 0` guard is the cheap check that would have
caught that, and it stays in the script permanently.

**Recommendation: add stable `data-testid` hooks** — `tabbar` on `BottomTabBar`, `sidenav`
on `SideNav`, `app-main` on `AppShell`'s `<main>`, and one per new sticky bar
(`list-add-bar`, `recipe-save-bar`, `import-review-footer`, `detail-action-bar`). One
attribute each, and it turns the runbook from selector archaeology into something the next
person can re-run. Also grep `bottom-0` before adding any bar: a bottom action bar uses
`.bottom-tabbar`, never `bottom-0`, or `BottomTabBar` (`fixed inset-x-0 bottom-0 z-30`,
rendered *after* `<main>`) paints over it and it cannot be tapped at all.

### 6.4 Redesign-specific assertions

Each of these corresponds to a non-negotiable the redesign is newly at risk of breaking:

```ts
// "Titles never truncate" (SPEC §1 point 3, §5). `block` beats line-clamp-N silently.
const t = getComputedStyle(titleEl);
assert(t.webkitLineClamp === "none" && t.display !== "-webkit-box");
assert(titleEl.scrollHeight <= titleEl.clientHeight + 1);

// A <fieldset> carries min-inline-size: min-content and ignores min-w-0 unless told.
[...document.querySelectorAll("fieldset")].every((fs) =>
  getComputedStyle(fs).minInlineSize === "0px");

// The fonts actually resolved, and NOTHING went to Google.
await document.fonts.ready;
assert(document.fonts.check('500 24px Newsreader') && document.fonts.check('400 16px Figtree'));
```

```ts
// Hard failure on any external font request — SPEC §2 forbids a fonts.googleapis.com link.
page.on("request", (r) => {
  const u = r.url();
  if (u.includes("fonts.googleapis.com") || u.includes("fonts.gstatic.com")) {
    throw new Error(`external font request: ${u}`);
  }
});
```

And, because area 01 touches the tokens: on `/shopping/cards`, in **both** themes, assert
the barcode is still black on white — `BarcodeImage` hard-codes `#000`/`#fff` and the
surface behind it is `bg-white`, the one place in the app that ignores the colour tokens,
because a dark-mode barcode is unreadable to half the hand scanners in use.

### 6.5 Viewports and screens

Two device profiles. **`isMobile: true` matters** — a phone is not just a narrow desktop;
it changes the visual viewport, which is where the sticky-bar bug lived.

```ts
const phone   = { viewport: { width: 390,  height: 844 }, deviceScaleFactor: 2,
                  isMobile: true,  hasTouch: true };
const desktop = { viewport: { width: 1440, height: 940 }, deviceScaleFactor: 1,
                  isMobile: false, hasTouch: false };
const lgEdge  = { viewport: { width: 1024, height: 800 }, deviceScaleFactor: 1,
                  isMobile: false, hasTouch: false };
```

**390 — the four mobile artboards plus `/plan` (screenshot + all assertions):**

| Screen | Artboard |
| --- | --- |
| `/` | `1e` Library mobile |
| `/recipes/<id>` | `1f` Detail mobile |
| `/shopping` | `1g` Shopping overview mobile |
| `/shopping/<listId>` | `1h` Shopping list mobile |
| `/plan` | **none — SPEC §4.1. Its screenshot goes in the PR as the reference that does not exist.** |

**390 — every remaining screen, overflow + padding assertions only** (D6: the app is never
half-redesigned): `/import`, `/import/<draftId>`, `/recipes/new`, `/recipes/<id>/edit`,
`/collections`, `/collections/<id>`, `/tags`, `/groups`, `/groups/<id>`, `/settings`,
`/shopping/cards`, `/shopping/history`.

**1440 — the three desktop artboards plus the reconstructed library:**

| Screen | Artboard |
| --- | --- |
| `/recipes/<id>` | `1a` — captioned "Recipe library" but its content **is** the detail screen |
| `/shopping` | `1c` Shopping overview desktop |
| `/shopping/<listId>` | `1d` Shopping list desktop |
| `/` | **RECONSTRUCTED — no artboard exists.** Its screenshot is the review artifact for SPEC §1's four-source reconstruction. |
| `/plan` | reconstructed too; capture it. |

**1024 — one pass over `/` and `/shopping/<listId>`.** That is the `lg` boundary where the
sidebar appears and `.bottom-tabbar` resets to `bottom: 0` — the exact width at which the
two bottom-bar utilities swap behaviour, and therefore the width nobody checks.

**Both themes, at both viewports**, for the artboard screens. SPEC §2 claims "light mode
keeps working for free" because components reference semantic tokens and never `dark:`
classes. That is a claim, not a measurement, and one light-mode pass is what turns it into
one.

Screenshots go to `~/.cache/toon-verify/shots/<width>-<theme>-<screen>.png` — outside the
repo, so nothing is committed.

### 6.6 One production pass, for the service worker

The dev server cannot verify any of §3: `devOptions.enabled: false` and
`registerServiceWorker()` bails unless `import.meta.env.PROD`.

```bash
bun run build
bun --filter @toon/web preview        # :4173
```

Then, against `http://localhost:4173`, assert the woff2 files are in the precache:

```ts
const cached = await page.evaluate(async () => {
  const names = await caches.keys();
  const out: string[] = [];
  for (const n of names) for (const req of await (await caches.open(n)).keys()) out.push(req.url);
  return out.filter((u) => u.endsWith(".woff2"));
});
```

Do **not** re-test the `sw.js` / `index.html` no-store headers here —
`apps/api/test/static-web.test.ts` already owns that (it is `middleware/staticWeb.ts`'s
contract, and a browser assertion would duplicate it less reliably). Nothing in this
redesign touches the Dockerfile, `docker-compose.yml` or `staticWeb.ts`, so the
build-the-image gate is **not** triggered. One caveat in §8.6.

---

## 7 — Docs

### 7.1 `docs/API.md` — the endpoint contract

- **New section `## Meal plan — apps/api/src/routes/plan.ts`**, mounted at
  `/api/groups/:groupId/plan`, with the endpoint table (`GET` week, `POST` entry, `PATCH`
  entry, `DELETE` entry), auth column `group:member`, and a Notes bullet stating the
  `planned_on` storage decision and its timezone boundary (§8.2) — SPEC §4.1 explicitly
  requires that be written down.
- **Recipes section**: add the `POST …/recipes/:recipeId/cooked` row; note
  `RecipeSortSchema` gaining `lastCooked` and that never-cooked rows sort **last**; note
  `RecipeResponse.lastCookedAt` as a read-only derived field written from
  `recipe_cook_log`; note `kind` on the tags a recipe carries.
- **Tags** (in the same router's table): `kind` on `TagResponse`, `CreateTagRequest` and
  `UpdateTagRequest`, defaulting to `'free'`. Plus the CONTENT note: the course
  vocabulary (`Hauptspeise`, `Beilage`, `Dessert`, `Suppe`, `Auflauf`, …) is German-only
  recipe vocabulary and never routed through `t()` — only the rail's heading is interface.
- **Shopping lists section**: add `GET …/shopping-lists/bought`, and state that it is
  registered **before** `…/shopping-lists/:listId` for the same reason `/invites/accept`
  precedes `/:groupId`; add `DELETE …/shopping-lists/:listId/bought`; add
  `POST`/`DELETE …/shopping-lists/:listId/catalog/:entryId/hidden`; note the new `bought`
  array and the two counts on `ShoppingListDetailResponse`; and **rewrite the "Checking
  off is a DELETE, not a flag" bullet** — the DELETE + catalog bump is retained *and* the
  check-off now appends `shopping_bought_items` in the same handler, which is what draws
  "Bought today" and the history; there is still no flag on the item row, because the
  merge index must stay total and the persisted offline outbox entry must keep its
  meaning.
- **Groups section**: `GET /api/groups/:groupId/summary`.
- **"Unconfirmed accounts are read-only"**: add the new non-GET paths to the 403 list, and
  add the new GETs to the "everything else is unchanged" list.
- **Tables section**: add `meal_plan_entries`, `recipe_cook_log`, `shopping_bought_items`
  to the table enumeration; add the new indexes; add `recipes.last_cooked_at`,
  `tags.kind`, `shopping_lists.bought_cleared_at`,
  `shopping_list_catalog.hidden_at`; state `shopping_bought_items`'s documented TTL and
  that it is pruned on write like `shopping_mutations`.
- **Health section: no change, and say so.** The redesign adds **no** feature flag.
  `features` gains nothing; nobody should add `features.planner`. The planner is not
  optional, it has no native binary and no env switch — it is either deployed or the whole
  build is old, and the router's 404 is the honest answer to the latter.

### 7.2 `README.md`

- **Known gaps → Shopping lists.** Three edits:
  - **The `useCount` bullet is now factually wrong.** It ends "Dismiss it with the × on
    the chip", and the per-chip `×` is **gone** (SPEC §4.6 — its removal is the stated fix
    for chip clutter). Rewrite to name the long-press/right-click hide and `hidden_at`,
    and keep the honest "there is no decay" half.
  - New bullet: `Clear bought` clears the **section**, not the history — it moves a
    per-list watermark, and the bought log is what the history panel reads.
  - New bullet: `shopping_bought_items` grows and is pruned on write against a documented
    TTL; a list nobody touches keeps its rows until somebody does.
- **Known gaps → new "Planner" group**: planner writes are online-only and disabled
  offline (with the same reasoning as list create/rename/delete); `POST …/cooked` is
  online-only too and reports its failure; `/plan` had no artboard and is an
  extrapolation.
- **Known gaps → Web**: the last bullet is now wrong — it says "four tabs, `/search?q=…`
  redirecting to `/`… Profil → 'Gruppen verwalten'". Four tabs is still true but the
  *set* changed (Rezepte · Plan · Einkauf · Profil) and Import moved to the `+` sheet in
  the library header. Rewrite, and keep the `/search` sentence, which is still true and
  still load-bearing.
- **Known gaps → Web**: "Only recipes/tags/collections/shopping lists are persisted" →
  add the planner, the group summary and the bought summary, and say the bought
  **archive** is not.
- **Known gaps → new bullet**: the desktop recipe library artboard was never drawn and is
  reconstructed from four sources — link `docs/redesign/SPEC.md` §1.
- **Scripts section, the "Current status of the gates" block.** Every number in it is
  stale by construction: the test count, and `PWA precache 115 entries (1359 KiB)` grows
  by the woff2 files. **Re-measure, do not guess** — and note that `bun test`'s count
  disagrees between `README.md` (934) and `CLAUDE.md` (1058) *today*, so both have to be
  set from one real run.
- **"Smoke test against a real server"**: add curl lines after the existing ones —
  create a plan entry, `GET` the week, `POST …/cooked` and see `lastCookedAt` change, and
  `GET …/shopping-lists/bought` after a check-off. Keep the cards block; it is the model
  for how these read.
- **"Locked product decisions" (README:11)** mirrors `CLAUDE.md`'s decisions and needs the
  same two edits: decision 7's second half (§7.4 entry 1) and the nav change (entry 2).

### 7.3 `docs/i18n.md` — yes, two lines are needed

- **§9 (Namespaces).** The redesign's copy goes into **existing** namespaces:
  planner copy under `recipes` with a `recipes.plan.*` prefix, bought/history/chips under
  `shopping`, shell and nav under `ui`. **Recommendation: do NOT add a ninth `plan`
  namespace.** Reason: a namespace costs a registry edit plus a file pair, and the
  planner's ~25 strings live on recipe screens; the prefix already keeps the merge
  order-independent. Add a short note to §9 in the same style as the existing `[R]`
  paragraph about `cards`, recording that decision and the prefix — otherwise the next
  person adds the ninth namespace by default.
- **§11 (German parity).** Add a paragraph naming the redesign as a large new source of
  false-positive class 1: essentially every new key has no base-tree counterpart, so
  check 1 will list all of them. **Recommendation: do NOT bulk-add them to `NEW_GERMAN`
  in `scripts/i18n-check.ts`.** That set is designed as one entry per key with a reason;
  a hundred entries turns it into a mute button and destroys the check's only real job,
  which is catching a *reworded* existing string. Document the read procedure instead
  (§8.7).
- **One real script edit, not a doc edit**, but it belongs to this list because §11
  describes it: wherever area 04 puts the course vocabulary — recommend
  `packages/shared/src/courses.ts`, next to `units.ts` and `ingredients.ts` — that path
  **must** be added to `ALLOW_LIST` in `scripts/i18n-check.ts`, or check 2 floods with
  German course names and class 3 stops being a closed list that a reviewer can eyeball.

### 7.4 `CLAUDE.md` entries the redesign invalidates — catalogue only

Not written here (D3: a later agent rewrites them, rationale included). Thirteen, most
consequential first.

| # | Section / entry | What it currently claims | What the replacement must say |
| --- | --- | --- | --- |
| 1 | **Locked decision 7** (shopping lists) | "…have no `checked` column"; "Checking an item off DELETES the row and bumps a `shopping_list_catalog` entry … the Bring behaviour, chosen deliberately over a flag." | The behaviour is **retained** and gains a second half: the check-off also appends a `shopping_bought_items` row (D4), which is what draws "Bought today" and the per-list history. Still no flag on the item row — because the `(list_id, merge_key)` unique index must stay total so a re-added bought item merges normally, and because the persisted offline outbox entry must keep meaning "delete". Add `bought_cleared_at` (the `Clear bought` watermark) and `hidden_at` (chip hiding) and the log's TTL. SPEC §4.3 already drafts this. |
| 2 | **"Navigation (four tabs, and what is deliberately NOT one)"** — the whole section | Tabs are `Rezepte · Einkauf · Importieren · Profil`; `SECONDARY_NAV_ITEMS` = Gruppen/Sammlungen/Tags; "everything in `SECONDARY_NAV_ITEMS` MUST also be reachable from a tab screen". | Tabs are `Rezepte · Plan · Einkauf · Profil`. **Import is in neither list** — it is reached from the `+` button in the library header, which opens a sheet offering "Neues Rezept" and "Importieren", and that sheet is now the *only* route to import on a phone, exactly as `CardsCard` is the only route to the wallet. The reachability rule therefore needs a third mechanism named next to the two it already names. `/import` remains a route (PWA shortcut + deep links). Keep "Search is not a destination" verbatim. |
| 3 | **Gotcha: "THE SHOPPING LIST IS THE ONE THING EDITABLE OFFLINE, and four pieces make that safe"** | Enumerates the four pieces. | All four are **unchanged** — that is D4's point and worth stating explicitly so nobody "improves" the outbox. Add: the check-off's log append happens server-side in the same handler and is therefore covered by the same `mutationId`, and the client's `removeFromCache(..., { asBought: true })` must push an optimistic `bought` row or an offline check-off looks like data loss. |
| 4 | **Gotcha: "`useCanMutate()` must NOT be used on the shopping screens"** | The shopping/cards opposition. | Add the planner as a third case: `/plan` **does** use `useCanMutate()` (planner writes are online-only), and the recipe detail header now needs **two different gates on one screen** — `useEmailVerificationBlock()` for "Add to shopping" (queues offline) and `useCanMutate()` for "Cooked" (online-only). |
| 5 | **Gotcha: "The service worker is generated by `vite-plugin-pwa`"** + the `globPatterns` wasm paragraph in `vite.config.ts` | "`wasm` IS DELIBERATELY ABSENT … Adding 'wasm' here is a real decision, not a typo fix." | Keep the wasm rationale verbatim. Add `woff2` and why (self-hosted display serif + sans; a webfont that 404s offline reflows every screen and the shopping list renders at a till), and add the planner's new `NetworkOnly` rule to the enumeration of what must stay out of `runtimeCaching`. |
| 6 | **Gotcha: "Recipe search reads PRE-FOLDED columns"** — the `?sort=title` sub-bullet | "`?sort=title` orders by `title_fold` so `recipes_group_title_fold_idx` can supply the order; ordering by the equivalent expression forced `USE TEMP B-TREE`… (6.7 ms → 1.1 ms)." | Add the same reasoning for `?sort=lastCooked`: it needs `recipes_group_last_cooked_idx` on `(group_id, last_cooked_at)` for exactly the same reason, and `last_cooked_at` is denormalised rather than joined against a grouped `max()` because the `total` half of the list envelope is a `count(*)` that cannot stop early. Note that NULL sorts first in SQLite, so never-cooked rows need explicit handling. |
| 7 | **Gotcha: "`FOLD_PAIRS` CANNOT BE COMPLETED"** | "…do not write a fold in SQL for anything new." | Unchanged, and now has a concrete example worth naming: the frequently-bought chips' alphabetical order folds in **JS** with `foldText()`, never in SQL — selection is `use_count` in SQL, ordering is `foldText()` in the shared package. |
| 8 | **Gotcha: "A LIST never renders `imageUrl`"** | Enumerates the list-image sites. | Add the new ones: the library's 84px editorial-row squares, the planner day cards, the "From this week's plan" thumbs, the "Recently cooked" carousel and the list rail's "Recipes on this list" rows are **all** `thumbnailUrl()`. Detail screens keep `imageUrl`. |
| 9 | **Gotcha: "Recipe list/search filters live in the URL"** | `RECIPE_FILTER_PARAMS` and the `/search` mirroring rule. | Keep the `/search` rule verbatim. Add that the course rail writes into the existing `tags` param (no new param), that `sort` gains the value `lastCooked` without an array edit, and that `/plan` and `/shopping/history` have their own param lists (`PLAN_PARAMS`, `SHOPPING_HISTORY_PARAMS`) which nothing redirects into. |
| 10 | **Locked decision 1** ("Groups own the content") | "Recipes, tags, collections and import drafts belong to a `group`, not a user." | Enumeration is now incomplete: add `meal_plan_entries`, `recipe_cook_log` and `shopping_bought_items`. Decision 11 (cards belong to the USER) survives verbatim and is still the only exception. |
| 11 | **"File layout (where things live)"** | The two trees. | Add `apps/api/src/routes/plan.ts`, `apps/api/src/services/plan/`, `apps/web/src/features/plan/`, `apps/web/src/features/shopping/ShoppingHistoryPage.tsx`, `packages/shared/src/plan.ts` and (if area 04 puts it there) `packages/shared/src/courses.ts`. Also note `apps/web/public/fonts/`. |
| 12 | **"Verification gates"** | ``bun test             # 1058 tests`` | A number that changes; re-measure from one real run, and reconcile with `README.md`, which says 934 today. |
| 13 | **Gotcha: "A `sticky bottom-*` bar can only be pushed UP"** and **"A bottom action bar needs `bottom-tabbar`"** | Both enumerate the existing bars. | Behaviour unchanged; the enumerations grow. The design adds two new instances of the trap (SPEC §5): the detail screen's `Cook mode` + `Cooked` bar (`1f`) and the list's chips + add bar (`1h`). Name them so the next grep for `bottom-0` covers them. |

Also worth a line, though not an invalidation: nothing in this redesign touches the
Dockerfile, `docker-compose.yml`, the OCR/PDF flags, mail, `/uploads` signing, or the
barcode encoders. Those entries stay exactly as they are.

---

## 8 — Gates, and how each one fails on the first attempt

```bash
bun install
bun run typecheck
bun test
bun run build
bun run i18n:check
```

Plus, because this touches persistence: `bun run db:migrate` + `bun run seed` against a
fresh `file:` DB, then the curl walkthrough in `README.md`.

### 8.1 `bun install`

Should report **no changes**. If it does not, somebody added a dependency, and that is a
review question rather than a build one. Two specific temptations to refuse:

- **Playwright** — installed in `~/.cache/toon-verify`, never in a workspace (§6.1).
- **`@fontsource/*`** — SPEC §2 says self-hosted files under `apps/web/public/fonts/`. A
  `@fontsource` dependency puts the woff2 in `node_modules`, where the `globPatterns` glob
  over `dist/` still happens to work — and you lose the stable `/fonts/...` preload path
  and all control over subsetting (§3.1 constraints 1 and 2).

Under Bun 1.4's isolated linker any dependency change rewrites the root plus two workspace
symlink trees, so a stray one is not a small diff.

### 8.2 `bun run typecheck`

Five failures you should **expect**, each of them the type system doing its job:

**(a) `NavItem["to"]`** is a closed union in `nav-items.ts` and does not contain `"/plan"`.
Widen the union; do not cast.

**(b) Every new `de` catalog key is a compile error in its `en` twin.** `en` is annotated
`LocaleCatalog<typeof theDeCatalog>`, a mapped type over the `de` keys, so a missing key,
an extra key, or a plural-vs-string mismatch is a **compile** error, not a runtime
warning. This is the progress meter for the copy work.

**(c) `RecipeSortSchema` widening breaks every exhaustive `switch` over `RecipeSort`.**
Expect it in the API's order-by mapping (`apps/api/src/services/recipes/`) and on the web
side in `features/recipes/lib/url-filters.ts` and the sort control. **The label must be a
`*_LABEL_KEYS` map of catalog keys, not a frozen label map** — `lib/format.ts`'s
`roleLabels`/`difficultyLabels` were removed in favour of `ROLE_LABEL_KEYS` /
`DIFFICULTY_LABEL_KEYS` precisely because a map frozen at import time cannot follow a
locale switch. Do not re-add one.

**(d) `tags.kind` produces NO insert-site errors**, because it carries a drizzle
`.default("free")` (§4.3a). If you *do* see `$inferInsert` errors on `tags`, the default
was omitted and the column now behaves like the fold columns — which is not what was
decided.

**(e) The three-project split.** A new co-located `*.test.ts` under `apps/web/src` needs
no config edit: `tsconfig.json` excludes it, `tsconfig.test.json` includes it, and
`scripts/typecheck.ts` already lists all three projects. It only grows a line if a
**fourth project** appears. The trap is on the API side: a directory named
`apps/api/tests/` (plural) is invisible to `tsconfig.json`, which includes `test/**` only,
and its type errors ship silently.

**The one open decision typecheck will surface for area 02, decided here as a
recommendation (§8.2 / SPEC §4.1's "pick one and document why"): store `planned_on` as a
`YYYY-MM-DD` TEXT column, not an integer.** Reason: a calendar date has no timezone, and
an integer-midnight-UTC column is silently the wrong day for anybody east or west of UTC —
which is the drift SPEC §4.1 warns about. Text dates compare, sort and range-query
correctly in SQLite (`BETWEEN '2026-09-07' AND '2026-09-13'`), the `(group_id, planned_on)`
index serves the week query directly, and it is self-describing in `db:studio`. The cost is
one documented exception to "Timestamps: integer unix ms in SQLite" — and it is not
actually an exception, because `planned_on` is a **date**, not a timestamp;
`cooked_at`/`created_at`/`updated_at` on the same table stay integer unix ms. Flagged as a
conflict with area 02, which owns the table.

### 8.3 `bun test`

- **No new `mock.module`**, so the filesystem-order leak is not a new risk — but the
  discipline is: any new file calling `setVerifiedEmailRequired()`, `setMailer()` or a new
  `setPlanClock()` **must** hand it back in `afterAll`. `bun test` runs every file in one
  process, and `bun test a.ts b.ts` does **not** let you control the order, so a leak
  cannot be reproduced by re-ordering the command line — you have to inject the stub into
  a file that already runs earlier.
- **The gate is OFF under `bun test` unless a file asks** (`env.isTest` forces
  `isVerifiedEmailRequired()` false), so `plan.test.ts` and `cooked.test.ts` see writes
  succeed by default; only `verified-email-gate.test.ts` turns it on.
- **`file::memory:` + transactions.** If area 02's plan service uses `withTransaction()`
  it degrades to sequential statements on memory DBs, which is fine; a test that needs a
  **real** transaction uses a temp file DB, per the existing pattern.
- **The route-order test can pass by accident.** `…/shopping-lists/bought` will resolve
  correctly whenever hono happens to rank statics first. Assert the negative half too —
  that a real list id still resolves — or the ordering bug is invisible (§5.1).
- **`?sort=lastCooked` and NULL.** SQLite sorts NULL first ascending; a naive
  `orderBy(desc(recipes.lastCookedAt))` puts never-cooked recipes **first** under some
  plans and last under others. Pin it with an explicit assertion, not a hope.
- **Thumbnails.** `warmThumbnail()` is a no-op under `bun test` on purpose — an unawaited
  write into the shared `data/uploads` lands after the test cleaned up and orphans a file
  every run. New thumbnail call sites must go through `toRecipe`, not around it.
- **The count changes**, and `README.md` and `CLAUDE.md` disagree about it today (934 vs
  1058). Set both from one real run.

### 8.4 `bun run build`

- **The precache manifest grows** by the woff2 files —
  `maximumFileSizeToCacheInBytes: 4 MB` is per file, so nothing fails, but the
  `115 entries (1359 KiB)` line in `README.md` becomes wrong. Re-measure.
- **A preload that 404s does not fail the build.** If a font ends up in
  `dist/assets/<name>-<hash>.woff2` (imported from `src/` rather than placed in
  `public/fonts/`), the glob still matches it and the build is green, while
  `<link rel="preload" href="/fonts/...">` 404s in the browser and every screen renders in
  the fallback stack until the CSS-triggered fetch lands. This is the single most likely
  first-attempt failure of this whole area, and it is invisible to every gate. §6.4's
  `document.fonts.check()` assertion is what catches it.
- **`build.sourcemap` stays off**, so the client TypeScript is not published.
- **Two new lazy chunks** (`PlanPage`, `ShoppingHistoryPage`). Harmless with
  `skipWaiting: false`; §3.3 is what keeps it that way.
- **The PWA manifest's colours are hardcoded hex, not tokens** — `background_color:
  "#faf5ee"`, `theme_color: "#c2532c"` in `apps/web/vite.config.ts`. They are the install
  splash and the Android task-switcher colour, and area 01's palette work does **not**
  reach them. A conflict, not a gate failure (§8.6).

### 8.5 `bun run i18n:check`

**It is grep-shaped and exits non-zero even when the tree is correct. Read the output,
never just the exit code.** How to read it:

```bash
bun run i18n:check 2>&1 | grep -vE ':[0-9]+: *(\*|//|/\*)'
```

That drops check 2's comment hits. What is left must be on one of the three known
false-positive lists:

1. **Parity (check 1) — genuinely NEW German copy.** After this redesign this is the
   *dominant* output: `de` values are compared fragment-by-fragment against the base
   commit, and copy the design invents has no counterpart there by definition. **The
   procedure, and it is the only part that matters:** for each listed key, decide whether
   it is *new* copy or a *reworded existing* string. A reworded string is a **genuine
   failure** and looks byte-identical in the output to a new one. Concretely: any label
   the design merely **restyled** (most of `shopping.de.ts`, most of `recipes.de.ts`) must
   still be byte-identical — umlauts, `„low-high“` quotes, en-dashes, trailing colons and
   ellipses included. Only a key the design **invents** ("Diese Woche", "Heute gekauft",
   "Häufig gekauft" chips' hint, the planner's day states) may legitimately appear.
2. **Leftover German (check 2) — English comments quoting a German UI label.** The
   `grep -vE` above removes them. They are required to keep the German label they quote.
3. **Leftover German (check 2) — CONTENT vocabulary.** `UNIT_SUGGESTIONS`, the ingredient
   paste placeholders, `STEP_HEADING_RE`, `html/entities.ts`'s umlaut table — **and the
   redesign adds one: the course vocabulary.** Its file must be added to `ALLOW_LIST` in
   `scripts/i18n-check.ts` (§7.3), or class 3 stops being a closed list a reviewer can
   eyeball and the check gets ignored, which is how a real leak got through last time.

**What a genuine check-2 failure looks like**, and the shape to actively hunt for: a
German literal in a source file that is neither a comment nor content vocabulary. The
worst variant, because `tsc` cannot see it and check 2 is the *only* thing that can, is
**German in an `ApiError`'s `details` slot rather than its message slot** — that is exactly
how the literal in `services/groups/validation.ts` went out on the wire untranslated. So:
every new endpoint's `details` payload carries machine values only (`reason`, ids, counts),
never prose. And `reason` itself is a machine contract like `code` — never keyed, never
translated, never renamed.

**Do not set `I18N_CHECK_BASE`.** On the `redesign` branch
`git merge-base HEAD origin/main` resolves to the pre-redesign commit, which is what makes
check 1 meaningful. Pointing it at a redesign commit quiets the output and destroys the
check.

**Do not bulk-add keys to `NEW_GERMAN`** (§7.3). One entry per key with a reason is the
design; a hundred entries is a mute button.

### 8.6 Two conflicts with other areas, surfaced by the gates

- **`apps/web/vite.config.ts` is edited by two areas.** I own `globPatterns` and
  `RUNTIME_CACHING`; area 01 owns the manifest's `theme_color` / `background_color`, which
  are hardcoded hex and must be changed by hand when the palette moves (`lib/theme.ts`
  keeps the runtime `<meta name="theme-color">` in sync, but not the manifest). One file,
  two non-overlapping regions — coordinate the edit order or take the merge conflict
  knowingly.
- **`apps/web/index.html`** — area 01 adds the font preloads; I only assert them (§6.4).
  I do not edit that file.

---

## 9 — Open items and recommendations

| # | Item | Recommendation |
| --- | --- | --- |
| 1 | **SPEC open item 4** — `Bought history` → `All` has no destination. | A route, `/shopping/history`, with `listId` + `offset` params. It is a paginated deep-linkable list; a dialog cannot hold `offset` or be linked from the phone rail. §1.1. |
| 2 | **`planned_on` storage** (area 02 owns the table; SPEC §4.1 demands a documented choice). | `YYYY-MM-DD` **TEXT**. A calendar date has no timezone; integer-midnight-UTC is silently the wrong day off UTC, which is precisely the drift SPEC warns about. §8.2. |
| 3 | **`tags.kind` backfill** for existing installs. | **No name-matching backfill.** It writes a content guess into user data irreversibly, and the UI degrades correctly (no eyebrow). Escape hatch if wanted: an opt-in `bun run tags:mark-courses` with `--dry-run` and English ops output. Needs a release-note line: existing installs start with no eyebrows. §4.3d. |
| 4 | **Course rail filter param** (area 04 owns the rail). | Reuse the existing `tags` param — a course *is* a tag under D5, and "must carry all" is already the right semantics. Zero new params, zero query-schema change. §1.2. |
| 5 | **`PERSIST_BUSTER` bump coordination.** | One bump, to `"v3"`, in the platform commit, landing last. Areas 02/03/04 do not touch `apps/web/src/lib/persist.ts` at all, so the allow-list and the buster move in one diff. §2.3. |
| 6 | **SPEC open item 3** — "synced 2 min ago" / "Lena is shopping now", with no websocket. | "synced X ago" needs **no backend at all**: render the TanStack query's own `dataUpdatedAt` through `formatRelative`. "Lena is shopping now" comes from the newest `shopping_bought_items.bought_at` within N minutes, already in the bought-summary payload. Two derivations, zero sockets. |
| 7 | **SPEC open item 5** — progress-bar denominator. | **Confirmed by the artboard itself**: `10 to buy · 4 bought today` drawn at `29%` is `4/14`. Denominator = `toBuy + boughtToday`, not the lifetime total. Pinned in `boughtProgress`'s unit test. §5.2. |
| 8 | **SPEC open item 6** — the overview list preview is 8 of 10 with `+2 more`. | It must come from the **list** endpoint, not a full item fetch. `ShoppingListListResponse` needs a small `previewItems` array (8) plus the two counts, so `/shopping` stays one request. Area 03 owns the shape; flagged here because the alternative silently makes the overview N+1 requests. |
| 9 | **`/plan` has no artboard at all** (SPEC §4.1). | Build it from the day-card states plus the shell, and **attach the 390 and 1440 screenshots to the PR** as the reference that does not exist. §6.5 makes that a runbook step rather than a good intention. |
