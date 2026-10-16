# effect-schema: Schema in Effect 4

Distilled from the vendored source (`repos/effect`, `effect@4.0.5`) for toon-household. Not a replacement for
`repos/effect/packages/effect/SCHEMA.md`; a map of what this repo uses. Every API below was grepped in
`repos/effect/packages/effect/src/`. Where SCHEMA.md and the source disagree, the source wins (section 6).

## 1. What it is for, and the imports

`Schema` defines a data shape once and gives a runtime validator, a TypeScript type (`typeof X.Type`, the
decoded side; `typeof X.Encoded`, the wire side), and codecs between the two. All validation and domain
modelling goes through it (LLMS.md "Defining schemas": "AVOID using predicates or manual parsing").

```ts
import { Effect, Exit, Option, Predicate, Result, Schema, Struct, Tuple } from "effect"
import { SchemaGetter, SchemaIssue, SchemaParser, SchemaTransformation } from "effect"
```

- One package, one entry: `effect`. `SchemaIssue`, `SchemaGetter`, `SchemaTransformation`, `SchemaParser` are
  top-level exports of `effect` (`src/index.ts`). There is no `@effect/schema`.
- `effect/schema` is NOT the Schema module (it holds `Model` and `VariantSchema`). SCHEMA.md's one
  `from "effect/schema"` snippet is stale; never write it.
- Types: `typeof User.Type`, `typeof User["Encoded"]`, or `Schema.Schema.Type<typeof User>` and
  `Schema.Codec.Encoded<typeof User>`.

## 2. Constructors and the call shapes this repo uses

Wire bodies, queries and params: `Schema.Struct`, `Literals`, `Union`, `optionalKey`, `Array`, `Record`.

```ts
const Body = Schema.Struct({
  title: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(200)),
  role: Schema.Literals(["admin", "member"]),
  note: Schema.optionalKey(Schema.String),          // key may be absent, never undefined
  tags: Schema.Array(Schema.String),                // readonly string[]
  prices: Schema.Record(Schema.String, Schema.Int)  // Record(key, value), not an object argument
})
const Shape = Schema.Union([Schema.String, Schema.Number])        // array, not variadic
```
Source: `repos/effect/packages/effect/SCHEMA.md` (Structs, Optional and Mutable Keys, Arrays, Records, Unions,
Union of Literals); `repos/effect/migration/schema.md` (Record, variadic-to-array rows).

Entities and domain models: `Schema.Class` (validates on `new`, decodes to a class instance). Errors:
`Schema.TaggedError` (section 4).

```ts
export class User extends Schema.Class<User>("path/to/module/User")({
  id: Schema.Int,
  name: Schema.NonEmptyString,
  role: Schema.Literals(["admin", "member"])
}) {}

export const decodeUser = Schema.decodeUnknownEffect(User)   // build once, reuse
export const encodeUser = Schema.encodeEffect(User)
```
Source: `repos/effect/ai-docs/src/01_effect/02_schema/10_schema-basics.ts`.

Custom rules: `.check(...)` with the built-in `is*` filters or `Schema.makeFilter`; `Schema.refine` to narrow
the type; `Schema.brand("Name")` for a nominal type (type-only, no runtime check).

```ts
const Cents = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const Slug = Schema.String.check(Schema.isPattern(/^[a-z0-9-]+$/), Schema.isMaxLength(64))
const PasswordForm = Schema.Struct({ password: Schema.String, confirmPassword: Schema.String }).check(
  Schema.makeFilter((o) =>
    o.password === o.confirmPassword ? undefined : { path: ["password"], issue: "password and confirmPassword must match" }
  )
)
const Branded = Schema.String.pipe(Schema.brand("UserId"))
```
Source: `SCHEMA.md` (Strings, Numbers, Filter return shapes, Branding, Refinements). A filter returns `undefined` or
`true` (ok), `false`, a message string, a `SchemaIssue.Issue`, `{ path, issue }`, or an array of those.

Transformations (wire form to domain form): `Schema.decodeTo(target, transformation)` or `Schema.decode(t)` when
source and target are the same schema. Built-ins worth knowing: `Schema.NumberFromString`,
`Schema.FiniteFromString`, `Schema.DateFromString`, `Schema.DateTimeUtcFromMillis` (unix ms in SQLite to
`DateTime.Utc`), `Schema.DateTimeUtcFromString` (ISO string), `Schema.Trim`.

```ts
const Kilometers = Schema.Finite.pipe(
  Schema.decode(SchemaTransformation.transform({ decode: (m) => m / 1000, encode: (km) => km * 1000 }))
)
const Trimmed = Schema.String.pipe(Schema.decode(SchemaTransformation.trim()))
```
Source: `SCHEMA.md` (Defining an Inline Transformation, decode); `src/Schema.ts` (`DateTimeUtcFromMillis`).

## 3. Composing, decoding, encoding, providing

| Need | Call | Result |
| --- | --- | --- |
| untrusted input inside Effect | `Schema.decodeUnknownEffect(S)(input, opts)` | `Effect<Type, SchemaError, DecodingServices>` |
| same, as data | `Schema.decodeUnknownExit` / `decodeUnknownResult` / `decodeUnknownOption` | `Exit` / `Result` / `Option` |
| sync boundary (tests, scripts, config) | `Schema.decodeUnknownSync(S)(input)` | value, or throws `SchemaError` |
| typed `Encoded` input | `Schema.decodeEffect` / `decodeSync` | as above, input typed |
| domain to wire | `Schema.encodeEffect(S)` / `encodeSync` / `encodeUnknownSync` | encoded value |
| check only | `Schema.is(S)(u)`, `Schema.asserts(S, u)` | type guard / assertion |
| build a valid value | `S.make(input)`, `S.makeOption(input)` | value / throws / `Option` |

Source: `src/Schema.ts` (decoding and encoding exports), `SCHEMA.md` (Constructors). `Schema.*` variants fail with
`SchemaError`; the `SchemaParser.*` twins fail with the bare `SchemaIssue.Issue`.

- Options (`SchemaAST.ParseOptions`): `errors: "first" | "all"` (default `"first"`; a validation envelope that lists
  every field needs `{ errors: "all" }`), `onExcessProperty: "ignore" | "error"` (default `"ignore"`: unknown keys
  are stripped), `reportInput` (off; turning it on can leak secrets into messages).
- Defaults while decoding: `S.pipe(Schema.withDecodingDefaultKey(Effect.succeed("x")))` (key absent) or
  `withDecodingDefault` (absent or `undefined`); the `...Type` variants take a decoded-side value. Constructor
  defaults: `Schema.withConstructorDefault(Effect.succeed(-1))`.
- Deriving: `Struct.mapFields(Struct.pick(["a"]))`, `Struct.omit([...])`, `fieldsAssign({ c: Schema.Number })`,
  `mapFields(Struct.map(Schema.optionalKey))` (v3 `partial`); reuse `X.fields` to share fields. Wrapping a field
  that has a decoding default in `Schema.optional` DROPS the default for an absent key (`{}` decodes to `{}`,
  measured in E1-T02); zod's `.partial()` keeps it, so this repo uses `partial` from
  `packages/shared/src/core/schemas/checks.ts`, which leaves such a field as it is.
  Source: `repos/effect/migration/schema.md` (pick / omit, partial, extend).
- Tagged unions: `Schema.TaggedStruct("A", {...})`, `Schema.TaggedUnion({ A: {...}, B: {...} })`; `Schema.tag("A")`
  gives a `_tag` field; `Schema.toTaggedUnion("type")` adds `cases`, `guards`, `match`, `isAnyOf`.
- Services: a schema's `DecodingServices` stay `never` unless a getter is effectful (`SchemaGetter.checkEffect`,
  `transformEffect`); only then does the decode Effect need `Effect.provide(...)`. Keep wire schemas service-free
  so they run in the browser and in `packages/shared`.
- JSON: `Schema.fromJsonString(S)` decodes a JSON string; `Schema.toCodecJson(S)` derives a JSON-safe codec.
- Effectful rule (async or service-backed): `Schema.decode({ decode: SchemaGetter.checkEffect((v, o) => ...),
  encode: SchemaGetter.passthrough() })` (SCHEMA.md "Effectful Filters").

## 4. Error handling

- A failed decode is a typed failure, `SchemaError` (`Data.TaggedError("SchemaError")`, field `issue`,
  `message` = default formatting), so `Effect.catchTag("SchemaError", ...)` works. Source: `src/Schema.ts`.
- Map it once at the boundary, never per call site:

```ts
Schema.decodeUnknownEffect(User)(input).pipe(
  Effect.mapError((error) => new InvalidUserPayload({ message: error.message }))
)
```
Source: `repos/effect/ai-docs/src/01_effect/02_schema/10_schema-basics.ts`.

- `decodeUnknownSync` throws; a non-schema failure inside it (defect, async) throws something else. Use the
  Effect form wherever the code is already in Effect.
- Issue tree (`SchemaIssue.Issue`): leaves `InvalidType`, `InvalidValue`, `MissingKey`, `UnexpectedKey`,
  `Forbidden`, `OneOf`; nodes `Filter` (`.filter`, `.issue`), `Encoding`, `Pointer` (`.path`, `.issue`),
  `Composite` (`.issues`), `AnyOf` (`.issues`). Formatters: `SchemaIssue.makeFormatterDefault()` (string) and
  `SchemaIssue.makeFormatterStandardSchemaV1({ leafHook, checkHook })` (`{ issues: [{ path, message }] }`).
  Hooks return strings and see no path; a `{ path, message, code }` list (this repo's envelope, E4) needs a walk:

```ts
const walk = (issue: SchemaIssue.Issue, path: ReadonlyArray<PropertyKey>): Array<{ path: ReadonlyArray<PropertyKey>; issue: SchemaIssue.Issue }> => {
  switch (issue._tag) {
    case "Pointer": return walk(issue.issue, [...path, ...issue.path])
    case "Composite": case "AnyOf": return issue.issues.flatMap((i) => walk(i, path))
    case "Encoding": return walk(issue.issue, path)
    case "Filter": return issue.issue._tag === "InvalidValue" ? [{ path, issue }] : walk(issue.issue, path)
    default: return [{ path, issue }]
  }
}
```
Adapted from `toDefaultIssues` in `src/SchemaIssue.ts` (same branching). The leaf then maps to a catalog key.

- Metadata that survives onto the issue: a filter's `annotations` (`Schema.makeFilter(pred, { ...annotations })`).
  `Schema.Annotations.Annotations` is `{ readonly [x: string]: unknown }`, so a custom key (an i18n key, the
  replacement for zod's `refineKey`) can ride on it and be read as `issue.filter.annotations`. Built-in filters
  carry `representation: { id, payload }`, e.g. `id: "effect/schema/isMinLength"`, `payload: { minLength }`
  (`src/Schema.ts`, `makeIsMinLength`), the data a key resolver needs.
- Defects (bugs, `Effect.die`) are not `SchemaError`; they never reach `catchTag`.

## 5. v3 to v4 renames that bite

Source: `repos/effect/migration/schema.md` summary table and notes.

| v3 | v4 |
| --- | --- |
| `Schema.Union(A, B)`, `Tuple(A, B)`, `TemplateLiteral(A, B)` | `Schema.Union([A, B])`, `Tuple([A, B])`, `TemplateLiteral([A, B])` |
| `Schema.Literal("a", "b")` | `Schema.Literals(["a", "b"])` (single `Literal("a")` stays; `Literal(null)` is `Null`) |
| `Schema.Record({ key, value })` | `Schema.Record(key, value)` |
| `.annotations({...})` | `.annotate({...})` |
| `Schema.filter(pred)` | `.check(Schema.makeFilter(pred))` |
| `Schema.filter(refinement)` | `Schema.refine(refinement)` |
| `greaterThan`, `between`, `int`, `minLength`, `maxLength`, `length`, `pattern(re)`, `nonEmptyString` | `isGreaterThan`, `isBetween`, `isInt`, `isMinLength`, `isMaxLength`, `isBetweenLength`, `isPattern(re)`, `isNonEmpty` (all via `.check`); `positive` and friends are removed |
| `Schema.UUID` | `Schema.String.check(Schema.isUUID())` |
| `Schema.transform(from, to, {decode, encode})` | `from.pipe(Schema.decodeTo(to, SchemaTransformation.transform({ decode, encode })))` |
| `Schema.transformOrFail` | `Schema.decodeTo(to, { decode: SchemaGetter.transformEffect(...), encode: ... })` |
| `Schema.compose(b)` | `Schema.decodeTo(b)` |
| `pick("a")`, `omit("a")`, `partial`, `extend(B)` | `mapFields(Struct.pick(["a"]))`, `Struct.omit`, `Struct.map(Schema.optional)`, `Struct.assign(fields)` or `fieldsAssign` |
| `optionalWith(S, { exact: true })` | `Schema.optionalKey(S)` |
| `optionalWith(S, { default })` | `S.pipe(Schema.withDecodingDefaultType(Effect.succeed(v)))` |
| `Schema.decodeUnknown`, `decode` | `decodeUnknownEffect`, `decodeEffect` (same for `encode*`) |
| `decodeUnknownEither`, `decodeEither` | `decodeUnknownExit`, `decodeExit` (`decodeUnknownResult` for `Result`) |
| `Schema.validate*` | removed: `Schema.decodeSync(Schema.toType(S))` |
| `Schema.Date` (ISO string to Date) | `Schema.DateFromString` (v4 `Schema.Date` is the old `DateFromSelf`) |
| `DateFromNumber` | `DateFromMillis`; `OptionFromSelf` is `Schema.Option`; `Redacted` is `RedactedFromValue` |
| `Schema.asserts(S)(u)` | `Schema.asserts(S, u)` |
| `ParseResult.ArrayFormatter` | `SchemaIssue.makeFormatterStandardSchemaV1()(issue).issues` |
| `Schema.parseJson(S)` | `Schema.fromJsonString(S)` |
| `Schema.NonEmptyTrimmedString` | `Schema.Trimmed.check(Schema.isNonEmpty())` |
| `Schema.Class<A>("A")({...})`, `TaggedError<A>()("T", {...})` | unchanged call shape |

## 6. Pitfalls

- Defaults differ from what a v3 or zod habit expects: `errors` is `"first"`, excess keys are silently
  stripped, a struct key is required unless `optionalKey` / `optional`. `optional` admits `undefined`;
  `optionalKey` does not. Pick on purpose (SCHEMA.md "Optional Fields").
- Filters never change the schema's type: `.check` keeps `.fields`, `.make` (SCHEMA.md "Preserving Schema Type").
  Structural filters (`isMinLength` on an array) run only after every nested value parsed.
- `.check(...)` filters are synchronous. Async or service-backed validation needs `SchemaGetter.checkEffect`.
- `Schema.brand` is type-only: no runtime validation, one brand per identifier. Its argument is required.
- A `Schema.Class` instance is a class, not a plain object: turn it into its wire form with `encode*`
  (`Schema.toCodecJson` for JSON), do not hand it to `JSON.stringify` and assume the encoded shape.
- `Schema.Int` is `Number.check(isInt())`: money stays integer cents, but `Schema.Number` admits `NaN`; use
  `Schema.Finite` or `Schema.Int` for amounts. In this repo use `Num` / `Int` of
  `packages/shared/src/core/schemas/checks.ts` instead: `Schema.isInt` is `Number.isSafeInteger`, so `1e20` would
  fail as "not an integer" where zod (and `Int`) report `too_big` with origin `int`.
- `isMinLength` / `isMaxLength` count UTF-16 units; `isMinCodePoints` / `isMaxCodePoints` count code points.
- Stale doc lines (checked against the source): SCHEMA.md reads `issue.filter.annotations?.meta` in a hook
  example, but filters carry `representation` (section 4); SCHEMA.md imports `Getter`, `Parser` from
  `"effect/schema"`, the real exports are `SchemaGetter`, `SchemaParser` from `"effect"`; there is no
  top-level `Schema.transform` or `Schema.UUID` in v4.
- LLMS.md: never write your own `isRecord` / `isString`; use `Predicate` (`isObject`, `isString`, `isNotNull`, ...).
  `Predicate.isRecord` does not exist; `Predicate.isObject` is the non-null-object guard.
- Do not log a `SchemaError` produced with `reportInput: true` (it can carry secrets).

## 7. In this repo

- Where it lands (E4, milestone E1): `packages/shared/src/core/schemas/{common,household,user,auth}.ts`,
  `packages/shared/src/modules/recipe/schemas/*.ts`, `packages/shared/src/modules/finance/schemas/*.ts`,
  `packages/shared/src/core/i18n/issues.ts` (the issue-to-catalog adapter is a `SchemaIssue` walk, `flattenIssue`,
  over the `WIRE_ISSUE` annotations of the vocabulary `packages/shared/src/core/schemas/checks.ts`; `refineKey`
  becomes `keyed` / `keyedIssue` there), `apps/api/src/core/services/households/validation.ts` (`onValidationError`) and the route files that use
  `@hono/zod-validator` (a `validate(target, schema)` helper decoding with `{ errors: "all" }`),
  `apps/web/src/lib/validation.ts`.
- Tests: `packages/shared/test/` keeps its assertions; add table-driven accept/reject parity cases per schema file;
  run schemas with `Schema.decodeUnknownSync` / `decodeUnknownExit` under `bun test`.
- Rule served: **E4** ("`Schema` replaces Zod as THE contract": same accepted and rejected inputs, same
  `422 { error: { code: "validation_failed", message, details: [{ path, code, message, i18n }] } }` envelope of
  `docs/API.md`, wording from the
  catalog (ADR 0002), never Effect's default messages), with **E12** (`Schema` instead of manual parsing,
  `Schema.TaggedError` for errors, `Predicate` instead of hand-written guards).

**As built (E0):** no `Schema` code exists in the repo yet; E0 touches no schema file and the health payload is still
checked by the Zod `HealthResponseSchema` (`packages/shared/src/core/schemas/common.ts`), which
`apps/api/test/runtime.test.ts` uses to prove the Effect-built body keeps its shape. That test is the parity
check E1 must keep green when `HealthResponseSchema` becomes a `Schema.Struct` (same accepted input, same key order
on the wire: the order comes from the object `healthResponse` builds, not from the schema).

**As built (E1):** every shared schema is an Effect `Schema`; `zod` and `@hono/zod-validator` are gone (rule (9) of
`apps/api/test/effect-idioms.test.ts`). The three moving parts, each with the real code:

- **The vocabulary, `packages/shared/src/core/schemas/checks.ts`.** A failure that reaches the wire carries a
  `WIRE_ISSUE` annotation (the Zod issue it replaces: `code` plus `origin`, `expected`, `format`, bounds), never an
  Effect message. A string bound is a filter that annotates itself:
  ```ts
  export function minLength(n: number): SchemaAST.Filter<string> {
    return Schema.isMinCodePoints(n, wire({ code: "too_small", origin: "string", minimum: n }));
  }
  ```
  A catalog-keyed rule (Zod's `.refine(p, refineKey(key))`) is `keyed(predicate, key)`; a rule that reports at a
  path is `Schema.makeFilter` returning `keyedIssue(key, path)`.
- **The adapter, `packages/shared/src/core/i18n/issues.ts`.** `flattenIssue` walks the `SchemaIssue` tree and
  reads the annotations back; `toValidationIssues` resolves each flat issue through the catalog ladder (unchanged
  since the Zod era, keys still `server.zod.*`):
  ```ts
  export function toValidationIssues(source: SchemaIssue.Issue, locale: Locale = DEFAULT_LOCALE) {
    return flattenIssue(source).map((issue) => {
      const resolved = resolveIssue(issue, locale);
      return { path: issue.path.join("."), code: issue.code, message: resolved.message,
        i18n: { key: resolved.key, values: resolved.values } };
    });
  }
  ```
- **A flipped schema, `packages/shared/src/core/schemas/user.ts`.** The Zod chain `z.string().trim().min(1).max(80)
  .refine(noControlChars, refineKey(...))` is a `pipe` and `check`:
  ```ts
  export const DisplayNameSchema = Str.pipe(trim).check(
    minLength(1),
    maxLength(80),
    keyed(hasNoControlChars, "server.validation.noControlChars"),
  );
  export type OAuthProvider = Types.DeepMutable<typeof OAuthProviderSchema.Type>;
  ```
  Exported types are `Types.DeepMutable<typeof X.Type>` (Effect's `Type` is readonly, Zod's output was not).

Rules learned in E1: decode with `ALL_ISSUES` (`{ errors: "all" }`) wherever `details` or a form field error is
rendered, or only the first issue survives; `Schema.withDecodingDefault` validates the ENCODED side first, so a
default over items that transform or carry checks is `Schema.withDecodingDefaultType` (it hides every item check
behind one `invalid_type` otherwise); a struct's own checks and an array or string length check do not run while a
child failed (Zod's did), which the parity tests list as P7 allow-map entries; plain `Schema.Number` accepts `NaN`
and `±Infinity`, so a wire number is `Num` (finite filter that aborts). The oracle is the golden JSON in
`packages/shared/test/fixtures/schema-golden/`, run by `packages/shared/test/parity/*.parity.test.ts` through
`packages/shared/test/support/schema.ts`; a new vocabulary construct gets a `primitives.json` case first. The API
decodes through `apps/api/src/lib/validate.ts` (`validate`, `decodeOrThrow`, `decodeOption`), which throws
`Schema.SchemaError`; `toApiError` maps it once to `422 validation_failed`.
