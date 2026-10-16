/**
 * The golden-corpus wire format (docs/plans/e1-shared-schema.md P2), written
 * independently of `support/schema.ts` (E1-T02) so neither file is the other's
 * oracle. Deleted in E1-T11 with the rest of the zod generators.
 *
 *   - `undefined` anywhere in an input or output is `{ "$undefined": true }`
 *     (a key present with `undefined` survives, a missing key stays missing);
 *   - a non-finite number is `{ "$number": "NaN" | "Infinity" | "-Infinity" }`.
 *
 * `flatIssue` keeps exactly the fields P2 lists and nothing else.
 */

export interface FlatIssue {
  code: string;
  path: Array<string | number>;
  origin?: string;
  expected?: string;
  format?: string;
  minimum?: number;
  maximum?: number;
  params?: { i18n: string };
}

/** The `JSON.stringify` replacer: markers for `undefined`, `NaN`, `±Infinity`. */
export function goldenReplacer(_key: string, value: unknown): unknown {
  if (value === undefined) return { $undefined: true };
  if (typeof value === "number") {
    if (Number.isNaN(value)) return { $number: "NaN" };
    if (value === Number.POSITIVE_INFINITY) return { $number: "Infinity" };
    if (value === Number.NEGATIVE_INFINITY) return { $number: "-Infinity" };
    // JSON writes -0 as 0 and the sign would be lost silently.
    if (Object.is(value, -0)) throw new Error("golden: negative zero cannot be recorded");
  }
  return value;
}

/** The inverse of `goldenReplacer`, for readers of the committed files. */
export function goldenReviver(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] === "$undefined") return undefined;
    if (keys.length === 1 && keys[0] === "$number") {
      const text = (value as { $number: string }).$number;
      if (text === "NaN") return Number.NaN;
      if (text === "Infinity") return Number.POSITIVE_INFINITY;
      if (text === "-Infinity") return Number.NEGATIVE_INFINITY;
    }
  }
  return value;
}

/** One zod issue reduced to the P2 FlatIssue fields, in a fixed key order. */
export function flatIssue(issue: {
  code: string;
  path: ReadonlyArray<PropertyKey>;
  [key: string]: unknown;
}): FlatIssue {
  const flat: FlatIssue = {
    code: issue.code,
    path: issue.path.map((segment) => (typeof segment === "number" ? segment : String(segment))),
  };
  if ((issue.code === "too_small" || issue.code === "too_big") && typeof issue.origin === "string") {
    flat.origin = issue.origin;
  }
  if (issue.code === "invalid_type" && typeof issue.expected === "string") flat.expected = issue.expected;
  if (issue.code === "invalid_format" && typeof issue.format === "string") flat.format = issue.format;
  if (issue.code === "too_small" && issue.minimum !== undefined) flat.minimum = Number(issue.minimum);
  if (issue.code === "too_big" && issue.maximum !== undefined) flat.maximum = Number(issue.maximum);
  const params = issue.params as { i18n?: unknown } | undefined;
  if (issue.code === "custom" && params !== undefined && typeof params.i18n === "string") {
    flat.params = { i18n: params.i18n };
  }
  return flat;
}

interface GoldenFile {
  source: string;
  zod: string;
  cases: ReadonlyArray<object>;
}

/**
 * Stable text of a golden file: the file, the `cases` array and every case are
 * laid out with a 2-space indent, one key per line; the value of a case key
 * (`input`, `output`, `issues`, `details`) is compact JSON on that line, which
 * keeps a 10 000-case corpus reviewable by line and a third of the size.
 */
export function stringifyGolden(file: GoldenFile): string {
  const body = file.cases
    .map((entry) => {
      const lines = Object.entries(entry).map(([key, value]) => `      ${JSON.stringify(key)}: ${JSON.stringify(value, goldenReplacer)}`);
      return `    {\n${lines.join(",\n")}\n    }`;
    })
    .join(",\n");
  return `{\n  "source": ${JSON.stringify(file.source)},\n  "zod": ${JSON.stringify(file.zod)},\n  "cases": [\n${body}\n  ]\n}\n`;
}
