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
 * The Effect HTTP layer (docs/EFFECT.md E8; E7-T09; plan P5, P17): `RequireFinanceParticipantLayer` implements the tag
 * `RequireFinanceParticipant` of `./http.ts` with the same gate (`checkFinanceParticipant`); the Hono section below
 * (until E7-T12 deletes it) keeps the Hono middleware and its context accessors.
 *
 * The context variable is typed by the module-local augmentation below; the core `AppVariables`
 * gains nothing. Ported route handlers import `requireFinanceParticipantContext as
 * requireHouseholdContext` and keep toon-finance's bodies.
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
 * A route file passes it to its bridge inside `Layer.suspend` (E7-T09): the bridge call runs at module scope, while
 * this file may still be evaluating through the API's import cycle (P15), so the read must wait for the build.
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

/* Hono (E7 transition): E7-T12 deletes this section */
import type { MiddlewareHandler } from "hono";
import type { AppContext, AppEnv } from "../../lib/types.ts";
import { currentMembership } from "../../lib/types.ts";
import { runtime } from "../../runtime.ts";

/** The gate for the Hono request `c`: its membership, then the seat (`checkFinanceParticipant`). */
const checkFinanceParticipantOn = Effect.fn("FinanceParticipant.checkOn")(function* (c: AppContext) {
  const membership = yield* currentMembership(c);
  return yield* checkFinanceParticipant(membership);
});

/**
 * 403 `finance_not_participant` unless the session user holds a slot in the addressed
 * household's `finance_participants`; otherwise sets `financeParticipant`.
 */
export function requireFinanceParticipant(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const participant = await runtime.runPromise(checkFinanceParticipantOn(c));
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

declare module "hono" {
  interface ContextVariableMap {
    financeParticipant: FinanceParticipantContext;
  }
}
