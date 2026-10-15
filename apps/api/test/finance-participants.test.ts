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
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { setVerifiedEmailRequired } from "../src/core/services/auth/verifiedEmail.ts";
import { db } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { householdMembers, users } from "../src/db/schema.ts";
import { notFoundHandler, onErrorHandler } from "../src/lib/errors.ts";
import { localeMiddleware } from "../src/lib/locale.ts";
import type { AppEnv } from "../src/lib/types.ts";
import { requireFinanceParticipant, requireFinanceParticipantContext } from "../src/modules/finance/middleware.ts";
import { mountModules } from "../src/modules/mount.ts";
import type { ApiModule } from "../src/modules/types.ts";
import { financeFixedCostPlans, financeParticipants, financeTransactions } from "../src/modules/finance/schema.ts";
import {
  addMember,
  addPlaceholder,
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
  email: string | null;
  hasAccount: boolean;
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
      ["displayName", "email", "hasAccount", "joinedAt", "memberSlot", "name", "userId"],
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

describe("a participant leaving the household (toon-finance member_has_ledger, SPEC D13)", () => {
  const membersPath = (householdId: string, userId: string): string =>
    `/api/households/${householdId}/members/${userId}`;

  async function isMember(householdId: string, userId: string): Promise<boolean> {
    const rows = await db
      .select({ userId: householdMembers.userId })
      .from(householdMembers)
      .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId)));
    return rows.length > 0;
  }

  async function bookRow(householdId: string, payerId: string): Promise<void> {
    await db.insert(financeTransactions).values({
      id: crypto.randomUUID(),
      householdId,
      payerId,
      splitMode: "SPLIT_EQUAL",
      amountCents: 1_000,
      description: "Einkauf",
      bookedAt: Date.now(),
      dateSource: "day",
      origin: "manual",
      categorySource: "manual",
    });
  }

  test("(h) a seated participant with ledger rows cannot leave or be removed: 409 member_has_ledger, nothing changes", async () => {
    const { owner, b, householdId } = await trio();
    await bookRow(householdId, b.id);
    const before = await list(owner, householdId);

    const leave = await call(membersPath(householdId, b.id), { method: "DELETE", cookie: b.cookie });
    expect(leave.status).toBe(409);
    expect((await errorOf(leave)).code).toBe("member_has_ledger");

    const removed = await call(membersPath(householdId, b.id), { method: "DELETE", cookie: owner.cookie });
    expect(removed.status).toBe(409);
    expect((await errorOf(removed)).code).toBe("member_has_ledger");

    expect(await isMember(householdId, b.id)).toBe(true);
    expect(await list(owner, householdId)).toEqual(before);

    // The partner who never paid is just as bound: every row involves both slots.
    const ownerLeaves = await call(membersPath(householdId, owner.id), { method: "DELETE", cookie: owner.cookie });
    expect(ownerLeaves.status).toBe(409);
  });

  test("(h2) once the ledger rows are gone the participant may leave", async () => {
    const { b, householdId } = await trio();
    await bookRow(householdId, b.id);
    expect((await call(membersPath(householdId, b.id), { method: "DELETE", cookie: b.cookie })).status).toBe(409);
    await db.delete(financeTransactions).where(eq(financeTransactions.householdId, householdId));
    expect((await call(membersPath(householdId, b.id), { method: "DELETE", cookie: b.cookie })).status).toBe(204);
    expect(await isMember(householdId, b.id)).toBe(false);
  });

  test("(h3) a member without a seat leaves freely, ledger or not", async () => {
    const { owner, c, householdId } = await trio();
    await bookRow(householdId, owner.id);
    const leave = await call(membersPath(householdId, c.id), { method: "DELETE", cookie: c.cookie });
    expect(leave.status).toBe(204);
    expect(await isMember(householdId, c.id)).toBe(false);
  });

  test("(h4) a seated participant with an empty ledger may leave and an admin can seat a replacement (no dead end)", async () => {
    const { owner, b, c, householdId } = await trio();
    expect((await call(membersPath(householdId, b.id), { method: "DELETE", cookie: b.cookie })).status).toBe(204);

    const replace = await call(participantsPath(householdId), {
      method: "PUT",
      cookie: owner.cookie,
      body: { participants: [{ userId: owner.id, memberSlot: 1 }, { userId: c.id, memberSlot: 2 }] },
    });
    expect(replace.status).toBe(200);
    expect((await list(owner, householdId)).items.map((item) => item.userId)).toEqual([owner.id, c.id]);
  });

  test("(h4b) a leaver's seat goes with them: no booking against an ex-member, then leave, book, reseat", async () => {
    const { owner, b, c, householdId } = await trio();
    expect((await call(membersPath(householdId, b.id), { method: "DELETE", cookie: b.cookie })).status).toBe(204);

    // The seat row is gone with the membership; one participant remains in slot 1.
    const seated = await list(owner, householdId);
    expect(seated.items.map((item) => item.userId)).toEqual([owner.id]);
    expect(await db.select().from(financeParticipants).where(eq(financeParticipants.userId, b.id))).toEqual([]);

    // Booking is a solo booking (toon-finance's one-member ledger): it is NOT booked against Bea.
    const booking = { kind: "MINE_SPLIT", amountCents: 500, description: "Kaffee" };
    const booked = await call(`/api/households/${householdId}/finance/transactions`, {
      method: "POST",
      cookie: owner.cookie,
      body: booking,
    });
    expect(booked.status).toBe(201);
    const balance = await call(`/api/households/${householdId}/finance/balance`, { cookie: owner.cookie });
    expect(balance.status).toBe(200);
    expect((await list(owner, householdId)).items.map((item) => item.userId)).toEqual([owner.id]);

    // The seat is free: an admin seats the second member (the kept owner leaves nobody behind), no
    // 409 finance_participant_in_use dead end.
    const reseat = await call(participantsPath(householdId), {
      method: "PUT",
      cookie: owner.cookie,
      body: { participants: [{ userId: owner.id, memberSlot: 1 }, { userId: c.id, memberSlot: 2 }] },
    });
    expect(reseat.status).toBe(200);
    expect((await list(owner, householdId)).items.map((item) => item.userId)).toEqual([owner.id, c.id]);
  });

  test("(h4c) a leaving payer of the fixed-cost plan hands the plan to the remaining participant", async () => {
    const { owner, b, householdId } = await trio();
    await db.update(financeFixedCostPlans).set({ payerId: b.id }).where(eq(financeFixedCostPlans.householdId, householdId));
    expect((await call(membersPath(householdId, b.id), { method: "DELETE", cookie: b.cookie })).status).toBe(204);
    const plans = await db
      .select({ payerId: financeFixedCostPlans.payerId })
      .from(financeFixedCostPlans)
      .where(eq(financeFixedCostPlans.householdId, householdId));
    expect(plans).toEqual([{ payerId: owner.id }]);
  });

  test("(h6) the slot-1 participant leaves an empty ledger: the survivor is re-seated in slot 1 and the ledger stays readable (M4-T01)", async () => {
    const owner = await createUser("Owner");
    const b = await createUser("Bea");
    const householdId = await createPlainHousehold(owner, "Umsitzen");
    await addMember(owner, householdId, b);
    // Bea holds slot 1, the owner slot 2: the anchor of the balance sign leaves with Bea.
    expect((await enableFinance(owner, householdId, b, owner)).status).toBe(200);
    expect((await list(owner, householdId)).items.map((item) => [item.userId, item.memberSlot])).toEqual([
      [b.id, 1],
      [owner.id, 2],
    ]);

    expect((await call(membersPath(householdId, b.id), { method: "DELETE", cookie: b.cookie })).status).toBe(204);

    const seated = await list(owner, householdId);
    expect(seated.items.map((item) => [item.userId, item.memberSlot])).toEqual([[owner.id, 1]]);
    expect(seated.viewerSlot).toBe(1);

    // On 0bee16c slot1UserId threw and both reads were 500.
    const balance = await call(`/api/households/${householdId}/finance/balance`, { cookie: owner.cookie });
    expect(balance.status).toBe(200);
    expect((await body<{ balanceCents: number }>(balance)).balanceCents).toBe(0);
    const transactions = await call(`/api/households/${householdId}/finance/transactions`, { cookie: owner.cookie });
    expect(transactions.status).toBe(200);
    expect((await body<{ items: unknown[]; total: number }>(transactions)).total).toBe(0);

    // A booking behaves as the solo ledger of finance-transactions.test.ts: 201, never against Bea.
    const booked = await call(`/api/households/${householdId}/finance/transactions`, {
      method: "POST",
      cookie: owner.cookie,
      body: { kind: "MINE_SPLIT", amountCents: 500, description: "Kaffee" },
    });
    expect(booked.status).toBe(201);
    const rows = await db.select().from(financeTransactions).where(eq(financeTransactions.householdId, householdId));
    expect(rows.map((row) => row.payerId)).toEqual([owner.id]);
    const after = await call(`/api/households/${householdId}/finance/balance`, { cookie: owner.cookie });
    expect(after.status).toBe(200);
  });

  test("(h6b) the slot-2 participant leaves an empty ledger: slot 1 stays untouched", async () => {
    const { owner, b, householdId } = await trio();
    const before = await db.select().from(financeParticipants).where(eq(financeParticipants.userId, owner.id));
    expect(before.map((row) => row.memberSlot)).toEqual([1]);

    expect((await call(membersPath(householdId, b.id), { method: "DELETE", cookie: b.cookie })).status).toBe(204);

    const after = await db.select().from(financeParticipants).where(eq(financeParticipants.householdId, householdId));
    expect(after.map((row) => [row.userId, row.memberSlot])).toEqual([[owner.id, 1]]);
    expect((await list(owner, householdId)).items.map((item) => [item.userId, item.memberSlot])).toEqual([[owner.id, 1]]);
    expect((await call(`/api/households/${householdId}/finance/balance`, { cookie: owner.cookie })).status).toBe(200);
  });

  test("(h5) the veto applies while finance is disabled: its rows outlive a disable (D2)", async () => {
    const { owner, b, householdId } = await trio();
    await bookRow(householdId, b.id);
    const disable = await call(`/api/households/${householdId}/modules/finance`, {
      method: "DELETE",
      cookie: owner.cookie,
    });
    expect(disable.status).toBeLessThan(300);
    const leave = await call(membersPath(householdId, b.id), { method: "DELETE", cookie: b.cookie });
    expect(leave.status).toBe(409);
    expect((await errorOf(leave)).code).toBe("member_has_ledger");
  });
});

describe("placeholder seats (plan m3b decision 6, ADR 0006; toon-finance b1b517d placeholders.test.ts)", () => {
  const membersPath = (householdId: string, userId: string): string =>
    `/api/households/${householdId}/members/${userId}`;

  /** A household with finance enabled: the owner in slot 1, a placeholder created through the core route in slot 2. */
  async function withPlaceholder(): Promise<{ owner: TestUser; placeholderId: string; householdId: string }> {
    const owner = await createUser("Owner");
    const householdId = await createPlainHousehold(owner, "Platzhalter");
    const placeholderId = await addPlaceholder(owner, householdId, "Sandy");
    const placeholder = { id: placeholderId } as TestUser;
    const enabled = await enableFinance(owner, householdId, owner, placeholder);
    expect(enabled.status).toBe(200);
    return { owner, placeholderId, householdId };
  }

  test("F: seats a person without an account in slot 2 (H: hasAccount false, e-mail null, named after users.name)", async () => {
    const { owner, placeholderId, householdId } = await withPlaceholder();
    const seats = await list(owner, householdId);
    expect(seats.items.map((item) => [item.userId, item.memberSlot])).toEqual([
      [owner.id, 1],
      [placeholderId, 2],
    ]);
    const seat = seats.items[1]!;
    expect(seat.hasAccount).toBe(false);
    expect(seat.email).toBeNull();
    expect(seat.displayName).toBe("Sandy");
    expect(seats.items[0]!.hasAccount).toBe(true);
  });

  test("a placeholder in slot 1 is 422 server.finance.placeholderSlotOne with a detail on the slot-1 entry; nothing changes", async () => {
    const { owner, placeholderId, householdId } = await withPlaceholder();
    const before = await list(owner, householdId);
    const swap = {
      participants: [
        { userId: placeholderId, memberSlot: 1 },
        { userId: owner.id, memberSlot: 2 },
      ],
    };
    const response = await call(participantsPath(householdId), { method: "PUT", cookie: owner.cookie, body: swap });
    expect(response.status).toBe(422);
    const payload = (await body<{ error: { code: string; message: string; details?: Array<{ path: string }> } }>(response)).error;
    expect(payload.code).toBe("validation_failed");
    expect(payload.message).toBe("Eine Person ohne Konto kann nur Platz 2 belegen.");
    expect(payload.details?.[0]?.path).toBe("participants.0.userId");
    expect(await list(owner, householdId)).toEqual(before);
  });

  test("the enable settings refuse a placeholder in slot 1 too, and write nothing", async () => {
    const owner = await createUser("Owner");
    const householdId = await createPlainHousehold(owner, "Slot eins");
    const placeholderId = await addPlaceholder(owner, householdId, "Sandy");
    const enabled = await enableFinance(owner, householdId, { id: placeholderId } as TestUser, owner);
    expect(enabled.status).toBe(422);
    expect((await errorOf(enabled)).code).toBe("validation_failed");
    const rows = await db.select().from(financeParticipants).where(eq(financeParticipants.householdId, householdId));
    expect(rows).toEqual([]);
  });

  test("F: a third seat is still 409 household_full (H: PUT with a third entry is 422 validation_failed, exactly two seats, D3)", async () => {
    const { owner, placeholderId, householdId } = await withPlaceholder();
    const third = await createUser("Dritte");
    await addMember(owner, householdId, third);
    const response = await call(participantsPath(householdId), {
      method: "PUT",
      cookie: owner.cookie,
      body: {
        participants: [
          { userId: owner.id, memberSlot: 1 },
          { userId: placeholderId, memberSlot: 2 },
          { userId: third.id, memberSlot: 2 },
        ],
      },
    });
    expect(response.status).toBe(422);
    expect((await errorOf(response)).code).toBe("validation_failed");
    expect((await list(owner, householdId)).items).toHaveLength(2);
  });

  test("F: the other member may rename the placeholder, but never a real member (PATCH …/participants/:userId)", async () => {
    const { owner, placeholderId, householdId } = await withPlaceholder();
    const renamed = await call(`${participantsPath(householdId)}/${placeholderId}`, {
      method: "PATCH",
      cookie: owner.cookie,
      body: { displayName: "  Sandra " },
    });
    expect(renamed.status).toBe(200);
    const seat = await body<Participant>(renamed);
    expect(seat.displayName).toBe("Sandra");
    expect(seat.hasAccount).toBe(false);
    expect((await list(owner, householdId)).items[1]!.displayName).toBe("Sandra");

    // A seat with an account is its holder's to rename (…/me), never the other participant's.
    const b = await createUser("Bea");
    await addMember(owner, householdId, b);
    expect(
      (
        await call(participantsPath(householdId), {
          method: "PUT",
          cookie: owner.cookie,
          body: { participants: [{ userId: owner.id, memberSlot: 1 }, { userId: b.id, memberSlot: 2 }] },
        })
      ).status,
    ).toBe(200);
    const refused = await call(`${participantsPath(householdId)}/${b.id}`, {
      method: "PATCH",
      cookie: owner.cookie,
      body: { displayName: "Gehackt" },
    });
    expect(refused.status).toBe(403);
    expect((await errorOf(refused)).code).toBe("forbidden");
    expect((await list(owner, householdId)).items[1]!.displayName).toBe("Bea");

    // A member without a seat is not a participant: the gate answers before the rename.
    const outsider = await createUser("Draussen");
    await addMember(owner, householdId, outsider);
    const gate = await call(`${participantsPath(householdId)}/${b.id}`, {
      method: "PATCH",
      cookie: outsider.cookie,
      body: { displayName: "Gehackt" },
    });
    expect(gate.status).toBe(403);
    expect((await errorOf(gate)).code).toBe("finance_not_participant");
  });

  test("renaming a user without a seat in this household is 404; a control character in the name is 422", async () => {
    const { owner, placeholderId, householdId } = await withPlaceholder();
    const stranger = await createUser("Fremd");
    const unseated = await call(`${participantsPath(householdId)}/${stranger.id}`, {
      method: "PATCH",
      cookie: owner.cookie,
      body: { displayName: "Nope" },
    });
    expect(unseated.status).toBe(404);
    for (const name of ["Zeile\neins", "Tab\tulator"]) {
      const response = await call(`${participantsPath(householdId)}/${placeholderId}`, {
        method: "PATCH",
        cookie: owner.cookie,
        body: { displayName: name },
      });
      expect([name, response.status]).toEqual([name, 422]);
    }
    expect((await list(owner, householdId)).items[1]!.displayName).toBe("Sandy");
  });

  test("F: a placeholder with bookings cannot be removed (409 member_has_ledger through the core DELETE; the user row stays)", async () => {
    const { owner, placeholderId, householdId } = await withPlaceholder();
    await db.insert(financeTransactions).values({
      id: crypto.randomUUID(),
      householdId,
      payerId: owner.id,
      splitMode: "SPLIT_EQUAL",
      amountCents: 1_000,
      description: "Sandy bekommt die Hälfte",
      bookedAt: Date.now(),
      dateSource: "day",
      origin: "manual",
      categorySource: "manual",
    });
    const removed = await call(membersPath(householdId, placeholderId), { method: "DELETE", cookie: owner.cookie });
    expect(removed.status).toBe(409);
    expect((await errorOf(removed)).code).toBe("member_has_ledger");
    const [row] = await db.select({ id: users.id }).from(users).where(eq(users.id, placeholderId));
    expect(row?.id).toBe(placeholderId);
    expect((await list(owner, householdId)).items.map((item) => item.userId)).toEqual([owner.id, placeholderId]);
  });

  test("a seated placeholder with an empty ledger is removed with its seat and its user row (ADR 0004: the seat goes with it)", async () => {
    const { owner, placeholderId, householdId } = await withPlaceholder();
    const removed = await call(membersPath(householdId, placeholderId), { method: "DELETE", cookie: owner.cookie });
    expect(removed.status).toBe(204);
    expect((await list(owner, householdId)).items.map((item) => [item.userId, item.memberSlot])).toEqual([[owner.id, 1]]);
    const rows = await db.select({ id: users.id }).from(users).where(eq(users.id, placeholderId));
    expect(rows).toEqual([]);
  });
});
