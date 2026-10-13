/**
 * The single error path of the API.
 *
 * Throw `ApiError` (or one of the static helpers) anywhere in a handler; the
 * `onErrorHandler` mounted in src/index.ts turns it into the standard envelope
 *   { error: { code, message, details? } }
 * with the right HTTP status. Stack traces are logged, never sent.
 *
 * `message` used to be a German literal passed to the constructor. It is now a
 * KEY into the server catalog (`ServerKey`, or `{ key, values }` for one that
 * takes placeholders) — `toBody(locale)` renders it in the locale the request
 * negotiated (docs/i18n.md §4). Because `ServerKey` is a union of the keys in
 * `packages/shared/src/i18n/catalogs/server.de.ts`, a call site still passing a
 * German sentence is now a COMPILE ERROR until it is ported — that is the
 * port's progress meter (`bun run typecheck`), not `bun test`: a missing key
 * resolves to itself, so the suite stays green through an unported site while
 * an `en` client silently gets German.
 */
import { DEFAULT_LOCALE, type Locale, type MessageValues, type ServerKey, serverText } from "@toon/shared";
import type { ApiError as ApiErrorBody, ErrorCode } from "@toon/shared";
import type { Context, ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import { toValidationIssues } from "@toon/shared";
import { env } from "../env.ts";
import { requestLocale } from "./locale.ts";

/** A server catalog key, optionally with the placeholder values it needs. */
export type ErrorText = ServerKey | { key: ServerKey; values: MessageValues };

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | string;
  readonly details?: unknown;
  readonly text: ErrorText;

  constructor(status: number, code: ErrorCode | string, text: ErrorText, details?: unknown) {
    // English: this is what lands in the log (ops output is one language, see
    // CLAUDE.md's mail-copy gotcha for the same rule applied to ConsoleMailer).
    super(serverText("en", text));
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.text = text;
    this.details = details;
  }

  /** Renders `message` in `locale` (default: the deployment's `DEFAULT_LOCALE`). */
  toBody(locale: Locale = DEFAULT_LOCALE): ApiErrorBody {
    const message = serverText(locale, this.text);
    return {
      error:
        this.details === undefined
          ? { code: this.code, message }
          : { code: this.code, message, details: this.details },
    };
  }

  static badRequest(text: ErrorText = "server.error.badRequest", details?: unknown): ApiError {
    return new ApiError(400, "bad_request", text, details);
  }

  static unauthorized(text: ErrorText = "server.error.unauthorized"): ApiError {
    return new ApiError(401, "unauthorized", text);
  }

  static invalidCredentials(text: ErrorText = "server.error.invalidCredentials"): ApiError {
    return new ApiError(401, "invalid_credentials", text);
  }

  static forbidden(text: ErrorText = "server.error.forbidden"): ApiError {
    return new ApiError(403, "forbidden", text);
  }

  static notFound(text: ErrorText = "server.error.notFound"): ApiError {
    return new ApiError(404, "not_found", text);
  }

  static conflict(code: ErrorCode | string = "conflict", text: ErrorText = "server.error.conflict"): ApiError {
    return new ApiError(409, code, text);
  }

  static payloadTooLarge(text: ErrorText = "server.error.payloadTooLarge"): ApiError {
    return new ApiError(413, "payload_too_large", text);
  }

  static unsupportedMediaType(text: ErrorText = "server.error.unsupportedMediaType"): ApiError {
    return new ApiError(415, "unsupported_media_type", text);
  }

  static validationFailed(details: unknown, text: ErrorText = "server.error.validationFailed"): ApiError {
    return new ApiError(422, "validation_failed", text, details);
  }

  static internal(text: ErrorText = "server.error.internal"): ApiError {
    return new ApiError(500, "internal_error", text);
  }
}

/** Builds the standard envelope from any thrown value. */
function toApiError(error: unknown, locale: Locale): ApiError {
  if (error instanceof ApiError) return error;

  if (error instanceof ZodError) {
    return ApiError.validationFailed(toValidationIssues(error, locale));
  }

  if (error instanceof HTTPException) {
    const status = error.status;
    const code =
      status === 401 ? "unauthorized" : status === 403 ? "forbidden" : status === 404 ? "not_found" : "bad_request";
    // The framework's own message is dropped, not forwarded: it is an arbitrary
    // string out of Hono's internals and may carry things we do not want on
    // the wire. It still reaches the log via `console.error`/`console.warn`
    // below, keyed on the ORIGINAL error, not this replacement.
    return new ApiError(status, code, "server.error.requestFailed");
  }

  return ApiError.internal();
}

/** Hono `app.onError` handler. */
export const onErrorHandler: ErrorHandler = (error, c: Context) => {
  const locale = requestLocale(c);
  const apiError = toApiError(error, locale);
  if (apiError.status >= 500) {
    console.error(`[api] ${c.req.method} ${c.req.path} ->`, error);
  } else if (env.NODE_ENV === "development") {
    console.warn(`[api] ${c.req.method} ${c.req.path} -> ${apiError.status} ${apiError.code}: ${apiError.message}`);
  }
  return c.json(apiError.toBody(locale), apiError.status as 400);
};

/** Hono `app.notFound` handler — same envelope as every other error. */
export const notFoundHandler: NotFoundHandler = (c: Context) => {
  const locale = requestLocale(c);
  const notFound = ApiError.notFound({
    key: "server.error.routeUnknown",
    values: { method: c.req.method, path: c.req.path },
  });
  return c.json(notFound.toBody(locale), 404);
};
