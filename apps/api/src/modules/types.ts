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
  /** The module's part of `migrate:legacy` (SPEC §6). */
  legacyMigration?: LegacyMigrator;
}
