/**
 * The API's one decode path (docs/EFFECT.md E4, plan e1 P8/P9).
 *
 * Every request body, query and route param a router validates goes through `validate(target, schema)`, and every
 * other decode of untrusted input in a handler or service through `decodeOrThrow` / `decodeOption`. A failure is
 * thrown as `Schema.SchemaError` and mapped ONCE, by `toApiError` in `./errors.ts`, to `422 validation_failed`
 * with `details` from `toValidationIssues` (`{ path, code, message, i18n }`, the message in the negotiated
 * locale, docs/API.md "Conventions"). No route builds its own `details` (ADR 0013).
 *
 * TRANSITIONAL DUAL MODE (plan e1 P8): until E1-T11 every helper also takes a Zod schema, detected by ONE
 * `Schema.isSchema` test. The Zod arm throws a `ZodError` (`schema.parse`), which `toApiError` renders through the
 * same `toValidationIssues`. E1-T11 deletes the Zod arm, the `zod` type import and the second arm of the two
 * types below (`type Decodable = Schema.Decoder<unknown, never>`, `type Decoded<S extends Decodable> =
 * Types.DeepMutable<S["Type"]>`).
 *
 * Import cycle (CLAUDE.md "API import cycle"): `validate(...)` runs at route definition, at module scope of a
 * router. This file therefore imports only `hono/validator`, `effect` and `@toon/shared`, never a core
 * middleware or service.
 */
import { ALL_ISSUES } from "@toon/shared";
import { Option, Schema, type Types } from "effect";
import type { Env, MiddlewareHandler } from "hono";
import { validator } from "hono/validator";
import type { z } from "zod";

/**
 * A schema the API can decode untrusted input with: an Effect schema that needs no decoding services (every wire
 * schema of `@toon/shared` is service-free), or, until E1-T11, a Zod schema.
 */
export type Decodable = Schema.Decoder<unknown, never> | z.ZodType;

/**
 * What a decode of `S` returns. For an Effect schema its `Type`, made mutable as Zod's outputs were (plan e1 P5);
 * for a Zod schema its `z.output` (a Zod 4 `ZodType` has no `Type` member, so the arm is spelled out, P9).
 */
export type Decoded<S> = S extends Schema.Top
  ? Types.DeepMutable<S["Type"]>
  : S extends z.ZodType
    ? z.output<S>
    : never;

/** The request parts `validate` reads (`@hono/zod-validator`'s targets this API uses). */
export type ValidationTarget = "json" | "query" | "param";

/**
 * Decodes `value` with every issue collected (`ALL_ISSUES`, plan e1 P6) and returns the decoded value, or throws:
 * a `Schema.SchemaError` for an Effect schema, a `ZodError` for a Zod one. Both end in `onErrorHandler` as
 * `422 validation_failed`. Excess keys are stripped (Effect's default, as Zod's).
 */
export function decodeOrThrow<S extends Decodable>(schema: S, value: unknown): Decoded<S> {
  const decodable: Decodable = schema;
  if (Schema.isSchema(decodable)) {
    return Schema.decodeUnknownSync(decodable, ALL_ISSUES)(value) as Decoded<S>;
  }
  return decodable.parse(value) as Decoded<S>;
}

/**
 * Decodes `value` for a call site that ignores a failure: `Option.some(decoded)` or `Option.none()`; never throws
 * for a value the schema refuses.
 */
export function decodeOption<S extends Decodable>(schema: S, value: unknown): Option.Option<Decoded<S>> {
  const decodable: Decodable = schema;
  if (Schema.isSchema(decodable)) {
    return Schema.decodeUnknownOption(decodable)(value) as Option.Option<Decoded<S>>;
  }
  const result = decodable.safeParse(value);
  return result.success ? Option.some(result.data as Decoded<S>) : Option.none();
}

/**
 * Hono middleware that decodes one request part with `schema` and hands the result to the handler as
 * `c.req.valid(target)`, typed `Decoded<S>`. Built on `hono/validator`'s `validator` exactly as
 * `@hono/zod-validator` 0.9.1 is, so the part is read the same way: a `json` body only with a JSON
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
  // unresolved, so the callback returns `unknown` and the middleware is typed here, once, by the signature (as
  // `@hono/zod-validator` types its own in its `.d.ts`).
  const middleware: MiddlewareHandler = validator(target, (value): unknown => decodeOrThrow(schema, value));
  return middleware;
}
