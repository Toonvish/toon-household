/**
 * Sessions and mailed tokens on the `Clock` (docs/EFFECT.md E7, E9; plan `docs/plans/e2-api-core-services.md` P7,
 * task E2-T07): `Sessions` reads "now" from `Clock.currentTimeMillis` inside each method, so a `TestClock` provided
 * around one run (`runTest(…, { clock: "test" })`) moves a session through its lifetime without waiting, and
 * `spendableToken` gives the verdict for unknown, used and expired rows with the Clock's time.
 *
 * The virtual start instant is 2020-01-01, long before every real row of the shared test DB, so a sweep this run
 * might start (`resolveSession` forks it) can only reach rows older than that: the ones this file wrote.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { Sessions } from "../src/core/services/auth/sessions.ts";
import { spendableToken } from "../src/core/services/auth/tokens.ts";
import { Users } from "../src/core/services/auth/users.ts";
import { db } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { sessions } from "../src/db/schema.ts";
import { SESSION_TTL_MS } from "../src/lib/cookies.ts";
import { BadRequest } from "../src/lib/errors.ts";
import { runTest } from "./support/effect.ts";

const T = Date.UTC(2020, 0, 1);
const MINUTE_MS = 60 * 1000;

beforeAll(async () => {
  await runMigrations(db);
});

describe("Sessions on the TestClock", () => {
  test("a session created at T resolves at T + 1 min and no longer after SESSION_TTL_MS", async () => {
    const { userId, created, early, late } = await runTest(
      Effect.gen(function* () {
        yield* TestClock.setTime(T);
        const user = yield* (yield* Users).createUser({
          email: `clock-${crypto.randomUUID()}@toon.test`,
          name: "Uhr",
        });
        const service = yield* Sessions;
        const created = yield* service.createSession(user.id);

        yield* TestClock.adjust(MINUTE_MS);
        const early = yield* service.resolveSession(created.id);

        yield* TestClock.adjust(SESSION_TTL_MS);
        const late = yield* service.resolveSession(created.id);
        return { userId: user.id, created, early, late };
      }),
      { clock: "test" },
    );

    expect(created.createdAt).toBe(T);
    expect(created.lastUsedAt).toBe(T);
    expect(created.expiresAt).toBe(T + SESSION_TTL_MS);

    expect(early).not.toBeNull();
    expect(early?.user.id).toBe(userId);
    expect(early?.session.id).toBe(created.id);
    // 30 days minus a minute left: not slid forward, and lastUsedAt is not rewritten within the minute.
    expect(early?.renewed).toBe(false);
    expect(early?.session.expiresAt).toBe(T + SESSION_TTL_MS);

    expect(late).toBeNull();
    // The expired row is deleted when it is read.
    expect(await db.select().from(sessions).where(eq(sessions.id, created.id))).toHaveLength(0);
  });
});

describe("spendableToken", () => {
  const invalid = () => new BadRequest({ text: "server.auth.resetLinkInvalid" });

  test("a fresh, unused row is spendable", async () => {
    const row = { usedAt: null, expiresAt: T + 60 * MINUTE_MS };
    const spent = await runTest(
      Effect.gen(function* () {
        yield* TestClock.setTime(T);
        return yield* spendableToken(row, invalid);
      }),
      { clock: "test" },
    );
    expect(spent).toBe(row);
  });

  test("an expired row is refused with the given refusal", async () => {
    const error = await runTest(
      Effect.gen(function* () {
        yield* TestClock.setTime(T);
        return yield* Effect.flip(spendableToken({ usedAt: null, expiresAt: T }, invalid));
      }),
      { clock: "test" },
    );
    expect(error).toBeInstanceOf(BadRequest);
    expect(error.text).toBe("server.auth.resetLinkInvalid");
  });

  test("a used row is refused with the same refusal, even before it expires", async () => {
    const error = await runTest(
      Effect.gen(function* () {
        yield* TestClock.setTime(T);
        return yield* Effect.flip(spendableToken({ usedAt: T - MINUTE_MS, expiresAt: T + 60 * MINUTE_MS }, invalid));
      }),
      { clock: "test" },
    );
    expect(error).toBeInstanceOf(BadRequest);
    expect(error.text).toBe("server.auth.resetLinkInvalid");
  });

  test("an unknown row is refused with the same refusal", async () => {
    const error = await runTest(Effect.flip(spendableToken(undefined, invalid)), { clock: "test" });
    expect(error).toBeInstanceOf(BadRequest);
  });
});
