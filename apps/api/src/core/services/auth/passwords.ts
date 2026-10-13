/**
 * OWNER: auth agent.
 *
 * Password hashing with Bun's built-in argon2id — no external hashing lib.
 */

/**
 * A real argon2id hash of a random throw-away string. Login verifies against it
 * when the e-mail is unknown (or the account is OAuth-only), so an attacker
 * cannot tell existing from non-existing accounts by response time.
 */
const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=65536,t=2,p=1$LXDlmFeBRY116NH/3hmzOHQpABmDXkFHLDBE+Ll3Q+E$zai+JYPC9XdyDurniAfZHE6nJ9e9HhSHkFao54h255k";

/** Hashes a plaintext password (argon2id, Bun defaults: m=64MiB, t=2, p=1). */
export function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, { algorithm: "argon2id" });
}

/**
 * Verifies `password` against `hash`.
 *
 * `hash` may be null/undefined (OAuth-only account or unknown e-mail): the
 * comparison then runs against a dummy hash and returns false, which keeps the
 * work — and therefore the response time — roughly constant.
 */
export async function verifyPassword(
  password: string,
  hash: string | null | undefined,
): Promise<boolean> {
  const target = hash && hash.length > 0 ? hash : DUMMY_PASSWORD_HASH;
  try {
    const matches = await Bun.password.verify(password, target, "argon2id");
    return matches && target !== DUMMY_PASSWORD_HASH;
  } catch {
    // Malformed/legacy hash in the DB must never surface as a 500.
    return false;
  }
}

/** Burns the same CPU time as a real verification (unknown e-mail path). */
export async function fakeVerifyPassword(password: string): Promise<void> {
  await verifyPassword(password, null);
}
