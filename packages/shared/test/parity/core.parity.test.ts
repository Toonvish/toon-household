/**
 * E1-T08 (plan e1 P1, P7): the core schemas (`src/core/schemas/{common,user,household,auth}.ts`,
 * `src/modules/registry.ts`) against the zod oracle in `fixtures/schema-golden/core.*.json`. Zod-free (P20).
 */
import { Schema } from "effect";
import * as auth from "../../src/core/schemas/auth.ts";
import * as common from "../../src/core/schemas/common.ts";
import * as household from "../../src/core/schemas/household.ts";
import * as user from "../../src/core/schemas/user.ts";
import * as registry from "../../src/modules/registry.ts";
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
 * passed, so that trailing issue is missing. `ok` and `details[0]` agree.
 */
const LENGTH_AFTER_TYPE = "zod runs the string min-length check on an array input after invalid_type (plan e1 P7)";

const P7_USER: Record<string, string> = {
  "PasswordSchema#type-[]": LENGTH_AFTER_TYPE,
  "DisplayNameSchema#type-[]": LENGTH_AFTER_TYPE,
  "HouseholdNameSchema#type-[]": LENGTH_AFTER_TYPE,
  "OpaqueTokenSchema#type-[]": LENGTH_AFTER_TYPE,
};

runGolden("core.common.json", schemasOf(common));
runGolden("core.user.json", schemasOf(user), P7_USER);
runGolden("core.household.json", schemasOf(household));
runGolden("core.auth.json", schemasOf(auth));
runGolden("core.registry.json", schemasOf(registry));
