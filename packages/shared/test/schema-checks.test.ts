import { describe, expect, test } from "bun:test";
import { Effect, Predicate, Schema, SchemaTransformation } from "effect";
import * as checks from "../src/core/schemas/checks.ts";
import {
  ALL_ISSUES,
  Bool,
  CoercedInt,
  CoercedNum,
  Email,
  Enum,
  Int,
  IsoDateTime,
  Lit,
  Num,
  OneOf,
  Str,
  UnknownRecord,
  Url,
  Uuid,
  itemsExactly,
  keyed,
  keyedIssue,
  lowercase,
  max,
  maxItems,
  maxLength,
  min,
  minItems,
  minLength,
  nonnegative,
  partial,
  positive,
  regex,
  trim,
  wireIssue,
} from "../src/core/schemas/checks.ts";
import { flattenIssue } from "../src/core/i18n/issues.ts";
import { runGolden, safeParse, type Decodable } from "./support/schema.ts";

// E1-T02 (plan e1 P4, P5, P7): the vocabulary against the zod oracle in fixtures/schema-golden/primitives.json
// (written by primitives.build.ts with zod 4.5.4). This file imports no zod (P20).

const noControlChars = (value: string) => /^[^\p{Cc}]*$/u.test(value);
const BOOLEAN_QUERY_VALUES: Record<string, boolean> = { true: true, "1": true, false: false, "0": false };

/** `z.union([z.boolean(), z.string()]).transform(…)`: a fallible transformation reporting a bare `custom`. */
const BooleanQuery = OneOf([Bool, Str]).pipe(
  Schema.decodeTo(
    Bool,
    SchemaTransformation.transformEffect<boolean, boolean | string>({
      decode: (value) => {
        if (Predicate.isBoolean(value)) return Effect.succeed(value);
        const normalized = BOOLEAN_QUERY_VALUES[value.toLowerCase()];
        return normalized === undefined ? Effect.fail(wireIssue({ code: "custom" })) : Effect.succeed(normalized);
      },
      encode: (value) => Effect.succeed(value),
    }),
  ),
);

/** `.catchall(z.boolean())`: the rest record covers only the keys the struct does not declare. */
const catchallDeclared = new Set(["s", "o"]);
const CatchallStruct = Schema.StructWithRest(Schema.Struct({ s: Str, o: Schema.optional(Bool) }), [
  Schema.Record(
    Str.check(Schema.makeFilter((key: string) => !catchallDeclared.has(key))),
    Bool,
  ),
]);

const PeriodRange = Schema.Struct({ from: Str, to: Str }).check(
  Schema.makeFilter((value: { readonly from: string; readonly to: string }) => {
    const issues: Array<Schema.FilterIssue> = [];
    if (value.from > value.to) issues.push(keyedIssue("server.validation.periodRange", ["to"]));
    if (value.from === "") issues.push(keyedIssue("server.validation.periodFormat", ["from"]));
    return issues;
  }),
);

const NameBase = Schema.Struct({ name: Str.check(minLength(1)) });
const NameAndTags = Schema.Struct({
  name: Str.check(minLength(1)),
  tags: Schema.Array(Str).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});

const VOCABULARY: Record<string, Decodable> = {
  "z.string()": Str,
  "z.string().trim().min(1).max(80)": Str.pipe(trim).check(minLength(1), maxLength(80)),
  "z.string().min(8).max(200)": Str.check(minLength(8), maxLength(200)),
  "z.string().max(254).trim().toLowerCase().pipe(z.email())": Str.check(maxLength(254)).pipe(
    trim,
    lowercase,
    Schema.decodeTo(Email),
  ),
  "z.uuid()": Uuid,
  "z.iso.datetime({ offset: true })": IsoDateTime,
  "z.url().max(2000)": Url.check(maxLength(2000)),
  "z.number()": Num,
  "z.number().int()": Int,
  "z.number().int().min(1).max(100)": Int.check(min(1), max(100)),
  "z.number().positive()": Num.check(positive()),
  "z.number().nonnegative()": Num.check(nonnegative()),
  "z.number().int().nonnegative()": Int.check(nonnegative()),
  "z.number().int().positive()": Int.check(positive()),
  "z.coerce.number()": CoercedNum,
  "z.coerce.number().int()": CoercedInt,
  "z.coerce.number().int().min(1).max(100).default(24)": CoercedInt.check(min(1), max(100)).pipe(
    Schema.withDecodingDefault(Effect.succeed(24)),
  ),
  "z.object({ limit: z.coerce.number().int().min(1).max(100).default(24), offset: z.coerce.number().int().min(0).default(0) })":
    Schema.Struct({
      limit: CoercedInt.check(min(1), max(100)).pipe(Schema.withDecodingDefault(Effect.succeed(24))),
      offset: CoercedInt.check(min(0)).pipe(Schema.withDecodingDefault(Effect.succeed(0))),
    }),
  "z.boolean()": Bool,
  'z.enum(["admin", "member"])': Enum(["admin", "member"]),
  "z.literal(true)": Lit(true),
  "z.union([z.literal(1), z.literal(2)])": OneOf([Lit(1), Lit(2)]),
  "z.union([z.boolean(), z.string()]).transform(…)": BooleanQuery,
  "z.array(z.string()).min(1).max(3)": Schema.Array(Str).check(minItems(1), maxItems(3)),
  "z.array(z.string()).length(2)": Schema.Array(Str).check(itemsExactly(2)),
  "z.object({ tags: z.array(z.string()).default([]) })": Schema.Struct({
    tags: Schema.Array(Str).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  }),
  // E1-T10 (plan e1 P21): `withDecodingDefault` would validate the encoded side (`string[]`) first and hide the
  // item checks behind one `invalid_type`; the `Type` variant decodes every item, as zod's `.default([])` does.
  "z.object({ tags: z.array(z.string().trim().min(1).max(60)).max(30).default([]) })": Schema.Struct({
    tags: Schema.Array(Str.pipe(trim).check(minLength(1), maxLength(60)))
      .check(maxItems(30))
      .pipe(Schema.withDecodingDefaultType(Effect.sync(() => []))),
  }),
  "z.record(z.string(), z.unknown())": UnknownRecord,
  "z.record(z.string(), z.union([z.string(), z.number()]))": Schema.Record(Schema.String, OneOf([Str, Num])),
  "z.object({ s: z.string(), o: z.boolean().optional() }).catchall(z.boolean())": CatchallStruct,
  'z.object({ a: z.string().optional(), b: z.string().nullable(), c: z.string().nullish(), d: z.string().default("d"), n: z.number().nullish() })':
    Schema.Struct({
      a: Schema.optional(Str),
      b: Schema.NullOr(Str),
      c: Schema.optional(Schema.NullOr(Str)),
      d: Str.pipe(Schema.withDecodingDefault(Effect.succeed("d"))),
      n: Schema.optional(Schema.NullOr(Num)),
    }),
  "z.string().nullable()": Schema.NullOr(Str),
  'z.object({ title: z.string().optional(), name: z.string().optional() }).refine(…, refineKey("server.validation.noChanges"))':
    Schema.Struct({ title: Schema.optional(Str), name: Schema.optional(Str) }).check(
      keyed((value) => Boolean(value.title || value.name), "server.validation.noChanges"),
    ),
  'z.object({ format: z.string().optional(), value: z.string().optional() }).refine(…, { ...refineKey("server.validation.noChanges"), path: ["value"] })':
    Schema.Struct({ format: Schema.optional(Str), value: Schema.optional(Str) }).check(
      keyed((input) => (input.format === undefined) === (input.value === undefined), "server.validation.noChanges", {
        path: ["value"],
      }),
    ),
  'z.object({ from: z.string(), to: z.string() }).superRefine(… ctx.addIssue({ code: "custom", path: ["to"], ...refineKey("server.validation.periodRange") }))':
    PeriodRange,
  "z.object({ name: z.string().min(1) }).extend({ amountCents: z.number().int() })": Schema.Struct({
    ...NameBase.fields,
    amountCents: Int,
  }),
  "z.object({ name: z.string().min(1), tags: z.array(z.string()).default([]) }).partial()": partial(NameAndTags),
  "z.object({ title: z.string(), name: z.string() }).partial({ title: true })": partial(
    Schema.Struct({ title: Str, name: Str }),
    ["title"],
  ),
  'z.string().refine(…, refineKey("server.validation.periodFormat")).refine(…, refineKey("server.validation.periodBounds"))':
    Str.check(
      keyed((value: string) => /^\d{4}-\d{2}$/.test(value), "server.validation.periodFormat"),
      keyed((value: string) => value >= "2000-01" && value <= "2099-12", "server.validation.periodBounds"),
    ),
  'z.string().trim().min(1).max(80).refine(noControlChars, refineKey("server.validation.noControlChars"))': Str.pipe(
    trim,
  ).check(minLength(1), maxLength(80), keyed(noControlChars, "server.validation.noControlChars")),
  "z.string().regex(/^#[0-9a-fA-F]{6}$/)": Str.check(regex(/^#[0-9a-fA-F]{6}$/)),
  'z.object({ name: z.string().min(3), title: z.string() }).refine(() => false, refineKey("server.validation.noChanges"))':
    Schema.Struct({ name: Str.check(minLength(3)), title: Str }).check(keyed(() => false, "server.validation.noChanges")),
  'z.object({ inner: z.object({ name: z.string().min(3) }).refine(() => false, refineKey("server.validation.noChanges")), title: z.string() })':
    Schema.Struct({
      inner: Schema.Struct({ name: Str.check(minLength(3)) }).check(keyed(() => false, "server.validation.noChanges")),
      title: Str,
    }),
  "z.array(z.object({ name: z.string() })).max(1)": Schema.Array(Schema.Struct({ name: Str })).check(maxItems(1)),
};

/**
 * P7: Effect runs a schema's checks (a struct refinement, an array or string length) only when its type check and
 * every child passed; zod also runs a refinement after a continuable issue and a length check after any issue.
 * These already-rejected cases list fewer trailing issues; `ok` and the first issue are the same.
 */
const P7_ALLOW: Record<string, string> = {
  "z.string().trim().min(1).max(80)#array":
    "zod runs min(1) on the array after its invalid_type (too_small origin array); Effect stops at the type",
  "z.array(z.string()).min(1).max(3)#bad-items-and-too-many":
    "the array's max(3) does not run after its items failed (zod adds too_big origin array)",
  "z.array(z.string()).length(2)#bad-item-and-too-few":
    "the array's length(2) does not run after its item failed (zod adds too_small origin array)",
  'z.object({ name: z.string().min(3), title: z.string() }).refine(() => false, refineKey("server.validation.noChanges"))#continuable-field-issue':
    "the struct refinement does not run after a continuable field issue (zod adds the custom issue)",
  'z.object({ inner: z.object({ name: z.string().min(3) }).refine(() => false, refineKey("server.validation.noChanges")), title: z.string() })#inner-continuable-and-title':
    "the inner struct refinement does not run after its field's continuable issue (zod adds custom at inner)",
  "z.array(z.object({ name: z.string() })).max(1)#two-bad":
    "the array's max(1) does not run after its items failed (zod adds too_big origin array)",
};

runGolden("primitives.json", VOCABULARY, P7_ALLOW);

describe("the vocabulary's exports (plan e1 P4)", () => {
  test("checks.ts exports exactly the P4 vocabulary", () => {
    expect(Object.keys(checks).sort()).toEqual(
      [
        "WIRE_ISSUE",
        "ALL_ISSUES",
        "wireIssue",
        "Str",
        "Num",
        "Int",
        "Bool",
        "UnknownRecord",
        "Enum",
        "Lit",
        "OneOf",
        "CoercedNum",
        "CoercedInt",
        "Uuid",
        "Email",
        "IsoDateTime",
        "Url",
        "trim",
        "lowercase",
        "minLength",
        "maxLength",
        "regex",
        "min",
        "max",
        "positive",
        "nonnegative",
        "minItems",
        "maxItems",
        "itemsExactly",
        "keyed",
        "keyedIssue",
        "partial",
      ].sort(),
    );
  });

  test("no vocabulary export name ends in Schema (the golden coverage test reads *Schema exports)", () => {
    expect(Object.keys(checks).filter((name) => name.endsWith("Schema"))).toEqual([]);
  });

  test("ALL_ISSUES reports every issue, not the first", () => {
    expect(ALL_ISSUES).toEqual({ errors: "all" });
  });
});

describe("non-finite numbers (zod: invalid_type expected number, nothing else)", () => {
  const nonFinite = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
  const refusing: Record<string, Decodable> = { Num, Int, CoercedNum, CoercedInt };

  for (const [name, schema] of Object.entries(refusing)) {
    for (const value of nonFinite) {
      test(`${name} refuses ${value} with exactly one invalid_type expected number`, () => {
        const result = safeParse(schema, value);
        expect(result.success).toBe(false);
        expect(result.success ? [] : result.error.issues).toEqual([
          { code: "invalid_type", expected: "number", path: [] },
        ]);
      });
    }
  }

  test("the coerced schemas refuse the strings NaN, Infinity and -Infinity the same way", () => {
    for (const schema of [CoercedNum, CoercedInt]) {
      for (const value of ["NaN", "Infinity", "-Infinity"]) {
        const result = safeParse(schema, value);
        expect(result.success ? [] : result.error.issues).toEqual([
          { code: "invalid_type", expected: "number", path: [] },
        ]);
      }
    }
  });

  test("a bound after the number rule does not report on a non-finite value", () => {
    const result = safeParse(Int.check(min(1), max(100)), Number.NaN);
    expect(result.success ? [] : result.error.issues).toEqual([
      { code: "invalid_type", expected: "number", path: [] },
    ]);
  });

  test("Schema.Number alone would have accepted them (the reason Num exists)", () => {
    for (const value of nonFinite) {
      expect(Schema.decodeUnknownSync(Schema.Number)(value)).toBe(value);
    }
  });
});

describe("the issue adapter on vocabulary schemas", () => {
  test("a missing key reports the field type's issue at the key's path", () => {
    const schema = Schema.Struct({ role: Enum(["admin", "member"]), count: CoercedInt, name: Str });
    const result = Schema.decodeUnknownResult(schema, ALL_ISSUES)({});
    expect(result._tag).toBe("Failure");
    if (result._tag !== "Failure") return;
    expect(flattenIssue(result.failure.issue)).toEqual([
      { code: "invalid_value", path: ["role"] },
      { code: "invalid_type", expected: "number", path: ["count"] },
      { code: "invalid_type", expected: "string", path: ["name"] },
    ]);
  });

  test("keyed with a path reports the custom issue at that path", () => {
    const schema = Schema.Struct({ a: Schema.optional(Str) }).check(
      keyed(() => false, "server.validation.noChanges", { path: ["a"] }),
    );
    const result = safeParse(schema, {});
    expect(result.success ? [] : result.error.issues).toEqual([
      { code: "custom", path: ["a"], params: { i18n: "server.validation.noChanges" } },
    ]);
  });
});

describe("types stay zod-shaped and mutable (plan e1 P5)", () => {
  test("a DeepMutable output assigns to the hand-written zod-era shape", () => {
    const Request = Schema.Struct({
      name: Str.pipe(trim).check(minLength(1)),
      tags: Schema.Array(Str),
      note: Schema.optional(Schema.NullOr(Str)),
      nested: Schema.Struct({ items: Schema.Array(Schema.Struct({ id: Uuid })) }),
    });
    const result = safeParse(Request, { name: " x ", tags: ["a"], nested: { items: [] } });
    expect(result.success).toBe(true);
    if (!result.success) return;
    // Compile-time proof: the decoded value is assignable to the mutable shape zod's z.infer produced.
    const out: {
      name: string;
      tags: string[];
      note?: string | null | undefined;
      nested: { items: { id: string }[] };
    } = result.data;
    out.tags.push("b");
    out.nested.items.push({ id: "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e" });
    expect(out).toEqual({
      name: "x",
      tags: ["a", "b"],
      nested: { items: [{ id: "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e" }] },
    });
  });

  test("partial keeps the field types and makes the selected keys optional", () => {
    const result = safeParse(partial(NameAndTags), {});
    expect(result.success).toBe(true);
    if (!result.success) return;
    const out: { name?: string | undefined; tags: string[] } = result.data;
    expect(out).toEqual({ tags: [] });
  });
});
