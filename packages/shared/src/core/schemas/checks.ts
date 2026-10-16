/**
 * The schema vocabulary (docs/EFFECT.md E4, plan e1 P3/P4): small Effect `Schema` building blocks that mirror
 * the zod constructs this repo used, each failure annotated with the wire issue zod would have reported.
 *
 * Every failure carries `WIRE_ISSUE` (a FlatIssue without `path`): on the schema's own AST (a type
 * mismatch), on a filter's annotations, or on an `InvalidValue` built by `wireIssue`. `flattenIssue` in
 * `../i18n/issues.ts` reads it back; it never invents an issue and never reads an Effect message.
 *
 * Accepted inputs are zod 4.5.4's: the regexes and the URL rule are copied from zod's own source
 * (`node_modules/.bun/zod@4.5.4/node_modules/zod/v4/core/regexes.js` and `schemas.js`), string lengths count
 * code points as zod 4.5.4 does, numbers refuse `NaN` and `Infinity`, integers are checked for the safe range.
 *
 * Everything else is plain Effect: `Schema.Struct`, `Schema.Array`, `Schema.Record`, `Schema.optional`
 * (`.optional()`), `Schema.NullOr` (`.nullable()`), `Schema.optional(Schema.NullOr(X))` (`.nullish()`),
 * `X.pipe(Schema.withDecodingDefault(Effect.succeed(v)))` (`.default(v)`), `{ ...A.fields, … }` (`.extend`),
 * `Schema.decodeTo` / `Schema.makeFilter` (`.transform` / `.superRefine`), and for `.catchall(X)`
 * `Schema.StructWithRest(S, [Schema.Record(K, X)])` where `K` is `Str` refused for the declared keys (a rest
 * record over every string key also checks the declared fields against `X`). No name here ends in `Schema`.
 */
import { Schema, SchemaAST, SchemaIssue, SchemaTransformation } from "effect";
import type { ServerKey } from "../i18n/catalogs/index.ts";
import type { FlatIssue } from "../i18n/issues.ts";

/** The annotation key that carries a wire issue (the FlatIssue fields minus `path`). */
export const WIRE_ISSUE = "toon/wireIssue";

/** The wire issue an annotation carries. */
type WireIssue = Omit<FlatIssue, "path">;

/** Decode options for every decode whose failures reach `details` or a form: zod reports every issue (P6). */
export const ALL_ISSUES: SchemaAST.ParseOptions = { errors: "all" };

/**
 * An `InvalidValue` issue carrying a wire issue: what a hand-written filter or a fallible transformation
 * returns when it fails on its own (zod's `ctx.addIssue`).
 */
export function wireIssue(meta: WireIssue): SchemaIssue.InvalidValue {
  return new SchemaIssue.InvalidValue({ [WIRE_ISSUE]: meta });
}

/** The annotation object for a schema or a filter. */
function wire(meta: WireIssue): { readonly [WIRE_ISSUE]: WireIssue } {
  return { [WIRE_ISSUE]: meta };
}

// ---------------------------------------------------------------------------------------------------------------
// Leaf schemas
// ---------------------------------------------------------------------------------------------------------------

/** `z.string()`: a wrong type is `invalid_type` expected `string`. */
export const Str = Schema.String.annotate(wire({ code: "invalid_type", expected: "string" }));

/**
 * `z.number()`: a finite number. Plain `Schema.Number` ACCEPTS `NaN` and `±Infinity`, zod refuses them as
 * `invalid_type` expected `number`; the finite filter aborts, so no later bound reports on a non-finite value.
 */
export const Num = Schema.Number.annotate(wire({ code: "invalid_type", expected: "number" })).check(
  Schema.isFinite(wire({ code: "invalid_type", expected: "number" })).abort(),
);

/** zod's `.int()`: not an integer is `invalid_type` expected `int` and stops the remaining checks. */
const isInteger = Schema.makeFilter<number>(
  (n) => Number.isInteger(n),
  { expected: "an integer", ...wire({ code: "invalid_type", expected: "int" }) },
  true,
);

/** zod's `.int()` safe range: outside ±(2^53−1) is `too_big` / `too_small` with origin `int`; later checks still run. */
const isSafeRange = Schema.makeFilter<number>(
  (n) =>
    Number.isSafeInteger(n)
      ? undefined
      : n > 0
        ? wireIssue({ code: "too_big", origin: "int", maximum: Number.MAX_SAFE_INTEGER })
        : wireIssue({ code: "too_small", origin: "int", minimum: Number.MIN_SAFE_INTEGER }),
  { expected: "a safe integer" },
);

/** `z.number().int()`: a finite, safe integer. */
export const Int = Num.check(isInteger, isSafeRange);

/** `z.boolean()`: a wrong type is `invalid_type` expected `boolean`. */
export const Bool = Schema.Boolean.annotate(wire({ code: "invalid_type", expected: "boolean" }));

/** `z.record(z.string(), z.unknown())`: a non-object (or an array) is `invalid_type` expected `record`. */
export const UnknownRecord = Schema.Record(Schema.String, Schema.Unknown).annotate(
  wire({ code: "invalid_type", expected: "record" }),
);

/** `z.enum([...])`: a wrong or missing value is `invalid_value`. `.literals` replaces zod's `.options`. */
export function Enum<const L extends ReadonlyArray<SchemaAST.LiteralValue>>(values: L): Schema.Literals<L> {
  return Schema.Literals(values).annotate(wire({ code: "invalid_value" }));
}

/** `z.literal(value)`: a wrong or missing value is `invalid_value`. */
export function Lit<const L extends SchemaAST.LiteralValue>(value: L): Schema.Literal<L> {
  return Schema.Literal(value).annotate(wire({ code: "invalid_value" }));
}

/**
 * `z.union([...])`: no member matches is ONE `invalid_union` (the members' own issues are not reported). zod
 * reports a lone non-aborted member's issues instead; no union in this repo has members that can fail that way.
 */
export function OneOf<const Members extends ReadonlyArray<Schema.Constraint>>(members: Members): Schema.Union<Members> {
  return Schema.Union(members).annotate(wire({ code: "invalid_union" }));
}

/** zod's coercion: `Number(input)`; an input `Number` cannot convert stays non-numeric and fails the number rule. */
function coerceNumber(input: unknown): number {
  try {
    return Number(input);
  } catch {
    return Number.NaN;
  }
}

/**
 * `z.coerce.number()`: `Number(input)`, then the `Num` rule (`""` is 0, `"abc"` and `"Infinity"` are
 * `invalid_type` expected `number`, a missing key too). Combine with `withDecodingDefault` for `.default(v)`.
 */
export const CoercedNum = Schema.Unknown.pipe(
  Schema.decodeTo(Num, SchemaTransformation.transform<number, unknown>({ decode: coerceNumber, encode: (n) => n })),
);

/** `z.coerce.number().int()`: `CoercedNum`, then the `Int` rule (`"1.5"` is `invalid_type` expected `int`). */
export const CoercedInt = CoercedNum.check(isInteger, isSafeRange);

/** zod 4.5.4 `regexes.uuid()` (no version): RFC 9562 versions 1-8, the nil and the max UUID. */
const UUID_REGEX =
  /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;

/** zod 4.5.4 `regexes.email`. */
const EMAIL_REGEX =
  /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;

/** zod 4.5.4 `regexes.datetime({ offset: true, local: false, precision: null })`: seconds required, `Z` or `±hh:mm`. */
const DATETIME_OFFSET_REGEX =
  /^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))T(?:(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|([+-](?:[01]\d|2[0-3]):[0-5]\d)))$/;

/** `z.uuid()`: `invalid_format` format `uuid`. */
export const Uuid = Str.check(Schema.isPattern(UUID_REGEX, wire({ code: "invalid_format", format: "uuid" })));

/** `z.email()`: `invalid_format` format `email` (no trimming or lower-casing: pipe `trim` / `lowercase` first). */
export const Email = Str.check(Schema.isPattern(EMAIL_REGEX, wire({ code: "invalid_format", format: "email" })));

/** `z.iso.datetime({ offset: true })`: `invalid_format` format `datetime`. */
export const IsoDateTime = Str.check(
  Schema.isPattern(DATETIME_OFFSET_REGEX, wire({ code: "invalid_format", format: "datetime" })),
);

/** The characters the URL parser deletes before it parses (zod's `stripTabAndNewline`). */
const TAB_OR_NEWLINE = /[\t\n\r]/g;

/** zod 4.5.4's `$ZodURL` rule without `protocol` / `hostname` / `normalize`: `new URL(value.trim())` must not throw. */
function isUrl(value: string): boolean {
  try {
    new URL(value.trim());
    return true;
  } catch {
    return false;
  }
}

/**
 * `z.url()`: `invalid_format` format `url`; any scheme the URL parser accepts passes (`ftp://x`,
 * `mailto:a@b.de`). A valid URL decodes trimmed and without tabs or line breaks, as zod's output does; an
 * invalid one keeps its value, so a later `maxLength` measures the input as zod's does.
 */
export const Url = Str.pipe(
  Schema.decodeTo(
    Str,
    SchemaTransformation.transform({
      decode: (value: string) => (isUrl(value) ? value.trim().replace(TAB_OR_NEWLINE, "") : value),
      encode: (value: string) => value,
    }),
  ),
).check(Schema.makeFilter<string>(isUrl, { expected: "a URL", ...wire({ code: "invalid_format", format: "url" }) }));

// ---------------------------------------------------------------------------------------------------------------
// Transforms (pipeable, applied in chain order like zod's overwrite checks)
// ---------------------------------------------------------------------------------------------------------------

/**
 * zod's `.trim()`: checks before it see the untrimmed value, checks added after it (`.check(...)` on the
 * result) the trimmed one. `Str.check(maxLength(254)).pipe(trim)` is `z.string().max(254).trim()`.
 */
export function trim<S extends Schema.Constraint & { readonly Type: string }>(self: S) {
  return Schema.decodeTo<typeof Str, S>(Str, SchemaTransformation.trim())(self);
}

/** zod's `.toLowerCase()`, in chain order like `trim`. */
export function lowercase<S extends Schema.Constraint & { readonly Type: string }>(self: S) {
  return Schema.decodeTo<typeof Str, S>(Str, SchemaTransformation.toLowerCase())(self);
}

// ---------------------------------------------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------------------------------------------

/** String `.min(n)`: fewer code points is `too_small` origin `string` minimum `n`. */
export function minLength(n: number): SchemaAST.Filter<string> {
  return Schema.isMinCodePoints(n, wire({ code: "too_small", origin: "string", minimum: n }));
}

/** String `.max(n)`: more code points is `too_big` origin `string` maximum `n`. */
export function maxLength(n: number): SchemaAST.Filter<string> {
  return Schema.isMaxCodePoints(n, wire({ code: "too_big", origin: "string", maximum: n }));
}

/** String `.regex(re)`: `invalid_format` format `regex`. */
export function regex(re: RegExp): SchemaAST.Filter<string> {
  return Schema.isPattern(re, wire({ code: "invalid_format", format: "regex" }));
}

/** Number `.min(n)` (zod `gte`): `too_small` origin `number` minimum `n`. */
export function min(n: number): SchemaAST.Filter<number> {
  return Schema.isGreaterThanOrEqualTo(n, wire({ code: "too_small", origin: "number", minimum: n }));
}

/** Number `.max(n)` (zod `lte`): `too_big` origin `number` maximum `n`. */
export function max(n: number): SchemaAST.Filter<number> {
  return Schema.isLessThanOrEqualTo(n, wire({ code: "too_big", origin: "number", maximum: n }));
}

/** Number `.positive()` (zod `gt(0)`): 0 or less is `too_small` origin `number` minimum 0. */
export function positive(): SchemaAST.Filter<number> {
  return Schema.isGreaterThan(0, wire({ code: "too_small", origin: "number", minimum: 0 }));
}

/** Number `.nonnegative()` (zod `gte(0)`): below 0 is `too_small` origin `number` minimum 0. */
export function nonnegative(): SchemaAST.Filter<number> {
  return min(0);
}

/**
 * Array `.min(n)`: fewer items is `too_small` origin `array` minimum `n`. An array filter runs only when every
 * item decoded; zod also reports it after an item failed (plan e1 P7: such a trailing issue may be missing).
 */
export function minItems(n: number): SchemaAST.Filter<ReadonlyArray<unknown>> {
  return Schema.isMinLength(n, wire({ code: "too_small", origin: "array", minimum: n }));
}

/** Array `.max(n)`: more items is `too_big` origin `array` maximum `n` (see `minItems` on item failures). */
export function maxItems(n: number): SchemaAST.Filter<ReadonlyArray<unknown>> {
  return Schema.isMaxLength(n, wire({ code: "too_big", origin: "array", maximum: n }));
}

/** Array `.length(n)`: fewer items is `too_small` minimum `n`, more is `too_big` maximum `n`, origin `array`. */
export function itemsExactly(n: number): SchemaAST.Filter<ReadonlyArray<unknown>> {
  return Schema.makeFilter<ReadonlyArray<unknown>>(
    (items) =>
      items.length === n
        ? undefined
        : items.length < n
          ? wireIssue({ code: "too_small", origin: "array", minimum: n })
          : wireIssue({ code: "too_big", origin: "array", maximum: n }),
    { expected: `exactly ${n} items` },
  );
}

/** The wire issue of a keyed refinement: zod's `custom` with `params.i18n` (`refineKey`). */
function keyedMeta(key: ServerKey): WireIssue {
  return { code: "custom", params: { i18n: key } };
}

/**
 * zod's `.refine(predicate, refineKey(key))`, optionally with a `path` (`{ ...refineKey(key), path }`): a
 * `custom` issue with `params.i18n`. On a struct it runs only when every field decoded (plan e1 P7).
 */
export function keyed<T>(
  predicate: (value: T) => boolean,
  key: ServerKey,
  options?: { readonly path?: ReadonlyArray<string | number> },
): SchemaAST.Filter<T> {
  const path = options?.path;
  return Schema.makeFilter<T>(
    (value) =>
      predicate(value) ? undefined : path === undefined ? wireIssue(keyedMeta(key)) : { path, issue: wireIssue(keyedMeta(key)) },
    { expected: key, ...wire(keyedMeta(key)) },
  );
}

/**
 * zod's `ctx.addIssue({ code: "custom", path, ...refineKey(key) })` inside `.superRefine`: what a hand-written
 * `Schema.makeFilter` returns (alone or in an array) to report a keyed issue, at `path` when given.
 */
export function keyedIssue(key: ServerKey, path?: ReadonlyArray<string | number>): Schema.FilterIssue {
  return path === undefined ? wireIssue(keyedMeta(key)) : { path, issue: wireIssue(keyedMeta(key)) };
}

// ---------------------------------------------------------------------------------------------------------------
// Struct helpers
// ---------------------------------------------------------------------------------------------------------------

/** A field whose encoded side is already optional (`optional`, `optionalKey`, a decoding default) stays as it is. */
type PartialFields<F extends Schema.Struct.Fields, K extends keyof F> = {
  readonly [P in keyof F]: P extends K
    ? F[P] extends { readonly "~encoded.optionality": "optional" }
      ? F[P]
      : Schema.optional<F[P]>
    : F[P];
};

/**
 * zod's `.partial()` (every field) or `.partial({ a: true })` (the listed `keys`): the fields become
 * `Schema.optional`; a field with a decoding default KEEPS it and still fills an absent key, as zod 4 does.
 * The struct's own checks are not carried over (zod refuses `.partial()` on a refined object).
 */
export function partial<F extends Schema.Struct.Fields, K extends keyof F = keyof F>(
  struct: Schema.Struct<F>,
  keys?: ReadonlyArray<K>,
): Schema.Struct<PartialFields<F, K>> {
  const selected = keys === undefined ? undefined : new Set<PropertyKey>(keys);
  const fields: Record<PropertyKey, Schema.Constraint> = {};
  for (const name of Reflect.ownKeys(struct.fields)) {
    const field = struct.fields[name]!;
    const encodedOptional = SchemaAST.isOptional(SchemaAST.toEncoded(field.ast));
    fields[name] = (selected === undefined || selected.has(name)) && !encodedOptional ? Schema.optional(field) : field;
  }
  return Schema.Struct(fields as PartialFields<F, K>);
}
