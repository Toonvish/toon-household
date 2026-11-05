/**
 * The finance module's API manifest (SPEC §2): toon-finance's two-person household
 * budget — transactions with the four viewer-projected kinds, categories, tags, the
 * Fixkostenplan, balance, settlements — on the `finance_` tables of `./schema.ts`,
 * between the two participants of `finance_participants` (SPEC D3). The core reaches it
 * only through `modules/index.ts`.
 *
 * The manifest implements the Effect contract `ApiModule<FinanceServices>` directly since E4
 * (docs/EFFECT.md E7; SPEC §2; plan `docs/plans/e4-finance-services.md` P3, P4, P5): `layer` is
 * `Layer.suspend(financeLayer)` (`./layer.ts`, a hoisted function, so reading it here at module scope
 * is TDZ-safe), merged by the runtime into the one `AppLayer` over the core; the routes and the
 * middleware yield the services from there. The database hooks are typed over `Database` only and
 * also run outside the runtime (`Database.layerFromExecutor`), so each wraps its program in
 * `withFinanceServices`, which builds the finance services over the CURRENT `Database` (the core's
 * open transaction for a hook) with a local memo map.
 *
 * Hooks (plan M3 decision 4, `./setup.ts` `FinanceSetup`), each an Effect:
 * - `onHouseholdCreated` — the 21 default categories and the `finance_settings` row, on
 *   every new household (finance enabled or not).
 * - `onEnable` — seats the two participants from the enable settings (or requires the
 *   existing two), else `422 finance_participants_required`; then the plan row. The core runs it
 *   BEFORE the `household_modules` upsert, inside its transaction.
 * - `onMemberRemoving` — a seated participant cannot leave while the ledger has rows,
 *   `409 member_has_ledger` (toon-finance's guard, SPEC D13; `FinanceParticipants.assertParticipantMayLeave`).
 *
 * `householdApi` (docs/EFFECT.md E7, E8; SPEC §2; plan `docs/plans/e7-http-api.md` P14): the participants API plus the
 * ledger APIs (transactions, categories, tags, plan, balance, settlements), served under
 * `/api/households/:householdId/finance/`: the seven `HttpApi`s and their handler layer (over
 * `RequireFinanceParticipantLayer`) of `./routes/index.ts`, read lazily (a getter over the hoisted
 * `financeHouseholdApis()`, `Layer.suspend` over the hoisted `financeHouseholdHandlers()`): this manifest is evaluated
 * inside the API's import cycle, where those route files may not be.
 *
 * `start` / `shutdown` (plan decision 7): the boot catch-up of the fixed-cost plan
 * and its 6-hour accrual tick on `Schedule` (`./services/plan/scheduler.ts` `startAccrualSchedule`,
 * `stopAccrualSchedule`).
 *
 * `seedDemo` (`./seed.ts`): two participants, a non-participant, ~8 transactions, one
 * settlement and the fixed-cost plan; idempotent.
 */
import { Layer } from "effect";
import type { ApiModule } from "../types.ts";
import { type FinanceServices, financeLayer, withFinanceServices } from "./layer.ts";
import { financeHouseholdApis, financeHouseholdHandlers } from "./routes/index.ts";
import { financeTables } from "./schema.ts";
import { seedFinanceDemo } from "./seed.ts";
import { FinanceSetup } from "./setup.ts";
import { FinanceParticipants } from "./services/participants/participants.service.ts";
import { startAccrualSchedule, stopAccrualSchedule } from "./services/plan/scheduler.ts";

export const financeModule: ApiModule<FinanceServices> = {
  id: "finance",
  householdApi: {
    get apis() {
      return financeHouseholdApis();
    },
    handlers: Layer.suspend(() => financeHouseholdHandlers()),
  },
  schema: financeTables,
  layer: Layer.suspend(financeLayer),
  onHouseholdCreated: (householdId) =>
    withFinanceServices(FinanceSetup.use((setup) => setup.onFinanceHouseholdCreated(householdId))),
  onEnable: (householdId, settings) =>
    withFinanceServices(FinanceSetup.use((setup) => setup.onFinanceEnable(householdId, settings))),
  onMemberRemoving: (householdId, userId) =>
    withFinanceServices(
      FinanceParticipants.use((participants) => participants.assertParticipantMayLeave(householdId, userId)),
    ),
  seedDemo: (context) => seedFinanceDemo(context),
  start: () => startAccrualSchedule(),
  shutdown: () => stopAccrualSchedule(),
};
