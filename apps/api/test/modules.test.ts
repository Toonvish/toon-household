/**
 * Module enabling end to end (SPEC D2, D3, D8, §2; docs/plans/m1-core.md decision 3, M1-T09):
 * POST/DELETE /api/households/:householdId/modules/:moduleId, `enableModule`'s `onEnable` hook,
 * `initializeHousehold`'s `onHouseholdCreated` hook, and the gate from enabling to
 * `requireModule` on a mounted module router.
 *
 * Shared `db` + `runMigrations(db)` (what the routes and the middleware read). Users and
 * sessions come from the real `POST /api/auth/register`; extra members are direct inserts, as
 * in middleware.test.ts. `bun test` runs every file in one process, so the verified-e-mail
 * override is handed back in `afterAll`.
 *
 * The fake modules of "module hooks" are `ApiModule` literals whose hooks are Effects (plan e4 P11), as the
 * real manifests are. The hook tests call the `HouseholdModules` service on the app runtime (`runTest`, plan e2
 * P14); a refusal is read with `Effect.flip`.
 *
 * Since M3 `finance` is a real build module whose `onEnable` needs two participants (SPEC D3,
 * plan M3 decision 4): every enable of finance that must succeed sends a participants body
 * (`financeSettings`) for the owner plus a second member; (g') pins the refusal.
 *
 * The module contract's HTTP side (docs/EFFECT.md E7, E8; plan `docs/plans/e7-http-api.md` P14, E7-T10): (g) and (j)
 * to (m) serve modules through `moduleRoutesLayer` (`src/modules/mount.ts`) inside a `testHttpApp`
 * (`test/support/http.ts`, an in-memory handler over the one `AppLayer` with its own router), with the core middleware
 * implementations of `httpMiddlewareLayer()`. The fake module of (g), (k) and (l) is a mini household API built with
 * `householdModuleApi("finance", …)`: one `GET /ping` echoing the membership's household. Everything else still goes
 * through `app` (the Hono app until E7-T11).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { Effect, Layer, Schema } from "effect";
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { resetRateLimits } from "../src/core/services/auth/rateLimit.ts";
import { setVerifiedEmailRequired } from "../src/core/services/auth/verifiedEmail.ts";
import { HouseholdModules } from "../src/core/services/households/modules.ts";
import { db } from "../src/db/client.ts";
import { runMigrations } from "./support/bridges/migrate.ts";
import { financeParticipants, householdMembers, householdModules, users } from "../src/db/schema.ts";
import { CurrentMembership } from "../src/http/context.ts";
import {
  ApiErrorBoundary,
  chain,
  householdModuleApi,
  RequireHouseholdMember,
  RequireSession,
  UNINTERRUPTIBLE,
} from "../src/http/middleware.ts";
import { httpMiddlewareLayer } from "../src/http/middleware-layer.ts";
import { json } from "../src/http/response.ts";
import { app } from "../src/index.ts";
import { SESSION_COOKIE } from "../src/lib/cookies.ts";
import { ApiError } from "./support/bridges/api-error.ts";
import { API_MODULES } from "../src/modules/index.ts";
import { moduleRoutesLayer } from "../src/modules/mount.ts";
import type { ApiModule } from "../src/modules/types.ts";
import { runTest } from "./support/effect.ts";
import { testHttpApp } from "./support/http.ts";

/* -------------------------------- helpers -------------------------------- */

interface Account {
  userId: string;
  cookie: string;
  /** The household registration created for this account. */
  householdId: string;
}

interface HouseholdBody {
  household: { id: string; role: string; modules: string[] };
}

interface ErrorBody {
  error: { code: string; message: string };
}

/** Registers through the real auth route and returns the session cookie + first household. */
async function register(name: string): Promise<Account> {
  // REGISTER_RULE allows 5 per IP per 15 min and every app.request shares one "IP".
  resetRateLimits();
  const response = await app.request("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: `${name.toLowerCase()}-${crypto.randomUUID()}@toon.test`,
      name,
      password: "geheimes-passwort-123",
    }),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { user: { id: string }; activeHouseholdId: string };
  const header = response.headers.getSetCookie().find((value) => value.startsWith(`${SESSION_COOKIE}=`));
  if (!header) throw new Error("no session cookie");
  return { userId: body.user.id, cookie: header.split(";")[0] ?? "", householdId: body.activeHouseholdId };
}

async function addMember(householdId: string, account: Account, role: "admin" | "member"): Promise<void> {
  await db
    .insert(householdMembers)
    .values({ id: crypto.randomUUID(), householdId, userId: account.userId, role });
}

/** What `call` sends through: the Hono `app` or an in-memory `testHttpApp` (both have `app.request`'s shape). */
interface Requester {
  request(input: string, init?: RequestInit): Response | Promise<Response>;
}

async function call(
  target: Requester,
  path: string,
  init: { method?: string; cookie?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (init.cookie) headers.Cookie = init.cookie;
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  return target.request(path, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

/** Finance's enable settings: `slot1` → 1, `slot2` → 2 (plan M3 decision 4). */
function financeSettings(slot1: Account, slot2: Account): { participants: { userId: string; memberSlot: number }[] } {
  return {
    participants: [
      { userId: slot1.userId, memberSlot: 1 },
      { userId: slot2.userId, memberSlot: 2 },
    ],
  };
}

/** Registers a second person and makes them a member of `owner`'s household; returns them. */
async function withPartner(owner: Account, role: "admin" | "member" = "member"): Promise<Account> {
  const partner = await register("Partner");
  await addMember(owner.householdId, partner, role);
  return partner;
}

function modulePath(householdId: string, moduleId: string): string {
  return `/api/households/${householdId}/modules/${moduleId}`;
}

async function moduleRow(householdId: string, moduleId: string) {
  const [row] = await db
    .select()
    .from(householdModules)
    .where(and(eq(householdModules.householdId, householdId), eq(householdModules.moduleId, moduleId)));
  return row;
}

async function reportedModules(account: Account, householdId: string): Promise<string[]> {
  const response = await call(app, `/api/households/${householdId}`, { cookie: account.cookie });
  expect(response.status).toBe(200);
  return ((await response.json()) as HouseholdBody).household.modules;
}

/** The mini household API of the fake finance module: `GET /ping` echoes the membership's household (plan e7 P14). */
const PingGroup = HttpApiGroup.make("test.ping").add(
  HttpApiEndpoint.get("getPing", "/ping", { params: { householdId: Schema.String } }),
);
const PingApi = householdModuleApi("finance", HttpApi.make("test.ping").add(PingGroup));
const pingHandlers = HttpApiBuilder.group(PingApi, "test.ping", (handlers) =>
  handlers.handle(
    "getPing",
    Effect.fn("test.ping.getPing")(function* () {
      const membership = yield* CurrentMembership;
      return json({ ok: true, householdId: membership.householdId });
    }),
    UNINTERRUPTIBLE,
  ),
);

/** A fake `finance` module whose only household route is the mini API above. */
const fakeFinance: ApiModule = {
  id: "finance",
  schema: {},
  householdApi: { apis: [PingApi], handlers: pingHandlers },
};

/** An in-memory app serving `modules` through `moduleRoutesLayer`, over the core middleware implementations. */
function moduleApp(modules: readonly ApiModule[]) {
  return testHttpApp([], Layer.empty, moduleRoutesLayer(modules).pipe(Layer.provideMerge(httpMiddlewareLayer())));
}

/** The fake finance module's app (g), (k), (l): built once, on its first request. */
const fakeFinanceApp = moduleApp([fakeFinance]);

/** Enables finance for `owner`'s household (with `partner` in slot 2) through the real route. */
async function enableFinance(owner: Account, partner: Account): Promise<void> {
  const enabled = await call(app, modulePath(owner.householdId, "finance"), {
    method: "POST",
    cookie: owner.cookie,
    body: { settings: financeSettings(owner, partner) },
  });
  expect(enabled.status).toBe(200);
}

beforeAll(async () => {
  await runMigrations(db);
});

afterAll(() => {
  setVerifiedEmailRequired(null);
});

/* --------------------------------- tests --------------------------------- */

describe("module rows of a new household", () => {
  test("(a) POST /api/households reports modules [recipe], and GET /api/auth/me lists it the same", async () => {
    const owner = await register("Owner");
    const response = await call(app, "/api/households", {
      method: "POST",
      cookie: owner.cookie,
      body: { name: "WG Küche" },
    });
    expect(response.status).toBe(201);
    const { household } = (await response.json()) as HouseholdBody;
    expect(household.modules).toEqual(["recipe"]);

    const me = await call(app, "/api/auth/me", { cookie: owner.cookie });
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as { households: { id: string; modules: string[] }[] };
    expect(meBody.households.find((entry) => entry.id === household.id)?.modules).toEqual(["recipe"]);
    // The household registration created carries the default too.
    expect(meBody.households.find((entry) => entry.id === owner.householdId)?.modules).toEqual(["recipe"]);
  });
});

describe("POST /api/households/:householdId/modules/:moduleId", () => {
  test("(b) the owner enables finance; a second POST keeps enabled_at", async () => {
    const owner = await register("Owner");
    const partner = await withPartner(owner);
    const settings = financeSettings(owner, partner);
    const first = await call(app, modulePath(owner.householdId, "finance"), {
      method: "POST",
      cookie: owner.cookie,
      body: { settings },
    });
    expect(first.status).toBe(200);
    const { household } = (await first.json()) as HouseholdBody;
    expect(household.id).toBe(owner.householdId);
    expect(household.role).toBe("owner");
    expect(household.modules).toEqual(["recipe", "finance"]);
    const before = await moduleRow(owner.householdId, "finance");
    expect(before?.settings).toBe(JSON.stringify(settings));

    await Bun.sleep(5);
    const second = await call(app, modulePath(owner.householdId, "finance"), {
      method: "POST",
      cookie: owner.cookie,
    });
    expect(second.status).toBe(200);
    expect(((await second.json()) as HouseholdBody).household.modules).toEqual(["recipe", "finance"]);
    const after = await moduleRow(owner.householdId, "finance");
    expect(after?.enabledAt).toBe(before?.enabledAt as number);
    expect(await reportedModules(owner, owner.householdId)).toEqual(["recipe", "finance"]);
  });

  test("(c) settings are stored as JSON text, replaced only when sent", async () => {
    const owner = await register("Owner");
    const partner = await withPartner(owner);
    const path = modulePath(owner.householdId, "finance");
    const first = financeSettings(owner, partner);
    const sent = await call(app, path, { method: "POST", cookie: owner.cookie, body: { settings: first } });
    expect(sent.status).toBe(200);
    expect((await moduleRow(owner.householdId, "finance"))?.settings).toBe(JSON.stringify(first));

    // No settings sent: the stored ones stay.
    const bare = await call(app, path, { method: "POST", cookie: owner.cookie, body: {} });
    expect(bare.status).toBe(200);
    expect((await moduleRow(owner.householdId, "finance"))?.settings).toBe(JSON.stringify(first));

    const swapped = financeSettings(partner, owner);
    const replaced = await call(app, path, { method: "POST", cookie: owner.cookie, body: { settings: swapped } });
    expect(replaced.status).toBe(200);
    expect((await moduleRow(owner.householdId, "finance"))?.settings).toBe(JSON.stringify(swapped));

    const invalid = await call(app, path, { method: "POST", cookie: owner.cookie, body: { settings: 5 } });
    expect(invalid.status).toBe(422);
    expect(((await invalid.json()) as ErrorBody).error.code).toBe("validation_failed");
    const malformed = await app.request(path, {
      method: "POST",
      headers: { Cookie: owner.cookie, "Content-Type": "application/json" },
      body: "{not json",
    });
    expect(malformed.status).toBe(422);
    expect((await moduleRow(owner.householdId, "finance"))?.settings).toBe(JSON.stringify(swapped));
  });

  test("(e) member 403, admin 200, non-member 403, no cookie 401, unknown module 404", async () => {
    const owner = await register("Owner");
    const admin = await register("Admin");
    const member = await register("Member");
    const outsider = await register("Outsider");
    await addMember(owner.householdId, admin, "admin");
    await addMember(owner.householdId, member, "member");
    const path = modulePath(owner.householdId, "finance");

    for (const method of ["POST", "DELETE"]) {
      const denied = await call(app, path, { method, cookie: member.cookie });
      expect(denied.status).toBe(403);
      expect(((await denied.json()) as ErrorBody).error.code).toBe("forbidden");

      const stranger = await call(app, path, { method, cookie: outsider.cookie });
      expect(stranger.status).toBe(403);
      expect(((await stranger.json()) as ErrorBody).error.code).toBe("forbidden");

      const anonymous = await call(app, path, { method });
      expect(anonymous.status).toBe(401);
      expect(((await anonymous.json()) as ErrorBody).error.code).toBe("unauthorized");

      const unknown = await call(app, modulePath(owner.householdId, "nope"), { method, cookie: owner.cookie });
      expect(unknown.status).toBe(404);
      expect(((await unknown.json()) as ErrorBody).error.code).toBe("not_found");
    }

    const allowed = await call(app, path, {
      method: "POST",
      cookie: admin.cookie,
      body: { settings: financeSettings(owner, admin) },
    });
    expect(allowed.status).toBe(200);
    const { household } = (await allowed.json()) as HouseholdBody;
    expect(household.role).toBe("admin");
    expect(household.modules).toEqual(["recipe", "finance"]);
    expect(await moduleRow(owner.householdId, "nope")).toBeUndefined();
  });

  test("(f) with the verified-e-mail gate on, an unconfirmed admin gets 403 email_unverified", async () => {
    const owner = await register("Owner");
    const admin = await register("Admin");
    await addMember(owner.householdId, admin, "admin");
    const path = modulePath(owner.householdId, "finance");
    setVerifiedEmailRequired(true);
    try {
      for (const method of ["POST", "DELETE"]) {
        const blocked = await call(app, path, { method, cookie: admin.cookie });
        expect(blocked.status).toBe(403);
        expect(((await blocked.json()) as ErrorBody).error.code).toBe("email_unverified");
      }
      expect(await moduleRow(owner.householdId, "finance")).toBeUndefined();

      await db.update(users).set({ emailVerified: true, emailVerifiedAt: Date.now() }).where(eq(users.id, admin.userId));
      const confirmed = await call(app, path, {
        method: "POST",
        cookie: admin.cookie,
        body: { settings: financeSettings(owner, admin) },
      });
      expect(confirmed.status).toBe(200);
    } finally {
      setVerifiedEmailRequired(null);
    }
  });
});

describe("DELETE /api/households/:householdId/modules/:moduleId", () => {
  test("(d) deletes the row (204), GET reports the rest, a second DELETE is 204 too", async () => {
    const owner = await register("Owner");
    const partner = await withPartner(owner);
    const enabled = await call(app, modulePath(owner.householdId, "finance"), {
      method: "POST",
      cookie: owner.cookie,
      body: { settings: financeSettings(owner, partner) },
    });
    expect(enabled.status).toBe(200);

    const removed = await call(app, modulePath(owner.householdId, "recipe"), {
      method: "DELETE",
      cookie: owner.cookie,
    });
    expect(removed.status).toBe(204);
    expect(await reportedModules(owner, owner.householdId)).toEqual(["finance"]);
    expect(await moduleRow(owner.householdId, "recipe")).toBeUndefined();

    const again = await call(app, modulePath(owner.householdId, "recipe"), {
      method: "DELETE",
      cookie: owner.cookie,
    });
    expect(again.status).toBe(204);
    expect(await reportedModules(owner, owner.householdId)).toEqual(["finance"]);
  });
});

describe("the module gate end to end", () => {
  test("(g) a mounted module answers module_disabled, then 200 after enabling, then module_disabled after DELETE", async () => {
    const moduleApp = fakeFinanceApp;

    const owner = await register("Owner");
    const partner = await withPartner(owner);
    const ping = `/api/households/${owner.householdId}/finance/ping`;

    const before = await call(moduleApp, ping, { cookie: owner.cookie });
    expect(before.status).toBe(404);
    expect(((await before.json()) as ErrorBody).error.code).toBe("module_disabled");

    const enabled = await call(app, modulePath(owner.householdId, "finance"), {
      method: "POST",
      cookie: owner.cookie,
      body: { settings: financeSettings(owner, partner) },
    });
    expect(enabled.status).toBe(200);
    const open = await call(moduleApp, ping, { cookie: owner.cookie });
    expect(open.status).toBe(200);
    expect(await open.json()).toEqual({ ok: true, householdId: owner.householdId });

    const disabled = await call(app, modulePath(owner.householdId, "finance"), {
      method: "DELETE",
      cookie: owner.cookie,
    });
    expect(disabled.status).toBe(204);
    const after = await call(moduleApp, ping, { cookie: owner.cookie });
    expect(after.status).toBe(404);
    expect(((await after.json()) as ErrorBody).error.code).toBe("module_disabled");
  });
});

describe("moduleRoutesLayer (plan e7 P14)", () => {
  test("(j) a household API without RequireModule in its chain dies at layer build, naming module and endpoint", async () => {
    // Built by hand with the module prefix, but only boundary -> session -> member: the module gate is missing.
    const BrokenGroup = HttpApiGroup.make("test.broken").add(
      HttpApiEndpoint.get("getPing", "/ping", { params: { householdId: Schema.String } }),
    );
    const BrokenApi = HttpApi.make("test.broken")
      .add(BrokenGroup)
      .prefix("/api/households/:householdId/finance")
      .pipe(chain(ApiErrorBoundary, RequireSession, RequireHouseholdMember));
    const brokenHandlers = HttpApiBuilder.group(BrokenApi, "test.broken", (handlers) =>
      handlers.handle("getPing", Effect.fn("test.broken.getPing")(function* () {
        return json({ ok: true });
      })),
    );
    const broken: ApiModule = {
      id: "finance",
      schema: {},
      householdApi: { apis: [BrokenApi], handlers: brokenHandlers },
    };

    const owner = await register("Owner");
    const failure = await moduleApp([broken])
      .request(`/api/households/${owner.householdId}/finance/ping`, { headers: { Cookie: owner.cookie } })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(failure).toBeDefined();
    const message = String(failure instanceof Error ? failure.message : failure);
    expect(message).toContain('module "finance"');
    expect(message).toContain("test.broken.getPing");
    expect(message).toContain("GET /api/households/:householdId/finance/ping");
    expect(message).toContain("RequireModule");
  });

  test("(k) an unknown path below a module: 401 without a cookie, 403 as a non-member, module_disabled, then not_found", async () => {
    const owner = await register("Owner");
    const partner = await withPartner(owner);
    const outsider = await register("Outsider");
    const unknownPaths = [
      `/api/households/${owner.householdId}/finance/nope`,
      `/api/households/${owner.householdId}/finance/ping/deeper`,
      `/api/households/${owner.householdId}/finance`,
    ];

    for (const path of unknownPaths) {
      for (const method of ["GET", "POST", "DELETE"]) {
        const anonymous = await call(fakeFinanceApp, path, { method });
        expect(anonymous.status).toBe(401);
        expect(((await anonymous.json()) as ErrorBody).error.code).toBe("unauthorized");

        const stranger = await call(fakeFinanceApp, path, { method, cookie: outsider.cookie });
        expect(stranger.status).toBe(403);
        expect(((await stranger.json()) as ErrorBody).error.code).toBe("forbidden");

        const disabled = await call(fakeFinanceApp, path, { method, cookie: owner.cookie });
        expect(disabled.status).toBe(404);
        expect(((await disabled.json()) as ErrorBody).error.code).toBe("module_disabled");
      }
    }

    await enableFinance(owner, partner);
    for (const path of unknownPaths) {
      for (const method of ["GET", "POST", "DELETE"]) {
        const unknown = await call(fakeFinanceApp, path, { method, cookie: owner.cookie });
        expect(unknown.status).toBe(404);
        const body = (await unknown.json()) as ErrorBody;
        expect(body.error.code).toBe("not_found");
        expect(body.error.message).toContain(`${method} ${path}`);
      }
    }
  });

  test("(l) HEAD on a module GET falls through to the GET route: 200, empty body", async () => {
    const owner = await register("Owner");
    const partner = await withPartner(owner);
    await enableFinance(owner, partner);

    const head = await call(fakeFinanceApp, `/api/households/${owner.householdId}/finance/ping`, {
      method: "HEAD",
      cookie: owner.cookie,
    });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  test("(m) the real API_MODULES build through moduleRoutesLayer and serve one GET of each module", async () => {
    const realApp = moduleApp(API_MODULES);
    const owner = await register("Owner");
    const partner = await withPartner(owner);
    await enableFinance(owner, partner);

    // recipe, household API (enabled by default)
    const recipes = await call(realApp, `/api/households/${owner.householdId}/recipe/recipes`, { cookie: owner.cookie });
    expect(recipes.status).toBe(200);
    // recipe, user API
    const cards = await call(realApp, "/api/recipe/cards", { cookie: owner.cookie });
    expect(cards.status).toBe(200);
    // finance, household API (the owner holds slot 1)
    const balance = await call(realApp, `/api/households/${owner.householdId}/finance/balance`, { cookie: owner.cookie });
    expect(balance.status).toBe(200);

    // The catch-alls are there too: an unknown path below each household module.
    for (const id of ["recipe", "finance"]) {
      const unknown = await call(realApp, `/api/households/${owner.householdId}/${id}/nope`, { cookie: owner.cookie });
      expect(unknown.status).toBe(404);
      expect(((await unknown.json()) as ErrorBody).error.code).toBe("not_found");
    }
  });
});

describe("finance's onEnable (SPEC D3)", () => {
  test("(g') a one-member household cannot enable finance: 422 finance_participants_required, nothing written", async () => {
    const owner = await register("Owner");
    const refused = await call(app, modulePath(owner.householdId, "finance"), {
      method: "POST",
      cookie: owner.cookie,
    });
    expect(refused.status).toBe(422);
    expect(((await refused.json()) as ErrorBody).error.code).toBe("finance_participants_required");
    expect(await moduleRow(owner.householdId, "finance")).toBeUndefined();
    const seats = await db
      .select()
      .from(financeParticipants)
      .where(eq(financeParticipants.householdId, owner.householdId));
    expect(seats).toEqual([]);
    expect(await reportedModules(owner, owner.householdId)).toEqual(["recipe"]);
  });
});

describe("module hooks", () => {
  test("(h) a refusing onEnable rejects with its ApiError and writes no row", async () => {
    const owner = await register("Owner");
    const refusal = new ApiError(409, "participants_missing", "server.error.conflict");
    const calls: { householdId: string; settings: unknown }[] = [];
    const refusing: ApiModule = {
      id: "finance",
      schema: {},
      onEnable: (householdId: string, settings: unknown) =>
        Effect.suspend(() => {
          calls.push({ householdId, settings });
          return Effect.fail(refusal);
        }),
    };

    const enable = (settings: Record<string, unknown> | undefined) =>
      HouseholdModules.use((modules) =>
        modules.enableModule(owner.householdId, "finance", settings, [refusing]),
      );
    expect(await runTest(Effect.flip(enable(undefined)))).toBe(refusal);
    expect(calls).toEqual([{ householdId: owner.householdId, settings: null }]);
    expect(await moduleRow(owner.householdId, "finance")).toBeUndefined();

    // Settings reach the hook as sent, and a refusal with settings writes nothing either.
    expect(await runTest(Effect.flip(enable({ a: 1 })))).toBe(refusal);
    expect(calls[1]).toEqual({ householdId: owner.householdId, settings: { a: 1 } });
    expect(await moduleRow(owner.householdId, "finance")).toBeUndefined();
  });

  test("(h') an accepting onEnable runs once and the row is written", async () => {
    const owner = await register("Owner");
    let runs = 0;
    const accepting: ApiModule = {
      id: "finance",
      schema: {},
      onEnable: () =>
        Effect.sync(() => {
          runs += 1;
        }),
    };
    await runTest(
      HouseholdModules.use((modules) =>
        modules.enableModule(owner.householdId, "finance", undefined, [accepting]),
      ),
    );
    expect(runs).toBe(1);
    expect(await moduleRow(owner.householdId, "finance")).toBeDefined();
  });

  test("(i) initializeHousehold calls onHouseholdCreated once with the id", async () => {
    const owner = await register("Owner");
    await db.delete(householdModules).where(eq(householdModules.householdId, owner.householdId));
    const seen: string[] = [];
    const recording: ApiModule = {
      id: "finance",
      schema: {},
      onHouseholdCreated: (householdId: string) =>
        Effect.sync(() => {
          seen.push(householdId);
        }),
    };
    await runTest(
      HouseholdModules.use((modules) => modules.initializeHousehold(owner.householdId, [recording])),
    );
    expect(seen).toEqual([owner.householdId]);
    expect(await moduleRow(owner.householdId, "recipe")).toBeDefined();
  });
});
