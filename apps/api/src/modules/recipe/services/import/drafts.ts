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
 *
 * AS A SERVICE (docs/EFFECT.md E7, E12; plan `docs/plans/e3-recipe-services.md` P2, P8, P9). `ImportDrafts` reads the
 * current executor of `Database` on every call (the import routes hand in the pinned tests' file DB with
 * `withImportDb`, P6), takes its timestamps from the `Clock` and refuses with the tagged family.
 * `toDraftWire` and `storedFilenameOf` stay pure exports. The Promise bridges at the end of the file keep
 * `routes/imports.ts` and the import tests working until E3-T07 and E3-T11.
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
import { Clock, Context, Effect, Layer, Option } from "effect";
import type { Database as DrizzleDatabase } from "../../../../db/client.ts";
import { Database } from "../../../../db/database.ts";
import { type ImportDraftRow, importDrafts } from "../../../../db/schema.ts";
import { NotFound } from "../../../../lib/errors.ts";
import type { DatabaseError } from "../../../../lib/errors.ts";
import { runtime } from "../../../../runtime.ts";
import { decodeOption } from "../../../../lib/validate.ts";
import { toIso } from "../../../../lib/http.ts";
import { normalizeStoredUploadUrl, signUploadUrl } from "../../../../lib/uploadUrls.ts";

/** Row -> contract shape. Never throws on malformed JSON columns. */
export function toDraftWire(row: ImportDraftRow): ImportDraft {
  const stored: ParsedRecipe = Option.getOrElse(decodeOption(ParsedRecipeSchema, row.parsed), () =>
    emptyParsedRecipe({ confidence: { overall: 0 } }),
  );

  // The URL importer downloads a hero image into UPLOAD_DIR and puts the bare
  // `/uploads/<uuid>` into parsed.imageUrl, so the review screen needs it signed
  // like any other hero image. `sourceMeta.storedPath` is deliberately NOT signed:
  // the uploaded photo/PDF is private and is served only by the membership-checked
  // /imports/:draftId/source route (see lib/uploadUrls.ts).
  const parsed: ParsedRecipe = { ...stored, imageUrl: signUploadUrl(stored.imageUrl) };

  const sourceMeta: ImportSourceMeta | null =
    row.sourceMeta === null ? null : Option.getOrNull(decodeOption(ImportSourceMetaSchema, row.sourceMeta));

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

export interface UpdateDraftInput {
  parsed?: ParsedRecipe;
  status?: ImportDraftStatus;
  recipeId?: string | null;
}

/** The `import_drafts` repository: create, read, list, edit and delete a draft. */
export class ImportDrafts extends Context.Service<
  ImportDrafts,
  {
    /** Inserts a pending draft and returns it in wire shape. */
    readonly createDraft: (input: CreateDraftInput) => Effect.Effect<ImportDraft, DatabaseError>;
    /**
     * Loads a draft and verifies it belongs to `householdId`.
     * Fails with 404 when it does not exist in that household (never leaks
     * whether the id exists in a different household).
     */
    readonly getDraftOr404: (
      householdId: string,
      draftId: string,
    ) => Effect.Effect<ImportDraftRow, NotFound | DatabaseError>;
    /** Paginated draft listing for a household, newest first. */
    readonly listDrafts: (householdId: string, query: ListDraftsQuery) => Effect.Effect<DraftList, DatabaseError>;
    /** Applies review-screen edits. Keeps `confidence` in sync with `parsed`. */
    readonly updateDraft: (draftId: string, input: UpdateDraftInput) => Effect.Effect<void, DatabaseError>;
    /** Hard-deletes a draft row. The caller unlinks the stored upload. */
    readonly deleteDraft: (draftId: string) => Effect.Effect<void, DatabaseError>;
  }
>()("toon/api/modules/recipe/services/import/drafts/ImportDrafts") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const database = yield* Database;

      const createDraft = Effect.fn("ImportDrafts.createDraft")(function* (input: CreateDraftInput) {
        const now = yield* Clock.currentTimeMillis;
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
        yield* database.use((db) => db.insert(importDrafts).values(row));
        return toDraftWire(row);
      });

      const getDraftOr404 = Effect.fn("ImportDrafts.getDraftOr404")(function* (householdId: string, draftId: string) {
        const rows = yield* database.use((db) =>
          db
            .select()
            .from(importDrafts)
            .where(and(eq(importDrafts.id, draftId), eq(importDrafts.householdId, householdId)))
            .limit(1),
        );
        const row = rows[0];
        if (!row) return yield* new NotFound({ text: "server.import.draftNotFound" });
        return row;
      });

      const listDrafts = Effect.fn("ImportDrafts.listDrafts")(function* (householdId: string, query: ListDraftsQuery) {
        const where =
          query.status === undefined
            ? eq(importDrafts.householdId, householdId)
            : and(eq(importDrafts.householdId, householdId), eq(importDrafts.status, query.status));

        const [rows, totals] = yield* Effect.all([
          database.use((db) =>
            db
              .select()
              .from(importDrafts)
              .where(where)
              .orderBy(desc(importDrafts.createdAt))
              .limit(query.limit)
              .offset(query.offset),
          ),
          database.use((db) => db.select({ value: count() }).from(importDrafts).where(where)),
        ]);

        return {
          items: rows.map(toDraftWire),
          total: Number(totals[0]?.value ?? 0),
          limit: query.limit,
          offset: query.offset,
        } satisfies DraftList;
      });

      const updateDraft = Effect.fn("ImportDrafts.updateDraft")(function* (draftId: string, input: UpdateDraftInput) {
        const patch: Partial<ImportDraftRow> = { updatedAt: yield* Clock.currentTimeMillis };
        if (input.parsed !== undefined) {
          const parsed = normalizeParsedForStorage(input.parsed);
          patch.parsed = parsed;
          patch.confidence = parsed.confidence.overall;
        }
        if (input.status !== undefined) patch.status = input.status;
        if (input.recipeId !== undefined) patch.recipeId = input.recipeId;
        yield* database.use((db) => db.update(importDrafts).set(patch).where(eq(importDrafts.id, draftId)));
      });

      const deleteDraft = Effect.fn("ImportDrafts.deleteDraft")(function* (draftId: string) {
        yield* database.use((db) => db.delete(importDrafts).where(eq(importDrafts.id, draftId)));
      });

      return ImportDrafts.of({ createDraft, getDraftOr404, listDrafts, updateDraft, deleteDraft });
    }),
  );
}

/** Stored upload filename of a draft, if it had one. */
export function storedFilenameOf(row: ImportDraftRow): string | undefined {
  const meta = row.sourceMeta;
  if (meta === null || typeof meta !== "object") return undefined;
  const storedPath = (meta as ImportSourceMeta).storedPath;
  return typeof storedPath === "string" && storedPath.length > 0 ? storedPath : undefined;
}

/* legacy bridges: callers listed; E3 (recipe), E4 (finance), E5 (scripts) remove them */

// Every bridge honours its `db` argument with `Database.withExecutor(db)` (plan e3 P1). A failure rejects with the
// tagged error itself (`getDraftOr404`: the `NotFound`, which is an `ApiError`). Promise.

/** Callers: `routes/imports.ts` (E3-T11), `apps/api/test/import/{commit,ocr-disabled}.test.ts` (pinned: E3-T13, E8). */
export function createDraft(db: DrizzleDatabase, input: CreateDraftInput): Promise<ImportDraft> {
  return runtime.runPromise(ImportDrafts.use((s) => s.createDraft(input)).pipe(Database.withExecutor(db)));
}

/** Callers: `routes/imports.ts` (E3-T11), `apps/api/test/import/commit.test.ts`. */
export function getDraftOr404(db: DrizzleDatabase, householdId: string, draftId: string): Promise<ImportDraftRow> {
  return runtime.runPromise(
    ImportDrafts.use((s) => s.getDraftOr404(householdId, draftId)).pipe(Database.withExecutor(db)),
  );
}

/** Callers: `routes/imports.ts` (E3-T11), `apps/api/test/import/commit.test.ts`. */
export function listDrafts(db: DrizzleDatabase, householdId: string, query: ListDraftsQuery): Promise<DraftList> {
  return runtime.runPromise(ImportDrafts.use((s) => s.listDrafts(householdId, query)).pipe(Database.withExecutor(db)));
}

/** Callers: `routes/imports.ts` (E3-T11), `apps/api/test/import/commit.test.ts`. */
export function updateDraft(db: DrizzleDatabase, draftId: string, input: UpdateDraftInput): Promise<void> {
  return runtime.runPromise(ImportDrafts.use((s) => s.updateDraft(draftId, input)).pipe(Database.withExecutor(db)));
}

/** Callers: `routes/imports.ts` (E3-T11). */
export function deleteDraft(db: DrizzleDatabase, draftId: string): Promise<void> {
  return runtime.runPromise(ImportDrafts.use((s) => s.deleteDraft(draftId)).pipe(Database.withExecutor(db)));
}
