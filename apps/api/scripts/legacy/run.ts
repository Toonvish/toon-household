/**
 * `runLegacyMigration` (plan m5 M5-T08, decisions 5 to 7): one pass of the whole migration over an
 * already-open target. The order is fixed: users, households, the recipe rows, the uploads, the
 * finance rows, the placeholders' claim invites (plan m3b decision 13: the seats exist by then),
 * then the balance invariant. The CLI calls it once against its scratch copy of the
 * target (the dry pass) and, with `--apply`, once more against the real target.
 *
 * Every function of the library takes the target as a parameter and never touches the shared
 * `db`; this file adds nothing at module scope beyond imports (decision 5: the CLI imports it
 * dynamically, after its `DATABASE_URL` redirect).
 *
 * An Effect since E5 (docs/EFFECT.md E7, E10; plan `docs/plans/e5-scripts.md` P9, P10):
 * `runLegacyMigrationEffect` and `knownLegacyIds`, the Promise bridge `runLegacyMigration` at the end,
 * and `runLegacy` re-exported for the CLI. A bad `mapping` is validated through `liftTagged`, so its
 * `MappingError` is a TYPED failure (the CLI's exit 2), never a defect.
 */
import { Effect } from "effect";
import type { DatabaseError, Internal } from "../../src/lib/errors.ts";
import { verifyBalances } from "./balance.ts";
import { migrateClaimInvites } from "./claims.ts";
import { migrateFinance } from "./finance.ts";
import { migrateHouseholdsEffect } from "./households.ts";
import { type KnownIds, type MappingError, validateMappingOverride } from "./mapping.ts";
import { migrateRecipeEffect } from "./recipe.ts";
import { createReport } from "./report.ts";
import { LEGACY_SCHEMAS, readAll } from "./sources.ts";
import type {
  LegacyDb,
  MappingOverride,
  MigrationContext,
  Mode,
  Report,
  TargetDb,
  UploadOptions,
} from "./types.ts";
import { migrateUploads } from "./uploads.ts";
import { migrateUsersEffect } from "./users.ts";
import { CHUNK_SIZE, type CopyProgrammingError } from "./copy.ts";
import { legacyTry, liftTagged, runLegacy } from "./io.ts";

export { runLegacy } from "./io.ts";

export interface RunOptions {
  mode: Mode;
  recipe?: LegacyDb;
  finance?: LegacyDb;
  target: TargetDb;
  uploads: UploadOptions;
  mapping?: MappingOverride;
  /** Rows per batch; tests lower it (default {@link CHUNK_SIZE}). */
  chunkSize?: number;
  /**
   * The web origin of claim links (plan m3b decision 14). The CLI passes it to the real pass of
   * `--apply` only; a link appears in the report only in an `apply` pass that has it.
   */
  webOrigin?: string;
}

/** What a pass can fail with: a bad mapping (exit 2 in the CLI), a programming error, the target or a snapshot, a balance refusal. */
export type RunError = MappingError | CopyProgrammingError | DatabaseError | Internal;

/** Row counts of every user table of a snapshot (the `== Inputs ==` section). */
const tableCounts = Effect.fnUntraced(function* (legacy: LegacyDb): Effect.fn.Return<Record<string, number>, DatabaseError> {
  const names = yield* readAll(
    legacy,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations' ORDER BY name",
  );
  const counts: Record<string, number> = {};
  for (const row of names) {
    const name = String(row.name);
    const result = yield* legacyTry(() => legacy.client.execute(`SELECT count(*) AS n FROM "${name.replaceAll('"', '""')}"`));
    counts[name] = Number(result.rows[0]?.n ?? 0);
  }
  return counts;
});

/** The R `groups.id` and F `households.id` sets of the opened snapshots (both LEGACY ids). */
export const knownLegacyIds = Effect.fn("legacy.knownLegacyIds")(function* (
  recipe?: LegacyDb,
  finance?: LegacyDb,
): Effect.fn.Return<KnownIds, DatabaseError> {
  const groupIds = recipe ? (yield* readAll(recipe, "SELECT id FROM groups")).map((row) => String(row.id)) : [];
  const financeIds = finance ? (yield* readAll(finance, "SELECT id FROM households")).map((row) => String(row.id)) : [];
  return { groupIds: new Set(groupIds), financeIds: new Set(financeIds) };
});

/**
 * Runs the migration steps in order and returns the filled report. A bad `mapping` is refused
 * before `migrateUsers`, so an in-process caller with a raw override writes nothing either. A
 * `MappingError` fails typed (the CLI maps it to exit 2).
 */
export const runLegacyMigrationEffect = Effect.fn("legacy.runLegacyMigration")(function* (
  options: RunOptions,
): Effect.fn.Return<Report, RunError> {
  const { mode, recipe, finance, target, uploads, mapping } = options;
  const report = createReport(mode, target.url);
  const ctx: MigrationContext = {
    mode,
    target,
    ids: {
      users: { recipe: new Map(), finance: new Map() },
      households: { recipe: new Map(), finance: new Map() },
    },
    report,
    uploads,
    chunkSize: options.chunkSize ?? CHUNK_SIZE,
    ...(recipe ? { recipe } : {}),
    ...(finance ? { finance } : {}),
    ...(mapping ? { mapping } : {}),
    ...(options.webOrigin !== undefined ? { webOrigin: options.webOrigin } : {}),
  };

  for (const legacy of [recipe, finance]) {
    if (!legacy) continue;
    const schema = LEGACY_SCHEMAS[legacy.source];
    report.inputs.push({
      source: legacy.source,
      path: legacy.originalPath,
      schema: `${schema.lastTag} (${schema.migrations} migrations)`,
      tables: yield* tableCounts(legacy),
    });
  }

  if (mapping) {
    // the known ids first, then the pure validator through the lift (plan e5 P5, P10)
    const known = yield* knownLegacyIds(recipe, finance);
    yield* liftTagged(["MappingError"], () => validateMappingOverride(mapping, known));
  }

  yield* migrateUsersEffect(ctx);
  yield* migrateHouseholdsEffect(ctx);
  if (recipe) {
    yield* migrateRecipeEffect(ctx);
    // without a source directory it only adds the "uploads step is skipped" warning
    yield* migrateUploads(ctx);
  }
  if (finance) {
    yield* migrateFinance(ctx);
    yield* migrateClaimInvites(ctx);
  }
  yield* verifyBalances(ctx);
  return report;
});

/* legacy bridges: the pinned legacy-cli and legacy-placeholders tests and legacy-harness.ts; E8 removes them */

/**
 * The Promise form of {@link runLegacyMigrationEffect}; a `MappingError` rejects as that object (`exitCode` 2).
 * Callers: `apps/api/scripts/migrate-legacy.ts` (until E5-T08), `apps/api/test/legacy-cli.test.ts`,
 * `apps/api/test/legacy-placeholders.test.ts`.
 */
export function runLegacyMigration(options: RunOptions): Promise<Report> {
  return runLegacy(runLegacyMigrationEffect(options));
}
