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
 * `householdRouter` (M3-T03b): the participants routes; the ledger routers are empty stubs until
 * M3-T05/T06 fill them.
 *
 * `start` / `shutdown` (M3-T06, plan decision 7): the boot catch-up of the fixed-cost plan
 * and its 6-hour accrual tick (`./services/plan/scheduler.ts`).
 *
 * Still to come in M3: `seedDemo` (M3-T09).
 */
import type { ApiModule } from "../types.ts";
import { financeHouseholdRouter } from "./routes/index.ts";
import { financeTables } from "./schema.ts";
import { onFinanceEnable, onFinanceHouseholdCreated } from "./setup.ts";
import { runBootCatchUp, startAccrualScheduler, stopAccrualScheduler } from "./services/plan/scheduler.ts";

export const financeModule: ApiModule = {
  id: "finance",
  householdRouter: financeHouseholdRouter,
  schema: financeTables,
  onHouseholdCreated: onFinanceHouseholdCreated,
  onEnable: onFinanceEnable,
  start: async () => {
    await runBootCatchUp();
    startAccrualScheduler();
  },
  shutdown: async () => {
    stopAccrualScheduler();
  },
};
