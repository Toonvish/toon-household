/**
 * The test door of `apps/api/src/core/services/auth/users.ts` (docs/EFFECT.md E7, E9; plan `docs/plans/e8-harden.md`
 * P1): moved from `apps/api/src/core/services/auth/users.ts` at E8 (plan e8 P1).
 */
import { Database } from "../../../src/db/database.ts";
import { type ClaimPlaceholderInput, Users } from "../../../src/core/services/auth/users.ts";
import type { DbLike } from "../../../src/core/services/households/support.ts";
import { runtime } from "../../../src/runtime.ts";

/**
 * Claims a placeholder user (ONE conditional `UPDATE`, ADR 0006) on `database` through the `Users` service of the app
 * runtime. Moved from `apps/api/src/core/services/auth/users.ts` at E8 (plan e8 P1). Callers:
 * `apps/api/test/placeholders.test.ts` (the two-claim race). Promise; a refusal rejects with the tagged `Conflict`
 * itself (`member_has_account`, `email_taken`).
 */
export function claimPlaceholderUser(database: DbLike, userId: string, input: ClaimPlaceholderInput): Promise<void> {
  return runtime.runPromise(
    Users.use((service) => service.claimPlaceholderUser(userId, input)).pipe(Database.withExecutor(database)),
  );
}
