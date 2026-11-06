/**
 * The test door of `apps/api/src/modules/recipe/services/import/ocr/index.ts` (docs/EFFECT.md E7, E9; plan
 * `docs/plans/e8-harden.md` P1): moved from `apps/api/src/modules/recipe/services/import/ocr/index.ts` at E8 (plan e8
 * P1).
 */
import { Effect } from "effect";
import {
  type TextImportResult,
  type TextPasteOptions,
  importFromTextEffect,
} from "../../../src/modules/recipe/services/import/ocr/index.ts";

/**
 * Pasted text -> draft payload. SYNCHRONOUS and throwing the `400` refusal itself (an `ApiError` instance) for an empty
 * text (plan e3 P11): `Effect.runSync` over the service-free `importFromTextEffect`, whose clock is the default one.
 * Moved from `apps/api/src/modules/recipe/services/import/ocr/index.ts` at E8 (plan e8 P1). Callers:
 * `apps/api/test/import/ocr-disabled.test.ts`, `apps/api/test/import/ocr-segment.test.ts`.
 */
export function importFromText(rawText: string, options: TextPasteOptions = {}): TextImportResult {
  return Effect.runSync(importFromTextEffect(rawText, options));
}
