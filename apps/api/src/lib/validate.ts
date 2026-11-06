/**
 * The API's one decode path (docs/EFFECT.md E4, plan e1 P8/P9).
 *
 * Every request body and query a route reads goes through `jsonBody(schema)` / `queryParams(schema)` of
 * `apps/api/src/http/request.ts` (plan `docs/plans/e7-http-api.md` P4; they replace the pre-E7 Hono
 * `validate(target, schema)`), and every other decode of untrusted input in a handler or service through
 * `decodeOrThrow` / `decodeOption`, or, inside an Effect, through `decode` (plan e2 P19), which fails with the same `Schema.SchemaError`. A failure is
 * thrown as `Schema.SchemaError` and mapped ONCE, by `toApiError` in `./errors.ts`, to `422 validation_failed`
 * with `details` from `toValidationIssues` (`{ path, code, message, i18n }`, the message in the negotiated
 * locale, docs/API.md "Conventions"). No route builds its own `details` (ADR 0013).
 *
 * Import cycle (CLAUDE.md "API import cycle"): the pre-E7 `validate(...)` ran at route definition, at module scope of a
 * router. This file keeps importing only `effect` and `@toon/shared`, never `runtime.ts`, a core middleware or a
 * service (plan e2 P12).
 */
import { ALL_ISSUES } from "@toon/shared";
import { type Effect, Option, Schema, type Types } from "effect";

/** A schema the API can decode untrusted input with: an Effect schema that needs no decoding services (every wire schema of `@toon/shared` is service-free). */
export type Decodable = Schema.Decoder<unknown, never>;

/** What a decode of `S` returns: its `Type`, made mutable as Zod's outputs were (plan e1 P5). */
export type Decoded<S extends Decodable> = Types.DeepMutable<S["Type"]>;

/**
 * Decodes `value` with every issue collected (`ALL_ISSUES`, plan e1 P6) and returns the decoded value, or throws a
 * `Schema.SchemaError`, which ends in the error boundary (`errorResponse`) as `422 validation_failed`. Excess keys are stripped
 * (Effect's default).
 */
export function decodeOrThrow<S extends Decodable>(schema: S, value: unknown): Decoded<S> {
  return Schema.decodeUnknownSync(schema, ALL_ISSUES)(value) as Decoded<S>;
}

/**
 * The Effect form of `decodeOrThrow`: succeeds with the decoded value or fails with the `Schema.SchemaError` (every
 * issue collected, `ALL_ISSUES`), which the boundary maps to `422 validation_failed` like a thrown one.
 */
export function decode<S extends Decodable>(schema: S, value: unknown): Effect.Effect<Decoded<S>, Schema.SchemaError> {
  return Schema.decodeUnknownEffect(schema, ALL_ISSUES)(value) as Effect.Effect<Decoded<S>, Schema.SchemaError>;
}

/**
 * Decodes `value` for a call site that ignores a failure: `Option.some(decoded)` or `Option.none()`; never throws
 * for a value the schema refuses.
 */
export function decodeOption<S extends Decodable>(schema: S, value: unknown): Option.Option<Decoded<S>> {
  return Schema.decodeUnknownOption(schema)(value) as Option.Option<Decoded<S>>;
}
