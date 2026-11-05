/**
 * The finance module's participant gate (SPEC D3, plan M3 decisions 3 and 5).
 *
 * A household has any number of core members; finance seats two of them (slots 1 and 2 of
 * `finance_participants`). Every ledger router runs `requireVerifiedEmail()` then
 * `requireFinanceParticipant()` for every method, so a household member without a slot gets
 * `403 finance_not_participant` on reads too (decision 3). The module chain of
 * `modules/mount.ts` has already applied `requireSession()` -> `requireHouseholdRole("member")`
 * -> `requireModule("finance")`, so `membership` is set; a router never repeats those.
 *
 * `requireFinanceParticipant` and `requireFinanceParticipantContext` are hoisted FUNCTION DECLARATIONS, not `const`
 * arrows: the API's import graph has a cycle (see test/import-order.test.ts) and a `const` here could still be in
 * its TDZ when a router file calls `requireFinanceParticipant()` at module scope. The module-scope
 * `currentFinanceParticipant` is an `Effect.fnUntraced` that reads no imported binding but `effect` and the error
 * family until it runs.
 *
 * ON THE RUNTIME (docs/EFFECT.md E7; plan `docs/plans/e4-finance-services.md` P9): the middleware does its service
 * and database work as ONE `await runtime.runPromise(...)` before `await next()` (`next()` is never called inside an
 * effect); the refusal is the family's `ApiFailure`. `requireFinanceParticipantContext` is the synchronous bridge
 * (`Effect.runSync` over a service-free effect) the pinned `finance-participants.test.ts` still calls (E8); the
 * routes read the context through the service-free effect directly.
 *
 * The context variable is typed by the module-local augmentation below; the core `AppVariables`
 * gains nothing. Ported route handlers import `requireFinanceParticipantContext as
 * requireHouseholdContext` and keep toon-finance's bodies.
 */
import { Effect } from "effect";
import type { MiddlewareHandler } from "hono";
import { ApiFailure } from "../../lib/errors.ts";
import type { AppContext, AppEnv } from "../../lib/types.ts";
import { currentMembership } from "../../lib/types.ts";
import { runtime } from "../../runtime.ts";
import { FinanceParticipants } from "./services/participants/participants.service.ts";

/** toon-finance's `HouseholdContext` shape: who the caller is in this household's budget. */
export interface FinanceParticipantContext {
  householdId: string;
  userId: string;
  memberSlot: 1 | 2;
}

declare module "hono" {
  interface ContextVariableMap {
    financeParticipant: FinanceParticipantContext;
  }
}

function notParticipant(): ApiFailure {
  return new ApiFailure({ status: 403, code: "finance_not_participant", text: "server.finance.notParticipant" });
}

/** The gate as one effect: the caller's slot in the addressed household, or `403 finance_not_participant`. */
const checkFinanceParticipant = Effect.fn("FinanceParticipant.check")(function* (c: AppContext) {
  const membership = yield* currentMembership(c);
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
 * 403 `finance_not_participant` unless the session user holds a slot in the addressed
 * household's `finance_participants`; otherwise sets `financeParticipant`.
 */
export function requireFinanceParticipant(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const participant = await runtime.runPromise(checkFinanceParticipant(c));
    c.set("financeParticipant", participant);
    await next();
  };
}

/** The participant context set by {@link requireFinanceParticipant}, or the same 403. */
export const currentFinanceParticipant = Effect.fnUntraced(function* (
  c: AppContext,
): Effect.fn.Return<FinanceParticipantContext, ApiFailure> {
  const participant = c.get("financeParticipant");
  if (!participant) return yield* notParticipant();
  return participant;
});

/** The participant context set by {@link requireFinanceParticipant}, or the same 403. Callers: `apps/api/test/finance-participants.test.ts` (pinned, E8). Synchronous. */
export function requireFinanceParticipantContext(c: AppContext): FinanceParticipantContext {
  return Effect.runSync(currentFinanceParticipant(c));
}
