/**
 * Test support for the Effect schemas (plan e1 P1, P2, P7, P14). Zod-free (P20).
 *
 * - `safeParse` / `parse`: the call shapes a flipped test uses in place of `XSchema.safeParse(v)` /
 *   `XSchema.parse(v)`, decoding with `ALL_ISSUES` like the API and the web forms do.
 * - `goldenReplacer` / `goldenReviver`: the P2 markers for values JSON cannot hold (`undefined`, `NaN`,
 *   `±Infinity`).
 * - `runGolden`: one `bun:test` per golden case, comparing the Effect schema with the zod oracle.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { Predicate, Result, Schema, type SchemaIssue, type Types } from "effect";
import { ALL_ISSUES } from "../../src/core/schemas/checks.ts";
import { flattenIssue, toValidationIssues, type FlatIssue } from "../../src/core/i18n/issues.ts";

/** An Effect schema the tests can decode with: no decoding services. */
export type Decodable = Schema.Decoder<unknown, never>;

/** What a decode returns, mutable like zod's output (plan e1 P5). */
export type Decoded<S extends Decodable> = Types.DeepMutable<S["Type"]>;

export type SafeParseResult<S extends Decodable> =
  | { readonly success: true; readonly data: Decoded<S> }
  | { readonly success: false; readonly error: { readonly issues: Array<FlatIssue>; readonly issue: SchemaIssue.Issue } };

/** zod's `schema.safeParse(input)`, on an Effect schema: every issue, flattened, plus the raw tree. */
export function safeParse<S extends Decodable>(schema: S, input: unknown): SafeParseResult<S> {
  const result = Schema.decodeUnknownResult(schema, ALL_ISSUES)(input);
  if (Result.isSuccess(result)) return { success: true, data: result.success as Decoded<S> };
  return { success: false, error: { issues: flattenIssue(result.failure.issue), issue: result.failure.issue } };
}

/** zod's `schema.parse(input)`, on an Effect schema: throws the `Schema.SchemaError`. */
export function parse<S extends Decodable>(schema: S, input: unknown): Decoded<S> {
  return Schema.decodeUnknownSync(schema, ALL_ISSUES)(input) as Decoded<S>;
}

// ---------------------------------------------------------------------------------------------------------------
// The P2 markers
// ---------------------------------------------------------------------------------------------------------------

const UNDEFINED_MARKER = "$undefined";
const NUMBER_MARKER = "$number";

/**
 * `JSON.stringify` replacer: `undefined` anywhere becomes `{"$undefined": true}` (so a key present with
 * `undefined` survives), `NaN` / `Infinity` / `-Infinity` become `{"$number": "NaN" | "Infinity" | "-Infinity"}`.
 */
export function goldenReplacer(_key: string, value: unknown): unknown {
  if (value === undefined) return { [UNDEFINED_MARKER]: true };
  if (Predicate.isNumber(value) && !Number.isFinite(value)) return { [NUMBER_MARKER]: String(value) };
  return value;
}

function isUndefinedMarker(value: unknown): boolean {
  return Predicate.isObject(value) && Object.keys(value).length === 1 && (value as Record<string, unknown>)[UNDEFINED_MARKER] === true;
}

function numberMarker(value: unknown): number | undefined {
  if (!Predicate.isObject(value) || Object.keys(value).length !== 1) return undefined;
  const text = (value as Record<string, unknown>)[NUMBER_MARKER];
  return text === "NaN" || text === "Infinity" || text === "-Infinity" ? Number(text) : undefined;
}

/**
 * `JSON.parse` reviver, the inverse of `goldenReplacer`. A reviver that returns `undefined` DELETES the key, so an
 * `$undefined` marker is replaced by its container (the key stays, holding `undefined`); a top-level marker is
 * `undefined` itself.
 */
export function goldenReviver(key: string, value: unknown): unknown {
  const number = numberMarker(value);
  if (number !== undefined) return number;
  if (key === "" && isUndefinedMarker(value)) return undefined;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) if (isUndefinedMarker(value[index])) value[index] = undefined;
  } else if (Predicate.isObject(value) && !isUndefinedMarker(value)) {
    const record = value as Record<string, unknown>;
    for (const name of Object.keys(record)) if (isUndefinedMarker(record[name])) record[name] = undefined;
  }
  return value;
}

// ---------------------------------------------------------------------------------------------------------------
// runGolden
// ---------------------------------------------------------------------------------------------------------------

type ValidationDetails = ReturnType<typeof toValidationIssues>;

export interface GoldenCase {
  readonly id: string;
  readonly schema: string;
  readonly input: unknown;
  readonly ok: boolean;
  readonly output?: unknown;
  readonly issues?: Array<FlatIssue>;
  readonly details?: { readonly de: ValidationDetails; readonly en: ValidationDetails };
}

export interface GoldenFile {
  readonly source: string;
  readonly zod: string;
  readonly cases: ReadonlyArray<GoldenCase>;
}

const GOLDEN_DIR = join(import.meta.dir, "..", "fixtures", "schema-golden");

/** Reads a golden file (a name under `test/fixtures/schema-golden/`, or an absolute path) with the P2 markers revived. */
export function readGolden(file: string): GoldenFile {
  const path = isAbsolute(file) ? file : join(GOLDEN_DIR, file);
  return JSON.parse(readFileSync(path, "utf8"), goldenReviver) as GoldenFile;
}

/**
 * The issues of a check Effect does not run where zod does (plan e1 P7): Effect runs a schema's checks only after
 * its own type check and all its children passed; zod also runs a refinement (`custom`) after a continuable issue
 * and a length check (`too_small` / `too_big` with origin `string` or `array`) after any issue, even after the
 * value's own `invalid_type` when the value has a `length` (an array given to a string schema).
 */
function isSkippedCheckIssue(issue: FlatIssue): boolean {
  return (
    issue.code === "custom" ||
    ((issue.code === "too_small" || issue.code === "too_big") && (issue.origin === "array" || issue.origin === "string"))
  );
}

/**
 * The indices of `zodIssues` that `effectIssues` keeps, when `effectIssues` is `zodIssues` minus some
 * skipped-check issues, in order; `undefined` otherwise.
 */
function keptIndices(zodIssues: ReadonlyArray<FlatIssue>, effectIssues: ReadonlyArray<FlatIssue>): Array<number> | undefined {
  const kept: Array<number> = [];
  let next = 0;
  for (let index = 0; index < zodIssues.length; index += 1) {
    const zodIssue = zodIssues[index]!;
    if (next < effectIssues.length && Bun.deepEquals(zodIssue, effectIssues[next], true)) {
      kept.push(index);
      next += 1;
    } else if (!isSkippedCheckIssue(zodIssue)) {
      return undefined;
    }
  }
  return next === effectIssues.length ? kept : undefined;
}

/**
 * One `test` per case of a golden file (plan e1 P1): the Effect schema named by the case (looked up in
 * `schemas`) decodes `input` with `ALL_ISSUES` and must give the same `ok`; when ok, a deep-equal `output`
 * (`toStrictEqual`: a key holding `undefined` must be present); when not ok, the same flattened `issues` and the
 * same `details` in German and English. A case listed in `p7Allow` (id to reason) may instead miss some
 * skipped-check issues (P7, `isSkippedCheckIssue`), must still agree on `details[0]`, and fails when it does not
 * diverge.
 */
export function runGolden(
  file: string,
  schemas: Readonly<Record<string, Decodable>>,
  p7Allow: Readonly<Record<string, string>> = {},
): void {
  const golden = readGolden(file);
  describe(`golden parity: ${file}`, () => {
    test("every case names a mapped schema, every P7 entry names a case", () => {
      const missing = [...new Set(golden.cases.map((entry) => entry.schema))].filter((name) => !(name in schemas));
      expect(missing).toEqual([]);
      const ids = new Set(golden.cases.map((entry) => entry.id));
      expect(Object.keys(p7Allow).filter((id) => !ids.has(id))).toEqual([]);
    });

    for (const entry of golden.cases) {
      test(entry.id, () => {
        const schema = schemas[entry.schema];
        expect(schema).toBeDefined();
        const result = safeParse(schema!, entry.input);
        expect(result.success).toBe(entry.ok);
        if (result.success) {
          expect(result.data).toStrictEqual(entry.output as never);
          expect(entry.id in p7Allow).toBe(false);
          return;
        }
        const zodIssues = entry.issues ?? [];
        const de = toValidationIssues(result.error.issue, "de");
        const en = toValidationIssues(result.error.issue, "en");
        if (!(entry.id in p7Allow)) {
          expect(result.error.issues).toEqual(zodIssues);
          expect(de).toEqual(entry.details?.de ?? []);
          expect(en).toEqual(entry.details?.en ?? []);
          return;
        }
        // P7: a listed case must diverge, and only by missing skipped-check issues.
        const kept = keptIndices(zodIssues, result.error.issues);
        expect({ id: entry.id, divergesOnlyBySkippedChecks: kept !== undefined }).toEqual({
          id: entry.id,
          divergesOnlyBySkippedChecks: true,
        });
        expect(kept!.length).toBeLessThan(zodIssues.length);
        expect(de).toEqual(kept!.map((index) => entry.details!.de[index]!));
        expect(en).toEqual(kept!.map((index) => entry.details!.en[index]!));
        expect(de[0]).toEqual(entry.details!.de[0]!);
      });
    }
  });
}
