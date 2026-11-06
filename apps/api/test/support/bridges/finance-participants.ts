/**
 * The test door of `apps/api/src/modules/finance/services/participants/participants.service.ts` (docs/EFFECT.md E7,
 * E9; plan `docs/plans/e8-harden.md` P1): moved from
 * `apps/api/src/modules/finance/services/participants/participants.service.ts` at E8 (plan e8 P1). Both doors run on the
 * finance-bridge door (`./finance-bridge.ts`), never on `src/runtime.ts`.
 */
import type { FinanceParticipantResponse } from "@toon/shared";
import {
  FinanceParticipants,
  type ParticipantAssignmentEntry,
} from "../../../src/modules/finance/services/participants/participants.service.ts";
import type { DbLike } from "../../../src/modules/finance/services/support.ts";
import { runFinanceBridge } from "./finance-bridge.ts";

export type { ParticipantAssignmentEntry };

/**
 * Seats exactly two members in slots 1 and 2 on `db`. Moved from
 * `apps/api/src/modules/finance/services/participants/participants.service.ts` at E8 (plan e8 P1). Callers:
 * `apps/api/test/finance-module.test.ts`. Promise.
 */
export function assignParticipants(
  db: DbLike,
  householdId: string,
  assignment: readonly ParticipantAssignmentEntry[],
): Promise<void> {
  return runFinanceBridge(FinanceParticipants.use((service) => service.assignParticipants(householdId, assignment)), db);
}

/**
 * Renames a seated participant on `db`. Moved from
 * `apps/api/src/modules/finance/services/participants/participants.service.ts` at E8 (plan e8 P1). Callers:
 * `apps/api/test/finance-module.test.ts`. Promise.
 */
export function updateParticipantDisplayName(
  db: DbLike,
  householdId: string,
  userId: string,
  displayName: string,
): Promise<FinanceParticipantResponse> {
  return runFinanceBridge(
    FinanceParticipants.use((service) => service.updateParticipantDisplayName(householdId, userId, displayName)),
    db,
  );
}
