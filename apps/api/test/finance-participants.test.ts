/**
 * The finance participants HTTP surface (plan M3 task T03b, decisions 3-6; SPEC D3, D8):
 * GET/PUT/PATCH-me on /api/households/:householdId/finance/participants, the
 * `requireFinanceParticipant()` gate, and the module chain in front of them. The counterpart of
 * toon-finance's `households.test.ts` member tests.
 *
 * Shared `db` + `runMigrations(db)` (the routes read it). Users and households come from the
 * finance harness, i.e. the real core routes. `bun test` runs every file in one process, so the
 * verified-e-mail override is handed back in `afterEach`.
 */
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { setVerifiedEmailRequired } from "../src/core/services/auth/verifiedEmail.ts";
import { db } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { users } from "../src/db/schema.ts";
import { notFoundHandler, onErrorHandler } from "../src/lib/errors.ts";
import { localeMiddleware } from "../src/lib/locale.ts";
import type { AppEnv } from "../src/lib/types.ts";
import { requireFinanceParticipant, requireFinanceParticipantContext } from "../src/modules/finance/middleware.ts";
import { mountModules } from "../src/modules/mount.ts";
import type { ApiModule } from "../src/modules/types.ts";
import { financeTransactions } from "../src/modules/finance/schema.ts";
import {
  addMember,
  body,
  call,
  createPlainHousehold,
  createUser,
  enableFinance,
  type TestUser,
} from "./support/finance-harness.ts";

interface ErrorBody {
  error: { code: string; message: string };
}

interface Participant {
  userId: string;
  memberSlot: 1 | 2;
  displayName: string;
  name: string;
  email: string;
  joinedAt: string;
}

interface ParticipantList {
  items: Participant[];
  viewerSlot: 1 | 2 | null;
}

beforeAll(async () => {
  await runMigrations(db);
});

afterEach(() => {
  setVerifiedEmailRequired(null);
});

const participantsPath = (householdId: string): string => `/api/households/${householdId}/finance/participants`;

interface Trio {
  owner: TestUser;
  b: TestUser;
  c: TestUser;
  householdId: string;
}

/** A three-member household (owner, B, C), finance enabled with owner in slot 1 and B in slot 2. */
async function trio(): Promise<Trio> {
  const owner = await createUser("Owner");
  const b = await createUser("Bea");
  const c = await createUser("Cleo");
  const householdId = await createPlainHousehold(owner, "Dreier");
  await addMember(owner, householdId, b);
  await addMember(owner, householdId, c);
  const enabled = await enableFinance(owner, householdId, owner, b);
  expect(enabled.status).toBe(200);
  return { owner, b, c, householdId };
}

async function list(user: TestUser, householdId: string): Promise<ParticipantList> {
  const response = await call(participantsPath(householdId), { cookie: user.cookie });
  expect(response.status).toBe(200);
  return body<ParticipantList>(response);
}

async function errorOf(response: Response): Promise<ErrorBody["error"]> {
  return (await body<ErrorBody>(response)).error;
}

describe("GET and the participant gate", () => {
  test("(a) any member reads the two seats with their own viewerSlot; the gate refuses a member without one", async () => {
    const { owner, b, c, householdId } = await trio();

    const asC = await list(c, householdId);
    expect(asC.viewerSlot).toBeNull();
    expect(asC.items.map((item) => [item.memberSlot, item.name])).toEqual([
      [1, "Owner"],
      [2, "Bea"],
    ]);
    expect(Object.keys(asC.items[0] ?? {}).sort()).toEqual(
      ["displayName", "email", "joinedAt", "memberSlot", "name", "userId"],
    );

    expect((await list(b, householdId)).viewerSlot).toBe(2);
    expect((await list(owner, householdId)).viewerSlot).toBe(1);

    // The gate itself, mounted on a probe module behind the REAL chain of modules/mount.ts.
    const probe = new Hono<AppEnv>();
    probe.use("*", requireFinanceParticipant());
    probe.get("/probe", (c2) => c2.json(requireFinanceParticipantContext(c2)));
    const probeModule: ApiModule = { id: "finance", schema: {}, householdRouter: probe };
    const probeApp = new Hono<AppEnv>();
    probeApp.onError(onErrorHandler);
    probeApp.notFound(notFoundHandler);
    probeApp.use("*", localeMiddleware);
    mountModules(probeApp, [probeModule]);
    const url = `/api/households/${householdId}/finance/probe`;
    const asCProbe = await probeApp.request(url, { headers: { Cookie: c.cookie } });
    expect(asCProbe.status).toBe(403);
    expect((await errorOf(asCProbe)).code).toBe("finance_not_participant");
    const asBProbe = await probeApp.request(url, { headers: { Cookie: b.cookie } });
    expect(asBProbe.status).toBe(200);
    expect(await asBProbe.json()).toEqual({ householdId, userId: b.id, memberSlot: 2 });

    // The ledger's own balance route behind the same gate (toon-finance GET …/balance, M3 decision 3).
    const balanceUrl = `/api/households/${householdId}/finance/balance`;
    const asCBalance = await call(balanceUrl, { cookie: c.cookie });
    expect(asCBalance.status).toBe(403);
    expect((await errorOf(asCBalance)).code).toBe("finance_not_participant");
    const asBBalance = await call(balanceUrl, { cookie: b.cookie });
    expect(asBBalance.status).toBe(200);
  });
});

describe("PUT", () => {
  test("(b) a member is refused 403; an admin swaps the slots and GET shows the swap", async () => {
    const { owner, b, c, householdId } = await trio();
    const swap = { participants: [{ userId: b.id, memberSlot: 1 }, { userId: owner.id, memberSlot: 2 }] };

    const refused = await call(participantsPath(householdId), { method: "PUT", cookie: c.cookie, body: swap });
    expect(refused.status).toBe(403);
    expect((await errorOf(refused)).code).toBe("forbidden");
    expect((await list(owner, householdId)).items.map((item) => item.userId)).toEqual([owner.id, b.id]);

    const put = await call(participantsPath(householdId), { method: "PUT", cookie: owner.cookie, body: swap });
    expect(put.status).toBe(200);
    const swapped = await body<ParticipantList>(put);
    expect(swapped.items.map((item) => item.userId)).toEqual([b.id, owner.id]);
    expect(swapped.viewerSlot).toBe(2);

    const after = await list(b, householdId);
    expect(after.items.map((item) => [item.memberSlot, item.userId])).toEqual([
      [1, b.id],
      [2, owner.id],
    ]);
    expect(after.viewerSlot).toBe(1);
  });

  test("(c) replacing a participant whose payer rows exist is 409 finance_participant_in_use; nothing changes", async () => {
    const { owner, b, c, householdId } = await trio();
    await db.insert(financeTransactions).values({
      id: crypto.randomUUID(),
      householdId,
      payerId: b.id,
      splitMode: "SPLIT_EQUAL",
      amountCents: 1_000,
      description: "Einkauf",
      bookedAt: Date.now(),
      dateSource: "day",
      origin: "manual",
      categorySource: "manual",
    });
    const before = await list(owner, householdId);

    const replace = await call(participantsPath(householdId), {
      method: "PUT",
      cookie: owner.cookie,
      body: { participants: [{ userId: owner.id, memberSlot: 1 }, { userId: c.id, memberSlot: 2 }] },
    });
    expect(replace.status).toBe(409);
    expect((await errorOf(replace)).code).toBe("finance_participant_in_use");
    expect(await list(owner, householdId)).toEqual(before);
  });

  test("(c2) replacing a participant who never paid is still 409 while ANY transaction exists; a swap stays allowed", async () => {
    const { owner, b, c, householdId } = await trio();
    // Owner pays SPLIT_EQUAL: Bea (who never paid) owes half. Every row involves both slots.
    await db.insert(financeTransactions).values({
      id: crypto.randomUUID(),
      householdId,
      payerId: owner.id,
      splitMode: "SPLIT_EQUAL",
      amountCents: 1_000,
      description: "Einkauf",
      bookedAt: Date.now(),
      dateSource: "day",
      origin: "manual",
      categorySource: "manual",
    });
    const before = await list(owner, householdId);

    const replace = await call(participantsPath(householdId), {
      method: "PUT",
      cookie: owner.cookie,
      body: { participants: [{ userId: owner.id, memberSlot: 1 }, { userId: c.id, memberSlot: 2 }] },
    });
    expect(replace.status).toBe(409);
    expect((await errorOf(replace)).code).toBe("finance_participant_in_use");
    expect(await list(owner, householdId)).toEqual(before);

    // Cleo did not inherit Bea's debt: she has no seat and the gate refuses her.
    const cleoBalance = await call(`/api/households/${householdId}/finance/balance`, { cookie: c.cookie });
    expect(cleoBalance.status).toBe(403);

    // Swapping the same two users nobody leaves, so it stays allowed.
    const swap = await call(participantsPath(householdId), {
      method: "PUT",
      cookie: owner.cookie,
      body: { participants: [{ userId: b.id, memberSlot: 1 }, { userId: owner.id, memberSlot: 2 }] },
    });
    expect(swap.status).toBe(200);
  });

  test("(c3) with an empty ledger a replacement is allowed", async () => {
    const { owner, c, householdId } = await trio();
    const replace = await call(participantsPath(householdId), {
      method: "PUT",
      cookie: owner.cookie,
      body: { participants: [{ userId: owner.id, memberSlot: 1 }, { userId: c.id, memberSlot: 2 }] },
    });
    expect(replace.status).toBe(200);
    expect((await list(owner, householdId)).items.map((item) => item.userId)).toEqual([owner.id, c.id]);
  });

  test("(d) invalid bodies are 422: the same user twice, a non-member, one entry", async () => {
    const { owner, b, householdId } = await trio();
    const outsider = await createUser("Outsider");
    const before = await list(owner, householdId);
    const attempts: Array<[string, unknown, string]> = [
      [
        "same user twice",
        { participants: [{ userId: owner.id, memberSlot: 1 }, { userId: owner.id, memberSlot: 2 }] },
        "finance_participants_required",
      ],
      [
        "a non-member",
        { participants: [{ userId: owner.id, memberSlot: 1 }, { userId: outsider.id, memberSlot: 2 }] },
        "finance_participants_required",
      ],
      ["one entry", { participants: [{ userId: owner.id, memberSlot: 1 }] }, "validation_failed"],
      [
        "both in slot 1",
        { participants: [{ userId: owner.id, memberSlot: 1 }, { userId: b.id, memberSlot: 1 }] },
        "finance_participants_required",
      ],
    ];
    for (const [label, payload, code] of attempts) {
      const response = await call(participantsPath(householdId), { method: "PUT", cookie: owner.cookie, body: payload });
      expect([label, response.status]).toEqual([label, 422]);
      expect([label, (await errorOf(response)).code]).toEqual([label, code]);
    }
    expect(await list(owner, householdId)).toEqual(before);
  });

  test("(f) an unconfirmed e-mail is refused 403 email_unverified while the gate is on", async () => {
    const { owner, b, householdId } = await trio();
    await db.update(users).set({ emailVerified: false, emailVerifiedAt: null }).where(eq(users.id, owner.id));
    const swap = { participants: [{ userId: b.id, memberSlot: 1 }, { userId: owner.id, memberSlot: 2 }] };
    setVerifiedEmailRequired(true);

    const blocked = await call(participantsPath(householdId), { method: "PUT", cookie: owner.cookie, body: swap });
    expect(blocked.status).toBe(403);
    expect((await errorOf(blocked)).code).toBe("email_unverified");
    // Reads stay open to the unconfirmed account.
    expect((await list(owner, householdId)).items.map((item) => item.userId)).toEqual([owner.id, b.id]);
  });
});

describe("PATCH /me", () => {
  test("(e) renames the caller's own display name; a member without a seat is 403", async () => {
    const { owner, b, c, householdId } = await trio();

    const renamed = await call(`${participantsPath(householdId)}/me`, {
      method: "PATCH",
      cookie: b.cookie,
      body: { displayName: "  Bibi  " },
    });
    expect(renamed.status).toBe(200);
    const participant = await body<Participant>(renamed);
    expect(participant).toMatchObject({ userId: b.id, memberSlot: 2, displayName: "Bibi", name: "Bea" });

    const seen = await list(owner, householdId);
    expect(seen.items.map((item) => item.displayName)).toEqual(["Owner", "Bibi"]);

    const refused = await call(`${participantsPath(householdId)}/me`, {
      method: "PATCH",
      cookie: c.cookie,
      body: { displayName: "Cici" },
    });
    expect(refused.status).toBe(403);
    expect((await errorOf(refused)).code).toBe("finance_not_participant");

    const invalid = await call(`${participantsPath(householdId)}/me`, {
      method: "PATCH",
      cookie: b.cookie,
      body: { displayName: "   " },
    });
    expect(invalid.status).toBe(422);
  });
});

describe("the module chain in front of the routes", () => {
  test("(g) finance disabled is 404 module_disabled; a non-member is 403; no cookie is 401", async () => {
    const owner = await createUser("Owner");
    const stranger = await createUser("Stranger");
    const householdId = await createPlainHousehold(owner, "Ohne Kasse");

    const disabled = await call(participantsPath(householdId), { cookie: owner.cookie });
    expect(disabled.status).toBe(404);
    expect((await errorOf(disabled)).code).toBe("module_disabled");

    const partner = await createUser("Partner");
    await addMember(owner, householdId, partner);
    expect((await enableFinance(owner, householdId, owner, partner)).status).toBe(200);

    const foreign = await call(participantsPath(householdId), { cookie: stranger.cookie });
    expect(foreign.status).toBe(403);
    expect((await errorOf(foreign)).code).toBe("forbidden");

    const anonymous = await call(participantsPath(householdId));
    expect(anonymous.status).toBe(401);
  });
});
