/**
 * The API half of the module contract (SPEC §2). A module is a directory
 * `src/modules/<id>/` whose `index.ts` exports one {@link ApiModule}; the core
 * knows a module ONLY through `src/modules/index.ts`, which lists the manifests.
 * A module never imports from another module's directory.
 */
import type { ModuleId } from "@toon/shared";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Hono } from "hono";
import type { Database } from "../db/client.ts";
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
 * A module's part of `bun run migrate:legacy` (SPEC D12, §6). PLACEHOLDER: M5
 * defines the real shape (legacy client, household/user id maps, the
 * `legacy_ids` ledger, dry-run report). Declared now so a manifest can be typed
 * against it without M5 having to touch every module's `index.ts` twice.
 */
export interface LegacyMigrator {
  /** The legacy source this migrator reads, e.g. "recipe" or "finance". */
  readonly source: string;
}

export interface ApiModule {
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
  /** The module's part of `migrate:legacy` (SPEC §6). */
  legacyMigration?: LegacyMigrator;
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
   */
  seedDemo?(database: Database, context: { householdId: string; userId: string }): Promise<void>;
  /**
   * Every stored upload reference in the module's rows, as stored (bare
   * `/uploads/x.jpg`, absolute or signed — the caller normalises). `uploads:gc`
   * deletes a file only when neither the core nor any module references it
   * (core/services/media/references.ts), so a missing column here deletes a live image.
   */
  uploadReferences?(database: Database): Promise<string[]>;
}
