/**
 * Responses of the Effect HTTP layer and the one error boundary (docs/EFFECT.md E6, E8; plan
 * `docs/plans/e7-http-api.md` P7, P10).
 *
 * The helpers build `HttpServerResponse`s with the shapes of the pre-E7 Hono helpers: `json(body)` (200, `application/json`, as the pre-E7 `c.json`),
 * `created(body, location?)` (201, `Location` when given), `noContent()` (204, no body), `redirect(url)` (302,
 * `Location`), `fromWeb(response)` (a web `Response` built by the old code, kept byte for byte). A handler returns one
 * of them, so HttpApi's success encoder never touches the body (P3).
 *
 * `errorResponse(error)` renders whatever reached a boundary: `toApiError` in the negotiated locale, the envelope of
 * `errorBody` with the family member's status, `Retry-After: <seconds>` for `RateLimited`, and the log lines of
 * `logBoundaryFailure` (the ones the `onErrorHandler` of the pre-E7 Hono app wrote; never a copied line). `ApiErrorBoundaryLayer`
 * implements `ApiErrorBoundary`, outermost on every API: it recovers the WHOLE cause (a defect and a `DatabaseError`
 * included, "Catch-all stays catch-all") and re-raises a cause that is interruption only.
 */
import { Cause, Effect, Layer, Predicate } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { errorBody, logBoundaryFailure, toApiError } from "../lib/errors.ts";
import { negotiateRequestLocale } from "../lib/locale.ts";
import { ApiErrorBoundary } from "./middleware.ts";
import { pathOf } from "./request.ts";

type ServerResponse = HttpServerResponse.HttpServerResponse;

/** 200 + JSON (the pre-E7 `c.json(body)`). */
export function json(body: unknown): ServerResponse {
  return HttpServerResponse.jsonUnsafe(body, { status: 200 });
}

/** 201 + JSON, with a `Location` header when `location` is given (`created(c, body, location)`). */
export function created(body: unknown, location?: string): ServerResponse {
  const response = HttpServerResponse.jsonUnsafe(body, { status: 201 });
  return location ? HttpServerResponse.setHeader(response, "location", location) : response;
}

/** 204, no body (`c.body(null, 204)`). */
export function noContent(): ServerResponse {
  return HttpServerResponse.empty({ status: 204 });
}

/** 302 to `url` (`c.redirect(url)`). */
export function redirect(url: string): ServerResponse {
  return HttpServerResponse.redirect(url, { status: 302 });
}

/** A web `Response` built by the old code (the import source with its `Content-Disposition`), as is. */
export function fromWeb(response: Response): ServerResponse {
  return HttpServerResponse.fromWeb(response);
}

/**
 * The error envelope for `error` (any value: a family member, a `Schema.SchemaError`, a `DatabaseError`, a defect),
 * in the request's locale, logged by `logBoundaryFailure` as the pre-E7 Hono `onErrorHandler` logged it (P7). Also what the origin guard, the route-unknown
 * fallback and the module catch-alls answer with.
 */
export const errorResponse = Effect.fnUntraced(function* (
  error: unknown,
): Effect.fn.Return<ServerResponse, never, HttpServerRequest.HttpServerRequest> {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const locale = negotiateRequestLocale(request.headers["accept-language"]);
  const apiError = toApiError(error, locale);
  yield* Effect.sync(() =>
    logBoundaryFailure({ method: request.method, path: pathOf(request.originalUrl), error, apiError }),
  );
  const response = HttpServerResponse.jsonUnsafe(errorBody(apiError, locale), { status: apiError.status });
  return Predicate.isTagged(apiError, "RateLimited")
    ? HttpServerResponse.setHeader(response, "retry-after", String(apiError.retryAfterSeconds))
    : response;
});

/**
 * `ApiErrorBoundary` (P7): the whole chain behind it, every failure and every defect answered by `errorResponse`
 * (`Cause.squash` is the value the pre-E7 Hono `onError` saw); a cause that is only interruption is re-raised, never answered.
 */
export const ApiErrorBoundaryLayer: Layer.Layer<ApiErrorBoundary> = Layer.succeed(ApiErrorBoundary)((httpEffect) =>
  Effect.catchCause(httpEffect, (cause) =>
    Cause.hasInterruptsOnly(cause) ? Effect.failCause(cause) : errorResponse(Cause.squash(cause)),
  ),
);
