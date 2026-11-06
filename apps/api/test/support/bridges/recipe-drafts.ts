/**
 * The test door of `apps/api/src/modules/recipe/services/import/drafts.ts` (docs/EFFECT.md E7, E9; plan
 * `docs/plans/e8-harden.md` P1): moved from `apps/api/src/modules/recipe/services/import/drafts.ts` at E8 (plan e8 P1).
 */
import type { ImportDraft } from "@toon/shared";
import type { Database as DrizzleDatabase } from "../../../src/db/client.ts";
import { Database } from "../../../src/db/database.ts";
import { type CreateDraftInput, ImportDrafts } from "../../../src/modules/recipe/services/import/drafts.ts";
import { runtime } from "../../../src/runtime.ts";

/**
 * Stores an import draft on `db` through the `ImportDrafts` service of the app runtime (`Database.withExecutor(db)`);
 * a failure rejects with the tagged error itself. Moved from `apps/api/src/modules/recipe/services/import/drafts.ts` at
 * E8 (plan e8 P1). Callers: `apps/api/test/import/ocr-disabled.test.ts`. Promise.
 */
export function createDraft(db: DrizzleDatabase, input: CreateDraftInput): Promise<ImportDraft> {
  return runtime.runPromise(ImportDrafts.use((s) => s.createDraft(input)).pipe(Database.withExecutor(db)));
}
