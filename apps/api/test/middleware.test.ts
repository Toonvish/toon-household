/**
 * Pins the API middleware chain (SPEC §2, D8): requireSession -> requireHouseholdRole
 * -> requireModule, mounted by `mountModules()`, plus `requireVerifiedEmail`.
 *
 * Uses the shared `db` (what the middleware reads) with `runMigrations(db)`;
 * sessions are real rows from `createSession`, sent as the `toon_session` cookie.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createSession } from "../src/core/services/auth/sessions.ts";
import { setVerifiedEmailRequired } from "../src/core/services/auth/verifiedEmail.ts";
import { db } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { householdMembers, householdModules, households, users } from "../src/db/schema.ts";
import { notFoundHandler, onErrorHandler } from "../src/lib/errors.ts";
import { localeMiddleware } from "../src/lib/locale.ts";
import { SESSION_COOKIE } from "../src/lib/cookies.ts";
import type { AppEnv } from "../src/lib/types.ts";
import { requireMembership } from "../src/lib/types.ts";
import { requireHouseholdRole } from "../src/middleware/household.ts";
import { requireSession } from "../src/middleware/session.ts";
import { requireVerifiedEmail } from "../src/middleware/verifiedEmail.ts";
import { mountModules } from "../src/modules/mount.ts";
import type { ApiModule } from "../src/modules/types.ts";

interface Account {
  userId: string;
  cookie: string;
}

async function makeUser(name: string, verified = true): Promise<Account> {
  const userId = crypto.randomUUID();
  await db.insert(users).values({
    id: userId,
    email: `${userId}@toon.local`,
    name,
    emailVerifiedAt: verified ? Date.now() : null,
  });
  const session = await createSession(db, userId);
  return { userId, cookie: `${SESSION_COOKIE}=${session.id}` };
}

async function makeHousehold(
  owner: Account,
  members: { account: Account; role: "admin" | "member" }[] = [],
): Promise<string> {
  const householdId = crypto.randomUUID();
  await db.insert(households).values({ id: householdId, name: "Haushalt", createdBy: owner.userId });
  await db
    .insert(householdMembers)
    .values({ id: crypto.randomUUID(), householdId, userId: owner.userId, role: "owner" });
  for (const { account, role } of members) {
    await db
      .insert(householdMembers)
      .values({ id: crypto.randomUUID(), householdId, userId: account.userId, role });
  }
  return householdId;
}

function testApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.onError(onErrorHandler);
  app.notFound(notFoundHandler);
  app.use("*", localeMiddleware);
  return app;
}

async function send(
  app: Hono<AppEnv>,
  path: string,
  init: { method?: string; cookie?: string } = {},
): Promise<{ status: number; body: { error?: { code: string; message: string }; [k: string]: unknown } }> {
  const response = await app.request(path, {
    method: init.method ?? "GET",
    headers: init.cookie === undefined ? {} : { Cookie: init.cookie },
  });
  return { status: response.status, body: (await response.json()) as never };
}

beforeAll(async () => {
  await runMigrations(db);
});

afterAll(() => {
  setVerifiedEmailRequired(null);
});

describe("requireSession + requireHouseholdRole", () => {
  const app = testApp();
  app.get("/h/:householdId/ping", requireSession(), requireHouseholdRole("member"), (c) =>
    c.json({ householdId: requireMembership(c).householdId, role: requireMembership(c).role }),
  );
  app.get("/h/:householdId/admin", requireSession(), requireHouseholdRole("admin"), (c) =>
    c.json({ ok: true }),
  );

  test("401 unauthorized without a session cookie", async () => {
    const { status, body } = await send(app, `/h/${crypto.randomUUID()}/ping`);
    expect(status).toBe(401);
    expect(body.error?.code).toBe("unauthorized");
  });

  test("401 for a cookie that names no session", async () => {
    const { status } = await send(app, `/h/${crypto.randomUUID()}/ping`, {
      cookie: `${SESSION_COOKIE}=does-not-exist`,
    });
    expect(status).toBe(401);
  });

  test("404 not_found for an unknown household", async () => {
    const user = await makeUser("A");
    const { status, body } = await send(app, `/h/${crypto.randomUUID()}/ping`, { cookie: user.cookie });
    expect(status).toBe(404);
    expect(body.error?.code).toBe("not_found");
  });

  test("403 forbidden for a non-member", async () => {
    const owner = await makeUser("Owner");
    const outsider = await makeUser("Outsider");
    const householdId = await makeHousehold(owner);
    const { status, body } = await send(app, `/h/${householdId}/ping`, { cookie: outsider.cookie });
    expect(status).toBe(403);
    expect(body.error?.code).toBe("forbidden");
  });

  test("a member passes and the membership carries householdId and role", async () => {
    const owner = await makeUser("Owner");
    const member = await makeUser("Member");
    const householdId = await makeHousehold(owner, [{ account: member, role: "member" }]);
    const { status, body } = await send(app, `/h/${householdId}/ping`, { cookie: member.cookie });
    expect(status).toBe(200);
    expect(body).toEqual({ householdId, role: "member" });
  });

  test("403 forbidden for a member on an admin route, 200 for the owner", async () => {
    const owner = await makeUser("Owner");
    const member = await makeUser("Member");
    const householdId = await makeHousehold(owner, [{ account: member, role: "member" }]);
    const denied = await send(app, `/h/${householdId}/admin`, { cookie: member.cookie });
    expect(denied.status).toBe(403);
    expect(denied.body.error?.code).toBe("forbidden");
    const allowed = await send(app, `/h/${householdId}/admin`, { cookie: owner.cookie });
    expect(allowed.status).toBe(200);
  });
});

describe("mountModules + requireModule", () => {
  const fake: ApiModule = {
    id: "recipe",
    schema: {},
    householdRouter: (() => {
      const router = new Hono<AppEnv>();
      router.get("/ping", (c) => c.json({ ok: true, householdId: requireMembership(c).householdId }));
      router.get("/", (c) => c.json({ root: true }));
      return router;
    })(),
    userRouter: (() => {
      const router = new Hono<AppEnv>();
      router.get("/cards", requireSession(), (c) => c.json({ cards: [] }));
      return router;
    })(),
  };
  const app = testApp();
  mountModules(app, [fake]);

  test("404 module_disabled (German by default) until a household_modules row exists, then 200", async () => {
    const owner = await makeUser("Owner");
    const member = await makeUser("Member");
    const householdId = await makeHousehold(owner, [{ account: member, role: "member" }]);
    const path = `/api/households/${householdId}/recipe/ping`;

    const before = await send(app, path, { cookie: member.cookie });
    expect(before.status).toBe(404);
    expect(before.body.error?.code).toBe("module_disabled");
    expect(before.body.error?.message).toBe("Dieses Modul ist für diesen Haushalt nicht aktiviert.");

    await db.insert(householdModules).values({ householdId, moduleId: "recipe" });
    const after = await send(app, path, { cookie: member.cookie });
    expect(after.status).toBe(200);
    expect(after.body).toEqual({ ok: true, householdId });
    // The bare module root is gated and mounted too.
    const root = await send(app, `/api/households/${householdId}/recipe`, { cookie: member.cookie });
    expect(root.status).toBe(200);
  });

  test("another module's row does not enable this one", async () => {
    const owner = await makeUser("Owner");
    const householdId = await makeHousehold(owner);
    await db.insert(householdModules).values({ householdId, moduleId: "finance" });
    const { status, body } = await send(app, `/api/households/${householdId}/recipe/ping`, {
      cookie: owner.cookie,
    });
    expect(status).toBe(404);
    expect(body.error?.code).toBe("module_disabled");
  });

  test("userRouter answers at /api/recipe/... and needs its own session", async () => {
    const user = await makeUser("U");
    const ok = await send(app, "/api/recipe/cards", { cookie: user.cookie });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ cards: [] });
    const anonymous = await send(app, "/api/recipe/cards");
    expect(anonymous.status).toBe(401);
  });

  test("CHAIN ORDER: no cookie answers 401 before role or module are consulted", async () => {
    const owner = await makeUser("Owner");
    const householdId = await makeHousehold(owner); // no module row
    const { status, body } = await send(app, `/api/households/${householdId}/recipe/ping`);
    expect(status).toBe(401);
    expect(body.error?.code).toBe("unauthorized");
  });

  test("CHAIN ORDER: a non-member of a household with NO module row gets 403, not module_disabled", async () => {
    const owner = await makeUser("Owner");
    const outsider = await makeUser("Outsider");
    const householdId = await makeHousehold(owner); // no module row
    const { status, body } = await send(app, `/api/households/${householdId}/recipe/ping`, {
      cookie: outsider.cookie,
    });
    expect(status).toBe(403);
    expect(body.error?.code).toBe("forbidden");
  });

  test("an unknown household is 404 not_found, not module_disabled", async () => {
    const user = await makeUser("U");
    const { status, body } = await send(app, `/api/households/${crypto.randomUUID()}/recipe/ping`, {
      cookie: user.cookie,
    });
    expect(status).toBe(404);
    expect(body.error?.code).toBe("not_found");
  });
});

describe("requireVerifiedEmail", () => {
  const app = testApp();
  app.use("/v/*", requireSession(), requireVerifiedEmail());
  app.get("/v/thing", (c) => c.json({ ok: true }));
  app.post("/v/thing", (c) => c.json({ ok: true }));

  test("blocks a POST with 403 email_unverified but passes a GET when the gate is on", async () => {
    setVerifiedEmailRequired(true);
    const user = await makeUser("Unconfirmed", false);
    const read = await send(app, "/v/thing", { cookie: user.cookie });
    expect(read.status).toBe(200);
    const write = await send(app, "/v/thing", { method: "POST", cookie: user.cookie });
    expect(write.status).toBe(403);
    expect(write.body.error?.code).toBe("email_unverified");
  });

  test("lets a confirmed account write", async () => {
    setVerifiedEmailRequired(true);
    const user = await makeUser("Confirmed", true);
    const write = await send(app, "/v/thing", { method: "POST", cookie: user.cookie });
    expect(write.status).toBe(200);
  });

  test("is a no-op when the gate is off", async () => {
    setVerifiedEmailRequired(false);
    const user = await makeUser("Unconfirmed", false);
    const write = await send(app, "/v/thing", { method: "POST", cookie: user.cookie });
    expect(write.status).toBe(200);
  });
});
