/**
 * sharp-based image preprocessing. Tesseract's accuracy on phone photos of
 * cookbook pages depends far more on this step than on any engine parameter:
 *
 *   rotate()      honour the EXIF orientation (phones store portrait as EXIF)
 *   grayscale()   colour is noise for OCR
 *   normalize()   stretch contrast — fixes the typical dim kitchen photo
 *   resize(2000)  Tesseract wants ~300 dpi; upscaling tiny images helps, and
 *                 downscaling huge ones saves seconds per page
 *   png()         lossless hand-off, no JPEG ringing around glyphs
 */
import { Effect, Predicate } from "effect";
import { ApiFailure, UnsupportedMediaType } from "../../../../lib/errors.ts";

/** sharp's callable default export (the namespace itself is not callable). */
type SharpFactory = typeof import("sharp").default;
type SharpInstance = ReturnType<SharpFactory>;
type SharpMetadata = Awaited<ReturnType<SharpInstance["metadata"]>>;

/** Target width in pixels — the sweet spot for a full A5/A4 cookbook page. */
export const TARGET_WIDTH = 2000;
/** Below this width the source is upscaled instead of left alone. */
export const MIN_WIDTH = 1000;

export interface PreprocessResult {
  /** PNG bytes ready for the OCR engine. */
  bytes: Uint8Array;
  width: number;
  height: number;
  /** Input format as detected by sharp ("jpeg", "heif", …). */
  inputFormat: string;
}

/**
 * Normalises an arbitrary photo for OCR (docs/EFFECT.md E7; plan `docs/plans/e3-recipe-services.md` P11: a service-free
 * effect, R = never).
 *
 * Fails with `UnsupportedMediaType` (415) and an actionable message when sharp cannot decode the input. HEIC/HEIF is the
 * realistic case: libvips is frequently built without the HEIF plugin, so the user is told to convert/re-shoot instead of
 * getting a generic 500. A missing sharp binary is the `422 ocr_failed` `ApiFailure`.
 */
export const preprocessImage = Effect.fnUntraced(function* (
  input: Uint8Array,
): Effect.fn.Return<PreprocessResult, ApiFailure | UnsupportedMediaType> {
  const sharp = yield* loadSharp;

  const opened = yield* Effect.tryPromise({
    try: async () => {
      const pipeline = sharp(Buffer.from(input), { failOn: "none", limitInputPixels: 400_000_000 });
      return { pipeline, metadata: await pipeline.metadata() };
    },
    catch: (error) => decodeError(error, input),
  });
  const { pipeline, metadata }: { pipeline: SharpInstance; metadata: SharpMetadata } = opened;

  const sourceWidth = metadata.width ?? 0;
  // Rotating by EXIF can swap width/height, so decide the target from the
  // longest edge rather than from `width` alone.
  const longestEdge = Math.max(sourceWidth, metadata.height ?? 0);
  const resizeWidth = longestEdge === 0 ? TARGET_WIDTH : longestEdge > TARGET_WIDTH ? TARGET_WIDTH : undefined;
  const upscaleWidth = longestEdge > 0 && longestEdge < MIN_WIDTH ? MIN_WIDTH : undefined;

  return yield* Effect.tryPromise({
    try: async () => {
      let work = pipeline.rotate().grayscale().normalize();
      if (resizeWidth !== undefined) {
        work = work.resize({ width: resizeWidth, fit: "inside", withoutEnlargement: true });
      } else if (upscaleWidth !== undefined) {
        work = work.resize({ width: upscaleWidth, fit: "inside", kernel: "lanczos3" });
      }
      const { data, info } = await work.png({ compressionLevel: 6 }).toBuffer({ resolveWithObject: true });
      return {
        bytes: new Uint8Array(data),
        width: info.width,
        height: info.height,
        inputFormat: metadata.format ?? "unknown",
      };
    },
    catch: (error) => decodeError(error, input),
  });
});

/** True for ISO-BMFF containers with a HEIC/HEIF brand. */
function looksLikeHeic(input: Uint8Array): boolean {
  if (input.length < 12) return false;
  let ftyp = "";
  for (let index = 4; index < 8; index += 1) ftyp += String.fromCharCode(input[index]!);
  if (ftyp !== "ftyp") return false;
  let brand = "";
  for (let index = 8; index < 12; index += 1) brand += String.fromCharCode(input[index]!);
  return /^(heic|heix|hevc|hevx|mif1|msf1|heim|heis)$/i.test(brand);
}

function decodeError(error: unknown, input: Uint8Array): UnsupportedMediaType {
  const message = Predicate.isError(error) ? error.message : String(error);
  if (looksLikeHeic(input) || /heif|heic/i.test(message)) {
    return new UnsupportedMediaType({ text: "server.ocr.heicUnsupported" });
  }
  return new UnsupportedMediaType({
    text: { key: "server.ocr.imageUnreadable", values: { message: message.slice(0, 120) } },
  });
}

/** Lazily loads sharp so a missing native binary fails as a clean 422/415. */
const loadSharp: Effect.Effect<SharpFactory, ApiFailure> = Effect.tryPromise({
  try: () => import("sharp"),
  catch: (error) =>
    new ApiFailure({
      status: 422,
      code: "ocr_failed",
      text: "server.ocr.imageProcessingUnavailable",
      details: { cause: Predicate.isError(error) ? error.message : String(error) },
    }),
}).pipe(Effect.map((module) => module.default));
