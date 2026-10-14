/**
 * OWNER: import/OCR agent.
 *
 * Mounted at /api/households/:householdId/recipe/imports (via routes/index.ts, behind the
 * module chain), so paths declared here are relative: "/url", "/image", "/pdf", "/text", "/:draftId", ...
 * Every import creates an ImportDraft that the user reviews before it becomes a
 * recipe. OCR lives behind the OcrEngine interface in src/services/ocr/.
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
import { Hono, type Context } from "hono";
import type { z } from "zod";
import { ApiError } from "../../../lib/errors.ts";
import { created, json, noContent } from "../../../lib/http.ts";
import { type AppEnv, requireMembership, requireUser } from "../../../lib/types.ts";
import { IMPORT_RULE, enforceRateLimit } from "../../../core/services/auth/rateLimit.ts";
import {
  assertAnyUploadImportEnabled,
  assertOcrImportEnabled,
  assertPdfImportEnabled,
} from "../services/import/capabilities.ts";
import { commitDraft } from "../services/import/commit.ts";
import { importDb } from "../services/import/db.ts";
import {
  createDraft,
  deleteDraft,
  getDraftOr404,
  listDrafts,
  storedFilenameOf,
  toDraftWire,
  updateDraft,
} from "../services/import/drafts.ts";
import {
  type ImportFileKind,
  deleteUpload,
  readUploadedFile,
  resolveUploadPath,
} from "../services/import/files.ts";
import { requireVerifiedEmail } from "../../../middleware/verifiedEmail.ts";
import { importFromImage, importFromPdf, importFromText } from "../services/import/ocr/index.ts";
import { importFromUrl } from "../services/import/url/index.ts";
import { withOcrSlot } from "../services/ocr/index.ts";

export const importRoutes = new Hono<AppEnv>();

// Importing is the loudest write in the app — it fetches, OCRs and then creates
// rows — so an account whose address was never confirmed gets 403
// `email_unverified` on every non-GET here (drafts stay READABLE). This is the
// anti-spam gate, not a capability: see services/auth/verifiedEmail.ts.
importRoutes.use("*", requireVerifiedEmail());

/* -------------------------------- helpers --------------------------------- */

/** Parses a JSON body with a Zod schema, mapping malformed JSON to 400. */
async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw ApiError.badRequest("server.import.invalidJsonBody");
  }
  // A ZodError becomes 422 validation_failed in the global error handler.
  return schema.parse(body);
}

/* ------------------------------ URL import -------------------------------- */

/** POST /api/households/:householdId/recipe/imports/url */
importRoutes.post("/url", async (c) => {
  const user = requireUser(c);
  const { householdId } = requireMembership(c);
  const { url } = await readJson(c.req.raw, ImportUrlRequestSchema);
  // An unmetered outbound fetcher (5 MB x 5 redirects per call) is an
  // amplification tool pointed at third parties, not just a load problem here.
  enforceRateLimit(c, "import", user.id, IMPORT_RULE);

  const result = await importFromUrl(url);
  const draft = await createDraft(importDb(), {
    householdId,
    createdBy: user.id,
    sourceType: "url",
    parsed: result.parsed,
    rawText: result.rawText,
    sourceUrl: result.sourceUrl,
    sourceMeta: result.sourceMeta,
  });

  return created<ImportDraftResponse>(c, { draft });
});

/* -------------------- OCR uploads: image / pdf / file --------------------- */

/** The up-front guard: what this route accepts, against what the server offers. */
function assertAcceptedKindEnabled(accept: readonly ImportFileKind[]): void {
  if (accept.length > 1) return assertAnyUploadImportEnabled();
  return assertUploadKindEnabled(accept[0]!);
}

/** The precise guard, once the kind is known (sniffed content, never the name). */
function assertUploadKindEnabled(kind: ImportFileKind): void {
  if (kind === "pdf") assertPdfImportEnabled();
  else assertOcrImportEnabled();
}

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
  return async (c: Context<AppEnv>) => {
    const user = requireUser(c);
    const { householdId } = requireMembership(c);

    assertAcceptedKindEnabled(accept);
    enforceRateLimit(c, "import", user.id, IMPORT_RULE);

    const file = await readUploadedFile(c.req.raw, { accept });
    assertUploadKindEnabled(file.kind);
    // Omitted rather than undefined: the option types are exactOptionalPropertyTypes-shaped.
    const named = file.originalName === undefined ? {} : { originalName: file.originalName };
    const result = await withOcrSlot(() =>
      file.kind === "pdf"
        ? importFromPdf(file.bytes, named)
        : importFromImage(file.bytes, { mimeType: file.mimeType, ...named }),
    );

    const draft = await createDraft(importDb(), {
      householdId,
      createdBy: user.id,
      sourceType: "ocr",
      parsed: result.parsed,
      rawText: result.rawText,
      sourceMeta: result.sourceMeta,
    });

    return created<ImportDraftResponse>(c, { draft });
  };
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
importRoutes.post("/text", async (c) => {
  const user = requireUser(c);
  const { householdId } = requireMembership(c);
  const body = await readJson(c.req.raw, ImportTextRequestSchema);
  enforceRateLimit(c, "import", user.id, IMPORT_RULE);

  const result = importFromText(body.rawText, body.title === undefined ? {} : { title: body.title });
  const draft = await createDraft(importDb(), {
    householdId,
    createdBy: user.id,
    sourceType: "manual",
    parsed: result.parsed,
    rawText: result.rawText,
    sourceMeta: result.sourceMeta,
  });

  return created<ImportDraftResponse>(c, { draft });
});

/* --------------------------------- listing -------------------------------- */

/** GET /api/households/:householdId/recipe/imports?status=pending */
importRoutes.get("/", async (c) => {
  const { householdId } = requireMembership(c);
  const query = ImportDraftListQuerySchema.parse(c.req.query());
  const list = await listDrafts(importDb(), householdId, query);
  return json<ImportDraftListResponse>(c, list);
});

/* ------------------------------ single draft ------------------------------ */

/** GET /api/households/:householdId/recipe/imports/:draftId */
importRoutes.get("/:draftId", async (c) => {
  const { householdId } = requireMembership(c);
  const row = await getDraftOr404(importDb(), householdId, c.req.param("draftId"));
  return json<ImportDraftResponse>(c, { draft: toDraftWire(row) });
});

/**
 * GET /api/households/:householdId/recipe/imports/:draftId/source — the uploaded photo/PDF this
 * draft came from. Membership-checked (unlike the public /uploads/:filename route
 * in src/index.ts) and path-traversal-safe. Additive to the contract.
 */
importRoutes.get("/:draftId/source", async (c) => {
  const { householdId } = requireMembership(c);
  const row = await getDraftOr404(importDb(), householdId, c.req.param("draftId"));

  const filename = storedFilenameOf(row);
  if (filename === undefined) throw ApiError.notFound("server.import.noSourceFile");

  const absolute = resolveUploadPath(filename);
  if (!existsSync(absolute)) throw ApiError.notFound("server.import.sourceFileDeleted");

  const file = Bun.file(absolute);
  return new Response(file, {
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": `inline; filename="${filename}"`,
    },
  });
});

/** PATCH /api/households/:householdId/recipe/imports/:draftId — save review-screen edits. */
importRoutes.patch("/:draftId", async (c) => {
  const { householdId } = requireMembership(c);
  const draftId = c.req.param("draftId");
  const row = await getDraftOr404(importDb(), householdId, draftId);
  if (row.status === "reviewed") {
    throw ApiError.conflict("conflict", "server.import.draftAlreadyCommitted");
  }

  const body = await readJson(c.req.raw, UpdateImportDraftRequestSchema);
  await updateDraft(importDb(), draftId, {
    parsed: body.parsed,
    ...(body.status === undefined ? {} : { status: body.status }),
  });

  const updated = await getDraftOr404(importDb(), householdId, draftId);
  return json<ImportDraftResponse>(c, { draft: toDraftWire(updated) });
});

/** POST /api/households/:householdId/recipe/imports/:draftId/commit — create the real recipe. */
importRoutes.post("/:draftId/commit", async (c) => {
  const user = requireUser(c);
  const { householdId } = requireMembership(c);
  const draftId = c.req.param("draftId");

  const row = await getDraftOr404(importDb(), householdId, draftId);
  if (row.status === "reviewed" && row.recipeId !== null) {
    throw ApiError.conflict("conflict", "server.import.draftAlreadyCommitted");
  }

  const body = await readJson(c.req.raw, CommitImportDraftRequestSchema);
  // The client may send the edited payload; otherwise the stored draft is used.
  const parsed = body.parsed ?? ParsedRecipeSchema.parse(row.parsed);

  const result = await commitDraft(importDb(), {
    householdId,
    draftId,
    userId: user.id,
    parsed,
    ...(body.tags === undefined ? {} : { tagNames: body.tags }),
    ...(body.collectionIds === undefined ? {} : { collectionIds: body.collectionIds }),
  });

  const committed = await getDraftOr404(importDb(), householdId, draftId);
  return created<CommitImportDraftResponse>(
    c,
    { recipe: result.recipe, draft: toDraftWire(committed) },
    `/api/households/${householdId}/recipe/recipes/${result.recipeId}`,
  );
});

/** DELETE /api/households/:householdId/recipe/imports/:draftId — discard + unlink the upload. */
importRoutes.delete("/:draftId", async (c) => {
  const { householdId } = requireMembership(c);
  const draftId = c.req.param("draftId");
  const row = await getDraftOr404(importDb(), householdId, draftId);

  await deleteDraft(importDb(), draftId);
  // Only after the row is gone: an orphaned file is better than a draft that
  // points at a file which no longer exists.
  await deleteUpload(storedFilenameOf(row));

  return noContent(c);
});

export default importRoutes;
