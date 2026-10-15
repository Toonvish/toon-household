/**
 * The uploads copy (plan m5 decision 13, SPEC §6.5).
 *
 * Every REGULAR file at the top level of `ctx.uploads.sourceDir` (originals and
 * `<name>.thumb.webp` derivatives, referenced or not) is copied to `ctx.uploads.targetDir`:
 *
 * - absent in the target: copied with `COPYFILE_EXCL` and the size verified afterwards (a
 *   mismatch is an error);
 * - present with the same size: "already present", untouched;
 * - present with another size: a conflict, an error; the target file keeps its bytes (nothing is
 *   ever overwritten).
 *
 * Sub-directories and symlinks are ignored with a warning. A filename some legacy row references
 * (the six sources of {@link collectLegacyUploadReferences}) that the source directory lacks is a
 * warning: the row is still migrated and the image 404s as it did before. With
 * `ctx.uploads.copy === false` the step only plans (`wouldCopy`) and never touches the target
 * directory, not even to create it. Files are not ledger rows; their idempotency is "exists with
 * the same size".
 *
 * The target directory is whatever the caller resolved (the CLI's own `UPLOAD_DIR`, a temp
 * directory in tests); this file never reads `env.ts`.
 */
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { readAll } from "./sources.ts";
import type { LegacyDb, MigrationContext, UploadSummary } from "./types.ts";
import { filenameOf } from "../../src/core/services/media/references.ts";

function parseJson(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The bare filenames the recipe snapshot references: `users.avatar_url`, `groups.image_url`,
 * `recipes.image_url`, `collections.cover_image_url`, `import_drafts.source_meta.storedPath` (a
 * plain filename) and `import_drafts.parsed.imageUrl`. Signed and absolute URLs reduce to the
 * filename; external URLs reference nothing.
 */
export async function collectLegacyUploadReferences(recipe: Pick<LegacyDb, "client">): Promise<Set<string>> {
  const referenced = new Set<string>();
  const keep = (value: unknown): void => {
    const filename = filenameOf(value);
    if (filename !== undefined) referenced.add(filename);
  };
  for (const [table, column] of [
    ["users", "avatar_url"],
    ["groups", "image_url"],
    ["recipes", "image_url"],
    ["collections", "cover_image_url"],
  ] as const) {
    for (const row of await readAll(recipe, `SELECT ${column} FROM ${table}`)) keep(row[column]);
  }
  for (const row of await readAll(recipe, "SELECT source_meta, parsed FROM import_drafts")) {
    keep(parseJson(row.source_meta)?.storedPath);
    keep(parseJson(row.parsed)?.imageUrl);
  }
  return referenced;
}

/** Size of a regular file, `null` when absent, `"other"` when something else sits there. */
async function targetState(path: string): Promise<number | null | "other"> {
  try {
    const info = await lstat(path);
    return info.isFile() ? info.size : "other";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Copies (or, with `copy: false`, plans) the recipe uploads and fills `ctx.report.uploads`.
 * Without a recipe source or a `sourceDir` there is nothing to do: a warning, no summary.
 */
export async function migrateUploads(ctx: MigrationContext): Promise<UploadSummary | undefined> {
  const { report } = ctx;
  const { sourceDir, targetDir, copy } = ctx.uploads;
  if (!ctx.recipe) return undefined;
  if (sourceDir === undefined) {
    report.warnings.push("no recipe uploads directory given: the uploads step is skipped (images will 404)");
    return undefined;
  }

  const summary: UploadSummary = {
    sourceFiles: 0,
    copied: 0,
    wouldCopy: 0,
    alreadyPresent: 0,
    bytesCopied: 0,
    conflicts: [],
    missingReferenced: [],
    ignoredEntries: [],
  };
  report.uploads = summary;

  const entries = (await readdir(sourceDir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1));
  const present = new Set<string>();
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isFile()) {
      files.push(entry.name);
      present.add(entry.name);
    } else {
      summary.ignoredEntries.push(entry.name);
      report.warnings.push(
        `uploads: ignored ${entry.isSymbolicLink() ? "symlink" : entry.isDirectory() ? "directory" : "entry"} ${entry.name} (only regular top-level files are copied)`,
      );
    }
  }
  summary.sourceFiles = files.length;

  const referenced = await collectLegacyUploadReferences(ctx.recipe);
  for (const name of [...referenced].sort()) {
    if (present.has(name)) continue;
    summary.missingReferenced.push(name);
    report.warnings.push(`uploads: ${name} is referenced by a legacy row but missing in ${sourceDir}`);
  }

  if (copy) await mkdir(targetDir, { recursive: true });
  for (const name of files) {
    const from = join(sourceDir, name);
    const to = join(targetDir, name);
    const sourceSize = (await lstat(from)).size;
    const conflict = (detail: string): void => {
      summary.conflicts.push(name);
      report.errors.push(`uploads: ${name} ${detail}; the target file was kept`);
    };
    let state = await targetState(to);
    if (state === null && copy) {
      try {
        await copyFile(from, to, constants.COPYFILE_EXCL);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
          report.errors.push(`uploads: copying ${name} failed: ${message(error)}`);
          continue;
        }
        state = await targetState(to); // somebody created it between the stat and the copy
      }
      if (state === null) {
        const written = await targetState(to);
        if (written !== sourceSize) {
          report.errors.push(`uploads: ${name} was copied but its size is ${String(written)}, expected ${sourceSize}`);
          continue;
        }
        summary.copied += 1;
        summary.bytesCopied += sourceSize;
        continue;
      }
    }
    if (state === null) {
      summary.wouldCopy += 1;
    } else if (state === "other") {
      conflict("exists in the target and is not a regular file");
    } else if (state === sourceSize) {
      summary.alreadyPresent += 1;
    } else {
      conflict(`exists in the target with ${state} bytes, the source has ${sourceSize}`);
    }
  }
  return summary;
}
