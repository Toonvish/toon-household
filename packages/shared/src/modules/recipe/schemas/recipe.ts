import { Effect, Option, Schema, SchemaGetter, type Types } from "effect";
import {
  Bool,
  CoercedInt,
  CoercedNum,
  Enum,
  Int,
  Num,
  Str,
  keyed,
  max,
  maxItems,
  maxLength,
  min,
  minLength,
  nonnegative,
  partial,
  positive,
  regex,
  trim,
} from "../../../core/schemas/checks.ts";
import { HttpUrlSchema, IdSchema, IsoDateSchema, listResponse } from "../../../core/schemas/common.ts";
import { PublicUserSchema } from "../../../core/schemas/user.ts";

export const DifficultySchema = Enum(["einfach", "mittel", "schwer"]);
export type Difficulty = Types.DeepMutable<typeof DifficultySchema.Type>;

/**
 * One ingredient line. This is the CONTRACT shape: it is what `parseIngredientLine`
 * returns, what the import draft carries, and what create/update requests accept.
 * Persisted rows additionally carry `id`/`recipeId` (see RecipeIngredientRecordSchema).
 *
 * `raw` always holds the original, unmodified source line so nothing is ever lost.
 * `quantityMax` is set only for ranges ("2-3 Eier" => quantity 2, quantityMax 3).
 */
export const RecipeIngredientSchema = Schema.Struct({
  position: Int.check(nonnegative()),
  /** Optional group heading, e.g. "Für den Teig". */
  section: Schema.optional(Schema.NullOr(Str.check(maxLength(120)))),
  quantity: Schema.optional(Schema.NullOr(Num.check(nonnegative()))),
  quantityMax: Schema.optional(Schema.NullOr(Num.check(nonnegative()))),
  unit: Schema.optional(Schema.NullOr(Str.check(maxLength(40)))),
  name: Str.check(minLength(1), maxLength(300)),
  note: Schema.optional(Schema.NullOr(Str.check(maxLength(300)))),
  raw: Str.check(maxLength(500)),
});
export type RecipeIngredient = Types.DeepMutable<typeof RecipeIngredientSchema.Type>;

export const RecipeIngredientRecordSchema = Schema.Struct({
  ...RecipeIngredientSchema.fields,
  id: IdSchema,
  recipeId: IdSchema,
});
export type RecipeIngredientRecord = Types.DeepMutable<typeof RecipeIngredientRecordSchema.Type>;

export const RecipeStepSchema = Schema.Struct({
  position: Int.check(nonnegative()),
  /** Optional group heading, e.g. "Teig zubereiten". */
  section: Schema.optional(Schema.NullOr(Str.check(maxLength(120)))),
  text: Str.check(minLength(1), maxLength(5000)),
});
export type RecipeStep = Types.DeepMutable<typeof RecipeStepSchema.Type>;

export const RecipeStepRecordSchema = Schema.Struct({
  ...RecipeStepSchema.fields,
  id: IdSchema,
  recipeId: IdSchema,
});
export type RecipeStepRecord = Types.DeepMutable<typeof RecipeStepRecordSchema.Type>;

/**
 * What a tag IS, not what it is called.
 *
 * `course` = the recipe's single category, drawn as the honey eyebrow above the title.
 * `free`   = an ordinary tag, drawn in the filter rail's second half.
 *
 * The VALUES are the wire contract; the tag NAMES they classify are German CONTENT and
 * are never translated (see docs/i18n.md and CLAUDE.md's interface-vs-content gotcha).
 */
export const TagKindSchema = Enum(["course", "free"]);
export type TagKind = Types.DeepMutable<typeof TagKindSchema.Type>;

export const TagSchema = Schema.Struct({
  id: IdSchema,
  householdId: IdSchema,
  name: Str,
  /** `'course' | 'free'` — required: every row has one after migration 0006. */
  kind: TagKindSchema,
  /** Hex colour like "#e11d48", chosen in the UI. */
  color: Schema.optional(Schema.NullOr(Str)),
  createdAt: IsoDateSchema,
  /** Present in tag listings. */
  recipeCount: Schema.optional(Int.check(nonnegative())),
});
export type Tag = Types.DeepMutable<typeof TagSchema.Type>;

export const CollectionSchema = Schema.Struct({
  id: IdSchema,
  householdId: IdSchema,
  name: Str,
  description: Schema.optional(Schema.NullOr(Str)),
  coverImageUrl: Schema.optional(Schema.NullOr(Str)),
  createdBy: IdSchema,
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
  recipeCount: Schema.optional(Int.check(nonnegative())),
});
export type Collection = Types.DeepMutable<typeof CollectionSchema.Type>;

/** Fields every recipe row has, without children. */
export const RecipeSchema = Schema.Struct({
  id: IdSchema,
  householdId: IdSchema,
  title: Str,
  description: Schema.optional(Schema.NullOr(Str)),
  imageUrl: Schema.optional(Schema.NullOr(Str)),
  /**
   * Downscaled derivative of `imageUrl` for list screens — read-only, minted by the
   * API (never sent back on a write) and null when the image is not one of our own
   * uploads. Falls back to `imageUrl` in the UI.
   */
  thumbnailUrl: Schema.optional(Schema.NullOr(Str)),
  sourceUrl: Schema.optional(Schema.NullOr(Str)),
  sourceName: Schema.optional(Schema.NullOr(Str)),
  servingsAmount: Schema.optional(Schema.NullOr(Num.check(positive()))),
  servingsUnit: Schema.optional(Schema.NullOr(Str)),
  prepMinutes: Schema.optional(Schema.NullOr(Int.check(nonnegative()))),
  cookMinutes: Schema.optional(Schema.NullOr(Int.check(nonnegative()))),
  totalMinutes: Schema.optional(Schema.NullOr(Int.check(nonnegative()))),
  difficulty: Schema.optional(Schema.NullOr(DifficultySchema)),
  rating: Schema.optional(Schema.NullOr(Int.check(min(0), max(5)))),
  notes: Schema.optional(Schema.NullOr(Str)),
  language: Schema.optional(Schema.NullOr(Str)),
  /**
   * When this recipe was last cooked, from `recipe_cook_log` — read-only, derived,
   * never sent back on a write. Stored on the row (`recipes.last_cooked_at`) rather
   * than computed per query, because `?sort=lastCooked` would otherwise sort the whole
   * group in a temp b-tree; see the column comment in apps/api/src/db/schema.ts.
   */
  lastCookedAt: Schema.optional(Schema.NullOr(IsoDateSchema)),
  createdBy: IdSchema,
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
});
export type Recipe = Types.DeepMutable<typeof RecipeSchema.Type>;

/** Card shape for list/search screens — cheap to build, no ingredient bodies. */
export const RecipeListItemSchema = Schema.Struct({
  ...RecipeSchema.fields,
  tags: Schema.Array(TagSchema),
  ingredientCount: Int.check(nonnegative()),
  stepCount: Int.check(nonnegative()),
});
export type RecipeListItem = Types.DeepMutable<typeof RecipeListItemSchema.Type>;

/** Full recipe with children — the detail screen payload. */
export const RecipeDetailSchema = Schema.Struct({
  ...RecipeSchema.fields,
  ingredients: Schema.Array(RecipeIngredientRecordSchema),
  steps: Schema.Array(RecipeStepRecordSchema),
  tags: Schema.Array(TagSchema),
  collectionIds: Schema.Array(IdSchema),
  author: PublicUserSchema,
});
export type RecipeDetail = Types.DeepMutable<typeof RecipeDetailSchema.Type>;

/* ------------------------------- requests -------------------------------- */

/** Ingredient/step input: positions are re-assigned server-side by array order. */
export const RecipeIngredientInputSchema = partial(RecipeIngredientSchema, ["position", "raw"]);
export type RecipeIngredientInput = Types.DeepMutable<typeof RecipeIngredientInputSchema.Type>;

export const RecipeStepInputSchema = partial(RecipeStepSchema, ["position"]);
export type RecipeStepInput = Types.DeepMutable<typeof RecipeStepInputSchema.Type>;

export const CreateRecipeRequestSchema = Schema.Struct({
  title: Str.pipe(trim).check(minLength(1), maxLength(300)),
  description: Schema.optional(Schema.NullOr(Str.pipe(trim).check(maxLength(5000)))),
  imageUrl: Schema.optional(Schema.NullOr(Str.check(maxLength(1000)))),
  sourceUrl: Schema.optional(Schema.NullOr(HttpUrlSchema)),
  sourceName: Schema.optional(Schema.NullOr(Str.check(maxLength(200)))),
  servingsAmount: Schema.optional(Schema.NullOr(Num.check(positive(), max(1000)))),
  servingsUnit: Schema.optional(Schema.NullOr(Str.check(maxLength(40)))),
  prepMinutes: Schema.optional(Schema.NullOr(Int.check(min(0), max(100000)))),
  cookMinutes: Schema.optional(Schema.NullOr(Int.check(min(0), max(100000)))),
  totalMinutes: Schema.optional(Schema.NullOr(Int.check(min(0), max(100000)))),
  difficulty: Schema.optional(Schema.NullOr(DifficultySchema)),
  rating: Schema.optional(Schema.NullOr(Int.check(min(0), max(5)))),
  notes: Schema.optional(Schema.NullOr(Str.check(maxLength(10000)))),
  language: Schema.optional(Schema.NullOr(Str.check(maxLength(10)))),
  ingredients: Schema.Array(RecipeIngredientInputSchema)
    .check(maxItems(200))
    .pipe(Schema.withDecodingDefaultType(Effect.sync(() => []))),
  steps: Schema.Array(RecipeStepInputSchema)
    .check(maxItems(200))
    .pipe(Schema.withDecodingDefaultType(Effect.sync(() => []))),
  /** Tag NAMES — created on demand inside the household, always as `kind:'free'`. */
  tags: Schema.Array(Str.pipe(trim).check(minLength(1), maxLength(60)))
    .check(maxItems(30))
    .pipe(Schema.withDecodingDefaultType(Effect.sync(() => []))),
  collectionIds: Schema.Array(IdSchema).check(maxItems(30)).pipe(Schema.withDecodingDefaultType(Effect.sync(() => []))),
  /**
   * The recipe's category — a tag NAME, created inside the household as `kind:'course'` if
   * it does not exist. German content; never a catalog key.
   *
   * Separate from `tags` because `tags` creates FREE tags: routing the course through it
   * would create "Dessert" with kind 'free' and lose the eyebrow.
   *
   * `course` **absent** (the field omitted from a PATCH) leaves the course link
   * untouched; `null` unlinks it; a name gets-or-creates it as `kind:'course'` and
   * replaces the recipe's only course link. Has no `.default()` on purpose, so
   * `UpdateRecipeRequestSchema` (its `.partial()`) can tell "not sent" from "cleared" —
   * `course` must therefore never be added to `keepOnlySentKeys` in `routes/recipes.ts`,
   * which exists only for the child arrays that carry `.default([])`.
   */
  course: Schema.optional(Schema.NullOr(Str.pipe(trim).check(minLength(1), maxLength(60)))),
});
export type CreateRecipeRequest = Types.DeepMutable<typeof CreateRecipeRequestSchema.Type>;

/**
 * Partial update. `ingredients`/`steps`/`tags`/`collectionIds` are REPLACE-ALL when
 * present and untouched when absent.
 */
export const UpdateRecipeRequestSchema = partial(CreateRecipeRequestSchema);
// zod's `.partial()` typed a defaulted key optional although decoding fills it; `Partial` keeps that type.
export type UpdateRecipeRequest = Types.DeepMutable<Partial<typeof UpdateRecipeRequestSchema.Type>>;

export const RecipeSortSchema = Enum([
  "newest",
  "oldest",
  "title",
  "rating",
  "time",
  "lastCooked",
]);
export type RecipeSort = Types.DeepMutable<typeof RecipeSortSchema.Type>;

export const RecipeListQuerySchema = Schema.Struct({
  /** Free-text search over title, description, ingredient names. */
  q: Schema.optional(Str.pipe(trim).check(maxLength(200))),
  /** Comma-separated tag ids; a recipe must carry ALL of them. */
  tags: Schema.optional(Str.check(maxLength(1000))),
  collectionId: Schema.optional(IdSchema),
  maxMinutes: Schema.optional(CoercedInt.check(min(1), max(100000))),
  difficulty: Schema.optional(DifficultySchema),
  /**
   * `1` restricts the list to recipes that have been cooked at least once.
   * Deliberately NOT `z.coerce.boolean()` — that turns the string `"0"` into `true`,
   * which is a live trap for a query param.
   */
  hasCooked: Schema.optional(Enum(["0", "1"])).pipe(
    Schema.decodeTo(Schema.optional(Bool), {
      decode: SchemaGetter.transformOptional((value) =>
        Option.map(value, (flag) => (flag === undefined ? undefined : flag === "1")),
      ),
      encode: SchemaGetter.transformOptional((value) =>
        Option.map(value, (flag): "0" | "1" | undefined => (flag === undefined ? undefined : flag ? "1" : "0")),
      ),
    }),
  ),
  sort: RecipeSortSchema.pipe(Schema.withDecodingDefault(Effect.succeed("newest" as const))),
  limit: CoercedInt.check(min(1), max(100)).pipe(Schema.withDecodingDefault(Effect.succeed(24))),
  offset: CoercedInt.check(min(0)).pipe(Schema.withDecodingDefault(Effect.succeed(0))),
});
export type RecipeListQuery = Types.DeepMutable<typeof RecipeListQuerySchema.Type>;

export const CreateTagRequestSchema = Schema.Struct({
  name: Str.pipe(trim).check(minLength(1), maxLength(60)),
  color: Schema.optional(Str.check(regex(/^#[0-9a-fA-F]{6}$/))),
  /** Default `'free'` server-side. */
  kind: Schema.optional(TagKindSchema),
});
export type CreateTagRequest = Types.DeepMutable<typeof CreateTagRequestSchema.Type>;

export const UpdateTagRequestSchema = partial(CreateTagRequestSchema).check(
  keyed((value) => Object.keys(value).length > 0, "server.validation.noChanges"),
);
export type UpdateTagRequest = Types.DeepMutable<typeof UpdateTagRequestSchema.Type>;

export const CreateCollectionRequestSchema = Schema.Struct({
  name: Str.pipe(trim).check(minLength(1), maxLength(120)),
  description: Schema.optional(Schema.NullOr(Str.pipe(trim).check(maxLength(1000)))),
  coverImageUrl: Schema.optional(Schema.NullOr(Str.check(maxLength(1000)))),
  recipeIds: Schema.Array(IdSchema).check(maxItems(500)).pipe(Schema.withDecodingDefaultType(Effect.sync(() => []))),
});
export type CreateCollectionRequest = Types.DeepMutable<typeof CreateCollectionRequestSchema.Type>;

export const UpdateCollectionRequestSchema = partial(CreateCollectionRequestSchema).check(
  keyed((value) => Object.keys(value).length > 0, "server.validation.noChanges"),
);
// `recipeIds` stays optional in the type, as zod's `.partial()` typed it (see `UpdateRecipeRequest`).
export type UpdateCollectionRequest = Types.DeepMutable<Partial<typeof UpdateCollectionRequestSchema.Type>>;

/** GET /recipes/:id/scale?servings=n */
export const ScaleRecipeQuerySchema = Schema.Struct({
  servings: CoercedNum.check(positive(), max(1000)),
});
export type ScaleRecipeQuery = Types.DeepMutable<typeof ScaleRecipeQuerySchema.Type>;

/* ------------------------------- responses ------------------------------- */

export const RecipeResponseSchema = Schema.Struct({ recipe: RecipeDetailSchema });
export type RecipeResponse = Types.DeepMutable<typeof RecipeResponseSchema.Type>;

export const RecipeListResponseSchema = listResponse(RecipeListItemSchema);
export type RecipeListResponse = Types.DeepMutable<typeof RecipeListResponseSchema.Type>;

export const TagResponseSchema = Schema.Struct({ tag: TagSchema });
export type TagResponse = Types.DeepMutable<typeof TagResponseSchema.Type>;

export const TagListResponseSchema = Schema.Struct({ items: Schema.Array(TagSchema) });
export type TagListResponse = Types.DeepMutable<typeof TagListResponseSchema.Type>;

export const CollectionResponseSchema = Schema.Struct({ collection: CollectionSchema });
export type CollectionResponse = Types.DeepMutable<typeof CollectionResponseSchema.Type>;

export const CollectionListResponseSchema = Schema.Struct({ items: Schema.Array(CollectionSchema) });
export type CollectionListResponse = Types.DeepMutable<typeof CollectionListResponseSchema.Type>;

export const CollectionDetailResponseSchema = Schema.Struct({
  collection: CollectionSchema,
  recipes: Schema.Array(RecipeListItemSchema),
});
export type CollectionDetailResponse = Types.DeepMutable<typeof CollectionDetailResponseSchema.Type>;

export const ScaledRecipeResponseSchema = Schema.Struct({
  recipeId: IdSchema,
  factor: Num.check(positive()),
  servingsAmount: Num.check(positive()),
  servingsUnit: Schema.optional(Schema.NullOr(Str)),
  ingredients: Schema.Array(RecipeIngredientSchema),
});
export type ScaledRecipeResponse = Types.DeepMutable<typeof ScaledRecipeResponseSchema.Type>;
