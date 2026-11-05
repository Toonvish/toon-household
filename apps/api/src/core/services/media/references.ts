/**
 * Which files in UPLOAD_DIR are still referenced by a row — the collect half of
 * toon-recipe's `scripts/uploads-gc.ts`, split along the module boundary (plan M2
 * decision 4): the core knows its own two columns, every module reports its own
 * through the manifest's `uploadReferences` hook.
 *
 * The collect step is the `UploadReferences` service (docs/EFFECT.md E7; plan e2 P10, P11):
 * it reads the core columns through `Database` and runs each module's Effect
 * `uploadReferences` hook on the same current executor. `scripts/uploads-gc.ts` runs it on the
 * `AppLayer` (E5; the Promise bridge is gone, plan e5 P11).
 *
 * WHAT COUNTS AS REFERENCED — missing one deletes a live image:
 *   users.avatar_url        avatars                       (core)
 *   households.image_url    household covers              (core)
 *   module rows             each module's `uploadReferences(db)` — recipe: hero
 *                           images, collection covers, import scans and the URL
 *                           importer's downloaded hero image (the recipe manifest)
 *
 * Generated list thumbnails (`<name>.thumb.webp`) are referenced by nothing; they
 * follow their original (see `originalOfThumbnail` in ./thumbnails.ts and the sweep
 * in scripts/uploads-gc.ts).
 *
 * A stored value may be bare (`/uploads/x.jpg`), absolute (`https://…/uploads/x.jpg`)
 * or — from an older client that persisted what it was served — signed. All three
 * reduce to the same filename via normalizeStoredUploadUrl().
 *
 * A PLAIN FILENAME (`<uuid>.<ext>`, no slash) is accepted too: that is how an import
 * draft's `sourceMeta.storedPath` is stored ("relative to UPLOAD_DIR", toon-recipe
 * services/import/files.ts). toon-recipe's script only accepted `/uploads/…` values,
 * so it never counted a pending draft's scan as referenced and would sweep it after
 * `--min-age-hours`; here it is kept. Over-keeping is the safe direction for a GC.
 */
import { basename } from "node:path";
import { Context, Effect, Layer } from "effect";
import { Database } from "../../../db/database.ts";
import { households, users } from "../../../db/schema.ts";
import { normalizeStoredUploadUrl } from "../../../lib/uploadUrls.ts";
import { API_MODULES } from "../../../modules/index.ts";
import type { ApiModule, HookError } from "../../../modules/types.ts";

/** Any stored media value -> the bare filename it points at, or undefined. */
export function filenameOf(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  if (isPlainFilename(value)) return value;
  const normalized = normalizeStoredUploadUrl(value);
  if (!normalized.startsWith("/uploads/")) return undefined;
  const bare = normalized.slice("/uploads/".length);
  return bare.length > 0 && bare === basename(bare) ? bare : undefined;
}

/** `<name>.<ext>` with no path, scheme or query — a value stored relative to UPLOAD_DIR. */
function isPlainFilename(value: string): boolean {
  return !value.startsWith(".") && value === basename(value) && !/[\\/:?#]/.test(value);
}

/** The upload references of every row (plan e2 P10). */
export class UploadReferences extends Context.Service<
  UploadReferences,
  {
    /**
     * The bare filenames every core and module row references. `modules` defaults to the
     * build's `API_MODULES`, read at call time.
     */
    readonly collectUploadReferences: (modules?: readonly ApiModule[]) => Effect.Effect<Set<string>, HookError>;
  }
>()("toon/api/core/services/media/references/UploadReferences") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const database = yield* Database;

      const collectUploadReferences = Effect.fn("UploadReferences.collectUploadReferences")(function* (
        modules: readonly ApiModule[] = API_MODULES,
      ) {
        const referenced = new Set<string>();
        const keep = (value: unknown): void => {
          const filename = filenameOf(value);
          if (filename !== undefined) referenced.add(filename);
        };

        for (const row of yield* database.use((db) => db.select({ url: households.imageUrl }).from(households))) {
          keep(row.url);
        }
        for (const row of yield* database.use((db) => db.select({ url: users.avatarUrl }).from(users))) {
          keep(row.url);
        }

        for (const module of modules) {
          if (!module.uploadReferences) continue;
          for (const value of yield* module.uploadReferences().pipe(Effect.provideService(Database, database))) {
            keep(value);
          }
        }

        return referenced;
      });

      return UploadReferences.of({ collectUploadReferences });
    }),
  );
}
