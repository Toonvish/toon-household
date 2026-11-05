/**
 * Collections ("Kochbücher"): CRUD plus ordered recipe membership.
 *
 * REORDER: there is no extra endpoint — `PATCH /collections/:id` with
 * `recipeIds` is replace-all and re-numbers `position` to 0..n-1 in array order
 * inside ONE transaction, which is exactly a reorder (and also an add/remove).
 * `PUT/DELETE .../recipes/:recipeId` append/remove a single recipe.
 *
 * AS A SERVICE (docs/EFFECT.md E7, E12; plan `docs/plans/e3-recipe-services.md` P2, P8, P9, P12). `RecipeCollections`
 * reads the current executor of `Database` on every call, takes its timestamps from the `Clock`, reaches recipes
 * through `Recipes` (`loadRecipeRow`, `buildRecipeListItems`), localizes a remote cover through `RemoteImages` BEFORE
 * the transaction opens and checks ownership with `checkCanModifyOwned`. Every collection and recipe lookup filters
 * by `householdId` (D8). The Promise bridges at the end of the file keep the routes working until E3-T10.
 */
import type {
  Collection,
  CollectionDetailResponse,
  CreateCollectionRequest,
  UpdateCollectionRequest,
} from "@toon/shared";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { Clock, Context, Effect, Layer } from "effect";
import { Database } from "../../../../db/database.ts";
import { collectionRecipes, collections, recipes } from "../../../../db/schema.ts";
import type { CollectionRow } from "../../../../db/schema.ts";
import { NotFound } from "../../../../lib/errors.ts";
import type { DatabaseError, Forbidden } from "../../../../lib/errors.ts";
import type { Membership } from "../../../../lib/types.ts";
import { checkCanModifyOwned } from "../../../../core/services/households/membership.ts";
import { type DbLike, unique } from "../../../../core/services/households/support.ts";
import { runtime } from "../../../../runtime.ts";
import { toCollection } from "./mappers.ts";
import { Recipes } from "./recipes.service.ts";
import { RemoteImages } from "./remoteImage.ts";

/** The `collection_recipes` primary key as a predicate — one row, or none. */
function isMembership(collectionId: string, recipeId: string) {
  return and(eq(collectionRecipes.collectionId, collectionId), eq(collectionRecipes.recipeId, recipeId));
}

/** The household's collections: CRUD, the ordered membership and the single add/remove. */
export class RecipeCollections extends Context.Service<
  RecipeCollections,
  {
    /** All collections of a household with their recipe count — ONE grouped query. */
    readonly listCollections: (householdId: string) => Effect.Effect<Collection[], DatabaseError>;
    /** The raw collection row inside the household or a 404. */
    readonly loadCollectionRow: (
      householdId: string,
      collectionId: string,
    ) => Effect.Effect<CollectionRow, NotFound | DatabaseError>;
    /** Creates a collection, optionally pre-filled with recipes in array order. */
    readonly createCollection: (
      householdId: string,
      userId: string,
      input: CreateCollectionRequest,
    ) => Effect.Effect<Collection, NotFound | DatabaseError>;
    /** Collection + its recipes in `position` order (list shape, no children). */
    readonly getCollectionDetail: (
      householdId: string,
      collectionId: string,
    ) => Effect.Effect<CollectionDetailResponse, NotFound | DatabaseError>;
    /**
     * Updates a collection. When `recipeIds` is present it REPLACES the membership
     * and renumbers positions — this is the reorder path, one transaction.
     */
    readonly updateCollection: (
      householdId: string,
      collectionId: string,
      input: UpdateCollectionRequest,
    ) => Effect.Effect<Collection, NotFound | DatabaseError>;
    /** Deletes a collection (creator or admin+); the links cascade. */
    readonly deleteCollection: (
      membership: Membership,
      collectionId: string,
    ) => Effect.Effect<void, NotFound | Forbidden | DatabaseError>;
    /** Appends a recipe to a collection. Idempotent (PUT). */
    readonly addRecipeToCollection: (
      householdId: string,
      collectionId: string,
      recipeId: string,
    ) => Effect.Effect<void, NotFound | DatabaseError>;
    /** Removes a recipe from a collection (idempotent). */
    readonly removeRecipeFromCollection: (
      householdId: string,
      collectionId: string,
      recipeId: string,
    ) => Effect.Effect<void, NotFound | DatabaseError>;
  }
>()("toon/api/modules/recipe/services/recipes/collections.service/RecipeCollections") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const database = yield* Database;
      const recipeService = yield* Recipes;
      const images = yield* RemoteImages;

      const listCollections = Effect.fn("RecipeCollections.listCollections")(function* (householdId: string) {
        const rows = yield* database.use((db) =>
          db
            .select({ collection: collections, recipeCount: count(collectionRecipes.recipeId) })
            .from(collections)
            .leftJoin(collectionRecipes, eq(collectionRecipes.collectionId, collections.id))
            .where(eq(collections.householdId, householdId))
            .groupBy(collections.id)
            .orderBy(asc(collections.name)),
        );
        return rows.map((row) => toCollection(row.collection, Number(row.recipeCount)));
      });

      const loadCollectionRow = Effect.fn("RecipeCollections.loadCollectionRow")(function* (
        householdId: string,
        collectionId: string,
      ) {
        const [row] = yield* database.use((db) =>
          db
            .select()
            .from(collections)
            .where(and(eq(collections.id, collectionId), eq(collections.householdId, householdId)))
            .limit(1),
        );
        if (!row) return yield* new NotFound({ text: "server.recipes.collectionNotFound" });
        return row;
      });

      /** Number of recipes in one collection. */
      const collectionRecipeCount = Effect.fnUntraced(function* (collectionId: string) {
        const [row] = yield* database.use((db) =>
          db.select({ value: count() }).from(collectionRecipes).where(eq(collectionRecipes.collectionId, collectionId)),
        );
        return Number(row?.value ?? 0);
      });

      /** Rejects recipe ids that do not belong to the household (404). */
      const assertRecipesInHousehold = Effect.fnUntraced(function* (
        householdId: string,
        recipeIds: readonly string[],
      ) {
        if (recipeIds.length === 0) return;
        const rows = yield* database.use((db) =>
          db
            .select({ id: recipes.id })
            .from(recipes)
            .where(and(eq(recipes.householdId, householdId), inArray(recipes.id, [...recipeIds]))),
        );
        if (rows.length !== recipeIds.length) return yield* new NotFound({ text: "server.recipes.recipeNotFound" });
      });

      /** Writes the membership rows with contiguous positions (0..n-1). */
      const writeMembership = Effect.fnUntraced(function* (collectionId: string, recipeIds: readonly string[]) {
        yield* database.use((db) => db.delete(collectionRecipes).where(eq(collectionRecipes.collectionId, collectionId)));
        if (recipeIds.length === 0) return;
        const timestamp = yield* Clock.currentTimeMillis;
        yield* database.use((db) =>
          db.insert(collectionRecipes).values(
            recipeIds.map((recipeId, index) => ({
              collectionId,
              recipeId,
              position: index,
              addedAt: timestamp,
            })),
          ),
        );
      });

      const createCollection = Effect.fn("RecipeCollections.createCollection")(function* (
        householdId: string,
        userId: string,
        input: CreateCollectionRequest,
      ) {
        const recipeIds = unique([...input.recipeIds]);
        yield* assertRecipesInHousehold(householdId, recipeIds);

        // Bare `/uploads/<file>`, never the signed wire value (lib/uploadUrls.ts);
        // a remote cover becomes a local copy (remoteImage.ts), BEFORE the transaction opens.
        const coverImageUrl = (yield* images.localizeImageUrl(input.coverImageUrl)) ?? null;
        const timestamp = yield* Clock.currentTimeMillis;
        const row: CollectionRow = {
          id: crypto.randomUUID(),
          householdId,
          name: input.name,
          description: input.description ?? null,
          coverImageUrl,
          createdBy: userId,
          createdAt: timestamp,
          updatedAt: timestamp,
        };

        yield* database.transaction(
          Effect.gen(function* () {
            yield* database.use((db) => db.insert(collections).values(row));
            yield* writeMembership(row.id, recipeIds);
          }),
        );

        return toCollection(row, recipeIds.length);
      });

      const getCollectionDetail = Effect.fn("RecipeCollections.getCollectionDetail")(function* (
        householdId: string,
        collectionId: string,
      ) {
        const row = yield* loadCollectionRow(householdId, collectionId);
        const rows = yield* database.use((db) =>
          db
            .select({ recipe: recipes })
            .from(collectionRecipes)
            .innerJoin(recipes, eq(recipes.id, collectionRecipes.recipeId))
            .where(eq(collectionRecipes.collectionId, collectionId))
            .orderBy(asc(collectionRecipes.position), asc(collectionRecipes.addedAt)),
        );

        const items = yield* recipeService.buildRecipeListItems(rows.map((entry) => entry.recipe));
        return { collection: toCollection(row, items.length), recipes: items } satisfies CollectionDetailResponse;
      });

      const updateCollection = Effect.fn("RecipeCollections.updateCollection")(function* (
        householdId: string,
        collectionId: string,
        input: UpdateCollectionRequest,
      ) {
        const row = yield* loadCollectionRow(householdId, collectionId);

        const patch: Partial<CollectionRow> = { updatedAt: yield* Clock.currentTimeMillis };
        if (input.name !== undefined) patch.name = input.name;
        if (input.description !== undefined) patch.description = input.description ?? null;
        if (input.coverImageUrl !== undefined) {
          patch.coverImageUrl = (yield* images.localizeImageUrl(input.coverImageUrl, row.coverImageUrl)) ?? null;
        }

        const recipeIds = input.recipeIds === undefined ? undefined : unique([...input.recipeIds]);
        if (recipeIds) yield* assertRecipesInHousehold(householdId, recipeIds);

        yield* database.transaction(
          Effect.gen(function* () {
            yield* database.use((db) => db.update(collections).set(patch).where(eq(collections.id, collectionId)));
            if (recipeIds) yield* writeMembership(collectionId, recipeIds);
          }),
        );

        const total = recipeIds ? recipeIds.length : yield* collectionRecipeCount(collectionId);
        return toCollection({ ...row, ...patch }, total);
      });

      const deleteCollection = Effect.fn("RecipeCollections.deleteCollection")(function* (
        membership: Membership,
        collectionId: string,
      ) {
        const row = yield* loadCollectionRow(membership.householdId, collectionId);
        yield* checkCanModifyOwned(membership, row);
        yield* database.use((db) => db.delete(collections).where(eq(collections.id, collectionId)));
      });

      const addRecipeToCollection = Effect.fn("RecipeCollections.addRecipeToCollection")(function* (
        householdId: string,
        collectionId: string,
        recipeId: string,
      ) {
        yield* loadCollectionRow(householdId, collectionId);
        yield* recipeService.loadRecipeRow(householdId, recipeId);

        const [existing] = yield* database.use((db) =>
          db
            .select({ recipeId: collectionRecipes.recipeId })
            .from(collectionRecipes)
            .where(isMembership(collectionId, recipeId))
            .limit(1),
        );
        if (existing) return;

        const [max] = yield* database.use((db) =>
          db
            .select({ value: sql<number | null>`max(${collectionRecipes.position})` })
            .from(collectionRecipes)
            .where(eq(collectionRecipes.collectionId, collectionId)),
        );

        const addedAt = yield* Clock.currentTimeMillis;
        yield* database.use((db) =>
          db.insert(collectionRecipes).values({
            collectionId,
            recipeId,
            position: Number(max?.value ?? -1) + 1,
            addedAt,
          }),
        );
      });

      const removeRecipeFromCollection = Effect.fn("RecipeCollections.removeRecipeFromCollection")(function* (
        householdId: string,
        collectionId: string,
        recipeId: string,
      ) {
        yield* loadCollectionRow(householdId, collectionId);
        yield* database.use((db) => db.delete(collectionRecipes).where(isMembership(collectionId, recipeId)));
      });

      return RecipeCollections.of({
        listCollections,
        loadCollectionRow,
        createCollection,
        getCollectionDetail,
        updateCollection,
        deleteCollection,
        addRecipeToCollection,
        removeRecipeFromCollection,
      });
    }),
  );
}

/* legacy bridges: callers listed; E3 (recipe), E4 (finance), E5 (scripts) remove them */

// Every bridge honours its `db` argument with `Database.withExecutor(db)` (plan e3 P1). A failure rejects with the
// tagged error itself.

/** Callers: `routes/recipes.ts` (E3-T10). Promise. */
export function listCollections(db: DbLike, householdId: string): Promise<Collection[]> {
  return runtime.runPromise(
    RecipeCollections.use((s) => s.listCollections(householdId)).pipe(Database.withExecutor(db)),
  );
}

/** Callers: `routes/recipes.ts` (E3-T10). Promise. */
export function createCollection(
  db: DbLike,
  householdId: string,
  userId: string,
  input: CreateCollectionRequest,
): Promise<Collection> {
  return runtime.runPromise(
    RecipeCollections.use((s) => s.createCollection(householdId, userId, input)).pipe(Database.withExecutor(db)),
  );
}

/** Callers: `routes/recipes.ts` (E3-T10). Promise. */
export function getCollectionDetail(
  db: DbLike,
  householdId: string,
  collectionId: string,
): Promise<CollectionDetailResponse> {
  return runtime.runPromise(
    RecipeCollections.use((s) => s.getCollectionDetail(householdId, collectionId)).pipe(Database.withExecutor(db)),
  );
}

/** Callers: `routes/recipes.ts` (E3-T10). Promise. */
export function updateCollection(
  db: DbLike,
  householdId: string,
  collectionId: string,
  input: UpdateCollectionRequest,
): Promise<Collection> {
  return runtime.runPromise(
    RecipeCollections.use((s) => s.updateCollection(householdId, collectionId, input)).pipe(
      Database.withExecutor(db),
    ),
  );
}

/** Callers: `routes/recipes.ts` (E3-T10). Promise. */
export function deleteCollection(db: DbLike, membership: Membership, collectionId: string): Promise<void> {
  return runtime.runPromise(
    RecipeCollections.use((s) => s.deleteCollection(membership, collectionId)).pipe(Database.withExecutor(db)),
  );
}

/** Callers: `routes/recipes.ts` (E3-T10). Promise. */
export function addRecipeToCollection(
  db: DbLike,
  householdId: string,
  collectionId: string,
  recipeId: string,
): Promise<void> {
  return runtime.runPromise(
    RecipeCollections.use((s) => s.addRecipeToCollection(householdId, collectionId, recipeId)).pipe(
      Database.withExecutor(db),
    ),
  );
}

/** Callers: `routes/recipes.ts` (E3-T10). Promise. */
export function removeRecipeFromCollection(
  db: DbLike,
  householdId: string,
  collectionId: string,
  recipeId: string,
): Promise<void> {
  return runtime.runPromise(
    RecipeCollections.use((s) => s.removeRecipeFromCollection(householdId, collectionId, recipeId)).pipe(
      Database.withExecutor(db),
    ),
  );
}
