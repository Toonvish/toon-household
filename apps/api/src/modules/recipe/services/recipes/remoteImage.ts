/**
 * Local copies of remote recipe images.
 *
 * A hero image or collection cover given as a remote `http(s):` URL (pasted into
 * the recipe form, or left in an import draft whose own download failed or was
 * edited on the review screen) used to be stored as that URL, so the picture
 * vanished the day the site removed it or went offline. Every write path now runs
 * the value through `localizeImageUrl` first: the image is downloaded with the URL
 * importer's guarded fetch (SSRF check, 4 MB / 8 s budget, magic-byte sniff) and the
 * column gets the bare `/uploads/<file>` instead.
 *
 * Best-effort, like the importer: when the download fails the remote URL is kept,
 * so a save never fails because of the picture. `data:` images go the same way
 * (decoded and stored instead of landing in the column).
 *
 * Under `bun test` the default downloader never touches the network (it answers
 * "no copy", so the remote URL is kept); a test that wants a copy installs one with
 * `setRemoteImageDownloaderForTests`.
 */
import { Context, Effect, Layer, Predicate } from "effect";
import { AppConfig } from "../../../../config.ts";
import { env } from "../../../../env.ts";
import { normalizeStoredUploadUrl } from "../../../../lib/uploadUrls.ts";
import { HeroImages } from "../import/url/image.ts";

/** Stores the image behind `url` and answers its local `/uploads/<file>`, or undefined. */
export type RemoteImageDownloader = (url: string) => Promise<{ url: string } | undefined>;

let override: RemoteImageDownloader | null = null;

/**
 * Test seam: replace the downloader (null = restore the default). A plain synchronous function called by tests outside
 * any effect; its `NODE_ENV=test` guard is the one tolerated `throw` of recipe code (plan e3 P1).
 */
export function setRemoteImageDownloaderForTests(next: RemoteImageDownloader | null): void {
  if (!env.isTest) throw new Error("setRemoteImageDownloaderForTests is only available under NODE_ENV=test");
  override = next;
}

/** True for a value that is not one of our uploads and can be copied: `http(s):` or `data:image/`. */
export function isRemoteImageUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) || /^data:image\//i.test(value);
}

/** Local copies of remote images, for every write path that stores a hero image or a cover. Never fails. */
export class RemoteImages extends Context.Service<
  RemoteImages,
  {
    /**
     * The value a media column should store: our own uploads reduced to the bare
     * `/uploads/<file>` (as `normalizeStoredUploadUrl`), a remote image replaced by a
     * local copy when one can be made, anything else unchanged.
     *
     * @param previous the column's current value; a remote URL equal to it is not
     *   downloaded again (an unrelated edit of a recipe whose source is gone must not
     *   wait for another failed download on every save).
     */
    readonly localizeImageUrl: (
      value: string | null | undefined,
      previous?: string | null,
    ) => Effect.Effect<string | null | undefined>;
  }
>()("toon/api/modules/recipe/services/recipes/remoteImage/RemoteImages") {
  static readonly layer = Layer.effect(
    RemoteImages,
    Effect.gen(function* () {
      const config = yield* AppConfig;
      const heroImages = yield* HeroImages;

      /** The downloader of this call: the seam when installed, else offline under test, else the network one. */
      const download = (url: string): Effect.Effect<{ url: string } | undefined, unknown> => {
        const seam = override;
        if (seam !== null) return Effect.tryPromise({ try: () => seam(url), catch: (cause): unknown => cause });
        if (config.isTest) return Effect.succeed(undefined);
        return heroImages.downloadHeroImage(url);
      };

      const localizeImageUrl = Effect.fn("RemoteImages.localizeImageUrl")(function* (
        value: string | null | undefined,
        previous?: string | null,
      ) {
        const normalized = normalizeStoredUploadUrl(value);
        if (!Predicate.isString(normalized) || !isRemoteImageUrl(normalized)) return normalized;
        if (previous !== undefined && previous === normalized) return normalized;
        // Catch-all stays catch-all (plan e3 P8): any failure, a defect or a throwing seam included, keeps the URL.
        const stored = yield* download(normalized).pipe(Effect.catchCause(() => Effect.succeed(undefined)));
        return stored?.url ?? normalized;
      });

      return RemoteImages.of({ localizeImageUrl });
    }),
  );
}
