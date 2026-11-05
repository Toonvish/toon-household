/**
 * Hero-image download for URL imports (docs/EFFECT.md E7, E12; plan `docs/plans/e3-recipe-services.md` P8, P12).
 *
 * Best-effort by contract: a recipe without its photo is still a good import, so EVERY failure here (the whole cause,
 * defects included) is swallowed and `undefined` answered, and the original remote URL is kept by the caller. The same
 * SSRF guard as the page fetch applies (an `<img src>` is attacker controlled just like the page URL; `ImportHttp.fetchImage`
 * checks the first URL only, the CDN redirects are followed by the client), plus a 4 MB / 8 s budget and magic-byte
 * validation so we never store an HTML error page as "the photo".
 *
 * `HeroImages` is the service: `ImportHttp.fetchImage` for the bytes, `ImportFiles.storeUpload` for the file, and the
 * list thumbnail through `Thumbnails.warm` in a DETACHED fiber that nobody awaits (the old unawaited `warmThumbnail`).
 */
import { Context, Effect, Layer, Predicate } from "effect";
import { Thumbnails } from "../../../../../core/services/media/thumbnails.ts";
import { type SniffedMime, ImportFiles, sniffMimeType } from "../files.ts";
import { ImportHttp, MAX_IMAGE_FETCH_BYTES } from "./fetch.ts";

/** Sniffed types worth storing as a recipe photo. */
const STORABLE_IMAGE_TYPES: readonly SniffedMime[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
  "image/heic",
  "image/heif",
];

export interface DownloadHeroImageOptions {
  /** Page URL, used as the Referer (many CDNs require it). */
  readonly refererUrl?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly maxBytes?: number | undefined;
}

export interface DownloadedImage {
  /** Stored filename under UPLOAD_DIR. */
  filename: string;
  /** Local URL to use as `parsed.imageUrl`. */
  url: string;
  mimeType: string;
  size: number;
}

const DATA_URL_RE = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/;

/** The hero-image downloader. Never fails: `undefined` is "no photo". */
export class HeroImages extends Context.Service<
  HeroImages,
  {
    /**
     * Downloads and stores a remote image (or decodes and stores an inline `data:image/...;base64,...` one).
     * @returns the stored image, or undefined when anything went wrong.
     */
    readonly downloadHeroImage: (
      imageUrl: string,
      options?: DownloadHeroImageOptions,
    ) => Effect.Effect<DownloadedImage | undefined>;
  }
>()("toon/api/modules/recipe/services/import/url/image/HeroImages") {
  static readonly layer = Layer.effect(
    HeroImages,
    Effect.gen(function* () {
      const http = yield* ImportHttp;
      const files = yield* ImportFiles;
      const thumbnails = yield* Thumbnails;

      /**
       * The last steps both paths share: trust the MAGIC BYTES over whatever the response or the `data:` prefix claimed,
       * store, and get the list thumbnail built (started, never awaited: the hero image goes straight onto a list
       * screen once the draft is committed, so build its thumbnail now rather than on that first render).
       *
       * @returns undefined when the bytes are not a storable image.
       */
      const storeSniffedImage = Effect.fnUntraced(function* (
        bytes: Uint8Array,
      ): Effect.fn.Return<DownloadedImage | undefined> {
        const mimeType = sniffMimeType(bytes);
        if (mimeType === undefined || !STORABLE_IMAGE_TYPES.includes(mimeType)) return undefined;

        const stored = yield* files.storeUpload(bytes, mimeType);
        yield* Effect.forkDetach(thumbnails.warm(stored.filename).pipe(Effect.ignoreCause));
        return { filename: stored.filename, url: stored.url, mimeType: stored.mimeType, size: stored.size };
      });

      const storeDataUrl = Effect.fnUntraced(function* (dataUrl: string): Effect.fn.Return<DownloadedImage | undefined> {
        const match = DATA_URL_RE.exec(dataUrl);
        if (match === null) return undefined;
        const binary = Buffer.from(match[2]!.replace(/\s+/g, ""), "base64");
        if (binary.byteLength === 0 || binary.byteLength > MAX_IMAGE_FETCH_BYTES) return undefined;
        return yield* storeSniffedImage(new Uint8Array(binary));
      });

      const downloadHeroImage = Effect.fn("HeroImages.downloadHeroImage")(function* (
        imageUrl: string,
        options: DownloadHeroImageOptions = {},
      ): Effect.fn.Return<DownloadedImage | undefined> {
        if (!Predicate.isString(imageUrl) || imageUrl.length === 0) return undefined;
        if (imageUrl.startsWith("data:")) return yield* storeDataUrl(imageUrl);

        const bytes = yield* http.fetchImage(imageUrl, {
          ...(options.refererUrl === undefined ? {} : { refererUrl: options.refererUrl }),
          ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
          ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
        });
        if (bytes === undefined) return undefined;
        return yield* storeSniffedImage(bytes);
      },
      // Catch-all stays catch-all (plan e3 P8): the old `try { … } catch { return undefined }` took a disk error too.
      Effect.catchCause(() => Effect.succeed(undefined)));

      return HeroImages.of({ downloadHeroImage });
    }),
  );
}
