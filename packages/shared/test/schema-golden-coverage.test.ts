/**
 * Guards the golden corpus (docs/plans/e1-shared-schema.md P1, P2, P20): the 18
 * JSON files under `fixtures/schema-golden/` hold what zod 4.5.4 accepted and
 * rejected for every exported schema, and the parity tests of the later E1
 * tasks decode them with the Effect schemas. This file reads the JSON and the
 * package entry only: it imports no zod, so it keeps running after zod is gone.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as sharedModule from "../src/index.ts";

const shared = sharedModule as Record<string, unknown>;
const DIR = join(import.meta.dir, "fixtures/schema-golden");
const REPO = join(import.meta.dir, "../../..");

const FILES = [
  "core.common",
  "core.user",
  "core.household",
  "core.auth",
  "core.registry",
  "finance.balance",
  "finance.categories",
  "finance.common",
  "finance.participants",
  "finance.plan",
  "finance.settlements",
  "finance.tags",
  "finance.transactions",
  "recipe.card",
  "recipe.import",
  "recipe.plan",
  "recipe.recipe",
  "recipe.shopping",
] as const;

/** The two query schemas that move out of the shopping route in E1-T07 (P12). */
const ROUTE_LOCAL = ["ShoppingBoughtListQuerySchema", "ShoppingCatalogListQuerySchema"] as const;

/** Raw JSON as written: the `$undefined` / `$number` markers are still objects. */
type Raw = null | boolean | number | string | Raw[] | { [key: string]: Raw };

interface RawCase {
  id: string;
  schema: string;
  input: Raw;
  ok: boolean;
  output?: Raw;
  issues?: Array<Record<string, Raw>>;
  details?: { de: Array<Record<string, Raw>>; en: Array<Record<string, Raw>> };
  [key: string]: unknown;
}

interface RawFile {
  source: string;
  zod: string;
  cases: RawCase[];
}

const files = new Map<string, RawFile>();
for (const name of FILES) {
  files.set(name, JSON.parse(readFileSync(join(DIR, `${name}.json`), "utf8")) as RawFile);
}
const allCases = [...files.values()].flatMap((file) => file.cases);

const casesBySchema = new Map<string, RawCase[]>();
for (const entry of allCases) {
  const list = casesBySchema.get(entry.schema) ?? [];
  list.push(entry);
  casesBySchema.set(entry.schema, list);
}

/** Every export whose name ends in `Schema` and whose value is an object. */
const schemaExports = Object.keys(shared)
  .filter((name) => name.endsWith("Schema") && typeof shared[name] === "object" && shared[name] !== null)
  .sort();

const NUMBER_LEAVES = ["CentsSchema", "PositiveCentsSchema", "ConfidenceSchema", "MemberSlotSchema"] as const;
const OTHER_LEAVES = [
  "IdSchema",
  "IsoDateSchema",
  "HttpUrlSchema",
  "PasswordSchema",
  "EmailSchema",
  "DisplayNameSchema",
  "HouseholdNameSchema",
  "OpaqueTokenSchema",
  "PeriodSchema",
  "BooleanQuerySchema",
  "PlanDateSchema",
  "MutationIdSchema",
  "TagNameSchema",
  "CategoryLabelSchema",
  "TransactionDescriptionSchema",
  "FinanceDisplayNameSchema",
  "ServingsSchema",
] as const;
const ENUMS = [
  "HouseholdRoleSchema",
  "InvitableRoleSchema",
  "InviteStatusSchema",
  "OAuthProviderSchema",
  "ModuleIdSchema",
  "MailDeliverySchema",
  "BarcodeFormatSchema",
  "DifficultySchema",
  "TagKindSchema",
  "RecipeSortSchema",
  "ImportSourceTypeSchema",
  "ImportDraftStatusSchema",
  "ExtractionMethodSchema",
  "TxKindSchema",
  "SplitModeSchema",
  "TransactionOriginSchema",
  "DateSourceSchema",
  "TransactionSortSchema",
] as const;

const isRequestLike = (name: string): boolean => /Request|Query|Settings|Assignment/.test(name);
const needsBothOutcomes = [
  ...new Set([...schemaExports.filter(isRequestLike), ...ROUTE_LOCAL, ...NUMBER_LEAVES, ...OTHER_LEAVES, ...ENUMS]),
].sort();

const NON_FINITE = ["NaN", "Infinity", "-Infinity"] as const;
const marker = (kind: string): Raw => ({ $number: kind });

function isPlainObject(value: unknown): value is { [key: string]: Raw } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

describe("the golden files", () => {
  test("there are 18 files, each naming an existing source and zod 4.5.4", () => {
    expect(FILES).toHaveLength(18);
    for (const name of FILES) {
      const file = files.get(name);
      expect(file, name).toBeDefined();
      expect(file?.zod, name).toBe("4.5.4");
      expect(Object.keys(file ?? {}), name).toEqual(["source", "zod", "cases"]);
      expect(existsSync(join(REPO, file?.source ?? "missing")), `${name}: ${file?.source}`).toBe(true);
      expect(file?.cases.length, name).toBeGreaterThan(0);
    }
  });

  test("the corpus is large: well over 1000 cases", () => {
    expect(allCases.length).toBeGreaterThan(1000);
  });

  test("case ids are unique and name their schema", () => {
    const seen = new Set<string>();
    for (const [name, file] of files) {
      for (const entry of file.cases) {
        expect(entry.id.startsWith(`${entry.schema}#`), `${name}: ${entry.id}`).toBe(true);
        expect(seen.has(entry.id), `duplicate id ${entry.id}`).toBe(false);
        seen.add(entry.id);
      }
    }
  });

  test("every case has the P2 shape: ok, output iff ok, issues and details iff not ok", () => {
    for (const entry of allCases) {
      expect(Object.keys(entry)[0], entry.id).toBe("id");
      expect("input" in entry, entry.id).toBe(true);
      expect(typeof entry.ok, entry.id).toBe("boolean");
      if (entry.ok) {
        expect(Object.keys(entry), entry.id).toEqual(["id", "schema", "input", "ok", "output"]);
      } else {
        expect(Object.keys(entry), entry.id).toEqual(["id", "schema", "input", "ok", "issues", "details"]);
        expect(entry.issues?.length, entry.id).toBeGreaterThan(0);
        expect(entry.details?.de.length, entry.id).toBe(entry.issues?.length);
        expect(entry.details?.en.length, entry.id).toBe(entry.issues?.length);
      }
    }
  });

  test("a FlatIssue carries exactly the P2 fields and nothing else", () => {
    const ALLOWED = ["code", "path", "origin", "expected", "format", "minimum", "maximum", "params"];
    for (const entry of allCases) {
      for (const issue of entry.issues ?? []) {
        const keys = Object.keys(issue);
        expect(keys.slice(0, 2), entry.id).toEqual(["code", "path"]);
        for (const key of keys) expect(ALLOWED.includes(key), `${entry.id}: ${key}`).toBe(true);
        expect(typeof issue.code, entry.id).toBe("string");
        expect(Array.isArray(issue.path), entry.id).toBe(true);
        for (const segment of issue.path as Raw[]) expect(["string", "number"].includes(typeof segment), entry.id).toBe(true);
        const code = issue.code;
        if ("origin" in issue) expect(["too_small", "too_big"].includes(code as string), entry.id).toBe(true);
        if ("expected" in issue) expect(code, entry.id).toBe("invalid_type");
        if ("format" in issue) expect(code, entry.id).toBe("invalid_format");
        if ("minimum" in issue) expect(code, entry.id).toBe("too_small");
        if ("maximum" in issue) expect(code, entry.id).toBe("too_big");
        if ("params" in issue) {
          expect(code, entry.id).toBe("custom");
          expect(Object.keys(issue.params as object), entry.id).toEqual(["i18n"]);
          expect(typeof (issue.params as { i18n: Raw }).i18n, entry.id).toBe("string");
        }
        if (code === "invalid_type") expect("expected" in issue, entry.id).toBe(true);
        if (code === "invalid_format") expect("format" in issue, entry.id).toBe(true);
        if (code === "too_small") expect("minimum" in issue, entry.id).toBe(true);
        if (code === "too_big") expect("maximum" in issue, entry.id).toBe(true);
      }
    }
  });

  test("details are the toValidationIssues items of both locales, issue for issue", () => {
    for (const entry of allCases) {
      for (const locale of ["de", "en"] as const) {
        (entry.details?.[locale] ?? []).forEach((item, index) => {
          expect(Object.keys(item), entry.id).toEqual(["path", "code", "message", "i18n"]);
          expect(typeof item.path, entry.id).toBe("string");
          expect(item.code, entry.id).toBe(entry.issues?.[index]?.code);
          expect((item.path as string).split(".").filter((part) => part !== "").length, entry.id).toBe(
            (entry.issues?.[index]?.path as Raw[]).length,
          );
          expect(typeof item.message, entry.id).toBe("string");
          const i18n = item.i18n as { key: string; values: Record<string, Raw> };
          expect(typeof i18n.key, entry.id).toBe("string");
          expect(isPlainObject(i18n.values), entry.id).toBe(true);
        });
      }
    }
  });
});

describe("coverage of the exported schemas", () => {
  test("there are 217 exported schemas, in 17 source files", () => {
    expect(schemaExports).toHaveLength(217);
  });

  test("every exported *Schema appears as `schema` in some case", () => {
    const missing = schemaExports.filter((name) => !casesBySchema.has(name));
    expect(missing).toEqual([]);
  });

  test("every case names a shared export or one of the two route-local query schemas", () => {
    const unknown = [...casesBySchema.keys()].filter(
      (name) => !schemaExports.includes(name) && !(ROUTE_LOCAL as readonly string[]).includes(name),
    );
    expect(unknown).toEqual([]);
    for (const name of ROUTE_LOCAL) expect(files.get("recipe.shopping")?.cases.some((entry) => entry.schema === name), name).toBe(true);
  });

  test("each schema's cases sit in the file of the module that declares it", () => {
    for (const [name, file] of files) {
      const source = readFileSync(join(REPO, file.source), "utf8");
      for (const schema of new Set(file.cases.map((entry) => entry.schema))) {
        if ((ROUTE_LOCAL as readonly string[]).includes(schema)) continue;
        expect(source.includes(`export const ${schema} `) || source.includes(`export const ${schema}=`), `${name}: ${schema}`).toBe(true);
      }
    }
  });

  test("every request, query, settings, assignment, leaf and enum schema has an ok and a not-ok case", () => {
    for (const name of [...NUMBER_LEAVES, ...OTHER_LEAVES, ...ENUMS]) {
      expect(schemaExports.includes(name), `${name} is exported`).toBe(true);
    }
    for (const name of needsBothOutcomes) {
      const list = casesBySchema.get(name) ?? [];
      expect(list.some((entry) => entry.ok), `${name}: no ok:true case`).toBe(true);
      expect(list.some((entry) => !entry.ok), `${name}: no ok:false case`).toBe(true);
    }
  });

  test("every response and entity schema has an ok case and a not-ok case too", () => {
    for (const name of schemaExports) {
      const list = casesBySchema.get(name) ?? [];
      expect(list.some((entry) => entry.ok), `${name}: no ok:true case`).toBe(true);
      expect(list.some((entry) => !entry.ok), `${name}: no ok:false case`).toBe(true);
    }
  });

  test("every schema has at least five cases", () => {
    for (const name of schemaExports) expect(casesBySchema.get(name)?.length ?? 0, name).toBeGreaterThanOrEqual(5);
  });
});

describe("non-finite numbers (NaN, Infinity, -Infinity) are golden inputs", () => {
  test("every number leaf schema has all three as its root input", () => {
    for (const name of NUMBER_LEAVES) {
      const inputs = (casesBySchema.get(name) ?? []).map((entry) => JSON.stringify(entry.input));
      for (const kind of NON_FINITE) {
        expect(inputs.includes(JSON.stringify(marker(kind))), `${name}: ${kind}`).toBe(true);
      }
    }
  });

  test("the markers are exactly {$number}: NaN, Infinity, -Infinity and $undefined only", () => {
    const seen = new Set<string>();
    const visit = (value: Raw): void => {
      if (Array.isArray(value)) value.forEach(visit);
      else if (isPlainObject(value)) {
        const keys = Object.keys(value);
        if (keys.length === 1 && keys[0] === "$number") seen.add(String(value.$number));
        if (keys.length === 1 && keys[0] === "$undefined") expect(value.$undefined).toBe(true);
        Object.values(value).forEach(visit);
      }
    };
    for (const entry of allCases) {
      visit(entry.input);
      if ("output" in entry) visit(entry.output as Raw);
    }
    expect([...seen].sort()).toEqual([...NON_FINITE].sort());
  });

  test("every number field of every fixture has NaN, Infinity and -Infinity cases", () => {
    const missing: string[] = [];
    for (const name of schemaExports) {
      const list = casesBySchema.get(name) ?? [];
      const valid = list.find((entry) => entry.id === `${name}#valid`);
      if (valid === undefined || !isPlainObject(valid.input)) continue;
      const inputs = new Set(list.map((entry) => JSON.stringify(entry.input)));
      for (const [key, value] of Object.entries(valid.input)) {
        if (typeof value !== "number") continue;
        for (const kind of NON_FINITE) {
          const mutated = { ...valid.input, [key]: marker(kind) };
          if (!inputs.has(JSON.stringify(mutated))) missing.push(`${name}.${key} ${kind}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  test("the fixtures do have number fields to check (the previous test is not vacuous)", () => {
    let numeric = 0;
    for (const name of schemaExports) {
      const valid = (casesBySchema.get(name) ?? []).find((entry) => entry.id === `${name}#valid`);
      if (valid !== undefined && isPlainObject(valid.input)) {
        numeric += Object.values(valid.input).filter((value) => typeof value === "number").length;
      }
    }
    expect(numeric).toBeGreaterThan(50);
  });
});
