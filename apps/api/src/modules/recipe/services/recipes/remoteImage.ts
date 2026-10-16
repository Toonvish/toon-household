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
import { env } from "../../../../env.ts";
import { normalizeStoredUploadUrl } from "../../../../lib/uploadUrls.ts";
import { downloadHeroImage } from "../import/url/image.ts";

/** Stores the image behind `url` and answers its local `/uploads/<file>`, or undefined. */
export type RemoteImageDownloader = (url: string) => Promise<{ url: string } | undefined>;

const networkDownloader: RemoteImageDownloader = async (url) => await downloadHeroImage(url);
const offlineDownloader: RemoteImageDownloader = async () => undefined;

let override: RemoteImageDownloader | null = null;

/** Test seam: replace the downloader (null = restore the default). */
export function setRemoteImageDownloaderForTests(next: RemoteImageDownloader | null): void {
  if (!env.isTest) throw new Error("setRemoteImageDownloaderForTests is only available under NODE_ENV=test");
  override = next;
}

function downloader(): RemoteImageDownloader {
  return override ?? (env.isTest ? offlineDownloader : networkDownloader);
}

/** True for a value that is not one of our uploads and can be copied: `http(s):` or `data:image/`. */
export function isRemoteImageUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) || /^data:image\//i.test(value);
}

/**
 * The value a media column should store: our own uploads reduced to the bare
 * `/uploads/<file>` (as `normalizeStoredUploadUrl`), a remote image replaced by a
 * local copy when one can be made, anything else unchanged.
 *
 * @param previous the column's current value; a remote URL equal to it is not
 *   downloaded again (an unrelated edit of a recipe whose source is gone must not
 *   wait for another failed download on every save).
 */
export async function localizeImageUrl(
  value: string | null | undefined,
  previous?: string | null,
): Promise<string | null | undefined> {
  const normalized = normalizeStoredUploadUrl(value);
  if (typeof normalized !== "string" || !isRemoteImageUrl(normalized)) return normalized;
  if (previous !== undefined && previous === normalized) return normalized;
  try {
    const stored = await downloader()(normalized);
    return stored?.url ?? normalized;
  } catch {
    return normalized;
  }
}
