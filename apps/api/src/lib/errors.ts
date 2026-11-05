/**
 * The single error path of the API (docs/EFFECT.md E6, plan e2 P4).
 *
 * The API's errors are a family of `Schema.TaggedError` classes, one per former `ApiError` helper (`BadRequest`,
 * `Unauthorized`, `InvalidCredentials`, `Forbidden`, `NotFound`, `Conflict`, `PayloadTooLarge`,
 * `UnsupportedMediaType`, `ValidationFailed`, `Internal`) plus `RateLimited` (429, sets `Retry-After`) and the generic
 * `ApiFailure` (any other status and code). Each carries `status`, `code` and `text`, and an Effect raises it with
 * `return yield* new NotFound()`. ONE mapper, `toApiError`, turns whatever reaches the boundary into a family member,
 * and the boundary renders it as the standard envelope
 *   { error: { code, message, details? } }
 * with the right HTTP status: `ApiErrorBoundary` of the Effect HTTP layer (`apps/api/src/http/response.ts`
 * `errorResponse`, plan `docs/plans/e7-http-api.md` P7) and, until E7-T12 deletes the Hono section at the end of this
 * file, `onErrorHandler` (mounted in src/index.ts). Both log through `logBoundaryFailure` and answer an unknown route
 * with `routeUnknown`. Stack traces are logged, never sent (a 5xx family member logs
 * `<status> <code>: <English message>` and its stack; a defect or a `DatabaseError` logs the raw value or its `cause`).
 *
 * `text` is a KEY into the server catalog (`ServerKey`, or `{ key, values }` for one that takes placeholders);
 * `errorBody(error, locale)` renders it in the locale the request negotiated (docs/i18n.md §4), and every instance's
 * `message` is the English text, which is what the log shows (ops output is one language). Because `ServerKey` is a
 * union of the keys in the server catalog, a call site passing a German sentence is a COMPILE ERROR.
 *
 * Two rules keep the family safe inside an error path:
 * - The constructors never throw on a value today's code passes: a `Schema.TaggedError` constructor validates its
 *   fields, so the field schemas are permissive (`Schema.Number`, `Schema.String`, any string or object as `text`,
 *   `Schema.Unknown` as `details`), and the legacy `ApiError` constructs with `disableChecks`.
 * - `DatabaseError` is NOT a member: `isApiError` and `instanceof ApiError` are false for it, and the mapper answers it
 *   `500 internal_error` and logs its `cause`.
 *
 * The legacy class `ApiError` (positional constructor, ten static helpers, `toBody`) stays for the recipe and finance
 * modules until E3 and E4 move them onto the family; `x instanceof ApiError` is true for EVERY family member.
 *
 * Import cycle (CLAUDE.md "API import cycle", plan e2 P12): this file imports neither `runtime.ts` nor a service.
 */
import { DEFAULT_LOCALE, type Locale, type MessageValues, type ServerKey, serverText } from "@toon/shared";
import type { ApiError as ApiErrorBody, ErrorCode } from "@toon/shared";
import { toValidationIssues } from "@toon/shared";
import { Effect, Predicate, Schema } from "effect";
import { env } from "../env.ts";

/** A server catalog key, optionally with the placeholder values it needs. */
export type ErrorText = ServerKey | { key: ServerKey; values: MessageValues };

/**
 * The `text` field: typed as `ErrorText`, accepting any string or object at runtime (no check on the key or the
 * `values`), so a constructor never throws inside an error path.
 */
const Text = Schema.declare<ErrorText>((u): u is ErrorText => Predicate.isString(u) || Predicate.isObject(u));

/** `text` with the helper's default catalog key, so `new NotFound()` and `new NotFound({ text })` are both valid. */
const textOr = (fallback: ErrorText) => Text.pipe(Schema.withConstructorDefault(Effect.succeed(fallback)));

/** `details`: anything, an explicit `undefined` included (it renders as no `details` key). */
const Details = Schema.optional(Schema.Unknown);

/** 400 `bad_request`. */
export class BadRequest extends Schema.TaggedError<BadRequest>()("BadRequest", {
  text: textOr("server.error.badRequest"),
  details: Details,
}) {
  readonly status = 400;
  readonly code = "bad_request";
  override get message(): string {
    return serverText("en", this.text);
  }
}

/** 401 `unauthorized`. */
export class Unauthorized extends Schema.TaggedError<Unauthorized>()("Unauthorized", {
  text: textOr("server.error.unauthorized"),
}) {
  readonly status = 401;
  readonly code = "unauthorized";
  override get message(): string {
    return serverText("en", this.text);
  }
}

/** 401 `invalid_credentials`. */
export class InvalidCredentials extends Schema.TaggedError<InvalidCredentials>()("InvalidCredentials", {
  text: textOr("server.error.invalidCredentials"),
}) {
  readonly status = 401;
  readonly code = "invalid_credentials";
  override get message(): string {
    return serverText("en", this.text);
  }
}

/** 403 `forbidden`. */
export class Forbidden extends Schema.TaggedError<Forbidden>()("Forbidden", {
  text: textOr("server.error.forbidden"),
}) {
  readonly status = 403;
  readonly code = "forbidden";
  override get message(): string {
    return serverText("en", this.text);
  }
}

/** 404 `not_found`. */
export class NotFound extends Schema.TaggedError<NotFound>()("NotFound", {
  text: textOr("server.error.notFound"),
}) {
  readonly status = 404;
  readonly code = "not_found";
  override get message(): string {
    return serverText("en", this.text);
  }
}

/** 409, `code` defaulting to `conflict` (`email_taken`, `member_has_account`, …). */
export class Conflict extends Schema.TaggedError<Conflict>()("Conflict", {
  code: Schema.String.pipe(Schema.withConstructorDefault(Effect.succeed("conflict"))),
  text: textOr("server.error.conflict"),
}) {
  readonly status = 409;
  override get message(): string {
    return serverText("en", this.text);
  }
}

/** 413 `payload_too_large`. */
export class PayloadTooLarge extends Schema.TaggedError<PayloadTooLarge>()("PayloadTooLarge", {
  text: textOr("server.error.payloadTooLarge"),
}) {
  readonly status = 413;
  readonly code = "payload_too_large";
  override get message(): string {
    return serverText("en", this.text);
  }
}

/** 415 `unsupported_media_type`. */
export class UnsupportedMediaType extends Schema.TaggedError<UnsupportedMediaType>()("UnsupportedMediaType", {
  text: textOr("server.error.unsupportedMediaType"),
}) {
  readonly status = 415;
  readonly code = "unsupported_media_type";
  override get message(): string {
    return serverText("en", this.text);
  }
}

/** 422 `validation_failed`; `details` are the `toValidationIssues` items (or none). */
export class ValidationFailed extends Schema.TaggedError<ValidationFailed>()("ValidationFailed", {
  text: textOr("server.error.validationFailed"),
  details: Details,
}) {
  readonly status = 422;
  readonly code = "validation_failed";
  override get message(): string {
    return serverText("en", this.text);
  }
}

/** 500 `internal_error`: what every defect and every value outside the family is answered with. */
export class Internal extends Schema.TaggedError<Internal>()("Internal", {
  text: textOr("server.error.internal"),
}) {
  readonly status = 500;
  readonly code = "internal_error";
  override get message(): string {
    return serverText("en", this.text);
  }
}

/** 429 `rate_limited`: the mapper sets `Retry-After: <retryAfterSeconds>`. */
export class RateLimited extends Schema.TaggedError<RateLimited>()("RateLimited", {
  retryAfterSeconds: Schema.Number,
}) {
  readonly status = 429;
  readonly code = "rate_limited";
  get text(): ErrorText {
    return { key: "server.error.tooManyAttempts", values: { seconds: this.retryAfterSeconds } };
  }
  override get message(): string {
    return serverText("en", this.text);
  }
}

/** Any other status and code (`email_unverified`, `module_disabled`, `member_has_ledger`, `oauth_failed`, …). */
export class ApiFailure extends Schema.TaggedError<ApiFailure>()("ApiFailure", {
  status: Schema.Number,
  code: Schema.String,
  text: Text,
  details: Details,
}) {
  override get message(): string {
    return serverText("en", this.text);
  }
}

/** The API's error family: what `toApiError` returns and what the boundary renders. */
export type ApiErrorFamily =
  | BadRequest
  | Unauthorized
  | InvalidCredentials
  | Forbidden
  | NotFound
  | Conflict
  | PayloadTooLarge
  | UnsupportedMediaType
  | ValidationFailed
  | Internal
  | RateLimited
  | ApiFailure;

const API_ERROR_TAGS: ReadonlySet<unknown> = new Set<ApiErrorFamily["_tag"]>([
  "BadRequest",
  "Unauthorized",
  "InvalidCredentials",
  "Forbidden",
  "NotFound",
  "Conflict",
  "PayloadTooLarge",
  "UnsupportedMediaType",
  "ValidationFailed",
  "Internal",
  "RateLimited",
  "ApiFailure",
]);

/** `true` for every member of the family (the legacy `ApiError` included), `false` for `DatabaseError` and the rest. */
export function isApiError(u: unknown): u is ApiErrorFamily {
  return Predicate.isError(u) && Predicate.hasProperty(u, "_tag") && API_ERROR_TAGS.has(u._tag);
}

/**
 * A database failure (a libSQL or drizzle rejection), raised by the `Database` service. Deliberately OUTSIDE the
 * family: no `instanceof ApiError` and no `isApiError` mistakes it for a domain error; the boundary answers it
 * `500 internal_error` and logs its `cause`.
 */
export class DatabaseError extends Schema.TaggedError<DatabaseError>()("DatabaseError", {
  cause: Schema.Defect(),
}) {}

/** `true` for a `DatabaseError`. */
export function isDatabaseError(u: unknown): u is DatabaseError {
  return Predicate.isError(u) && Predicate.isTagged(u, "DatabaseError");
}

/** What `errorBody` reads: every family member has this shape. */
export interface ApiErrorShape {
  readonly code: ErrorCode | string;
  readonly text: ErrorText;
  readonly details?: unknown;
}

/** The envelope `{ error: { code, message, details? } }`, `message` in `locale` (default: `DEFAULT_LOCALE`). */
export function errorBody(error: ApiErrorShape, locale: Locale = DEFAULT_LOCALE): ApiErrorBody {
  const message = serverText(locale, error.text);
  return {
    error:
      error.details === undefined
        ? { code: error.code, message }
        : { code: error.code, message, details: error.details },
  };
}

/**
 * The legacy class for the recipe and finance modules (E3 and E4 remove it): `new ApiError(status, code, text,
 * details?)` and the ten static helpers build an `ApiFailure` with the same status, code and text as before, without
 * constructor checks. `x instanceof ApiError` is `isApiError(x)`, so it holds for every family member and never for a
 * `DatabaseError`. Its narrowing claims `ApiError`; only a legacy instance has `toBody`, so code that may see a tagged
 * member renders with `errorBody`.
 */
export class ApiError extends ApiFailure {
  override readonly name = "ApiError";

  constructor(status: number, code: ErrorCode | string, text: ErrorText, details?: unknown) {
    super({ status, code, text, details }, { disableChecks: true });
  }

  static override [Symbol.hasInstance](u: unknown): u is ApiError {
    return isApiError(u);
  }

  /** Renders `message` in `locale` (default: the deployment's `DEFAULT_LOCALE`). */
  toBody(locale: Locale = DEFAULT_LOCALE): ApiErrorBody {
    return errorBody(this, locale);
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

/**
 * The one boundary mapper: a family member as is; a `Schema.SchemaError` as `422 validation_failed` with the
 * `toValidationIssues` details in `locale` (ADR 0013); a `DatabaseError` and anything else (a defect, a non-`Error`
 * value such as the string `"ManagedRuntime disposed"`) as `500 internal_error`. (A Hono `HTTPException` is mapped by
 * `honoExceptionToApiError` in the Hono section until E7-T12; the Effect HTTP layer raises none.)
 */
export function toApiError(error: unknown, locale: Locale): ApiErrorFamily {
  if (isApiError(error)) return error;

  if (Schema.isSchemaError(error)) {
    return new ValidationFailed({ details: toValidationIssues(error.issue, locale) });
  }

  return new Internal();
}

/**
 * The boundary's log lines, written ONCE for both boundaries (`onErrorHandler` and `ApiErrorBoundary`, plan
 * `docs/plans/e7-http-api.md` P7): a 5xx family member logs `[api] <METHOD> <path> -> <status> <code>: <English
 * message>` and its stack; any other 5xx (a defect, a `DatabaseError`'s `cause`, a raw value) logs `[api] <METHOD>
 * <path> ->` and the value; a 4xx logs a `console.warn` in development only. `path` is the pathname without the query.
 * `error` is what reached the boundary, `apiError` what it is answered with.
 */
export function logBoundaryFailure(failure: {
  readonly method: string;
  readonly path: string;
  readonly error: unknown;
  readonly apiError: ApiErrorFamily;
}): void {
  const { method, path, error, apiError } = failure;
  if (apiError.status >= 500) {
    if (isApiError(error)) {
      // A family member is a tagged-error dump to Bun's console; the pre-E2 line was the English message and the stack.
      console.error(`[api] ${method} ${path} -> ${error.status} ${error.code}: ${error.message}`, error.stack);
    } else {
      console.error(`[api] ${method} ${path} ->`, isDatabaseError(error) ? error.cause : error);
    }
  } else if (env.NODE_ENV === "development") {
    console.warn(`[api] ${method} ${path} -> ${apiError.status} ${apiError.code}: ${apiError.message}`);
  }
}

/** The answer to a request no route matches: `404 not_found` with `server.error.routeUnknown` naming method and path. */
export function routeUnknown(method: string, path: string): NotFound {
  return new NotFound({ text: { key: "server.error.routeUnknown", values: { method, path } } });
}
