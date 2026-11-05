/**
 * The API half of the module contract (SPEC §2). A module is a directory
 * `src/modules/<id>/` whose `index.ts` exports one manifest; the core knows a module ONLY
 * through `src/modules/index.ts`, which lists the manifests as {@link ApiModule}s.
 * A module never imports from another module's directory.
 *
 * Two shapes (docs/EFFECT.md E7; plan `docs/plans/e2-api-core-services.md` P11):
 * - {@link ApiModule}, the contract the core calls: every hook is an `Effect`. A hook that
 *   writes reads its executor from the `Database` service (`src/db/database.ts`): the current
 *   executor is the transaction the core opened around the operation, or the root.
 *   Its type parameter names the services the module's own `layer` provides (E3, plan
 *   `docs/plans/e3-recipe-services.md` P3): recipe is an `ApiModule<RecipeServices>`; finance's
 *   layer is in the registry since E4-T01, its manifest becomes an `ApiModule<FinanceServices>` in E4-T07.
 * - {@link PromiseApiModule}, the Promise-based contract of M0 to M7, which the finance
 *   manifest still implements until E4 (recipe left it in E3). `fromPromiseModule`
 *   (`src/modules/adapter.ts`) turns one into an `ApiModule`; `runModuleHook` runs an Effect
 *   hook on the bare executor a Promise-based core caller holds.
 */
import type { ModuleId } from "@toon/shared";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Effect, Layer } from "effect";
import type { Hono } from "hono";
import type { AppConfig } from "../config.ts";
import type { CoreServices } from "../core/services/layer.ts";
import type { Database } from "../db/client.ts";
import type { Database as DatabaseService } from "../db/database.ts";
import type { InfraServices } from "../infra.ts";
import type { ApiErrorFamily, DatabaseError } from "../lib/errors.ts";
import type { AppEnv } from "../lib/types.ts";

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
   * Mounted at `/api/households/:householdId/<id>` after
   * `requireSession()` → `requireHouseholdRole("member")` → `requireModule(id)`.
   * Every by-id lookup here MUST be scoped by `membership.householdId` and answer 404
   * `not_found` otherwise (D8; see the header of middleware/household.ts).
   */
  householdRouter?: Hono<AppEnv>;
  /** Mounted at `/api/<id>` — user-scoped routes (e.g. recipe cards). */
  userRouter?: Hono<AppEnv>;
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
   * Runs after every `migrate()` inside `runMigrations` (db/migrate.ts), on the database just
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

/**
 * The Promise-based contract of M0 to M7, verbatim: what the finance manifest implements
 * until E4 moves it onto {@link ApiModule} (recipe moved in E3). The core never calls it
 * directly: `src/modules/index.ts` wraps it with `fromPromiseModule`.
 */
export interface PromiseApiModule {
  id: ModuleId;
  /**
   * Mounted at `/api/households/:householdId/<id>` after
   * `requireSession()` → `requireHouseholdRole("member")` → `requireModule(id)`.
   * Every by-id lookup here MUST be scoped by `membership.householdId` and answer 404
   * `not_found` otherwise (D8; see the header of middleware/household.ts).
   */
  householdRouter?: Hono<AppEnv>;
  /** Mounted at `/api/<id>` — user-scoped routes (e.g. recipe cards). */
  userRouter?: Hono<AppEnv>;
  /** The module's drizzle tables, every one prefixed `<id>_` (SPEC D7). */
  schema: Record<string, SQLiteTable>;
  /** Merged into `/api/health` `features` (e.g. recipe's `ocrImport`). */
  healthFeatures?(): Record<string, boolean>;
  /** Runs inside household creation, e.g. finance seeds its 21 categories. */
  onHouseholdCreated?(householdId: string, tx: DbExecutor): Promise<void>;
  /**
   * Runs when a household enables the module; may refuse by throwing an
   * `ApiError` (e.g. finance validates its two participants, SPEC D3).
   */
  onEnable?(householdId: string, settings: unknown, tx: DbExecutor): Promise<void>;
  /**
   * Runs inside `removeMember` (a member leaves, or an admin removes one) BEFORE the
   * `household_members` row is deleted, for EVERY build module whether or not the household
   * has it enabled (its rows outlive a disable, D2). A module that keeps rows naming the
   * member refuses by throwing an `ApiError`, e.g. finance's `409 member_has_ledger`
   * (toon-finance `removeMember`, SPEC D13): nothing is deleted then.
   */
  onMemberRemoving?(householdId: string, userId: string, tx: DbExecutor): Promise<void>;
  /**
   * Runs after every `migrate()` inside `runMigrations` (db/migrate.ts), for the
   * migrations `bun run db:migrate`, `seed` and every integration test apply. For
   * data fixes a SQL migration cannot express — recipe's fold backfill (plan M2
   * decision 4). MUST be idempotent and cheap on an up-to-date database, and must
   * not open a transaction (toon-recipe gotcha on `file::memory:` + commit).
   */
  afterMigrate?(database: Database): Promise<void>;
  /**
   * Runs once at boot (index.ts), after `await dbReady` and before the server takes
   * traffic: a module starts its background work here, e.g. finance's boot catch-up and
   * its 6-hour accrual tick (plan M3 decision 7). Never called under `bun test`. A
   * rejection is logged in English and the boot continues with the other modules.
   */
  start?(): Promise<void>;
  /**
   * Graceful teardown on SIGTERM/SIGINT (index.ts), e.g. recipe terminates its
   * long-lived OCR worker. Never called under `bun test`. Should not throw; a
   * rejection is logged and the process exits anyway.
   */
  shutdown?(): Promise<void>;
  /**
   * The module's demo content for `bun run seed`, called after the core demo user and
   * household exist. MUST be idempotent: `seed` runs again on an existing database.
   * `demoPassword` is the ONE password `scripts/seed.ts` resolved (`SEED_PASSWORD`, which
   * production requires, else `demo1234`; plan m3b decision 17): every login a module's
   * seed creates uses it, and no module keeps a password constant of its own.
   */
  seedDemo?(database: Database, context: SeedDemoContext): Promise<void>;
  /**
   * Every stored upload reference in the module's rows, as stored (bare
   * `/uploads/x.jpg`, absolute or signed — the caller normalises). `uploads:gc`
   * deletes a file only when neither the core nor any module references it
   * (core/services/media/references.ts), so a missing column here deletes a live image.
   */
  uploadReferences?(database: Database): Promise<string[]>;
}
