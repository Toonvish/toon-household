/**
 * API client for the import endpoints.
 *
 * This module is deliberately self-contained (it does not use the shell's generic JSON client in
 * `src/lib/api.ts`): it keeps its own request headers (`Accept`, and `Content-Type` for a body; NO
 * `Accept-Language` on the JSON calls), no 401 redirect hook and its own failure mapping to
 * `ImportApiError`. It no longer calls `fetch`: the three JSON calls go through the runtime's
 * `HttpClient` (`@/lib/runtime`, which sends the cookies: `credentials: "include"`), and the upload
 * calls need XHR to report real progress and a long timeout for server-side OCR (neither of which a
 * fetch-based client provides), so the XHR is wrapped in `Effect.callback` (the one
 * `new XMLHttpRequest` of the web app). The cookies go with it too (`xhr.withCredentials`), exactly
 * like the rest of the app.
 *
 * The endpoints are Effects on the `ImportApi` namespace; the exported functions with the old names
 * and signatures (a positional `signal`, the `UploadHandle`) run them through `runPromise`.
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
 *
 * `statusText`: the runtime's `HttpClientResponse` has none, so the three JSON paths map a failure with
 * `toImportApiError(status, payload, undefined)`: an unmapped status without an envelope `message` shows the
 * catalog headline `recipe.import.error.unknown.title` (plan e6 D4). The XHR path keeps `xhr.statusText`.
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
import { Effect, Predicate, Result, Schema } from "effect";
import { HttpBody, HttpClient, HttpClientRequest, type HttpClientResponse } from "effect/http";
import type { Decodable, Decoded } from "@/lib/validation";
import { API_BASE_URL } from "@/modules/recipe/lib/api";
import type { MessageKey } from "@/lib/i18n/catalogs/index.ts";
import { getLocale } from "@/lib/i18n/store.ts";
import { runPromise } from "@/lib/runtime";

/** Base URL of the API without trailing slash (single source of truth: @/lib/api). */
export function apiBaseUrl(): string {
  return API_BASE_URL;
}

/* -------------------------------------------------------------------------- */
/* errors                                                                      */
/* -------------------------------------------------------------------------- */

/** The 16 kinds, in one place: the type below and the `kind` field of `ImportApiError` derive from it. */
const ImportErrorKindSchema = Schema.Literals([
  "network",
  "unauthorized",
  "forbidden",
  "not_found",
  "too_large",
  "unsupported_media_type",
  "no_recipe_data",
  "fetch_failed",
  "ocr_failed",
  "ocr_timeout",
  "pdf_no_text_layer",
  "validation",
  "rate_limited",
  "server",
  "aborted",
  "unknown",
] as const);

export type ImportErrorKind = typeof ImportErrorKindSchema.Type;

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

/**
 * The `title` / `hint` fields: typed as `ImportErrorText`, accepting any object at runtime (no check on the key or
 * the values), so a constructor never throws inside an error path (the `Text` pattern of apps/api/src/lib/errors.ts).
 */
const ImportErrorTextSchema = Schema.declare<ImportErrorText>((u): u is ImportErrorText => Predicate.isObject(u));

/**
 * Every import failure. A `Schema.TaggedError` (`_tag` and `name` are `"ImportApiError"`) with permissive field
 * schemas, and `message` is the KEY of the title: `Error.message` is for the console and for a crash report, so a
 * translated message in a log would be unsearchable and depend on whoever happened to be looking at the screen.
 */
export class ImportApiError extends Schema.TaggedError<ImportApiError>()("ImportApiError", {
  kind: ImportErrorKindSchema,
  code: Schema.String,
  status: Schema.Number,
  /** Short headline for the UI, unrendered — see `ImportErrorText`. */
  title: ImportErrorTextSchema,
  /** Long, actionable explanation for the UI, unrendered. */
  hint: ImportErrorTextSchema,
  /** True when simply pressing the button again can help. */
  retryable: Schema.Boolean,
  details: Schema.optional(Schema.Unknown),
}) {
  override get message(): string {
    return errorTextForLog(this.title);
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
  return Predicate.isTagged(error, "ImportApiError");
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
function parseOrPassThrough<S extends Decodable>(schema: S, payload: unknown, label: string): Decoded<S> {
  const decoded = Schema.decodeUnknownResult(schema as Schema.ConstraintDecoder<unknown>)(payload);
  if (Result.isSuccess(decoded)) return decoded.success as Decoded<S>;
  if (import.meta.env.DEV) {
    console.warn(`[import] response from ${label} does not match the schema`, decoded.failure);
  }
  return payload as Decoded<S>;
}

/** Any transport failure (the request never completed, or the body could not be read) is the `network` kind. */
const networkFailure = () => Effect.fail(toImportApiError(0, undefined));

const readJson = Effect.fnUntraced(
  function* (response: HttpClientResponse.HttpClientResponse) {
    const text = yield* response.text;
    if (text.length === 0) return undefined;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { error: { code: "internal_error", message: text.slice(0, 300) } } as unknown;
    }
  },
);

interface JsonRequest {
  readonly method?: "POST" | "PATCH" | "DELETE";
  readonly body?: unknown;
}

const requestJson = Effect.fnUntraced(
  function* <S extends Decodable>(path: string, schema: S, init: JsonRequest = {}) {
    const client = yield* HttpClient.HttpClient;
    // Own headers: `Accept` and, for a body, `Content-Type`. NO `Accept-Language`, no 401 hook.
    let request = HttpClientRequest.make(init.method ?? "GET")(`${apiBaseUrl()}${path}`).pipe(
      HttpClientRequest.setHeader("accept", "application/json"),
    );
    if (init.body !== undefined) {
      request = HttpClientRequest.setBody(
        request,
        HttpBody.raw(JSON.stringify(init.body), { contentType: "application/json" }),
      );
    }
    const response = yield* client.execute(request);
    const payload = yield* readJson(response);
    if (response.status < 200 || response.status > 299) {
      return yield* toImportApiError(response.status, payload, undefined);
    }
    return parseOrPassThrough(schema, payload, path);
  },
  Effect.catchTag("HttpClientError", networkFailure),
);

const requestNoContent = Effect.fnUntraced(
  function* (path: string, method: "DELETE") {
    const client = yield* HttpClient.HttpClient;
    const request = HttpClientRequest.make(method)(`${apiBaseUrl()}${path}`).pipe(
      HttpClientRequest.setHeader("accept", "application/json"),
    );
    const response = yield* client.execute(request);
    if (response.status < 200 || response.status > 299) {
      return yield* toImportApiError(response.status, yield* readJson(response), undefined);
    }
  },
  Effect.catchTag("HttpClientError", networkFailure),
);

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
 * progress in any shipping browser), wrapped in `Effect.callback`: it resumes once, from `onload`, `onerror`,
 * `ontimeout` or `onabort`, and interrupting the effect aborts the request. The caller's `handle.signal` aborts the
 * XHR itself (the facades pass no signal to `runPromise`: the XHR owns its abort).
 */
function uploadFile<S extends Decodable>(
  path: string,
  file: File,
  schema: S,
  handle: UploadHandle = {},
): Effect.Effect<Decoded<S>, ImportApiError | DOMException> {
  return Effect.callback<Decoded<S>, ImportApiError | DOMException>((resume) => {
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
      resume(Effect.fail(toImportApiError(0, undefined)));
    };
    xhr.ontimeout = () => {
      cleanup();
      resume(
        Effect.fail(
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
        ),
      );
    };
    xhr.onabort = () => {
      cleanup();
      // English literal, not a key: `describeError()` matches on `name`, so this
      // string only ever reaches a console or a stack trace.
      resume(Effect.fail(new DOMException("Upload aborted", "AbortError")));
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
        resume(Effect.fail(toImportApiError(xhr.status, payload, xhr.statusText)));
        return;
      }
      resume(Effect.succeed(parseOrPassThrough(schema, payload, path)));
    };

    const form = new FormData();
    form.append("file", file, file.name);
    xhr.send(form);

    // Interrupted before the XHR finished: stop the request.
    return Effect.sync(() => {
      cleanup();
      xhr.abort();
    });
  });
}

/* -------------------------------------------------------------------------- */
/* endpoints                                                                   */
/* -------------------------------------------------------------------------- */

const householdBase = (householdId: string) => `/api/households/${encodeURIComponent(householdId)}/recipe`;

/**
 * Fetches the SOURCE SCAN of a draft (the uploaded photo or PDF) as an object URL.
 * See the facade `fetchDraftSource` below for why this goes through the membership-checked endpoint.
 */
const draftSource = Effect.fnUntraced(
  function* (householdId: string, draftId: string) {
    const client = yield* HttpClient.HttpClient;
    // No `Accept` header here: the source is a photo or a PDF, as before.
    const request = HttpClientRequest.get(
      `${apiBaseUrl()}${householdBase(householdId)}/imports/${encodeURIComponent(draftId)}/source`,
    );
    const response = yield* client.execute(request);
    if (response.status < 200 || response.status > 299) {
      return yield* toImportApiError(response.status, yield* readJson(response), undefined);
    }
    const buffer = yield* response.arrayBuffer;
    // `new Blob` lower-cases the type, as `Response.blob()` did.
    const blob = new Blob([buffer], { type: response.headers["content-type"] ?? "" });
    return { objectUrl: URL.createObjectURL(blob), mimeType: blob.type };
  },
  Effect.catchTag("HttpClientError", networkFailure),
);

/** The endpoints as Effects; the functions below keep today's names and signatures and run them. */
export const ImportApi = {
  importFromUrl: (householdId: string, url: string) =>
    requestJson(`${householdBase(householdId)}/imports/url`, ImportDraftResponseSchema, {
      method: "POST",
      body: { url },
    }).pipe(Effect.map((response): ImportDraft => response.draft)),

  importFromText: (householdId: string, rawText: string, title?: string) =>
    requestJson(`${householdBase(householdId)}/imports/text`, ImportDraftResponseSchema, {
      method: "POST",
      body: title === undefined || title.length === 0 ? { rawText } : { rawText, title },
    }).pipe(Effect.map((response): ImportDraft => response.draft)),

  importImage: (householdId: string, file: File, handle?: UploadHandle) =>
    uploadFile(`${householdBase(householdId)}/imports/image`, file, ImportDraftResponseSchema, handle).pipe(
      Effect.map((response): ImportDraft => response.draft),
    ),

  importPdf: (householdId: string, file: File, handle?: UploadHandle) =>
    uploadFile(`${householdBase(householdId)}/imports/pdf`, file, ImportDraftResponseSchema, handle).pipe(
      Effect.map((response): ImportDraft => response.draft),
    ),

  listDrafts: (householdId: string, query: Partial<ImportDraftListQuery> = {}) => {
    const search = new URLSearchParams();
    if (query.status !== undefined) search.set("status", query.status);
    if (query.limit !== undefined) search.set("limit", String(query.limit));
    if (query.offset !== undefined) search.set("offset", String(query.offset));
    const queryString = search.toString();
    const suffix = queryString.length > 0 ? `?${queryString}` : "";
    return requestJson(`${householdBase(householdId)}/imports${suffix}`, ImportDraftListResponseSchema);
  },

  getDraft: (householdId: string, draftId: string) =>
    requestJson(`${householdBase(householdId)}/imports/${encodeURIComponent(draftId)}`, ImportDraftResponseSchema).pipe(
      Effect.map((response): ImportDraft => response.draft),
    ),

  patchDraft: (householdId: string, draftId: string, body: UpdateImportDraftRequest) =>
    requestJson(`${householdBase(householdId)}/imports/${encodeURIComponent(draftId)}`, ImportDraftResponseSchema, {
      method: "PATCH",
      body,
    }).pipe(Effect.map((response): ImportDraft => response.draft)),

  commitDraft: (householdId: string, draftId: string, body: CommitImportDraftRequest) =>
    requestJson(
      `${householdBase(householdId)}/imports/${encodeURIComponent(draftId)}/commit`,
      CommitImportDraftResponseSchema,
      { method: "POST", body },
    ),

  deleteDraft: (householdId: string, draftId: string) =>
    requestNoContent(`${householdBase(householdId)}/imports/${encodeURIComponent(draftId)}`, "DELETE"),

  fetchDraftSource: draftSource,

  /** Tag suggestions for the review screen's tag input. */
  listHouseholdTags: (householdId: string) =>
    requestJson(`${householdBase(householdId)}/tags`, TagListResponseSchema).pipe(
      Effect.map((response): Tag[] => response.items),
    ),
};

/* -------------------------------------------------------------------------- */
/* facades: today's names and signatures                                       */
/* -------------------------------------------------------------------------- */

export function importFromUrl(householdId: string, url: string, signal?: AbortSignal): Promise<ImportDraft> {
  return runPromise(ImportApi.importFromUrl(householdId, url), { signal });
}

export function importFromText(
  householdId: string,
  rawText: string,
  title?: string,
  signal?: AbortSignal,
): Promise<ImportDraft> {
  return runPromise(ImportApi.importFromText(householdId, rawText, title), { signal });
}

/** The XHR owns its abort (`handle.signal`), so nothing is passed to `runPromise`. */
export function importImage(householdId: string, file: File, handle?: UploadHandle): Promise<ImportDraft> {
  return runPromise(ImportApi.importImage(householdId, file, handle));
}

/** The XHR owns its abort (`handle.signal`), so nothing is passed to `runPromise`. */
export function importPdf(householdId: string, file: File, handle?: UploadHandle): Promise<ImportDraft> {
  return runPromise(ImportApi.importPdf(householdId, file, handle));
}

export function listDrafts(
  householdId: string,
  query: Partial<ImportDraftListQuery> = {},
  signal?: AbortSignal,
): Promise<ImportDraftListResponse> {
  return runPromise(ImportApi.listDrafts(householdId, query), { signal });
}

export function getDraft(householdId: string, draftId: string, signal?: AbortSignal): Promise<ImportDraft> {
  return runPromise(ImportApi.getDraft(householdId, draftId), { signal });
}

export function patchDraft(
  householdId: string,
  draftId: string,
  body: UpdateImportDraftRequest,
  signal?: AbortSignal,
): Promise<ImportDraft> {
  return runPromise(ImportApi.patchDraft(householdId, draftId, body), { signal });
}

export function commitDraft(
  householdId: string,
  draftId: string,
  body: CommitImportDraftRequest,
  signal?: AbortSignal,
): Promise<CommitImportDraftResponse> {
  return runPromise(ImportApi.commitDraft(householdId, draftId, body), { signal });
}

export function deleteDraft(householdId: string, draftId: string): Promise<void> {
  return runPromise(ImportApi.deleteDraft(householdId, draftId));
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
 * A cross-origin `<img src>` cannot send the session cookie, hence a request + blob.
 * THE CALLER MUST `URL.revokeObjectURL()` the result when it stops rendering it,
 * or the bytes stay alive for the lifetime of the document.
 */
export function fetchDraftSource(
  householdId: string,
  draftId: string,
  signal?: AbortSignal,
): Promise<{ objectUrl: string; mimeType: string }> {
  return runPromise(ImportApi.fetchDraftSource(householdId, draftId), { signal });
}

/** Tag suggestions for the review screen's tag input. */
export function listHouseholdTags(householdId: string, signal?: AbortSignal): Promise<Tag[]> {
  return runPromise(ImportApi.listHouseholdTags(householdId), { signal });
}

export type { ImportDraftStatus };
