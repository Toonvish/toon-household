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
 * Both exports are hoisted FUNCTION DECLARATIONS, not `const` arrows: the API's import graph
 * has a cycle (see test/import-order.test.ts) and a `const` here could still be in its TDZ when
 * a router file calls `requireFinanceParticipant()` at module scope.
 *
 * The context variable is typed by the module-local augmentation below; the core `AppVariables`
 * gains nothing. Ported route handlers import `requireFinanceParticipantContext as
 * requireHouseholdContext` and keep toon-finance's bodies.
 */
import { and, eq } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import { db } from "../../db/client.ts";
import { ApiError } from "../../lib/errors.ts";
import type { AppContext, AppEnv } from "../../lib/types.ts";
import { requireMembership } from "../../lib/types.ts";
import { financeParticipants } from "./schema.ts";

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

function notParticipant(): ApiError {
  return new ApiError(403, "finance_not_participant", "server.finance.notParticipant");
}

/**
 * 403 `finance_not_participant` unless the session user holds a slot in the addressed
 * household's `finance_participants`; otherwise sets `financeParticipant`.
 */
export function requireFinanceParticipant(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const membership = requireMembership(c);
    const rows = await db
      .select({ memberSlot: financeParticipants.memberSlot })
      .from(financeParticipants)
      .where(
        and(
          eq(financeParticipants.householdId, membership.householdId),
          eq(financeParticipants.userId, membership.userId),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) throw notParticipant();
    c.set("financeParticipant", {
      householdId: membership.householdId,
      userId: membership.userId,
      memberSlot: row.memberSlot === 2 ? 2 : 1,
    });
    await next();
  };
}

/** The participant context set by {@link requireFinanceParticipant}, or the same 403. */
export function requireFinanceParticipantContext(c: AppContext): FinanceParticipantContext {
  const participant = c.get("financeParticipant");
  if (!participant) throw notParticipant();
  return participant;
}
