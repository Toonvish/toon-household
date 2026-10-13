/**
 * Constant-time comparison for the hex digests this app compares by hand.
 *
 * Lives in `lib/` because two unrelated layers need the same primitive — the
 * upload-URL signature check ({@link file://./uploadUrls.ts}) and the mailed
 * single-use tokens (`services/auth/tokens.ts`) — and each having its own copy is
 * how one of them quietly gets "optimised" into an early-returning `!==`.
 *
 * Token lookups themselves go through a UNIQUE index on the hash, so there is no
 * secret to leak by timing on that path; this is for the places that compare a
 * recomputed digest against one already in hand.
 */

/** Length-checked, branch-free comparison of two hex strings. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}
