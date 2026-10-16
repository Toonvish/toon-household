# E1 — shared-schema: plan

**Status: DONE (2026-10-16).** Planned and revised once after review the same day. Base commit `f41fb96f3` (E0
documentation sync). Sections 9 and 10 (the integration record and "what changed vs plan") were written by E1-T12.

E1 is the second milestone of the Effect migration (`docs/EFFECT.md` §4 E1, decision E4): every Zod schema in
`packages/shared` becomes an Effect `Schema` with the same accepted and rejected inputs, the validation-error
adapter (`toValidationIssues`) reads a `SchemaIssue` tree and returns the same `details` items, the API validates
through one helper (`apps/api/src/lib/validate.ts`) instead of `@hono/zod-validator`, the web forms validate with
the same shared schemas and show the same messages, `env.ts` and `lib/oauth.ts` lose their local Zod schemas, and
`zod` plus `@hono/zod-validator` leave all three `package.json` and `bun.lock`. The idioms gate gets its rule
"no zod". The guiding sentence holds: how the code is written changes, not what it does. The one observable change
is recorded in ADR 0013 (section 2, P10, P7) and is a conformance to `docs/API.md` "Conventions", not a new
contract.

Exit (`docs/EFFECT.md` §4 E1 and the milestone task): gates green; `grep -rn --include='*.ts' --include='*.tsx'
--exclude-dir=node_modules 'from "zod' apps packages scripts` is empty and `bun.lock` has no `zod` and no
`@hono/zod-validator` key; every API validation test and every shared test passes with unchanged assertions; the
golden parity tests pass (section 2, P1); `bun run i18n:check` prints `[i18n:check] OK` for the parity half and
the same 146 classified leftover-German hits; the pass count is not below E0's record (2463).

## 1. Context

### 1.1 State of the tree at plan time (`f41fb96f3`, measured 2026-10-16)

- **E0 is done.** `effect@4.0.5` and `@effect/platform-bun@4.0.5` are pinned in the three workspace
  `package.json` files (`effect` in `packages/shared`, `apps/api`, `apps/web`); `repos/effect` is the vendored
  source; `apps/api/src/runtime.ts` holds the one `ManagedRuntime`; `apps/api/test/effect-idioms.test.ts` has
  rules (1) to (8) and a `PENDING_RULES` comment whose first line is "E1 (shared-schema) No `zod` import or
  dependency anywhere". No application file imports `Schema` yet.
- **Zod today.** `zod@^4.5.4` is a dependency of `packages/shared`, `apps/api`, `apps/web`;
  `@hono/zod-validator@^0.9.1` of `apps/api`. `bun.lock` has exactly SIX lines matching `zod` (`grep -n zod bun.lock`):
  line 20 `"@hono/zod-validator": "^0.9.1",` (the apps/api workspace dependency), lines 29, 45 and 62
  `"zod": "^4.5.4",` (the three workspace dependencies), line 315 the `"@hono/zod-validator":
  ["@hono/zod-validator@0.9.1", …]` package entry (peer `zod`) and line 1165 the `"zod": ["zod@4.5.4", …]` package
  entry. Nothing else depends on zod, so the two `bun remove` calls of E1-T11 delete exactly these six lines and
  change nothing else in the file.
- **The 33 files that import zod** (`grep -rln 'from "zod'`):
  - `packages/shared/src`: `core/i18n/zod.ts` (the issue resolver: `refineKey`, `resolveZodIssue`,
    `toValidationIssues`), `core/schemas/{common,user,household,auth}.ts`, `modules/registry.ts`,
    `modules/finance/schemas/{balance,categories,common,participants,plan,settlements,tags,transactions}.ts`,
    `modules/recipe/schemas/{card,import,plan,recipe,shopping}.ts` (17 schema files, about 2460 lines, half of it
    doc comments).
  - `packages/shared/test`: `i18n.test.ts` (inline zod schemas), `finance-schemas.test.ts`
    (`listResponse(z.object(…))`); `finance-i18n.test.ts` imports `$ZodIssue` from `zod/v4/core`.
  - **Zod-API users outside the 33** (they call `.safeParse` / `.parse` on a shared schema but import no zod, so
    `grep 'from "zod'` misses them; found with `grep -rnE 'Schema\.(safeParse|parse)\(' apps packages`):
    `packages/shared/test/core.test.ts` and `household.test.ts` (rewritten by E1-T08), `finance-schemas.test.ts`
    (E1-T08 one test, E1-T09 the rest), `recipe-schemas.test.ts`, `cards.test.ts` and `ingredients.test.ts`
    (line 216, `RecipeIngredientSchema.safeParse(parseIngredientLine(line))`; all three E1-T10),
    `apps/api/test/{smoke,runtime}.test.ts` (E1-T08). `packages/shared/tsconfig.json` includes `test/**/*.ts`, so
    `bun run typecheck` fails on any of them that a flip leaves behind.
  - `apps/api/src`: `env.ts` (`EnvSchema`), `lib/oauth.ts` (Google/GitHub claim schemas), `lib/errors.ts`
    (`instanceof ZodError` → `toValidationIssues`), `core/routes/auth.ts` (`readJson` with `schema.parse`,
    `OAuthProviderSchema.safeParse`, `OAuthProviderSchema.options`), `modules/recipe/routes/{cards,imports}.ts`
    (`readJson` with `schema.parse`), `modules/recipe/routes/shopping.ts` (two local query schemas built with
    `PaginationQuerySchema.extend` and `z.enum`).
  - `apps/web/src`: `lib/validation.ts` (`validate`, `zodFieldErrors` via `resolveZodIssue`),
    `modules/recipe/features/import/lib/importApi.ts` (`parseOrPassThrough(schema: ZodType)`),
    `core/features/households/components/InvitePanel.tsx` (a local `z.object` over shared `EmailSchema`),
    `modules/finance/features/overview/components/{MonthSummaryCard,SpendByCategoryCard}.tsx` (`z.infer`).
- **`zValidator` call sites: 58** (42 `"json"`, 16 `"query"`) in 15 route files: `apps/api/src/core/routes/{households,invites,members}.ts`,
  `apps/api/src/modules/finance/routes/{balance,categories,participants,plan,settlements,tags,transactions}.ts`,
  `apps/api/src/modules/recipe/routes/{plan,recipes,shopping}.ts`; every one passes `onValidationError`
  (`apps/api/src/core/services/households/validation.ts`). Other zod-API uses outside `packages/shared`:
  `EnableModuleRequestSchema.safeParse` + `onValidationError` in `apps/api/src/core/routes/modules.ts`,
  `FinanceEnableSettingsSchema.safeParse` in `apps/api/src/modules/finance/setup.ts`,
  `ParsedRecipeSchema.safeParse` / `ImportSourceMetaSchema.safeParse` in
  `apps/api/src/modules/recipe/services/import/drafts.ts`, `IsoDateSchema.safeParse` in the shopping route,
  `ImportDraftListQuerySchema.parse` / `ParsedRecipeSchema.parse` in the imports route,
  `HealthResponseSchema.parse` in `apps/api/test/{smoke,runtime}.test.ts`, and 16 web `validate(XSchema, …)`
  form call sites (they keep their shape: `validate` changes underneath).
- **The wire today has two validation paths.** (a) `zValidator(target, X, onValidationError)` throws
  `ApiError.validationFailed(details)` where each item is `{ path, code, message }` with **Zod's own English
  default message** (`"Too small: expected string to have >=1 characters"`) and no `i18n`. (b) `readJson`
  (`auth.ts`, `cards.ts`, `imports.ts`) lets a `ZodError` escape; `toApiError` in `lib/errors.ts` renders it with
  `toValidationIssues(error, locale)`: `{ path, code, message, i18n: { key, values } }`, the message from the
  server catalog in the negotiated locale. `docs/API.md` "Conventions" documents only (b) ("a validation
  issue's `message` is rendered in the negotiated locale … also carries `i18n`"). The status is **422
  `validation_failed`** on both paths (the milestone task's "400 validation_error" is not the contract; P9).
  No test asserts a Zod default message; the API tests pin `path`, `code` and `i18n.key` of `details[0]`
  (`apps/api/test/{security,cards,finance-participants,finance-security,finance-plan}.test.ts`).
- **Zod facts the rewrite must reproduce**, measured with zod 4.5.4 at plan time (issue fields without
  `message`):
  - `z.object({name: z.string().min(1)})` on `{name: ""}`: `too_small`, `origin "string"`, `minimum 1`.
  - `z.coerce.number().int()` on `"1.5"` and `"-0.5"`: `invalid_type`, `expected "int"` (no min/max issue
    after it); on `"abc"`: `invalid_type`, `expected "number"` (received NaN); `""` coerces to 0 and then fails
    `min(1)` as `too_small`; `.default(24)` fires only for `undefined`.
  - `z.number().int()` on `1e20` / `-1e20`: `too_big maximum 9007199254740991` / `too_small minimum
    -9007199254740991`, `origin "int"`. `z.number()` refuses `NaN` and `Infinity` as `invalid_type expected
    "number"`.
  - `z.enum([...])` on a wrong or missing value: `invalid_value` (also for a missing key). A
    `z.union([z.literal(1), z.literal(2)])` is `invalid_union`. A missing `z.string()` key is `invalid_type
    expected "string"`. A non-object for `z.object` is `invalid_type expected "object"`; for
    `z.record(z.string(), z.unknown())` `expected "record"`. `z.string().nullish()` given `1` is `invalid_type
    expected "string"` (the null/undefined wrapper is transparent).
  - Arrays: `.length(2)` gives `too_small minimum 2` / `too_big maximum 2` with `origin "array"`.
    `.positive()` on 0 is `too_small minimum 0` (bound 0, inclusive false). `z.email()` and `z.uuid()` and
    `z.iso.datetime({offset: true})` are `invalid_format` with `format` `email` / `uuid` / `datetime`;
    `z.url()` accepts `ftp://x` and refuses `not a url` (`invalid_format`, `format "url"`).
  - Chained refinements all run: `z.string().refine(a).refine(b)` reports both when both fail. An
    object-level `.refine` **also runs after a continuable field issue** (`too_small`, `custom`):
    `z.object({a: z.string().min(3)}).refine(() => false)` on `{a: "x"}` gives two issues, the field's then a
    `custom` with `path []` (P7). After an `invalid_type` field issue it does not run.
  - `.optional()` and `.nullish()` keep a present `undefined` key in the output (`{a: undefined}`), `.default([])`
    fills `[]`; `.partial()` of an object whose field has `.default([])` STILL fills `[]` for an absent key
    (the reason `keepOnlySentKeys` exists).
- **Effect facts** (vendored source, `repos/effect/packages/effect/src/`): a struct's `.check` runs only when the
  struct's own parser succeeded (`internal/schema/interpreter.ts` around line 180); with `errors: "all"` every
  check of a `.check(...)` list runs unless a filter is `abort`ed (`SchemaAST.ts` `collectIssues`); the default
  `onExcessProperty` is `"ignore"` (unknown keys stripped, like zod); a missing key is a `MissingKey` leaf with
  no AST (its type is found through the parent `Composite`'s `Objects` AST); a failed `Schema.Literals` is an
  `AnyOf` over the union AST with an empty `issues` array; `Schema.optional` keeps a present `undefined` key;
  `Schema.decodeUnknownSync` throws a `Schema.SchemaError` (`isSchemaError`, field `issue`); a filter's
  annotations reach the issue as `issue.filter.annotations` (`Schema.makeFilter(pred, annotations, abort)`).
- **i18n:check** (run at plan time, about 3 minutes): `[i18n:check] OK` after "1/2 German catalog parity…", then
  `[i18n:check] FAILED — 146 possible German literal(s):`. Hits in files E1 touches: 6 in
  `packages/shared/src/modules/recipe/schemas/shopping.ts`, 1 each in `…/recipe/schemas/{recipe,import}.ts`,
  6 in `apps/api/src/modules/recipe/routes/shopping.ts`, 1 in `apps/api/src/modules/recipe/routes/cards.ts`
  (line 56, `("Prüfziffer passt nicht")`), 1 in `apps/web/src/lib/validation.ts` (line 12). All are doc
  comments; every rewrite keeps them verbatim, so the count stays 146 (P19). `packages/shared/test` is not
  scanned.

### 1.2 Baseline

`bun test` at `f41fb96f3`, 2026-10-16, this machine (Bun 1.4.3): **2463 pass, 0 fail, 13036 expect() calls,
2463 tests in 141 files, 88.96 s**. `baseline_tests` = **2463** (equal to E0's record). Floor for every task: its
branch passes at least 2463 plus the tests it adds, 0 fail (the thumbnail-timeout tolerance of P17 aside).

### 1.3 Bundle size

E0 recorded the gzipped total of `apps/web/dist/assets/*.js` as **399812 bytes** (pre-Effect). E1 removes zod from
the web bundle and brings in `effect`'s `Schema` through `@toon/shared`, so the bundle changes here for the first
time. E1-T12 measures it with the same loop and records the delta (no gate in E1; E6 owns the 60 kB budget and
compares against E0's number).

## 2. Decisions (binding for the tasks)

| # | Decision | Serves |
| --- | --- | --- |
| P1 | **The golden corpus is the oracle.** Before any schema changes, E1-T01 runs every exported schema of the 17 files (and the two shopping route-local query schemas, P12) against a table of inputs with ZOD and commits the results as JSON under `packages/shared/test/fixtures/schema-golden/`, one file per source file (`core.common.json`, `core.user.json`, `core.household.json`, `core.auth.json`, `core.registry.json`, `finance.<file>.json` ×8, `recipe.<file>.json` ×5; the route-local schemas go into `recipe.shopping.json` under their future names `ShoppingBoughtListQuerySchema`, `ShoppingCatalogListQuerySchema`). E1-T02 adds `primitives.json` the same way for the zod constructs themselves. The format is fixed here (P2) so both tasks write it independently. After the flips, `packages/shared/test/parity/{core,finance,recipe}.parity.test.ts` decode every case with the Effect schema and require: the same `ok`; when ok, a deep-equal `output`; when not ok, the same flattened `issues` and the same `details.de` / `details.en` (`toValidationIssues` in both locales). The generators (they import zod) are deleted in E1-T11; the JSON and the parity tests stay. | E4, E3 |
| P2 | **Golden format and the wire-issue model.** Each JSON file: `{ "source": "<repo path of the schema file>", "zod": "4.5.4", "cases": [ … ] }`; each case `{ "id": "<SchemaName>#<slug>", "schema": "<exported name>", "input": <JSON>, "ok": <bool>, "output"?: <JSON, iff ok>, "issues"?: [FlatIssue…], "details"?: { "de": [...], "en": [...] } }` (the last two iff not ok). `undefined` anywhere in `input` or `output` is written as the marker object `{"$undefined": true}` (a `JSON.stringify` replacer; the reader turns it back), so "key present with `undefined`" survives. A non-finite number anywhere in `input` is written as `{"$number": "NaN"}`, `{"$number": "Infinity"}` or `{"$number": "-Infinity"}` (JSON has none of them; the same reader turns them back), so `NaN` and `±Infinity` are golden inputs like any other (P4 `Num`; web forms validate in-memory values where `NaN` is reachable). The replacer and the reviver live in `packages/shared/test/support/schema.ts` (`goldenReplacer`, `goldenReviver`, E1-T02); E1-T01's `serialize.ts` writes the same two markers independently (same wave) and is deleted in E1-T11. A **FlatIssue** carries exactly: `code`, `path` (array of string / number), and only these optional fields: `origin` (only for `too_small` / `too_big`), `expected` (only for `invalid_type`), `format` (only for `invalid_format`), `minimum` (only `too_small`), `maximum` (only `too_big`), `params: { i18n }` (only `custom` with a key). Nothing else (no `message`, `pattern`, `values`, `inclusive`, `exact`, `note`, `received`). `details` are `toValidationIssues(error, "de" / "en")` exactly as today: `{ path: <dotted string>, code, message, i18n: { key, values } }`. The resolver ladder (`server.zod.field.<field>.<code>.<bound>` → `…field.<field>.<code>` → `server.zod.<code>.<facet>` → `server.zod.<code>` → `server.zod.fallback`, an explicit `params.i18n` winning) is kept byte for byte; it moves from `resolveZodIssue($ZodIssue)` to `resolveIssue(FlatIssue)`; `facet` is `format` for `invalid_format`, `expected` for `invalid_type`, `origin` when present, else `_`. Catalog keys keep their names (`server.zod.*`, ADR 0012 P9). | E4, ADR 0002 |
| P3 | **The vocabulary carries the wire issue; the adapter never invents one.** `packages/shared/src/core/schemas/checks.ts` (E1-T02) is a small set of Effect schemas and filters that mirror the zod constructs the repo uses, each failure annotated with `WIRE_ISSUE` (the annotation key `"toon/wireIssue"`) holding the FlatIssue fields minus `path`. `flattenIssue(issue: SchemaIssue.Issue): FlatIssue[]` in `packages/shared/src/core/i18n/issues.ts` walks the tree (`Pointer` adds its path, `Composite` / `AnyOf` recurse, `Encoding` unwraps, `Filter` reads `issue.filter.annotations[WIRE_ISSUE]`, leaves read their AST's annotation) and fills in only what zod would: a `MissingKey` becomes the field type's wire issue (looked up through the parent `Objects` AST: `invalid_type` with the type's `expected`, or `invalid_value` for an enum, `invalid_union` for a union); a union whose other members are only `Null` / `Undefined` (`Schema.NullOr`, `Schema.optional`) is transparent (zod's `.nullable()` / `.optional()` are wrappers, not unions); an `AnyOf` with an empty `issues` array reports the union's own wire issue. Fallback for an un-annotated AST, by tag: `String`→`string`, `Number`→`number`, `Boolean`→`boolean`, `Arrays`→`array`, `Objects`→`object`, a record→`record`. Never an Effect message, never `SchemaIssue.defaultFormatter` on the wire. | E4, E12 |
| P4 | **The vocabulary (names binding for every flip).** `checks.ts` exports: `WIRE_ISSUE`; `ALL_ISSUES` (`{ errors: "all" }` as `SchemaAST.ParseOptions`); `wireIssue(meta)` (an `InvalidValue` issue annotated with a wire issue, for filters and transformations that fail on their own); schemas `Str` (z.string), `Num` (z.number: finite; built as `Schema.Number.check(Schema.isFinite(…))` with the finite filter annotated `invalid_type expected "number"`, because plain `Schema.Number` ACCEPTS `NaN` and `±Infinity` where zod refuses them; never `Schema.Number` alone, and `Int`, `CoercedNum`, `CoercedInt` inherit the rule), `Int` (z.number().int(): safe integer, `invalid_type expected "int"` and the ±(2^53−1) `too_big` / `too_small` with `origin "int"`), `Bool`, `UnknownRecord` (z.record(z.string(), z.unknown())), `Enum(values)` (z.enum: `invalid_value`), `Lit(value)` (z.literal: `invalid_value`), `OneOf(members)` (z.union: `invalid_union`), `CoercedNum` / `CoercedInt` (z.coerce.number(): `Number(input)`, then the finite / int rule), `Uuid` (z.uuid()), `Email` (z.email()), `IsoDateTime` (z.iso.datetime({offset: true})), `Url` (z.url()); pipeable transforms `trim` and `lowercase` (z's `.trim()` / `.toLowerCase()`, applied in chain order); filters `minLength(n)` / `maxLength(n)` / `regex(re)` (origin `string`, `regex` is `invalid_format format "regex"`), `min(n)` / `max(n)` / `positive()` / `nonnegative()` (origin `number`), `minItems(n)` / `maxItems(n)` / `itemsExactly(n)` (origin `array`); refinements `keyed(predicate, key, { path }?)` (z's `.refine(pred, refineKey(key))`: a `custom` issue with `params.i18n`) and `keyedIssue(key, path?)` (the `{ path, issue }` a hand-written `Schema.makeFilter` returns, z's `ctx.addIssue`); `partial(struct, keys?)` (z's `.partial()` / `.partial({…})`: optional fields, a field with a decoding default KEEPS its default, as zod 4 does). The regexes and the URL rule are copied from zod 4.5.4's own source in `node_modules/.bun/zod@4.5.4/…` (comment names the file) so accepted inputs stay identical. Everything else is plain Effect: `Schema.Struct`, `Schema.Array`, `Schema.Record`, `Schema.StructWithRest` (z's `.catchall`), `Schema.optional` (z's `.optional()`), `Schema.NullOr` (z's `.nullable()`), `Schema.optional(Schema.NullOr(X))` (z's `.nullish()`), `X.pipe(Schema.withDecodingDefault(Effect.succeed(v)))` (z's `.default(v)`), `{ ...A.fields, … }` (z's `.extend`), `Schema.decodeTo` / `Schema.makeFilter` (z's `.transform` / `.superRefine`). No vocabulary name ends in `Schema` (the golden coverage test, E1-T01, reads `*Schema` exports). | E4, E12 |
| P5 | **Types keep their names and their mutability.** Every exported type stays and is derived from the schema: `export type X = Types.DeepMutable<typeof XSchema.Type>` for a former `z.infer` / `z.output`, `Types.DeepMutable<typeof XSchema.Encoded>` for a former `z.input` (`CreateCardRequest`, `UpdateCardRequest`); `import type { Types } from "effect"`. Zod's outputs are mutable, Effect's are `readonly`; `DeepMutable` keeps apps/api and apps/web compiling without renames or casts. Schema constant names never change. The API and web decode helpers return `Decoded<S>` (P9), which is `Types.DeepMutable<S["Type"]>` for an Effect schema. | E4 |
| P6 | **Decode options.** Every decode whose failures reach `details` or a form uses `ALL_ISSUES` (zod reports every issue; Effect's default is the first). Excess keys stay stripped (Effect's default). No `reportInput` anywhere (it can carry secrets into messages). | E4 |
| P7 | **One known structural divergence, pinned.** Zod runs an object-level refinement after a continuable field issue; Effect runs a struct's checks only on a struct whose fields decoded. So a body that is ALREADY rejected may list fewer trailing `custom` issues than before; `ok` and `details[0]` never change. Each such golden case is listed by id in the parity test's `P7` allow map with the reason; the runner allows, for a listed id only, Effect's issues to equal zod's minus some issues with `code "custom"`, in order, and fails on a listed id that does not diverge (no stale entries). No other divergence is allowed: an output, an `ok`, a first issue or a `details[0]` that differs is a defect to fix in the schema or the vocabulary. **P7 reaches client-side forms too**, because the web `validate` decodes with the same shared schemas: while a field of a struct fails, that struct's own refinements do not run. Example (ADR 0013 names it): in `apps/web/src/modules/recipe/features/cards/components/CardFormDialog.tsx` an invalid `label` hides the card-value error (the card schemas' struct-level `superRefine` on path `["value"]`) until the label is fixed; the user sees the value error on the next submit. Never a wrong acceptance: `ok` is unchanged. ADR 0013 records both the wire and the form behaviour. | E4, E3 |
| P8 | **Transitional dual mode, removed in E1-T11.** Until every shared schema is Effect, the consumers accept both: `toValidationIssues(source: SchemaIssue.Issue \| ZodError, locale)` (shared), `validate` / `decodeOrThrow` / `decodeOption` (`apps/api/src/lib/validate.ts`), `validate` and `parseOrPassThrough` (web). Detection is one `Schema.isSchema(schema)` test; the zod branch keeps today's behaviour except that its failures render through the same adapter (P10). E1-T11 deletes every zod branch; after it no file can import zod (P15). Tests of the dual mode follow P20. | E3 |
| P9 | **The API's one decode path.** `apps/api/src/lib/validate.ts` exports `type Decodable` (`Schema.Decoder<unknown, never>`, an Effect schema without decoding services; `| z.ZodType` until E1-T11) and `type Decoded<S>`, spelled out because a zod 4 `ZodType` has no `Type` member, so `S["Type"]` does not compile for the zod arm: until E1-T11 `type Decoded<S> = S extends Schema.Top ? Types.DeepMutable<S["Type"]> : S extends z.ZodType ? z.output<S> : never` (E1-T06 and E1-T07 pass zod schemas through `readJson<S extends Decodable>(…): Promise<Decoded<S>>` and `validate(…)` and must type exactly as before); E1-T11 collapses both to the Effect arm (`type Decodable = Schema.Decoder<unknown, never>`, `type Decoded<S extends Decodable> = Types.DeepMutable<S["Type"]>`). The web's `Decodable` / `Decoded` in `apps/web/src/lib/validation.ts` (E1-T05) are the same two-arm types; `decodeOrThrow(schema, value)` (`Schema.decodeUnknownSync(schema, ALL_ISSUES)`, which throws `Schema.SchemaError`), `decodeOption(schema, value)` (`Option`, for the call sites that ignore a failure) and `validate(target: "json" \| "query" \| "param", schema)` built on `hono/validator`'s `validator` exactly as `@hono/zod-validator` 0.9.1 is (same body reading: a JSON body is read only with a JSON `Content-Type`, otherwise `{}`; malformed JSON is Hono's `400`; a repeated query key is an array), with typed `c.req.valid(target)`. Failures are mapped ONCE: `toApiError` in `apps/api/src/lib/errors.ts` gains `if (Schema.isSchemaError(error)) return ApiError.validationFailed(toValidationIssues(error.issue, locale))` beside the `ZodError` branch (removed in E1-T11). Status and code stay **422 `validation_failed`** (`docs/API.md` error table; the task text's "400 validation_error" is recorded in section 7 as not the contract). | E4, E6, D8 |
| P10 | **The prose of the 58 validator routes and of `POST …/modules/:moduleId` aligns with the documented contract.** Their `details` items were `{ path, code, message }` with Zod's built-in English message; they become `toValidationIssues` items, like the `readJson` routes already are: same `path`, same `code`, `message` from the server catalog in the negotiated locale, plus `i18n: { key, values }`. That is what `docs/API.md` "Conventions" already promises for every validation issue; no route row, status or code changes. **User-visible consequence (ADR 0013 states it):** `apiFieldErrors` / `fromIssues` in `apps/web/src/lib/validation.ts` prefer `i18n.key`, so a server-side 422 from one of those routes that a form renders (a form whose client-side `validate` passed, or a request without one) now shows the catalog text in the UI language ("Name fehlt") under the same field where it showed Zod's English sentence ("Too small: expected string to have >=1 characters") before. The field it lands on (`path`) is unchanged. This contradicts the milestone task text's "the same onValidationError behaviour" for the message prose only; it follows `docs/API.md` "Conventions" and the EFFECT.md E1 row ("onValidationError wording of ADR 0002"), and section 7 records it. ADR 0013 (`docs/adr/0013-validation-details-from-the-schema-adapter.md`, written by E1-T04) records P7 and P10. | E4, D10, ADR 0002 |
| P11 | **`env.ts` decodes with Effect `Schema` locally until E2.** `apps/api/src/env.ts` gets a pure exported `parseEnv(source)` (returns the env object or the error lines) used by `loadEnv`; `EnvSchema` becomes a `Schema` with the same fields, defaults, coercions, booleanish rule, derived fields and the six cross-field refinements in the same order. Output on failure unchanged in form: the header `Invalid environment variables — check your .env (template: .env.example):` and one `  - <KEY>: <message>` line per issue (`(env)` for a root issue), `console.error`, `process.exit(1)`. The messages the code spells out stay byte-identical (`DATABASE_URL fehlt (z. B. file:./data/local.db)`, `SESSION_SECRET muss mindestens 16 Zeichen haben`, and the six English refinement messages); a generic failure (a missing or mistyped variable) gets the English text of `SchemaIssue.makeFormatterStandardSchemaV1()` (operator console output, not the wire, not pinned by any doc or test; section 7). `lib/oauth.ts`'s three claim schemas become `Schema`s (exported for a test), decoded with `decodeUnknownOption`. E2 replaces `env.ts` with `AppConfig`. | E4, E10, E12 |
| P12 | **Zod-only API uses are neutralised before the flip.** The shopping route's `BoughtListQuerySchema` / `CatalogListQuerySchema` move verbatim (still zod) into `packages/shared/src/modules/recipe/schemas/shopping.ts` as `ShoppingBoughtListQuerySchema` / `ShoppingCatalogListQuerySchema` (E1-T07; golden from E1-T01's inline copies; flipped in E1-T10). `CheckShoppingItemRequestSchema.optional()` (three call sites) drops `.optional()`: Hono's JSON validator never hands `undefined` to the schema (it gives `{}` without a JSON content type and throws 400 on an empty JSON body), so the wrapper is a no-op. `OAuthProviderSchema.options` becomes the new constant `OAUTH_PROVIDERS = ["google", "github"] as const` in `packages/shared/src/core/schemas/user.ts` (`OAuthProviderSchema = z.enum(OAUTH_PROVIDERS)`, E1-T06). | E3 |
| P13 | **Decoupling for the core flip.** The module schema files embed core zod primitives. E1-T08 creates `packages/shared/src/core/schemas/zod-legacy.ts` (verbatim zod copies, without doc comments, of `IdSchema`, `IsoDateSchema`, `HttpUrlSchema`, `listResponse`, `PaginationQuerySchema`, `PublicUserSchema`; exported from NO index) and repoints every module schema file's import of those names to it in the same commit, so the module files compile on zod while the core is Effect. E1-T09 and E1-T10 point them back at the core files; E1-T11 deletes `zod-legacy.ts`. | E3 |
| P14 | **Tests keep their assertions; only the call shape changes.** `packages/shared/test/support/schema.ts` (E1-T02) exports `safeParse(schema, input)` → `{ success: true, data } \| { success: false, error: { issues: FlatIssue[], issue: SchemaIssue.Issue } }`, `parse(schema, input)` (throws the `SchemaError`) and `runGolden(file, schemas, p7Allow)`. Substitutions in a flipped test file: `XSchema.safeParse(v)` → `safeParse(XSchema, v)`, `XSchema.parse(v)` → `parse(XSchema, v)`, `toValidationIssues(result.error)` → `toValidationIssues(result.error.issue)`, `resolveZodIssue` → `resolveIssue`, `$ZodIssue` → `FlatIssue`, an inline zod schema → the same schema built from the vocabulary; `expect` lines are not edited. In apps/api tests `HealthResponseSchema.parse(body)` → `Schema.decodeUnknownSync(HealthResponseSchema)(body)` (assertion `not.toThrow()` unchanged). A test file is rewritten in the same commit as the flip that would break it. | E9, E3 |
| P15 | **Idioms rule (9) "no zod"** (E1-T11): no module specifier `zod`, `zod/*` or `@hono/zod-validator` in any scanned file; no `zod` or `@hono/zod-validator` in any dependency section of the four `package.json`; no `"zod"` or `"@hono/zod-validator"` key in `bun.lock`; empty allow list; the E1 line of `PENDING_RULES` removed in the same commit. | E12, E1 |
| P16 | **Commits.** One or more per task, message `E1-Tnn: …`, body naming the EFFECT.md decision (and P-number) or the file served, ending with the harness's `Co-Authored-By` line (CLAUDE.md "Conventions"; E0 plan "what changed" item 10). `git status --porcelain repos/` empty after every task. No push. Every worktree runs `bun install --frozen-lockfile` first. | CLAUDE.md |
| P17 | **The suite check** (in every task's verify, the E0 P12 rule): `bun test` to a log; the pass count must be ≥ 2463 and 0 fail, or every `(fail)` line must belong to `GET /uploads/<name>.thumb.webp` in `apps/api/test/thumbnails.test.ts` (a sharp timeout under the load of parallel worktrees), the fail count must equal their number, no `Unhandled error` may appear, and the file alone must then pass. (Post-review: the route tests in that file now carry an explicit 60 s budget, `SHARP_TEST_TIMEOUT_MS`, so a loaded host no longer trips bun's 5 s default; a failing gate must also keep its `(fail)` lines, the gates prompt now says so.) Each task reports its measured count; it must exceed 2463 by the tests it added. | E9, §5 gates |
| P18 | **Bundle.** E1-T12 records the gzipped total of `apps/web/dist/assets/*.js` (E0's loop) and its delta to 399812; no gate here, E6 owns the budget. | E11 |
| P19 | **No German changes.** The server and web catalogs are not edited in E1 (`git diff f41fb96f3 -- packages/shared/src/core/i18n/catalogs apps/web/src/lib/i18n` is empty at the end); every doc comment carrying German is kept verbatim where code moves (the counts of section 1.1), so `i18n:check` stays at 146 hits. `zod-legacy.ts` copies carry no comments. | D10, E4 |
| P20 | **Tests written in E1 are zod-free from their first commit, with one delimited exception.** No test file E1 creates or extends imports `zod` or `zod/*`: `packages/shared/test/support/schema.ts`, `schema-checks.test.ts` (its P5 compile-time proof assigns a `DeepMutable` output to a HAND-WRITTEN mutable type literal such as `{ name: string; tags: string[] }`, never `z.infer`), `schema-golden-coverage.test.ts`, `parity/*.parity.test.ts`, `apps/api/test/env-parse.test.ts` (through `parseEnv`), `apps/api/test/oauth-claims.test.ts` (through the exported parse functions of E1-T03, never `Schema.safeParse`), and E1-T05's additions to `apps/web/src/lib/validation.test.ts` (vocabulary-built schemas only; the zod branch of the web `validate` is exercised by the unchanged forms, not by a test). The one exception is `apps/api/test/validate.test.ts` (E1-T04): its zod cases sit in ONE `describe("dual mode: zod schemas (deleted in E1-T11)")` block, the file's only zod import serves only that block, and every zod case has a vocabulary twin in the other `describe` with the same `expect` lines. E1-T11 owns that file and deletes the block and the import; the vocabulary `describe` stays byte-identical. The generators under `packages/shared/test/fixtures/schema-golden/` (`build.ts`, `serialize.ts`, `primitives.build.ts`, `cases/`) are the only other zod importers among the files E1 creates; E1-T11 deletes them. | E3, E9 |
| P21 | **A vocabulary gap found in a flip has an owner.** E1-T08 (core, wave 4, alone) may fix `checks.ts` / `issues.ts` (its step 5). In wave 5 ONLY E1-T10 (core) may edit `packages/shared/src/core/schemas/checks.ts`, `packages/shared/src/core/i18n/issues.ts`, `packages/shared/test/fixtures/schema-golden/primitives.build.ts`, `primitives.json` and `packages/shared/test/schema-checks.test.ts`: a minimal fix, additive where it can be (a new export; a changed existing export only when a new `primitives.json` case proves the old behaviour wrong against zod), `primitives.json` regenerated by its builder, the fix named in the commit body. E1-T09 (build) never edits those files: a finance construct the vocabulary lacks (the likely ones: `BooleanQuerySchema`'s union plus transform, the enum-to-boolean optional transforms, `partial` with defaults) is built inside `packages/shared/src/modules/finance/schemas/common.ts` from plain Effect plus the exported `WIRE_ISSUE` / `wireIssue` (P3 accepts any AST carrying `WIRE_ISSUE`), with the comment `vocabulary gap, plan e1 P21`; the finance parity test is the proof, and E1-T12 lists it in section 10. Because T10 merges after T09, the wave-5 merge runs both parity files on the merged tree; a finance case that T10's fix breaks is the merge's minimal integration fix. A gap neither task can bridge (the adapter mis-flattens a tree shape) is a `blocked` result naming the failing case id; the planner then inserts E1-T10b (core; after T09 and T10; before T11) owning exactly the five files above, and E1-T11 waits for it. | E3, E4 |

The two shell checks the verify lists reuse (P17 and P19):

```
# SUITE (P17), the E0 P12 command with the E1 floor
cd /home/erics/software/toon-household && bash -c 'L=$(mktemp); bun test > "$L" 2>&1; s=$?; tail -6 "$L"; p=$(grep -Eo "^ *[0-9]+ pass" "$L" | tail -1 | grep -Eo "[0-9]+"); n=$(grep -c "^(fail) " "$L"); t=$(grep -cF "(fail) GET /uploads/<name>.thumb.webp > " "$L"); sf=$(grep -Eo "^ *[0-9]+ fail" "$L" | tail -1 | grep -Eo "[0-9]+"); echo "full_exit=$s pass=$p fail_lines=$n thumbnail_fail_lines=$t summary_fail=$sf"; [ "$((p + t))" -ge 2463 ] || exit 1; [ $s -eq 0 ] && exit 0; [ "$n" -gt 0 ] && [ "$n" -eq "$t" ] && [ "$sf" = "$n" ] && ! grep -q "Unhandled error" "$L" && bun test apps/api/test/thumbnails.test.ts'
# I18N (P19): parity OK and exactly the 146 known hits (about 3 minutes)
cd /home/erics/software/toon-household && bash -c 'L=$(mktemp); bun run i18n:check > "$L" 2>&1; grep -q "^\[i18n:check\] OK" "$L" && grep -q "FAILED — 146 possible German literal" "$L"'
```

## 3. Waves and file ownership

| Wave | Tasks (parallel worktrees, merged in id order) |
| --- | --- |
| 1 | E1-T01 golden corpus (build), E1-T02 shared foundation (core), E1-T03 env.ts and oauth.ts (build) |
| 2 | E1-T04 API decode path and ADR 0013 (core; after T02), E1-T05 web validation (build; after T02) |
| 3 | E1-T06 core and finance routes (rewrite; after T04), E1-T07 recipe routes (rewrite; after T04) |
| 4 | E1-T08 core flip and decoupling (core; after T01, T02, T04, T05, T06, T07) |
| 5 | E1-T09 finance flip (build; after T08), E1-T10 recipe flip (core; after T08) |
| 6 | E1-T11 zod removal and the idioms rule (build; after T01–T10) |
| 7 | E1-T12 integration, docs and record (build; after all) |

Ownership is the `files` list of each task (section 3.1); no two tasks of one wave share a file. Shared files:
`bun.lock` and the three `package.json` are edited only by E1-T11; `apps/api/test/effect-idioms.test.ts` only
by E1-T11; `apps/api/src/lib/errors.ts`, `apps/api/src/lib/validate.ts` and `apps/api/test/validate.test.ts` by
E1-T04 and E1-T11; `packages/shared/src/core/i18n/index.ts` by E1-T02 and E1-T11; `checks.ts`, `issues.ts`,
`primitives.build.ts`, `primitives.json` and `schema-checks.test.ts` by E1-T02, then only for a gap by E1-T08
(wave 4) or E1-T10 (wave 5, P21), then E1-T11 (`issues.ts`; the builder deleted); `apps/web/src/lib/validation.ts`
and `importApi.ts` by E1-T05 and E1-T11; `agent-patterns/effect-schema.md` by E1-T02 (corrections) and E1-T12
(as built); CLAUDE.md only by E1-T12. Implementers read this plan at
`/home/erics/software/toon-household/docs/plans/e1-shared-schema.md` (sections 1, 2 and their task).

### 3.1 Files, dependencies and verify per task

Verify shorthands: TC = `cd /home/erics/software/toon-household && bun run typecheck`; SUITE and I18N = the two
commands of section 2; REPOS = `cd /home/erics/software/toon-household && git status --porcelain repos/ | wc -l |
grep -qx 0`; `bun test X` means `cd /home/erics/software/toon-household && bun test X`. In a worktree the same
commands run from the worktree root.

| Task | Tier | Deps | Files owned | Verify (all exit 0) |
| --- | --- | --- | --- | --- |
| E1-T01 | build | — | `packages/shared/test/fixtures/schema-golden/{serialize.ts,build.ts}`, `…/cases/` (18 files), the 18 JSON files of P1, `packages/shared/test/schema-golden-coverage.test.ts` | `bun packages/shared/test/fixtures/schema-golden/build.ts --check`; `bun test packages/shared/test/schema-golden-coverage.test.ts`; TC; SUITE; REPOS |
| E1-T02 | core | — | `packages/shared/src/core/schemas/checks.ts`, `packages/shared/src/core/i18n/{issues.ts,zod.ts,index.ts}`, `packages/shared/src/core/index.ts`, `packages/shared/test/cards.test.ts` (import line), `packages/shared/test/support/schema.ts`, `packages/shared/test/fixtures/schema-golden/{primitives.build.ts,primitives.json}`, `packages/shared/test/schema-checks.test.ts`, `agent-patterns/effect-schema.md` | `bun test packages/shared/test/schema-checks.test.ts packages/shared/test/i18n.test.ts packages/shared/test/finance-i18n.test.ts packages/shared/test/cards.test.ts`; `! grep -n 'from "zod' packages/shared/test/schema-checks.test.ts packages/shared/test/support/schema.ts`; TC; SUITE; I18N; REPOS |
| E1-T03 | build | — | `apps/api/src/env.ts`, `apps/api/src/lib/oauth.ts`, `apps/api/test/env-parse.test.ts`, `apps/api/test/oauth-claims.test.ts` | `bun test apps/api/test/env-parse.test.ts apps/api/test/oauth-claims.test.ts apps/api/test/security.test.ts`; `! grep -n 'from "zod' apps/api/src/env.ts apps/api/src/lib/oauth.ts apps/api/test/env-parse.test.ts apps/api/test/oauth-claims.test.ts`; TC; SUITE; I18N; REPOS |
| E1-T04 | core | E1-T02 | `apps/api/src/lib/validate.ts`, `apps/api/src/lib/errors.ts`, `apps/api/test/validate.test.ts`, `docs/adr/0013-validation-details-from-the-schema-adapter.md`, `agent-patterns/effect-errors.md` | `bun test apps/api/test/validate.test.ts apps/api/test/security.test.ts apps/api/test/cards.test.ts`; `test $(grep -c 'from "zod"' apps/api/test/validate.test.ts) -le 1`; TC; SUITE; I18N; REPOS |
| E1-T05 | build | E1-T02 | `apps/web/src/lib/validation.ts`, `apps/web/src/lib/validation.test.ts`, `apps/web/src/modules/recipe/features/import/lib/importApi.ts`, `apps/web/src/modules/finance/features/overview/components/{MonthSummaryCard,SpendByCategoryCard}.tsx` | `bun test apps/web/src/lib/validation.test.ts`; `! grep -n 'from "zod' apps/web/src/lib/validation.test.ts apps/web/src/modules/finance/features/overview/components/MonthSummaryCard.tsx apps/web/src/modules/finance/features/overview/components/SpendByCategoryCard.tsx`; TC; SUITE; I18N; REPOS |
| E1-T06 | rewrite | E1-T04 | the 14 files of tables A and B | `! grep -n 'zValidator\|onValidationError\|from "zod"\|\.safeParse(\|\.options\b' apps/api/src/core/routes/{households,invites,members,modules,auth}.ts apps/api/src/modules/finance/routes/{balance,categories,participants,plan,settlements,tags,transactions}.ts apps/api/src/modules/finance/setup.ts`; `bun test apps/api/test`; TC; SUITE; I18N; REPOS |
| E1-T07 | rewrite | E1-T04 | the 7 files of its table | `! grep -n 'zValidator\|onValidationError\|from "zod"\|\.safeParse(' apps/api/src/modules/recipe/routes/{plan,recipes,shopping,cards,imports}.ts apps/api/src/modules/recipe/services/import/drafts.ts`; `bun test apps/api/test`; TC; SUITE; I18N; REPOS |
| E1-T08 | core | E1-T01, E1-T02, E1-T04, E1-T05, E1-T06, E1-T07 | `packages/shared/src/core/schemas/{common,user,household,auth,zod-legacy}.ts`, `packages/shared/src/modules/registry.ts`, `packages/shared/src/index.ts`, `packages/shared/src/modules/recipe/schemas/{card,import,plan,recipe,shopping}.ts` and `packages/shared/src/modules/finance/schemas/{balance,categories,participants,plan,settlements,tags,transactions}.ts` (import lines only), `packages/shared/test/{core,household,finance-schemas}.test.ts`, `packages/shared/test/parity/core.parity.test.ts`, `apps/api/test/{smoke,runtime}.test.ts`, `apps/web/src/core/features/households/components/InvitePanel.tsx`; for a gap only (step 5) `checks.ts`, `issues.ts`, `primitives.build.ts`, `primitives.json`, `schema-checks.test.ts` | `bun test packages/shared/test apps/api/test/smoke.test.ts apps/api/test/runtime.test.ts`; `! grep -n 'from "zod' packages/shared/src/core/schemas/{common,user,household,auth}.ts packages/shared/src/modules/registry.ts apps/web/src/core/features/households/components/InvitePanel.tsx`; TC; SUITE; I18N; REPOS |
| E1-T09 | build | E1-T08 | `packages/shared/src/modules/finance/schemas/{balance,categories,common,participants,plan,settlements,tags,transactions}.ts`, `packages/shared/test/{finance-schemas,finance-i18n}.test.ts`, `packages/shared/test/parity/finance.parity.test.ts` | `bun test packages/shared/test/parity/finance.parity.test.ts packages/shared/test/finance-schemas.test.ts packages/shared/test/finance-i18n.test.ts apps/api/test`; `! grep -rn 'from "zod\|zod-legacy' packages/shared/src/modules/finance packages/shared/test/finance-schemas.test.ts packages/shared/test/finance-i18n.test.ts`; TC; SUITE; I18N; REPOS |
| E1-T10 | core | E1-T08 | `packages/shared/src/modules/recipe/schemas/{card,import,plan,recipe,shopping}.ts`, `packages/shared/test/{recipe-schemas,cards,ingredients}.test.ts`, `packages/shared/test/parity/recipe.parity.test.ts`; for a gap only (P21) `checks.ts`, `issues.ts`, `primitives.build.ts`, `primitives.json`, `schema-checks.test.ts` | `bun test packages/shared/test/parity/recipe.parity.test.ts packages/shared/test/recipe-schemas.test.ts packages/shared/test/cards.test.ts packages/shared/test/ingredients.test.ts packages/shared/test/schema-checks.test.ts apps/api/test`; `! grep -rn 'from "zod\|zod-legacy' packages/shared/src/modules/recipe packages/shared/test/recipe-schemas.test.ts packages/shared/test/cards.test.ts packages/shared/test/ingredients.test.ts`; TC; SUITE; I18N; REPOS |
| E1-T11 | build | E1-T01 … E1-T10 | `packages/shared/src/core/i18n/{issues.ts,zod.ts (deleted),index.ts}`, `packages/shared/src/core/schemas/zod-legacy.ts` (deleted), `apps/api/src/lib/{validate,errors}.ts`, `apps/api/src/core/services/households/validation.ts`, `apps/web/src/lib/validation.ts`, `apps/web/src/modules/recipe/features/import/lib/importApi.ts`, `packages/shared/test/fixtures/schema-golden/{build.ts,serialize.ts,primitives.build.ts,cases/}` (deleted), `packages/shared/test/support/schema.ts`, `packages/shared/test/i18n.test.ts`, `apps/api/test/validate.test.ts`, `packages/shared/package.json`, `apps/api/package.json`, `apps/web/package.json`, `bun.lock`, `apps/api/test/effect-idioms.test.ts` | `bun install --frozen-lockfile`; `test $(grep -c 'zod' bun.lock) -eq 0`; `bash -c 'c=$(git log --format=%H -1 --grep="E1-T11: zod and @hono/zod-validator removed from the dependencies"); test -n "$c" && git show --numstat --format= "$c" -- bun.lock \| grep -qxP "0\t6\tbun.lock"'` (the dependency commit of step 4 removes six lockfile lines and adds none); `! grep -rn --include='*.ts' --include='*.tsx' --exclude-dir=node_modules 'from "zod' apps packages scripts`; `bun test apps/api/test/effect-idioms.test.ts apps/api/test/validate.test.ts packages/shared/test`; TC; SUITE; I18N; REPOS |
| E1-T12 | build | all | `CLAUDE.md`, `docs/API.md`, `docs/modules/recipe.md`, `agent-patterns/effect-schema.md`, `docs/plans/e1-shared-schema.md` | `bun install --frozen-lockfile`; TC; SUITE; `bun run build`; I18N; `bun test apps/api/test/effect-idioms.test.ts apps/api/test/docs-paths.test.ts apps/api/test/api-doc.test.ts`; `! grep -rn --include='*.ts' --include='*.tsx' --exclude-dir=node_modules 'from "zod' apps packages scripts`; `test -z "$(git diff f41fb96f3 --stat -- packages/shared/src/core/i18n/catalogs apps/web/src/lib/i18n)"`; REPOS |

## 4. Tasks

Reading every task needs (in addition to its own list): `docs/EFFECT.md` §1 E3, E4, E12 and §2; this plan's
sections 1 and 2; `repos/effect/LLMS.md` (whole, once per session); `agent-patterns/effect-schema.md`;
CLAUDE.md "Conventions" and "Gotchas in use" (the "Long commands" and "i18n-check" items).

### E1-T01 — The golden corpus from Zod (build)

Read: P1, P2, P12, P19; every schema file of section 1.1 (`packages/shared/src/core/schemas/*.ts`,
`packages/shared/src/modules/registry.ts`, `packages/shared/src/modules/{finance,recipe}/schemas/*.ts`); the two
local schemas at `apps/api/src/modules/recipe/routes/shopping.ts` lines 95–108; the current resolver
`packages/shared/src/core/i18n/zod.ts`; the existing tests `packages/shared/test/{core,household,cards,
recipe-schemas,finance-schemas}.test.ts` (their inputs are good seeds). `docs/modules/recipe.md` §4a and
`docs/modules/finance.md` §4a (rules a schema expresses: R27 `HttpUrlSchema`, R30/R31 cards, F48 no refinement for
dedicated codes, period bounds).

Build, all under `packages/shared/test/fixtures/schema-golden/`:
1. `serialize.ts`: the `$undefined` and `$number` replacer and reviver (P2), and `flatIssue(zodIssue)` picking
   exactly the P2 fields. (E1-T02 writes the same markers into `support/schema.ts` in parallel; the format is P2's,
   not either file's.)
2. `cases/<area>.<file>.ts` (18 files, matching the JSON names of P1): plain data, `export const cases:
   Array<{ id: string; schema: string; input: unknown }>`; helpers that generate boundary cases are fine. The
   two route-local schemas are declared in `cases/recipe.shopping.ts` (the only case file that imports zod) as
   SELF-CONTAINED zod with the same rules as the shopping route's lines 95–108: `limit` / `offset` written out
   as in `PaginationQuerySchema` and `listId` as `z.uuid().optional()`, never importing a shared schema (the
   core flip would otherwise break this file's typecheck).
3. `build.ts`: looks every schema up BY NAME on `import * as shared from "../../../src/index.ts"` typed as
   `Record<string, unknown>` and casts it to `z.ZodType` at that one place (no static use of a shared schema's
   zod API, so the file keeps type-checking after the flips until E1-T11 deletes it), plus the inline
   route-local ones; runs `safeParse` for every case; writes the 18 JSON files (stable key order, 2-space
   indent, trailing newline, `details` via the CURRENT `toValidationIssues(error, "de")` / `"en"`). `bun
   …/build.ts --check` regenerates in memory and exits 1 with the first differing case if a committed file
   differs (meaningful only before E1-T08; nobody runs it later).
4. Coverage, per the minimum below, then `packages/shared/test/schema-golden-coverage.test.ts` (zod-free: reads
   the JSON and `import * as shared from "../src/index.ts"`): every export whose name ends in `Schema` and whose
   value is an object appears as `schema` in some case; every request / query / settings schema (name contains
   `Request`, `Query`, `Settings`, `Assignment`) and every field-level leaf schema (`IdSchema`, `IsoDateSchema`,
   `HttpUrlSchema`, `PasswordSchema`, `EmailSchema`, `DisplayNameSchema`, `HouseholdNameSchema`,
   `OpaqueTokenSchema`, `PeriodSchema`, `CentsSchema`, `PositiveCentsSchema`, `BooleanQuerySchema`,
   `MemberSlotSchema`, `PlanDateSchema`, `MutationIdSchema`, `TagNameSchema`, `CategoryLabelSchema`,
   `TransactionDescriptionSchema`, `FinanceDisplayNameSchema`, `ConfidenceSchema`, `ServingsSchema` and every
   enum) has at least one `ok: true` and one `ok: false` case; case ids are unique; every JSON file names its
   `source` and that file exists. One `test` per assertion group, not per case.

Minimum coverage per request / query / leaf schema: per field and per rule the accepted boundary and the
rejected value just past it (min, max, length); wrong type (number for string, string for number, `null` for
non-null, an array, an object); missing required key; `undefined` and absent for optional / nullish / defaulted
fields; `null` for nullish / nullable; trimming (`"  x  "`, whitespace only) and lower-casing; coercion strings
for every coerced query field (`""`, `"abc"`, `"1.5"`, `"-1"`, `"0"`, `"24"`, `" 12 "`, `"1e2"`, `"Infinity"`,
`["1","2"]`); every enum value, one wrong value and one case variant; formats (3 valid, 5 invalid incl. edge
cases: uuid version / variant digits, nil uuid, uppercase; datetime with `Z`, with offset, without offset,
date only, Feb 29; email with spaces and capitals, `a@b`, `a..b@c.de`; url `ftp://x`, `mailto:a@b.de`,
`javascript:alert(1)`, `http://`, `not a url`); each keyed refinement passing and failing (`noChanges`,
`httpUrlOnly`, `noControlChars`, `periodFormat`, `periodBounds`, `amountPositive`, `plan.invalidDate`,
`plan.rangeInvalid`, `plan.rangeTooLong`, every `server.card.*`); defaults applied; at least two inputs with
two or more failing fields (one of them also failing an object-level refinement, the P7 shape); one extra unknown
key (stripped); non-object roots (`null`, `"x"`, `[]`, `1`); `NaN`, `Infinity` and `-Infinity` (the `$number`
marker) for every number field and every number leaf schema (`CentsSchema`, `PositiveCentsSchema`,
`ConfidenceSchema`, `ServingsSchema`, `MemberSlotSchema`, every `z.number()` field of a request or entity). Response and entity schemas: one full valid
fixture, one minimal (optional and nullish absent), one with every nullable `null`, one invalid nested value.
Expect well over 1000 cases.

Commit: `E1-T01: golden corpus of every shared schema, generated from zod 4.5.4` (body: "docs/EFFECT.md E4; plan
e1 P1, P2").

### E1-T02 — Shared foundation: the vocabulary, the issue adapter, the test support (core)

Read first: `repos/effect/LLMS.md` "Defining schemas" and "Runtime type guards"; `agent-patterns/effect-schema.md`
(whole), `agent-patterns/effect-core.md` §2 and §4, `agent-patterns/effect-testing.md` §1 and §6;
`repos/effect/packages/effect/SCHEMA.md` sections "Strings", "String formats", "Numbers", "Integers", "Structs"
(Optional Fields, Decoding Defaults, Index Signatures, Deriving Structs), "Unions", "Union of Literals", "Filter
error messages and schema identifiers", "Filter return shapes", "Multiple Issues Reporting", "Aborting
Validation", "Filter Groups", "Structural Filters", "Transforming One Schema into Another", "Formatters" (read in
chunks); `repos/effect/migration/schema.md`; the source: `repos/effect/packages/effect/src/SchemaIssue.ts` (the
`Issue` union, `Filter`, `Pointer`, `MissingKey`, `InvalidType`, `InvalidValue`, `AnyOf`, `Composite`, the
`toDefaultIssues` walk), `src/Schema.ts` (`makeFilter` ~6775, `isSchema` ~2337, `isSchemaError` ~1258,
`decodeUnknownResult` ~1725, `decodeUnknownSync` ~1872, `withDecodingDefault` ~6116, `optional` ~2460, `NullOr`,
`Literals`, `Union`, `StructWithRest` ~4233, `Record`), `src/SchemaAST.ts` (`collectIssues` ~5050, `Filter`
annotations and `abort`), `src/internal/schema/interpreter.ts` (when checks run), `src/SchemaTransformation.ts`
(`trim`, `toLowerCase`, `transform`), `src/Types.ts` (`DeepMutable`); zod's own source for the regexes and the
URL rule (`node_modules/.bun/zod@4.5.4/node_modules/zod/v4/core/regexes.js` and `schemas.js`). Repo:
`packages/shared/src/core/i18n/zod.ts`, `packages/shared/src/core/i18n/index.ts`,
`packages/shared/src/core/index.ts`, `packages/shared/test/i18n.test.ts`, `packages/shared/test/finance-i18n.test.ts`.
Decisions P2–P8, P14.

Build:
1. `packages/shared/src/core/schemas/checks.ts`: the vocabulary of P4, each schema / filter documented with the
   zod construct it mirrors and the wire issue it produces.
2. `packages/shared/src/core/i18n/issues.ts`: `FlatIssue` (P2), `flattenIssue` (P3), `resolveIssue(issue,
   locale)` (the body of `resolveZodIssue`, unchanged ladder), `toValidationIssues(source: SchemaIssue.Issue |
   ZodError, locale)` (dual until E1-T11: a ZodError's issues go through the same P2 field selection, then
   `resolveIssue`). Move `toValidationIssues` out of `zod.ts`; `zod.ts` keeps `refineKey` and
   `resolveZodIssue` (now `resolveIssue` applied to the selected fields) until E1-T11. Export the new modules
   from `core/i18n/index.ts` and `core/index.ts` without a duplicate export.
3. `packages/shared/test/cards.test.ts`: only its import line `import { toValidationIssues } from
   "../src/core/i18n/zod.ts";` becomes `"../src/core/i18n/issues.ts"` (no other line).
4. `packages/shared/test/support/schema.ts`: `safeParse`, `parse`, `runGolden(file, schemas, p7Allow)` (P1, P7,
   P14; one `test` per case, named by the case id), and `goldenReplacer` / `goldenReviver` for both P2 markers
   (`$undefined`, `$number`); `runGolden` reads JSON with `goldenReviver`. No zod import (P20).
5. `packages/shared/test/fixtures/schema-golden/primitives.build.ts` and `primitives.json`: the P2 format for
   every zod construct the repo uses, labelled by its source text (`"z.string().trim().min(1).max(80)"`,
   `"z.coerce.number().int().min(1).max(100).default(24)"`, `"z.uuid()"`, `"z.email()"` behind
   `z.string().max(254).trim().toLowerCase().pipe(…)`, `"z.iso.datetime({ offset: true })"`, `"z.url().max(2000)"`,
   `"z.number().int()"`, `"z.number().positive()"`, `"z.number().nonnegative()"`, `"z.enum([…])"`,
   `"z.literal(true)"`, `"z.union([z.literal(1), z.literal(2)])"`, `"z.union([z.boolean(), z.string()]).transform(…)"`,
   `"z.array(…).min/max/length/default([])"`, `"z.record(z.string(), z.unknown())"`,
   `"z.record(z.string(), z.union([z.string(), z.number()]))"`, `"z.object({…}).catchall(z.boolean())"`,
   `.optional()` / `.nullable()` / `.nullish()` / `.default()` on a field, an object `.refine` with `path`, a
   `.superRefine` adding a keyed issue at a path, `.extend`, `.partial()` keeping a default,
   `.partial({ a: true })`, chained `.refine().refine()`, and the P7 shapes) with the section 1.1 inputs and
   more, including `NaN`, `Infinity` and `-Infinity` (written with `goldenReplacer`'s `$number` marker) for
   `z.number()`, `z.number().int()`, `.positive()`, `.nonnegative()` and both coerced numbers (plus the strings
   `"NaN"`, `"Infinity"`, `"-Infinity"` for the coerced ones). `packages/shared/test/schema-checks.test.ts` maps each label to the vocabulary equivalent and runs
   `runGolden` on it; P7 cases go into its allow map. It also proves P5 with compile-time assignments (a
   `DeepMutable` output assigned to a hand-written mutable type literal standing for the zod-era shape, e.g.
   `const out: { name: string; tags: string[] } = decoded`; never `z.infer`: the file imports no zod, P20), that
   no vocabulary export name ends in `Schema`, and, by hand-written assertions independent of the golden, that
   `Num`, `Int`, `CoercedNum` and `CoercedInt` refuse `NaN`, `Infinity` and `-Infinity` with exactly one
   FlatIssue `{ code: "invalid_type", expected: "number", path: [] }` (the zod fact of section 1.1) and that
   `Schema.Number` alone would have accepted them (the reason `Num` exists).
6. `agent-patterns/effect-schema.md`: correct any line this work proves wrong (same commit), nothing else.

Do NOT edit any schema file under `core/schemas/` other than creating `checks.ts`, nor any module file.
Commit: `E1-T02: shared Schema vocabulary, SchemaIssue adapter and test support` (body: "docs/EFFECT.md E4, E12;
plan e1 P2–P8, P14").

### E1-T03 — `env.ts` and `lib/oauth.ts` without zod (build)

Read: P11; `agent-patterns/effect-schema.md` §2–§4; `repos/effect/packages/effect/SCHEMA.md` "Structs" (Optional
Fields, Decoding Defaults), "Transforming One Schema into Another", "Formatters"; `repos/effect/packages/effect/src/SchemaIssue.ts`
`makeFormatterStandardSchemaV1` (~1303); `apps/api/src/env.ts` (whole), `apps/api/src/lib/oauth.ts` lines
85–240, `.env.example`, `apps/api/test/security.test.ts` "env.ts in production" (~351–375, the subprocess test
that must keep passing), CLAUDE.md gotchas "Migrations are generated" (db:migrate supplies a placeholder
secret), "The CLI never imports `src/env.ts`", "Core hardening from `1715207`" (the `change-me` refusal),
"Retired gotchas" (the test temp-DB rule in `rawEnv`).

Build:
1. First commit (still zod): extract `export function parseEnv(source: Record<string, string | undefined>):
   { ok: true; env: Env } | { ok: false; lines: string[] }` and make `loadEnv` use it (same output, same
   `process.exit(1)`); add `apps/api/test/env-parse.test.ts`, table-driven over `parseEnv`: every default
   (`NODE_ENV`, `API_PORT`, `DEFAULT_LOCALE`, `WEB_ORIGIN`, `OAUTH_REDIRECT_BASE`, `UPLOAD_DIR`,
   `IMPORT_OCR_CONCURRENCY`, `TESSERACT_LANGS`, `TESSERACT_BIN`, `PDFTOPPM_BIN`), the coercions (`API_PORT` `"8080"`,
   `"0"`, `"65536"`, `"abc"`, `"1.5"`; `MAIL_PORT`; `IMPORT_OCR_CONCURRENCY` `"9"`), the booleanish rule
   (`"1"`, `"true"`, `"TRUE"`, `"0"`, `"yes"`, unset) for every booleanish variable, the enums (`NODE_ENV`,
   `MAIL_TRANSPORT`, `MAIL_SECURITY`, `DEFAULT_LOCALE`), every derived field (`webOrigins` splitting and
   trimming, `databaseKind`, `databaseUrl` resolution, `uploadDir`, the OAuth `…Configured` flags, `trustProxy`,
   `allowPrivateImportHosts` never in production, `pdfImportEnabled` following the OCR flag,
   `mailTransport` forced to console under test, `mailFrom`, `mailSecurity`, `mailPort` defaults, `webDistDir`,
   `defaultLocale`), the two German min messages and each of the six refinements with its exact message and the
   order of lines; the keys of a failing env (`  - KEY: …`) and `(env)` for a root issue. Assert line texts
   only where the code spells them out (P11).
2. Second commit: `EnvSchema` on `Schema` (vocabulary-free is fine: this file is apps/api's, P4 does not apply;
   use `Schema.Struct`, `Schema.Literals`, `Schema.optional`, `withDecodingDefault`, a `decodeTo` for the derived
   fields, `.check(Schema.makeFilter(…, { message }))` for the refinements), `parseEnv` decoding with
   `decodeUnknownExit(…, { errors: "all" })` and the formatter of P11; `export type Env` keeps its exact shape
   (`env.trustProxy` is still assignable, `security.test.ts` mutates it); `import { z } from "zod"` removed.
   The same test file passes unchanged.
3. `lib/oauth.ts`, in the FIRST commit (still zod): extract three exported functions
   `parseGoogleClaims(raw: unknown)`, `parseGitHubUser(raw: unknown)`, `parseGitHubEmails(raw: unknown)`, each
   returning the parsed value or `undefined`, used by `googleProfile` / `githubProfile` in place of the three
   `.safeParse` calls (same `ApiError`s and keys); add `apps/api/test/oauth-claims.test.ts` over those three
   functions only (zod-free, P20): accepted and refused payloads per function (missing `sub`, `id` as number and
   string, nullish fields, `email_verified` as `"true"` / `true`, an emails array with a non-boolean `primary`).
   In the SECOND commit `GoogleClaimsSchema`, `GitHubUserSchema`, `GitHubEmailsSchema` become `Schema`s
   (`Schema.Union([Schema.Boolean, Schema.String])` etc.) decoded inside the three functions with
   `Schema.decodeUnknownOption` (`Option.getOrUndefined`); `import { z } from "zod"` removed; the test file
   passes unchanged.

Commit messages `E1-T03: env.ts parse function and tests` / `E1-T03: env.ts and oauth claims on Schema`
(body: "docs/EFFECT.md E4, E12; plan e1 P11").

### E1-T04 — The API decode path and ADR 0013 (core)

Read first: `repos/effect/LLMS.md` "Error handling", "Runtime type guards"; `agent-patterns/effect-errors.md` §4
and §7, `agent-patterns/effect-schema.md` §3 and §4; `repos/effect/packages/effect/src/Schema.ts`
(`decodeUnknownSync`, `decodeUnknownOption`, `isSchemaError`, `SchemaError`, `isSchema`, the `Top` (~765) and
`Decoder` (~1094) interfaces for `Decodable` / `Decoded`); zod's `z.output` / `z.ZodType` types for the zod arm
(`node_modules/.bun/zod@4.5.4/node_modules/zod/v4/classic/schemas.d.ts`); Hono's validator
(`node_modules/.bun/hono@4.13.7/node_modules/hono/dist/validator/validator.js` and its `.d.ts`), and
`@hono/zod-validator` 0.9.1 (`node_modules/.bun/@hono+zod-validator@0.9.1+*/node_modules/@hono/zod-validator/dist/index.mjs`
and `index.d.mts`, for the typed `c.req.valid`); repo: `apps/api/src/lib/errors.ts`,
`apps/api/src/core/services/households/validation.ts`, `apps/api/src/lib/locale.ts`, one route of each kind
(`apps/api/src/core/routes/invites.ts`, `apps/api/src/modules/recipe/routes/cards.ts`); `docs/API.md`
"Conventions" and the error table row `validation_failed`; `docs/adr/0002-…`, `docs/adr/0012-…` (format);
CLAUDE.md gotchas "Middleware chain order is load-bearing" (nothing here changes the order), "API import cycle"
(no module-scope call into a core middleware; `validate()` is called at route definition, which is fine because
it imports only `hono/validator`, `effect` and `@toon/shared`). Decisions P5, P6, P8, P9, P10, P7.

Build:
1. `apps/api/src/lib/validate.ts` per P9 (dual per P8), each export documented, with exactly the two-arm types
   of P9: `export type Decodable = Schema.Decoder<unknown, never> | z.ZodType;` and `export type Decoded<S> = S
   extends Schema.Top ? Types.DeepMutable<S["Type"]> : S extends z.ZodType ? z.output<S> : never;` (the zod
   import is `import type { z } from "zod"`).
2. `apps/api/src/lib/errors.ts`: the `Schema.isSchemaError` branch of P9 in `toApiError` (beside the zod branch,
   which stays until E1-T11). Nothing else changes in the file.
3. `apps/api/test/validate.test.ts` (P20 layout): a bare `new Hono()` with `onError(onErrorHandler)` and routes
   using `validate("json" | "query" | "param", …)`. TWO top-level `describe` blocks with the same cases and the
   same `expect` lines: `describe("validate with shared schemas")` over schemas built from the vocabulary (the
   same field names as real ones: `name` min 1, `email`, `limit` coerced 1..100 default 24), and
   `describe("dual mode: zod schemas (deleted in E1-T11)")` over the equivalent zod schemas, the file's only
   `import { z } from "zod"` serving only that block (E1-T11 deletes the block and the import and nothing else).
   In both, `422`, `code: "validation_failed"`, `details` equal item for item to `toValidationIssues` in the
   negotiated locale (`Accept-Language: en` and `de`), `i18n.key` present; a valid body reaches the handler
   decoded (trimmed, lower-cased, defaulted) through `c.req.valid`; a JSON route without a JSON
   `Content-Type` validates `{}`; malformed JSON is `400 bad_request`; `?limit=1&limit=2` is refused;
   `decodeOrThrow` behind `onErrorHandler` gives the same envelope; `decodeOption` returns `Option.none()` on a
   failure and never throws. Compile-time checks, one per block: `c.req.valid("json")` and
   `Decoded<typeof X>` have the decoded, mutable type for the vocabulary schema, and `Decoded<typeof Z>` is
   `z.output<typeof Z>` for the zod schema (the zod arm; that check lives inside the zod block).
4. `docs/adr/0013-validation-details-from-the-schema-adapter.md` (format of ADR 0012: `# 0013: …`, `Date:
   2026-10-16`, Context, Decision, Consequences): P10 (every validation issue of every route is rendered by the
   one adapter: same `path` and `code`, catalog `message` in the negotiated locale, `i18n` added where Zod's
   English defaults were sent; matches `docs/API.md` "Conventions"; no row changes), P7 (fewer trailing
   object-level issues on an already rejected body), P9 (422 `validation_failed` stays). Consequences name the web
   explicitly: (i) `apiFieldErrors` / `fromIssues` prefer `i18n.key`, so a server-side 422 on a former
   zValidator route now shows catalog text in the UI language under the same field where Zod's English sentence
   appeared; (ii) P7 reaches client-side forms through the shared schemas: in `CardFormDialog` an invalid label
   hides the card-value error (struct-level `superRefine` on `["value"]`) until the label is fixed; `ok` never
   changes. No SPEC text changes (D10's sentence stays true); say so.
5. `agent-patterns/effect-errors.md`: correct a line this work proves wrong, if any (same commit).

Do not touch any route file. Commit: `E1-T04: lib/validate.ts, SchemaError at the error boundary, ADR 0013`
(body: "docs/EFFECT.md E4, E6; plan e1 P8–P10").

### E1-T05 — Web validation on the shared adapter (build)

Read: P3, P5, P6, P8; `agent-patterns/effect-schema.md` §3, §4; `repos/effect/packages/effect/src/Schema.ts`
(`decodeUnknownResult`, `isSchema`), `src/Result.ts` (`isFailure`, `isSuccess`); repo: `apps/web/src/lib/validation.ts`,
`apps/web/src/lib/validation.test.ts`, `apps/web/src/modules/recipe/features/import/lib/importApi.ts` (lines
295–400: `parseOrPassThrough`, `requestJson`, `uploadFile`), the two finance overview cards, the 16 form call
sites of `validate(` (section 1.1); `docs/modules/recipe.md` 4b R66 (`apiFieldErrors` on `null`); CLAUDE.md "Web
shell" gotchas (no new module-level constants over `WEB_MODULES`; nothing here touches them).

Build:
1. `apps/web/src/lib/validation.ts`: `validate<S extends Decodable>(schema, value): ValidationResult<Decoded<S>>`
   with the two-arm types of P9 declared here (`Decodable = Schema.Decoder<unknown, never> | z.ZodType`,
   `Decoded<S> = S extends Schema.Top ? Types.DeepMutable<S["Type"]> : S extends z.ZodType ? z.output<S> : never`)
   (dual, P8; Effect branch `Schema.decodeUnknownResult(schema, ALL_ISSUES)`, then `flattenIssue` and the first
   `resolveIssue(…, getLocale()).message` per dotted path, `_form` for the root; zod branch as today through
   the same field selection); `zodFieldErrors` becomes `issueFieldErrors(issues: readonly FlatIssue[])`;
   export `Decodable`, `Decoded` for `importApi.ts`; `apiFieldErrors` and `fromIssues` unchanged. Keep the doc
   comment of line 12 verbatim (an i18n:check hit, P19).
2. `apps/web/src/lib/validation.test.ts`: keep every existing test; add `validate` cases with vocabulary-built
   schemas only (no zod import, P20; E1-T11 does not touch this file) named like the real fields: `{ email: "x" }` → `{ email: "Bitte eine gültige E-Mail-Adresse angeben" }`
   in `de`; `{ name: "" }` → `{ name: "Name fehlt" }`; `{ password: "kurz" }` → `"Passwort muss mindestens 8
   Zeichen haben"`; a keyed refinement on the root → `_form`; first message per field; success returns the
   decoded value (trimmed, lower-cased).
3. `importApi.ts`: `parseOrPassThrough`, `requestJson`, `uploadFile` take `S extends Decodable` and return
   `Decoded<S>`; the Effect branch uses `Schema.decodeUnknownResult(schema)` (dev-only warning unchanged, the
   payload passed through on a mismatch).
4. `MonthSummaryCard.tsx`: `type MonthSpend = TransactionSummaryResponse["byMonth"][number];`;
   `SpendByCategoryCard.tsx`: `type CategorySpend = TransactionSummaryResponse["byCategory"][number];` (import
   the type from `@toon/shared`, drop `import type { z } from "zod"` and the `…Schema` type import). Nothing
   else in those files.

Do not touch `InvitePanel.tsx` (E1-T08 owns it). Commit: `E1-T05: web validation and import decoding on the
shared issue adapter` (body: "docs/EFFECT.md E4; plan e1 P5, P8").

### E1-T06 — Core and finance routes onto `validate` (rewrite)

Read: P8, P9, P12; `apps/api/src/lib/validate.ts` (E1-T04, its exports only); the files below. Touch no line the
tables do not name. After the edits, `grep -n 'zValidator\|onValidationError\|from "zod"\|\.safeParse(\|\.options\b' <the 14 files>`
prints nothing. Order of imports: put each new import line exactly where the table says.

General rule G1 (every `zValidator` call in the files of table B): `zValidator("<target>", <Schema>, onValidationError)`
→ `validate("<target>", <Schema>)` (same target, same schema expression, same position, same trailing comma).

**Table A — `apps/api/src/core/routes/`**

| File | Old | New |
| --- | --- | --- |
| `households.ts` | `import { zValidator } from "@hono/zod-validator";` | (line deleted) |
| `households.ts` | `import { onValidationError } from "../services/households/validation.ts";` | `import { validate } from "../../lib/validate.ts";` |
| `households.ts` | the 2 `zValidator(…)` calls | G1 |
| `invites.ts` | `import { zValidator } from "@hono/zod-validator";` | (deleted) |
| `invites.ts` | `import { onValidationError } from "../services/households/validation.ts";` | `import { validate } from "../../lib/validate.ts";` |
| `invites.ts` | the 3 calls | G1 |
| `members.ts` | `import { zValidator } from "@hono/zod-validator";` | (deleted) |
| `members.ts` | `import { onValidationError } from "../services/households/validation.ts";` | `import { validate } from "../../lib/validate.ts";` |
| `members.ts` | the 3 calls | G1 |
| `modules.ts` | `import { onValidationError } from "../services/households/validation.ts";` | `import { decodeOrThrow } from "../../lib/validate.ts";` |
| `modules.ts` | the six lines `  const result = EnableModuleRequestSchema.safeParse(raw);` / `  if (!result.success) {` / `    onValidationError(result);` / `    throw ApiError.validationFailed(undefined); // unreachable: onValidationError throws` / `  }` / `  return result.data;` | the one line `  return decodeOrThrow(EnableModuleRequestSchema, raw);` |
| `modules.ts` | ` * \`EnableModuleRequestSchema\` and answers 422 \`validation_failed\` like every zValidator here.` | ` * \`EnableModuleRequestSchema\` and answers 422 \`validation_failed\` like every validate() here.` |
| `auth.ts` | `import type { z } from "zod";` | `import { Option } from "effect";` |
| `auth.ts` | `import { ApiError } from "../../lib/errors.ts";` | that line, then a new line `import { decodeOption, decodeOrThrow, type Decodable, type Decoded } from "../../lib/validate.ts";` |
| `auth.ts` | `  OAuthProviderSchema,` (in the `@toon/shared` import) | two lines `  OAUTH_PROVIDERS,` / `  OAuthProviderSchema,` |
| `auth.ts` | ` * content type is what \`zValidator("json", …)\` does for every other router; this` | ` * content type is what \`validate("json", …)\` does for every other router; this` |
| `auth.ts` | ` * Parses + validates a JSON body. A malformed body is 400, a ZodError becomes 422` | ` * Parses + validates a JSON body. A malformed body is 400, a decode failure becomes 422` |
| `auth.ts` | `async function readJson<S extends z.ZodType>(c: AppContext, schema: S): Promise<z.output<S>> {` | `async function readJson<S extends Decodable>(c: AppContext, schema: S): Promise<Decoded<S>> {` |
| `auth.ts` | `  return schema.parse(raw) as z.output<S>;` | `  return decodeOrThrow(schema, raw);` |
| `auth.ts` | `  const parsed = OAuthProviderSchema.safeParse(c.req.param("provider"));` / `  if (!parsed.success) throw ApiError.notFound("server.auth.unknownOauthProvider");` / `  return parsed.data;` | `  const parsed = decodeOption(OAuthProviderSchema, c.req.param("provider"));` / `  if (Option.isNone(parsed)) throw ApiError.notFound("server.auth.unknownOauthProvider");` / `  return parsed.value;` |
| `auth.ts` | `    providers: OAuthProviderSchema.options.map((provider) => {` | `    providers: OAUTH_PROVIDERS.map((provider) => {` |

**Table B — `apps/api/src/modules/finance/` and the shared user schema**

| File | Old | New |
| --- | --- | --- |
| `routes/balance.ts`, `routes/categories.ts`, `routes/participants.ts`, `routes/plan.ts`, `routes/settlements.ts`, `routes/tags.ts`, `routes/transactions.ts` | `import { zValidator } from "@hono/zod-validator";` | (deleted) |
| the same 7 files | `import { onValidationError } from "../../../core/services/households/validation.ts";` | `import { validate } from "../../../lib/validate.ts";` |
| the same 7 files | every `zValidator(…)` call (2, 2, 3, 9, 2, 2, 4) | G1 |
| `setup.ts` | `import { ApiError } from "../../lib/errors.ts";` | that line, then a new line `import { decodeOption } from "../../lib/validate.ts";` |
| `setup.ts` | `import { eq } from "drizzle-orm";` | `import { eq } from "drizzle-orm";` then a new line `import { Option } from "effect";` |
| `setup.ts` | `    const parsed = FinanceEnableSettingsSchema.safeParse(settings);` / `    if (!parsed.success) throw participantsRequired();` / `    await assignParticipants(tx, householdId, parsed.data.participants);` | `    const parsed = decodeOption(FinanceEnableSettingsSchema, settings);` / `    if (Option.isNone(parsed)) throw participantsRequired();` / `    await assignParticipants(tx, householdId, parsed.value.participants);` |
| `packages/shared/src/core/schemas/user.ts` | `/** OAuth providers wired up in this app. */` / `export const OAuthProviderSchema = z.enum(["google", "github"]);` | `/** OAuth providers wired up in this app. */` / `export const OAUTH_PROVIDERS = ["google", "github"] as const;` / `export const OAuthProviderSchema = z.enum(OAUTH_PROVIDERS);` |

`Decoded<S>` has a zod arm (P9), so a zod schema passed to `readJson` / `validate` / `decodeOrThrow` types
exactly as `z.output` did. If `typecheck` then reports a type error that the table did not foresee (for example a
handler reading `c.req.valid(…)`), STOP and report it with the file, line and message; do not improvise a fix.
Commit: `E1-T06: core and finance routes validate through lib/validate.ts` (body: "docs/EFFECT.md E4; plan e1 P9, P10,
P12").

### E1-T07 — Recipe routes onto `validate` (rewrite)

Read: P8, P9, P12, P19; `apps/api/src/lib/validate.ts` (exports); the files below. Touch no line the table does not
name. After the edits, `grep -n 'zValidator\|onValidationError\|from "zod"\|\.safeParse(\|\.parse(' <the 6 api files>`
prints only `JSON.parse` lines (if any). G1 as in E1-T06.

| File | Old | New |
| --- | --- | --- |
| `apps/api/src/modules/recipe/routes/plan.ts` | `import { zValidator } from "@hono/zod-validator";` | (deleted) |
| `…/routes/plan.ts` | `import { onValidationError } from "../../../core/services/households/validation.ts";` | `import { validate } from "../../../lib/validate.ts";` |
| `…/routes/plan.ts` | the 4 calls | G1 |
| `…/routes/recipes.ts` | `import { zValidator } from "@hono/zod-validator";` | (deleted) |
| `…/routes/recipes.ts` | `import { keepOnlySentKeys, onValidationError } from "../../../core/services/households/validation.ts";` | two lines `import { keepOnlySentKeys } from "../../../core/services/households/validation.ts";` / `import { validate } from "../../../lib/validate.ts";` |
| `…/routes/recipes.ts` | the 9 calls | G1 |
| `…/routes/shopping.ts` | `import { zValidator } from "@hono/zod-validator";` | `import { Option } from "effect";` |
| `…/routes/shopping.ts` | `  IdSchema,` (in the `@toon/shared` import) | (deleted) |
| `…/routes/shopping.ts` | `  PaginationQuerySchema,` (in the `@toon/shared` import) | two lines `  ShoppingBoughtListQuerySchema,` / `  ShoppingCatalogListQuerySchema,` |
| `…/routes/shopping.ts` | `import { z } from "zod";` | (deleted) |
| `…/routes/shopping.ts` | `import { onValidationError } from "../../../core/services/households/validation.ts";` | `import { decodeOption, validate } from "../../../lib/validate.ts";` |
| `…/routes/shopping.ts` | `  const parsed = IsoDateSchema.safeParse(raw);` / `  if (!parsed.success) return undefined;` / `  const value = Date.parse(parsed.data);` | `  const parsed = decodeOption(IsoDateSchema, raw);` / `  if (Option.isNone(parsed)) return undefined;` / `  const value = Date.parse(parsed.value);` |
| `…/routes/shopping.ts` | the block from `/** \`GET …/shopping-lists/bought\` query — the household-wide archive, \`listId\` optional. */` through the closing `});` of `const CatalogListQuerySchema = …` (lines 95–108, both definitions and their doc comments, plus the blank line between them) | (deleted; one blank line remains before `export const shoppingRoutes`) |
| `…/routes/shopping.ts` | `zValidator("query", BoughtListQuerySchema, onValidationError)` | `validate("query", ShoppingBoughtListQuerySchema)` |
| `…/routes/shopping.ts` | `zValidator("query", CatalogListQuerySchema, onValidationError)` | `validate("query", ShoppingCatalogListQuerySchema)` |
| `…/routes/shopping.ts` | `zValidator("json", CheckShoppingItemRequestSchema.optional(), onValidationError)` (3 times) | `validate("json", CheckShoppingItemRequestSchema)` (P12) |
| `…/routes/shopping.ts` | every other `zValidator(…)` call | G1 |
| `packages/shared/src/modules/recipe/schemas/shopping.ts` | `import { IdSchema, IsoDateSchema, listResponse } from "../../../core/schemas/common.ts";` | `import { IdSchema, IsoDateSchema, listResponse, PaginationQuerySchema } from "../../../core/schemas/common.ts";` |
| `…/schemas/shopping.ts` | after the closing `>;` of `export type UpdateShoppingCatalogEntryRequest = z.infer<…` (the end of the requests section) | a blank line, then: `/** \`GET …/shopping-lists/bought\` query — the household-wide archive, \`listId\` optional. */` / `export const ShoppingBoughtListQuerySchema = PaginationQuerySchema.extend({ listId: IdSchema.optional() });` / `export type ShoppingBoughtListQuery = z.infer<typeof ShoppingBoughtListQuerySchema>;` / (blank) / `/**` / ` * \`GET …/shopping-lists/:listId/catalog\` query. \`includeHidden\` is deliberately` / ` * NOT \`z.coerce.boolean()\` — that turns the string "0" into \`true\`, a live trap` / ` * for a query param (see \`RecipeListQuerySchema.hasCooked\` for the same rule).` / ` */` / `export const ShoppingCatalogListQuerySchema = PaginationQuerySchema.extend({` / `  includeHidden: z` / `    .enum(["0", "1"])` / `    .optional()` / `    .transform((value) => value === "1"),` / `});` / `export type ShoppingCatalogListQuery = z.infer<typeof ShoppingCatalogListQuerySchema>;` |
| `apps/api/src/modules/recipe/routes/cards.ts` | `import type { z } from "zod";` | (deleted) |
| `…/routes/cards.ts` | `import { ApiError } from "../../../lib/errors.ts";` | that line, then a new line `import { decodeOrThrow, type Decodable, type Decoded } from "../../../lib/validate.ts";` |
| `…/routes/cards.ts` | the doc comment of `readJson` (from ` * Parses the body with the schema and lets the RAW \`ZodError\` escape.` to its ` */`) | ` * Parses the body with the schema and lets the decode failure escape to \`onErrorHandler\`.` / ` *` / ` * Every validator renders its issues through \`toValidationIssues\` since E1 (ADR 0013),` / ` * so the catalog key survives on every route; the card routes read the body themselves` / ` * because they need the raw JSON. The card value's issues` / ` * are exactly the ones a client wants to re-render in its own language` / ` * ("Prüfziffer passt nicht"), so they have to keep their keys. Same shape as` / ` * \`readJson\` in routes/auth.ts, which is private to that file.` / ` */` (the `("Prüfziffer passt nicht")` line is byte-identical to today's, P19) |
| `…/routes/cards.ts` | `async function readJson<S extends z.ZodType>(c: AppContext, schema: S): Promise<z.output<S>> {` | `async function readJson<S extends Decodable>(c: AppContext, schema: S): Promise<Decoded<S>> {` |
| `…/routes/cards.ts` | `  return schema.parse(raw) as z.output<S>;` | `  return decodeOrThrow(schema, raw);` |
| `apps/api/src/modules/recipe/routes/imports.ts` | `import type { z } from "zod";` | (deleted) |
| `…/routes/imports.ts` | `import { ApiError } from "../../../lib/errors.ts";` | that line, then a new line `import { decodeOrThrow, type Decodable, type Decoded } from "../../../lib/validate.ts";` |
| `…/routes/imports.ts` | `/** Parses a JSON body with a Zod schema, mapping malformed JSON to 400. */` | `/** Parses a JSON body with a shared schema, mapping malformed JSON to 400. */` |
| `…/routes/imports.ts` | `async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {` | `async function readJson<S extends Decodable>(request: Request, schema: S): Promise<Decoded<S>> {` |
| `…/routes/imports.ts` | `  // A ZodError becomes 422 validation_failed in the global error handler.` / `  return schema.parse(body);` | `  // A decode failure becomes 422 validation_failed in the global error handler.` / `  return decodeOrThrow(schema, body);` |
| `…/routes/imports.ts` | `ImportDraftListQuerySchema.parse(c.req.query())` | `decodeOrThrow(ImportDraftListQuerySchema, c.req.query())` |
| `…/routes/imports.ts` | `ParsedRecipeSchema.parse(row.parsed)` | `decodeOrThrow(ParsedRecipeSchema, row.parsed)` |
| `apps/api/src/modules/recipe/services/import/drafts.ts` | `import { and, count, desc, eq } from "drizzle-orm";` | that line, then a new line `import { Option } from "effect";` |
| `…/import/drafts.ts` | `import { ApiError } from "../../../../lib/errors.ts";` | that line, then a new line `import { decodeOption } from "../../../../lib/validate.ts";` |
| `…/import/drafts.ts` | `  const parsedResult = ParsedRecipeSchema.safeParse(row.parsed);` / `  const stored: ParsedRecipe = parsedResult.success` / `    ? parsedResult.data` / `    : emptyParsedRecipe({ confidence: { overall: 0 } });` | `  const stored: ParsedRecipe = Option.getOrElse(decodeOption(ParsedRecipeSchema, row.parsed), () =>` / `    emptyParsedRecipe({ confidence: { overall: 0 } }),` / `  );` |
| `…/import/drafts.ts` | `  const metaResult = row.sourceMeta === null ? undefined : ImportSourceMetaSchema.safeParse(row.sourceMeta);` / `  const sourceMeta: ImportSourceMeta \| null = metaResult?.success === true ? metaResult.data : null;` | `  const sourceMeta: ImportSourceMeta \| null =` / `    row.sourceMeta === null ? null : Option.getOrNull(decodeOption(ImportSourceMetaSchema, row.sourceMeta));` |

If `typecheck` reports an error the table did not foresee, STOP and report it verbatim; do not improvise.
Commit: `E1-T07: recipe routes validate through lib/validate.ts; shopping query schemas move to @toon/shared`
(body: "docs/EFFECT.md E4; plan e1 P9, P10, P12").

### E1-T08 — The core flip and the module decoupling (core)

Read first: `repos/effect/LLMS.md` "Defining schemas"; `agent-patterns/effect-schema.md` (whole, as corrected by
E1-T02); `repos/effect/packages/effect/SCHEMA.md` "Structs", "Index Signatures", "Deriving Structs", "Unions",
"Union of Literals", "Decoding Defaults", "Transforming One Schema into Another"; `repos/effect/migration/schema.md`;
`packages/shared/src/core/schemas/checks.ts` and `packages/shared/src/core/i18n/issues.ts` (E1-T02);
`packages/shared/test/support/schema.ts`; the golden files `core.*.json`; the files below; `docs/modules/recipe.md`
4b R27 (`HttpUrlSchema`); CLAUDE.md gotchas "Placeholders and claim invites" (`PublicUser.email` nullable),
"Core copy stays module-neutral" (no new copy). Decisions P1–P7, P13, P14, P19.

Build (one commit, the tree green):
1. Rewrite `packages/shared/src/core/schemas/{common,user,household,auth}.ts` and
   `packages/shared/src/modules/registry.ts` onto the vocabulary and plain Effect (P4), keeping every exported
   name, every doc comment, the order of declarations, `ERROR_CODES`, `ROLE_RANK`, `roleAtLeast`,
   `isHttpUrl`, `hasNoControlChars`, `isModuleId`, the constants; types per P5; `refineKey` uses become `keyed`;
   `listResponse(item)` generic over an Effect schema; `ServerFeaturesSchema` with `Schema.StructWithRest`;
   `HealthResponseSchema`'s key order unchanged. Update the doc comment of `packages/shared/src/index.ts`
   ("Zod schemas" → "Effect `Schema` definitions").
2. P13: create `packages/shared/src/core/schemas/zod-legacy.ts`; in every module schema file
   (`packages/shared/src/modules/recipe/schemas/{card,import,plan,recipe,shopping}.ts`,
   `packages/shared/src/modules/finance/schemas/{balance,categories,participants,plan,settlements,tags,transactions}.ts`)
   change ONLY the import lines that bring `IdSchema`, `IsoDateSchema`, `HttpUrlSchema`, `listResponse`,
   `PaginationQuerySchema`, `PublicUserSchema` from `../../../core/schemas/{common,user}.ts` so those names come
   from `../../../core/schemas/zod-legacy.ts` (pure functions such as `isHttpUrl` keep their import).
3. Tests (P14): `packages/shared/test/core.test.ts` and `packages/shared/test/household.test.ts` onto the
   support helpers; in `packages/shared/test/finance-schemas.test.ts` ONLY the test
   `listResponse() produces { items, total, limit, offset }` (its `listResponse(z.object({ id: z.string() }))`
   becomes `listResponse(Schema.Struct({ id: Schema.String }))` and its `.safeParse` calls the helper);
   `apps/api/test/smoke.test.ts` and `apps/api/test/runtime.test.ts` per P14; new
   `packages/shared/test/parity/core.parity.test.ts` running `runGolden` on the five `core.*.json` files with
   its P7 allow map.
4. `apps/web/src/core/features/households/components/InvitePanel.tsx`: `InviteFormSchema` as
   `Schema.Struct({ email: EmailSchema, role: InvitableRoleSchema.pipe(Schema.withDecodingDefault(Effect.succeed("member" as const))) })`
   (imports from `effect`, `import { z } from "zod"` removed); nothing else in the file.
5. Do not edit `checks.ts` / `issues.ts` unless the core golden proves a vocabulary bug; then fix it here, add
   the case to `primitives.json`'s builder and regenerate that one file, and say so in the commit body (in wave 5 only E1-T10 may, P21).

Commit: `E1-T08: core schemas on Effect Schema; module schemas decoupled through zod-legacy.ts` (body:
"docs/EFFECT.md E4; plan e1 P1–P7, P13, P14").

### E1-T09 — The finance flip (build)

Read: as E1-T08's first line; the golden files `finance.*.json`; `packages/shared/src/modules/finance/schemas/*.ts`,
`packages/shared/src/modules/finance/index.ts`; `packages/shared/test/finance-schemas.test.ts`,
`packages/shared/test/finance-i18n.test.ts`; `docs/modules/finance.md` §1.5 (shared package), §4a "Finance TS
identifiers carry a `finance` prefix…", "Finance server catalog (ADR 0002)", 4b F48 (no refinement for a
dedicated code: `transaction_amount_zero` stays a service throw, never a schema rule), the period bounds
(toon-finance 1715207). Decisions P1–P7, P13, P14.

Build (one commit): the eight finance schema files on the vocabulary (P4) with every exported name, comment and
type (P5); `BooleanQuerySchema` as `OneOf([Bool, Str])` plus a `decodeTo` whose unknown string fails with
`wireIssue({ code: "custom" })` (no key: the ladder falls to `server.zod.fallback`, as today); `PeriodSchema` as
`Str.check(keyed(isPeriodString, "server.validation.periodFormat"), keyed(bounds, "server.validation.periodBounds"))`
so both run (zod runs both); `MemberSlotSchema` as `OneOf([Lit(1), Lit(2)])` (`invalid_union`, not
`invalid_value`); `Update…RequestSchema = partial(Create…)`; the imports from `zod-legacy.ts` pointed back at
`../../../core/schemas/common.ts` (P13); `refineKey` replaced by `keyed`. Tests (P14):
`finance-schemas.test.ts` (all remaining calls) and `finance-i18n.test.ts` (`resolveZodIssue` → `resolveIssue`
from `../src/core/i18n/issues.ts`, `$ZodIssue` → `FlatIssue`, the `issue()` helper builds a `FlatIssue`; the
`zod/v4/core` import removed); new `packages/shared/test/parity/finance.parity.test.ts` over the eight
`finance.*.json`. Do not edit `checks.ts`, `issues.ts`, `zod-legacy.ts`, the primitives files or any recipe
file; a vocabulary gap is bridged inside `finance/schemas/common.ts` per P21 (plain Effect plus `WIRE_ISSUE` /
`wireIssue`, comment `vocabulary gap, plan e1 P21`) and named in the commit body, or, if it cannot be, the task
returns `blocked` with the failing case id.

Commit: `E1-T09: finance schemas on Effect Schema` (body: "docs/EFFECT.md E4; plan e1 P1–P7, P14").

### E1-T10 — The recipe flip (core)

Read: as E1-T08's first line; the golden files `recipe.*.json`; `packages/shared/src/modules/recipe/schemas/*.ts`,
`packages/shared/src/modules/recipe/barcode.ts` (`normalizeBarcodeValue`, `checkBarcodeValue`),
`packages/shared/src/core/calendar.ts` (`isPlanDate`, `planDaysBetween`); `packages/shared/test/recipe-schemas.test.ts`,
`packages/shared/test/cards.test.ts`, `packages/shared/test/ingredients.test.ts` (line 216); `apps/api/src/core/services/households/validation.ts` (`keepOnlySentKeys`:
it stays, because `partial` keeps the defaults, P4); `docs/modules/recipe.md` §1.3, 4a "Recipe tables …" (names),
4b R27 (`HttpUrlSchema` on every client URL), R30 (`normalizeBarcodeValue` forgiving, `checkBarcodeValue`
strict), R31 (format and value travel together), the `course` comment in `recipe.ts` (absent vs `null`).
Decisions P1–P7, P12, P13, P14.

Build (one commit): the five recipe schema files on the vocabulary with every exported name, comment (the
i18n:check hits of section 1.1 verbatim) and type (P5; `CreateCardRequest` / `UpdateCardRequest` are
`DeepMutable<…Encoded>`, `CreateCardInput` / `UpdateCardInput` `DeepMutable<…Type>`); the card request schemas
as a struct, then a `decodeTo` normalising `value` (only when `format` and `value` are both present for the
update), then a `Schema.makeFilter` returning `keyedIssue(cardValueIssueKey(…), ["value"])` (zod's
`superRefine`), the two update refinements as `keyed` (`server.card.formatAndValue` with path `["value"]`,
`server.validation.noChanges`), in zod's order; `RecipeListQuerySchema.hasCooked` and
`ShoppingCatalogListQuerySchema.includeHidden` as `Schema.optional(Enum(["0","1"]))` with a `decodeTo` to
`boolean | undefined` / `boolean`; `MealPlanRangeQuerySchema` with its two keyed struct checks;
`ShoppingBoughtListQuerySchema` / `ShoppingCatalogListQuerySchema` as `Schema.Struct({ ...PaginationQuerySchema.fields, … })`;
`UpdateRecipeRequestSchema = partial(CreateRecipeRequestSchema)` keeping the array defaults (golden decides);
`emptyParsedRecipe` unchanged; imports from `zod-legacy.ts` pointed back at the core (P13). Tests (P14):
`recipe-schemas.test.ts`, `cards.test.ts` (`toValidationIssues(result.error)` → `toValidationIssues(result.error.issue)`;
`issueKeys(error)` takes the support helper's error), `ingredients.test.ts` (ONLY line 216:
`const parsed = RecipeIngredientSchema.safeParse(parseIngredientLine(line));` → `const parsed =
safeParse(RecipeIngredientSchema, parseIngredientLine(line));`, plus the import `import { safeParse } from
"./support/schema.ts";` after the file's last import line; the `expect` lines unchanged); new
`packages/shared/test/parity/recipe.parity.test.ts` over the five `recipe.*.json`. Do not edit `zod-legacy.ts`
or any finance file. A vocabulary gap is this task's to fix (P21): a minimal, preferably additive change to
`checks.ts` / `issues.ts` with a new case in `primitives.build.ts`, `primitives.json` regenerated by
`bun packages/shared/test/fixtures/schema-golden/primitives.build.ts`, `schema-checks.test.ts` green, the fix
named in the commit body.

Commit: `E1-T10: recipe schemas on Effect Schema` (body: "docs/EFFECT.md E4; plan e1 P1–P7, P12, P14").

### E1-T11 — Zod leaves the tree; the idioms rule (build)

Read: P8, P15, P16; `apps/api/test/effect-idioms.test.ts` (rules (1)–(8), `scan`, `hasSpecifier`,
`expectNoProblems`, rule (6)'s package.json walk and rule (7)'s lockfile read, the `PENDING_RULES` comment);
CLAUDE.md "Long commands" (a cold `bun install` goes to the background with a log ending in `exit=$?`). The
files below.

Build:
1. Delete the zod branches (P8): `packages/shared/src/core/i18n/issues.ts` (`toValidationIssues(issue:
   SchemaIssue.Issue, locale)` only), `apps/api/src/lib/validate.ts` (`type Decodable = Schema.Decoder<unknown,
   never>`, `type Decoded<S extends Decodable> = Types.DeepMutable<S["Type"]>`, the `import type { z }` removed;
   the web pair in `apps/web/src/lib/validation.ts` the same),
   `apps/api/src/lib/errors.ts` (the `ZodError` import and branch), `apps/web/src/lib/validation.ts`,
   `apps/web/src/modules/recipe/features/import/lib/importApi.ts`.
2. Delete `packages/shared/src/core/i18n/zod.ts` (and its export from `core/i18n/index.ts`),
   `packages/shared/src/core/schemas/zod-legacy.ts`, `onValidationError` and its zod-shaped types from
   `apps/api/src/core/services/households/validation.ts` (keep `keepOnlySentKeys`; its comment says "the shared
   schema keeps the `.default([])`" instead of "zod KEEPS"), and the generators
   `packages/shared/test/fixtures/schema-golden/{build.ts,serialize.ts,primitives.build.ts}` and `cases/` (the
   JSON files stay; `support/schema.ts` already holds `goldenReviver` for both markers since E1-T02; if anything
   still imports `serialize.ts`, point it at `support/schema.ts`).
3. `packages/shared/test/i18n.test.ts`: the "Zod issue resolution" block on vocabulary-built schemas with
   `safeParse` from the support and `resolveIssue` / `toValidationIssues(result.error.issue, …)` (P14; every
   `expect` unchanged; the describe title may drop the word "Zod"); `import { z } from "zod"` and `refineKey`
   removed.
3b. `apps/api/test/validate.test.ts` (P20): delete the `describe("dual mode: zod schemas (deleted in E1-T11)")`
   block and the `import { z } from "zod"` line, nothing else; the `describe("validate with shared schemas")`
   block and its `expect` lines stay byte-identical (`git diff` shows deletions only). Confirm no other E1 test
   imports zod (`grep -rln 'from "zod' apps/api/test packages/shared/test apps/web/src` lists only files this
   task deletes).
4. Dependencies: `bun remove zod` in `packages/shared`, `apps/api`, `apps/web` and `bun remove
   @hono/zod-validator` in `apps/api` (logs ending in `exit=$?`); then `bun install --frozen-lockfile` exits 0;
   `git diff -- bun.lock` removes exactly the SIX lines of section 1.1 (line 20 `"@hono/zod-validator": "^0.9.1",`,
   lines 29, 45, 62 `"zod": "^4.5.4",`, line 315 the `@hono/zod-validator@0.9.1` package entry, line 1165 the
   `zod@4.5.4` package entry) and adds none. The dependency removal (the three `package.json` and `bun.lock`) goes
   into the second commit together with step 5 and nothing else, so the numstat check of section 3.1 reads `0`
   added, `6` removed for `bun.lock` in that commit.
5. `apps/api/test/effect-idioms.test.ts`: rule (9) per P15 as a new `describe("(9) no zod (E1, E4)")`, the E1
   line deleted from `PENDING_RULES`; nothing else in the file.

Commits, in this order, each leaving the tree green: first steps 1–3b as `E1-T11: zod branches, generators and
zod-legacy.ts removed` (zod still installed, nothing imports it); then steps 4 and 5 together as `E1-T11: zod and
@hono/zod-validator removed from the dependencies; idioms rule (9) no zod` (rule (9) reads the package.json files
and the lockfile, so it lands with the removal). Bodies: "docs/EFFECT.md E1, E4, E12; plan e1 P8, P15, P20".

### E1-T12 — Integration, docs and the record (build)

Depends on every task. Run each long command in the background with one log under the scratchpad ending in
`exit=$?`, then read it. Every `bun test` finishes and its log is saved before any docker command starts.

1. Gates: `bun install --frozen-lockfile`; `bun run typecheck`; `bun test` (full, `uptime` before it, P17);
   `bun run build`; `bun run i18n:check` (parity `OK`; the 146 hits classified against section 1.1, a changed
   count is a finding); `bun test apps/api/test/effect-idioms.test.ts apps/api/test/docs-paths.test.ts
   apps/api/test/api-doc.test.ts`; `git status --porcelain repos/` empty.
2. Exit greps: `grep -rn --include='*.ts' --include='*.tsx' --exclude-dir=node_modules 'from "zod' apps packages
   scripts` empty; `grep -c '"zod\|@hono/zod-validator' bun.lock` is 0; `git diff f41fb96f3 --stat --
   packages/shared/src/core/i18n/catalogs apps/web/src/lib/i18n` empty (P19).
3. Pass count vs 2463 (P17): record pass, fail, files; the golden parity tests' count separately (`bun test
   packages/shared/test/parity`); every P7 allow-map entry listed with its id.
4. Boot and wire (one background script, `kill -TERM` the server's pid, never `pkill -f`): migrated temp DB,
   `bun run build` output served by `NODE_ENV=development … WEB_DIST_DIR=./apps/web/dist API_PORT=3901 bun
   apps/api/src/index.ts`; `curl` `POST /api/auth/register` with `{ "email": "x", "name": "", "password": "kurz" }`
   and `Content-Type: application/json` (record the 422 body: `details` with `path`, `code`, catalog
   `message`, `i18n`), the same with `Accept-Language: en`; register a user, then `POST /api/households` with
   `{ "name": "" }` (a former zValidator route: record the 422 body with `i18n.key
   "server.zod.field.name.too_small.1"` and message `Name fehlt`); `GET /api/health`; SIGTERM; the log shows
   `[api] runtime disposed`, `server_exit=0`.
5. Headless (Playwright in a scratch directory outside the repo, CLAUDE.md "Headless runs"): on the served app
   at 390×844, `/register` submitted with `x` as e-mail shows "Bitte eine gültige E-Mail-Adresse angeben" under
   the field and the empty name "Name fehlt"; `/login` with an empty password shows its field message; no
   console error. Screenshots stay in the scratchpad.
6. Image: `docker build -t toon-household:e1 . > <log> 2>&1; echo "exit=$?" >> <log>` (exit 0: the `deps`
   stage installs the lockfile without zod); `docker image rm toon-household:e1`.
7. Bundle (P18): `for f in apps/web/dist/assets/*.js; do gzip -c "$f" | wc -c; done | awk '{s+=$1} END {print s}'`,
   delta to 399812.
8. Docs: CLAUDE.md — "Fixed decisions" gains ADR 0013; "Layout (as built)" names
   `packages/shared/src/core/schemas/checks.ts`, `packages/shared/src/core/i18n/issues.ts`,
   `apps/api/src/lib/validate.ts`, `packages/shared/test/support/schema.ts`,
   `packages/shared/test/fixtures/schema-golden/` and `packages/shared/test/parity/`; "Status" the new pass and
   file counts and one sentence that E1 is done (`docs/plans/e1-shared-schema.md`); one new gotcha under
   "Database and API" — "Validation details come from the wire-issue vocabulary (E1, ADR 0013)": a schema that
   can fail on the wire is built from `checks.ts` (or carries `WIRE_ISSUE`), decodes with `ALL_ISSUES`, exported
   types are `Types.DeepMutable<typeof X.Type>`, the parity tests over the golden JSON are the oracle and the
   P7 allow maps are the only tolerated divergence. `docs/API.md`: the error-table description of
   `validation_failed` "A Zod schema refused the body or query" → "The shared schema refused the body or query"
   and the implementation note near line 1037 about `routes/cards.ts` throwing the raw `ZodError` rewritten to
   say every route renders through the adapter (no row, status or code changes). `docs/modules/recipe.md` §1.3
   "the Zod schemas" → "the Effect `Schema` definitions" and 4b R32's status column (the cards route decodes
   with `decodeOrThrow`; `apps/api/test/cards.test.ts` still pins key and message). `agent-patterns/effect-schema.md`
   §7 "As built (E1)" with one real example each from `checks.ts`, `issues.ts` and a flipped schema file.
   `bun test apps/api/test/docs-paths.test.ts` after the edits.
9. Write section 9 (integration record) and section 10 (what changed vs plan, every deviation) of this plan
   and set the status line to `**Status: DONE (<date>).**`. Section 9 quotes verbatim: the full run's
   `Ran N tests across M files` and pass/fail lines, the i18n:check `OK` and `FAILED — 146` lines, the two 422
   bodies of step 4 and the boot log lines, the headless result, the image build's `exit=0`, the gzipped
   bundle total in bytes.

Commit: `E1-T12: integration record (plan e1-shared-schema sections 9 and 10), docs, status DONE`.

## 5. Acceptance summary

| Task | Accepted when |
| --- | --- |
| T01 | 18 golden JSON files committed and reproducible (`build.ts --check`); coverage test green; > 1000 cases. |
| T02 | vocabulary, adapter and support exist; `primitives.json` parity green (P7 entries only), including the `$number` cases; the hand-written NaN/±Infinity assertions green; `schema-checks.test.ts` and `support/schema.ts` zod-free; shared, api, web suites green unchanged; i18n:check at 146. |
| T03 | `env.ts` and `oauth.ts` without zod; `env-parse` and `oauth-claims` tests zod-free and identical before and after (they test `parseEnv` and the three parse functions); `security.test.ts` green. |
| T04 | `validate.ts` with the two-arm `Decoded` and the `SchemaError` branch; `validate.test.ts` green, its zod cases in the one delimited dual-mode block with vocabulary twins; compile-time checks for both arms; ADR 0013 written with the web-form consequences. |
| T05 | web `validate` dual and tested with German messages on vocabulary schemas only (test file zod-free); finance cards zod-free. |
| T06, T07 | no `zValidator`, `onValidationError` import, `safeParse` or zod import left in the named files; API suite green with unchanged assertions. |
| T08 | core schemas Effect; `core.parity` green; module schemas compile through `zod-legacy.ts`; smoke/runtime tests green. |
| T09, T10 | module schemas Effect; their parity files green; their shared tests (T10 including `ingredients.test.ts` line 216) green with unchanged `expect` lines; any vocabulary gap handled per P21. |
| T11 | no zod anywhere (P15 rule green); `bun.lock` lost exactly its six zod lines; `validate.test.ts` lost only the dual-mode block and its import; full suite green. |
| T12 | every exit criterion measured and quoted in section 9. |

## 6. Risks

1. **The Effect issue tree is not what the plan assumes** (an `AnyOf` shape, where a `MissingKey` sits, a
   `Literals` failure). Mitigation: E1-T02's primitive golden fails first, on the construct, before any schema
   moves; P3 says what to emit, not how the tree looks.
2. **A Zod semantic without an Effect twin** (zod's object refine after a continuable field issue). Mitigation:
   P7 names the one tolerated case and makes the allow map self-checking; anything else is a defect.
3. **Type drift** (`readonly`, optional vs `| undefined`, `StructWithRest` index signatures) breaking apps/api or
   apps/web. Mitigation: P5 (`DeepMutable`), E1-T02's compile-time assertions, `bun run typecheck` over the
   five projects in every task.
4. **Hono typing of `c.req.valid`** with a custom validator. Mitigation: E1-T04 builds it on `hono/validator`
   exactly like `@hono/zod-validator` and proves it in `validate.test.ts` before any route moves.
5. **Rewrite tasks meeting an unforeseen type error.** Mitigation: the tables say STOP and report; the planner
   then adds a row.
6. **Parallel-worktree load** making the sharp thumbnail tests time out. Mitigation: P17 (the E0 rule).
7. **Bundle growth** from `effect` `Schema` in the web bundle. Mitigation: measured in E1-T12; the budget and any
   ADR belong to E6.
8. **i18n:check drift** from moved or rewritten comments (the scanner flags any line with a quote and an umlaut
   or a stopword such as die, das, der, noch, mehr, kann). Mitigation: P19, the per-file counts of section 1.1,
   and the I18N command in the verify of EVERY task that edits a scanned file (`apps/api/src`, `apps/web/src`,
   `packages/shared/src`): E1-T02 to E1-T12 (section 3.1). Only E1-T01 (test fixtures only, not scanned) runs
   without it. A new hit is fixed in the task that introduced it, never later.
9. **A vocabulary gap stalls wave 5.** Mitigation: P21 (owner, local fallback, planner recovery path).

## 7. Deviations expected (each recorded in section 10 when it happens)

1. **422 `validation_failed`, not "400 validation_error".** The milestone task text names a status and code the
   contract does not have; `docs/API.md` (error table, Conventions) and every test say 422
   `validation_failed`. The contract wins (behaviour is frozen).
2. **Validator-route `details` prose (P10, ADR 0013).** Same `path` and `code`; the message becomes the
   catalog's in the negotiated locale and `i18n` is added, where Zod's English defaults were sent. Zod's default
   texts cannot exist without zod, E4 forbids library default messages on the wire, and `docs/API.md` already
   documents the catalog form.
3. **Fewer trailing object-level issues on an already rejected body (P7, ADR 0013).**
4. **`env.ts` generic failure lines** use Effect's Standard Schema formatter text (P11): operator console output,
   not the wire; the spelled-out messages and the line format are unchanged.
5. **The commit trailer** is the harness's `Co-Authored-By` line (as in E0, "what changed" item 10).
6. **Forms show catalog prose for a server 422 and, with P7, may surface a struct-level error one submit later**
   (P10, P7, ADR 0013): the `CardFormDialog` label/value case; no wrong acceptance.
7. **A finance-local construct for a vocabulary gap** (P21), if E1-T09 needs one.

## 8. Out of this milestone

`env.ts` → `AppConfig` with `Config` (E2); the tagged `ApiError` family and `Effect.catchTag` at the boundary
(E2); services, `Database`, `Clock` (E2–E4); the web `HttpClient` decoding responses with the shared schemas
(E6); `HttpApi` / `HttpApiGroup` replacing Hono, and with it `hono/validator` (E7); renaming catalog keys
`server.zod.*` (never: ADR 0012 P9); any `docs/API.md` row, status or code; any UI copy or German string; the
idioms rules of E2 and E7; OpenAPI generation from the schemas.

## 9. Integration record

Written by E1-T12 on 2026-10-16, on `main` at `b16d8950a` (E1-T11) plus this task's docs, Bun 1.4.3. Every log is
in the T12 scratchpad and was read; what follows quotes it.

### 9.1 Gates

- `bun install --frozen-lockfile`: `Checked 439 installs across 628 packages (no changes)`, `exit=0`.
- `bun run typecheck`: five projects, `[typecheck] OK`, `exit=0`.
- Full `bun test` (`uptime` before it, P17: `load average: 9.04, 23.30, 42.47`, i.e. falling from the parallel
  worktrees' load; no thumbnail timeout occurred):
  ```
   14504 pass
   0 fail
   382686 expect() calls
  Ran 14504 tests across 149 files. [24.56s]
  ```
  The floor was 2463 (E0, 141 files). The growth is the golden parity cases (each case is a test): `bun test
  packages/shared/test/parity` alone is `11357 pass`, `0 fail`, `53796 expect() calls`, `Ran 11357 tests across 3
  files. [4.36s]` (core, finance, recipe). Without them the suite is 3147 pass in 146 files, which is E0's 2463
  plus the tests E1 added (schema-checks, golden coverage, validate, env-parse, oauth-claims, support tests).
- `bun run build`: `Exited with code 0`, `precache  104 entries (1456.28 KiB)`.
- `bun run i18n:check`:
  ```
  [i18n:check] OK
  [i18n:check] FAILED — 146 possible German literal(s):
  ```
  Classified against section 1.1: the hits in the files E1 touched are exactly the planned ones, all doc
  comments quoting German: 6 in `packages/shared/src/modules/recipe/schemas/shopping.ts`, 1 each in
  `packages/shared/src/modules/recipe/schemas/{recipe,import}.ts`, 6 in
  `apps/api/src/modules/recipe/routes/shopping.ts`, 1 in `apps/api/src/modules/recipe/routes/cards.ts`, 1 in
  `apps/web/src/lib/validation.ts`. The other 130 are the known false positives (86 files in all; the largest
  `apps/api/src/modules/recipe/services/import/html/entities.ts` 7, `services/shopping/items.service.ts` 6),
  none new. The count is unchanged at 146.
- `bun test apps/api/test/effect-idioms.test.ts apps/api/test/docs-paths.test.ts apps/api/test/api-doc.test.ts`:
  `31 pass`, `0 fail`, `Ran 31 tests across 3 files.` (again after the doc edits of this task).
- `git status --porcelain repos/`: empty.

### 9.2 Exit greps

- `grep -rn --include='*.ts' --include='*.tsx' --exclude-dir=node_modules 'from "zod' apps packages scripts`:
  no line.
- `grep -c '"zod\|@hono/zod-validator' bun.lock`: `0`.
- `git diff f41fb96f3 --stat -- packages/shared/src/core/i18n/catalogs apps/web/src/lib/i18n`: empty (P19).

### 9.3 The P7 allow maps (33 ids, every one a case that must diverge)

Each entry is an already rejected input where Zod also ran a check Effect skips; `ok` and `details[0]` agree.

- `packages/shared/test/schema-checks.test.ts` `P7_ALLOW` (6, over `primitives.json`):
  `z.string().trim().min(1).max(80)#array`; `z.array(z.string()).min(1).max(3)#bad-items-and-too-many`;
  `z.array(z.string()).length(2)#bad-item-and-too-few`; the struct-refinement-after-a-continuable-field-issue case
  (`…refine(() => false, refineKey("server.validation.noChanges"))#continuable-field-issue`); its inner twin
  (`#inner-continuable-and-title`); `z.array(z.object({ name: z.string() })).max(1)#two-bad`.
- `core.parity.test.ts` `P7_USER` (4, `core.user.json`, string min-length check on an array after `invalid_type`):
  `PasswordSchema#type-[]`, `DisplayNameSchema#type-[]`, `HouseholdNameSchema#type-[]`, `OpaqueTokenSchema#type-[]`.
- `finance.parity.test.ts` (12): `P7_CATEGORIES` `CategoryLabelSchema#type-[]`; `P7_TAGS` `TagNameSchema#type-[]`;
  `P7_TRANSACTIONS` `TransactionDescriptionSchema#type-[]`; `P7_PARTICIPANTS` `FinanceDisplayNameSchema#type-[]`
  (those four: length after `invalid_type`) and, array `.length(2)` after an item failed,
  `FinanceParticipantAssignmentSchema#{one-bad,three-bad,root-string}`,
  `UpdateFinanceParticipantsRequestSchema#{bad-and-length,participants=str-x,participants=with-null}`,
  `FinanceEnableSettingsSchema#{participants=str-x,participants=with-null}`.
- `recipe.parity.test.ts` (11): `P7_CARD` `UpdateCardRequestSchema#{value-only-bad,label-and-bad-pair}` (the
  object-level `server.card.formatAndValue` after `value` / `label` too short); `P7_PLAN`
  `MealPlanRangeQuerySchema#{range-to-bad,range-both-bad,range-both-bad-reversed,range-from-empty,from=empty,
  from=blank,to=empty,to=blank,to=padded}` (`server.plan.rangeInvalid` / `rangeTooLong` after a
  `server.plan.invalidDate` field issue).

### 9.4 Boot and wire

One script (`kill -TERM` of the server's pid): migrated temp DB (`migrate_exit=0`), `NODE_ENV=development
DATABASE_URL=file:<tmp>/boot.db … WEB_DIST_DIR=./apps/web/dist API_PORT=3901 WEB_ORIGIN=http://127.0.0.1:3901 bun
apps/api/src/index.ts`. `POST /api/auth/register` with `{"email":"x","name":"","password":"kurz"}`, German
(`HTTP/1.1 422 Unprocessable Entity`):

```
{"error":{"code":"validation_failed","message":"Eingabe ist ungültig","details":[{"path":"email","code":"invalid_format","message":"Bitte eine gültige E-Mail-Adresse angeben","i18n":{"key":"server.zod.field.email.invalid_format","values":{"field":"email","facet":"email"}}},{"path":"name","code":"too_small","message":"Name fehlt","i18n":{"key":"server.zod.field.name.too_small.1","values":{"field":"name","facet":"string","bound":1}}},{"path":"password","code":"too_small","message":"Passwort muss mindestens 8 Zeichen haben","i18n":{"key":"server.zod.field.password.too_small.8","values":{"field":"password","facet":"string","bound":8}}}]}}
```

The same with `Accept-Language: en` (`HTTP/1.1 422`):

```
{"error":{"code":"validation_failed","message":"Input is invalid","details":[{"path":"email","code":"invalid_format","message":"Please enter a valid email address","i18n":{"key":"server.zod.field.email.invalid_format","values":{"field":"email","facet":"email"}}},{"path":"name","code":"too_small","message":"Name is required","i18n":{"key":"server.zod.field.name.too_small.1","values":{"field":"name","facet":"string","bound":1}}},{"path":"password","code":"too_small","message":"Password must be at least 8 characters","i18n":{"key":"server.zod.field.password.too_small.8","values":{"field":"password","facet":"string","bound":8}}}]}}
```

A valid registration answered `HTTP/1.1 201 Created`; then `POST /api/households` with `{"name":""}` (a former
`zValidator` route, `HTTP/1.1 422 Unprocessable Entity`):

```
{"error":{"code":"validation_failed","message":"Eingabe ist ungültig","details":[{"path":"name","code":"too_small","message":"Name fehlt","i18n":{"key":"server.zod.field.name.too_small.1","values":{"field":"name","facet":"string","bound":1}}}]}}
```

`GET /api/health`: `HTTP/1.1 200 OK`, `{"ok":true,"status":"ok","version":"0.1.0","time":"2026-10-16T12:54:14.630Z","database":"file","modules":["recipe","finance"],"features":{"verifiedEmailRequired":false,"ocrImport":false,"pdfImport":false}}`.
After `kill -TERM 4177574` the server log ends:

```
[api] SIGTERM — stopping modules …
[api] runtime disposed
```

and the script printed `server_exit=0`.

### 9.5 Headless (Playwright 1.64.1 in a scratch directory outside the repo, Chromium, 390x844, `isMobile`, `de-DE`)

On the built app served from `apps/web/dist` (a second origin, `127.0.0.1:3902`): `/register` with `x` as e-mail
and the other fields empty, submit: the form text reads `Name*` / `Name fehlt` / `E-Mail*` / `Bitte eine gültige
E-Mail-Adresse angeben` / `Passwort*` / `Passwort muss mindestens 8 Zeichen haben`, so both required messages
render under their fields; `scrollWidth` and `clientWidth` are `390` and `390`. `/login` with an e-mail and an
empty password: `Passwort*` / `Muss mindestens 1 Zeichen lang sein` under the password field. Page errors: none.
Console errors: two `Failed to load resource … 401`, both `GET /api/auth/me` (the logged-out session probe of
every first load, present before E1; no `Content-Security-Policy` violation and no JavaScript error). Screenshots
`e1-register.png` and `e1-login.png` stayed in the scratchpad.

### 9.6 Image and bundle

- `docker build -t toon-household:e1 . > <log> 2>&1; echo "exit=$?" >> <log>`: the last lines are `#34 naming to
  docker.io/library/toon-household:e1 0.0s done`, `#34 DONE 1.6s`, `exit=0`; the image was removed with
  `docker image rm toon-household:e1` (`Untagged`, `Deleted`).
- Bundle (P18): the gzip loop over the 84 files of `apps/web/dist/assets/*.js` prints **402980** bytes, a delta of
  **+3168** bytes (+0.8 %) to E0's 399812: zod left the web bundle and `effect`'s `Schema` entered it, almost
  evenly. No gate in E1; E6 owns the 60 kB budget.

## 10. What changed vs plan

Everything the plan expected (section 7) happened as written; nothing else moved. In order:

1. **422 `validation_failed`, not "400 validation_error"** (section 7, item 1): the contract wins; `docs/API.md`
   rows, statuses and codes are unchanged (the only API.md edits are the `validation_failed` description and one
   implementation note).
2. **Validator-route prose** (P10, ADR 0013, section 7, item 2): the 58 former `zValidator` routes and
   `POST …/modules/:moduleId` now send the catalog message in the negotiated locale and `i18n`; the boot check of
   9.4 shows it on `POST /api/households` (`Name fehlt`, `server.zod.field.name.too_small.1`). A form's server-side
   422 therefore shows catalog prose under the same field.
3. **P7** (section 7, item 3, 33 pinned ids, listed in 9.3). Form consequence (P10/P7, section 7, item 6, ADR 0013
   (ii)): a struct-level error is not shown while a field of that struct fails; in `CardFormDialog` an invalid
   `label` hides the card-value error until the label is fixed. `ok` never changes. P7 was widened by measurement
   in E1-T02 (Zod also runs string and array length checks after any issue, even after the value's own
   `invalid_type`), which is why the finance and core maps carry the `#type-[]` and array-length entries.
4. **`env.ts` generic failure lines** use Effect's Standard Schema formatter text (P11, section 7, item 4); the
   spelled-out messages and the line format are unchanged.
5. **Trailer** is the harness's `Co-Authored-By` line (section 7, item 5).
6. **P21: one vocabulary fix, no finance-local construct** (section 7, item 7 did not occur). E1-T09 found no gap
   and bridged nothing in `packages/shared/src/modules/finance/schemas/common.ts`. E1-T10 fixed one in
   `packages/shared/src/core/schemas/checks.ts`: Zod's `.default([])` over items that transform or carry checks is
   `Schema.withDecodingDefaultType`, not `withDecodingDefault` (which validates the encoded side first and hides
   every item check behind one `invalid_type`); documented in the `checks.ts` header and pinned by a new
   `primitives.json` case (`z.object({ tags: z.array(z.string().trim().min(1).max(60)).max(30).default([]) })`).
7. **E1-T08**: `ApiError` keeps `details?: unknown` (`Types.DeepMutable<unknown>` is `{}`, which refuses the `null`
   `apps/api/src/lib/errors.ts` passes); `packages/shared/test/schema-golden-coverage.test.ts` also accepts
   `typeof "function"` exports (Effect schemas are functions), and pins 217 schemas after E1-T07 moved the two
   shopping query schemas (P12) into `@toon/shared` (215 before). `InvitePanel.tsx`'s `InviteFormSchema` is a
   `Schema.Struct` with `withDecodingDefault`.
8. **Corpus size**: the golden corpus is 11339 cases in 18 files plus `primitives.json` (the plan estimated "over
   1000"); E1-T01's fix round added the `NaN` / `Infinity` / `-Infinity` markers to every number leaf.
9. **Pass count**: 14504 against the floor of 2463, because every golden case is a `test` (11357 in the three
   parity files); the plan's "pass count not below 2463" holds with a wide margin. `CLAUDE.md` Status records both.
10. **Docs written by this task**: `CLAUDE.md` (Fixed decisions: ADR 0013; Layout; Status; the new gotcha "Validation
    details come from the wire-issue vocabulary (E1, ADR 0013)"; the idioms paragraph says rule (9)),
    `docs/API.md` (the `validation_failed` row text and the `cards.ts` implementation note; no route row, status or
    code), `docs/modules/recipe.md` (section 1.3 and the R32 status), `agent-patterns/effect-schema.md` (section 7
    "As built (E1)"). The R32 gotcha is kept in substance (the cards router still lets the adapter keep `i18n`).
11. **Left for later milestones** (section 8, unchanged): `AppConfig` (E2), tagged `ApiError` and `Effect.catchTag`
    at the boundary (E2), the web `HttpClient` decoding responses (E6), `HttpApi` replacing `hono/validator` (E7),
    the web bundle budget (E6; E1 added +3168 bytes gzipped).
