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
import { Console, Effect } from "effect";
import { Database } from "../src/db/database.ts";
import { collections, recipes } from "../src/db/schema.ts";
import { isRemoteImageUrl, RemoteImages } from "../src/modules/recipe/services/recipes/remoteImage.ts";
import { AppLayer } from "../src/runtime.ts";
import { runScript } from "./support/main.ts";

interface RemoteRow {
  readonly id: string;
  readonly url: string;
}

/** The whole script as one program on the `AppLayer` (plan e5 P1, P2). */
const program = Effect.gen(function* () {
  const dryRun = process.argv.slice(2).includes("--dry-run");
  const database = yield* Database;
  const remoteImages = yield* RemoteImages;

  const remoteRecipes = (yield* database.use((db) =>
    db
      .select({ id: recipes.id, url: recipes.imageUrl })
      .from(recipes)
      .where(or(like(recipes.imageUrl, "http%"), like(recipes.imageUrl, "data:%"))),
  )).filter((row): row is RemoteRow => row.url !== null && isRemoteImageUrl(row.url));

  const remoteCovers = (yield* database.use((db) =>
    db
      .select({ id: collections.id, url: collections.coverImageUrl })
      .from(collections)
      .where(or(like(collections.coverImageUrl, "http%"), like(collections.coverImageUrl, "data:%"))),
  )).filter((row): row is RemoteRow => row.url !== null && isRemoteImageUrl(row.url));

  yield* Console.log(
    `[recipe:localize-images] ${remoteRecipes.length} recipe image(s), ${remoteCovers.length} collection cover(s) still remote${dryRun ? " (dry run)" : ""}.`,
  );
  if (dryRun) {
    for (const row of remoteRecipes) yield* Console.log(`  recipe ${row.id}  ${row.url.slice(0, 120)}`);
    for (const row of remoteCovers) yield* Console.log(`  collection ${row.id}  ${row.url.slice(0, 120)}`);
    return 0;
  }

  let copied = 0;
  const failed: string[] = [];

  for (const row of remoteRecipes) {
    const local = yield* remoteImages.localizeImageUrl(row.url);
    if (typeof local === "string" && local !== row.url) {
      yield* database.use((db) =>
        db
          .update(recipes)
          .set({ imageUrl: local })
          .where(and(eq(recipes.id, row.id), eq(recipes.imageUrl, row.url))),
      );
      copied += 1;
    } else {
      failed.push(`recipe ${row.id}  ${row.url.slice(0, 120)}`);
    }
  }

  for (const row of remoteCovers) {
    const local = yield* remoteImages.localizeImageUrl(row.url);
    if (typeof local === "string" && local !== row.url) {
      yield* database.use((db) =>
        db
          .update(collections)
          .set({ coverImageUrl: local })
          .where(and(eq(collections.id, row.id), eq(collections.coverImageUrl, row.url))),
      );
      copied += 1;
    } else {
      failed.push(`collection ${row.id}  ${row.url.slice(0, 120)}`);
    }
  }

  yield* Console.log(`[recipe:localize-images] ${copied} copied, ${failed.length} not reachable (kept remote).`);
  for (const line of failed) yield* Console.log(`  ${line}`);
  return 0;
});

if (import.meta.main) {
  runScript(program.pipe(Effect.provide(AppLayer)));
}
