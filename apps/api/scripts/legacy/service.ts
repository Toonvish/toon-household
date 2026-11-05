/**
 * `LegacyMigration`: the one service of the `migrate:legacy` library (docs/EFFECT.md E7, E10; plan
 * `docs/plans/e5-scripts.md` P9, deviation 10). The steps stay `Effect.fn` functions over the explicit
 * `MigrationContext`; the service is the CLI's door to them:
 *
 * - `open(source, path, scratchDir)`: snapshots and opens a legacy database (`openLegacyEffect`) as a SCOPED
 *   resource, its client closed when the caller's scope closes (the CLI's legacy clients close with its scope).
 * - `knownLegacyIds(recipe?, finance?)`: the legacy group and household ids a mapping file may name.
 * - `run(options)`: one pass of the whole migration (`runLegacyMigrationEffect`); a bad mapping fails with
 *   `MappingError` in the typed channel, so the CLI's `Effect.catchTags` maps it to exit 2.
 *
 * Import order (CLAUDE.md "The CLI never imports `src/env.ts`, and its import order is load-bearing", "One
 * composition point"): the static `layer` reads no imported binding at class evaluation. `Layer.sync` takes a
 * thunk that reads the step functions only when the layer is built, after every import has settled. This file
 * never imports `src/runtime.ts`, and nothing in the library yields `Database` from the ambient context: the
 * recipe backfill and the finance balance are built from the target the caller hands in.
 */
import { Context, Effect, Layer, type Scope } from "effect";
import type { DatabaseError } from "../../src/lib/errors.ts";
import type { KnownIds } from "./mapping.ts";
import { knownLegacyIds, type RunError, type RunOptions, runLegacyMigrationEffect } from "./run.ts";
import { type LegacyInputError, openLegacyEffect } from "./sources.ts";
import type { LegacyDb, LegacySource, Report } from "./types.ts";

/** The `migrate:legacy` library behind one service (plan e5 P9). */
export class LegacyMigration extends Context.Service<
  LegacyMigration,
  {
    /** Snapshots and opens a legacy database; its client is closed when the scope closes. */
    readonly open: (
      source: LegacySource,
      path: string,
      scratchDir: string,
    ) => Effect.Effect<LegacyDb, LegacyInputError | DatabaseError, Scope.Scope>;
    /** The R `groups.id` and F `households.id` sets of the opened snapshots (both LEGACY ids). */
    readonly knownLegacyIds: (recipe?: LegacyDb, finance?: LegacyDb) => Effect.Effect<KnownIds, DatabaseError>;
    /** One pass of the migration over an already-open target; returns the filled report. */
    readonly run: (options: RunOptions) => Effect.Effect<Report, RunError>;
  }
>()("toon/api/scripts/legacy/service/LegacyMigration") {
  static readonly layer = Layer.sync(this, () =>
    LegacyMigration.of({
      open: Effect.fn("LegacyMigration.open")(function* (source: LegacySource, path: string, scratchDir: string) {
        return yield* Effect.acquireRelease(openLegacyEffect(source, path, scratchDir), (legacy) =>
          Effect.sync(() => legacy.client.close()),
        );
      }),
      knownLegacyIds,
      run: runLegacyMigrationEffect,
    }),
  );
}
