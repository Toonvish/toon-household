/**
 * The API half of the module contract (SPEC §2). A module is a directory
 * `src/modules/<id>/` whose `index.ts` exports one manifest; the core knows a module ONLY
 * through `src/modules/index.ts`, which lists the manifests as {@link ApiModule}s.
 * A module never imports from another module's directory.
 *
 * The contract is {@link ApiModule} (docs/EFFECT.md E7; plan `docs/plans/e2-api-core-services.md` P11):
 * every hook is an `Effect`. A hook that writes reads its executor from the `Database` service
 * (`src/db/database.ts`): the current executor is the transaction the core opened around the
 * operation, or the root. Its type parameter names the services the module's own `layer` provides
 * (E3, E4): recipe is an `ApiModule<RecipeServices>`, finance an `ApiModule<FinanceServices>`.
 * A caller outside the runtime provides `Database.layerFromExecutor(executor)` and runs the hook
 * on the bare executor it holds.
 */
import type { ModuleId } from "@toon/shared";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Effect, Layer } from "effect";
import type { HttpApi } from "effect/http-api";
import type { AppConfig } from "../config.ts";
import type { CoreServices } from "../core/services/layer.ts";
import type { Database } from "../db/client.ts";
import type { Database as DatabaseService } from "../db/database.ts";
import type { InfraServices } from "../infra.ts";
import type { ApiErrorFamily, DatabaseError } from "../lib/errors.ts";

/** The transaction handle drizzle passes to `db.transaction(async (tx) => …)`. */
export type DbTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Where a hook writes: the shared db, or the transaction the core opened around the
 * operation (household creation, module enabling) so a hook's failure rolls the
 * whole operation back. Note the toon-recipe gotcha on `file::memory:` + commit:
 * the core's `withTransaction` decides which one a hook receives.
 */
export type DbExecutor = Database | DbTransaction;

/**
 * What a hook may fail with: a member of the API error family (a refusal such as finance's
 * `422 finance_participants_required`, rendered by the one boundary mapper) or a
 * `DatabaseError` (outside the family, answered `500`). Anything else is a defect.
 */
export type HookError = ApiErrorFamily | DatabaseError;

/** Any `HttpApi` a module contributes (one per route file, each wrapping its one group; plan e7 P2, P14). */
export type AnyHttpApi = HttpApi.HttpApi<string, any>;

/**
 * A module's HTTP surface on the Effect side (docs/EFFECT.md E7, E8; plan `docs/plans/e7-http-api.md` P14, deviation
 * D7): the module's `HttpApi`s and ONE layer holding the handlers of every group they contain. `householdApi`'s APIs
 * are built with `householdModuleApi(id, …)` (prefix `/api/households/:householdId/<id>`, the chain boundary →
 * session → member → module), `userApi`'s with `userModuleApi(id, …)` (prefix `/api/<id>`, the boundary only),
 * `publicApi`'s with `publicModuleApi(id, …)` (prefix `/api/<id>`, the boundary only, below `/api/<id>/feed/`; ADR 0017).
 * `moduleRoutesLayer` (`./mount.ts`) registers them.
 *
 * The two `any`s of `handlers` are deliberate. A contract cannot name a module's group services (each group's key is
 * a service of its own), and a group handler layer's requirements are the endpoints' middleware tags plus every
 * service a handler yields as an `HttpRouter.Request<"Requires", S>` phantom, not as `S` (`HttpApiBuilder.ts`
 * `HandlerRequirements`), so `ModuleRequirements` cannot describe them either. What the types give up is checked at
 * build and by a test: `HttpApiBuilder.layer(api)` dies when a group has no handler, a service nobody provides is a
 * defect on first use, `moduleRoutesLayer` asserts the chains and the paths, and `apps/api/test/modules.test.ts` (m)
 * builds the real `API_MODULES` and serves one route of each module. `apis` is read when the routes are built, never at
 * manifest module scope (a getter over a hoisted function of the module's `routes/index.ts`; CLAUDE.md "API import
 * cycle"), and `handlers` is a `Layer.suspend` over one.
 */
export interface ModuleHttpApi {
  readonly apis: ReadonlyArray<AnyHttpApi>;
  readonly handlers: Layer.Layer<any, never, any>;
}

/** The demo context `bun run seed` hands every module's `seedDemo`. */
export interface SeedDemoContext {
  householdId: string;
  userId: string;
  demoPassword: string;
}

/**
 * What a module's own `layer` may require: the infrastructure and the core services. The runtime
 * (`src/runtime.ts` `appLayer()`) nests the modules' layers OVER the core, so a module service may
 * yield `Database`, `AppConfig`, `Uploads`, `Users`, … but never another module's service.
 */
export type ModuleRequirements = InfraServices | CoreServices;

/**
 * A module's own services (E3, E4): `Services` is what the layer outputs. Merged into the
 * runtime's `AppLayer` by `moduleLayers()` (`src/runtime.ts`), over the core services and the
 * infrastructure. A `Layer`'s output is contravariant, so a `ModuleLayer<RecipeServices>` is a
 * `ModuleLayer` (outputs `never`): the registry lists every manifest as a plain `ApiModule`.
 */
export type ModuleLayer<Services = never> = Layer.Layer<Services, never, ModuleRequirements>;

/**
 * The module contract the core calls (SPEC §2): the hooks are Effects. `Services` is what the
 * module's `layer` provides; the manifest annotates it (`ApiModule<RecipeServices>`), so a layer that
 * leaves a requirement outside {@link ModuleRequirements} open, or does not output every service it
 * names, is a `tsc` error at the manifest (plan e3 P3).
 */
export interface ApiModule<Services = never> {
  id: ModuleId;
  /**
   * The household routes as `HttpApi`s built with `householdModuleApi(id, …)`, served at
   * `/api/households/:householdId/<id>/…` behind `ApiErrorBoundary` → `RequireSession` → `RequireHouseholdMember` →
   * `RequireModule` (the API chain `householdModuleApi` attaches; `moduleRoutesLayer` asserts it at build).
   * Every by-id lookup here MUST be scoped by the membership's `householdId` (`CurrentMembership`) and answer 404
   * `not_found` otherwise (D8; see the header of middleware/household.ts).
   */
  householdApi?: ModuleHttpApi;
  /**
   * The user-scoped routes (e.g. recipe cards) as `HttpApi`s built with `userModuleApi(id, …)`, served at
   * `/api/<id>/…` behind `ApiErrorBoundary` only: the API runs `RequireSession` itself.
   */
  userApi?: ModuleHttpApi;
  /**
   * The PUBLIC routes (ADR 0017; the calendar's subscription feed) as `HttpApi`s built with `publicModuleApi(id, …)`,
   * served at `/api/<id>/feed/…` behind `ApiErrorBoundary` ONLY: no session, no cookie; the URL is the credential (a
   * capability URL like the signed `/uploads` URLs, SPEC D4). `moduleRoutesLayer` asserts at build that every endpoint
   * carries exactly `{ ApiErrorBoundary }`, is a `GET` (`HEAD` reaches it through the router's fallback) and lies below
   * `/api/<id>/feed/`, the prefix `logPathOf` redacts in every log line. A handler authenticates the URL itself and
   * answers every refusal with the same `404 not_found`.
   */
  publicApi?: ModuleHttpApi;
  /** The module's drizzle tables, every one prefixed `<id>_` (SPEC D7). */
  schema: Record<string, SQLiteTable>;
  /**
   * Merged into `/api/health` `features` (e.g. recipe's `ocrImport`), in module order after the
   * core's `verifiedEmailRequired`. An Effect over `AppConfig` (E3).
   */
  healthFeatures?(): Effect.Effect<Record<string, boolean>, never, AppConfig>;
  /**
   * The module's own services (E3: recipe's `Layer.suspend(recipeLayer)`; E4: finance's `Layer.suspend(financeLayer)`). Built
   * once into the one `AppLayer`, over the core services and the infrastructure.
   */
  layer?: ModuleLayer<Services>;
  /**
   * Runs inside household creation, e.g. finance seeds its 21 categories. The current
   * executor of `Database` is the creation's transaction.
   */
  onHouseholdCreated?(householdId: string): Effect.Effect<void, HookError, DatabaseService>;
  /**
   * Runs when a household enables the module, BEFORE the `household_modules` row is written;
   * may refuse by failing with an API error (e.g. finance validates its two participants,
   * SPEC D3). The current executor is the enabling transaction.
   */
  onEnable?(householdId: string, settings: unknown): Effect.Effect<void, HookError, DatabaseService>;
  /**
   * Runs inside `removeMember` (a member leaves, or an admin removes one) BEFORE the
   * `household_members` row is deleted, for EVERY build module whether or not the household
   * has it enabled (its rows outlive a disable, D2). A module that keeps rows naming the
   * member refuses by failing with an API error, e.g. finance's `409 member_has_ledger`
   * (toon-finance `removeMember`, SPEC D13): nothing is deleted then.
   */
  onMemberRemoving?(householdId: string, userId: string): Effect.Effect<void, HookError, DatabaseService>;
  /**
   * Runs after every `migrate()` inside `migrateDatabase` (db/migrate.ts), on the database just
   * migrated (the current executor). For data fixes a SQL migration cannot express —
   * recipe's fold backfill (plan M2 decision 4). MUST be idempotent and cheap on an
   * up-to-date database, and must not open a transaction.
   */
  afterMigrate?(): Effect.Effect<void, HookError, DatabaseService>;
  /**
   * Runs once at boot (index.ts), after `await dbReady` and before the server takes
   * traffic: a module starts its background work here, e.g. finance's boot catch-up and
   * its 6-hour accrual tick (plan M3 decision 7). Never called under `bun test`. A
   * failure is logged in English and the boot continues with the other modules.
   * Requires `Database` since E4 (plan `docs/plans/e4-finance-services.md` P3): the boot
   * catch-up reads and writes the ledger; `index.ts` runs it on the app runtime, which provides it.
   */
  start?(): Effect.Effect<void, unknown, DatabaseService>;
  /**
   * Graceful teardown on SIGTERM/SIGINT (index.ts), e.g. recipe terminates its
   * long-lived OCR worker. Never called under `bun test`. Should not fail; a failure is
   * logged and the process exits anyway.
   */
  shutdown?(): Effect.Effect<void, unknown>;
  /**
   * The module's demo content for `bun run seed`, called after the core demo user and
   * household exist, on the seeded database (the current executor). MUST be idempotent:
   * `seed` runs again on an existing database. `demoPassword` is the ONE password
   * `scripts/seed.ts` resolved (plan m3b decision 17).
   */
  seedDemo?(context: SeedDemoContext): Effect.Effect<void, HookError, DatabaseService>;
  /**
   * Every stored upload reference in the module's rows, as stored (bare
   * `/uploads/x.jpg`, absolute or signed — the caller normalises). `uploads:gc`
   * deletes a file only when neither the core nor any module references it
   * (core/services/media/references.ts), so a missing column here deletes a live image.
   */
  uploadReferences?(): Effect.Effect<string[], HookError, DatabaseService>;
}
