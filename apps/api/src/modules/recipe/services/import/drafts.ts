/**
 * `import_drafts` repository + wire mapping.
 *
 * The draft is the ONLY thing an import creates — nothing reaches `recipes`
 * until the user commits the reviewed draft (see commit.ts).
 *
 * Defensive read path: `parsed` is a JSON column, so a row written by an older
 * version (or hand-edited in the DB) might not satisfy `ParsedRecipeSchema`.
 * `toDraftWire()` therefore validates and falls back to an empty parse instead
 * of throwing a 500 on a GET.
 */
import {
  type ImportDraft,
  type ImportDraftStatus,
  type ImportSourceMeta,
  type ImportSourceType,
  type ParsedRecipe,
  ImportSourceMetaSchema,
  ParsedRecipeSchema,
  emptyParsedRecipe,
} from "@toon/shared";
import { and, count, desc, eq } from "drizzle-orm";
import type { Database } from "../../../../db/client.ts";
import { type ImportDraftRow, importDrafts } from "../../../../db/schema.ts";
import { ApiError } from "../../../../lib/errors.ts";
import { toIso } from "../../../../lib/http.ts";
import { normalizeStoredUploadUrl, signUploadUrl } from "../../../../lib/uploadUrls.ts";

/** Row -> contract shape. Never throws on malformed JSON columns. */
export function toDraftWire(row: ImportDraftRow): ImportDraft {
  const parsedResult = ParsedRecipeSchema.safeParse(row.parsed);
  const stored: ParsedRecipe = parsedResult.success
    ? parsedResult.data
    : emptyParsedRecipe({ confidence: { overall: 0 } });

  // The URL importer downloads a hero image into UPLOAD_DIR and puts the bare
  // `/uploads/<uuid>` into parsed.imageUrl, so the review screen needs it signed
  // like any other hero image. `sourceMeta.storedPath` is deliberately NOT signed:
  // the uploaded photo/PDF is private and is served only by the membership-checked
  // /imports/:draftId/source route (see lib/uploadUrls.ts).
  const parsed: ParsedRecipe = { ...stored, imageUrl: signUploadUrl(stored.imageUrl) };

  const metaResult = row.sourceMeta === null ? undefined : ImportSourceMetaSchema.safeParse(row.sourceMeta);
  const sourceMeta: ImportSourceMeta | null = metaResult?.success === true ? metaResult.data : null;

  return {
    id: row.id,
    householdId: row.householdId,
    createdBy: row.createdBy,
    status: row.status as ImportDraftStatus,
    sourceType: row.sourceType as ImportSourceType,
    sourceUrl: row.sourceUrl,
    rawText: row.rawText,
    parsed,
    confidence: row.confidence,
    sourceMeta,
    recipeId: row.recipeId,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

/**
 * Write-path counterpart of the signing in {@link toDraftWire}: the review screen
 * PATCHes back the payload it was given, signature and all, and an expiring URL
 * must never land in the `parsed` JSON column (it would still be there, dead, when
 * the draft is committed into `recipes.image_url`).
 */
function normalizeParsedForStorage(parsed: ParsedRecipe): ParsedRecipe {
  const imageUrl = normalizeStoredUploadUrl(parsed.imageUrl);
  return imageUrl === parsed.imageUrl ? parsed : { ...parsed, imageUrl };
}

export interface CreateDraftInput {
  householdId: string;
  createdBy: string;
  sourceType: ImportSourceType;
  parsed: ParsedRecipe;
  rawText?: string | null;
  sourceUrl?: string | null;
  sourceMeta?: ImportSourceMeta | null;
}

/** Inserts a pending draft and returns it in wire shape. */
export async function createDraft(db: Database, input: CreateDraftInput): Promise<ImportDraft> {
  const now = Date.now();
  const parsed = normalizeParsedForStorage(input.parsed);
  const row: ImportDraftRow = {
    id: crypto.randomUUID(),
    householdId: input.householdId,
    createdBy: input.createdBy,
    status: "pending",
    sourceType: input.sourceType,
    sourceUrl: input.sourceUrl ?? null,
    rawText: input.rawText ?? null,
    parsed,
    confidence: parsed.confidence.overall,
    sourceMeta: input.sourceMeta ?? null,
    recipeId: null,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(importDrafts).values(row);
  return toDraftWire(row);
}

/**
 * Loads a draft and verifies it belongs to `householdId`.
 * @throws ApiError 404 when it does not exist in that household (never leaks
 *   whether the id exists in a different household).
 */
export async function getDraftOr404(db: Database, householdId: string, draftId: string): Promise<ImportDraftRow> {
  const rows = await db
    .select()
    .from(importDrafts)
    .where(and(eq(importDrafts.id, draftId), eq(importDrafts.householdId, householdId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw ApiError.notFound("server.import.draftNotFound");
  return row;
}

export interface ListDraftsQuery {
  status?: ImportDraftStatus;
  limit: number;
  offset: number;
}

export interface DraftList {
  items: ImportDraft[];
  total: number;
  limit: number;
  offset: number;
}

/** Paginated draft listing for a household, newest first. */
export async function listDrafts(db: Database, householdId: string, query: ListDraftsQuery): Promise<DraftList> {
  const where =
    query.status === undefined
      ? eq(importDrafts.householdId, householdId)
      : and(eq(importDrafts.householdId, householdId), eq(importDrafts.status, query.status));

  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(importDrafts)
      .where(where)
      .orderBy(desc(importDrafts.createdAt))
      .limit(query.limit)
      .offset(query.offset),
    db.select({ value: count() }).from(importDrafts).where(where),
  ]);

  return {
    items: rows.map(toDraftWire),
    total: Number(totals[0]?.value ?? 0),
    limit: query.limit,
    offset: query.offset,
  };
}

export interface UpdateDraftInput {
  parsed?: ParsedRecipe;
  status?: ImportDraftStatus;
  recipeId?: string | null;
}

/** Applies review-screen edits. Keeps `confidence` in sync with `parsed`. */
export async function updateDraft(
  db: Database,
  draftId: string,
  input: UpdateDraftInput,
): Promise<void> {
  const patch: Partial<ImportDraftRow> = { updatedAt: Date.now() };
  if (input.parsed !== undefined) {
    const parsed = normalizeParsedForStorage(input.parsed);
    patch.parsed = parsed;
    patch.confidence = parsed.confidence.overall;
  }
  if (input.status !== undefined) patch.status = input.status;
  if (input.recipeId !== undefined) patch.recipeId = input.recipeId;
  await db.update(importDrafts).set(patch).where(eq(importDrafts.id, draftId));
}

/** Hard-deletes a draft row. The caller unlinks the stored upload. */
export async function deleteDraft(db: Database, draftId: string): Promise<void> {
  await db.delete(importDrafts).where(eq(importDrafts.id, draftId));
}

/** Stored upload filename of a draft, if it had one. */
export function storedFilenameOf(row: ImportDraftRow): string | undefined {
  const meta = row.sourceMeta;
  if (meta === null || typeof meta !== "object") return undefined;
  const storedPath = (meta as ImportSourceMeta).storedPath;
  return typeof storedPath === "string" && storedPath.length > 0 ? storedPath : undefined;
}
