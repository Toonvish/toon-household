/**
 * The finance module's participant gate (SPEC D3, plan M3 decisions 3 and 5).
 *
 * A household has any number of core members; finance seats two of them (slots 1 and 2 of
 * `finance_participants`). Every ledger group attaches `RequireVerifiedEmail` then `RequireFinanceParticipant` for every
 * method, so a household member without a slot gets `403 finance_not_participant` on reads too (decision 3). The module
 * chain of `modules/mount.ts` has already applied `RequireSession` -> `RequireHouseholdMember` -> `RequireModule` for
 * `finance`, so the membership is set; a route group never repeats those.
 *
 * `RequireFinanceParticipantLayer` implements the tag `RequireFinanceParticipant` of `./http.ts` (docs/EFFECT.md E8;
 * plan `docs/plans/e7-http-api.md` P5, P17): the gate (`checkFinanceParticipant`) does its service and database work
 * as one effect over `CurrentMembership`, the refusal is the family's `ApiFailure`, and the handlers read the seat as
 * `CurrentFinanceParticipant`. The module scope of this file reads no imported binding but `effect` and the error
 * family until it runs: the API's import graph has a cycle (see `apps/api/test/import-order.test.ts`), so a binding
 * read at module scope could still be in its TDZ. The pre-E7 Hono middleware and its synchronous context bridge are
 * gone.
 */
import { Effect, Layer } from "effect";
import { CurrentMembership, type Membership } from "../../http/context.ts";
import { ApiFailure } from "../../lib/errors.ts";
import { CurrentFinanceParticipant, type FinanceParticipantContext, RequireFinanceParticipant } from "./http.ts";
import { FinanceParticipants } from "./services/participants/participants.service.ts";

export type { FinanceParticipantContext } from "./http.ts";

function notParticipant(): ApiFailure {
  return new ApiFailure({ status: 403, code: "finance_not_participant", text: "server.finance.notParticipant" });
}

/** The gate as one effect: the caller's slot in the addressed household, or `403 finance_not_participant`. */
const checkFinanceParticipant = Effect.fn("FinanceParticipant.check")(function* (membership: Membership) {
  const participants = yield* FinanceParticipants;
  const slot = yield* participants.participantSlotOf(membership.householdId, membership.userId);
  if (slot === null) return yield* notParticipant();
  const context: FinanceParticipantContext = {
    householdId: membership.householdId,
    userId: membership.userId,
    memberSlot: slot,
  };
  return context;
});

/**
 * `RequireFinanceParticipant` (P5): the gate over the membership of the request, providing the seat to the handler.
 * A route file's handler layer reads it inside `Layer.suspend` (E7-T09): the read would otherwise run at module scope,
 * while this file may still be evaluating through the API's import cycle (P15), so it must wait for the build.
 */
export const RequireFinanceParticipantLayer = Layer.effect(
  RequireFinanceParticipant,
  Effect.gen(function* () {
    const participants = yield* FinanceParticipants;
    return RequireFinanceParticipant.of(
      Effect.fn("FinanceParticipant.middleware")(function* (httpEffect) {
        const membership = yield* CurrentMembership;
        const context = yield* Effect.provideService(checkFinanceParticipant(membership), FinanceParticipants, participants);
        return yield* Effect.provideService(httpEffect, CurrentFinanceParticipant, context);
      }),
    );
  }),
);
