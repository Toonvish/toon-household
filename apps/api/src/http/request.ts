/**
 * Reading a request in the Effect HTTP layer with Hono's semantics (docs/EFFECT.md E4, E8, E12; plan
 * `docs/plans/e7-http-api.md` P4). Every reader runs inside a handler or a middleware of an `HttpApi` route, where the
 * router provides `HttpServerRequest` and `ParsedSearchParams`.
 *
 * - `jsonBody(schema)`: the body is read as JSON ONLY when `Content-Type` passes Hono 4.13.7's JSON test (the regex
 *   below, verbatim); otherwise the schema decodes `{}`. Malformed JSON (an empty body included) is `400 bad_request`
 *   with `server.error.requestFailed`, what `toApiError` made of Hono's `HTTPException(400)`. A refused value is the
 *   `Schema.SchemaError` of `decode` (`ALL_ISSUES`), which the boundary answers `422 validation_failed`.
 * - `queryParams(schema)`: decodes Hono's `c.req.queries()` shape (a key seen once is a string, a repeated key an
 *   array); `queryParam(name)` is `c.req.query(name)` (the first value), `queryRecord` is `c.req.query()`.
 * - The raw JSON body in TWO forms, because the old callers treat a malformed body in two ways, both pinned:
 *   `rawJsonOr(onMalformed)` fails with the caller's own refusal (the local `readJson` helpers), `rawJsonOrDie` makes it
 *   a DEFECT carrying the parse error (`Effect.promise(() => c.req.json())`: a `500 internal_error`). No bare `rawJson`.
 * - The body text is read once per request (`HttpServerRequest.text` is cached), so `jsonBody` and `rawJsonOrDie` may
 *   both run in one handler, as `c.req.valid("json")` and `c.req.json()` did.
 *
 * Imports nothing of the runtime and no service: `clientIpFrom` (`rateLimit.ts`), `negotiateRequestLocale`
 * (`lib/locale.ts`) and `decode` (`lib/validate.ts`) are pure.
 */
import type { Locale } from "@toon/shared";
import { Effect, Option, type Schema } from "effect";
import { HttpServerRequest } from "effect/http";
import { clientIpFrom } from "../core/services/auth/rateLimit.ts";
import { ApiFailure } from "../lib/errors.ts";
import { negotiateRequestLocale } from "../lib/locale.ts";
import { type Decodable, type Decoded, decode } from "../lib/validate.ts";

type ServerRequest = HttpServerRequest.HttpServerRequest;
type SearchParams = HttpServerRequest.ParsedSearchParams;

/** Hono 4.13.7's JSON content-type test, verbatim (`jsonRegex` in `node_modules/hono/dist/validator/validator.js`). */
// oxlint-disable-next-line no-useless-escape
const JSON_CONTENT_TYPE = /^application\/([a-z-\.]+\+)?json(;\s*[a-zA-Z0-9\-]+\=([^;]+))*$/i;

/** What Hono's malformed-JSON `HTTPException(400)` was answered with. */
const malformedJson = (): ApiFailure =>
  new ApiFailure({ status: 400, code: "bad_request", text: "server.error.requestFailed" });

/**
 * The pathname of a request URL without query or hash, percent-decoded as Hono's `getPath` did (`c.req.path`):
 * `decodeURI` on a path that contains `%` (with `%25` kept encoded), each undecodable sequence left as it is.
 */
export function pathOf(url: string): string {
  const start = url.startsWith("/") ? 0 : url.indexOf("/", url.indexOf(":") + 4);
  if (start < 0) return "/";
  let end = url.length;
  for (let i = start; i < url.length; i++) {
    const code = url.charCodeAt(i);
    if (code === 63 || code === 35) {
      end = i;
      break;
    }
  }
  const path = url.slice(start, end);
  if (!path.includes("%")) return path;
  const raw = path.includes("%25") ? path.replace(/%25/g, "%2525") : path;
  try {
    return decodeURI(raw);
  } catch {
    return raw.replace(/(?:%[0-9A-Fa-f]{2})+/g, (match) => {
      try {
        return decodeURI(match);
      } catch {
        return match;
      }
    });
  }
}

/** The request's pathname (Hono's `c.req.path`), for log lines and the route-unknown answer. */
export const requestPath: Effect.Effect<string, never, ServerRequest> = HttpServerRequest.HttpServerRequest.useSync(
  (request) => pathOf(request.originalUrl),
);

/** The JSON value of the body under Hono's rules: `{}` without a JSON content type, `400 bad_request` when malformed. */
const jsonBodyValue: Effect.Effect<unknown, ApiFailure, ServerRequest> = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const contentType = request.headers["content-type"];
  if (!contentType || !JSON_CONTENT_TYPE.test(contentType)) return {};
  const text = yield* Effect.mapError(request.text, malformedJson);
  return yield* Effect.try({ try: (): unknown => JSON.parse(text), catch: malformedJson });
});

/** `validate("json", schema)` + `c.req.valid("json")`: the body decoded with `schema` (P4). */
export function jsonBody<S extends Decodable>(
  schema: S,
): Effect.Effect<Decoded<S>, ApiFailure | Schema.SchemaError, ServerRequest> {
  return Effect.flatMap(jsonBodyValue, (value) => decode(schema, value));
}

/** `validate("query", schema)` + `c.req.valid("query")`: the query (a repeated key is an array) decoded with `schema`. */
export function queryParams<S extends Decodable>(
  schema: S,
): Effect.Effect<Decoded<S>, Schema.SchemaError, SearchParams> {
  return Effect.flatMap(HttpServerRequest.ParsedSearchParams, (query) => decode(schema, query));
}

/** The first value of a query entry (`c.req.query(name)`). */
const firstValue = (value: string | ReadonlyArray<string> | undefined): string | undefined =>
  typeof value === "string" ? value : value?.[0];

/** `c.req.query(name)`: the first value of `name`, or `undefined`. */
export function queryParam(name: string): Effect.Effect<string | undefined, never, SearchParams> {
  return HttpServerRequest.ParsedSearchParams.useSync((query) => firstValue(query[name]));
}

/** `c.req.query()`: every key with its first value. */
export const queryRecord: Effect.Effect<Record<string, string>, never, SearchParams> =
  HttpServerRequest.ParsedSearchParams.useSync((query) => {
    const record: Record<string, string> = {};
    for (const [key, value] of Object.entries(query)) {
      const first = firstValue(value);
      if (first !== undefined) record[key] = first;
    }
    return record;
  });

/** `c.req.header(name)`: the header's value, or `undefined` (names are case-insensitive). */
export function header(name: string): Effect.Effect<string | undefined, never, ServerRequest> {
  return HttpServerRequest.HttpServerRequest.useSync((request) => request.headers[name.toLowerCase()]);
}

/** `Effect.promise(() => c.req.text())`: the body text; a failed read is a defect. */
export const rawText: Effect.Effect<string, never, ServerRequest> = Effect.flatMap(
  HttpServerRequest.HttpServerRequest,
  (request) => Effect.orDie(request.text),
);

/** `c.req.raw`: the underlying web `Request` (for `formData()` and `readUploadedFile`). */
export const webRequest: Effect.Effect<Request, never, ServerRequest> = HttpServerRequest.HttpServerRequest.useSync(
  (request) => request.source as Request,
);

/**
 * `Effect.tryPromise({ try: () => c.req.json(), catch: () => E })`: the parsed body, or the caller's own refusal for a
 * body that cannot be read or is not JSON (the local `readJson` helpers keep their key and German text).
 */
export function rawJsonOr<E>(onMalformed: () => E): Effect.Effect<unknown, E, ServerRequest> {
  return Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) =>
    Effect.flatMap(Effect.mapError(request.text, onMalformed), (text) =>
      Effect.try({ try: (): unknown => JSON.parse(text), catch: onMalformed }),
    ),
  );
}

/**
 * `Effect.promise(() => c.req.json())`: the parsed body; a malformed or EMPTY body is a DEFECT carrying the parse error
 * (a `500 internal_error`, never a 400), as the rejected promise was.
 */
export const rawJsonOrDie: Effect.Effect<unknown, never, ServerRequest> = Effect.flatMap(rawText, (text) =>
  Effect.sync((): unknown => JSON.parse(text)),
);

/** `clientIp(c)`: the rate-limit address (`clientIpFrom`) from the headers and the socket address. */
export const clientIp: Effect.Effect<string, never, ServerRequest> = HttpServerRequest.HttpServerRequest.useSync(
  (request) =>
    clientIpFrom({
      header: (name) => request.headers[name],
      socketAddress: Option.getOrUndefined(request.remoteAddress),
    }),
);

/** `requestLocale(c)`: the negotiated interface locale (`Accept-Language`, else the configured default). */
export const requestLocale: Effect.Effect<Locale, never, ServerRequest> = HttpServerRequest.HttpServerRequest.useSync(
  (request) => negotiateRequestLocale(request.headers["accept-language"]),
);
