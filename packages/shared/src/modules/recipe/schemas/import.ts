import { z } from "zod";
import { HttpUrlSchema, IdSchema, IsoDateSchema, listResponse } from "../../../core/schemas/common.ts";
import {
  DifficultySchema,
  RecipeDetailSchema,
  RecipeIngredientSchema,
  RecipeStepSchema,
} from "./recipe.ts";

/** 0..1 confidence per field. Absent = "no opinion". */
export const ConfidenceSchema = z.number().min(0).max(1);

export const ParsedRecipeConfidenceSchema = z.object({
  /** Aggregate quality of the parse; the review screen warns below 0.5. */
  overall: ConfidenceSchema,
  title: ConfidenceSchema.optional(),
  description: ConfidenceSchema.optional(),
  ingredients: ConfidenceSchema.optional(),
  steps: ConfidenceSchema.optional(),
  servings: ConfidenceSchema.optional(),
  times: ConfidenceSchema.optional(),
  image: ConfidenceSchema.optional(),
});
export type ParsedRecipeConfidence = z.infer<typeof ParsedRecipeConfidenceSchema>;

export const ServingsSchema = z.object({
  amount: z.number().positive(),
  /** Canonical German plural, e.g. "Portionen", "Stück", "Personen". */
  unit: z.string().min(1).max(40),
});
export type Servings = z.infer<typeof ServingsSchema>;

/**
 * The normalized recipe shape that EVERY importer produces (URL/JSON-LD parser,
 * OCR parser, PDF text parser) and that the draft review screen edits.
 * Everything except `ingredients`/`steps`/`confidence` is optional because a
 * scan may simply not contain it.
 */
export const ParsedRecipeSchema = z.object({
  title: z.string().max(300).optional(),
  description: z.string().max(5000).optional(),
  imageUrl: z.string().max(2000).optional(),
  sourceUrl: HttpUrlSchema.optional(),
  sourceName: z.string().max(200).optional(),
  servings: ServingsSchema.optional(),
  prepMinutes: z.number().int().min(0).max(100000).optional(),
  cookMinutes: z.number().int().min(0).max(100000).optional(),
  totalMinutes: z.number().int().min(0).max(100000).optional(),
  difficulty: DifficultySchema.optional(),
  ingredients: z.array(RecipeIngredientSchema).max(300).default([]),
  steps: z.array(RecipeStepSchema).max(300).default([]),
  tags: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  notes: z.string().max(10000).optional(),
  /** BCP-47-ish hint, "de" by default. */
  language: z.string().max(10).optional(),
  confidence: ParsedRecipeConfidenceSchema,
});
export type ParsedRecipe = z.infer<typeof ParsedRecipeSchema>;

export const ImportSourceTypeSchema = z.enum(["manual", "url", "ocr"]);
export type ImportSourceType = z.infer<typeof ImportSourceTypeSchema>;

export const ImportDraftStatusSchema = z.enum(["pending", "reviewed", "discarded"]);
export type ImportDraftStatus = z.infer<typeof ImportDraftStatusSchema>;

/**
 * How the text was obtained. PDF and image imports both use sourceType "ocr";
 * this field says whether a text layer was used or pixels were recognised.
 */
export const ExtractionMethodSchema = z.enum(["json-ld", "microdata", "selector", "pdf-text", "ocr", "manual"]);
export type ExtractionMethod = z.infer<typeof ExtractionMethodSchema>;

export const ImportSourceMetaSchema = z.object({
  method: ExtractionMethodSchema,
  filename: z.string().max(300).optional(),
  mimeType: z.string().max(100).optional(),
  /** Stored upload path relative to UPLOAD_DIR, when a file was involved. */
  storedPath: z.string().max(300).optional(),
  pages: z.number().int().positive().optional(),
  /** Hostname for URL imports. */
  host: z.string().max(200).optional(),
  /** OCR engine + languages actually used. */
  engine: z.string().max(100).optional(),
  langs: z.string().max(50).optional(),
  durationMs: z.number().int().nonnegative().optional(),
});
export type ImportSourceMeta = z.infer<typeof ImportSourceMetaSchema>;

export const ImportDraftSchema = z.object({
  id: IdSchema,
  householdId: IdSchema,
  createdBy: IdSchema,
  status: ImportDraftStatusSchema,
  sourceType: ImportSourceTypeSchema,
  sourceUrl: z.string().nullish(),
  /** Raw OCR/text-layer output, kept so the user can copy from it while editing. */
  rawText: z.string().nullish(),
  parsed: ParsedRecipeSchema,
  /** Convenience mirror of parsed.confidence.overall for list views. */
  confidence: ConfidenceSchema.nullish(),
  sourceMeta: ImportSourceMetaSchema.nullish(),
  /** Set once the draft was committed to a real recipe. */
  recipeId: IdSchema.nullish(),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
});
export type ImportDraft = z.infer<typeof ImportDraftSchema>;

/* ------------------------------- requests -------------------------------- */

export const ImportUrlRequestSchema = z.object({
  url: z.url().max(2000),
});
export type ImportUrlRequest = z.infer<typeof ImportUrlRequestSchema>;

export const ImportTextRequestSchema = z.object({
  rawText: z.string().min(1).max(100000),
  title: z.string().trim().max(300).optional(),
});
export type ImportTextRequest = z.infer<typeof ImportTextRequestSchema>;

/**
 * multipart/form-data with a single `file` field. Declared for documentation:
 * the API validates the file server-side (size + sniffed content type).
 */
export const ImportFileFieldName = "file";

export const UpdateImportDraftRequestSchema = z.object({
  parsed: ParsedRecipeSchema,
  status: ImportDraftStatusSchema.optional(),
});
export type UpdateImportDraftRequest = z.infer<typeof UpdateImportDraftRequestSchema>;

/** Final "Speichern" from the review screen. `parsed` overrides the stored draft. */
export const CommitImportDraftRequestSchema = z.object({
  parsed: ParsedRecipeSchema.optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  collectionIds: z.array(IdSchema).max(30).optional(),
});
export type CommitImportDraftRequest = z.infer<typeof CommitImportDraftRequestSchema>;

export const ImportDraftListQuerySchema = z.object({
  status: ImportDraftStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(24),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ImportDraftListQuery = z.infer<typeof ImportDraftListQuerySchema>;

/* ------------------------------- responses ------------------------------- */

export const ImportDraftResponseSchema = z.object({ draft: ImportDraftSchema });
export type ImportDraftResponse = z.infer<typeof ImportDraftResponseSchema>;

export const ImportDraftListResponseSchema = listResponse(ImportDraftSchema);
export type ImportDraftListResponse = z.infer<typeof ImportDraftListResponseSchema>;

export const CommitImportDraftResponseSchema = z.object({
  recipe: RecipeDetailSchema,
  draft: ImportDraftSchema,
});
export type CommitImportDraftResponse = z.infer<typeof CommitImportDraftResponseSchema>;

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
