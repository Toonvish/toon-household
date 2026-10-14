/**
 * Hero-image download for URL imports.
 *
 * Best-effort by contract: a recipe without its photo is still a good import, so
 * EVERY failure here is swallowed and the original remote URL is kept instead.
 * The same SSRF guard as the page fetch applies (an `<img src>` is attacker
 * controlled just like the page URL), plus a 4 MB / 8 s budget and magic-byte
 * validation so we never store an HTML error page as "the photo".
 */
import { warmThumbnail } from "../../../../../core/services/media/thumbnails.ts";
import { type SniffedMime, sniffMimeType, storeUpload } from "../files.ts";
import { IMPORT_USER_AGENT } from "./fetch.ts";
import { assertPublicUrl, type AssertPublicUrlOptions } from "./ssrf.ts";

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const IMAGE_TIMEOUT_MS = 8_000;

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

export interface DownloadHeroImageOptions extends AssertPublicUrlOptions {
  /** Page URL, used as the Referer (many CDNs require it) and for logging. */
  refererUrl?: string;
  timeoutMs?: number;
  maxBytes?: number;
  fetchImpl?: typeof fetch;
}

export interface DownloadedImage {
  /** Stored filename under UPLOAD_DIR. */
  filename: string;
  /** Local URL to use as `parsed.imageUrl`. */
  url: string;
  mimeType: string;
  size: number;
}

/**
 * Downloads and stores a remote image.
 * @returns the stored image, or undefined when anything went wrong.
 */
export async function downloadHeroImage(
  imageUrl: string,
  options: DownloadHeroImageOptions = {},
): Promise<DownloadedImage | undefined> {
  if (typeof imageUrl !== "string" || imageUrl.length === 0) return undefined;
  if (imageUrl.startsWith("data:")) return await storeDataUrl(imageUrl);

  const maxBytes = options.maxBytes ?? MAX_IMAGE_BYTES;
  const doFetch = options.fetchImpl ?? fetch;

  let target: URL;
  try {
    // SsrfError is the expected rejection; anything else (a malformed URL, a DNS
    // failure) is just as much "no photo", so both fall into the same undefined.
    target = await assertPublicUrl(imageUrl, options);
  } catch {
    return undefined;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? IMAGE_TIMEOUT_MS);
  try {
    const response = await doFetch(target.href, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": IMPORT_USER_AGENT,
        Accept: "image/avif,image/webp,image/jpeg,image/png,*/*;q=0.8",
        "Accept-Language": "de-DE,de;q=0.9",
        ...(options.refererUrl === undefined ? {} : { Referer: options.refererUrl }),
      },
    });
    if (!response.ok) return undefined;

    const declared = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > maxBytes) return undefined;

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0 || buffer.byteLength > maxBytes) return undefined;

    return await storeSniffedImage(new Uint8Array(buffer));
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** Stores an inline `data:image/...;base64,...` hero image. */
async function storeDataUrl(dataUrl: string): Promise<DownloadedImage | undefined> {
  const match = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
  if (!match) return undefined;
  try {
    const binary = Buffer.from(match[2]!.replace(/\s+/g, ""), "base64");
    if (binary.byteLength === 0 || binary.byteLength > MAX_IMAGE_BYTES) return undefined;
    return await storeSniffedImage(new Uint8Array(binary));
  } catch {
    return undefined;
  }
}

/**
 * The last three steps both paths share: trust the MAGIC BYTES over whatever the
 * response or the `data:` prefix claimed, store, and get the list thumbnail built.
 *
 * @returns undefined when the bytes are not a storable image — the caller's
 *   contract is that a missing photo is still a good import.
 */
async function storeSniffedImage(bytes: Uint8Array): Promise<DownloadedImage | undefined> {
  const mimeType = sniffMimeType(bytes);
  if (mimeType === undefined || !STORABLE_IMAGE_TYPES.includes(mimeType)) return undefined;

  const stored = await storeUpload(bytes, mimeType);
  // The hero image goes straight onto a list screen once the draft is committed,
  // so build its thumbnail now rather than on that first render.
  warmThumbnail(stored.filename);
  return { filename: stored.filename, url: stored.url, mimeType: stored.mimeType, size: stored.size };
}
