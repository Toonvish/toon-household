/**
 * E1-T10 (plan e1 P1, P7): the recipe schemas (`src/modules/recipe/schemas/{card,import,plan,recipe,shopping}.ts`)
 * against the zod oracle in `fixtures/schema-golden/recipe.*.json`. Zod-free (P20).
 */
import { Schema } from "effect";
import * as card from "../../src/modules/recipe/schemas/card.ts";
import * as imports from "../../src/modules/recipe/schemas/import.ts";
import * as plan from "../../src/modules/recipe/schemas/plan.ts";
import * as recipe from "../../src/modules/recipe/schemas/recipe.ts";
import * as shopping from "../../src/modules/recipe/schemas/shopping.ts";
import { runGolden, type Decodable } from "../support/schema.ts";

/** The exported schemas of a module namespace, by export name (functions and constants left out). */
function schemasOf(namespace: Readonly<Record<string, unknown>>): Record<string, Decodable> {
  const schemas: Record<string, Decodable> = {};
  for (const [name, value] of Object.entries(namespace)) {
    if (Schema.isSchema(value)) schemas[name] = value as Decodable;
  }
  return schemas;
}

/**
 * P7, per golden file (a listed id must name a case of that file and must diverge): zod runs an object-level
 * refinement after a continuable field issue (`too_small`, `custom`); Effect runs a struct's checks only on a
 * struct whose fields decoded, so the trailing struct-level `custom` issue is missing. `ok` and `details[0]` agree.
 */
const STRUCT_CHECK_AFTER_FIELD = "zod runs the object-level refinement after a field issue (plan e1 P7)";

const P7_CARD: Record<string, string> = {
  // `server.card.formatAndValue` after `value` / `label` too short.
  "UpdateCardRequestSchema#value-only-bad": STRUCT_CHECK_AFTER_FIELD,
  "UpdateCardRequestSchema#label-and-bad-pair": STRUCT_CHECK_AFTER_FIELD,
};

const P7_PLAN: Record<string, string> = {
  // `server.plan.rangeInvalid` / `server.plan.rangeTooLong` after a `server.plan.invalidDate` field issue.
  "MealPlanRangeQuerySchema#range-to-bad": STRUCT_CHECK_AFTER_FIELD,
  "MealPlanRangeQuerySchema#range-both-bad": STRUCT_CHECK_AFTER_FIELD,
  "MealPlanRangeQuerySchema#range-both-bad-reversed": STRUCT_CHECK_AFTER_FIELD,
  "MealPlanRangeQuerySchema#range-from-empty": STRUCT_CHECK_AFTER_FIELD,
  "MealPlanRangeQuerySchema#from=empty": STRUCT_CHECK_AFTER_FIELD,
  "MealPlanRangeQuerySchema#from=blank": STRUCT_CHECK_AFTER_FIELD,
  "MealPlanRangeQuerySchema#to=empty": STRUCT_CHECK_AFTER_FIELD,
  "MealPlanRangeQuerySchema#to=blank": STRUCT_CHECK_AFTER_FIELD,
  "MealPlanRangeQuerySchema#to=padded": STRUCT_CHECK_AFTER_FIELD,
};

runGolden("recipe.card.json", schemasOf(card), P7_CARD);
runGolden("recipe.import.json", schemasOf(imports));
runGolden("recipe.plan.json", schemasOf(plan), P7_PLAN);
runGolden("recipe.recipe.json", schemasOf(recipe));
runGolden("recipe.shopping.json", schemasOf(shopping));
