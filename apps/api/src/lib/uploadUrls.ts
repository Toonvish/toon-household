/**
 * Signed `/uploads/…` URLs.
 *
 * THE PROBLEM THIS SOLVES. `GET /uploads/:filename` used to be fully public: the
 * names are unguessable UUIDs, but anyone who ever saw a URL — including a member
 * who was since removed from the group — could fetch that file forever, with
 * `Cache-Control: public, immutable` on top.
 *
 * THE CONSTRAINT. A cookie check is not available here. Recipe hero images are
 * rendered with plain `<img>` in half a dozen components, the default deployment
 * is cross-origin (`:5173` -> `:3001`), and a cross-origin `<img>` sends no
 * credentials. So the authorisation has to travel IN the URL.
 *
 * THE SCHEME. `?exp=<unix ms>&sig=<hmac>` where the HMAC is SHA-256 over
 * `"<filename>|<exp>"` keyed with SESSION_SECRET, truncated to 128 bits. Minted
 * wherever a stored media path is serialised (the row -> DTO mappers), verified in
 * the route. Nothing signed is ever written to the database — {@link
 * normalizeStoredUploadUrl} strips a signature back off on every write path, so a
 * client that round-trips the URL it was given cannot persist an expiring value.
 *
 * WHY exp IS QUANTISED. A naive `now + ttl` would produce a different URL on every
 * response, which defeats both the browser cache and the service worker's image
 * cache (a new URL is a new cache entry, forever). So `exp` snaps to a
 * {@link SIGNED_URL_WINDOW_MS} boundary: every response inside one window carries
 * the identical URL, and the link a removed member kept dies within two windows.
 * That bound — not secrecy of the filename — is what limits the damage now.
 *
 * IMPORT SOURCE SCANS ARE NOT SIGNED ANYWHERE. Photos and PDFs uploaded for an
 * import are the private half of UPLOAD_DIR, and they are served only by the
 * membership-checked `GET /api/groups/:groupId/imports/:draftId/source`. Because
 * nothing mints a signature for `sourceMeta.storedPath`, no `/uploads/` URL for
 * one can exist. Do not "fix" that by signing it.
 */
import { env } from "../env.ts";
import { timingSafeEqualHex } from "./timingSafe.ts";

/** Path prefix of every served upload. */
const UPLOADS_PREFIX = "/uploads/";

/**
 * 12 hours. A signature is valid for between one and two windows, i.e. 12–24 h,
 * and is byte-identical for every response inside one window (see the header).
 */
export const SIGNED_URL_WINDOW_MS = 12 * 60 * 60 * 1000;

/** 128 bits of hex — short enough for a tidy URL, far too long to guess. */
const SIGNATURE_LENGTH = 32;

export const UPLOAD_EXP_PARAM = "exp";
export const UPLOAD_SIG_PARAM = "sig";

interface UploadRef {
  /** Origin the value carried (`""` for a relative path), preserved on re-signing. */
  prefix: string;
  /** Bare `<uuid>.<ext>` — never a path. */
  filename: string;
}

/**
 * Recognises a value that points at our own `/uploads/` route, in either the
 * relative (`/uploads/x.jpg`) or absolute (`https://api…/uploads/x.jpg`) form,
 * with or without an existing signature. Returns undefined for anything else —
 * an external `https://chefkoch.de/…` hero image, a `data:` URI, junk.
 */
function parseUploadRef(value: string): UploadRef | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;

  let pathname: string;
  let prefix: string;
  if (trimmed.startsWith("/")) {
    const cut = trimmed.search(/[?#]/);
    pathname = cut === -1 ? trimmed : trimmed.slice(0, cut);
    prefix = "";
  } else if (/^https?:\/\//i.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return undefined;
    }
    pathname = url.pathname;
    prefix = url.origin;
  } else {
    return undefined;
  }

  if (!pathname.startsWith(UPLOADS_PREFIX)) return undefined;

  let filename: string;
  try {
    filename = decodeURIComponent(pathname.slice(UPLOADS_PREFIX.length));
  } catch {
    return undefined;
  }
  // A nested path would already be rejected by the route's traversal check; refuse
  // to sign one at all so a signature can never vouch for something outside the dir.
  if (filename.length === 0 || filename.includes("/") || filename.startsWith(".")) {
    return undefined;
  }
  return { prefix, filename };
}

/** `exp` for a signature minted now: the end of the window after this one. */
export function currentExpiry(now: number = Date.now()): number {
  return (Math.floor(now / SIGNED_URL_WINDOW_MS) + 2) * SIGNED_URL_WINDOW_MS;
}

/** HMAC-SHA256(`<filename>|<exp>`) under SESSION_SECRET, hex, 128 bits. */
export function uploadSignature(filename: string, expiresAt: number): string {
  const hasher = new Bun.CryptoHasher("sha256", env.SESSION_SECRET);
  hasher.update(`${filename}|${expiresAt}`);
  return hasher.digest("hex").slice(0, SIGNATURE_LENGTH);
}

/**
 * Adds `?exp&sig` to a stored media value, keeping whatever origin it carried.
 *
 * Pass-through (unchanged) for null/undefined, external URLs and data: URIs, so
 * this is safe to wrap around any `imageUrl`-shaped column. Idempotent: an already
 * signed value is re-signed for the current window rather than double-signed.
 */
export function signUploadUrl<T extends string | null | undefined>(
  value: T,
  now: number = Date.now(),
): T {
  if (typeof value !== "string") return value;
  const ref = parseUploadRef(value);
  if (!ref) return value;
  const expiresAt = currentExpiry(now);
  const signature = uploadSignature(ref.filename, expiresAt);
  const path = `${UPLOADS_PREFIX}${encodeURIComponent(ref.filename)}`;
  return `${ref.prefix}${path}?${UPLOAD_EXP_PARAM}=${expiresAt}&${UPLOAD_SIG_PARAM}=${signature}` as T;
}

/**
 * The inverse, for every WRITE path: reduces a client-supplied media value to the
 * canonical relative form `/uploads/<filename>`.
 *
 * Two things this prevents. (1) A signature persisted into `recipes.image_url`
 * would expire and leave a permanently broken image. (2) A stored absolute URL
 * would pin the row to whatever origin the API happened to answer on, which
 * breaks the moment the deployment moves or is put behind a proxy.
 *
 * Anything that is not one of our upload URLs is returned untouched — external
 * hero images are legitimate values.
 */
export function normalizeStoredUploadUrl<T extends string | null | undefined>(value: T): T {
  if (typeof value !== "string") return value;
  const ref = parseUploadRef(value);
  if (!ref) return value;
  return `${UPLOADS_PREFIX}${ref.filename}` as T;
}

export type UploadSignatureVerdict = "ok" | "missing" | "expired" | "invalid";

/**
 * Checks the query of an `/uploads/:filename` request.
 *
 * Split verdicts so the route can answer 404 for a missing/forged signature (it
 * must not confirm that the file exists) while still logging why.
 */
export function verifyUploadSignature(
  filename: string,
  exp: string | undefined,
  sig: string | undefined,
  now: number = Date.now(),
): UploadSignatureVerdict {
  if (exp === undefined || sig === undefined || exp.length === 0 || sig.length === 0) {
    return "missing";
  }
  const expiresAt = Number.parseInt(exp, 10);
  if (!Number.isSafeInteger(expiresAt) || String(expiresAt) !== exp) return "invalid";

  // Verify BEFORE checking the clock: `exp` is part of the signed payload, so an
  // attacker cannot extend a URL by editing it, and comparing first keeps the
  // "invalid" and "expired" paths from depending on each other.
  const expected = uploadSignature(filename, expiresAt);
  if (!timingSafeEqualHex(expected, sig)) return "invalid";
  if (expiresAt <= now) return "expired";
  return "ok";
}
