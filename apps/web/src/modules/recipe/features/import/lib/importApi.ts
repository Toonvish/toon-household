/**
 * API client for the import endpoints.
 *
 * This module is deliberately self-contained (no dependency on the shell's
 * generic `src/lib/api.ts`) because the upload calls need XHR to report real
 * progress and a long timeout for server-side OCR — neither of which a generic
 * JSON fetch helper provides. Cookies are always sent (`credentials: include` /
 * `xhr.withCredentials`), exactly like the rest of the app.
 *
 * Every failure is mapped to an ImportApiError carrying a specific title and
 * hint, so no screen ever has to render a bare "Error".
 *
 * Those two are catalog KEYS, not rendered strings (`ImportErrorText`). This
 * module is not a component, so it cannot hold a `useT()`; rendering here with
 * the ambient `translate()` would freeze the copy at throw time, and
 * `useAutosave` stores a hint in React state for minutes, so a locale switch
 * would leave a stale sentence on screen. Resolution therefore belongs to the
 * renderer — `useImportError()` / `resolveImportErrorText()` in
 * `./importErrorText.ts` — which is also what docs/i18n.md §10 rule 6 requires.
 */
import {
  ImportDraftListResponseSchema,
  ImportDraftResponseSchema,
  CommitImportDraftResponseSchema,
  TagListResponseSchema,
  type CommitImportDraftRequest,
  type CommitImportDraftResponse,
  type ImportDraft,
  type ImportDraftListQuery,
  type ImportDraftListResponse,
  type ImportDraftStatus,
  type Tag,
  type MessageValues,
  type UpdateImportDraftRequest,
} from "@toon/shared";
import type { ZodType } from "zod";
import { API_BASE_URL } from "@/modules/recipe/lib/api";
import type { MessageKey } from "@/lib/i18n/catalogs/index.ts";
import { getLocale } from "@/lib/i18n/store.ts";

/** Base URL of the API without trailing slash (single source of truth: @/lib/api). */
export function apiBaseUrl(): string {
  return API_BASE_URL;
}

/* -------------------------------------------------------------------------- */
/* errors                                                                      */
/* -------------------------------------------------------------------------- */

export type ImportErrorKind =
  | "network"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "too_large"
  | "unsupported_media_type"
  | "no_recipe_data"
  | "fetch_failed"
  | "ocr_failed"
  | "ocr_timeout"
  | "pdf_no_text_layer"
  | "validation"
  | "rate_limited"
  | "server"
  | "aborted"
  | "unknown";

/**
 * Copy that has not been rendered yet: either one of OUR catalog keys, or a
 * string this codebase did not write.
 *
 * The `{ text }` variant is what the server's own `message` arrives as. Unlike
 * the server-side `ErrorText` — where docs/i18n.md §4 deliberately REJECTED a
 * pass-through variant, because it would have become the escape hatch that kept
 * German sentences in handlers — a pass-through here is not a loophole: the
 * server already localised that sentence via `Accept-Language`, and an arbitrary
 * `Error.message` from a library genuinely has no key. It is still the minority
 * path; a hard-coded sentence in this file belongs in a catalog.
 */
export type ImportErrorText =
  | { readonly key: MessageKey; readonly values?: MessageValues }
  | { readonly text: string };

/** Log/stack-trace form: the key itself, never a translation. Stable and greppable. */
function errorTextForLog(text: ImportErrorText): string {
  return "text" in text ? text.text : text.key;
}

export class ImportApiError extends Error {
  readonly kind: ImportErrorKind;
  readonly code: string;
  readonly status: number;
  readonly details: unknown;
  /** Short headline for the UI, unrendered — see `ImportErrorText`. */
  readonly title: ImportErrorText;
  /** Long, actionable explanation for the UI, unrendered. */
  readonly hint: ImportErrorText;
  /** True when simply pressing the button again can help. */
  readonly retryable: boolean;

  constructor(init: {
    kind: ImportErrorKind;
    code: string;
    status: number;
    title: ImportErrorText;
    hint: ImportErrorText;
    retryable: boolean;
    details?: unknown;
  }) {
    // `Error.message` is for the console and for a crash report, so it holds the
    // KEY: a translated message in a log is unsearchable and depends on whoever
    // happened to be looking at the screen.
    super(errorTextForLog(init.title));
    this.name = "ImportApiError";
    this.kind = init.kind;
    this.code = init.code;
    this.status = init.status;
    this.title = init.title;
    this.hint = init.hint;
    this.retryable = init.retryable;
    this.details = init.details;
  }
}

interface ServerError {
  code?: string;
  message?: string;
  details?: unknown;
}

function readServerError(body: unknown): ServerError {
  if (typeof body !== "object" || body === null) return {};
  const envelope = (body as { error?: unknown }).error;
  if (typeof envelope !== "object" || envelope === null) return {};
  const { code, message, details } = envelope as ServerError;
  return {
    code: typeof code === "string" ? code : undefined,
    message: typeof message === "string" ? message : undefined,
    details,
  };
}

/**
 * Maps status + error code to a specific title/hint pair of catalog keys.
 *
 * The `kind` and the status/code tests are unchanged wire logic; only the copy
 * moved. Note that `toImportApiError` still keeps its OWN sentences for codes
 * the server also has a message for (docs/i18n.md §14 open question 3): these
 * hints are longer and more actionable than the server's one-liner. Collapsing
 * the two remains a deliberate follow-up, not an oversight.
 */
export function toImportApiError(status: number, body: unknown, fallbackMessage?: string): ImportApiError {
  const server = readServerError(body);
  const code = server.code ?? "unknown";
  const serverMessage = server.message;
  const make = (
    kind: ImportErrorKind,
    title: ImportErrorText,
    hint: MessageKey,
    retryable = false,
  ): ImportApiError =>
    new ImportApiError({ kind, code, status, title, hint: { key: hint }, retryable, details: server.details });

  if (status === 0) {
    return make("network", { key: "recipe.import.error.network.title" }, "recipe.import.error.network.hint", true);
  }
  if (status === 401 || code === "unauthorized") {
    return make("unauthorized", { key: "recipe.import.error.unauthorized.title" }, "recipe.import.error.unauthorized.hint");
  }
  if (status === 403 || code === "forbidden") {
    return make("forbidden", { key: "recipe.import.error.forbidden.title" }, "recipe.import.error.forbidden.hint");
  }
  if (status === 404 || code === "not_found") {
    return make("not_found", { key: "recipe.import.error.notFound.title" }, "recipe.import.error.notFound.hint");
  }
  if (status === 413 || code === "payload_too_large") {
    return make("too_large", { key: "recipe.import.error.tooLarge.title" }, "recipe.import.error.tooLarge.hint");
  }
  if (status === 415 || code === "unsupported_media_type") {
    return make(
      "unsupported_media_type",
      { key: "recipe.import.error.unsupportedMediaType.title" },
      "recipe.import.error.unsupportedMediaType.hint",
    );
  }
  if (code === "pdf_no_text_layer") {
    return make(
      "pdf_no_text_layer",
      { key: "recipe.import.error.pdfNoTextLayer.title" },
      "recipe.import.error.pdfNoTextLayer.hint",
    );
  }
  if (code === "ocr_failed") {
    return make("ocr_failed", { key: "recipe.import.error.ocrFailed.title" }, "recipe.import.error.ocrFailed.hint", true);
  }
  if (code === "parse_failed") {
    return make("no_recipe_data", { key: "recipe.import.error.noRecipeData.title" }, "recipe.import.error.noRecipeData.hint");
  }
  if (code === "fetch_failed") {
    return make("fetch_failed", { key: "recipe.import.error.fetchFailed.title" }, "recipe.import.error.fetchFailed.hint", true);
  }
  if (status === 504 || status === 408 || code === "timeout") {
    return make("ocr_timeout", { key: "recipe.import.error.ocrTimeout.title" }, "recipe.import.error.ocrTimeout.hint", true);
  }
  if (status === 429 || code === "rate_limited") {
    return make("rate_limited", { key: "recipe.import.error.rateLimited.title" }, "recipe.import.error.rateLimited.hint", true);
  }
  if (status === 422 || code === "validation_failed" || status === 400) {
    return make(
      "validation",
      passThroughOr(serverMessage, "recipe.import.error.validation.title"),
      "recipe.import.error.validation.hint",
    );
  }
  if (status >= 500) {
    return make("server", { key: "recipe.import.error.server.title" }, "recipe.import.error.server.hint", true);
  }
  return make(
    "unknown",
    passThroughOr(serverMessage ?? fallbackMessage, "recipe.import.error.unknown.title"),
    "recipe.import.error.unknown.hint",
    true,
  );
}

/**
 * The server's own message is already in the requester's locale (it negotiated
 * `Accept-Language`), so prefer it over second-guessing it with a key of ours.
 *
 * An EMPTY string is NOT a message: `describeError()` below hands this module
 * `message: ""` for a shell `ApiError` that carries none, and `readJson()`
 * synthesises the same for an unparseable body. Passing that straight through
 * renders a blank headline, which is exactly the "bare Fehler" this whole module
 * exists to avoid.
 */
function passThroughOr(serverMessage: string | undefined, fallbackKey: MessageKey): ImportErrorText {
  return serverMessage !== undefined && serverMessage.length > 0
    ? { text: serverMessage }
    : { key: fallbackKey };
}

export function isImportApiError(error: unknown): error is ImportApiError {
  return error instanceof ImportApiError;
}

/** A described error: never a bare "Error", always a title + explanation. */
export interface DescribedImportError {
  readonly title: ImportErrorText;
  readonly hint: ImportErrorText;
  readonly retryable: boolean;
}

/**
 * Never returns a bare "Error": always a title + explanation, both UNRENDERED
 * (see `ImportErrorText`). Render with `useImportError()` in a component, or
 * `resolveImportErrorText()` where you already hold a `t`.
 */
export function describeError(error: unknown): DescribedImportError {
  if (isImportApiError(error)) return { title: error.title, hint: error.hint, retryable: error.retryable };
  // Errors thrown by the shell's generic client (@/lib/api ApiError) carry the
  // same code/status pair, so they get the same specific copy.
  if (typeof error === "object" && error !== null) {
    const candidate = error as { status?: unknown; code?: unknown; message?: unknown };
    if (typeof candidate.status === "number" && typeof candidate.code === "string") {
      const mapped = toImportApiError(candidate.status, {
        error: { code: candidate.code, message: typeof candidate.message === "string" ? candidate.message : "" },
      });
      return { title: mapped.title, hint: mapped.hint, retryable: mapped.retryable };
    }
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return {
      title: { key: "recipe.import.error.aborted.title" },
      hint: { key: "recipe.import.error.aborted.hint" },
      retryable: true,
    };
  }
  if (error instanceof Error && error.message === "no_files") {
    return {
      title: { key: "recipe.import.error.noFiles.title" },
      hint: { key: "recipe.import.error.noFiles.hint" },
      retryable: true,
    };
  }
  return {
    title: { key: "recipe.import.error.unknown.title" },
    // A raw `Error.message` is not ours to key — pass it through when there is
    // one, and only then fall back to our own sentence.
    hint:
      error instanceof Error && error.message.length > 0
        ? { text: error.message }
        : { key: "recipe.import.error.unexpected.hint" },
    retryable: true,
  };
}

/* -------------------------------------------------------------------------- */
/* transport                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Validates a server payload but never fails the request over it: an additive
 * server change must not break the review screen, so a schema mismatch only logs.
 */
function parseOrPassThrough<T>(schema: ZodType<T>, payload: unknown, label: string): T {
  const result = schema.safeParse(payload);
  if (result.success) return result.data;
  if (import.meta.env.DEV) {
    console.warn(`[import] response from ${label} does not match the schema`, result.error);
  }
  return payload as T;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: { code: "internal_error", message: text.slice(0, 300) } };
  }
}

async function requestJson<T>(
  path: string,
  schema: ZodType<T>,
  init: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      credentials: "include",
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(init.headers ?? {}),
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw toImportApiError(0, undefined);
  }
  const payload = await readJson(response);
  if (!response.ok) throw toImportApiError(response.status, payload, response.statusText);
  return parseOrPassThrough(schema, payload, path);
}

async function requestNoContent(path: string, init: RequestInit = {}): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      credentials: "include",
      ...init,
      headers: { Accept: "application/json", ...(init.headers ?? {}) },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw toImportApiError(0, undefined);
  }
  if (!response.ok) throw toImportApiError(response.status, await readJson(response), response.statusText);
}

export interface UploadHandle {
  /** 0..1 while bytes are on the wire; 1 means "server is working". */
  onProgress?: (fraction: number) => void;
  /** Called once all bytes are uploaded and OCR starts. */
  onUploadComplete?: () => void;
  /** Only useful during the upload phase — OCR itself cannot be interrupted. */
  signal?: AbortSignal;
  /** Server-side OCR can take a while; default 4 minutes. */
  timeoutMs?: number;
}

const DEFAULT_UPLOAD_TIMEOUT_MS = 240_000;

/**
 * multipart upload with real progress via XHR (fetch cannot report request
 * progress in any shipping browser).
 */
function uploadFile<T>(path: string, file: File, schema: ZodType<T>, handle: UploadHandle = {}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${apiBaseUrl()}${path}`, true);
    xhr.withCredentials = true;
    xhr.responseType = "text";
    xhr.timeout = handle.timeoutMs ?? DEFAULT_UPLOAD_TIMEOUT_MS;
    xhr.setRequestHeader("Accept", "application/json");
    // Same negotiation as lib/api.ts's fetch calls (docs/i18n.md §4) — this is
    // the one XHR in the app, foundation-owned so the header lands in one
    // commit rather than something a later port has to remember.
    xhr.setRequestHeader("Accept-Language", getLocale());

    const abort = () => xhr.abort();
    handle.signal?.addEventListener("abort", abort, { once: true });
    const cleanup = () => handle.signal?.removeEventListener("abort", abort);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) handle.onProgress?.(Math.min(1, event.loaded / event.total));
    };
    xhr.upload.onload = () => {
      handle.onProgress?.(1);
      handle.onUploadComplete?.();
    };
    xhr.onerror = () => {
      cleanup();
      reject(toImportApiError(0, undefined));
    };
    xhr.ontimeout = () => {
      cleanup();
      reject(
        new ImportApiError({
          kind: "ocr_timeout",
          code: "timeout",
          status: 504,
          title: { key: "recipe.import.error.ocrTimeout.title" },
          // A CLIENT-side timeout: the server never answered at all, which is a
          // different situation from the 504 above (where it gave up itself),
          // hence its own hint.
          hint: { key: "recipe.import.error.ocrTimeoutClient.hint" },
          retryable: true,
        }),
      );
    };
    xhr.onabort = () => {
      cleanup();
      // English literal, not a key: `describeError()` matches on `name`, so this
      // string only ever reaches a console or a stack trace.
      reject(new DOMException("Upload aborted", "AbortError"));
    };
    xhr.onload = () => {
      cleanup();
      let payload: unknown;
      try {
        payload = xhr.responseText.length > 0 ? (JSON.parse(xhr.responseText) as unknown) : undefined;
      } catch {
        payload = { error: { code: "internal_error", message: xhr.responseText.slice(0, 300) } };
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(toImportApiError(xhr.status, payload, xhr.statusText));
        return;
      }
      resolve(parseOrPassThrough(schema, payload, path));
    };

    const form = new FormData();
    form.append("file", file, file.name);
    xhr.send(form);
  });
}

/* -------------------------------------------------------------------------- */
/* endpoints                                                                   */
/* -------------------------------------------------------------------------- */

const householdBase = (householdId: string) => `/api/households/${encodeURIComponent(householdId)}/recipe`;

export async function importFromUrl(householdId: string, url: string, signal?: AbortSignal): Promise<ImportDraft> {
  const response = await requestJson(`${householdBase(householdId)}/imports/url`, ImportDraftResponseSchema, {
    method: "POST",
    body: JSON.stringify({ url }),
    signal,
  });
  return response.draft;
}

export async function importFromText(
  householdId: string,
  rawText: string,
  title?: string,
  signal?: AbortSignal,
): Promise<ImportDraft> {
  const response = await requestJson(`${householdBase(householdId)}/imports/text`, ImportDraftResponseSchema, {
    method: "POST",
    body: JSON.stringify(title === undefined || title.length === 0 ? { rawText } : { rawText, title }),
    signal,
  });
  return response.draft;
}

export async function importImage(householdId: string, file: File, handle?: UploadHandle): Promise<ImportDraft> {
  const response = await uploadFile(
    `${householdBase(householdId)}/imports/image`,
    file,
    ImportDraftResponseSchema,
    handle,
  );
  return response.draft;
}

export async function importPdf(householdId: string, file: File, handle?: UploadHandle): Promise<ImportDraft> {
  const response = await uploadFile(`${householdBase(householdId)}/imports/pdf`, file, ImportDraftResponseSchema, handle);
  return response.draft;
}

export async function listDrafts(
  householdId: string,
  query: Partial<ImportDraftListQuery> = {},
  signal?: AbortSignal,
): Promise<ImportDraftListResponse> {
  const search = new URLSearchParams();
  if (query.status !== undefined) search.set("status", query.status);
  if (query.limit !== undefined) search.set("limit", String(query.limit));
  if (query.offset !== undefined) search.set("offset", String(query.offset));
  const queryString = search.toString();
  const suffix = queryString.length > 0 ? `?${queryString}` : "";
  return requestJson(`${householdBase(householdId)}/imports${suffix}`, ImportDraftListResponseSchema, { signal });
}

export async function getDraft(householdId: string, draftId: string, signal?: AbortSignal): Promise<ImportDraft> {
  const response = await requestJson(
    `${householdBase(householdId)}/imports/${encodeURIComponent(draftId)}`,
    ImportDraftResponseSchema,
    { signal },
  );
  return response.draft;
}

export async function patchDraft(
  householdId: string,
  draftId: string,
  body: UpdateImportDraftRequest,
  signal?: AbortSignal,
): Promise<ImportDraft> {
  const response = await requestJson(
    `${householdBase(householdId)}/imports/${encodeURIComponent(draftId)}`,
    ImportDraftResponseSchema,
    { method: "PATCH", body: JSON.stringify(body), signal },
  );
  return response.draft;
}

export async function commitDraft(
  householdId: string,
  draftId: string,
  body: CommitImportDraftRequest,
  signal?: AbortSignal,
): Promise<CommitImportDraftResponse> {
  return requestJson(
    `${householdBase(householdId)}/imports/${encodeURIComponent(draftId)}/commit`,
    CommitImportDraftResponseSchema,
    { method: "POST", body: JSON.stringify(body), signal },
  );
}

export async function deleteDraft(householdId: string, draftId: string): Promise<void> {
  await requestNoContent(`${householdBase(householdId)}/imports/${encodeURIComponent(draftId)}`, { method: "DELETE" });
}

/**
 * Fetches the SOURCE SCAN of a draft (the uploaded photo or PDF) as an object URL.
 *
 * This deliberately goes through the membership-checked endpoint
 * `GET /api/households/:householdId/recipe/imports/:draftId/source` rather than `/uploads/<file>`.
 * The scan can be a photo of a private page, and the public route used to hand it
 * to anyone who had ever seen the URL, forever — including a member who had since
 * been removed from the household. The public route now also demands a signature, and
 * the API mints none for source scans, so this is the ONLY way to read one.
 *
 * A cross-origin `<img src>` cannot send the session cookie, hence fetch + blob.
 * THE CALLER MUST `URL.revokeObjectURL()` the result when it stops rendering it,
 * or the bytes stay alive for the lifetime of the document.
 */
export async function fetchDraftSource(
  householdId: string,
  draftId: string,
  signal?: AbortSignal,
): Promise<{ objectUrl: string; mimeType: string }> {
  let response: Response;
  try {
    response = await fetch(
      `${apiBaseUrl()}${householdBase(householdId)}/imports/${encodeURIComponent(draftId)}/source`,
      { credentials: "include", ...(signal === undefined ? {} : { signal }) },
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw toImportApiError(0, undefined);
  }
  if (!response.ok) {
    throw toImportApiError(response.status, await readJson(response), response.statusText);
  }
  const blob = await response.blob();
  return { objectUrl: URL.createObjectURL(blob), mimeType: blob.type };
}

/** Tag suggestions for the review screen's tag input. */
export async function listHouseholdTags(householdId: string, signal?: AbortSignal): Promise<Tag[]> {
  const response = await requestJson(`${householdBase(householdId)}/tags`, TagListResponseSchema, { signal });
  return response.items;
}

export type { ImportDraftStatus };
