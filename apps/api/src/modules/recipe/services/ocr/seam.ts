/**
 * The OCR area's one bridge from a Promise test seam to an effect (docs/EFFECT.md E3, E12; plan
 * `docs/plans/e3-recipe-services.md` P11).
 *
 * `setOcrEngine` and `setPdfRasterizer` keep their Promise contracts (`createFakeOcrEngine` in the pinned
 * `apps/api/test/import/helpers.ts` is an `OcrEngine`), so the services call them through {@link fromSeamPromise}. It lives
 * in its own file because it is the one place the OCR area has to recognise a refusal of the API's error family.
 */
import { Effect } from "effect";
import { type ApiErrorFamily, isApiError } from "../../../../lib/errors.ts";

/** Every refusal the OCR, PDF and import-from-file services can fail with: the API's tagged error family. */
export type OcrFailure = ApiErrorFamily;

/**
 * A Promise from a test seam (the engine, the PDF rasterizer) as an effect: `evaluate` receives the abort signal of the
 * fiber, which interruption (the hard timeout) aborts. A rejection that is a member of the API's error family stays a
 * TYPED failure, unchanged; ANY OTHER rejection becomes a DEFECT carrying the original object, never a mapped
 * `ApiFailure`. Today the raw error propagates (`apps/api/test/import/ocr-segment.test.ts` expects
 * `rejects.toThrow("worker died")`) and the route answers `500 internal_error`; `Cause.squash` of the defect is that same
 * raw error, so `runPromise` rejects with it and the boundary answers the same 500.
 */
export const fromSeamPromise = <A>(evaluate: (signal: AbortSignal) => PromiseLike<A>): Effect.Effect<A, OcrFailure> =>
  Effect.tryPromise({ try: evaluate, catch: (cause) => cause }).pipe(
    // `orDie` turns the typed failure into a defect whose value is `cause` itself.
    Effect.catch((cause) => (isApiError(cause) ? Effect.fail(cause) : Effect.orDie(Effect.fail(cause)))),
  );
