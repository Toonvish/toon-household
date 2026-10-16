/**
 * E1-T09 (plan e1 P1, P7): the finance schemas (`src/modules/finance/schemas/*.ts`) against the zod oracle in
 * `fixtures/schema-golden/finance.*.json`. Zod-free (P20).
 */
import { Schema } from "effect";
import * as balance from "../../src/modules/finance/schemas/balance.ts";
import * as categories from "../../src/modules/finance/schemas/categories.ts";
import * as common from "../../src/modules/finance/schemas/common.ts";
import * as participants from "../../src/modules/finance/schemas/participants.ts";
import * as plan from "../../src/modules/finance/schemas/plan.ts";
import * as settlements from "../../src/modules/finance/schemas/settlements.ts";
import * as tags from "../../src/modules/finance/schemas/tags.ts";
import * as transactions from "../../src/modules/finance/schemas/transactions.ts";
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
 * P7, per golden file (a listed id must name a case of that file and must diverge): zod also runs a string's
 * length check after the value's own `invalid_type` when the value has a `length` (an array given to a string
 * schema) and reports `too_small` with origin `array`; Effect runs a schema's checks only after its type check
 * passed, so that trailing issue is missing. `ok` and `details[0]` agree. A file without a map has no divergence.
 */
const LENGTH_AFTER_TYPE = "zod runs the string min-length check on an array input after invalid_type (plan e1 P7)";

/**
 * P7: zod also runs an array's `.length(2)` after an item (or the value's own type) failed and reports the
 * length issue; Effect runs an array's checks only when every item decoded, so the trailing length issue is
 * missing. `ok` and `details[0]` agree.
 */
const LENGTH_AFTER_ITEM = "zod runs the array length check after an item or type failure (plan e1 P7)";

const P7_CATEGORIES: Record<string, string> = {
  "CategoryLabelSchema#type-[]": LENGTH_AFTER_TYPE,
};
const P7_PARTICIPANTS: Record<string, string> = {
  "FinanceDisplayNameSchema#type-[]": LENGTH_AFTER_TYPE,
  "FinanceParticipantAssignmentSchema#one-bad": LENGTH_AFTER_ITEM,
  "FinanceParticipantAssignmentSchema#three-bad": LENGTH_AFTER_ITEM,
  "FinanceParticipantAssignmentSchema#root-string": LENGTH_AFTER_ITEM,
  "UpdateFinanceParticipantsRequestSchema#bad-and-length": LENGTH_AFTER_ITEM,
  "UpdateFinanceParticipantsRequestSchema#participants=str-x": LENGTH_AFTER_ITEM,
  "UpdateFinanceParticipantsRequestSchema#participants=with-null": LENGTH_AFTER_ITEM,
  "FinanceEnableSettingsSchema#participants=str-x": LENGTH_AFTER_ITEM,
  "FinanceEnableSettingsSchema#participants=with-null": LENGTH_AFTER_ITEM,
};
const P7_TAGS: Record<string, string> = {
  "TagNameSchema#type-[]": LENGTH_AFTER_TYPE,
};
const P7_TRANSACTIONS: Record<string, string> = {
  "TransactionDescriptionSchema#type-[]": LENGTH_AFTER_TYPE,
};

runGolden("finance.common.json", schemasOf(common));
runGolden("finance.balance.json", schemasOf(balance));
runGolden("finance.categories.json", schemasOf(categories), P7_CATEGORIES);
runGolden("finance.participants.json", schemasOf(participants), P7_PARTICIPANTS);
runGolden("finance.plan.json", schemasOf(plan));
runGolden("finance.settlements.json", schemasOf(settlements));
runGolden("finance.tags.json", schemasOf(tags), P7_TAGS);
runGolden("finance.transactions.json", schemasOf(transactions), P7_TRANSACTIONS);
