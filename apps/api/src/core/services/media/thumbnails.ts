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
 * a missing derivative on first request and caches it on disk; {@link warmThumbnail}
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
import { env } from "../../../env.ts";
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
 * Path to serve for a `<original>.thumb.webp` request, building the file if needed.
 *
 * Returns undefined when the name is not a derivative or the original is gone — the
 * caller answers 404 for both, exactly as it does for a missing upload.
 */
export async function resolveThumbnail(filename: string): Promise<ResolvedThumbnail | undefined> {
  const original = originalOfThumbnail(filename);
  if (original === undefined) return undefined;

  const originalPath = join(env.uploadDir, original);
  if (!originalPath.startsWith(env.uploadDir) || !existsSync(originalPath)) return undefined;

  const thumbnailPath = join(env.uploadDir, filename);
  const built = await ensureThumbnail(originalPath, thumbnailPath);
  return built ? { path: thumbnailPath, fallback: false } : { path: originalPath, fallback: true };
}

/**
 * Builds the derivative for a freshly stored upload without making the caller wait.
 *
 * Never throws and never rejects: the upload response must not depend on it, and if
 * this loses a race against the first `GET`, {@link ensureThumbnail} de-duplicates
 * the work anyway.
 */
export function warmThumbnail(filename: string): void {
  // Off under `bun test`: an unawaited write into the shared UPLOAD_DIR lands AFTER
  // the test that triggered it has cleaned up, which leaves an orphan behind on every
  // run. The route path this delegates to is covered directly (test/thumbnails.test.ts).
  if (env.isTest) return;
  const url = thumbnailUrlFor(`${UPLOADS_PREFIX}${filename}`);
  if (url === null) return;
  void resolveThumbnail(url.slice(UPLOADS_PREFIX.length)).catch(() => undefined);
}

/* -------------------------------- internals ------------------------------- */

/** Keyed by thumbnail path, so two concurrent requests share one conversion. */
const inFlight = new Map<string, Promise<boolean>>();
/** Thumbnail path -> when the last attempt failed. Keeps a HEIC list off the CPU. */
const failedAt = new Map<string, number>();

async function ensureThumbnail(originalPath: string, thumbnailPath: string): Promise<boolean> {
  if (existsSync(thumbnailPath)) return true;

  const pending = inFlight.get(thumbnailPath);
  if (pending !== undefined) return await pending;

  const failure = failedAt.get(thumbnailPath);
  if (failure !== undefined && Date.now() - failure < FAILURE_TTL_MS) return false;

  const task = withSlot(() => generate(originalPath, thumbnailPath)).finally(() => {
    inFlight.delete(thumbnailPath);
  });
  inFlight.set(thumbnailPath, task);
  return await task;
}

async function generate(originalPath: string, thumbnailPath: string): Promise<boolean> {
  const sharp = await loadSharp();
  if (sharp === undefined) return false;

  // Written under a temp name and renamed: a concurrent reader must never be handed
  // a half-written WebP, and rename() within one directory is atomic.
  const temporaryPath = `${thumbnailPath}.${crypto.randomUUID().slice(0, 8)}.tmp`;
  try {
    const bytes = await sharp(originalPath, { failOn: "none", limitInputPixels: MAX_INPUT_PIXELS })
      // Phones store portrait as EXIF; without this the thumbnail lies on its side.
      .rotate()
      .resize({ width: THUMBNAIL_WIDTH, withoutEnlargement: true })
      .webp({ quality: 72 })
      .toBuffer();
    await mkdir(env.uploadDir, { recursive: true });
    await Bun.write(temporaryPath, bytes);
    await rename(temporaryPath, thumbnailPath);
    failedAt.delete(thumbnailPath);
    return true;
  } catch (error) {
    failedAt.set(thumbnailPath, Date.now());
    await unlink(temporaryPath).catch(() => undefined);
    if (!env.isTest) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[thumbs] ${basename(thumbnailPath)}: ${reason.slice(0, 160)}`);
    }
    return false;
  }
}

let active = 0;
const waiting: Array<() => void> = [];

async function withSlot<T>(task: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve));
  active += 1;
  try {
    return await task();
  } finally {
    active -= 1;
    waiting.shift()?.();
  }
}

let sharpModule: SharpFactory | undefined;
let sharpMissing = false;

/** Lazy, cached, and never throws — a server without sharp still serves originals. */
async function loadSharp(): Promise<SharpFactory | undefined> {
  if (sharpModule !== undefined) return sharpModule;
  if (sharpMissing) return undefined;
  try {
    const module = await import("sharp");
    sharpModule = module.default;
    return sharpModule;
  } catch {
    sharpMissing = true;
    return undefined;
  }
}
