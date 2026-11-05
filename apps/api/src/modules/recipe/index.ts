/**
 * The recipe module's API manifest (SPEC §2): toon-recipe's recipes, tags,
 * collections, import, meal plan + cook log, shopping lists and saved cards, on
 * the `recipe_` tables of `./schema.ts`. The core reaches it only through
 * `modules/index.ts`.
 *
 * The manifest implements the Effect contract `ApiModule<RecipeServices>` directly since E3
 * (docs/EFFECT.md E7; SPEC §2; plan `docs/plans/e3-recipe-services.md` P3, P5): `layer` is
 * `Layer.suspend(recipeLayer)` (`./layer.ts`, a hoisted function, so reading it here at module
 * scope is TDZ-safe), merged by the runtime into the one `AppLayer` over the core.
 *
 * Hooks (plan M2 decision 4), each an Effect:
 * - `healthFeatures` — the two import capability flags (toon-recipe gotcha "PHOTO
 *   AND PDF IMPORT ARE TWO FEATURE FLAGS"), merged into `/api/health` `features`
 *   (`capabilityFlags` over `AppConfig`).
 * - `afterMigrate` — the fold backfill (`./migrate.ts` `foldBackfill`), idempotent, no transaction.
 * - `uploadReferences` — the recipe half of toon-recipe's `uploads:gc` collect list.
 * - `seedDemo` (`./seed.ts`, M2-T05) runs from `scripts/seed.ts`.
 * - `shutdown` — stops the OCR worker (`shutdownOcr`), called by `index.ts`'s SIGTERM/SIGINT handler.
 *
 * Routes: `householdApi` / `userApi` (docs/EFFECT.md E7, E8; SPEC §2; plan `docs/plans/e7-http-api.md` P14): the
 * `HttpApi`s and handler layers of `./routes/index.ts`, read lazily (a getter over the hoisted `recipe…Apis()`,
 * `Layer.suspend` over the hoisted `recipe…Handlers()`): this manifest is evaluated inside the API's import cycle,
 * where those route files may not be.
 */
import { Effect, Layer, Predicate } from "effect";
import { Database } from "../../db/database.ts";
import { collections, importDrafts, recipes, recipeTables } from "./schema.ts";
import { type RecipeServices, recipeLayer } from "./layer.ts";
import { foldBackfill } from "./migrate.ts";
import { recipeHouseholdApis, recipeHouseholdHandlers, recipeUserApis, recipeUserHandlers } from "./routes/index.ts";
import { seedRecipeDemo } from "./seed.ts";
import { capabilityFlags } from "./services/import/capabilities.ts";
import { shutdownOcr } from "./services/ocr/index.ts";
import type { ApiModule } from "../types.ts";

/**
 * Every upload a recipe row references, as stored (the caller normalises bare,
 * absolute and signed forms):
 *   recipe_recipes.image_url            hero images
 *   recipe_collections.cover_image_url  collection covers
 *   recipe_import_drafts.source_meta    the uploaded scan (`storedPath`)
 *   recipe_import_drafts.parsed         the hero image the URL importer downloaded
 *                                       into `parsed.imageUrl`
 * Missing one here makes `uploads:gc` delete a live image.
 */
const recipeUploadReferences = Effect.fn("RecipeModule.uploadReferences")(function* () {
  const database = yield* Database;
  const values: string[] = [];
  const add = (value: unknown): void => {
    if (Predicate.isString(value) && value.length > 0) values.push(value);
  };
  for (const row of yield* database.use((db) => db.select({ url: recipes.imageUrl }).from(recipes))) add(row.url);
  for (const row of yield* database.use((db) => db.select({ url: collections.coverImageUrl }).from(collections))) {
    add(row.url);
  }
  for (const row of yield* database.use((db) =>
    db.select({ meta: importDrafts.sourceMeta, parsed: importDrafts.parsed }).from(importDrafts),
  )) {
    add(row.meta?.storedPath);
    add(row.parsed?.imageUrl);
  }
  return values;
});

export const recipeModule: ApiModule<RecipeServices> = {
  id: "recipe",
  householdApi: {
    get apis() {
      return recipeHouseholdApis();
    },
    handlers: Layer.suspend(() => recipeHouseholdHandlers()),
  },
  userApi: {
    get apis() {
      return recipeUserApis();
    },
    handlers: Layer.suspend(() => recipeUserHandlers()),
  },
  schema: recipeTables,
  layer: Layer.suspend(recipeLayer),
  healthFeatures: () => capabilityFlags,
  afterMigrate: () => Effect.asVoid(foldBackfill()),
  uploadReferences: () => recipeUploadReferences(),
  seedDemo: (context) => seedRecipeDemo(context),
  shutdown: () => Effect.tryPromise({ try: () => shutdownOcr(), catch: (cause): unknown => cause }),
};
