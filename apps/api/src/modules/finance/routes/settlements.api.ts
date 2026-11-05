/** Finance settlements (there is no separate `settlements` table: a settlement IS a transaction with `splitMode: "SETTLEMENT"`); served at /api/households/:householdId/finance/settlements (docs/API.md "Finance module"). */
import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { chain, householdModuleApi, RequireVerifiedEmail } from "../../../http/middleware.ts";
import { RequireFinanceParticipant } from "../http.ts";

const params = { householdId: Schema.String };

export const FinanceSettlementsGroup = HttpApiGroup.make("finance.settlements")
  .add(
    /** GET /api/households/:householdId/finance/settlements */
    HttpApiEndpoint.get("get", "/", { params }),
    /** POST /api/households/:householdId/finance/settlements */
    HttpApiEndpoint.post("post", "/", { params }),
  )
  .prefix("/settlements")
  .pipe(chain(RequireVerifiedEmail, RequireFinanceParticipant));

export const FinanceSettlementsApi = householdModuleApi(
  "finance",
  HttpApi.make("finance.settlements").add(FinanceSettlementsGroup),
);
