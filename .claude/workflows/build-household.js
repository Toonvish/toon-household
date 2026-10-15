export const meta = {
  name: 'build-household',
  description: 'Build toon-household (toon-recipe + toon-finance merged into a modular app) milestone by milestone: Opus plans and reviews, Sonnet implements and verifies, Haiku ports verbatim and runs the gates',
  whenToUse: 'Run from ~/software/toon-household. args: { milestones: ["M0"], maxFixRounds?: 2, maxParallel?: 3, hardenRounds?: 2 }. Milestones M0 scaffold, M1 core, M2 recipe module, M3 finance module, M3b finance-sync (follow-up port of toon-finance cbdec67..1715207 + placeholder migration), M4 design pass, M5 migration, M6 deploy, M7 harden (docs/SPEC.md §8). Run one or two per invocation and read the result before the next; the loop stops at the first milestone whose exit criteria are not met. Resume with resumeFromRunId after fixing the cause.',
  phases: [
    { title: 'Plan', detail: 'Opus high: milestone plan from SPEC and the two source repos, two adversarial critics, one revision; each task tagged with the model tier that fits it', model: 'opus' },
    { title: 'Implement', detail: 'Haiku for verbatim ports and gate runs, Sonnet for implementation, Opus for architecture-defining tasks; dependency waves in parallel worktrees, merge, verify, fix loop', model: 'sonnet' },
    { title: 'Review', detail: 'Opus high: exit criteria, SPEC compliance, source-decision compliance, gates run by Haiku', model: 'opus' },
    { title: 'Harden', detail: 'Sonnet high: fix review findings, re-review, sync CLAUDE.md, plan and ADRs', model: 'sonnet' },
  ],
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------
const REPO = '/home/erics/software/toon-household'
const RECIPE = '/home/erics/software/toon-recipe'
const FINANCE = '/home/erics/software/toon-finance'
const EDGE = '/home/erics/software/toon-edge'
const SPEC = `${REPO}/docs/SPEC.md`
const DOCS = `${SPEC} (§1 fixed decisions D1-D15, §2 module contract, §3 target layout, §4 schema mapping, §5 shell and navigation, §6 migration CLI, §7 gates, §8 milestones), ${REPO}/CLAUDE.md, ${RECIPE}/CLAUDE.md and ${FINANCE}/CLAUDE.md (the locked decisions and gotchas of the two sources, binding inside the module that inherits them: SPEC D13), ${RECIPE}/docs/API.md, ${RECIPE}/docs/i18n.md, ${RECIPE}/docs/deployment.md, ${RECIPE}/docs/redesign/SPEC.md (the design system), ${FINANCE}/docs/spec.md (schema, API, screens, German copy §6), ${FINANCE}/docs/ledger-spec.md, ${EDGE}/Caddyfile and ${EDGE}/README.md`
const MAX_FIX = (args && Number.isInteger(args.maxFixRounds)) ? args.maxFixRounds : 2
const MAX_PARALLEL = (args && Number.isInteger(args.maxParallel)) ? Math.max(1, args.maxParallel) : 3
const HARDEN_ROUNDS = (args && Number.isInteger(args.hardenRounds)) ? Math.max(0, args.hardenRounds) : 2

// Model tiers. The planner tags every task with one; the orchestrator maps it to a model.
//   port   — Haiku: copy files verbatim with path, import, prefix and key rewrites the brief spells out; no design
//   build  — Sonnet: implementation with tests
//   core   — Opus: architecture-defining work (module registry, schema merge, migration mapping, the shell)
// Verification is Sonnet (it has to judge, not just run), gate runs are Haiku (run and report verbatim),
// planning, critique and review are Opus, fix round 1 is Sonnet and the last fix round escalates to Opus.
const OPUS = { model: 'opus', effort: 'high' }
const SONNET = { model: 'sonnet', effort: 'high' }
const HAIKU = { model: 'haiku', effort: 'medium' }
const TIER_MODEL = { port: HAIKU, build: SONNET, core: OPUS }
const modelFor = (task) => TIER_MODEL[task.tier] || SONNET

const MILESTONES = {
  M0: {
    name: 'scaffold',
    goal: 'The monorepo skeleton per SPEC §3, copied from toon-recipe where D13 allows: root package.json (workspaces, scripts), .bun-version, tsconfig.json, scripts/{dev,typecheck,i18n-check}.ts, packages/shared (core/: the i18n runtime and server catalogs, calendar.ts, text.ts, http url schema, list envelope; modules/registry.ts with MODULE_IDS = ["recipe","finance"] and nothing else), apps/api (env.ts, db/client.ts with WAL + synchronous=FULL per D7, db/migrate.ts, db/schema.ts re-exporting schema/core.ts with users/sessions/oauth/tokens/households/household_members/household_invites/household_modules/legacy_ids, lib/, middleware/{session,household,verifiedEmail,module,staticWeb}.ts, index.ts with health reporting `modules`, modules/index.ts exporting an empty manifest list), apps/web (vite.config.ts with the PWA plugin and the three tsconfigs, styles/index.css + theme.css, public/fonts with Newsreader and Figtree, components/ui, components/layout with an AppShell that renders an empty module-less tab bar, lib/{api,queries,query-client,session,persist,pwa,unsavedWork,storage,theme,format,validation,navigation,cn,viewport}.ts, lib/i18n, modules/index.ts empty, router.tsx with the app layout and a placeholder Home), apps/api/test with the smoke test, .github/workflows/ci.yml, .gitignore, and CLAUDE.md "Commands" filled in. No module code yet.',
    exit: 'bun install, bun run typecheck, bun test, bun run build and bun run i18n:check are green; bun run dev serves /api/health with {"ok":true,"modules":[]} and the web app renders the empty shell; CLAUDE.md "Commands" lists what exists.',
  },
  M1: {
    name: 'core',
    goal: 'The core per SPEC D1, D2, D4, D8, D9, §2 and §5: auth ported from toon-recipe (routes/auth.ts, services/auth, OAuth, e-mail confirmation gate, password reset, mail services console/smtp/resend, the signed /uploads route and media services); households ported from toon-recipe groups (tables, routes, services, invites, member roles, active household, the HouseholdSwitcher, the households card on /settings, the settings screen with profile, language, theme and e-mail cards); household_modules with requireModule(id), the ApiModule and WebModule manifest types and the two modules/index.ts registries, GET /api/households/:id reporting modules, POST/DELETE /api/households/:id/modules/:moduleId for owners/admins; the shell: Home with the enable-module empty state, the ModuleSwitcher (ActionMenu sheet on phones, segmented group in the sidebar from lg), the tab bar computed from the active module or the module-less set, RequireModule; persist allow-list and mutationDefaults assembled from the manifests with PERSIST_BUSTER household-v1; the auth, households and settings tests ported.',
    exit: 'gates green; register, log in, create a household, invite and accept, switch household, enable and disable a module over the API all work in the curl walkthrough and in tests; Home renders the empty state at 390px and 1440px; /api/households/:id returns modules; a route under a disabled module redirects to Home.',
  },
  M2: {
    name: 'recipe-module',
    goal: 'Port every recipe feature of toon-recipe into modules/recipe on all three workspaces (SPEC §3, §4): packages/shared/src/modules/recipe (units, ingredients, numbers, duration, recipe schemas, shopping.ts, barcode.ts, qr.ts and their tests), apps/api/src/modules/recipe (schema.ts with the recipe_ prefix and household_id, routes recipes/imports/shopping/cards/plan under /api/households/:id/recipe and /api/recipe/cards, services recipes/import/ocr/shopping/cards/media thumbnails, capabilities flags, the fold columns and their JS backfill), apps/web/src/modules/recipe (features recipes/collections/tags/import/shopping/cards/plan, catalogs with the recipe. namespace prefix and every German string byte-identical, the WebModule manifest with the three tabs Rezepte/Plan/Einkauf and the secondary items Sammlungen/Tags, homeCard, persist allow-list and the shopping outbox mutationDefaults), the drizzle migration, seed data, the uploads-gc and reset-password scripts, the service-worker NetworkOnly rules for the recipe paths, and every toon-recipe test file ported (test/, never tests/). Mechanical moves are port tasks for Haiku with the exact rewrites spelled out (old path → new path, import specifiers, table names, route prefixes, query-key roots, catalog key prefixes, group → household identifiers); anything that changes behaviour is a build task.',
    exit: 'gates green; every file under toon-recipe/apps/api/test, toon-recipe/packages/shared/test and the co-located web tests has a counterpart that passes; the four recipe tabs and every secondary screen work at 390px and 1440px with the reachability rules of toon-recipe\'s CLAUDE.md "Navigation"; a URL import, a shopping-list offline check-off replay and a card render pass in the headless browser; i18n:check shows only the known false-positive classes.',
  },
  M3: {
    name: 'finance-module',
    goal: 'Port toon-finance into modules/finance per SPEC D3, D5, §3, §4: packages/shared/src/modules/finance (money, ledger, period, plan, categories, tags, schemas, tests unchanged), apps/api/src/modules/finance (schema.ts with the finance_ prefix, finance_participants with member_slot 1/2 keyed by user id and the unique index and CHECK, finance_settings; routes transactions/categories/tags/plan/balance/settlements under /api/households/:id/finance; onHouseholdCreated seeding the 21 categories; onEnable validating two participants; 409 finance_participant_in_use; the plan-run script; requireFinanceParticipant for writes), apps/web/src/modules/finance (features transactions/overview/plan/categories/settings-participants restyled onto the toon-recipe design system: components/ui primitives only, the type scale, the four theme blocks, .eyebrow, bottom-tabbar sticky bars, AmountText/KindBadge/PeriodLabel kept as module components; catalogs with the finance. prefix and every German string byte-identical to docs/spec.md §6; the WebModule manifest with Übersicht/Buchungen/Erfassen and the secondary items Fixkosten/Kategorien; the participant settings section; the non-participant and module-disabled states; the transaction outbox mutationDefaults in the ["toon","finance","tx"] namespace), the drizzle migration, and every toon-finance test file ported. The two-person ledger logic is not generalised (SPEC D3).',
    exit: 'gates green; every toon-finance test file has a passing counterpart, including halfForOther(-101) = -50, the single-rounding plan share, the second retroactive correction, isPeriodBooked and balance_stale; a household with three members can assign two finance participants, the third sees the non-participant state; screens verified at 390px and 1440px in dark and light.',
  },
  M3b: {
    name: 'finance-sync',
    goal: `Bring the finance module and the migration up to toon-finance origin/main. M3 was ported from a toon-finance checkout at cbdec67 (2026-08-21); ${FINANCE} is now at 1715207 (2026-09-12), which is what production runs (image revision 1715207; its database is at migration 0002_placeholder_members, 3 migrations). Port the seven commits of \`git -C ${FINANCE} log --oneline cbdec67..1715207\` (97ab955 shared-host deploy tooling; 00ea694 "Erfassen" as a global sheet + petrol palette; 760639d redesign-review fixes; 590697f publish on every push; b1b517d placeholder members + claim invites; 8978cad typography/styling/icons aligned with toon-recipe; 1715207 security-review fixes) into toon-household with the M3 renames of CLAUDE.md "Conventions". Read \`git -C ${FINANCE} diff cbdec67 1715207\` hunk by hunk, the new toon-finance CLAUDE.md gotchas (Platzhalter, Claim-Einladung, claimPlaceholderUser as a conditional UPDATE, peekMutationClaim needing the household, useUnsavedWork(form.isDirty)) and docs/spec.md §2.1, §2.5, §3.5 and the §6 copy. (a) Placeholder members and claim invites cross into the core, because users and invites are core tables: users.email, email_normalized and password_hash become nullable (a placeholder is \`password_hash IS NULL AND email IS NULL\`, isPlaceholderUser in the core), household_invites.claims_user_id (ON DELETE cascade), a core route creating a placeholder member of a household (admin+; toon-finance's POST /members with CreatePlaceholderMemberRequest), a claim invite carries claimsUserId and is redeemed ONLY by register (claimPlaceholderUser = conditional UPDATE … WHERE password_hash IS NULL … RETURNING, never check-then-write; 409 member_has_account, 409 invite_claim_requires_register), invite accept and the screens InviteSecondPerson/MemberList/InviteCard ported to where the M3 renames put them (the core households feature and the finance participants feature); every core path that reads a user's e-mail (session, mail, the verified-e-mail gate, settings, the members list, the switcher, HouseholdWithRole) tolerates a placeholder; a placeholder can be seated in finance slot 2 (EnableFinanceDialog and ParticipantsSection offer toon-finance's "Platzhalter" flow); the drizzle migration is generated (0003_…); ADR 0006 amends D4 (placeholder accounts without e-mail or password exist and become accounts only through a claim invite redeemed by registration) and §4 in the same commit. (b) The security-review fixes (1715207) and the redesign-review fixes (760639d) are applied to the ported counterparts, each with its test counterpart. (c) The "Erfassen" global sheet (00ea694: QuickAddDialog, NewTransactionPage, useCreateForm, KindPicker, AmountInput, TransactionFormFields, TagInput, the useUnsavedWork claim on form.isDirty) and the typography/icon alignment (8978cad): behaviour and copy are ported; colours, fonts and palette are NOT (D5 wins: toon-recipe's tokens, no new font files, no petrol palette; the design-system test stays green). German copy byte-identical to the updated toon-finance catalogs and docs/spec.md §6; a genuinely new string goes to NEW_GERMAN. (d) The deploy tooling (97ab955, 590697f: docker/Caddyfile, toon-deploy.sh, env.example, release and deploy workflows) is NOT ported here; the plan records what M6 must take from those commits. (e) Migration (SPEC §6, D12): the finance schema gate accepts the 3-migration schema (0002_placeholder_members, lastCreatedAt from the source journal); the fixture schema folder is the updated toon-finance drizzle folder byte-identical and the fixtures gain a placeholder user seated in slot 2 with a pending claim invite; the user rule gains, per the owner's decision: a finance placeholder user (email null, no password) migrates as a placeholder user in the target (null e-mail, null password, fresh id if taken, legacy_ids row; it cannot collide by e-mail) plus ONE pending claim invite in household_invites with claims_user_id for its target household (fresh token, no e-mail, the core's expiry, created by the household's owner); a legacy claim invite that is still pending becomes that invite instead of a second one; the apply report prints the claim inviteUrl per placeholder so the operator can hand it over (never in dry-run output written to a file inside the tree); ADR 0006 covers this rule and edits §6 item 2 and §9 (finance invites stay unmigrated except claim invites) in the same commit; docs/migration.md updated. (f) The owner's real backups sit in ${REPO}/migration-in/recipe/{local.db,uploads/} and ${REPO}/migration-in/finance/local.db (gitignored, taken 2026-10-15 from production; the finance DB has one household, two users of which slot 2 is a placeholder, 334 transactions). They are the exit evidence: run against them with DATABASE_URL=file:./migration-out/toon.db UPLOAD_DIR=./migration-out/uploads, reports into ${REPO}/migration-out/. NEVER copy these files, their reports, row contents or any e-mail address from them into the tree, a plan, a screenshot or a commit; the plan quotes only counts and the balance verdict.`,
    exit: `gates green; every toon-finance test file at 1715207 has a passing counterpart (the m3 plan's test map updated); a test proves a migrated placeholder is claimable by register on the fixtures; the real-data dry run \`bun run migrate:legacy -- --recipe-db migration-in/recipe/local.db --recipe-uploads migration-in/recipe/uploads --finance-db migration-in/finance/local.db --report migration-out/m3b-dry-run.json\` exits 0 with no errors, the finance balance OK, and the placeholder plus its claim invite listed; \`--apply\` into migration-out/ then a second \`--apply\` writes nothing; the changed finance screens (the Erfassen sheet, the participants section with the placeholder flow, the claim-invite registration) verified at 390px and 1440px with screenshots in docs/plans/screenshots/m3b/ using seeded demo data only.`,
  },
  M4: {
    name: 'design-pass',
    goal: 'SPEC D5, D6 and §5 made real: Home cards with the recipe week strip + shopping count and the finance balance line + period spend, the module switcher in both chromes, the module-less tab bar (Home · enabled modules · Profil), finance screens audited token by token against toon-recipe/docs/redesign/SPEC.md (no arbitrary text-[…px], font-display font-medium, .eyebrow for uppercase labels, controlClasses min-w-0, grid minmax(0,1fr), px-gutter never px-safe beside px-4, sticky bars with bottom-tabbar and the flex chain, one overflow trigger per header, lucide glyphs never text arrows), every new token in all four theme.css blocks, print.css for recipes still working, the PWA manifest with the household name, icons and shortcuts (/recipe/import, /finance/new), theme-color sync, a desktop and phone screenshot of every screen.',
    exit: 'screenshots at 390px and 1440px of Home, the switcher, every module tab screen and the settings screen in docs/plans/screenshots/m4/, in dark and light; documentElement.scrollWidth === clientWidth on every screen; grep finds no fonts.googleapis, no text-[ size utilities outside the documented pre-existing recipe exceptions, no bottom-0 bar; the four theme blocks define the same token set.',
  },
  M5: {
    name: 'migration',
    goal: 'SPEC D12 and §6: apps/api/scripts/migrate-legacy.ts with scripts/legacy/{users,households,recipe,finance}.ts, the legacy_ids ledger, user union by email_normalized with the collision rule, the household mapping proposal (merge by member overlap, most-recipes tie-break, --mapping override), module enablement and finance_participants from member_slot, chunked idempotent row copies with legacy_ids lookups, upload copy with size verification, the report (counts, collisions, decisions, skipped rows with reasons, finance balance per household before and after; the run fails if a balance differs), dry-run default and --apply; fixtures in apps/api/test/fixtures/legacy/ (small anonymised DBs in both legacy schemas, built by a script from the drizzle migrations of the sources, covering a user in both apps, a finance household whose members sit in one group, in two groups, in none), tests for the mapping and the idempotent re-run, docs/migration.md with the cutover order.',
    exit: 'bun run migrate:legacy against the fixtures prints the proposal and report in dry-run and writes nothing; with --apply it migrates, a second --apply writes nothing and says so; the balance invariant test passes; a run against copies of the owner\'s real data (ask for the paths in the plan; if absent, the fixtures are the evidence and the plan says so) produces a report without errors.',
  },
  M6: {
    name: 'deploy',
    goal: 'SPEC D11: Dockerfile from toon-recipe (WITH_OCR/WITH_PDF args, tini, the three node_modules paths, /app/data volume, HEALTHCHECK), docker-compose.yml in the pre-toon-edge shape (app + caddy, bridge network toon, volumes toon-data/caddy-data/caddy-config, caddy 2.11.4-alpine pinned, 443/udp, mem limits, logging), docker/Caddyfile with toon-edge\'s hardening and fwd snippets verbatim, one site block for TOON_HOSTNAME with the recipe import timeouts, optional redirect blocks for RECIPE_HOSTNAME and FINANCE_HOSTNAME, the http block with the local CA download; docker/env.example, docker/entrypoint.sh, docker/toon-deploy.sh; .github/workflows/{release,deploy}.yml publishing ghcr.io/toonvish/toon-household with WITH_OCR=1 WITH_PDF=0; docs/deployment.md with fresh install, the cutover from toon-edge (stop old stacks without -v, copy volumes out, dry-run, apply, start, verify, remove old stacks and toon-edge, delete volumes last) and the local stack test.',
    exit: 'docker build -t toon-household:local . > build.log 2>&1 exits 0 (checked by $?, never through a pipe); docker compose --env-file .env.local-stack up -d serves the PWA with TOON_TLS_ISSUER=internal and /api/health is healthy; caddy validate passes with the old hostnames set and unset; docs/deployment.md has the cutover section.',
  },
  M7: {
    name: 'harden',
    goal: 'Close every open review finding of M0-M6, run the full gate set on the final tree, rewrite CLAUDE.md as built (read order, status, layout, commands, conventions, the gotchas that still apply from both sources with their new paths), write docs/API.md for the household API, docs/modules/recipe.md and docs/modules/finance.md (what each module owns, its decisions, its gotchas in English), docs/open-work.md, and an ADR for every deviation from SPEC §1 that survived.',
    exit: 'gates green on the final tree; CLAUDE.md describes what exists and names no file that does not; every deviation has an ADR; docs/open-work.md lists what is deferred.',
  },
}

const requested = (args && Array.isArray(args.milestones) && args.milestones.length) ? args.milestones : ['M0']
const todo = requested.filter(n => MILESTONES[n] != null)
if (!todo.length) throw new Error('args.milestones must contain M0..M7 (or M3b)')
log(`toon-household build: milestones ${todo.join(', ')}; max parallel ${MAX_PARALLEL}, fix rounds ${MAX_FIX}, harden rounds ${HARDEN_ROUNDS}`)

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
const TASK = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    goal: { type: 'string' },
    tier: { type: 'string', enum: ['port', 'build', 'core'], description: 'port = verbatim copy with spelled-out rewrites (Haiku); build = implementation with tests (Sonnet); core = architecture-defining (Opus)' },
    brief: { type: 'string', description: 'everything the implementer must read, by path and section: SPEC sections, source files to port, source CLAUDE.md gotchas that apply, the exact rewrites for a port task' },
    files: { type: 'array', items: { type: 'string' }, description: 'files this task owns; two tasks of one wave never share one' },
    deps: { type: 'array', items: { type: 'string' }, description: 'ids of tasks that must be merged before this one starts' },
    acceptance: { type: 'array', items: { type: 'string' } },
    verify: { type: 'array', items: { type: 'string' }, description: 'shell commands that must exit 0' },
  },
  required: ['id', 'title', 'goal', 'tier', 'brief', 'files', 'deps', 'acceptance', 'verify'],
}
const PLAN_SCHEMA = {
  type: 'object',
  properties: { plan_path: { type: 'string' }, summary: { type: 'string' }, tasks: { type: 'array', items: TASK } },
  required: ['plan_path', 'summary', 'tasks'],
}
const CRITIQUE_SCHEMA = {
  type: 'object',
  properties: {
    approved: { type: 'boolean' },
    issues: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['high', 'medium', 'low'] }, text: { type: 'string' } }, required: ['severity', 'text'] } },
  },
  required: ['approved', 'issues'],
}
const IMPL_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'blocked'] },
    summary: { type: 'string' },
    commit: { type: 'string', description: 'short hash of the last commit, or empty' },
    branch: { type: 'string', description: 'the branch the commits are on: "main" or the task branch' },
    deviations: { type: 'array', items: { type: 'string' }, description: 'where the implementation departs from SPEC §1 or a source CLAUDE.md decision, and why' },
    notes: { type: 'string' },
  },
  required: ['status', 'summary', 'commit', 'branch', 'deviations'],
}
const LANDED_SCHEMA = {
  type: 'object',
  properties: {
    landed: { type: 'boolean' },
    commit: { type: 'string' },
    evidence: { type: 'string' },
  },
  required: ['landed', 'commit', 'evidence'],
}
const MERGE_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['merged', 'failed'] },
    summary: { type: 'string' },
    merged: { type: 'array', items: { type: 'string' } },
    failed: { type: 'array', items: { type: 'string' } },
    head: { type: 'string' },
  },
  required: ['status', 'summary', 'merged', 'failed', 'head'],
}
const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' },
    commands_run: { type: 'array', items: { type: 'string' } },
    failures: { type: 'array', items: { type: 'string' } },
  },
  required: ['pass', 'commands_run', 'failures'],
}
const GATES_SCHEMA = {
  type: 'object',
  properties: {
    results: { type: 'array', items: { type: 'object', properties: { command: { type: 'string' }, exit_code: { type: 'integer' }, tail: { type: 'string', description: 'the last 40 lines of output, verbatim' } }, required: ['command', 'exit_code', 'tail'] } },
    git_status: { type: 'string' },
  },
  required: ['results', 'git_status'],
}
const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    exit_met: { type: 'boolean' },
    summary: { type: 'string' },
    findings: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['high', 'medium', 'low'] }, title: { type: 'string' }, detail: { type: 'string' }, files: { type: 'array', items: { type: 'string' } } }, required: ['severity', 'title', 'detail'] } },
  },
  required: ['exit_met', 'summary', 'findings'],
}

// ---------------------------------------------------------------------------
// Helpers (plain code, no agents)
// ---------------------------------------------------------------------------
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const branchOf = (n, task) => `wf/${slug(n)}-${slug(task.id)}`
const wtOf = (task) => `${REPO}/.worktrees/${slug(task.id)}`
function incompleteTasks(results) {
  return results.filter(r => !r.impl || r.impl.status === 'blocked').map(r => r.task.id)
}
function landedImpl(impl, check) {
  if (!impl || impl.status !== 'blocked' || !check || check.landed !== true) return null
  const commit = String(check.commit || '').trim()
  if (!/^[0-9a-f]{7,40}$/.test(commit) || !String(check.evidence || '').trim()) return null
  return { ...impl, status: 'done', commit, branch: 'main', onMain: true, notes: `already on main (${commit}): ${check.evidence}` }
}
const needsMerge = (impl) => !impl.onMain && !!impl.branch && impl.branch !== 'main'

// ---------------------------------------------------------------------------
// Shared rules for every agent
// ---------------------------------------------------------------------------
const RULES = `
Project: toon-household, repository root ${REPO}. Read first: ${DOCS}.
The two source apps are READ-ONLY port sources: ${RECIPE} (recipe module and the core) and ${FINANCE} (finance module); ${EDGE} holds the Caddy snippets. Never modify them. Never run bun install, bun test or any script inside them except read-only inspection (cat, grep, git log).
Rules:
- Work only inside ${REPO}. Never edit ~/.claude, other repos, or the user's shell config.
- SPEC §1 decisions D1-D15 are fixed. Inside a module the source repo's CLAUDE.md decisions and gotchas are binding too (SPEC D13). If you must deviate, make the minimal deviation and report it in \`deviations\`; never re-litigate.
- German UI strings are copied BYTE-IDENTICAL from the sources (umlauts, „quotes", en-dashes, trailing colons). Only genuinely new screens get new German copy. Interface language and content language are two different axes: German recipe vocabulary and finance descriptions never go through t().
- Money is integer cents everywhere. Timestamps are integer unix ms in SQLite and ISO on the wire; planned_on and periods are text.
- Tables are prefixed per module (recipe_, finance_); core tables are not. Module routes mount under /api/households/:householdId/<module>/ and user-scoped ones under /api/<module>/. Query keys start ["toon","household",id,"<module>"].
- Never ask questions; make the sensible choice and record it.
- Do not push. Commit per task with a message whose body names the SPEC decision or source file served, ending with "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>".
- Verification means running commands and reading their output. Report failures verbatim. bun run i18n:check exits non-zero by design: read its output and classify every hit.
- Tests live in apps/api/test (never tests/), apps/web co-located *.test.ts(x) under tsconfig.test.json, packages/shared/test.
- Long commands (bun install on a cold cache, docker build, a headless-browser run) go to the background writing one log that ends with "exit=$?", then poll the log; a log without exit= means not finished.
`

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------
const planPrompt = (n, m) => `${RULES}
You are the planner for milestone ${n} "${m.name}".
Goal: ${m.goal}
Exit criteria: ${m.exit}
Inspect the current repository state (git log, tree, the gates) and the relevant parts of both source repos so the plan builds on what exists and names real files.
Write ${REPO}/docs/plans/${slug(n)}-${m.name}.md: context, the ordered task list, per-task brief, tier, files, deps, acceptance checks and verify commands, risks, deviations expected, and what is explicitly out of this milestone.
Tasks: 6-12 of them, 45-120 minutes of focused work each, each leaving the build green on its own branch. Tag every task with a tier: "port" for a verbatim copy whose every rewrite you spell out in the brief (source path → target path, import specifiers, table names, route prefixes, query-key roots, catalog prefixes, group→household identifiers; a Haiku agent executes it and must not have to design anything), "build" for implementation with tests (Sonnet), "core" for architecture-defining work (Opus): the module registry, the schema merge, the shell, the migration mapping. Prefer many port tasks over few: a port task should move at most ~25 files. Every task's brief lists by path and section what to read: SPEC sections, the source files, the source CLAUDE.md gotchas that apply, the design-system rules for UI work. Lay the tasks out in dependency waves: tasks with no unmet deps run IN PARALLEL in separate git worktrees and are merged in id order, so two tasks of one wave must not edit the same files (say which files each owns in \`files\`); shared files (modules/index.ts registries, db/schema.ts, router.tsx, nav-items.ts, catalogs' index files, CLAUDE.md, package.json) are edited by the earliest task that needs them or by a dedicated integration task that depends on the wave. Each task's \`verify\` lists shell commands that must exit 0 (e.g. "cd ${REPO} && bun run typecheck", "cd ${REPO} && bun test apps/api/test/recipes", "cd ${REPO} && bun run build"); a headless-browser or docker check belongs only in the final integration task of the milestone, which depends on every other task.
Return the plan as structured output.`

const critiquePrompt = (n, m, plan, lens) => `${RULES}
You are an adversarial reviewer of a milestone plan. Lens: ${lens}.
Milestone ${n} "${m.name}". Goal: ${m.goal}. Exit criteria: ${m.exit}.
Plan file: ${plan.plan_path}. Tasks (JSON): ${JSON.stringify(plan.tasks)}
Try hard to find what would make this plan fail: two tasks of one wave editing the same files, a port task whose brief leaves a rewrite unspecified (a Haiku agent will guess), a core task mis-tagged as port or build, a brief that omits a source file or a source CLAUDE.md gotcha the task will trip over, a dep missing so a task starts before its foundation exists, a SPEC §1 decision violated, a German string that would be re-typed instead of copied, a source test file with no counterpart, tasks too large for one commit, unverifiable acceptance checks, ordering that leaves the build red, missing tests, the exit criteria not covered by any task. Approve only if there are no high-severity issues.`

const revisePrompt = (n, m, plan, issues) => `${RULES}
Revise the plan for milestone ${n} "${m.name}" at ${plan.plan_path} to address these review issues (JSON): ${JSON.stringify(issues)}.
Keep what was right. Rewrite the plan file in place and return the full revised task list as structured output.`

const implPrompt = (n, m, plan, task, i, total, isolated) => `${RULES}
Implement task ${task.id} (${i + 1}/${total}, tier ${task.tier}) of milestone ${n} "${m.name}": ${task.title}
Goal: ${task.goal}
Brief (read exactly this, by path and section, before writing anything): ${task.brief}
Files this task owns: ${(task.files || []).join(', ') || 'see plan'}
Acceptance: ${task.acceptance.join(' | ')}
Plan file for context: ${plan.plan_path}
${task.tier === 'port' ? 'This is a PORT task: copy the named source files to the named target paths and apply exactly the rewrites the brief lists. Do not redesign, rename, reformat or "improve" anything else; a German string stays byte-identical; a comment stays. If the brief is ambiguous about a rewrite, pick the reading that changes the fewest lines and record it in `notes`.' : ''}
${isolated ? `You work in YOUR OWN GIT WORKTREE on your own branch, which you create yourself as the very first step: \`git -C ${REPO} worktree add -b ${branchOf(n, task)} ${wtOf(task)} main\` (if the directory or branch already exists from an interrupted run, remove the directory with \`git -C ${REPO} worktree remove --force ${wtOf(task)}\` and the branch with \`git -C ${REPO} branch -D ${branchOf(n, task)}\`, then create them again). From then on every shell command starts with \`cd ${wtOf(task)} &&\` (your shell's working directory is NOT the worktree; never run bun or git in ${REPO} itself, and never \`git checkout\` or \`git switch\` there). Run \`bun install\` once in the worktree (Bun's isolated linker gives each checkout its own node_modules; ${REPO}/.worktrees is gitignored). Other tasks run at the same time on other branches, so touch only the files this task owns; the orchestrator merges the branches in task order afterwards and removes the worktree. Commit on your branch and report "${branchOf(n, task)}" in \`branch\`; leave the worktree in place.` : `You work on the main checkout in ${REPO} (branch main); report "main" in \`branch\`.`}
Steps: read the brief; implement with tests; run the task's verify commands (${task.verify.join(' && ')}) and fix until they pass; commit. If something outside your control blocks the task (missing system dependency, a source file that does not exist), return status "blocked" with the exact error text and leave the tree clean.`

const landedPrompt = (n, task, impl) => `${RULES}
Task ${task.id} "${task.title}" of milestone ${n} reported blocked: ${impl.notes || impl.summary}.
Decide whether its work is nevertheless already in the history of main of ${REPO} (an earlier run or a resumed run committed it). Read only: \`git -C ${REPO} log main --oneline --grep "${task.id}"\`, \`git -C ${REPO} log main --oneline -- ${(task.files || []).join(' ') || '.'}\`, \`git -C ${REPO} show --stat <commit>\`, and confirm with \`git -C ${REPO} merge-base --is-ancestor <commit> main\` (exit 0). The commit must carry what the task's goal and acceptance say: ${task.goal} | ${task.acceptance.join(' | ')}. If the block was an environment failure or the work is only partly there, answer landed=false. Change nothing.`

const mergePrompt = (n, wave) => `${RULES}
Integrate a wave of milestone ${n}: the following tasks were implemented in parallel on separate branches of ${REPO} and must land on main in this order: ${JSON.stringify(wave.map(w => ({ id: w.task.id, title: w.task.title, branch: w.impl.branch, commit: w.impl.commit, files: w.task.files || [] })))}.
In ${REPO} (branch main, clean tree): for each task in order run \`git merge --no-ff --no-edit <branch>\`. On a conflict, resolve it by keeping both tasks' intent (read both sides and the tasks' plan sections), then \`git add\` and \`git commit --no-edit\`. After each merge run that task's verify commands and \`bun run typecheck\`; if the merged result fails because the tasks interact (not because one task was wrong on its own), make the minimal integration fix as its own commit. After the last merge: remove each merged task's worktree (\`git worktree remove --force <dir>\`; the directories are ${JSON.stringify(wave.map(w => wtOf(w.task)))}), \`git worktree prune\`, and delete the merged branches (\`git branch -d\`). A branch that is already an ancestor of main counts as merged. An unmerged branch keeps its worktree and is reported in \`failed\` with the conflict summary. Report the final \`head\`.`

const verifyPrompt = (n, task, impl) => `${RULES}
Independently verify task ${task.id} "${task.title}" (tier ${task.tier}) of milestone ${n} on the main checkout ${REPO}. The implementer reported: ${impl.summary} (commit ${impl.commit || 'none'}).
Run every verify command: ${task.verify.join(' ; ')}. Then check each acceptance item by reading code or running something: ${task.acceptance.join(' | ')}.
${task.tier === 'port' ? 'For a port task also diff a sample of ported files against their sources (`diff <source> <target>`) and confirm that only the rewrites the brief lists differ; any German string that changed is a failure.' : ''}
Also run \`git -C ${REPO} status --porcelain\` (must be clean). Do not fix anything; only report. pass=true only if every command exits 0 and every acceptance item is demonstrably met.`

const fixPrompt = (n, task, verify, round) => `${RULES}
Fix round ${round} for task ${task.id} "${task.title}" of milestone ${n} on main in ${REPO}. Verification failed with: ${JSON.stringify(verify.failures)} (commands run: ${verify.commands_run.join(' ; ')}).
Fix the root cause, re-run the verify commands (${task.verify.join(' && ')}) until green, commit the fix.`

const gatesPrompt = (n) => `${RULES}
Run the verification gates of milestone ${n} on ${REPO} and report verbatim; change nothing, fix nothing, judge nothing.
Commands, each from ${REPO}, each captured to a log in the background when it may run long: \`bun install\`, \`bun run typecheck\`, \`bun test\`, \`bun run build\`, \`bun run i18n:check\` (skip a command whose script does not exist in package.json and report exit_code -1 with tail "script missing"). Then \`git status --porcelain\` and \`git log --oneline -15\`.
Return every command with its exit code and the last 40 lines of its output.`

const reviewPrompt = (n, m, plan, results, gates) => `${RULES}
You are the milestone reviewer for milestone ${n} "${m.name}".
Goal: ${m.goal}
Exit criteria: ${m.exit}
Task outcomes (JSON): ${JSON.stringify(results.map(r => ({ id: r.task.id, title: r.task.title, tier: r.task.tier, status: r.impl ? r.impl.status : 'skipped', verified: r.verify ? r.verify.pass : false, deviations: r.impl ? r.impl.deviations : [] })))}
Gate results, run by a separate agent (JSON): ${JSON.stringify(gates)}
Review the actual code and tests (git log since the plan, the diff, the gate output above; re-run a gate yourself only if its output is unclear). Judge: are the exit criteria met and demonstrated? Does the code follow SPEC §1 and the module contract of §2? Does each module still honour its source CLAUDE.md decisions (SPEC D13)? Are German strings byte-identical to the sources (spot-check with grep against the source catalogs)? Is every source test file accounted for where the milestone says so? Are deviations justified and documented? For UI milestones, were the 390px/1440px checks actually run (look for the screenshots and the recorded measurements)? Report findings with severity; high = exit criterion not met or a fixed decision violated.`

const fixFindingPrompt = (n, f) => `${RULES}
Address this milestone-${n} review finding (${f.severity}): ${f.title}
Detail: ${f.detail}
Files: ${(f.files || []).join(', ') || 'locate them'}
Fix it properly with tests on main in ${REPO}, run the gates that cover it (bun run typecheck, the relevant bun test paths, bun run build when the web app changed), commit.`

const docsPrompt = (n, m, review) => `${RULES}
Milestone ${n} "${m.name}" is implemented. Review summary: ${review.summary}
Sync documentation in ${REPO}: update CLAUDE.md (status, layout, commands, conventions and the gotchas actually in use, with the new paths); mark the plan in docs/plans as done with a short "what changed vs plan" section listing every deviation; for every deviation from SPEC §1 that survived review, add docs/adr/NNNN-<slug>.md (date, context, decision, consequences) and adjust the SPEC text in the same commit. Do not change decisions. Commit.`

// ---------------------------------------------------------------------------
// Orchestration: milestones strictly sequential, tasks in dependency waves
// ---------------------------------------------------------------------------
const report = []
let agents = 0
const run = async (prompt, opts) => { agents++; return agent(prompt, opts) }

for (const n of todo) {
  const m = MILESTONES[n]
  if (budget.total && budget.remaining() < 150_000) { log(`budget nearly spent, stopping before milestone ${n}`); break }
  log(`=== milestone ${n}: ${m.name} ===`)

  // --- Plan (Opus): plan, two critics, one revision ---
  let plan = await run(planPrompt(n, m), { ...OPUS, phase: 'Plan', label: `plan:${n}`, schema: PLAN_SCHEMA })
  if (!plan) { report.push({ milestone: n, status: 'plan-failed' }); continue }
  const critiques = (await parallel([
    () => run(critiquePrompt(n, m, plan, 'feasibility: wave layout without file overlap, port briefs complete enough for a Haiku agent, tier tagging, build-green ordering'), { ...OPUS, phase: 'Plan', label: `critic:feasibility:${n}`, schema: CRITIQUE_SCHEMA }),
    () => run(critiquePrompt(n, m, plan, 'compliance: SPEC §1 decisions, source CLAUDE.md decisions per module, byte-identical German copy, test coverage, exit criteria covered'), { ...OPUS, phase: 'Plan', label: `critic:compliance:${n}`, schema: CRITIQUE_SCHEMA }),
  ])).filter(Boolean)
  const issues = critiques.flatMap(c => c.issues).filter(i => i.severity !== 'low')
  if (critiques.some(c => !c.approved) && issues.length) {
    log(`plan ${n}: ${issues.length} issues from critics, revising`)
    const revised = await run(revisePrompt(n, m, plan, issues), { ...OPUS, phase: 'Plan', label: `revise:${n}`, schema: PLAN_SCHEMA })
    if (revised) plan = revised
  }
  const tiers = plan.tasks.reduce((acc, t) => { acc[t.tier] = (acc[t.tier] || 0) + 1; return acc }, {})
  log(`plan ${n}: ${plan.tasks.length} tasks (${JSON.stringify(tiers)}) → ${plan.plan_path}`)

  // --- Implement in dependency waves; model per task tier ---
  const results = []
  const done = new Set()
  const dead = new Set()
  const pending = plan.tasks.slice()
  const total = plan.tasks.length
  let waveNo = 0
  let aborted = null
  while (pending.length) {
    const ready = pending.filter(t => (t.deps || []).every(d => done.has(d)))
    if (!ready.length) {
      for (const t of pending) { log(`task ${t.id} skipped: deps ${JSON.stringify(t.deps || [])} not satisfied`); results.push({ task: t, impl: null, verify: null }) }
      break
    }
    const wave = ready.slice(0, MAX_PARALLEL)
    for (const t of wave) pending.splice(pending.indexOf(t), 1)
    waveNo++
    const isolated = wave.length > 1
    log(`wave ${waveNo}: ${wave.map(t => `${t.id}(${t.tier})`).join(', ')}${isolated ? ' in parallel worktrees' : ' on main'}`)

    const impls = await parallel(wave.map(task => () => run(
      implPrompt(n, m, plan, task, plan.tasks.indexOf(task), total, isolated),
      { ...modelFor(task), phase: 'Implement', label: `impl:${task.id}`, schema: IMPL_SCHEMA },
    )))
    const crashed = wave.filter((task, k) => impls[k] == null).map(t => t.id)
    if (crashed.length) {
      log(`wave ${waveNo}: agents for ${crashed.join(', ')} returned no result; aborting milestone ${n}`)
      aborted = `agents failed in wave ${waveNo}: ${crashed.join(', ')}`
      break
    }
    // A blocked result may be work that already sits on main: a read-only check before declaring it dead.
    const blockedIdx = wave.map((t, k) => k).filter(k => impls[k].status === 'blocked')
    const checks = await parallel(blockedIdx.map(k => () => run(landedPrompt(n, wave[k], impls[k]), { ...HAIKU, phase: 'Implement', label: `landed:${wave[k].id}`, schema: LANDED_SCHEMA })))
    blockedIdx.forEach((k, j) => {
      const fixed = landedImpl(impls[k], checks[j])
      if (fixed) { log(`task ${wave[k].id} reported blocked but its work is already on main (${fixed.commit}); counted done`); impls[k] = fixed }
    })
    const landed = []
    wave.forEach((task, k) => {
      const impl = impls[k]
      if (impl.status === 'blocked') { log(`task ${task.id} blocked: ${impl.notes || impl.summary}`); dead.add(task.id); results.push({ task, impl, verify: null }) }
      else landed.push({ task, impl })
    })

    const toMerge = isolated ? landed.filter(w => needsMerge(w.impl)) : []
    let merged = landed.filter(w => !toMerge.includes(w))
    if (toMerge.length) {
      const mergeRes = await run(mergePrompt(n, toMerge), { ...SONNET, phase: 'Implement', label: `merge:wave${waveNo}`, schema: MERGE_SCHEMA })
      // Merge agents sometimes decorate ids ("M0-T05 (wf/m0-m0-t05, daa4a24)"): match on the id token, not the whole string.
      const mergedIds = (mergeRes ? mergeRes.merged : []).map(s => String(s))
      const ok = new Set(toMerge.map(w => w.task.id).filter(id => mergedIds.some(s => s === id || new RegExp(`(^|[^A-Za-z0-9-])${id}([^A-Za-z0-9-]|$)`).test(s))))
      merged = merged.concat(toMerge.filter(w => ok.has(w.task.id)))
      for (const w of toMerge.filter(w => !ok.has(w.task.id))) {
        log(`task ${w.task.id}: branch ${w.impl.branch} not merged (${mergeRes ? mergeRes.summary : 'merge agent failed'})`)
        dead.add(w.task.id); results.push({ task: w.task, impl: { ...w.impl, status: 'blocked', notes: 'unmerged branch' }, verify: null })
      }
    }

    // Verify on main (Sonnet, read-only, concurrent), then sequential fix loops: Sonnet first, Opus on the last round.
    const verifies = await parallel(merged.map(w => () => run(verifyPrompt(n, w.task, w.impl), { ...SONNET, phase: 'Implement', label: `verify:${w.task.id}`, schema: VERIFY_SCHEMA })))
    for (let k = 0; k < merged.length; k++) {
      const { task, impl } = merged[k]
      let verify = verifies[k]
      let round = 0
      while (verify && !verify.pass && round < MAX_FIX) {
        round++
        const fixer = round === MAX_FIX ? OPUS : SONNET
        log(`task ${task.id}: verification failed (${verify.failures.length} failures), fix round ${round} (${fixer.model})`)
        await run(fixPrompt(n, task, verify, round), { ...fixer, phase: 'Implement', label: `fix${round}:${task.id}`, schema: IMPL_SCHEMA })
        verify = await run(verifyPrompt(n, task, impl), { ...SONNET, phase: 'Implement', label: `reverify${round}:${task.id}`, schema: VERIFY_SCHEMA })
      }
      if (verify && !verify.pass) log(`task ${task.id}: still failing after ${MAX_FIX} fix rounds; left for milestone review`)
      done.add(task.id)
      results.push({ task, impl, verify })
    }
  }
  results.sort((a, b) => plan.tasks.indexOf(a.task) - plan.tasks.indexOf(b.task))
  if (!aborted) {
    const incomplete = incompleteTasks(results)
    if (incomplete.length) aborted = `blocked/skipped tasks: ${incomplete.join(', ')}`
  }
  if (aborted) {
    report.push({ milestone: n, name: m.name, plan: plan.plan_path, status: 'aborted', reason: aborted, tasks: results.map(r => ({ id: r.task.id, tier: r.task.tier, status: r.impl ? r.impl.status : 'not run', verified: !!(r.verify && r.verify.pass), commit: r.impl ? r.impl.commit : '' })) })
    log(`milestone ${n} aborted (${aborted}); resume with resumeFromRunId after fixing the cause`)
    break
  }

  // --- Review: Haiku runs the gates, Opus judges; Harden: Sonnet fixes, Opus re-reviews, bounded ---
  let gates = await run(gatesPrompt(n), { ...HAIKU, phase: 'Review', label: `gates:${n}`, schema: GATES_SCHEMA })
  let review = await run(reviewPrompt(n, m, plan, results, gates), { ...OPUS, phase: 'Review', label: `review:${n}`, schema: REVIEW_SCHEMA })
  if (review) {
    for (let round = 1; round <= HARDEN_ROUNDS; round++) {
      const serious = review.findings.filter(f => f.severity !== 'low')
      if (!serious.length) break
      log(`review ${n}, harden round ${round}: ${serious.length} findings to fix (${review.findings.length - serious.length} low skipped)`)
      for (const f of serious) {
        await run(fixFindingPrompt(n, f), { ...SONNET, phase: 'Harden', label: `fix${round}:${f.title.slice(0, 40)}`, schema: IMPL_SCHEMA })
      }
      gates = await run(gatesPrompt(n), { ...HAIKU, phase: 'Review', label: `gates${round}:${n}`, schema: GATES_SCHEMA })
      const again = await run(reviewPrompt(n, m, plan, results, gates), { ...OPUS, phase: 'Review', label: `re-review${round}:${n}`, schema: REVIEW_SCHEMA })
      if (again) review = again
    }
    await run(docsPrompt(n, m, review), { ...SONNET, phase: 'Harden', label: `docs:${n}` })
  }

  report.push({
    milestone: n,
    name: m.name,
    plan: plan.plan_path,
    tasks: results.map(r => ({ id: r.task.id, title: r.task.title, tier: r.task.tier, status: r.impl ? r.impl.status : 'failed', verified: !!(r.verify && r.verify.pass), commit: r.impl ? r.impl.commit : '' })),
    exit_met: review ? review.exit_met : false,
    open_findings: review ? review.findings.filter(f => f.severity !== 'low').map(f => `${f.severity}: ${f.title}`) : ['review failed'],
    review_summary: review ? review.summary : '',
  })
  log(`milestone ${n} done: exit_met=${review ? review.exit_met : 'unknown'}, agents so far ${agents}`)
  if (review && !review.exit_met) { log(`stopping: milestone ${n} exit criteria not met; fix and resume`); break }
}

return { agents_used: agents, milestones: report }
