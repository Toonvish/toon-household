/**
 * Generates the golden corpus (plan e1 P1, P2): runs every input table of
 * `cases/` against the CURRENT zod schemas of `@toon/shared` and records
 * `ok` / `output` / `issues` / `details` in `<area>.<file>.json` next to this
 * file.
 *
 *   bun packages/shared/test/fixtures/schema-golden/build.ts           write the files
 *   bun packages/shared/test/fixtures/schema-golden/build.ts --check   regenerate in memory, exit 1 on the first difference
 *   (`--only=<area.file>` limits either run to one file)
 *
 * `--check` is meaningful only while the shared schemas are still zod (before
 * E1-T08); after the flips the committed JSON is the oracle and the parity
 * tests read it. This generator, `serialize.ts` and `cases/` are deleted in
 * E1-T11 together with zod.
 *
 * Schemas are looked up BY NAME on the package entry (typed `Record<string,
 * unknown>`, cast to `z.ZodType` once, below), so this file keeps type-checking
 * when the shared schemas change type.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { z } from "zod";
import * as sharedModule from "../../../src/index.ts";
import { toValidationIssues } from "../../../src/core/i18n/issues.ts";
import type { Case } from "./cases/_lib.ts";
import { flatIssue, stringifyGolden, type FlatIssue } from "./serialize.ts";

const shared = sharedModule as Record<string, unknown>;
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "../../../../..");
const ZOD_VERSION = "4.5.4";

/** area.file -> the schema source the file covers (P1). */
export const FILES: ReadonlyArray<readonly [string, string]> = [
  ["core.common", "packages/shared/src/core/schemas/common.ts"],
  ["core.user", "packages/shared/src/core/schemas/user.ts"],
  ["core.household", "packages/shared/src/core/schemas/household.ts"],
  ["core.auth", "packages/shared/src/core/schemas/auth.ts"],
  ["core.registry", "packages/shared/src/modules/registry.ts"],
  ["finance.balance", "packages/shared/src/modules/finance/schemas/balance.ts"],
  ["finance.categories", "packages/shared/src/modules/finance/schemas/categories.ts"],
  ["finance.common", "packages/shared/src/modules/finance/schemas/common.ts"],
  ["finance.participants", "packages/shared/src/modules/finance/schemas/participants.ts"],
  ["finance.plan", "packages/shared/src/modules/finance/schemas/plan.ts"],
  ["finance.settlements", "packages/shared/src/modules/finance/schemas/settlements.ts"],
  ["finance.tags", "packages/shared/src/modules/finance/schemas/tags.ts"],
  ["finance.transactions", "packages/shared/src/modules/finance/schemas/transactions.ts"],
  ["recipe.card", "packages/shared/src/modules/recipe/schemas/card.ts"],
  ["recipe.import", "packages/shared/src/modules/recipe/schemas/import.ts"],
  ["recipe.plan", "packages/shared/src/modules/recipe/schemas/plan.ts"],
  ["recipe.recipe", "packages/shared/src/modules/recipe/schemas/recipe.ts"],
  ["recipe.shopping", "packages/shared/src/modules/recipe/schemas/shopping.ts"],
];

interface GoldenCase {
  id: string;
  schema: string;
  input: unknown;
  ok: boolean;
  output?: unknown;
  issues?: FlatIssue[];
  details?: { de: unknown[]; en: unknown[] };
}

function lookup(name: string, local: Record<string, unknown>): z.ZodType {
  const found = local[name] ?? shared[name];
  if (found === undefined) throw new Error(`golden: no schema named ${name}`);
  // the one place a shared schema is treated as a zod schema
  return found as z.ZodType;
}

function record(schema: z.ZodType, entry: Case): GoldenCase {
  const result = schema.safeParse(entry.input);
  if (result.success) {
    return { id: entry.id, schema: entry.schema, input: entry.input, ok: true, output: result.data };
  }
  return {
    id: entry.id,
    schema: entry.schema,
    input: entry.input,
    ok: false,
    issues: result.error.issues.map((issue) => flatIssue(issue as never)),
    details: {
      de: toValidationIssues(result.error, "de"),
      en: toValidationIssues(result.error, "en"),
    },
  };
}

async function build(name: string, source: string): Promise<string> {
  const module = (await import(`./cases/${name}.ts`)) as {
    cases: Case[];
    localSchemas?: Record<string, unknown>;
  };
  if (!existsSync(join(REPO, source))) throw new Error(`golden: source ${source} does not exist`);
  const local = module.localSchemas ?? {};
  const seen = new Set<string>();
  const cases = module.cases.map((entry) => {
    if (seen.has(entry.id)) throw new Error(`golden: duplicate case id ${entry.id} in ${name}`);
    seen.add(entry.id);
    return record(lookup(entry.schema, local), entry);
  });
  return stringifyGolden({ source, zod: ZOD_VERSION, cases });
}

async function main(): Promise<void> {
  const check = process.argv.includes("--check");
  const only = process.argv.find((argument) => argument.startsWith("--only="))?.slice("--only=".length);
  let total = 0;
  let files = 0;
  for (const [name, source] of FILES) {
    if (only !== undefined && only !== name) continue;
    const text = await build(name, source);
    const file = join(HERE, `${name}.json`);
    files += 1;
    total += (JSON.parse(text) as { cases: unknown[] }).cases.length;
    if (!check) {
      writeFileSync(file, text);
      continue;
    }
    const committed = existsSync(file) ? readFileSync(file, "utf8") : "";
    if (committed === text) continue;
    const next = JSON.parse(text) as { cases: GoldenCase[] };
    const before = committed === "" ? { cases: [] as GoldenCase[] } : (JSON.parse(committed) as { cases: GoldenCase[] });
    const index = next.cases.findIndex(
      (entry, position) => JSON.stringify(entry) !== JSON.stringify(before.cases[position]),
    );
    const first = next.cases[index] ?? before.cases[index];
    console.error(`[golden] ${name}.json differs from the regenerated corpus; first differing case: ${first?.id ?? "(count)"}`);
    process.exit(1);
  }
  console.log(`[golden] ${check ? "checked" : "wrote"} ${files} files, ${total} cases`);
}

await main();
