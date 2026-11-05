/**
 * The finance module's composition, the participants area (docs/EFFECT.md E7; plan `docs/plans/e4-finance-services.md` P4).
 *
 * `FinanceParticipants` (needs `Database`) and `FinanceSettings` (needs `Database` and `AppConfig`) sit side by side:
 * neither needs the other. Inside an area a service that needs a sibling goes in an outer `Layer.provideMerge` step,
 * never beside it in one `Layer.mergeAll`; requirements stay open and are satisfied by `financeLayer()`
 * (`apps/api/src/modules/finance/layer.ts`) and the core under it.
 *
 * Import cycle (CLAUDE.md "API import cycle"): a hoisted function only; nothing runs at import.
 */
import { Layer } from "effect";
import { FinanceParticipants } from "./participants.service.ts";
import { FinanceSettings } from "../settings/settings.service.ts";

/** Every service `participantsLayer()` provides. */
export type ParticipantsServices = FinanceParticipants | FinanceSettings;

export function participantsLayer() {
  return Layer.mergeAll(FinanceParticipants.layer, FinanceSettings.layer);
}
