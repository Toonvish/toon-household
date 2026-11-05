/**
 * Pins the API middleware chain (SPEC §2, D8; plan `docs/plans/e7-http-api.md` P5, P6, P8, P14): `RequireSession` ->
 * `RequireHouseholdMember` -> `RequireModule`, attached by `householdModuleApi`, plus `RequireVerifiedEmail`, the
 * user API of `userModuleApi`, and the session cookie's stale clearing and renewal.
 *
 * Every case runs through mini `HttpApi`s served in memory by `testHttpApp` (`apps/api/test/support/http.ts`) with the
 * core middleware implementations of `httpMiddlewareLayer()` (`apps/api/src/http/middleware-layer.ts`); the cases and
 * assertions are the ones this file pinned on the Hono middlewares (`requireSession`, `requireHouseholdRole`,
 * `mountModules` + `requireModule`, `requireVerifiedEmail`) until E7-T03.
 *
 * Uses the shared `db` (what the middleware reads) with `runMigrations(db)`; sessions are real rows from
 * `createSession`, sent as the `toon_session` cookie.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { Effect, Layer, Schema } from "effect";
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { createSession } from "../src/core/services/auth/sessions.ts";
import { setVerifiedEmailRequired } from "../src/core/services/auth/verifiedEmail.ts";
import { db } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { householdMembers, householdModules, households, sessions, users } from "../src/db/schema.ts";
import { CurrentMembership, CurrentSession, CurrentUser, MaybeSession } from "../src/http/context.ts";
import {
  chain,
  coreApi,
  householdModuleApi,
  OptionalSession,
  RequireHouseholdAdmin,
  RequireHouseholdMember,
  RequireSession,
  RequireVerifiedEmail,
  UNINTERRUPTIBLE,
  userModuleApi,
} from "../src/http/middleware.ts";
import { httpMiddlewareLayer } from "../src/http/middleware-layer.ts";
import { json } from "../src/http/response.ts";
import { SESSION_COOKIE, SESSION_TTL_MS } from "../src/lib/cookies.ts";
import { type InMemoryApp, testHttpApp } from "./support/http.ts";

interface Account {
  userId: string;
  sessionId: string;
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
  return { userId, sessionId: session.id, cookie: `${SESSION_COOKIE}=${session.id}` };
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

interface Sent {
  status: number;
  setCookie: string | null;
  body: { error?: { code: string; message: string }; [k: string]: unknown };
}

async function send(app: InMemoryApp, path: string, init: { method?: string; cookie?: string } = {}): Promise<Sent> {
  const response = await app.request(path, {
    method: init.method ?? "GET",
    headers: init.cookie === undefined ? {} : { Cookie: init.cookie },
  });
  return {
    status: response.status,
    setCookie: response.headers.get("set-cookie"),
    body: (await response.json()) as never,
  };
}

/** A mini app over `apis` with the core middleware implementations. */
function middlewareApp(apis: ReadonlyArray<HttpApi.HttpApi<string, any>>, handlers: Layer.Any): InMemoryApp {
  return testHttpApp(apis, handlers, httpMiddlewareLayer());
}

beforeAll(async () => {
  await runMigrations(db);
});

afterAll(() => {
  setVerifiedEmailRequired(null);
});

// ---------------------------------------------------------------------------------------------------------------
// RequireSession + the household tags (core API)
// ---------------------------------------------------------------------------------------------------------------

const HouseholdGroup = HttpApiGroup.make("mw.household").add(
  HttpApiEndpoint.get("getHByHouseholdIdPing", "/h/:householdId/ping", {
    params: { householdId: Schema.String },
  }).pipe(chain(RequireSession, RequireHouseholdMember)),
  HttpApiEndpoint.get("getHByHouseholdIdAdmin", "/h/:householdId/admin", {
    params: { householdId: Schema.String },
  }).pipe(chain(RequireSession, RequireHouseholdAdmin)),
);
const HouseholdApi = coreApi(HttpApi.make("mw.household").add(HouseholdGroup));
const householdHandlers = HttpApiBuilder.group(HouseholdApi, "mw.household", (handlers) =>
  handlers
    .handle(
      "getHByHouseholdIdPing",
      Effect.fn("mw.household.getHByHouseholdIdPing")(function* () {
        const membership = yield* CurrentMembership;
        return json({ householdId: membership.householdId, role: membership.role });
      }),
      UNINTERRUPTIBLE,
    )
    .handle(
      "getHByHouseholdIdAdmin",
      Effect.fn("mw.household.getHByHouseholdIdAdmin")(function* () {
        return json({ ok: true });
      }),
      UNINTERRUPTIBLE,
    ),
);

describe("RequireSession + RequireHouseholdMember / RequireHouseholdAdmin", () => {
  const app = middlewareApp([HouseholdApi], householdHandlers);

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

// ---------------------------------------------------------------------------------------------------------------
// householdModuleApi + RequireModule, userModuleApi (a fake "recipe" module)
// ---------------------------------------------------------------------------------------------------------------

const ModuleGroup = HttpApiGroup.make("mw.recipe").add(
  HttpApiEndpoint.get("getPing", "/ping", { params: { householdId: Schema.String } }),
  HttpApiEndpoint.get("get", "/", { params: { householdId: Schema.String } }),
);
const ModuleApi = householdModuleApi("recipe", HttpApi.make("mw.recipe").add(ModuleGroup));
const moduleHandlers = HttpApiBuilder.group(ModuleApi, "mw.recipe", (handlers) =>
  handlers
    .handle(
      "getPing",
      Effect.fn("mw.recipe.getPing")(function* () {
        const membership = yield* CurrentMembership;
        return json({ ok: true, householdId: membership.householdId });
      }),
      UNINTERRUPTIBLE,
    )
    .handle(
      "get",
      Effect.fn("mw.recipe.get")(function* () {
        return json({ root: true });
      }),
      UNINTERRUPTIBLE,
    ),
);

const CardsGroup = HttpApiGroup.make("mw.recipe.cards")
  .add(HttpApiEndpoint.get("getCards", "/cards").pipe(chain(RequireSession)));
const CardsApi = userModuleApi("recipe", HttpApi.make("mw.recipe.cards").add(CardsGroup));
const cardsHandlers = HttpApiBuilder.group(CardsApi, "mw.recipe.cards", (handlers) =>
  handlers.handle(
    "getCards",
    Effect.fn("mw.recipe.cards.getCards")(function* () {
      return json({ cards: [] });
    }),
    UNINTERRUPTIBLE,
  ),
);

describe("householdModuleApi + RequireModule", () => {
  const app = middlewareApp([ModuleApi, CardsApi], Layer.mergeAll(moduleHandlers, cardsHandlers));

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

  test("the user API answers at /api/recipe/... and needs its own session", async () => {
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

// ---------------------------------------------------------------------------------------------------------------
// RequireVerifiedEmail (a group chain, as a Hono router's use("*"))
// ---------------------------------------------------------------------------------------------------------------

const VerifiedGroup = HttpApiGroup.make("mw.verified")
  .add(HttpApiEndpoint.get("getVThing", "/v/thing"), HttpApiEndpoint.post("postVThing", "/v/thing"))
  .pipe(chain(RequireSession, RequireVerifiedEmail));
const VerifiedApi = coreApi(HttpApi.make("mw.verified").add(VerifiedGroup));
const verifiedHandlers = HttpApiBuilder.group(VerifiedApi, "mw.verified", (handlers) =>
  handlers
    .handle(
      "getVThing",
      Effect.fn("mw.verified.getVThing")(function* () {
        return json({ ok: true });
      }),
      UNINTERRUPTIBLE,
    )
    .handle(
      "postVThing",
      Effect.fn("mw.verified.postVThing")(function* () {
        return json({ ok: true });
      }),
      UNINTERRUPTIBLE,
    ),
);

describe("RequireVerifiedEmail", () => {
  const app = middlewareApp([VerifiedApi], verifiedHandlers);

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

// ---------------------------------------------------------------------------------------------------------------
// The session cookie: stale clearing and renewal (P8), RequireSession and OptionalSession
// ---------------------------------------------------------------------------------------------------------------

const SessionGroup = HttpApiGroup.make("mw.session").add(
  HttpApiEndpoint.get("getSMe", "/s/me").pipe(chain(RequireSession)),
  HttpApiEndpoint.get("getSMaybe", "/s/maybe").pipe(chain(OptionalSession)),
);
const SessionApi = coreApi(HttpApi.make("mw.session").add(SessionGroup));
const sessionHandlers = HttpApiBuilder.group(SessionApi, "mw.session", (handlers) =>
  handlers
    .handle(
      "getSMe",
      Effect.fn("mw.session.getSMe")(function* () {
        const user = yield* CurrentUser;
        const session = yield* CurrentSession;
        return json({ userId: user.id, sessionId: session.sessionId });
      }),
      UNINTERRUPTIBLE,
    )
    .handle(
      "getSMaybe",
      Effect.fn("mw.session.getSMaybe")(function* () {
        const maybe = yield* MaybeSession;
        return json({ userId: maybe.user?.id ?? null, sessionId: maybe.sessionId ?? null });
      }),
      UNINTERRUPTIBLE,
    ),
);

/** The attributes of a `Set-Cookie` value besides `Max-Age`, as a set (their order is the serializer's, P8). */
function cookieParts(setCookie: string | null): { pair: string; maxAge: number; attributes: Set<string> } {
  const [pair = "", ...attributes] = (setCookie ?? "").split("; ");
  const maxAge = Number(attributes.find((a) => a.startsWith("Max-Age="))?.slice("Max-Age=".length));
  return { pair, maxAge, attributes: new Set(attributes.filter((a) => !a.startsWith("Max-Age="))) };
}

const BASE_ATTRIBUTES = new Set(["Path=/", "HttpOnly", "SameSite=Lax"]);
const CLEARED = `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`;

describe("the session cookie: stale clearing and renewal", () => {
  const app = middlewareApp([SessionApi], sessionHandlers);

  test("a stale cookie answers 401 and is cleared on that 401 (empty value, Max-Age=0, no Expires)", async () => {
    const stale = await send(app, "/s/me", { cookie: `${SESSION_COOKIE}=does-not-exist` });
    expect(stale.status).toBe(401);
    expect(stale.body.error?.code).toBe("unauthorized");
    expect(stale.setCookie).toBe(CLEARED);
  });

  test("a revoked session's cookie is cleared too", async () => {
    const user = await makeUser("Revoked");
    await db.delete(sessions).where(eq(sessions.id, user.sessionId));
    const response = await send(app, "/s/me", { cookie: user.cookie });
    expect(response.status).toBe(401);
    expect(response.setCookie).toBe(CLEARED);
  });

  test("OptionalSession never refuses: a stale cookie is cleared on the 200, no cookie writes nothing", async () => {
    const stale = await send(app, "/s/maybe", { cookie: `${SESSION_COOKIE}=does-not-exist` });
    expect(stale.status).toBe(200);
    expect(stale.body).toEqual({ userId: null, sessionId: null });
    expect(stale.setCookie).toBe(CLEARED);
    const anonymous = await send(app, "/s/maybe");
    expect(anonymous.status).toBe(200);
    expect(anonymous.body).toEqual({ userId: null, sessionId: null });
    expect(anonymous.setCookie).toBeNull();
  });

  test("a fresh session passes, provides the user and the session id, and writes no cookie", async () => {
    const user = await makeUser("Fresh");
    const me = await send(app, "/s/me", { cookie: user.cookie });
    expect(me.status).toBe(200);
    expect(me.body).toEqual({ userId: user.userId, sessionId: user.sessionId });
    expect(me.setCookie).toBeNull();
    const maybe = await send(app, "/s/maybe", { cookie: user.cookie });
    expect(maybe.body).toEqual({ userId: user.userId, sessionId: user.sessionId });
    expect(maybe.setCookie).toBeNull();
  });

  test("a session close to its expiry is renewed: the row slides forward and the cookie is re-set", async () => {
    const user = await makeUser("Renewed");
    const soon = Date.now() + 24 * 60 * 60 * 1000;
    await db.update(sessions).set({ expiresAt: soon }).where(eq(sessions.id, user.sessionId));

    const me = await send(app, "/s/me", { cookie: user.cookie });
    expect(me.status).toBe(200);
    expect(me.body).toEqual({ userId: user.userId, sessionId: user.sessionId });
    const cookie = cookieParts(me.setCookie);
    expect(cookie.pair).toBe(`${SESSION_COOKIE}=${user.sessionId}`);
    expect(Math.abs(cookie.maxAge - SESSION_TTL_MS / 1000)).toBeLessThanOrEqual(5);
    expect(cookie.attributes).toEqual(BASE_ATTRIBUTES);

    const [row] = await db.select().from(sessions).where(eq(sessions.id, user.sessionId));
    expect(row!.expiresAt).toBeGreaterThan(soon + 14 * 24 * 60 * 60 * 1000);

    // Renewed once: the next request finds a fresh expiry and writes nothing.
    const again = await send(app, "/s/me", { cookie: user.cookie });
    expect(again.status).toBe(200);
    expect(again.setCookie).toBeNull();
  });
});
