#!/usr/bin/env bun
/**
 * `bun run uploads:gc [--dry-run] [--min-age-hours=N]`
 *
 * Deletes files in UPLOAD_DIR that no row references any more.
 *
 * WHY THIS IS NEEDED. `deleteUpload()` runs when an import draft is discarded, but
 * nothing cleans up after (a) a recipe deleted while it had a stored hero image,
 * (b) a recipe whose image was replaced by a new upload, (c) a draft abandoned
 * forever and later cascaded away with its household. Those files stay on disk for good.
 *
 * WHAT COUNTS AS REFERENCED is collected by `collectUploadReferences()`
 * (src/core/services/media/references.ts): the core's `users.avatar_url` and
 * `households.image_url`, plus every module's `uploadReferences` hook (recipe: hero
 * images, collection covers, import scans and downloaded hero images). The full list
 * and the bare/absolute/signed normalisation live there, because missing one deletes
 * a live image.
 *
 * Generated list thumbnails (`<name>.thumb.webp`) are referenced by nothing — they
 * inherit the fate of the original they were built from, see the sweep below.
 *
 * SAFETY. Files younger than `--min-age-hours` (default 24) are always kept: an
 * upload that is mid-flight has been written to disk but is not referenced yet, and
 * a sweeper racing that window would delete the photo a user is looking at.
 */
import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { collectUploadReferences } from "../src/core/services/media/references.ts";
import { originalOfThumbnail } from "../src/core/services/media/thumbnails.ts";
import { db } from "../src/db/client.ts";
import { env } from "../src/env.ts";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const minAgeHours = readNumberFlag("--min-age-hours") ?? 24;

function readNumberFlag(name: string): number | undefined {
  const match = args.find((value) => value.startsWith(`${name}=`));
  if (match === undefined) return undefined;
  const parsed = Number.parseFloat(match.slice(name.length + 1));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

/* ------------------------------ collect refs ------------------------------ */

const referenced = await collectUploadReferences(db);

/* -------------------------------- sweep ----------------------------------- */

let entries: string[];
try {
  entries = await readdir(env.uploadDir);
} catch {
  console.log(`[uploads:gc] ${env.uploadDir} does not exist — nothing to do.`);
  process.exit(0);
}

const cutoff = Date.now() - minAgeHours * 60 * 60 * 1000;
let deleted = 0;
let freedBytes = 0;
let keptYoung = 0;

for (const entry of entries) {
  if (referenced.has(entry)) continue;
  // `<name>.thumb.webp` is a GENERATED derivative, so no row ever points at it. It
  // lives and dies with its original — treat it as referenced while that one is, and
  // let it be swept in the same pass once the original goes.
  const derivedFrom = originalOfThumbnail(entry);
  if (derivedFrom !== undefined && referenced.has(derivedFrom)) continue;
  const absolute = join(env.uploadDir, entry);
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(absolute);
  } catch {
    continue;
  }
  if (!info.isFile()) continue;
  if (info.mtimeMs > cutoff) {
    keptYoung += 1;
    continue;
  }

  if (dryRun) {
    console.log(`[uploads:gc] would delete: ${entry} (${(info.size / 1024).toFixed(0)} KB)`);
  } else {
    try {
      await unlink(absolute);
    } catch (error) {
      console.warn(`[uploads:gc] ${entry} could not be deleted:`, error);
      continue;
    }
  }
  deleted += 1;
  freedBytes += info.size;
}

console.log(
  [
    `[uploads:gc] ${entries.length} files checked,`,
    `${referenced.size} referenced,`,
    `${keptYoung} too young (< ${minAgeHours} h),`,
    `${deleted} ${dryRun ? "deletable" : "deleted"} (${(freedBytes / (1024 * 1024)).toFixed(1)} MB).`,
  ].join(" "),
);
process.exit(0);
