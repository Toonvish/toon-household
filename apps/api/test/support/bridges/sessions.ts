/**
 * The test door of `apps/api/src/core/services/auth/sessions.ts` (docs/EFFECT.md E7, E9; plan
 * `docs/plans/e8-harden.md` P1): moved from `apps/api/src/core/services/auth/sessions.ts` at E8 (plan e8 P1).
 */
import type { DrizzleDatabase } from "../../../src/db/client.ts";
import { Database } from "../../../src/db/database.ts";
import type { SessionRow } from "../../../src/db/schema.ts";
import { type RequestFingerprint, Sessions } from "../../../src/core/services/auth/sessions.ts";
import { runtime } from "../../../src/runtime.ts";

/**
 * Creates a session row for `userId` on `database` through the `Sessions` service of the app runtime. Moved from
 * `apps/api/src/core/services/auth/sessions.ts` at E8 (plan e8 P1). Callers: `apps/api/test/middleware.test.ts`,
 * `apps/api/test/import/routes.test.ts`, `apps/api/test/import/ocr-disabled.test.ts`,
 * `apps/api/test/import/url-import-local.test.ts`. Promise; a failure rejects with the tagged error itself.
 */
export function createSession(
  database: DrizzleDatabase,
  userId: string,
  fingerprint: RequestFingerprint = {},
): Promise<SessionRow> {
  return runtime.runPromise(
    Sessions.use((service) => service.createSession(userId, fingerprint)).pipe(Database.withExecutor(database)),
  );
}
