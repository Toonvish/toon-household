/**
 * Which files in UPLOAD_DIR are still referenced by a row — the collect half of
 * toon-recipe's `scripts/uploads-gc.ts`, split along the module boundary (plan M2
 * decision 4): the core knows its own two columns, every module reports its own
 * through the manifest's `uploadReferences` hook.
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
import type { Database } from "../../../db/client.ts";
import { households, users } from "../../../db/schema.ts";
import { normalizeStoredUploadUrl } from "../../../lib/uploadUrls.ts";
import { API_MODULES } from "../../../modules/index.ts";
import type { ApiModule } from "../../../modules/types.ts";

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

/**
 * The bare filenames every core and module row references. `modules` defaults to
 * the build's `API_MODULES`, read at call time.
 */
export async function collectUploadReferences(
  database: Database,
  modules: readonly ApiModule[] = API_MODULES,
): Promise<Set<string>> {
  const referenced = new Set<string>();
  const keep = (value: unknown): void => {
    const filename = filenameOf(value);
    if (filename !== undefined) referenced.add(filename);
  };

  for (const row of await database.select({ url: households.imageUrl }).from(households)) keep(row.url);
  for (const row of await database.select({ url: users.avatarUrl }).from(users)) keep(row.url);

  for (const module of modules) {
    for (const value of (await module.uploadReferences?.(database)) ?? []) keep(value);
  }

  return referenced;
}
