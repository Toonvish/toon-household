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
 */
import { verifyBalances } from "./balance.ts";
import { migrateClaimInvites } from "./claims.ts";
import { migrateFinance } from "./finance.ts";
import { migrateHouseholds } from "./households.ts";
import { type KnownIds, validateMappingOverride } from "./mapping.ts";
import { migrateRecipe } from "./recipe.ts";
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
import { migrateUsers } from "./users.ts";
import { CHUNK_SIZE } from "./copy.ts";

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

/** Row counts of every user table of a snapshot (the `== Inputs ==` section). */
async function tableCounts(legacy: LegacyDb): Promise<Record<string, number>> {
  const names = await readAll(
    legacy,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations' ORDER BY name",
  );
  const counts: Record<string, number> = {};
  for (const row of names) {
    const name = String(row.name);
    const result = await legacy.client.execute(`SELECT count(*) AS n FROM "${name.replaceAll('"', '""')}"`);
    counts[name] = Number(result.rows[0]?.n ?? 0);
  }
  return counts;
}

/** The R `groups.id` and F `households.id` sets of the opened snapshots (both LEGACY ids). */
export async function knownLegacyIds(recipe?: LegacyDb, finance?: LegacyDb): Promise<KnownIds> {
  const ids = async (legacy: LegacyDb | undefined, table: "groups" | "households") =>
    new Set(legacy ? (await readAll(legacy, `SELECT id FROM ${table}`)).map((row) => String(row.id)) : []);
  return { groupIds: await ids(recipe, "groups"), financeIds: await ids(finance, "households") };
}

/**
 * Runs the migration steps in order and returns the filled report. A bad `mapping` is refused
 * before `migrateUsers`, so an in-process caller with a raw override writes nothing either. A
 * `MappingError` or `LegacyInputError` propagates (the CLI maps both to exit 2).
 */
export async function runLegacyMigration(options: RunOptions): Promise<Report> {
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
      tables: await tableCounts(legacy),
    });
  }

  if (mapping) validateMappingOverride(mapping, await knownLegacyIds(recipe, finance));

  await migrateUsers(ctx);
  await migrateHouseholds(ctx);
  if (recipe) {
    await migrateRecipe(ctx);
    // without a source directory it only adds the "uploads step is skipped" warning
    await migrateUploads(ctx);
  }
  if (finance) {
    await migrateFinance(ctx);
    await migrateClaimInvites(ctx);
  }
  await verifyBalances(ctx);
  return report;
}
