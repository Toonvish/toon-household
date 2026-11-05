/**
 * The finance module's composition, the ledger area (docs/EFFECT.md E7; plan `docs/plans/e4-finance-services.md` P4).
 *
 * `FinanceBalance`, `FinanceTransactions` and `FinanceSummary` are leaves of the area (they need `Database` and the
 * participants and categories areas only); `FinanceSettlements` needs two of them (balance and transactions), so it sits in the OUTER `Layer.provideMerge` step. Inside an area a service that needs a sibling goes
 * in an outer step, never beside it in one `Layer.mergeAll`; requirements stay open (`Database`, `FinanceParticipants`,
 * `FinanceSettings`, `FinanceCategories`, `FinanceTags`, `FinanceMutationClaims`) and are satisfied by `financeLayer()`
 * (`apps/api/src/modules/finance/layer.ts`) and the core under it.
 *
 * Import cycle (CLAUDE.md "API import cycle"): a hoisted function only; nothing runs at import.
 */
import { Layer } from "effect";
import { FinanceBalance } from "./balance.service.ts";
import { FinanceSettlements } from "./settlements.service.ts";
import { FinanceSummary } from "./summary.service.ts";
import { FinanceTransactions } from "./transactions.service.ts";

/** Every service `ledgerLayer()` provides. */
export type LedgerServices = FinanceBalance | FinanceTransactions | FinanceSummary | FinanceSettlements;

export function ledgerLayer() {
  return FinanceSettlements.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(FinanceBalance.layer, FinanceTransactions.layer, FinanceSummary.layer)),
  );
}
