/**
 * Image upload (recipe photos, avatars, household covers).
 *
 * The client filename is never trusted: the real content type is sniffed from
 * the magic bytes and the file is stored as `data/uploads/<uuid>.<ext>`, served by
 * GET /uploads/:filename (src/index.ts) — which requires a signature, see
 * lib/uploadUrls.ts.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { UploadResponse } from "@toon/shared";
import { MAX_UPLOAD_BYTES } from "@toon/shared";
import { Context, Effect, Layer } from "effect";
import { AppConfig } from "../../../config.ts";
import { BadRequest, PayloadTooLarge, UnsupportedMediaType } from "../../../lib/errors.ts";
import { signUploadUrl } from "../../../lib/uploadUrls.ts";
import { runtime } from "../../../runtime.ts";
import { Thumbnails } from "./thumbnails.ts";

interface SniffedType {
  mimeType: string;
  extension: string;
}

const ISO_BMFF_IMAGE_BRANDS: Record<string, SniffedType> = {
  heic: { mimeType: "image/heic", extension: "heic" },
  heix: { mimeType: "image/heic", extension: "heic" },
  hevc: { mimeType: "image/heic", extension: "heic" },
  hevx: { mimeType: "image/heic", extension: "heic" },
  heim: { mimeType: "image/heif", extension: "heif" },
  heis: { mimeType: "image/heif", extension: "heif" },
  mif1: { mimeType: "image/heif", extension: "heif" },
  msf1: { mimeType: "image/heif", extension: "heif" },
  avif: { mimeType: "image/avif", extension: "avif" },
  avis: { mimeType: "image/avif", extension: "avif" },
};

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

/** Detects the accepted image formats from the file header, or undefined. */
export function sniffImageType(bytes: Uint8Array): SniffedType | undefined {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mimeType: "image/jpeg", extension: "jpg" };
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { mimeType: "image/png", extension: "png" };
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") {
    return { mimeType: "image/webp", extension: "webp" };
  }
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === "ftyp") {
    return ISO_BMFF_IMAGE_BRANDS[ascii(bytes, 8, 12).toLowerCase()];
  }
  return undefined;
}

/** What `storeUploadedImage` refuses a file with (400, 413, 415). */
export type UploadRefusal = BadRequest | PayloadTooLarge | UnsupportedMediaType;

/**
 * The uploads as a service (docs/EFFECT.md E7; plan e2 P10; depends on `AppConfig` and `Thumbnails`).
 * `storeUploadedImage` reads the multipart `file` field, validates size and real type and stores it; the refusals are
 * the documented 400/413/415 with today's texts. A disk failure is a defect (it surfaces as `500`, logged with the
 * original error, exactly as the raw rejection did).
 */
export class Uploads extends Context.Service<
  Uploads,
  {
    readonly storeUploadedImage: (formData: FormData, field?: string) => Effect.Effect<UploadResponse, UploadRefusal>;
  }
>()("toon/api/core/services/media/uploads/Uploads") {
  static readonly layer = Layer.effect(
    Uploads,
    Effect.gen(function* () {
      const config = yield* AppConfig;
      const thumbnails = yield* Thumbnails;

      const storeUploadedImage = Effect.fn("Uploads.storeUploadedImage")(function* (
        formData: FormData,
        field = "file",
      ): Effect.fn.Return<UploadResponse, UploadRefusal> {
        const file = formData.get(field);
        if (!(file instanceof File)) {
          return yield* new BadRequest({ text: { key: "server.recipes.noFileInField", values: { field } } });
        }
        if (file.size === 0) return yield* new BadRequest({ text: "server.import.fileEmpty" });
        if (file.size > MAX_UPLOAD_BYTES) return yield* new PayloadTooLarge();

        const bytes = new Uint8Array(yield* Effect.promise(() => file.arrayBuffer()));
        if (bytes.byteLength > MAX_UPLOAD_BYTES) return yield* new PayloadTooLarge();

        const sniffed = sniffImageType(bytes);
        if (!sniffed) {
          return yield* new UnsupportedMediaType({ text: "server.recipes.unsupportedImageType" });
        }

        const filename = `${crypto.randomUUID()}.${sniffed.extension}`;
        yield* Effect.promise(() => mkdir(config.uploadDir, { recursive: true }));
        yield* Effect.promise(() => Bun.write(join(config.uploadDir, filename), bytes));
        // Head start only, and deliberately not awaited: the list thumbnail is built on
        // demand anyway, and a phone photo should not wait on a second encode.
        yield* thumbnails.warm(filename).pipe(Effect.ignoreCause, Effect.forkDetach);

        return {
          // Absolute when PUBLIC_API_URL is configured, otherwise a path the web dev
          // server proxies — both resolve to GET /uploads/:filename.
          //
          // SIGNED, because the picker renders this URL straight into an <img> before
          // the recipe is re-read. Sending it back as `imageUrl` is fine: every write
          // path strips the signature again (normalizeStoredUploadUrl), so the column
          // keeps the bare path. See lib/uploadUrls.ts.
          url: signUploadUrl(`${(config.PUBLIC_API_URL ?? "").replace(/\/+$/, "")}/uploads/${filename}`),
          filename,
          mimeType: sniffed.mimeType,
          size: bytes.byteLength,
        };
      });

      return Uploads.of({ storeUploadedImage });
    }),
  );
}

/* legacy bridges: callers listed; E3 (recipe), E4 (finance), E5 (scripts) remove them */

/**
 * Reads the multipart `file` field, validates size + real type and stores it.
 * Rejects with the 400/413/415 family error. Callers: `apps/api/src/modules/recipe/routes/recipes.ts`, the
 * core routes until E2-T10.
 */
export function storeUploadedImage(formData: FormData, field = "file"): Promise<UploadResponse> {
  return runtime.runPromise(Uploads.use((uploads) => uploads.storeUploadedImage(formData, field)));
}
