/**
 * OWNER: import/OCR agent.
 *
 * Mounted at /api/households/:householdId/recipe/imports (via routes/index.ts, behind the
 * module chain), so paths declared here are relative: "/url", "/image", "/pdf", "/text", "/:draftId", ...
 * Every import creates an ImportDraft that the user reviews before it becomes a
 * recipe. OCR lives behind the OcrEngine interface in services/ocr/.
 *
 * Endpoint contract: docs/API.md (section "Imports").
 * Auth: the module chain (modules/mount.ts) runs `requireSession()` ->
 * `requireHouseholdRole("member")` -> `requireModule("recipe")` before this router, so no
 * handler checks the session or membership itself; the router adds only
 * `requireVerifiedEmail()` on top.
 *
 * PHOTO/PDF IMPORT IS OPT-IN, AND THE TWO ARE SEPARATE FLAGS. `/image` needs
 * IMPORT_OCR_ENABLED, `/pdf` needs IMPORT_PDF_ENABLED (which follows the first
 * unless set), `/file` needs whichever kind was actually uploaded; otherwise 501
 * `ocr_disabled` — see services/import/capabilities.ts for why (native binaries +
 * memory a small VPS should not have to pay for, and a PDF costs an order of
 * magnitude more than a photo). `/url`, `/text`, the draft endpoints and commit
 * are always available, and a draft that OCR produced earlier stays reviewable.
 *
 * OCR IS SYNCHRONOUS but bounded on three axes, because one member must not be
 * able to flatten a self-hosted box with a loop of 15 MB uploads:
 *   - IMPORT_RULE  10 imports per user per minute (429 rate_limited),
 *   - withOcrSlot  at most IMPORT_OCR_CONCURRENCY pipelines process-wide; beyond
 *     that a request WAITS up to OCR_SLOT_WAIT_MS and only then 429s,
 *   - OCR_TIMEOUT_MS  a raced deadline that starts AFTER the slot is acquired, so
 *     queueing never eats the recognition's own budget and the request is answered
 *     at 60 s even when unpdf ignores the abort signal (504 ocr_failed).
 * The natural next step is a job queue plus a draft the client polls.
 */
import { existsSync } from "node:fs";
import {
  type CommitImportDraftResponse,
  type ImportDraftListResponse,
  type ImportDraftResponse,
  CommitImportDraftRequestSchema,
  ImportDraftListQuerySchema,
  ImportTextRequestSchema,
  ImportUrlRequestSchema,
  ParsedRecipeSchema,
  UpdateImportDraftRequestSchema,
} from "@toon/shared";
import { Effect, type Schema } from "effect";
import { Hono } from "hono";
import { BadRequest, Conflict, NotFound } from "../../../lib/errors.ts";
import { decode, type Decodable, type Decoded } from "../../../lib/validate.ts";
import { created, json, noContent } from "../../../lib/http.ts";
import { type AppContext, type AppEnv, currentMembership, currentUser } from "../../../lib/types.ts";
import { IMPORT_RULE, RateLimiter } from "../../../core/services/auth/rateLimit.ts";
import { requireVerifiedEmail } from "../../../middleware/verifiedEmail.ts";
import { runtime } from "../../../runtime.ts";
import { ImportCapabilities } from "../services/import/capabilities.ts";
import { ImportCommit } from "../services/import/commit.ts";
/* the import database seam (plan e3 P6) */ import { withImportDb } from "../services/import/db.ts";
import { ImportDrafts, storedFilenameOf, toDraftWire } from "../services/import/drafts.ts";
import { type ImportFileKind, ImportFiles } from "../services/import/files.ts";
import { OcrImporter } from "../services/import/ocr/index.ts";
import { UrlImporter } from "../services/import/url/index.ts";
import { Ocr } from "../services/ocr/index.ts";

export const importRoutes = new Hono<AppEnv>();

// Importing is the loudest write in the app — it fetches, OCRs and then creates
// rows — so an account whose address was never confirmed gets 403
// `email_unverified` on every non-GET here (drafts stay READABLE). This is the
// anti-spam gate, not a capability: see services/auth/verifiedEmail.ts.
importRoutes.use("*", requireVerifiedEmail());

/* -------------------------------- helpers --------------------------------- */

/**
 * Parses a JSON body with a shared schema, mapping malformed JSON to 400. A decode failure fails with the
 * `Schema.SchemaError` the boundary renders as 422 validation_failed.
 */
const readJson = Effect.fnUntraced(function* <S extends Decodable>(
  c: AppContext,
  schema: S,
): Effect.fn.Return<Decoded<S>, BadRequest | Schema.SchemaError> {
  const body: unknown = yield* Effect.tryPromise({
    try: (): Promise<unknown> => c.req.json(),
    catch: () => new BadRequest({ text: "server.import.invalidJsonBody" }),
  });
  return yield* decode(schema, body);
});

/* ------------------------------ URL import -------------------------------- */

/** POST /api/households/:householdId/recipe/imports/url */
importRoutes.post("/url", (c) =>
  runtime.runPromise(
    withImportDb(
      Effect.gen(function* () {
        const rateLimiter = yield* RateLimiter;
        const urlImporter = yield* UrlImporter;
        const drafts = yield* ImportDrafts;
        const user = yield* currentUser(c);
        const { householdId } = yield* currentMembership(c);
        const { url } = yield* readJson(c, ImportUrlRequestSchema);
        // An unmetered outbound fetcher (5 MB x 5 redirects per call) is an
        // amplification tool pointed at third parties, not just a load problem here.
        yield* rateLimiter.enforce("import", user.id, IMPORT_RULE);

        const result = yield* urlImporter.importFromUrl(url);
        const draft = yield* drafts.createDraft({
          householdId,
          createdBy: user.id,
          sourceType: "url",
          parsed: result.parsed,
          rawText: result.rawText,
          sourceUrl: result.sourceUrl,
          sourceMeta: result.sourceMeta,
        });

        return created<ImportDraftResponse>(c, { draft });
      }),
    ),
  ),
);

/* -------------------- OCR uploads: image / pdf / file --------------------- */

/**
 * The three multipart OCR endpoints, which differ ONLY in which sniffed kinds
 * they accept — the pipeline is picked from the sniffed content either way, so
 * `/file` is `/image` and `/pdf` with a wider `accept`.
 *
 * ORDER INSIDE THE HANDLER IS PART OF THE CONTRACT: the capability guard runs
 * FIRST, before the rate limit and before the body is read, so a deployment
 * without OCR never spends a bucket slot or buffers 15 MB to produce a 501.
 * `test/import/ocr-disabled.test.ts` pins both.
 *
 * PHOTOS AND PDFS ARE GATED SEPARATELY, so `/file` needs TWO guards: the one up
 * front can only rule out "neither kind is available", and the kind that actually
 * arrived is not known until the body has been sniffed. A PDF sent to an
 * image-only server therefore does get buffered before its 501 — unavoidable, and
 * the reason the single-kind routes keep their own precise guard.
 */
function ocrUploadHandler(accept: readonly ImportFileKind[]) {
  return (c: AppContext) =>
    runtime.runPromise(
      withImportDb(
        Effect.gen(function* () {
          const capabilities = yield* ImportCapabilities;
          const rateLimiter = yield* RateLimiter;
          const files = yield* ImportFiles;
          const ocr = yield* Ocr;
          const importer = yield* OcrImporter;
          const drafts = yield* ImportDrafts;
          const user = yield* currentUser(c);
          const { householdId } = yield* currentMembership(c);

          // The up-front guard: what this route accepts, against what the server offers.
          if (accept.length > 1) yield* capabilities.checkAnyUploadImportEnabled;
          else if (accept[0] === "pdf") yield* capabilities.checkPdfImportEnabled;
          else yield* capabilities.checkOcrImportEnabled;
          yield* rateLimiter.enforce("import", user.id, IMPORT_RULE);

          const file = yield* files.readUploadedFile(c.req.raw, { accept });
          // The precise guard, once the kind is known (sniffed content, never the name).
          if (file.kind === "pdf") yield* capabilities.checkPdfImportEnabled;
          else yield* capabilities.checkOcrImportEnabled;
          // Omitted rather than undefined: the option types are exactOptionalPropertyTypes-shaped.
          const named = file.originalName === undefined ? {} : { originalName: file.originalName };
          const result = yield* ocr.withOcrSlot(
            file.kind === "pdf"
              ? importer.importFromPdf(file.bytes, named)
              : importer.importFromImage(file.bytes, { mimeType: file.mimeType, ...named }),
          );

          const draft = yield* drafts.createDraft({
            householdId,
            createdBy: user.id,
            sourceType: "ocr",
            parsed: result.parsed,
            rawText: result.rawText,
            sourceMeta: result.sourceMeta,
          });

          return created<ImportDraftResponse>(c, { draft });
        }),
      ),
    );
}

/** POST /api/households/:householdId/recipe/imports/image — multipart `file`, image/* only. */
importRoutes.post("/image", ocrUploadHandler(["image"]));

/** POST /api/households/:householdId/recipe/imports/pdf — multipart `file`, application/pdf only. */
importRoutes.post("/pdf", ocrUploadHandler(["pdf"]));

/**
 * POST /api/households/:householdId/recipe/imports/file — convenience endpoint for the mobile
 * UI, which uses ONE `<input type="file">` for photos and PDFs alike. The kind is
 * decided by SNIFFED content, never by the filename. Additive to the contract.
 */
importRoutes.post("/file", ocrUploadHandler(["image", "pdf"]));

/* ------------------------------ text import ------------------------------- */

/** POST /api/households/:householdId/recipe/imports/text */
importRoutes.post("/text", (c) =>
  runtime.runPromise(
    withImportDb(
      Effect.gen(function* () {
        const rateLimiter = yield* RateLimiter;
        const importer = yield* OcrImporter;
        const drafts = yield* ImportDrafts;
        const user = yield* currentUser(c);
        const { householdId } = yield* currentMembership(c);
        const body = yield* readJson(c, ImportTextRequestSchema);
        yield* rateLimiter.enforce("import", user.id, IMPORT_RULE);

        const result = yield* importer.importFromText(body.rawText, body.title === undefined ? {} : { title: body.title });
        const draft = yield* drafts.createDraft({
          householdId,
          createdBy: user.id,
          sourceType: "manual",
          parsed: result.parsed,
          rawText: result.rawText,
          sourceMeta: result.sourceMeta,
        });

        return created<ImportDraftResponse>(c, { draft });
      }),
    ),
  ),
);

/* --------------------------------- listing -------------------------------- */

/** GET /api/households/:householdId/recipe/imports?status=pending */
importRoutes.get("/", (c) =>
  runtime.runPromise(
    withImportDb(
      Effect.gen(function* () {
        const drafts = yield* ImportDrafts;
        const { householdId } = yield* currentMembership(c);
        const query = yield* decode(ImportDraftListQuerySchema, c.req.query());
        const list = yield* drafts.listDrafts(householdId, query);
        return json<ImportDraftListResponse>(c, list);
      }),
    ),
  ),
);

/* ------------------------------ single draft ------------------------------ */

/** GET /api/households/:householdId/recipe/imports/:draftId */
importRoutes.get("/:draftId", (c) =>
  runtime.runPromise(
    withImportDb(
      Effect.gen(function* () {
        const drafts = yield* ImportDrafts;
        const { householdId } = yield* currentMembership(c);
        const row = yield* drafts.getDraftOr404(householdId, c.req.param("draftId"));
        return json<ImportDraftResponse>(c, { draft: toDraftWire(row) });
      }),
    ),
  ),
);

/**
 * GET /api/households/:householdId/recipe/imports/:draftId/source — the uploaded photo/PDF this
 * draft came from. Membership-checked (unlike the public /uploads/:filename route
 * in src/index.ts) and path-traversal-safe. Additive to the contract.
 */
importRoutes.get("/:draftId/source", (c) =>
  runtime.runPromise(
    withImportDb(
      Effect.gen(function* () {
        const drafts = yield* ImportDrafts;
        const files = yield* ImportFiles;
        const { householdId } = yield* currentMembership(c);
        const row = yield* drafts.getDraftOr404(householdId, c.req.param("draftId"));

        const filename = storedFilenameOf(row);
        if (filename === undefined) return yield* new NotFound({ text: "server.import.noSourceFile" });

        const absolute = yield* files.resolveUploadPath(filename);
        if (!existsSync(absolute)) return yield* new NotFound({ text: "server.import.sourceFileDeleted" });

        const file = Bun.file(absolute);
        return new Response(file, {
          headers: {
            "Content-Type": file.type || "application/octet-stream",
            "Cache-Control": "private, max-age=3600",
            "Content-Disposition": `inline; filename="${filename}"`,
          },
        });
      }),
    ),
  ),
);

/** PATCH /api/households/:householdId/recipe/imports/:draftId — save review-screen edits. */
importRoutes.patch("/:draftId", (c) =>
  runtime.runPromise(
    withImportDb(
      Effect.gen(function* () {
        const drafts = yield* ImportDrafts;
        const { householdId } = yield* currentMembership(c);
        const draftId = c.req.param("draftId");
        const row = yield* drafts.getDraftOr404(householdId, draftId);
        if (row.status === "reviewed") {
          return yield* new Conflict({ code: "conflict", text: "server.import.draftAlreadyCommitted" });
        }

        const body = yield* readJson(c, UpdateImportDraftRequestSchema);
        yield* drafts.updateDraft(draftId, {
          parsed: body.parsed,
          ...(body.status === undefined ? {} : { status: body.status }),
        });

        const updated = yield* drafts.getDraftOr404(householdId, draftId);
        return json<ImportDraftResponse>(c, { draft: toDraftWire(updated) });
      }),
    ),
  ),
);

/** POST /api/households/:householdId/recipe/imports/:draftId/commit — create the real recipe. */
importRoutes.post("/:draftId/commit", (c) =>
  runtime.runPromise(
    withImportDb(
      Effect.gen(function* () {
        const drafts = yield* ImportDrafts;
        const commit = yield* ImportCommit;
        const user = yield* currentUser(c);
        const { householdId } = yield* currentMembership(c);
        const draftId = c.req.param("draftId");

        const row = yield* drafts.getDraftOr404(householdId, draftId);
        if (row.status === "reviewed" && row.recipeId !== null) {
          return yield* new Conflict({ code: "conflict", text: "server.import.draftAlreadyCommitted" });
        }

        const body = yield* readJson(c, CommitImportDraftRequestSchema);
        // The client may send the edited payload; otherwise the stored draft is used.
        const parsed = body.parsed ?? (yield* decode(ParsedRecipeSchema, row.parsed));

        const result = yield* commit.commitDraft({
          householdId,
          draftId,
          userId: user.id,
          parsed,
          ...(body.tags === undefined ? {} : { tagNames: body.tags }),
          ...(body.collectionIds === undefined ? {} : { collectionIds: body.collectionIds }),
        });

        const committed = yield* drafts.getDraftOr404(householdId, draftId);
        return created<CommitImportDraftResponse>(
          c,
          { recipe: result.recipe, draft: toDraftWire(committed) },
          `/api/households/${householdId}/recipe/recipes/${result.recipeId}`,
        );
      }),
    ),
  ),
);

/** DELETE /api/households/:householdId/recipe/imports/:draftId — discard + unlink the upload. */
importRoutes.delete("/:draftId", (c) =>
  runtime.runPromise(
    withImportDb(
      Effect.gen(function* () {
        const drafts = yield* ImportDrafts;
        const files = yield* ImportFiles;
        const { householdId } = yield* currentMembership(c);
        const draftId = c.req.param("draftId");
        const row = yield* drafts.getDraftOr404(householdId, draftId);

        yield* drafts.deleteDraft(draftId);
        // Only after the row is gone: an orphaned file is better than a draft that
        // points at a file which no longer exists.
        yield* files.deleteUpload(storedFilenameOf(row));

        return noContent(c);
      }),
    ),
  ),
);

export default importRoutes;
