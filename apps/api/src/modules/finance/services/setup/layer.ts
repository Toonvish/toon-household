/**
 * The finance module's composition, the setup area (docs/EFFECT.md E7; plan `docs/plans/e4-finance-services.md` P4).
 *
 * `FinanceSetup` (`apps/api/src/modules/finance/setup.ts`) needs `Database`, `AppConfig`, `FinanceParticipants` and
 * `FinanceSettings`; the participants area is a sibling, so `financeLayer()` (`apps/api/src/modules/finance/layer.ts`)
 * nests this area in an OUTER `Layer.provideMerge` step over it, never beside it in one `Layer.mergeAll`. Requirements
 * stay open and are satisfied there and by the core under it.
 *
 * Import cycle (CLAUDE.md "API import cycle"): a hoisted function only; nothing runs at import.
 */
import { FinanceSetup } from "../../setup.ts";

/** Every service `setupLayer()` provides. */
export type SetupServices = FinanceSetup;

export function setupLayer() {
  return FinanceSetup.layer;
}
