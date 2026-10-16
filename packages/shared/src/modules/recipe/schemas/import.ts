import { Effect, Schema, type Types } from "effect";
import {
  CoercedInt,
  Enum,
  Int,
  Num,
  Str,
  Url,
  max,
  maxItems,
  maxLength,
  min,
  minLength,
  nonnegative,
  positive,
  trim,
} from "../../../core/schemas/checks.ts";
import { HttpUrlSchema, IdSchema, IsoDateSchema, listResponse } from "../../../core/schemas/common.ts";
import {
  DifficultySchema,
  RecipeDetailSchema,
  RecipeIngredientSchema,
  RecipeStepSchema,
} from "./recipe.ts";

/** 0..1 confidence per field. Absent = "no opinion". */
export const ConfidenceSchema = Num.check(min(0), max(1));

export const ParsedRecipeConfidenceSchema = Schema.Struct({
  /** Aggregate quality of the parse; the review screen warns below 0.5. */
  overall: ConfidenceSchema,
  title: Schema.optional(ConfidenceSchema),
  description: Schema.optional(ConfidenceSchema),
  ingredients: Schema.optional(ConfidenceSchema),
  steps: Schema.optional(ConfidenceSchema),
  servings: Schema.optional(ConfidenceSchema),
  times: Schema.optional(ConfidenceSchema),
  image: Schema.optional(ConfidenceSchema),
});
export type ParsedRecipeConfidence = Types.DeepMutable<typeof ParsedRecipeConfidenceSchema.Type>;

export const ServingsSchema = Schema.Struct({
  amount: Num.check(positive()),
  /** Canonical German plural, e.g. "Portionen", "Stück", "Personen". */
  unit: Str.check(minLength(1), maxLength(40)),
});
export type Servings = Types.DeepMutable<typeof ServingsSchema.Type>;

/**
 * The normalized recipe shape that EVERY importer produces (URL/JSON-LD parser,
 * OCR parser, PDF text parser) and that the draft review screen edits.
 * Everything except `ingredients`/`steps`/`confidence` is optional because a
 * scan may simply not contain it.
 */
export const ParsedRecipeSchema = Schema.Struct({
  title: Schema.optional(Str.check(maxLength(300))),
  description: Schema.optional(Str.check(maxLength(5000))),
  imageUrl: Schema.optional(Str.check(maxLength(2000))),
  sourceUrl: Schema.optional(HttpUrlSchema),
  sourceName: Schema.optional(Str.check(maxLength(200))),
  servings: Schema.optional(ServingsSchema),
  prepMinutes: Schema.optional(Int.check(min(0), max(100000))),
  cookMinutes: Schema.optional(Int.check(min(0), max(100000))),
  totalMinutes: Schema.optional(Int.check(min(0), max(100000))),
  difficulty: Schema.optional(DifficultySchema),
  ingredients: Schema.Array(RecipeIngredientSchema)
    .check(maxItems(300))
    .pipe(Schema.withDecodingDefaultType(Effect.sync(() => []))),
  steps: Schema.Array(RecipeStepSchema)
    .check(maxItems(300))
    .pipe(Schema.withDecodingDefaultType(Effect.sync(() => []))),
  tags: Schema.Array(Str.pipe(trim).check(minLength(1), maxLength(60)))
    .check(maxItems(30))
    .pipe(Schema.withDecodingDefaultType(Effect.sync(() => []))),
  notes: Schema.optional(Str.check(maxLength(10000))),
  /** BCP-47-ish hint, "de" by default. */
  language: Schema.optional(Str.check(maxLength(10))),
  confidence: ParsedRecipeConfidenceSchema,
});
export type ParsedRecipe = Types.DeepMutable<typeof ParsedRecipeSchema.Type>;

export const ImportSourceTypeSchema = Enum(["manual", "url", "ocr"]);
export type ImportSourceType = Types.DeepMutable<typeof ImportSourceTypeSchema.Type>;

export const ImportDraftStatusSchema = Enum(["pending", "reviewed", "discarded"]);
export type ImportDraftStatus = Types.DeepMutable<typeof ImportDraftStatusSchema.Type>;

/**
 * How the text was obtained. PDF and image imports both use sourceType "ocr";
 * this field says whether a text layer was used or pixels were recognised.
 */
export const ExtractionMethodSchema = Enum(["json-ld", "microdata", "selector", "pdf-text", "ocr", "manual"]);
export type ExtractionMethod = Types.DeepMutable<typeof ExtractionMethodSchema.Type>;

export const ImportSourceMetaSchema = Schema.Struct({
  method: ExtractionMethodSchema,
  filename: Schema.optional(Str.check(maxLength(300))),
  mimeType: Schema.optional(Str.check(maxLength(100))),
  /** Stored upload path relative to UPLOAD_DIR, when a file was involved. */
  storedPath: Schema.optional(Str.check(maxLength(300))),
  pages: Schema.optional(Int.check(positive())),
  /** Hostname for URL imports. */
  host: Schema.optional(Str.check(maxLength(200))),
  /** OCR engine + languages actually used. */
  engine: Schema.optional(Str.check(maxLength(100))),
  langs: Schema.optional(Str.check(maxLength(50))),
  durationMs: Schema.optional(Int.check(nonnegative())),
});
export type ImportSourceMeta = Types.DeepMutable<typeof ImportSourceMetaSchema.Type>;

export const ImportDraftSchema = Schema.Struct({
  id: IdSchema,
  householdId: IdSchema,
  createdBy: IdSchema,
  status: ImportDraftStatusSchema,
  sourceType: ImportSourceTypeSchema,
  sourceUrl: Schema.optional(Schema.NullOr(Str)),
  /** Raw OCR/text-layer output, kept so the user can copy from it while editing. */
  rawText: Schema.optional(Schema.NullOr(Str)),
  parsed: ParsedRecipeSchema,
  /** Convenience mirror of parsed.confidence.overall for list views. */
  confidence: Schema.optional(Schema.NullOr(ConfidenceSchema)),
  sourceMeta: Schema.optional(Schema.NullOr(ImportSourceMetaSchema)),
  /** Set once the draft was committed to a real recipe. */
  recipeId: Schema.optional(Schema.NullOr(IdSchema)),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
});
export type ImportDraft = Types.DeepMutable<typeof ImportDraftSchema.Type>;

/* ------------------------------- requests -------------------------------- */

export const ImportUrlRequestSchema = Schema.Struct({
  url: Url.check(maxLength(2000)),
});
export type ImportUrlRequest = Types.DeepMutable<typeof ImportUrlRequestSchema.Type>;

export const ImportTextRequestSchema = Schema.Struct({
  rawText: Str.check(minLength(1), maxLength(100000)),
  title: Schema.optional(Str.pipe(trim).check(maxLength(300))),
});
export type ImportTextRequest = Types.DeepMutable<typeof ImportTextRequestSchema.Type>;

/**
 * multipart/form-data with a single `file` field. Declared for documentation:
 * the API validates the file server-side (size + sniffed content type).
 */
export const ImportFileFieldName = "file";

export const UpdateImportDraftRequestSchema = Schema.Struct({
  parsed: ParsedRecipeSchema,
  status: Schema.optional(ImportDraftStatusSchema),
});
export type UpdateImportDraftRequest = Types.DeepMutable<typeof UpdateImportDraftRequestSchema.Type>;

/** Final "Speichern" from the review screen. `parsed` overrides the stored draft. */
export const CommitImportDraftRequestSchema = Schema.Struct({
  parsed: Schema.optional(ParsedRecipeSchema),
  tags: Schema.optional(Schema.Array(Str.pipe(trim).check(minLength(1), maxLength(60))).check(maxItems(30))),
  collectionIds: Schema.optional(Schema.Array(IdSchema).check(maxItems(30))),
});
export type CommitImportDraftRequest = Types.DeepMutable<typeof CommitImportDraftRequestSchema.Type>;

export const ImportDraftListQuerySchema = Schema.Struct({
  status: Schema.optional(ImportDraftStatusSchema),
  limit: CoercedInt.check(min(1), max(100)).pipe(Schema.withDecodingDefault(Effect.succeed(24))),
  offset: CoercedInt.check(min(0)).pipe(Schema.withDecodingDefault(Effect.succeed(0))),
});
export type ImportDraftListQuery = Types.DeepMutable<typeof ImportDraftListQuerySchema.Type>;

/* ------------------------------- responses ------------------------------- */

export const ImportDraftResponseSchema = Schema.Struct({ draft: ImportDraftSchema });
export type ImportDraftResponse = Types.DeepMutable<typeof ImportDraftResponseSchema.Type>;

export const ImportDraftListResponseSchema = listResponse(ImportDraftSchema);
export type ImportDraftListResponse = Types.DeepMutable<typeof ImportDraftListResponseSchema.Type>;

export const CommitImportDraftResponseSchema = Schema.Struct({
  recipe: RecipeDetailSchema,
  draft: ImportDraftSchema,
});
export type CommitImportDraftResponse = Types.DeepMutable<typeof CommitImportDraftResponseSchema.Type>;

/** Empty parse result helper so importers never hand back a half-built object. */
export function emptyParsedRecipe(overrides: Partial<ParsedRecipe> = {}): ParsedRecipe {
  return {
    ingredients: [],
    steps: [],
    tags: [],
    confidence: { overall: 0 },
    ...overrides,
  };
}
