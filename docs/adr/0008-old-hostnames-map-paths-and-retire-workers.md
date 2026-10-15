# 0008: The old hostnames map paths and retire the old service workers (refines D11)

Date: 2026-10-15

## Context

SPEC D11 let the stack's Caddyfile serve toon-recipe's and toon-finance's old hostnames as
`redir https://{$TOON_HOSTNAME}{uri} permanent` blocks, so old bookmarks land on the new app. Taken
literally, that one rule fails twice (plan `m6-deploy.md` decision 8):

- **Old paths are not new paths.** The household app moved every module screen under its module's
  base path (`/recipe/…`, `/finance/…`, SPEC §5) and renamed the group screens (`/groups` →
  `/households`, D1). A bookmark of `https://<recipe-host>/plan` would be sent to `/plan`, which the
  new route tree does not have (NotFound). `/plan` also exists in both sources with different
  meanings (the meal plan, the Fixkostenplan), so no single path map could serve both.
- **Installed old PWAs never leave.** Both old apps install a service worker that serves a
  precached shell. The browser's update check fetches `/sw.js`; a redirect there is a failed update,
  so the old worker keeps answering every navigation with the old `index.html` forever, and that
  shell's `/api` calls are redirected cross-origin and fail. The user sees a broken old app, not the
  new one.

## Decision

Each optional old-hostname site block in `docker/Caddyfile` (Table R of the m6 plan, section 3):

1. **maps the source's own paths to the new ones**, per host: on the recipe host `/` and `/search`
   go to `/recipe` with the query, `/recipes/*`, `/import[/*]`, `/collections[/*]`, `/tags`,
   `/shopping[/*]` and `/plan` go to `/recipe{uri}`, `/groups[/<id>]` goes to `/households[/<id>]`
   (a group id is the household id, SPEC §6); on the finance host `/` goes to `/finance`,
   `/transactions[/*]` to `/finance{uri}`, `/new`, `/plan` and `/categories` to `/finance/…`,
   `/household` to `/households`, `/password/forgot` and `/password/reset[/*]` to `/forgot-password`
   (F's reset tokens are not migrated, SPEC §6 step 5). The `/plan` collision disappears because
   each host has its own block;
2. **answers `/sw.js` with a 200 self-retiring worker** (`text/javascript`, `no-cache`): it skips
   waiting, deletes every cache of the old origin, claims the clients, unregisters itself and
   reloads every open window, which then reaches the network, gets the 301 and lands on the new app;
3. **falls back to D11's `redir https://{$TOON_HOSTNAME}{uri} permanent`** for everything else (auth
   links, `/settings`, `/uploads`, `/api`, unknown paths).

Only `handle` blocks are used inside these sites (Caddy sorts `redir` before `handle`, so a bare one
would swallow `/sw.js`). `apps/web/src/legacy-redirects.test.ts` ties the file to Table R and every
target, and every route of the two sources, to the new route tree; `apps/api/test/deploy-caddyfile.test.ts`
pins the worker's body and the block shape. SPEC D11 carries the new wording in the same commit.

## Consequences

- **The map must be right before go-live.** The redirects are 301s, which browsers cache; a wrong
  row would keep sending a bookmark to NotFound after it is fixed. The tests above and the curl pass
  of the integration task check every row before the cutover.
- **IndexedDB of the old origins is abandoned.** The worker touches only caches; the old apps'
  persisted query caches, including any unsent offline write (toon-recipe's shopping outbox,
  toon-finance's capture outbox), stay behind on an origin whose API is gone. The cutover in
  `docs/deployment.md` therefore asks everybody to open both old apps online once before the
  cutover so their outboxes drain.
- **The blocks are temporary.** They go away together with the old hostnames (unset
  `RECIPE_HOSTNAME` / `FINANCE_HOSTNAME`, or delete the two blocks), as D11 already said. Unset, each
  block falls back to a placeholder address under the reserved `.invalid` TLD; a set-but-empty
  variable is turned into that placeholder by compose's `:-` defaults, because Caddy's own
  `{$VAR:default}` covers only the unset case.
