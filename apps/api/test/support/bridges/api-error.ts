/**
 * The test door of the legacy `ApiError` class of `apps/api/src/lib/errors.ts` (docs/EFFECT.md E6, E7, E9; plan
 * `docs/plans/e8-harden.md` P1, P4): moved from `apps/api/src/lib/errors.ts` at E8 (plan e8 P1). The application raises
 * the tagged family (`BadRequest`, `NotFound`, …, `ApiFailure`); the tests keep building and matching errors with the
 * old class.
 */
import { DEFAULT_LOCALE, type Locale } from "@toon/shared";
import type { ApiError as ApiErrorBody, ErrorCode } from "@toon/shared";
import { ApiFailure, type ErrorText, errorBody, isApiError } from "../../../src/lib/errors.ts";

/**
 * The legacy class, moved from `apps/api/src/lib/errors.ts` at E8 (plan e8 P1): `new ApiError(status, code, text,
 * details?)` and the ten static helpers build an `ApiFailure` with the same status, code and text as before, without
 * constructor checks. `x instanceof ApiError` is `isApiError(x)`, so it holds for every family member and never for a
 * `DatabaseError`. Its narrowing claims `ApiError`; only a legacy instance has `toBody`, so code that may see a tagged
 * member renders with `errorBody`. Callers: the test files that build or match an error with it,
 * `apps/api/test/import/helpers.ts`.
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
