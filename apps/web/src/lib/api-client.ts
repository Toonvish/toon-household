/**
 * The web app's API transport as an Effect service (docs/EFFECT.md E11, E6, E7; plan
 * docs/plans/e6-web-client.md P3, P4, P5, P10).
 *
 * - `ApiError`: every failed request fails with it. A `Schema.TaggedError` (`_tag` and `name` are
 *   `"ApiError"`) with today's object shape `{ code, status, message, details? }` and the five getters.
 *   Its field schemas are deliberately PERMISSIVE (plain `String` / `Number` / `Unknown`, no check, no
 *   literal union): the constructor validates its input and runs inside error paths, so it must never
 *   throw on a value today's code passes (the rule of apps/api/src/lib/errors.ts).
 * - The 401 hook (`setUnauthorizedHandler`, `handleUnauthorized`), read at CALL time by `ApiClient.execute`.
 * - `ApiClient`: describes ONE request (method, full URL, JSON body or form, `allowUnauthorized`), sends it
 *   through `HttpClient.HttpClient` (the runtime's `FetchHttpClient`, apps/web/src/lib/runtime.ts) and maps
 *   the response in today's order: 401 hook, 204/205 without a body, the body read as text and parsed
 *   tolerantly, a non-2xx mapped to the envelope's `ApiError` (`toApiError`), a 2xx handed back as
 *   `{ status, parsed }` for the caller to decode (apps/web/src/lib/api.ts `getJson`, `sendJson`, …).
 *   Every transport failure (`HttpClientError`, whatever its reason) is `network_error` with status 0.
 *
 * Import cycle (plan P16): this file → `@/lib/i18n/store.ts` → `@/lib/api` → `@/lib/runtime` → this file.
 * So `getLocale` / `translate` are read inside functions only, and the static `layer` reads no imported
 * binding but `effect` exports and its own class until the runtime builds it.
 */
import { Context, Effect, Layer, Predicate, Schema } from "effect";
import { HttpBody, HttpClient, HttpClientRequest, type HttpClientError } from "effect/http";
import { getLocale, translate } from "@/lib/i18n/store.ts";

/* -------------------------------------------------------------------------- */
/* errors                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Every failed request fails with this. `code` is one of `ERROR_CODES` from
 * `@toon/shared` (plus the client-only codes `network_error` / `invalid_response` /
 * `client_error`).
 */
export class ApiError extends Schema.TaggedError<ApiError>()("ApiError", {
  code: Schema.String,
  status: Schema.Number,
  message: Schema.String,
  details: Schema.optional(Schema.Unknown),
}) {
  /** 4xx = the user can fix it; retrying is pointless. */
  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  get isOffline(): boolean {
    return this.code === "network_error";
  }
}

export function isApiError(error: unknown): error is ApiError {
  return Predicate.isTagged(error, "ApiError");
}

/** The `network_error` every transport failure becomes; `details` is the underlying cause. */
export function networkError(details: unknown): ApiError {
  return new ApiError({
    code: "network_error",
    status: 0,
    message: translate("common.error.network"),
    details,
  });
}

/** Maps a non-2xx response to the envelope's `code` / `message`, or the status' fallbacks. */
export function toApiError(status: number, parsed: unknown, raw: string): ApiError {
  const envelope =
    typeof parsed === "object" && parsed !== null && "error" in parsed
      ? (parsed as { error?: { code?: unknown; message?: unknown; details?: unknown } }).error
      : undefined;

  const code = typeof envelope?.code === "string" ? envelope.code : fallbackCode(status);
  const message =
    typeof envelope?.message === "string" && envelope.message.length > 0
      ? envelope.message
      : fallbackMessage(status, raw);

  return new ApiError({ code, message, status, details: envelope?.details });
}

function fallbackCode(status: number): string {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 413) return "payload_too_large";
  if (status === 415) return "unsupported_media_type";
  if (status === 422) return "validation_failed";
  if (status >= 500) return "internal_error";
  return "bad_request";
}

function fallbackMessage(status: number, raw: string): string {
  switch (status) {
    case 401:
      return translate("common.error.unauthorized");
    case 403:
      return translate("common.error.forbidden");
    case 404:
      return translate("common.error.notFound");
    case 409:
      return translate("common.error.conflict");
    case 413:
      return translate("common.error.payloadTooLarge");
    case 415:
      return translate("common.error.unsupportedMediaType");
    case 422:
      return translate("common.error.validationFailed");
    default:
      return status >= 500 ? translate("common.error.serverError") : raw.slice(0, 200) || translate("common.error.requestFailed");
  }
}

/* -------------------------------------------------------------------------- */
/* 401 handling                                                               */
/* -------------------------------------------------------------------------- */

type UnauthorizedHandler = (next: string) => void;

let unauthorizedHandler: UnauthorizedHandler | null = null;
let lastRedirectAt = 0;

/**
 * Registered once by the router/session provider so a 401 can be handled with a
 * client-side navigation instead of a full page load.
 */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler;
}

function handleUnauthorized(): void {
  if (typeof window === "undefined") return;
  const { pathname, search, hash } = window.location;
  if (pathname === "/login" || pathname === "/register" || pathname.startsWith("/invite/")) return;
  // Never loop: at most one redirect per second.
  const now = Date.now();
  if (now - lastRedirectAt < 1000) return;
  lastRedirectAt = now;

  const next = `${pathname}${search}${hash}`;
  if (unauthorizedHandler) {
    unauthorizedHandler(next);
    return;
  }
  window.location.assign(`/login?next=${encodeURIComponent(next)}`);
}

/* -------------------------------------------------------------------------- */
/* the service                                                                */
/* -------------------------------------------------------------------------- */

export type ApiMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/** One request, described once. `url` is ALREADY the full URL (the base URL rules live in api.ts). */
export interface ApiRequest {
  readonly method: ApiMethod;
  readonly url: string;
  /** JSON body, serialised with `JSON.stringify`. Use `form` for multipart. */
  readonly body?: unknown;
  readonly form?: FormData | undefined;
  /** Skip the global 401 -> /login redirect (bootstrap + auth screens use this). */
  readonly allowUnauthorized?: boolean | undefined;
}

/**
 * A 2xx response. `noContent` is a 204/205 (no body read, nothing to decode); otherwise `parsed`
 * is the body as JSON, or `undefined` for an empty or unparseable body (today's tolerant rule).
 */
export interface ApiResponse {
  readonly status: number;
  readonly noContent: boolean;
  readonly parsed: unknown;
}

/** Today's tolerant body rule: an empty or invalid JSON body is `undefined`. */
function parseBody(raw: string): unknown {
  if (raw.length === 0) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Every reason of an `HttpClientError` (`TransportError`, `InvalidUrlError`, `EncodeError` on the
 * request side; `DecodeError`, `EmptyBodyError` while reading the body) is a `network_error`, with the
 * underlying cause as `details` (today: the raw `fetch` rejection). No `StatusCodeError` arises: the
 * client has no `filterStatusOk`, a status is mapped by `toApiError`.
 */
function fromHttpClientError(error: HttpClientError.HttpClientError): ApiError {
  return networkError(error.reason.cause ?? error);
}

export class ApiClient extends Context.Service<
  ApiClient,
  {
    readonly execute: (request: ApiRequest) => Effect.Effect<ApiResponse, ApiError>;
  }
>()("toon/web/ApiClient") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;

      const execute = Effect.fnUntraced(
        function* (spec: ApiRequest) {
          // Accept-Language is CORS-safelisted, so this adds no preflight and no CORS
          // change — the server negotiates `message`'s locale from it (docs/i18n.md §4).
          let request = HttpClientRequest.make(spec.method)(spec.url).pipe(
            HttpClientRequest.setHeaders({ accept: "application/json", "accept-language": getLocale() }),
          );
          if (spec.form) {
            // fetch sets the multipart boundary itself
            request = HttpClientRequest.bodyFormData(request, spec.form);
          } else if (spec.body !== undefined) {
            // A `Raw` string body reaches fetch as the string itself (bodyJson would hand it bytes).
            request = HttpClientRequest.setBody(
              request,
              HttpBody.raw(JSON.stringify(spec.body), { contentType: "application/json" }),
            );
          }

          const response = yield* client.execute(request);
          const status = response.status;

          if (status === 401 && !spec.allowUnauthorized) yield* Effect.sync(handleUnauthorized);

          if (status === 204 || status === 205) {
            return { status, noContent: true, parsed: undefined } satisfies ApiResponse;
          }

          const raw = yield* response.text;
          const parsed = parseBody(raw);

          if (status < 200 || status > 299) return yield* toApiError(status, parsed, raw);
          return { status, noContent: false, parsed } satisfies ApiResponse;
        },
        Effect.catchTag("HttpClientError", (error) => Effect.fail(fromHttpClientError(error))),
      );

      return ApiClient.of({ execute });
    }),
  );
}
