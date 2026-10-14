/**
 * The finance module's API manifest (SPEC §2): toon-finance's two-person household
 * budget — transactions with the four viewer-projected kinds, categories, tags, the
 * Fixkostenplan, balance, settlements — on the `finance_` tables of `./schema.ts`,
 * between the two participants of `finance_participants` (SPEC D3). The core reaches it
 * only through `modules/index.ts`.
 *
 * Hooks (plan M3 decision 4, `./setup.ts`):
 * - `onHouseholdCreated` — the 21 default categories and the `finance_settings` row, on
 *   every new household (finance enabled or not).
 * - `onEnable` — seats the two participants from the enable settings (or requires the
 *   existing two), else `422 finance_participants_required`; then the plan row.
 *
 * Still to come in M3: `householdRouter` (participants routes and the ledger routers,
 * M3-T03b/T05/T06), `start` + `shutdown` (the accrual scheduler, M3-T06), `seedDemo`
 * (M3-T09).
 */
import type { ApiModule } from "../types.ts";
import { financeTables } from "./schema.ts";
import { onFinanceEnable, onFinanceHouseholdCreated } from "./setup.ts";

export const financeModule: ApiModule = {
  id: "finance",
  schema: financeTables,
  onHouseholdCreated: onFinanceHouseholdCreated,
  onEnable: onFinanceEnable,
};
