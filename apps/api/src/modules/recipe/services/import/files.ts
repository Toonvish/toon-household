/**
 * Upload handling for the import pipeline: real content-type sniffing, size
 * limits and storage under UPLOAD_DIR.
 *
 * The client filename is NEVER trusted — neither for the type nor for the
 * stored name. Files land at `<UPLOAD_DIR>/<uuid>.<ext>` where the extension is
 * derived from the sniffed magic bytes.
 */
import { mkdir, unlink } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { ACCEPTED_IMAGE_MIME_TYPES, ACCEPTED_PDF_MIME_TYPES, MAX_UPLOAD_BYTES } from "@toon/shared";
import { env } from "../../../../env.ts";
import { ApiError } from "../../../../lib/errors.ts";
import { THUMBNAIL_SUFFIX } from "../../../../core/services/media/thumbnails.ts";

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

/**
 * Reads the `file` field of a multipart request and validates it.
 *
 * @throws ApiError 400 when the field is missing, 413 when too large,
 *   415 when the sniffed type is not importable.
 */
export async function readUploadedFile(
  request: Request,
  options: { accept?: readonly ImportFileKind[]; fieldName?: string } = {},
): Promise<UploadedFile> {
  const accept = options.accept ?? (["image", "pdf"] as const);
  const fieldName = options.fieldName ?? "file";

  // Deliberately inferred: Bun's Request.formData() returns undici's FormData,
  // which is not assignable to the lib.dom FormData type.
  let form: Awaited<ReturnType<Request["formData"]>>;
  try {
    form = await request.formData();
  } catch {
    throw ApiError.badRequest("server.import.fileUnreadable");
  }

  const value = form.get(fieldName);
  if (value === null || typeof value === "string") {
    throw ApiError.badRequest({ key: "server.import.noFileInField", values: { fieldName } });
  }
  const file = value as File;
  if (file.size > MAX_UPLOAD_BYTES) throw ApiError.payloadTooLarge();

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength === 0) throw ApiError.badRequest("server.import.fileEmpty");
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw ApiError.payloadTooLarge();

  const mimeType = sniffMimeType(bytes);
  if (mimeType === undefined) {
    throw ApiError.unsupportedMediaType("server.import.unsupportedFileType");
  }

  const kind: ImportFileKind = mimeType === "application/pdf" ? "pdf" : "image";
  if (!accept.includes(kind)) {
    throw ApiError.unsupportedMediaType(
      kind === "pdf" ? "server.import.expectedImageNotPdf" : "server.import.expectedPdfNotImage",
    );
  }
  if (kind === "image" && !ACCEPTED_IMPORT_IMAGE_TYPES.includes(mimeType)) {
    throw ApiError.unsupportedMediaType({ key: "server.import.unsupportedImageFormat", values: { mimeType } });
  }

  const originalName = typeof file.name === "string" && file.name.length > 0 ? basename(file.name).slice(0, 300) : undefined;
  return {
    bytes,
    mimeType,
    kind,
    size: bytes.byteLength,
    ...(originalName === undefined ? {} : { originalName }),
  };
}

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

/** Absolute path of a stored upload; throws on traversal attempts. */
export function resolveUploadPath(filename: string): string {
  const bare = basename(filename);
  if (bare.length === 0 || bare !== filename || bare.startsWith(".")) {
    throw ApiError.badRequest("server.import.invalidFilename");
  }
  const absolute = resolve(join(env.uploadDir, bare));
  const root = resolve(env.uploadDir);
  if (absolute !== join(root, bare) || !absolute.startsWith(root)) {
    throw ApiError.badRequest("server.import.invalidFilename");
  }
  return absolute;
}

/** Writes bytes to UPLOAD_DIR under a fresh UUID filename. */
export async function storeUpload(bytes: Uint8Array, mimeType: SniffedMime): Promise<StoredUpload> {
  const extension = EXTENSION_BY_MIME[mimeType] ?? "bin";
  const filename = `${crypto.randomUUID()}.${extension}`;
  await mkdir(env.uploadDir, { recursive: true });
  const absolutePath = join(env.uploadDir, filename);
  await Bun.write(absolutePath, bytes);
  return { filename, absolutePath, url: `/uploads/${filename}`, mimeType, size: bytes.byteLength };
}

/**
 * Deletes a stored upload; missing files and bad names are ignored.
 *
 * Takes the generated list thumbnail with it — `uploads:gc` would eventually sweep
 * an orphaned derivative, but leaving one behind means the next upload that somehow
 * reuses the name (a restored backup, a manual copy) inherits a stale image.
 */
export async function deleteUpload(filename: string | null | undefined): Promise<void> {
  if (typeof filename !== "string" || filename.length === 0) return;
  for (const name of [filename, `${filename}${THUMBNAIL_SUFFIX}`]) {
    try {
      await unlink(resolveUploadPath(name));
    } catch {
      // already gone / never existed / outside the upload dir — nothing to do
    }
  }
}

/** Extension for a sniffed type, used by the hero-image downloader. */
export function extensionFor(mimeType: SniffedMime): string {
  return EXTENSION_BY_MIME[mimeType] ?? "bin";
}
