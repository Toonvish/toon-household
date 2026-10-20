/**
 * OWNER: auth agent.
 *
 * Minting and hashing for the single-use secrets that travel in a mailed link
 * (password reset, e-mail confirmation).
 *
 * TWO RULES, both deliberate:
 *
 *  1. The token is 32 bytes of CSPRNG output, base64url — the same entropy as a
 *     session id, because a reset token is briefly worth exactly as much.
 *  2. Only its SHA-256 hash is stored. `household_invites` keeps the raw token and
 *     that is fine (a leaked invite costs household membership); a leaked reset table
 *     would cost every account, so this one is one-way. No salt and no argon2:
 *     the input is already 256 random bits, so there is nothing to grind, and a
 *     salted hash could not be looked up by token at all.
 *
 * `spendableToken` is the verdict as an Effect on the `Clock` (docs/EFFECT.md E7; plan
 * `docs/plans/e2-api-core-services.md` P7). `assertSpendableToken` (its `Date.now()` default included) stays as it is
 * until E2-T08 moves its two callers (`emailVerification.ts`, `passwordReset.ts`) onto `spendableToken` and deletes it.
 */

import { Clock, Effect } from "effect";

/** 32 random bytes, URL-safe base64 (43 chars) — safe in a path segment. */
export function generateOpaqueToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

/** SHA-256 (hex) of a token — the only form that ever reaches the database. */
export function hashToken(token: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(token);
  return hasher.digest("hex");
}

/** Re-exported so a token comparison never grows a second implementation. */
export { timingSafeEqualHex } from "../../../lib/timingSafe.ts";

/** The two columns every mailed-token table shares, and all this guard reads. */
interface SpendableTokenRow {
  usedAt: number | null;
  expiresAt: number;
}

/**
 * The "is this row still worth anything" half of a token lookup, identical for
 * password reset and e-mail confirmation.
 *
 * UNKNOWN, ALREADY-USED AND EXPIRED MUST BE INDISTINGUISHABLE, which is why the
 * caller passes ONE `invalid` factory and every branch here throws it — three
 * different errors would tell an attacker whether the token ever existed. Keeping
 * the query at the call site keeps drizzle's row type exact; only the verdict is
 * shared.
 */
export function assertSpendableToken<T extends SpendableTokenRow>(
  row: T | undefined,
  invalid: () => Error,
  now: number = Date.now(),
): T {
  if (!row) throw invalid();
  if (row.usedAt !== null) throw invalid();
  if (row.expiresAt <= now) throw invalid();
  return row;
}

/**
 * {@link assertSpendableToken} on the `Clock`: the same verdict, with "now" read from `Clock.currentTimeMillis` (so a
 * `TestClock` reaches it). Every branch fails with the ONE refusal `invalid` builds — unknown, already-used and
 * expired stay indistinguishable.
 */
export const spendableToken = Effect.fnUntraced(function* <T extends SpendableTokenRow, E>(
  row: T | undefined,
  invalid: () => E,
): Effect.fn.Return<T, E> {
  if (!row) return yield* Effect.fail(invalid());
  if (row.usedAt !== null) return yield* Effect.fail(invalid());
  const now = yield* Clock.currentTimeMillis;
  if (row.expiresAt <= now) return yield* Effect.fail(invalid());
  return row;
});
