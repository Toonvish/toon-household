/**
 * OWNER: auth agent.
 *
 * Password hashing with Bun's built-in argon2id — no external hashing lib.
 *
 * The `Passwords` service (docs/EFFECT.md E7; plan `docs/plans/e2-api-core-services.md` P2) has no dependencies.
 * `verifyPassword` stays CATCH-ALL (plan e2 P2): a malformed or legacy hash in the DB, a synchronous throw of argon2
 * included, is `false`, never a failure and never a 500. The Promise bridges at the end of the file keep the old
 * exports working for the callers that are not converted yet.
 *
 * The 200-character cap before argon2 (CLAUDE.md "Core hardening from `1715207`") lives in the request schemas of
 * `@toon/shared` (`PasswordSchema`, `packages/shared/src/core/schemas/user.ts`); this file hashes what it is given.
 */
import { Context, Effect, Layer } from "effect";
import { runtime } from "../../../runtime.ts";

/**
 * A real argon2id hash of a random throw-away string. Login verifies against it
 * when the e-mail is unknown (or the account is OAuth-only), so an attacker
 * cannot tell existing from non-existing accounts by response time.
 */
const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=65536,t=2,p=1$LXDlmFeBRY116NH/3hmzOHQpABmDXkFHLDBE+Ll3Q+E$zai+JYPC9XdyDurniAfZHE6nJ9e9HhSHkFao54h255k";

/** Password hashing and verification (argon2id). */
export class Passwords extends Context.Service<
  Passwords,
  {
    /** Hashes a plaintext password (argon2id, Bun defaults: m=64MiB, t=2, p=1). */
    readonly hashPassword: (password: string) => Effect.Effect<string>;
    /**
     * Verifies `password` against `hash`. `hash` may be null/undefined (OAuth-only account or unknown e-mail): the
     * comparison then runs against a dummy hash and answers false, which keeps the work — and therefore the response
     * time — roughly constant. Never fails: a malformed hash is `false`.
     */
    readonly verifyPassword: (password: string, hash: string | null | undefined) => Effect.Effect<boolean>;
    /** Burns the same CPU time as a real verification (unknown e-mail path). */
    readonly fakeVerifyPassword: (password: string) => Effect.Effect<void>;
  }
>()("toon/api/core/services/auth/passwords/Passwords") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const hashPassword = Effect.fn("Passwords.hashPassword")(function* (password: string) {
        return yield* Effect.promise(() => Bun.password.hash(password, { algorithm: "argon2id" }));
      });

      const verifyPassword = Effect.fn("Passwords.verifyPassword")(
        function* (password: string, hash: string | null | undefined) {
          const target = hash && hash.length > 0 ? hash : DUMMY_PASSWORD_HASH;
          // `tryPromise` also catches a synchronous throw of the thunk (src/internal/effect.ts `tryPromise`).
          const matches = yield* Effect.tryPromise({
            try: () => Bun.password.verify(password, target, "argon2id"),
            catch: (cause): unknown => cause,
          });
          return matches && target !== DUMMY_PASSWORD_HASH;
        },
        // Malformed/legacy hash in the DB must never surface as a 500: the WHOLE cause is caught (plan e2 P2).
        Effect.catchCause(() => Effect.succeed(false)),
      );

      const fakeVerifyPassword = Effect.fn("Passwords.fakeVerifyPassword")(function* (password: string) {
        yield* verifyPassword(password, null);
      });

      return Passwords.of({ hashPassword, verifyPassword, fakeVerifyPassword });
    }),
  );
}

/* legacy bridges: callers listed; E3 (recipe), E4 (finance), E5 (scripts) remove them */

/** Callers: `core/routes/auth.ts` (register, password change), `passwordReset.ts`. */
export function hashPassword(password: string): Promise<string> {
  return runtime.runPromise(Passwords.use((passwords) => passwords.hashPassword(password)));
}

/** Callers: `core/routes/auth.ts` (login, password change). */
export function verifyPassword(password: string, hash: string | null | undefined): Promise<boolean> {
  return runtime.runPromise(Passwords.use((passwords) => passwords.verifyPassword(password, hash)));
}

/** Callers: none outside the re-export of `core/services/auth/index.ts` (kept for its old export; E2-T13 prunes). */
export function fakeVerifyPassword(password: string): Promise<void> {
  return runtime.runPromise(Passwords.use((passwords) => passwords.fakeVerifyPassword(password)));
}
