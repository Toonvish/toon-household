# 0012: Effect is the application framework (records E1–E12; amends the wording of D10)

Date: 2026-10-16

## Context

On 2026-10-16 the owner decided to move toon-household onto Effect 4: `Schema` for every contract, services and
layers for every piece of fallible or effectful code, a managed runtime on both sides of the wire and, last,
Effect's own HTTP server in place of Hono. `docs/EFFECT.md` is the spec of that migration (decisions E1–E12,
the milestones E0–E8, the gates). Its guiding sentence is that the migration changes how the code is written,
not what it does: every `docs/API.md` row, every German string, every DB table and migration, every exit code
and output line a doc or test pins, and every fixed decision of `docs/SPEC.md` survives. SPEC D1–D15 stay in
force, and SPEC §1 asks that a decision which touches them is recorded in an ADR. This ADR records E1–E12 as
that framework decision, says how each D-decision it touches stands under Effect, and amends the SPEC wording
only where a D-decision names Zod.

## Decision

Effect 4 is the application framework. The twelve decisions of `docs/EFFECT.md` §1 are fixed; each is restated
here in one or two sentences, with no new rule (the text in `docs/EFFECT.md` is the one to read).

- **E1** — `effect@4.0.5` and `@effect/platform-bun` at the same exact version, pinned without `^`; never a v3
  package, never an `effect/unstable/*` path; `@effect/sql-libsql` is not installed and `@effect/vitest` is not
  used.
- **E2** — The Effect source is vendored as a read-only, squashed `git subtree` in `repos/effect` at the release
  tag of the installed version and is the documentation agents learn from; it is fenced off from test
  discovery, the image, the editor and Vite's watcher, and nothing imports from it.
- **E3** — The migration goes inside out, one layer per milestone, and preserves behaviour; pure functions stay
  pure, and Effect wraps only what is fallible, asynchronous, resourceful or dependent.
- **E4** — Effect `Schema` replaces Zod as the contract in `packages/shared`; the validation error envelope
  keeps its wire shape and the catalog's wording (`server.validation.*`, ADR 0002), and `zod` and
  `@hono/zod-validator` leave the `package.json` files at the end of E1.
- **E5** — Drizzle stays the schema and migration source (SPEC D7 untouched); the connection becomes a scoped
  `Database` service that sends the D7 pragmas, exposes `use` and `transaction`, and is closed by the runtime's
  scope.
- **E6** — Errors become a family of `Schema.TaggedError` classes carrying `status`, `code` and `text`, declared
  in service signatures and mapped once at the HTTP boundary; defects answer the same `500 internal_error`.
- **E7** — Every core and module service is a `Context.Service` with a static `layer`, cross-cutting
  dependencies (`AppConfig`, `Database`, `Mailer`, `Uploads`, `Clock`/`DateTime`, `RateLimiter`,
  `OAuthProviders`) are services too, `ApiModule` hooks become Effects, and one `ManagedRuntime` is built at
  boot.
- **E8** — Hono goes last: the E7 milestone replaces it with `effect/http-api` served by `BunHttpServer` with
  the observable contract, the middleware order and the module contract's shape frozen; the tree after E6 is a
  supported stopping point.
- **E9** — `bun test` stays; Effect tests run through layers with a support module
  (`apps/api/test/support/effect.ts`), rewritten tests replace the old ones in the same commit, and the pass
  count never drops below the previous milestone's record.
- **E10** — Scripts become Effect programs on `BunRuntime.runMain` with the same CLI surface, exit codes and
  output lines; `migrate-legacy.ts` keeps its import-order discipline.
- **E11** — The web gets one `ManagedRuntime` and an Effect `HttpClient` API layer decoded with the shared
  `Schema`; TanStack Query, the persisted cache and the outboxes stay (SPEC D9), and `@effect/atom-react` is an
  owner decision for later.
- **E12** — The Effect idioms of `repos/effect/LLMS.md` are a gate, pinned as far as grep can see by
  `apps/api/test/effect-idioms.test.ts`; a rule is never relaxed to get green.

How the SPEC decisions that Effect touches stand:

| SPEC decision | Status under Effect |
| --- | --- |
| D4 — auth | Unchanged: argon2id via `Bun.password`, OAuth linking, the confirmation gate, signed uploads. E7 turns them into services (`OAuthProviders`, `RateLimiter`, `Uploads`). |
| D7 — database | Unchanged: the drizzle schema and migrations, WAL + `synchronous = FULL`, the busy timeout. E5 makes the connection a scoped `Database` service. |
| D8 — API | Unchanged: paths, error envelope, codes, middleware names and order. E6 maps errors once; E8 moves the chain to `HttpApiMiddleware` with the same names and order at E7. |
| D9 — web | Unchanged: TanStack Query, the persisted cache, the outboxes, `PERSIST_BUSTER`. E11 changes only the fetch layer; `@effect/atom-react` is an owner decision (`docs/open-work.md`). |
| D10 — i18n | Unchanged rule. After E1 the generic validation messages come from Effect `Schema` and keep the core's wording (E4, ADR 0002); the catalog keys `server.zod.*` and `server.validation.*` keep their names. |

## Consequences

- `docs/SPEC.md` is edited in this commit, and only twice. D10's ADR 0002 sentence now reads "finance's
  generic validation messages (Zod's in toon-finance, Effect `Schema`'s here from milestone E1 of
  `docs/EFFECT.md` on, ADR 0012)", and a new paragraph after the §1 preamble says that Effect 4 is the
  application framework underneath these decisions and changes none of them. The catalog key names are
  identifiers and are not renamed.
- SPEC §2's `Hono` interface and the intro's "Bun.serve + Hono" stack sentence stay as they are until E7
  rewrites §2 in its own commit (`docs/EFFECT.md` E8), because Hono is still the server until then.
- A deviation from E1–E12 follows the SPEC §1 rule: the smallest possible one, recorded in the plan and in a
  new ADR that edits the `docs/EFFECT.md` text in the same commit.
