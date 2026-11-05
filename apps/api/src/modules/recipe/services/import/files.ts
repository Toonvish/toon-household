/**
 * Upload handling for the import pipeline: real content-type sniffing, size
 * limits and storage under UPLOAD_DIR.
 *
 * The client filename is NEVER trusted — neither for the type nor for the
 * stored name. Files land at `<UPLOAD_DIR>/<uuid>.<ext>` where the extension is
 * derived from the sniffed magic bytes.
 *
 * AS A SERVICE (docs/EFFECT.md E7; plan `docs/plans/e3-recipe-services.md` P2, P8): `ImportFiles` reads the upload
 * directory from `AppConfig`; its refusals are the tagged family (`BadRequest`, `PayloadTooLarge`,
 * `UnsupportedMediaType`). The sniffing and the MIME lists stay pure exports. The bridge section keeps the Promise
 * functions `routes/imports.ts` still calls, until E3-T11.
 */
import { mkdir, unlink } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { ACCEPTED_IMAGE_MIME_TYPES, ACCEPTED_PDF_MIME_TYPES, MAX_UPLOAD_BYTES } from "@toon/shared";
import { Context, Effect, Layer, Predicate } from "effect";
import { AppConfig } from "../../../../config.ts";
import { THUMBNAIL_SUFFIX } from "../../../../core/services/media/thumbnails.ts";
import { env } from "../../../../env.ts";
import { BadRequest, PayloadTooLarge, UnsupportedMediaType } from "../../../../lib/errors.ts";
import { runtime } from "../../../../runtime.ts";

export type SniffedMime =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/gif"
  | "image/heic"
  | "image/heif"
  | "image/avif"
  | "image/tiff"
  | "image/bmp"
  | "application/pdf";

const EXTENSION_BY_MIME: Record<SniffedMime, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/avif": "avif",
  "image/tiff": "tiff",
  "image/bmp": "bmp",
  "application/pdf": "pdf",
};

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[offset + index] !== signature[index]) return false;
  }
  return true;
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  if (bytes.length < offset + length) return "";
  let out = "";
  for (let index = 0; index < length; index += 1) out += String.fromCharCode(bytes[offset + index]!);
  return out;
}

/**
 * Detects the real media type from magic bytes. Returns undefined for anything
 * this pipeline cannot process (which the caller turns into a 415).
 */
export function sniffMimeType(bytes: Uint8Array): SniffedMime | undefined {
  if (bytes.length < 12) return undefined;

  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (startsWith(bytes, [0x42, 0x4d])) return "image/bmp";
  if (startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])) return "image/tiff";

  // RIFF....WEBP
  if (asciiAt(bytes, 0, 4) === "RIFF" && asciiAt(bytes, 8, 4) === "WEBP") return "image/webp";

  // ISO-BMFF: "....ftyp<brand>"
  if (asciiAt(bytes, 4, 4) === "ftyp") {
    const brand = asciiAt(bytes, 8, 4).toLowerCase();
    if (brand.startsWith("avif") || brand.startsWith("avis")) return "image/avif";
    if (["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs"].includes(brand)) return "image/heic";
    if (["mif1", "msf1", "miaf"].includes(brand)) return "image/heif";
  }

  // PDFs sometimes carry leading whitespace/junk before %PDF-
  const head = asciiAt(bytes, 0, Math.min(bytes.length, 1024));
  const pdfIndex = head.indexOf("%PDF-");
  if (pdfIndex !== -1 && pdfIndex <= 512) return "application/pdf";

  return undefined;
}

export const IMAGE_MIME_TYPES: readonly string[] = ACCEPTED_IMAGE_MIME_TYPES;
export const PDF_MIME_TYPES: readonly string[] = ACCEPTED_PDF_MIME_TYPES;

/** Image types this pipeline accepts (superset of the contract list). */
const ACCEPTED_IMPORT_IMAGE_TYPES: readonly SniffedMime[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/avif",
  "image/gif",
  "image/tiff",
  "image/bmp",
];

export type ImportFileKind = "image" | "pdf";

export interface UploadedFile {
  bytes: Uint8Array;
  /** Sniffed, trustworthy media type. */
  mimeType: SniffedMime;
  kind: ImportFileKind;
  /** Client-provided name, kept for display only. */
  originalName?: string;
  size: number;
}

/** What `readUploadedFile` refuses a request with. */
export type UploadRefusal = BadRequest | PayloadTooLarge | UnsupportedMediaType;

/**
 * Reads the `file` field of a multipart request and validates it.
 *
 * Fails `400` when the field is missing, `413` when too large, `415` when the sniffed type is not importable.
 */
const readUpload = Effect.fn("ImportFiles.readUploadedFile")(function* (
  request: Request,
  options: { accept?: readonly ImportFileKind[]; fieldName?: string } = {},
): Effect.fn.Return<UploadedFile, UploadRefusal> {
  const accept = options.accept ?? (["image", "pdf"] as const);
  const fieldName = options.fieldName ?? "file";

  // Deliberately inferred: Bun's Request.formData() returns undici's FormData,
  // which is not assignable to the lib.dom FormData type.
  const form = yield* Effect.tryPromise({
    try: () => request.formData(),
    catch: () => new BadRequest({ text: "server.import.fileUnreadable" }),
  });

  const value = form.get(fieldName);
  if (value === null || Predicate.isString(value)) {
    return yield* new BadRequest({ text: { key: "server.import.noFileInField", values: { fieldName } } });
  }
  const file = value as File;
  if (file.size > MAX_UPLOAD_BYTES) return yield* new PayloadTooLarge();

  const bytes = new Uint8Array(yield* Effect.promise(() => file.arrayBuffer()));
  if (bytes.byteLength === 0) return yield* new BadRequest({ text: "server.import.fileEmpty" });
  if (bytes.byteLength > MAX_UPLOAD_BYTES) return yield* new PayloadTooLarge();

  const mimeType = sniffMimeType(bytes);
  if (mimeType === undefined) {
    return yield* new UnsupportedMediaType({ text: "server.import.unsupportedFileType" });
  }

  const kind: ImportFileKind = mimeType === "application/pdf" ? "pdf" : "image";
  if (!accept.includes(kind)) {
    return yield* new UnsupportedMediaType({
      text: kind === "pdf" ? "server.import.expectedImageNotPdf" : "server.import.expectedPdfNotImage",
    });
  }
  if (kind === "image" && !ACCEPTED_IMPORT_IMAGE_TYPES.includes(mimeType)) {
    return yield* new UnsupportedMediaType({
      text: { key: "server.import.unsupportedImageFormat", values: { mimeType } },
    });
  }

  const originalName = Predicate.isString(file.name) && file.name.length > 0 ? basename(file.name).slice(0, 300) : undefined;
  return {
    bytes,
    mimeType,
    kind,
    size: bytes.byteLength,
    ...(originalName === undefined ? {} : { originalName }),
  };
});

export interface StoredUpload {
  /** Bare filename (`<uuid>.<ext>`) — this is what goes into sourceMeta.storedPath. */
  filename: string;
  absolutePath: string;
  /**
   * UNSIGNED, storage-shaped path (`/uploads/<uuid>.<ext>`).
   *
   * A signature is minted only when a row is serialised (see lib/uploadUrls.ts),
   * and for an import SOURCE scan that never happens — those are private and are
   * served exclusively by the membership-checked
   * `GET /api/households/:householdId/recipe/imports/:draftId/source`. The URL importer's hero
   * image, which also lands here, does get signed because it becomes a recipe image.
   */
  url: string;
  mimeType: string;
  size: number;
}

/**
 * Absolute path of a stored upload under `uploadDir`; `400 bad_request` (`server.import.invalidFilename`) on traversal
 * attempts. Service-free: the directory is a parameter.
 */
const resolveIn = Effect.fnUntraced(function* (uploadDir: string, filename: string): Effect.fn.Return<string, BadRequest> {
  const bare = basename(filename);
  if (bare.length === 0 || bare !== filename || bare.startsWith(".")) {
    return yield* new BadRequest({ text: "server.import.invalidFilename" });
  }
  const absolute = resolve(join(uploadDir, bare));
  const root = resolve(uploadDir);
  if (absolute !== join(root, bare) || !absolute.startsWith(root)) {
    return yield* new BadRequest({ text: "server.import.invalidFilename" });
  }
  return absolute;
});

/** The import file service. */
export class ImportFiles extends Context.Service<
  ImportFiles,
  {
    /** Reads and validates the multipart `file` field: `400`, `413` or `415` refusals. */
    readonly readUploadedFile: (
      request: Request,
      options?: { accept?: readonly ImportFileKind[]; fieldName?: string },
    ) => Effect.Effect<UploadedFile, UploadRefusal>;
    /** Absolute path of a stored upload; `400` on traversal attempts. */
    readonly resolveUploadPath: (filename: string) => Effect.Effect<string, BadRequest>;
    /** Writes bytes to the upload directory under a fresh UUID filename. */
    readonly storeUpload: (bytes: Uint8Array, mimeType: SniffedMime) => Effect.Effect<StoredUpload>;
    /**
     * Deletes a stored upload and its generated list thumbnail; missing files and bad names are ignored (catch-all,
     * plan e3 P8). Never fails.
     */
    readonly deleteUpload: (filename: string | null | undefined) => Effect.Effect<void>;
  }
>()("toon/api/modules/recipe/services/import/files/ImportFiles") {
  static readonly layer = Layer.effect(
    ImportFiles,
    Effect.gen(function* () {
      const config = yield* AppConfig;

      const resolveUploadPath = (filename: string) => resolveIn(config.uploadDir, filename);

      /** Writes bytes to UPLOAD_DIR under a fresh UUID filename. */
      const storeUpload = Effect.fn("ImportFiles.storeUpload")(function* (bytes: Uint8Array, mimeType: SniffedMime) {
        const extension = EXTENSION_BY_MIME[mimeType] ?? "bin";
        const filename = `${crypto.randomUUID()}.${extension}`;
        const absolutePath = join(config.uploadDir, filename);
        yield* Effect.promise(async () => {
          await mkdir(config.uploadDir, { recursive: true });
          await Bun.write(absolutePath, bytes);
        });
        const stored: StoredUpload = { filename, absolutePath, url: `/uploads/${filename}`, mimeType, size: bytes.byteLength };
        return stored;
      });

      /**
       * Deletes a stored upload; missing files and bad names are ignored.
       *
       * Takes the generated list thumbnail with it — `uploads:gc` would eventually sweep
       * an orphaned derivative, but leaving one behind means the next upload that somehow
       * reuses the name (a restored backup, a manual copy) inherits a stale image.
       */
      const deleteUpload = Effect.fn("ImportFiles.deleteUpload")(function* (filename: string | null | undefined) {
        if (!Predicate.isString(filename) || filename.length === 0) return;
        for (const name of [filename, `${filename}${THUMBNAIL_SUFFIX}`]) {
          // already gone / never existed / outside the upload dir — nothing to do
          yield* resolveUploadPath(name).pipe(
            Effect.flatMap((absolute) => Effect.tryPromise({ try: () => unlink(absolute), catch: (cause): unknown => cause })),
            Effect.ignoreCause,
          );
        }
      });

      return ImportFiles.of({ readUploadedFile: readUpload, resolveUploadPath, storeUpload, deleteUpload });
    }),
  );
}

/** Extension for a sniffed type, used by the hero-image downloader. */
export function extensionFor(mimeType: SniffedMime): string {
  return EXTENSION_BY_MIME[mimeType] ?? "bin";
}

/* legacy bridges: callers listed; E3 (recipe), E4 (finance), E5 (scripts) remove them */

/**
 * Reads the `file` field of a multipart request. A refusal rejects with the tagged error itself. Callers:
 * `apps/api/src/modules/recipe/routes/imports.ts` (E3-T11).
 */
export function readUploadedFile(
  request: Request,
  options: { accept?: readonly ImportFileKind[]; fieldName?: string } = {},
): Promise<UploadedFile> {
  return runtime.runPromise(ImportFiles.use((files) => files.readUploadedFile(request, options)));
}

/** Deletes a stored upload; never rejects. Callers: `apps/api/src/modules/recipe/routes/imports.ts` (E3-T11). */
export function deleteUpload(filename: string | null | undefined): Promise<void> {
  return runtime.runPromise(ImportFiles.use((files) => files.deleteUpload(filename)));
}

/**
 * Absolute path of a stored upload. SYNCHRONOUS (plan e3 P1): a service-free effect over `env.uploadDir` run with
 * `Effect.runSync`, which throws the `400 bad_request` refusal itself. Callers:
 * `apps/api/src/modules/recipe/routes/imports.ts` (the source download, E3-T11).
 */
export function resolveUploadPath(filename: string): string {
  return Effect.runSync(resolveIn(env.uploadDir, filename));
}
