/**
 * The rate limiter as a service and through its synchronous bridges (docs/EFFECT.md E7; plan e2 P9).
 *
 * The limiter is OFF under `NODE_ENV=test` (every integration test would otherwise trip it), so the enforce -> 429
 * path was never exercised by the suite. This file proves it three ways: the service under a non-test `AppConfig`,
 * the bridge `enforceRateLimit` in a tiny Hono app with `onErrorHandler` (429 `rate_limited` plus `Retry-After`), and
 * a direct call outside Hono. The window cases run on a `TestClock`: `checkIn` reads the `Clock`, not `Date.now()`.
 */
import { describe, expect, test } from "bun:test";
import { Effect, Exit, Layer } from "effect";
import { TestClock } from "effect/testing";
import { Hono } from "hono";
import type { Context } from "hono";
import { AppConfig } from "../src/config.ts";
import {
  HOUSEHOLD_CREATE_RULE,
  INVITE_RULE,
  LOGIN_RULE,
  RateLimiter,
  checkRateLimit,
  enforceRateLimit,
  resetRateLimits,
} from "../src/core/services/auth/rateLimit.ts";
import { isApiError, onErrorHandler } from "../src/lib/errors.ts";
import { runTest } from "./support/effect.ts";

/** A key no other test shares: the store is one module-level map for the whole process. */
const freshKey = (prefix: string): string => `${prefix}-${crypto.randomUUID()}`;

const check = (key: string, rule: typeof LOGIN_RULE) => RateLimiter.use((limiter) => limiter.check(key, rule));

describe("RateLimiter.check on the Clock", () => {
  test("the 11th LOGIN_RULE attempt in one window is refused; 61 s later it passes again", async () => {
    const key = freshKey("login");
    const outcome = await runTest(
      Effect.gen(function* () {
        const first: boolean[] = [];
        for (let attempt = 0; attempt < LOGIN_RULE.limit; attempt += 1) first.push((yield* check(key, LOGIN_RULE)).allowed);
        const refused = yield* check(key, LOGIN_RULE);
        yield* TestClock.adjust("61 seconds");
        const later = yield* check(key, LOGIN_RULE);
        return { first, refused, later };
      }),
      { clock: "test" },
    );

    expect(outcome.first).toEqual(Array.from({ length: LOGIN_RULE.limit }, () => true));
    expect(outcome.refused).toEqual({ allowed: false, remaining: 0, retryAfterSeconds: 60 });
    expect(outcome.later.allowed).toBe(true);
    resetRateLimits(key);
  });

  test("retryAfterSeconds counts down with the clock", async () => {
    const key = freshKey("login");
    const refused = await runTest(
      Effect.gen(function* () {
        for (let attempt = 0; attempt < LOGIN_RULE.limit; attempt += 1) yield* check(key, LOGIN_RULE);
        yield* TestClock.adjust("45 seconds");
        return yield* check(key, LOGIN_RULE);
      }),
      { clock: "test" },
    );
    expect(refused).toEqual({ allowed: false, remaining: 0, retryAfterSeconds: 15 });
    resetRateLimits(key);
  });

  test("HOUSEHOLD_CREATE_RULE allows 5 per hour and then refuses within it", async () => {
    const key = freshKey("household");
    const results = await runTest(
      Effect.gen(function* () {
        const allowed: boolean[] = [];
        for (let attempt = 0; attempt < HOUSEHOLD_CREATE_RULE.limit; attempt += 1) {
          allowed.push((yield* check(key, HOUSEHOLD_CREATE_RULE)).allowed);
        }
        yield* TestClock.adjust("59 minutes");
        const refused = yield* check(key, HOUSEHOLD_CREATE_RULE);
        yield* TestClock.adjust("2 minutes");
        return { allowed, refused, after: yield* check(key, HOUSEHOLD_CREATE_RULE) };
      }),
      { clock: "test" },
    );
    expect(results.allowed).toEqual([true, true, true, true, true]);
    expect(results.refused.allowed).toBe(false);
    expect(results.refused.retryAfterSeconds).toBe(60);
    expect(results.after.allowed).toBe(true);
    resetRateLimits(key);
  });

  test("INVITE_RULE allows 10 per hour", async () => {
    const key = freshKey("invite");
    const results = await runTest(
      Effect.gen(function* () {
        const allowed: boolean[] = [];
        for (let attempt = 0; attempt < INVITE_RULE.limit + 1; attempt += 1) {
          allowed.push((yield* check(key, INVITE_RULE)).allowed);
        }
        return allowed;
      }),
      { clock: "test" },
    );
    expect(results.slice(0, 10).every(Boolean)).toBe(true);
    expect(results[10]).toBe(false);
    resetRateLimits(key);
  });
});

describe("RateLimiter.enforce", () => {
  const PRODUCTION = { NODE_ENV: "production", DATABASE_URL: "file:./data/x.db", SESSION_SECRET: "0123456789abcdef0123456789abcdef" };
  const RULE = { limit: 1, windowMs: 60_000 };
  const enforce = (scope: string, identifier: string) =>
    RateLimiter.use((limiter) => limiter.enforce(scope, identifier, RULE));

  test("a non-test AppConfig enforces: the lower-cased key on the first call, RateLimited on the second", async () => {
    const identifier = `${crypto.randomUUID()}@B.C`;
    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        const key = yield* enforce("login", identifier);
        const refused = yield* Effect.exit(enforce("login", identifier));
        return { key, refused };
      }).pipe(Effect.provide(RateLimiter.layer.pipe(Layer.provide(AppConfig.layerFrom(PRODUCTION))))),
    );

    expect(exit.key).toBe(`login:${identifier.toLowerCase()}`);
    expect(Exit.isFailure(exit.refused)).toBe(true);
    const error = await Effect.runPromise(
      Effect.flip(enforce("login", identifier)).pipe(
        Effect.provide(RateLimiter.layer.pipe(Layer.provide(AppConfig.layerFrom(PRODUCTION)))),
      ),
    );
    expect(error._tag).toBe("RateLimited");
    expect(error.status).toBe(429);
    expect(error.code).toBe("rate_limited");
    expect(error.retryAfterSeconds).toBeGreaterThan(0);
    resetRateLimits(exit.key);
  });

  test("under the test config enforce returns the key and records nothing", async () => {
    const identifier = `${crypto.randomUUID()}@B.C`;
    const outcome = await runTest(
      Effect.gen(function* () {
        const first = yield* enforce("login", identifier);
        const second = yield* enforce("login", identifier);
        const recorded = yield* check(first, RULE);
        return { first, second, recorded };
      }),
    );
    expect(outcome.first).toBe(`login:${identifier.toLowerCase()}`);
    expect(outcome.second).toBe(outcome.first);
    // The bucket was empty: this first real attempt is allowed with the single permit still unused before it.
    expect(outcome.recorded.allowed).toBe(true);
    resetRateLimits(outcome.first);
  });
});

describe("the synchronous bridges", () => {
  const RULE = { limit: 1, windowMs: 60_000 };

  test("enforceRateLimit answers 200 then 429 with Retry-After in a Hono route", async () => {
    const app = new Hono();
    app.onError(onErrorHandler);
    const id = freshKey("route");
    app.get("/t", (c) => {
      // A typed assignment: a Promise-returning bridge would fail tsc here.
      const key: string = enforceRateLimit(c, "t", id, RULE, true);
      return c.json({ key });
    });

    const first = await app.request("/t");
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ key: `t:${id.toLowerCase()}` });

    const second = await app.request("/t");
    expect(second.status).toBe(429);
    const retryAfter = second.headers.get("Retry-After");
    expect(retryAfter).toMatch(/^[1-9]\d*$/);
    const body = (await second.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("rate_limited");
    expect(body.error.message).toContain(retryAfter ?? "never");
    resetRateLimits(`t:${id.toLowerCase()}`);
  });

  test("a direct call outside Hono throws a family error synchronously and sets Retry-After on the context", () => {
    const headers: Array<[string, string]> = [];
    const context = { header: (name: string, value: string) => headers.push([name, value]) } as unknown as Context;
    const id = freshKey("direct");

    expect(enforceRateLimit(context, "t", id, RULE, true)).toBe(`t:${id.toLowerCase()}`);

    let thrown: unknown;
    try {
      enforceRateLimit(context, "t", id, RULE, true);
    } catch (error) {
      thrown = error;
    }
    expect(isApiError(thrown)).toBe(true);
    expect((thrown as { code: string }).code).toBe("rate_limited");
    expect((thrown as { _tag: string })._tag).toBe("RateLimited");
    expect(headers).toHaveLength(1);
    expect(headers[0]?.[0]).toBe("Retry-After");
    expect(Number(headers[0]?.[1])).toBeGreaterThan(0);
    resetRateLimits(`t:${id.toLowerCase()}`);
  });

  test("the default for `enabled` is off under NODE_ENV=test", () => {
    const context = { header: () => undefined } as unknown as Context;
    const id = freshKey("default");
    expect(enforceRateLimit(context, "t", id, RULE)).toBe(`t:${id.toLowerCase()}`);
    expect(enforceRateLimit(context, "t", id, RULE)).toBe(`t:${id.toLowerCase()}`);
  });

  test("checkRateLimit is synchronous and shares its store with the service", async () => {
    const key = freshKey("shared");
    const direct = checkRateLimit(key, RULE);
    expect(direct).toEqual({ allowed: true, remaining: 0, retryAfterSeconds: 0 });
    // The service sees the attempt the bridge recorded.
    const viaService = await runTest(check(key, RULE));
    expect(viaService.allowed).toBe(false);
    resetRateLimits(key);
  });

  test("reset(key) and resetRateLimits(key) act on the same store", async () => {
    const first = freshKey("reset-a");
    const second = freshKey("reset-b");
    checkRateLimit(first, RULE);
    checkRateLimit(second, RULE);
    expect(checkRateLimit(first, RULE).allowed).toBe(false);

    await runTest(RateLimiter.use((limiter) => limiter.reset(first)));
    expect(checkRateLimit(first, RULE).allowed).toBe(true);

    expect(checkRateLimit(second, RULE).allowed).toBe(false);
    resetRateLimits(second);
    const afterBridge = await runTest(check(second, RULE));
    expect(afterBridge.allowed).toBe(true);

    // reset() with no key clears every bucket, for both.
    checkRateLimit(first, RULE);
    await runTest(RateLimiter.use((limiter) => limiter.reset()));
    expect(checkRateLimit(first, RULE).allowed).toBe(true);
    resetRateLimits();
  });
});
