/**
 * Builds `primitives.json` (plan e1 P1, P2, E1-T02 step 5): every zod construct the shared schemas use, run with
 * zod 4.5.4 over a table of inputs, so `packages/shared/test/schema-checks.test.ts` can prove the vocabulary of
 * `packages/shared/src/core/schemas/checks.ts` accepts, rejects and reports the same. Each schema is labelled by
 * its zod source text. One of the generators that import zod; E1-T11 deletes it, the JSON stays.
 *
 *   bun packages/shared/test/fixtures/schema-golden/primitives.build.ts           # writes primitives.json
 *   bun packages/shared/test/fixtures/schema-golden/primitives.build.ts --check   # exits 1 if it differs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { $ZodIssue } from "zod/v4/core";
import { fromZodIssue, toValidationIssues } from "../../../src/core/i18n/issues.ts";
import { refineKey } from "../../../src/core/i18n/zod.ts";
import { goldenReplacer } from "../../support/schema.ts";

const OUT = join(import.meta.dir, "primitives.json");

type Inputs = ReadonlyArray<readonly [slug: string, input: unknown]>;

/** Wrong-type inputs every schema gets. */
const NOT_A_STRING: Inputs = [
  ["number", 1],
  ["null", null],
  ["undefined", undefined],
  ["array", []],
  ["object", {}],
  ["boolean", true],
];
const NON_FINITE: Inputs = [
  ["nan", Number.NaN],
  ["infinity", Number.POSITIVE_INFINITY],
  ["minus-infinity", Number.NEGATIVE_INFINITY],
];
const NOT_A_NUMBER: Inputs = [
  ["string", "1"],
  ["null", null],
  ["undefined", undefined],
  ["array", []],
  ["object", {}],
  ["boolean", false],
  ...NON_FINITE,
];
const NON_OBJECT_ROOTS: Inputs = [
  ["root-null", null],
  ["root-string", "x"],
  ["root-array", []],
  ["root-number", 1],
  ["root-undefined", undefined],
];
const COERCION_STRINGS: Inputs = [
  ["empty", ""],
  ["abc", "abc"],
  ["decimal", "1.5"],
  ["minus-decimal", "-0.5"],
  ["minus-one", "-1"],
  ["zero", "0"],
  ["twenty-four", "24"],
  ["padded", " 12 "],
  ["exponent", "1e2"],
  ["huge", "1e20"],
  ["string-nan", "NaN"],
  ["string-infinity", "Infinity"],
  ["string-minus-infinity", "-Infinity"],
  ["array-two", ["1", "2"]],
  ["array-one", ["5"]],
  ["array-empty", []],
  ["null", null],
  ["true", true],
  ["object", {}],
  ["number", 3],
  ["undefined", undefined],
  ...NON_FINITE,
];

const VALID_UUID = "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";

/** zod's version of a control-character refinement (`hasNoControlChars` in user.ts). */
const noControlChars = (value: string) => /^[^\p{Cc}]*$/u.test(value);

const BOOLEAN_QUERY_VALUES: Record<string, boolean> = { true: true, "1": true, false: false, "0": false };

const SPECS: ReadonlyArray<{ readonly label: string; readonly schema: z.ZodType; readonly inputs: Inputs }> = [
  {
    label: "z.string()",
    schema: z.string(),
    inputs: [["empty", ""], ["text", "abc"], ["emoji", "😀"], ...NOT_A_STRING],
  },
  {
    label: "z.string().trim().min(1).max(80)",
    schema: z.string().trim().min(1).max(80),
    inputs: [
      ["empty", ""],
      ["blank", "   "],
      ["padded", "  a  "],
      ["eighty", "x".repeat(80)],
      ["eighty-one", "x".repeat(81)],
      ["eighty-padded", ` ${"x".repeat(80)} `],
      ["emoji-eighty", "😀".repeat(80)],
      ["emoji-eighty-one", "😀".repeat(81)],
      ["lone-surrogates", "\ud83d".repeat(81)],
      ...NOT_A_STRING,
    ],
  },
  {
    label: "z.string().min(8).max(200)",
    schema: z.string().min(8).max(200),
    inputs: [
      ["seven", "1234567"],
      ["eight", "12345678"],
      ["two-hundred", "p".repeat(200)],
      ["two-hundred-one", "p".repeat(201)],
      ["four-emoji", "😀😀😀😀"],
      ["eight-emoji", "😀".repeat(8)],
      ["number", 12345678],
    ],
  },
  {
    label: "z.string().max(254).trim().toLowerCase().pipe(z.email())",
    schema: z.string().max(254).trim().toLowerCase().pipe(z.email()),
    inputs: [
      ["mixed-case-padded", " Foo@Bar.DE "],
      ["plain", "anna@example.org"],
      ["plus-tag", "anna+tag@example.org"],
      ["no-tld", "a@b"],
      ["double-dot", "a..b@c.de"],
      ["leading-dot", ".a@c.de"],
      ["space-inside", "an na@example.org"],
      ["empty", ""],
      ["blank", "   "],
      ["too-long", `${"x".repeat(250)}@b.de`],
      ["fits-after-trim-only", `   ${"x".repeat(246)}@b.de`],
      ["number", 1],
      ["null", null],
    ],
  },
  {
    label: "z.uuid()",
    schema: z.uuid(),
    inputs: [
      ["v4", VALID_UUID],
      ["v4-uppercase", VALID_UUID.toUpperCase()],
      ["v7", "01890a5d-ac96-774b-bcce-b302099a8057"],
      ["nil", "00000000-0000-0000-0000-000000000000"],
      ["max", "ffffffff-ffff-ffff-ffff-ffffffffffff"],
      ["version-zero", "3f2b8c1e-4d5a-0b6c-8d7e-9f0a1b2c3d4e"],
      ["version-nine", "3f2b8c1e-4d5a-9b6c-8d7e-9f0a1b2c3d4e"],
      ["variant-c", "3f2b8c1e-4d5a-4b6c-cd7e-9f0a1b2c3d4e"],
      ["short", "3f2b8c1e-4d5a-4b6c-8d7e"],
      ["braces", `{${VALID_UUID}}`],
      ["empty", ""],
      ["number", 1],
    ],
  },
  {
    label: "z.iso.datetime({ offset: true })",
    schema: z.iso.datetime({ offset: true }),
    inputs: [
      ["utc", "2026-10-16T12:00:00Z"],
      ["millis-offset", "2026-10-16T12:00:00.123+02:00"],
      ["negative-offset", "2026-10-16T12:00:00-05:30"],
      ["no-offset", "2026-10-16T12:00:00"],
      ["no-seconds", "2026-10-16T12:00Z"],
      ["date-only", "2026-10-16"],
      ["leap-day", "2024-02-29T00:00:00Z"],
      ["not-leap-day", "2023-02-29T00:00:00Z"],
      ["hour-24", "2026-10-16T24:00:00Z"],
      ["space-separator", "2026-10-16 12:00:00Z"],
      ["number", 5],
    ],
  },
  {
    label: "z.url().max(2000)",
    schema: z.url().max(2000),
    inputs: [
      ["https", "https://example.com/rezept?id=1"],
      ["ftp", "ftp://x"],
      ["mailto", "mailto:a@b.de"],
      ["javascript", "javascript:alert(1)"],
      ["scheme-only", "http://"],
      ["not-a-url", "not a url"],
      ["padded-with-tab", "  https://example.com/a\tb  "],
      ["too-long", `https://example.com/${"a".repeat(2000)}`],
      ["invalid-and-too-long", "x".repeat(2001)],
      ["empty", ""],
      ["number", 1],
    ],
  },
  {
    label: "z.number()",
    schema: z.number(),
    inputs: [["zero", 0], ["decimal", 1.5], ["negative", -1], ["max-value", Number.MAX_VALUE], ...NOT_A_NUMBER],
  },
  {
    label: "z.number().int()",
    schema: z.number().int(),
    inputs: [
      ["zero", 0],
      ["decimal", 1.5],
      ["minus-decimal", -0.5],
      ["max-safe", Number.MAX_SAFE_INTEGER],
      ["past-max-safe", Number.MAX_SAFE_INTEGER + 1],
      ["huge", 1e20],
      ["minus-huge", -1e20],
      ...NOT_A_NUMBER,
    ],
  },
  {
    label: "z.number().int().min(1).max(100)",
    schema: z.number().int().min(1).max(100),
    inputs: [
      ["zero", 0],
      ["one", 1],
      ["hundred", 100],
      ["hundred-one", 101],
      ["huge", 1e20],
      ["minus-huge", -1e20],
      ["decimal", 1.5],
      ...NON_FINITE,
    ],
  },
  {
    label: "z.number().positive()",
    schema: z.number().positive(),
    inputs: [["zero", 0], ["tiny", 0.1], ["negative", -1], ...NON_FINITE],
  },
  {
    label: "z.number().nonnegative()",
    schema: z.number().nonnegative(),
    inputs: [["zero", 0], ["just-below", -0.0001], ["five", 5], ...NON_FINITE],
  },
  {
    label: "z.number().int().nonnegative()",
    schema: z.number().int().nonnegative(),
    inputs: [["zero", 0], ["minus-one", -1], ["decimal", 1.5], ...NON_FINITE],
  },
  {
    label: "z.number().int().positive()",
    schema: z.number().int().positive(),
    inputs: [["zero", 0], ["one", 1], ["minus-decimal", -0.5], ...NON_FINITE],
  },
  {
    label: "z.coerce.number()",
    schema: z.coerce.number(),
    inputs: COERCION_STRINGS,
  },
  {
    label: "z.coerce.number().int()",
    schema: z.coerce.number().int(),
    inputs: COERCION_STRINGS,
  },
  {
    label: "z.coerce.number().int().min(1).max(100).default(24)",
    schema: z.coerce.number().int().min(1).max(100).default(24),
    inputs: [["hundred-one", "101"], ["fifty", 50], ...COERCION_STRINGS],
  },
  {
    label: "z.object({ limit: z.coerce.number().int().min(1).max(100).default(24), offset: z.coerce.number().int().min(0).default(0) })",
    schema: z.object({
      limit: z.coerce.number().int().min(1).max(100).default(24),
      offset: z.coerce.number().int().min(0).default(0),
    }),
    inputs: [
      ["empty", {}],
      ["undefined-values", { limit: undefined, offset: undefined }],
      ["strings", { limit: "10", offset: "20" }],
      ["bad-both", { limit: "abc", offset: "-1" }],
      ["non-finite", { limit: Number.NaN, offset: Number.POSITIVE_INFINITY }],
      ["string-non-finite", { limit: "Infinity", offset: "NaN" }],
      ["extra-key", { limit: "5", sort: "newest" }],
      ...NON_OBJECT_ROOTS,
    ],
  },
  {
    label: "z.boolean()",
    schema: z.boolean(),
    inputs: [["true", true], ["false", false], ["string-true", "true"], ["zero", 0], ["null", null], ["undefined", undefined]],
  },
  {
    label: 'z.enum(["admin", "member"])',
    schema: z.enum(["admin", "member"]),
    inputs: [
      ["admin", "admin"],
      ["member", "member"],
      ["case-variant", "Admin"],
      ["wrong", "owner"],
      ["number", 1],
      ["null", null],
      ["undefined", undefined],
    ],
  },
  {
    label: "z.literal(true)",
    schema: z.literal(true),
    inputs: [["true", true], ["false", false], ["string-true", "true"], ["one", 1], ["undefined", undefined]],
  },
  {
    label: "z.union([z.literal(1), z.literal(2)])",
    schema: z.union([z.literal(1), z.literal(2)]),
    inputs: [["one", 1], ["two", 2], ["three", 3], ["string-one", "1"], ["null", null], ...NON_FINITE],
  },
  {
    label: "z.union([z.boolean(), z.string()]).transform(…)",
    schema: z.union([z.boolean(), z.string()]).transform((value, ctx) => {
      if (typeof value === "boolean") return value;
      const normalized = BOOLEAN_QUERY_VALUES[value.toLowerCase()];
      if (normalized === undefined) {
        ctx.addIssue({ code: "custom", message: "invalid boolean" });
        return z.NEVER;
      }
      return normalized;
    }),
    inputs: [
      ["true", true],
      ["false", false],
      ["string-true", "true"],
      ["string-one", "1"],
      ["string-false", "false"],
      ["string-zero", "0"],
      ["upper", "TRUE"],
      ["yes", "yes"],
      ["empty", ""],
      ["number", 5],
      ["null", null],
      ["undefined", undefined],
    ],
  },
  {
    label: "z.array(z.string()).min(1).max(3)",
    schema: z.array(z.string()).min(1).max(3),
    inputs: [
      ["empty", []],
      ["one", ["a"]],
      ["three", ["a", "b", "c"]],
      ["four", ["a", "b", "c", "d"]],
      ["bad-item", ["a", 1]],
      ["bad-items-and-too-many", [1, 2, 3, 4]],
      ["string", "x"],
      ["null", null],
      ["object", {}],
      ["undefined", undefined],
    ],
  },
  {
    label: "z.array(z.string()).length(2)",
    schema: z.array(z.string()).length(2),
    inputs: [
      ["empty", []],
      ["one", ["a"]],
      ["two", ["a", "b"]],
      ["three", ["a", "b", "c"]],
      ["bad-item-and-too-few", [1]],
    ],
  },
  {
    label: "z.object({ tags: z.array(z.string()).default([]) })",
    schema: z.object({ tags: z.array(z.string()).default([]) }),
    inputs: [
      ["absent", {}],
      ["undefined", { tags: undefined }],
      ["one", { tags: ["a"] }],
      ["string", { tags: "a" }],
      ["null", { tags: null }],
    ],
  },
  {
    label: "z.record(z.string(), z.unknown())",
    schema: z.record(z.string(), z.unknown()),
    inputs: [
      ["empty", {}],
      ["values", { a: 1, b: "x", c: null }],
      ["undefined-value", { a: undefined }],
      ...NON_OBJECT_ROOTS,
    ],
  },
  {
    label: "z.record(z.string(), z.union([z.string(), z.number()]))",
    schema: z.record(z.string(), z.union([z.string(), z.number()])),
    inputs: [
      ["mixed", { a: "x", b: 1 }],
      ["boolean-value", { a: true }],
      ["null-value", { a: null, b: "ok", c: false }],
      ["nan-value", { a: Number.NaN }],
      ["array", []],
      ["null", null],
    ],
  },
  {
    label: "z.object({ s: z.string(), o: z.boolean().optional() }).catchall(z.boolean())",
    schema: z.object({ s: z.string(), o: z.boolean().optional() }).catchall(z.boolean()),
    inputs: [
      ["declared-only", { s: "x" }],
      ["optional-undefined", { s: "x", o: undefined }],
      ["extra-boolean", { s: "x", extra: true }],
      ["extra-number", { s: "x", extra: 1 }],
      ["bad-declared-and-extra", { s: 1, extra: 1 }],
      ...NON_OBJECT_ROOTS,
    ],
  },
  {
    label:
      'z.object({ a: z.string().optional(), b: z.string().nullable(), c: z.string().nullish(), d: z.string().default("d"), n: z.number().nullish() })',
    schema: z.object({
      a: z.string().optional(),
      b: z.string().nullable(),
      c: z.string().nullish(),
      d: z.string().default("d"),
      n: z.number().nullish(),
    }),
    inputs: [
      ["minimal", { b: null }],
      ["present-undefined", { a: undefined, b: "x", c: undefined, d: undefined, n: undefined }],
      ["nulls", { b: "x", c: null, n: null }],
      ["values", { a: "a", b: "b", c: "c", d: "e", n: 1 }],
      ["missing-required", {}],
      ["all-wrong", { a: 1, b: 1, c: 1, d: 1, n: "1" }],
      ["null-for-optional", { a: null, b: "x" }],
      ["non-finite", { b: "x", n: Number.NaN }],
      ["extra-key", { b: "x", extra: 1 }],
      ...NON_OBJECT_ROOTS,
    ],
  },
  {
    label: "z.string().nullable()",
    schema: z.string().nullable(),
    inputs: [["null", null], ["text", "x"], ["number", 1], ["undefined", undefined]],
  },
  {
    label: 'z.object({ title: z.string().optional(), name: z.string().optional() }).refine(…, refineKey("server.validation.noChanges"))',
    schema: z
      .object({ title: z.string().optional(), name: z.string().optional() })
      .refine((value) => Boolean(value.title || value.name), refineKey("server.validation.noChanges")),
    inputs: [
      ["empty", {}],
      ["title", { title: "x" }],
      ["wrong-type", { title: 1 }],
      ["empty-strings", { title: "", name: "" }],
    ],
  },
  {
    label: 'z.object({ format: z.string().optional(), value: z.string().optional() }).refine(…, { ...refineKey("server.validation.noChanges"), path: ["value"] })',
    schema: z
      .object({ format: z.string().optional(), value: z.string().optional() })
      .refine((input) => (input.format === undefined) === (input.value === undefined), {
        ...refineKey("server.validation.noChanges"),
        path: ["value"],
      }),
    inputs: [
      ["both", { format: "ean13", value: "1" }],
      ["neither", {}],
      ["format-only", { format: "ean13" }],
      ["value-wrong-type", { format: "ean13", value: 1 }],
    ],
  },
  {
    label: 'z.object({ from: z.string(), to: z.string() }).superRefine(… ctx.addIssue({ code: "custom", path: ["to"], ...refineKey("server.validation.periodRange") }))',
    schema: z.object({ from: z.string(), to: z.string() }).superRefine((value, ctx) => {
      if (value.from > value.to) {
        ctx.addIssue({ code: "custom", path: ["to"], ...refineKey("server.validation.periodRange") });
      }
      if (value.from === "") {
        ctx.addIssue({ code: "custom", path: ["from"], ...refineKey("server.validation.periodFormat") });
      }
    }),
    inputs: [
      ["ordered", { from: "2026-01", to: "2026-02" }],
      ["reversed", { from: "2026-02", to: "2026-01" }],
      ["empty-from", { from: "", to: "2026-01" }],
      ["reversed-and-empty-to", { from: "", to: "" }],
      ["wrong-type", { from: 1, to: "2026-01" }],
    ],
  },
  {
    label: "z.object({ name: z.string().min(1) }).extend({ amountCents: z.number().int() })",
    schema: z.object({ name: z.string().min(1) }).extend({ amountCents: z.number().int() }),
    inputs: [
      ["valid", { name: "x", amountCents: 100 }],
      ["missing-extension", { name: "x" }],
      ["missing-base", { amountCents: 1 }],
      ["decimal-cents", { name: "x", amountCents: 1.5 }],
      ["nan-cents", { name: "x", amountCents: Number.NaN }],
      ["empty-name", { name: "", amountCents: 1 }],
    ],
  },
  {
    label: "z.object({ name: z.string().min(1), tags: z.array(z.string()).default([]) }).partial()",
    schema: z.object({ name: z.string().min(1), tags: z.array(z.string()).default([]) }).partial(),
    inputs: [
      ["empty", {}],
      ["empty-name", { name: "" }],
      ["undefined-name", { name: undefined }],
      ["undefined-tags", { tags: undefined }],
      ["tags", { tags: ["a"] }],
      ["wrong-types", { name: 1, tags: "a" }],
    ],
  },
  {
    label: "z.object({ title: z.string(), name: z.string() }).partial({ title: true })",
    schema: z.object({ title: z.string(), name: z.string() }).partial({ title: true }),
    inputs: [
      ["name-only", { name: "x" }],
      ["empty", {}],
      ["title-only", { title: "x" }],
      ["undefined-title", { title: undefined, name: "x" }],
    ],
  },
  {
    label:
      'z.string().refine(…, refineKey("server.validation.periodFormat")).refine(…, refineKey("server.validation.periodBounds"))',
    schema: z
      .string()
      .refine((value) => /^\d{4}-\d{2}$/.test(value), refineKey("server.validation.periodFormat"))
      .refine((value) => value >= "2000-01" && value <= "2099-12", refineKey("server.validation.periodBounds")),
    inputs: [
      ["valid", "2026-10"],
      ["format-only", "2026-1"],
      ["bounds-only", "1999-12"],
      ["both", "1999"],
      ["number", 202610],
    ],
  },
  {
    label: 'z.string().trim().min(1).max(80).refine(noControlChars, refineKey("server.validation.noControlChars"))',
    schema: z.string().trim().min(1).max(80).refine(noControlChars, refineKey("server.validation.noControlChars")),
    inputs: [
      ["valid", " Anna "],
      ["newline", "An\nna"],
      ["blank", "   "],
      ["too-long-with-control", `${"x".repeat(81)}\u0007`],
      ["number", 1],
    ],
  },
  {
    label: "z.string().regex(/^#[0-9a-fA-F]{6}$/)",
    schema: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    inputs: [
      ["lower", "#aabbcc"],
      ["upper", "#AABBCC"],
      ["no-hash", "aabbcc"],
      ["short", "#abc"],
      ["number", 1],
    ],
  },
  {
    label: 'z.object({ name: z.string().min(3), title: z.string() }).refine(() => false, refineKey("server.validation.noChanges"))',
    schema: z
      .object({ name: z.string().min(3), title: z.string() })
      .refine(() => false, refineKey("server.validation.noChanges")),
    inputs: [
      ["fields-valid", { name: "abc", title: "t" }],
      ["continuable-field-issue", { name: "x", title: "t" }],
      ["type-field-issue", { name: 1, title: "t" }],
      ["two-field-issues", { name: "x", title: 1 }],
    ],
  },
  {
    label:
      'z.object({ inner: z.object({ name: z.string().min(3) }).refine(() => false, refineKey("server.validation.noChanges")), title: z.string() })',
    schema: z.object({
      inner: z.object({ name: z.string().min(3) }).refine(() => false, refineKey("server.validation.noChanges")),
      title: z.string(),
    }),
    inputs: [
      ["inner-continuable-and-title", { inner: { name: "x" }, title: 1 }],
      ["inner-valid-fields", { inner: { name: "abc" }, title: "t" }],
    ],
  },
  {
    label: "z.array(z.object({ name: z.string() })).max(1)",
    schema: z.array(z.object({ name: z.string() })).max(1),
    inputs: [
      ["one", [{ name: "a" }]],
      ["two", [{ name: "a" }, { name: "b" }]],
      ["two-bad", [{ name: 1 }, {}]],
    ],
  },
];

function toCase(label: string, schema: z.ZodType, slug: string, input: unknown): Record<string, unknown> {
  const result = schema.safeParse(input);
  const base = { id: `${label}#${slug}`, schema: label, input };
  if (result.success) return { ...base, ok: true, output: result.data };
  return {
    ...base,
    ok: false,
    issues: result.error.issues.map((issue) => fromZodIssue(issue as $ZodIssue)),
    details: { de: toValidationIssues(result.error, "de"), en: toValidationIssues(result.error, "en") },
  };
}

function build(): string {
  const cases = SPECS.flatMap((spec) => spec.inputs.map(([slug, input]) => toCase(spec.label, spec.schema, slug, input)));
  const ids = new Set<string>();
  for (const entry of cases) {
    const id = entry["id"] as string;
    if (ids.has(id)) throw new Error(`duplicate case id ${id}`);
    ids.add(id);
  }
  const file = { source: "packages/shared/src/core/schemas/checks.ts", zod: "4.5.4", cases };
  return `${JSON.stringify(file, goldenReplacer, 2)}\n`;
}

const text = build();
if (process.argv.includes("--check")) {
  const committed = readFileSync(OUT, "utf8");
  if (committed !== text) {
    console.error("primitives.json differs from what primitives.build.ts generates; rerun it without --check.");
    process.exit(1);
  }
  console.log("primitives.json is up to date.");
} else {
  writeFileSync(OUT, text);
  console.log(`wrote ${OUT}`);
}
