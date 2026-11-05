/**
 * List thumbnails for stored uploads.
 *
 * THE PROBLEM. `recipes.image_url` points at the original upload — a phone photo or
 * a hero image the URL importer downloaded, routinely 2–5 MB. The recipe list asks
 * for up to 24 of them at once, so a single screen used to pull tens of megabytes
 * through a home uplink to paint images no larger than a thumb.
 *
 * THE SCHEME. A derivative lives NEXT TO the original under a name built from it:
 * `<uuid>.jpg` -> `<uuid>.jpg.thumb.webp`, {@link THUMBNAIL_WIDTH} px wide WebP.
 * Because that is still one flat filename under UPLOAD_DIR, everything around it
 * keeps working untouched: `signUploadUrl()` signs it like any other upload, the
 * `/uploads/:filename` route serves it, and the traversal checks are the same ones.
 *
 * IT IS BUILT ON DEMAND, not at upload time — that is deliberate. The URL is minted
 * from the row (see `toRecipe`), which knows nothing about what exists on disk, so
 * every recipe stored before this feature, and every one whose image arrived through
 * a path that forgot to warm it, has to work anyway. {@link resolveThumbnail} builds
 * a missing derivative on first request and caches it on disk; `Thumbnails.warm`
 * is only a head start for the common case.
 *
 * A FAILED CONVERSION SERVES THE ORIGINAL. sharp may be missing entirely, or built
 * without the HEIF plugin — an iPhone HEIC is the realistic case. Answering 404 there
 * would turn a working recipe into a broken `<img>`, so the route falls back to the
 * full-size file and says so via a short max-age, which lets the answer heal itself
 * once the derivative can be built.
 */
import { existsSync } from "node:fs";
import { mkdir, rename, unlink } from "node:fs/promises";
import { basename, join } from "node:path";
import { Cause, Clock, Context, Deferred, Effect, Exit, Layer, Predicate, Semaphore } from "effect";
import { AppConfig } from "../../../config.ts";
import { normalizeStoredUploadUrl } from "../../../lib/uploadUrls.ts";

/** sharp's callable default export (the namespace itself is not callable). */
type SharpFactory = typeof import("sharp").default;

const UPLOADS_PREFIX = "/uploads/";

/**
 * Appended to the ORIGINAL filename, extension included, so the original can be
 * recovered by stripping it — no directory scan to guess the source extension.
 */
export const THUMBNAIL_SUFFIX = ".thumb.webp";

/**
 * 480 px. Covers both list layouts: the ~64 px row thumbnail even on a 3× phone,
 * and the card in the desktop grid (~360 px at its widest). ~20–40 KB each.
 */
export const THUMBNAIL_WIDTH = 480;

/** Same ceiling the OCR preprocessor uses — a decompression bomb must not OOM us. */
const MAX_INPUT_PIXELS = 400_000_000;

/** Two at a time: a cold list of 24 images would otherwise fork 24 resizes at once. */
const MAX_CONCURRENT = 2;

/** How long a failed conversion is remembered before it is attempted again. */
const FAILURE_TTL_MS = 10 * 60 * 1000;

export function isThumbnailName(filename: string): boolean {
  return filename.length > THUMBNAIL_SUFFIX.length && filename.endsWith(THUMBNAIL_SUFFIX);
}

/**
 * `<uuid>.jpg.thumb.webp` -> `<uuid>.jpg`, or undefined when the name is not a
 * derivative or the remainder is not a bare filename.
 */
export function originalOfThumbnail(filename: string): string | undefined {
  if (!isThumbnailName(filename)) return undefined;
  const original = filename.slice(0, -THUMBNAIL_SUFFIX.length);
  if (original.length === 0 || original.includes("/") || original.startsWith(".")) return undefined;
  return original;
}

/**
 * The derivative URL for a stored media value, in the same bare
 * `/uploads/<filename>` form the columns hold — sign it before putting it on the wire.
 *
 * Returns null for anything we do not host (an external hero image, a `data:` URI,
 * null), because there is nothing local to downscale. Already-derivative values are
 * returned as they are: a thumbnail of a thumbnail is never wanted.
 */
export function thumbnailUrlFor(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const normalized = normalizeStoredUploadUrl(value);
  if (!normalized.startsWith(UPLOADS_PREFIX)) return null;
  const filename = normalized.slice(UPLOADS_PREFIX.length);
  if (filename.length === 0 || filename.includes("/") || filename.startsWith(".")) return null;
  if (isThumbnailName(filename)) return normalized;
  return `${normalized}${THUMBNAIL_SUFFIX}`;
}

/**
 * The image a LIST row renders for a recipe, in the same bare column form as
 * {@link thumbnailUrlFor} — sign it before putting it on the wire.
 *
 * The derivative when we host the original, otherwise the original itself: an
 * external hero image (a URL import that kept the site's picture) has nothing local
 * to downscale, and the slim DTOs (`PlanRecipe`, `ShoppingListRecipe`, the from-plan
 * preview row) carry NO `imageUrl` for the client's `thumbnailUrl()` helper to fall
 * back to — so a bare `thumbnailUrlFor()` there rendered every imported recipe as
 * an empty grey square on `/plan` and in "Aus dem Wochenplan". The full `Recipe`
 * DTO does not need this: it ships both fields and the client picks.
 */
export function listImageUrlFor(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return thumbnailUrlFor(value) ?? value;
}

export interface ResolvedThumbnail {
  /** Absolute path of the file to serve. */
  path: string;
  /** True when the derivative could not be built and this is the full-size original. */
  fallback: boolean;
}

/**
 * The thumbnails as a service (docs/EFFECT.md E7; plan e2 P10). State lives in the layer: `inFlight` shares one
 * conversion between concurrent requests, `failedAt` is the failure cache (the `Clock`'s time, so a `TestClock` can
 * run out the TTL), a `Semaphore` is the two-at-a-time concurrency gate, and sharp loads lazily.
 *
 * Neither method fails: the generation keeps its catch-all (plan e2 P2), ANY failure of sharp or the disk, a
 * synchronous throw included, records the failure time and answers "fall back to the original".
 */
export class Thumbnails extends Context.Service<
  Thumbnails,
  {
    /**
     * Path to serve for a `<original>.thumb.webp` request, building the file if needed; `undefined` when the name is
     * not a derivative or the original is gone (the caller answers 404 for both, as for a missing upload).
     */
    readonly resolveThumbnail: (filename: string) => Effect.Effect<ResolvedThumbnail | undefined>;
    /** Builds the derivative for a freshly stored upload; a no-op under `NODE_ENV=test`. Never fails. */
    readonly warm: (filename: string) => Effect.Effect<void>;
  }
>()("toon/api/core/services/media/thumbnails/Thumbnails") {
  static readonly layer = Layer.effect(
    Thumbnails,
    Effect.gen(function* () {
      const config = yield* AppConfig;
      const slots = yield* Semaphore.make(MAX_CONCURRENT);
      /** Keyed by thumbnail path, so two concurrent requests share one conversion. */
      const inFlight = new Map<string, Deferred.Deferred<boolean>>();
      /** Thumbnail path -> when the last attempt failed. Keeps a HEIC list off the CPU. */
      const failedAt = new Map<string, number>();

      const generate = Effect.fnUntraced(function* (
        originalPath: string,
        thumbnailPath: string,
      ): Effect.fn.Return<boolean> {
        const sharp = yield* loadSharp;
        if (sharp === undefined) return false;

        // Written under a temp name and renamed: a concurrent reader must never be handed
        // a half-written WebP, and rename() within one directory is atomic.
        const temporaryPath = `${thumbnailPath}.${crypto.randomUUID().slice(0, 8)}.tmp`;
        return yield* Effect.tryPromise({
          try: async () => {
            const bytes = await sharp(originalPath, { failOn: "none", limitInputPixels: MAX_INPUT_PIXELS })
              // Phones store portrait as EXIF; without this the thumbnail lies on its side.
              .rotate()
              .resize({ width: THUMBNAIL_WIDTH, withoutEnlargement: true })
              .webp({ quality: 72 })
              .toBuffer();
            await mkdir(config.uploadDir, { recursive: true });
            await Bun.write(temporaryPath, bytes);
            await rename(temporaryPath, thumbnailPath);
          },
          catch: (cause) => cause,
        }).pipe(
          Effect.tap(() => Effect.sync(() => failedAt.delete(thumbnailPath))),
          Effect.as(true),
          // The WHOLE cause: the old `try/catch` took everything sharp or the disk could throw (plan e2 P2).
          Effect.catchCause((cause) =>
            Effect.gen(function* () {
              failedAt.set(thumbnailPath, yield* Clock.currentTimeMillis);
              yield* Effect.promise(() => unlink(temporaryPath).catch(() => undefined));
              if (!config.isTest) {
                const error = Cause.squash(cause);
                const reason = Predicate.isError(error) ? error.message : String(error);
                console.warn(`[thumbs] ${basename(thumbnailPath)}: ${reason.slice(0, 160)}`);
              }
              return false;
            }),
          ),
        );
      });

      const ensureThumbnail = Effect.fnUntraced(function* (
        originalPath: string,
        thumbnailPath: string,
      ): Effect.fn.Return<boolean> {
        if (existsSync(thumbnailPath)) return true;

        const pending = inFlight.get(thumbnailPath);
        if (pending !== undefined) return yield* Deferred.await(pending);

        const failure = failedAt.get(thumbnailPath);
        if (failure !== undefined && (yield* Clock.currentTimeMillis) - failure < FAILURE_TTL_MS) return false;

        // The conversion runs in a detached fiber, so a requester that goes away (an aborted request) does not take
        // the shared work with it; every requester awaits the same `Deferred`.
        const done = yield* Deferred.make<boolean>();
        inFlight.set(thumbnailPath, done);
        yield* slots.withPermits(1)(generate(originalPath, thumbnailPath)).pipe(
          Effect.onExit((exit) =>
            Effect.sync(() => inFlight.delete(thumbnailPath)).pipe(
              Effect.andThen(Deferred.done(done, Exit.isSuccess(exit) ? exit : Exit.succeed(false))),
              Effect.asVoid,
            ),
          ),
          Effect.forkDetach,
        );
        return yield* Deferred.await(done);
      });

      const resolveThumbnail = Effect.fn("Thumbnails.resolveThumbnail")(function* (
        filename: string,
      ): Effect.fn.Return<ResolvedThumbnail | undefined> {
        const original = originalOfThumbnail(filename);
        if (original === undefined) return undefined;

        const originalPath = join(config.uploadDir, original);
        if (!originalPath.startsWith(config.uploadDir) || !existsSync(originalPath)) return undefined;

        const thumbnailPath = join(config.uploadDir, filename);
        const built = yield* ensureThumbnail(originalPath, thumbnailPath);
        return built ? { path: thumbnailPath, fallback: false } : { path: originalPath, fallback: true };
      });

      const warm = Effect.fn("Thumbnails.warm")(function* (filename: string) {
        // Off under `bun test`: an unawaited write into the shared UPLOAD_DIR lands AFTER the test that triggered it
        // has cleaned up, which leaves an orphan behind on every run. The route path this delegates to is covered
        // directly (test/thumbnails.test.ts).
        if (config.isTest) return;
        const url = thumbnailUrlFor(`${UPLOADS_PREFIX}${filename}`);
        if (url === null) return;
        yield* resolveThumbnail(url.slice(UPLOADS_PREFIX.length));
      });

      return Thumbnails.of({ resolveThumbnail, warm });
    }),
  );
}

/* -------------------------------- internals ------------------------------- */

let sharpModule: SharpFactory | undefined;
let sharpMissing = false;

/** Lazy, cached, and never fails: a server without sharp still serves originals. */
const loadSharp: Effect.Effect<SharpFactory | undefined> = Effect.suspend(() => {
  if (sharpModule !== undefined) return Effect.succeed(sharpModule);
  if (sharpMissing) return Effect.succeed(undefined);
  return Effect.tryPromise({ try: () => import("sharp"), catch: () => undefined }).pipe(
    Effect.map((loaded) => {
      sharpModule = loaded.default;
      return sharpModule;
    }),
    Effect.catch(() =>
      Effect.sync(() => {
        sharpMissing = true;
        return undefined;
      }),
    ),
  );
});
