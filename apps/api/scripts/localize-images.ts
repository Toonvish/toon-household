#!/usr/bin/env bun
/**
 * `bun run recipe:localize-images [--dry-run]`
 *
 * Replaces every remote recipe hero image and collection cover (`http(s):` or
 * `data:image/` in `recipe_recipes.image_url` / `recipe_collections.cover_image_url`)
 * with a local copy in UPLOAD_DIR.
 *
 * WHY. Since the write paths localize remote images (src/modules/recipe/services/
 * recipes/remoteImage.ts), new rows never keep one; rows written before still point
 * at the source site and lose their picture when it goes. This is the one-off
 * catch-up for those rows; running it again only retries the ones still remote.
 *
 * Best-effort per row, like the write paths: an image that cannot be downloaded (gone,
 * not an image, too large, private host) keeps its remote URL and is listed. A row is
 * only updated while it still holds the URL that was downloaded, so an edit made
 * meanwhile wins; `updated_at` is left alone (not a user edit). `--dry-run` lists
 * the remote rows and downloads nothing.
 */
import { and, eq, like, or } from "drizzle-orm";
import { db } from "../src/db/client.ts";
import { collections, recipes } from "../src/db/schema.ts";
import { isRemoteImageUrl, localizeImageUrl } from "../src/modules/recipe/services/recipes/remoteImage.ts";

const dryRun = process.argv.slice(2).includes("--dry-run");

const remoteRecipes = (
  await db
    .select({ id: recipes.id, url: recipes.imageUrl })
    .from(recipes)
    .where(or(like(recipes.imageUrl, "http%"), like(recipes.imageUrl, "data:%")))
).filter((row): row is { id: string; url: string } => row.url !== null && isRemoteImageUrl(row.url));

const remoteCovers = (
  await db
    .select({ id: collections.id, url: collections.coverImageUrl })
    .from(collections)
    .where(or(like(collections.coverImageUrl, "http%"), like(collections.coverImageUrl, "data:%")))
).filter((row): row is { id: string; url: string } => row.url !== null && isRemoteImageUrl(row.url));

console.log(
  `[recipe:localize-images] ${remoteRecipes.length} recipe image(s), ${remoteCovers.length} collection cover(s) still remote${dryRun ? " (dry run)" : ""}.`,
);
if (dryRun) {
  for (const row of remoteRecipes) console.log(`  recipe ${row.id}  ${row.url.slice(0, 120)}`);
  for (const row of remoteCovers) console.log(`  collection ${row.id}  ${row.url.slice(0, 120)}`);
  process.exit(0);
}

let copied = 0;
const failed: string[] = [];

for (const row of remoteRecipes) {
  const local = await localizeImageUrl(row.url);
  if (typeof local === "string" && local !== row.url) {
    await db
      .update(recipes)
      .set({ imageUrl: local })
      .where(and(eq(recipes.id, row.id), eq(recipes.imageUrl, row.url)));
    copied += 1;
  } else {
    failed.push(`recipe ${row.id}  ${row.url.slice(0, 120)}`);
  }
}

for (const row of remoteCovers) {
  const local = await localizeImageUrl(row.url);
  if (typeof local === "string" && local !== row.url) {
    await db
      .update(collections)
      .set({ coverImageUrl: local })
      .where(and(eq(collections.id, row.id), eq(collections.coverImageUrl, row.url)));
    copied += 1;
  } else {
    failed.push(`collection ${row.id}  ${row.url.slice(0, 120)}`);
  }
}

console.log(`[recipe:localize-images] ${copied} copied, ${failed.length} not reachable (kept remote).`);
for (const line of failed) console.log(`  ${line}`);
process.exit(0);
