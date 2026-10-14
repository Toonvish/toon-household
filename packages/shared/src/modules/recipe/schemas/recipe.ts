import { z } from "zod";
import { refineKey } from "../../../core/i18n/zod.ts";
import { HttpUrlSchema, IdSchema, IsoDateSchema, listResponse } from "../../../core/schemas/common.ts";
import { PublicUserSchema } from "../../../core/schemas/user.ts";

export const DifficultySchema = z.enum(["einfach", "mittel", "schwer"]);
export type Difficulty = z.infer<typeof DifficultySchema>;

/**
 * One ingredient line. This is the CONTRACT shape: it is what `parseIngredientLine`
 * returns, what the import draft carries, and what create/update requests accept.
 * Persisted rows additionally carry `id`/`recipeId` (see RecipeIngredientRecordSchema).
 *
 * `raw` always holds the original, unmodified source line so nothing is ever lost.
 * `quantityMax` is set only for ranges ("2-3 Eier" => quantity 2, quantityMax 3).
 */
export const RecipeIngredientSchema = z.object({
  position: z.number().int().nonnegative(),
  /** Optional group heading, e.g. "Für den Teig". */
  section: z.string().max(120).nullish(),
  quantity: z.number().nonnegative().nullish(),
  quantityMax: z.number().nonnegative().nullish(),
  unit: z.string().max(40).nullish(),
  name: z.string().min(1).max(300),
  note: z.string().max(300).nullish(),
  raw: z.string().max(500),
});
export type RecipeIngredient = z.infer<typeof RecipeIngredientSchema>;

export const RecipeIngredientRecordSchema = RecipeIngredientSchema.extend({
  id: IdSchema,
  recipeId: IdSchema,
});
export type RecipeIngredientRecord = z.infer<typeof RecipeIngredientRecordSchema>;

export const RecipeStepSchema = z.object({
  position: z.number().int().nonnegative(),
  /** Optional group heading, e.g. "Teig zubereiten". */
  section: z.string().max(120).nullish(),
  text: z.string().min(1).max(5000),
});
export type RecipeStep = z.infer<typeof RecipeStepSchema>;

export const RecipeStepRecordSchema = RecipeStepSchema.extend({
  id: IdSchema,
  recipeId: IdSchema,
});
export type RecipeStepRecord = z.infer<typeof RecipeStepRecordSchema>;

/**
 * What a tag IS, not what it is called.
 *
 * `course` = the recipe's single category, drawn as the honey eyebrow above the title.
 * `free`   = an ordinary tag, drawn in the filter rail's second half.
 *
 * The VALUES are the wire contract; the tag NAMES they classify are German CONTENT and
 * are never translated (see docs/i18n.md and CLAUDE.md's interface-vs-content gotcha).
 */
export const TagKindSchema = z.enum(["course", "free"]);
export type TagKind = z.infer<typeof TagKindSchema>;

export const TagSchema = z.object({
  id: IdSchema,
  householdId: IdSchema,
  name: z.string(),
  /** `'course' | 'free'` — required: every row has one after migration 0006. */
  kind: TagKindSchema,
  /** Hex colour like "#e11d48", chosen in the UI. */
  color: z.string().nullish(),
  createdAt: IsoDateSchema,
  /** Present in tag listings. */
  recipeCount: z.number().int().nonnegative().optional(),
});
export type Tag = z.infer<typeof TagSchema>;

export const CollectionSchema = z.object({
  id: IdSchema,
  householdId: IdSchema,
  name: z.string(),
  description: z.string().nullish(),
  coverImageUrl: z.string().nullish(),
  createdBy: IdSchema,
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
  recipeCount: z.number().int().nonnegative().optional(),
});
export type Collection = z.infer<typeof CollectionSchema>;

/** Fields every recipe row has, without children. */
export const RecipeSchema = z.object({
  id: IdSchema,
  householdId: IdSchema,
  title: z.string(),
  description: z.string().nullish(),
  imageUrl: z.string().nullish(),
  /**
   * Downscaled derivative of `imageUrl` for list screens — read-only, minted by the
   * API (never sent back on a write) and null when the image is not one of our own
   * uploads. Falls back to `imageUrl` in the UI.
   */
  thumbnailUrl: z.string().nullish(),
  sourceUrl: z.string().nullish(),
  sourceName: z.string().nullish(),
  servingsAmount: z.number().positive().nullish(),
  servingsUnit: z.string().nullish(),
  prepMinutes: z.number().int().nonnegative().nullish(),
  cookMinutes: z.number().int().nonnegative().nullish(),
  totalMinutes: z.number().int().nonnegative().nullish(),
  difficulty: DifficultySchema.nullish(),
  rating: z.number().int().min(0).max(5).nullish(),
  notes: z.string().nullish(),
  language: z.string().nullish(),
  /**
   * When this recipe was last cooked, from `recipe_cook_log` — read-only, derived,
   * never sent back on a write. Stored on the row (`recipes.last_cooked_at`) rather
   * than computed per query, because `?sort=lastCooked` would otherwise sort the whole
   * group in a temp b-tree; see the column comment in apps/api/src/db/schema.ts.
   */
  lastCookedAt: IsoDateSchema.nullish(),
  createdBy: IdSchema,
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
});
export type Recipe = z.infer<typeof RecipeSchema>;

/** Card shape for list/search screens — cheap to build, no ingredient bodies. */
export const RecipeListItemSchema = RecipeSchema.extend({
  tags: z.array(TagSchema),
  ingredientCount: z.number().int().nonnegative(),
  stepCount: z.number().int().nonnegative(),
});
export type RecipeListItem = z.infer<typeof RecipeListItemSchema>;

/** Full recipe with children — the detail screen payload. */
export const RecipeDetailSchema = RecipeSchema.extend({
  ingredients: z.array(RecipeIngredientRecordSchema),
  steps: z.array(RecipeStepRecordSchema),
  tags: z.array(TagSchema),
  collectionIds: z.array(IdSchema),
  author: PublicUserSchema,
});
export type RecipeDetail = z.infer<typeof RecipeDetailSchema>;

/* ------------------------------- requests -------------------------------- */

/** Ingredient/step input: positions are re-assigned server-side by array order. */
export const RecipeIngredientInputSchema = RecipeIngredientSchema.partial({
  position: true,
  raw: true,
});
export type RecipeIngredientInput = z.infer<typeof RecipeIngredientInputSchema>;

export const RecipeStepInputSchema = RecipeStepSchema.partial({ position: true });
export type RecipeStepInput = z.infer<typeof RecipeStepInputSchema>;

export const CreateRecipeRequestSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(5000).nullish(),
  imageUrl: z.string().max(1000).nullish(),
  sourceUrl: HttpUrlSchema.nullish(),
  sourceName: z.string().max(200).nullish(),
  servingsAmount: z.number().positive().max(1000).nullish(),
  servingsUnit: z.string().max(40).nullish(),
  prepMinutes: z.number().int().min(0).max(100000).nullish(),
  cookMinutes: z.number().int().min(0).max(100000).nullish(),
  totalMinutes: z.number().int().min(0).max(100000).nullish(),
  difficulty: DifficultySchema.nullish(),
  rating: z.number().int().min(0).max(5).nullish(),
  notes: z.string().max(10000).nullish(),
  language: z.string().max(10).nullish(),
  ingredients: z.array(RecipeIngredientInputSchema).max(200).default([]),
  steps: z.array(RecipeStepInputSchema).max(200).default([]),
  /** Tag NAMES — created on demand inside the household, always as `kind:'free'`. */
  tags: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  collectionIds: z.array(IdSchema).max(30).default([]),
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
  course: z.string().trim().min(1).max(60).nullish(),
});
export type CreateRecipeRequest = z.infer<typeof CreateRecipeRequestSchema>;

/**
 * Partial update. `ingredients`/`steps`/`tags`/`collectionIds` are REPLACE-ALL when
 * present and untouched when absent.
 */
export const UpdateRecipeRequestSchema = CreateRecipeRequestSchema.partial();
export type UpdateRecipeRequest = z.infer<typeof UpdateRecipeRequestSchema>;

export const RecipeSortSchema = z.enum([
  "newest",
  "oldest",
  "title",
  "rating",
  "time",
  "lastCooked",
]);
export type RecipeSort = z.infer<typeof RecipeSortSchema>;

export const RecipeListQuerySchema = z.object({
  /** Free-text search over title, description, ingredient names. */
  q: z.string().trim().max(200).optional(),
  /** Comma-separated tag ids; a recipe must carry ALL of them. */
  tags: z.string().max(1000).optional(),
  collectionId: IdSchema.optional(),
  maxMinutes: z.coerce.number().int().min(1).max(100000).optional(),
  difficulty: DifficultySchema.optional(),
  /**
   * `1` restricts the list to recipes that have been cooked at least once.
   * Deliberately NOT `z.coerce.boolean()` — that turns the string `"0"` into `true`,
   * which is a live trap for a query param.
   */
  hasCooked: z
    .enum(["0", "1"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "1")),
  sort: RecipeSortSchema.default("newest"),
  limit: z.coerce.number().int().min(1).max(100).default(24),
  offset: z.coerce.number().int().min(0).default(0),
});
export type RecipeListQuery = z.infer<typeof RecipeListQuerySchema>;

export const CreateTagRequestSchema = z.object({
  name: z.string().trim().min(1).max(60),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  /** Default `'free'` server-side. */
  kind: TagKindSchema.optional(),
});
export type CreateTagRequest = z.infer<typeof CreateTagRequestSchema>;

export const UpdateTagRequestSchema = CreateTagRequestSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  refineKey("server.validation.noChanges"),
);
export type UpdateTagRequest = z.infer<typeof UpdateTagRequestSchema>;

export const CreateCollectionRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).nullish(),
  coverImageUrl: z.string().max(1000).nullish(),
  recipeIds: z.array(IdSchema).max(500).default([]),
});
export type CreateCollectionRequest = z.infer<typeof CreateCollectionRequestSchema>;

export const UpdateCollectionRequestSchema = CreateCollectionRequestSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  refineKey("server.validation.noChanges"),
);
export type UpdateCollectionRequest = z.infer<typeof UpdateCollectionRequestSchema>;

/** GET /recipes/:id/scale?servings=n */
export const ScaleRecipeQuerySchema = z.object({
  servings: z.coerce.number().positive().max(1000),
});
export type ScaleRecipeQuery = z.infer<typeof ScaleRecipeQuerySchema>;

/* ------------------------------- responses ------------------------------- */

export const RecipeResponseSchema = z.object({ recipe: RecipeDetailSchema });
export type RecipeResponse = z.infer<typeof RecipeResponseSchema>;

export const RecipeListResponseSchema = listResponse(RecipeListItemSchema);
export type RecipeListResponse = z.infer<typeof RecipeListResponseSchema>;

export const TagResponseSchema = z.object({ tag: TagSchema });
export type TagResponse = z.infer<typeof TagResponseSchema>;

export const TagListResponseSchema = z.object({ items: z.array(TagSchema) });
export type TagListResponse = z.infer<typeof TagListResponseSchema>;

export const CollectionResponseSchema = z.object({ collection: CollectionSchema });
export type CollectionResponse = z.infer<typeof CollectionResponseSchema>;

export const CollectionListResponseSchema = z.object({ items: z.array(CollectionSchema) });
export type CollectionListResponse = z.infer<typeof CollectionListResponseSchema>;

export const CollectionDetailResponseSchema = z.object({
  collection: CollectionSchema,
  recipes: z.array(RecipeListItemSchema),
});
export type CollectionDetailResponse = z.infer<typeof CollectionDetailResponseSchema>;

export const ScaledRecipeResponseSchema = z.object({
  recipeId: IdSchema,
  factor: z.number().positive(),
  servingsAmount: z.number().positive(),
  servingsUnit: z.string().nullish(),
  ingredients: z.array(RecipeIngredientSchema),
});
export type ScaledRecipeResponse = z.infer<typeof ScaledRecipeResponseSchema>;
