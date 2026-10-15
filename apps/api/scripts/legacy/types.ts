/**
 * The types of the `migrate:legacy` library (plan m5 §1.6). Every step of the migration
 * (users, households, recipe, finance, uploads, balance) imports them; later tasks import,
 * never edit.
 *
 * `Database` is imported as a TYPE only: the CLI must not load `src/db/client.ts` (which opens
 * the shared client at `env.DATABASE_URL`) before it has redirected `DATABASE_URL` to its
 * scratch copy (plan m5 decision 5).
 */
import type { Client, InStatement, Value } from "@libsql/client";
import type { Database } from "../../src/db/client.ts"; // import type ONLY (decision 5)

export type LegacySource = "recipe" | "finance";
export type Mode = "dry-run" | "apply";
export type Row = Record<string, Value>; // a legacy row, SQL column names
export interface LegacyDb {
  source: LegacySource;
  client: Client;
  originalPath: string;
  snapshotPath: string;
}
export interface TargetDb {
  db: Database;
  client: Client;
  url: string;
}
export interface IdMaps {
  users: Record<LegacySource, Map<string, string>>; // legacy user id -> target user id
  households: Record<LegacySource, Map<string, string>>; // R group id / F household id -> target household id
}
export type MappingOverride = Record<string, string | "new">; // F household id -> R group id | "new"
export interface UploadOptions {
  sourceDir?: string;
  targetDir: string;
  copy: boolean; // copy=false: plan only
}
export interface MigrationContext {
  mode: Mode; // which pass this is (the CLI's dry pass of an --apply run is "dry-run")
  recipe?: LegacyDb;
  finance?: LegacyDb;
  target: TargetDb;
  ids: IdMaps;
  report: Report;
  uploads: UploadOptions;
  mapping?: MappingOverride;
  chunkSize: number; // CHUNK_SIZE = 500 (SPEC §6.5); tests may lower it
  /**
   * The web origin claim links are built on (`<webOrigin>/invite/<token>`, plan m3b decision 14):
   * the first `WEB_ORIGIN` entry. The CLI passes it to the REAL pass of `--apply` only; without it,
   * or in a dry-run pass, no link is ever put into the report.
   */
  webOrigin?: string;
}
export interface TableCount {
  table: string;
  source: LegacySource;
  read: number;
  written: number;
  alreadyMigrated: number;
  skipped: number;
}
export interface SkippedRow {
  table: string;
  source: LegacySource;
  legacyId: string;
  reason: string;
  error: boolean;
}
export interface NotMigrated {
  table: string;
  source: LegacySource;
  rows: number;
  reason: string;
}
export interface UserCollision {
  email: string;
  recipeUserId: string;
  financeUserId: string;
  targetUserId: string;
  passwordFrom: "recipe" | "none";
  note?: string;
}
export type DecisionReason =
  | "only-group"
  | "most-recipes"
  | "tie-oldest"
  | "group-taken"
  | "no-group"
  | "mapping"
  | "no-members"
  /** Every member is a placeholder and no `--mapping` names a group: an error (plan m3b decision 13). */
  | "no-account-members"
  | "already-migrated";
export interface HouseholdDecision {
  financeHouseholdId: string;
  financeName: string;
  memberEmails: string[]; // a placeholder reads `placeholder <F user id>` (it has no address)
  decision: "merge" | "new" | "skip";
  targetHouseholdId?: string;
  targetName?: string;
  reason: DecisionReason;
  addMembers: string[]; // e-mails added to a mapped group
}
export interface UploadSummary {
  sourceFiles: number;
  copied: number;
  wouldCopy: number;
  alreadyPresent: number;
  bytesCopied: number;
  conflicts: string[];
  missingReferenced: string[];
  ignoredEntries: string[];
}
export interface BalanceCheck {
  financeHouseholdId: string;
  targetHouseholdId: string;
  name: string;
  slot1Email: string;
  legacyBalanceCents: number;
  migratedBalanceCents: number;
  legacyTransactionCount: number;
  migratedTransactionCount: number;
  legacyAmountSumCents: number;
  migratedAmountSumCents: number;
  slot1Matches: boolean;
  ok: boolean;
}
/**
 * What happened to a placeholder's claim invite (plan m3b decision 14): `would-*` in a dry-run
 * pass, `created` / `reused` in an apply pass, `already-migrated` when the ledger holds
 * `claim:<F user id>`; `no-household` when none of its finance households landed (the households
 * step reported why), `failed` when the insert failed (an error in the report).
 */
export type ClaimInviteState =
  | "would-create"
  | "would-reuse"
  | "created"
  | "reused"
  | "already-migrated"
  | "no-household"
  | "failed";
/** One migrated toon-finance placeholder and its claim invite (`== Placeholders and claim invites ==`). */
export interface PlaceholderEntry {
  financeUserId: string;
  targetUserId: string;
  financeHouseholdId: string | null;
  targetHouseholdId: string | null;
  /** The placeholder's finance slot in that household (as copied to `finance_participants`). */
  slot: number | null;
  claimInvite: ClaimInviteState;
  /** The target `household_invites.id` of the claim invite. */
  inviteId?: string;
  /**
   * `<webOrigin>/invite/<token>`: ONLY in an apply pass with a web origin, and only while the invite
   * is pending and unexpired. A live claim link is a credential (whoever holds it becomes this
   * person), so the report holding it must stay outside any repository.
   */
  inviteUrl?: string;
}
export interface Report {
  mode: Mode;
  target: string;
  inputs: { source: LegacySource; path: string; schema: string; tables: Record<string, number> }[];
  decisions: HouseholdDecision[];
  users: {
    recipe: number;
    finance: number;
    /** Finance users without an account (`password_hash IS NULL`), migrated as placeholders (ADR 0006). */
    placeholders: number;
    target: number;
    collisions: UserCollision[];
  };
  counts: TableCount[];
  skipped: SkippedRow[];
  notMigrated: NotMigrated[];
  uploads?: UploadSummary;
  balances: BalanceCheck[];
  /** toon-finance placeholders and their claim invites (plan m3b decisions 13 and 14, ADR 0006). */
  placeholders: PlaceholderEntry[];
  warnings: string[];
  errors: string[];
}
