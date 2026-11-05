/**
 * The finance module's HTTP vocabulary (docs/EFFECT.md E8; plan `docs/plans/e7-http-api.md` P5, P15): the participant
 * context a ledger handler reads, and the middleware tag that provides it.
 *
 * `RequireFinanceParticipant` requires `CurrentMembership` (the core household tags provide it) and provides
 * `CurrentFinanceParticipant`, the caller's seat in the addressed household (`403 finance_not_participant` without one).
 * Its implementation is `RequireFinanceParticipantLayer` in `middleware.ts`.
 *
 * A LEAF (CLAUDE.md "API import cycle", plan P15): this file imports `effect`, the core HTTP vocabulary and the error
 * family only, so every `*.api.ts` of the finance module may import it at module scope.
 */
import { Context } from "effect";
import { HttpApiMiddleware } from "effect/http-api";
import { CurrentMembership } from "../../http/context.ts";
import { BoundaryFailure } from "../../http/middleware.ts";

/** toon-finance's `HouseholdContext` shape: who the caller is in this household's budget. */
export interface FinanceParticipantContext {
  householdId: string;
  userId: string;
  memberSlot: 1 | 2;
}

/** The caller's finance participant context, provided by `RequireFinanceParticipant` (E7-T09). */
export class CurrentFinanceParticipant extends Context.Service<CurrentFinanceParticipant, FinanceParticipantContext>()(
  "toon/api/modules/finance/http/CurrentFinanceParticipant",
) {}

/** `requireFinanceParticipant()`: 403 `finance_not_participant` unless the caller holds a seat; provides the seat. */
export class RequireFinanceParticipant extends HttpApiMiddleware.Service<
  RequireFinanceParticipant,
  { requires: CurrentMembership; provides: CurrentFinanceParticipant }
>()("toon/api/modules/finance/http/RequireFinanceParticipant", { error: BoundaryFailure }) {}
