/**
 * The API's one decode path (docs/EFFECT.md E4, plan e1 P8/P9).
 *
 * Every request body, query and route param a router validates goes through `validate(target, schema)`, and every
 * other decode of untrusted input in a handler or service through `decodeOrThrow` / `decodeOption`. A failure is
 * thrown as `Schema.SchemaError` and mapped ONCE, by `toApiError` in `./errors.ts`, to `422 validation_failed`
 * with `details` from `toValidationIssues` (`{ path, code, message, i18n }`, the message in the negotiated
 * locale, docs/API.md "Conventions"). No route builds its own `details` (ADR 0013).
 *
 * Import cycle (CLAUDE.md "API import cycle"): `validate(...)` runs at route definition, at module scope of a
 * router. This file therefore imports only `hono/validator`, `effect` and `@toon/shared`, never a core
 * middleware or service.
 */
import { ALL_ISSUES } from "@toon/shared";
import { Option, Schema, type Types } from "effect";
import type { Env, MiddlewareHandler } from "hono";
import { validator } from "hono/validator";

/** A schema the API can decode untrusted input with: an Effect schema that needs no decoding services (every wire schema of `@toon/shared` is service-free). */
export type Decodable = Schema.Decoder<unknown, never>;

/** What a decode of `S` returns: its `Type`, made mutable as Zod's outputs were (plan e1 P5). */
export type Decoded<S extends Decodable> = Types.DeepMutable<S["Type"]>;

/** The request parts `validate` reads (the targets this API uses). */
export type ValidationTarget = "json" | "query" | "param";

/**
 * Decodes `value` with every issue collected (`ALL_ISSUES`, plan e1 P6) and returns the decoded value, or throws a
 * `Schema.SchemaError`, which ends in `onErrorHandler` as `422 validation_failed`. Excess keys are stripped
 * (Effect's default).
 */
export function decodeOrThrow<S extends Decodable>(schema: S, value: unknown): Decoded<S> {
  return Schema.decodeUnknownSync(schema, ALL_ISSUES)(value) as Decoded<S>;
}

/**
 * Decodes `value` for a call site that ignores a failure: `Option.some(decoded)` or `Option.none()`; never throws
 * for a value the schema refuses.
 */
export function decodeOption<S extends Decodable>(schema: S, value: unknown): Option.Option<Decoded<S>> {
  return Schema.decodeUnknownOption(schema)(value) as Option.Option<Decoded<S>>;
}

/**
 * Hono middleware that decodes one request part with `schema` and hands the result to the handler as
 * `c.req.valid(target)`, typed `Decoded<S>`. Built on `hono/validator`'s `validator` as
 * `@hono/zod-validator` 0.9.1 did, so the part is read the same way: a `json` body only with a JSON
 * `Content-Type` (otherwise the schema sees `{}`), malformed JSON is Hono's `400` (`bad_request` in the
 * envelope), a repeated query key arrives as an array, `param` is the route's params. A refused value throws
 * (`decodeOrThrow`), so the error envelope is built in one place, `onErrorHandler`.
 */
export function validate<
  Target extends ValidationTarget,
  S extends Decodable,
  E extends Env = Env,
  P extends string = string,
>(target: Target, schema: S): MiddlewareHandler<E, P, { out: { [K in Target]: Decoded<S> } }> {
  // `validator` types its output from the callback's return type; for a generic `S` that conditional type stays
  // unresolved, so the callback returns `unknown` and the middleware is typed here, once, by the signature.
  const middleware: MiddlewareHandler = validator(target, (value): unknown => decodeOrThrow(schema, value));
  return middleware;
}
