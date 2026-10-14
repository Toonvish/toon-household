/**
 * [OFFLINE] — the replay-protection ledger itself (docs/spec.md §2.9,
 * CLAUDE.md gotcha #9/#10, ledger-spec.md §4.4).
 *
 * `transactions.test.ts` and `settlements.test.ts` already prove the *happy*
 * path end-to-end (a replayed `mutationId` on `POST` answers 200 instead of
 * booking twice). This file owns what those integration tests do not cover:
 *
 *  1. `claimMutation` at the service level, directly, including the PATCH/
 *     DELETE shape (an ALREADY-KNOWN `transactionId`, never a fresh one).
 *  2. The race the doc comment on `claimMutation` calls out by name: two
 *     concurrent deliveries of the SAME `mutationId` — the whole reason the
 *     claim is `INSERT … ON CONFLICT DO NOTHING`, never `SELECT`-then-write.
 *     A `SELECT`-then-write implementation would let both callers read
 *     "not yet applied" and both apply — this test is what would catch that
 *     regression.
 *  3. `pruneMutationClaims`'s TTL boundary.
 *  4. The gap this task found and closed: `deleteTransaction` used to check
 *     `mutationId` AFTER loading the row, so a replay delivered after the
 *     row was already gone by the FIRST delivery 404'd instead of answering
 *     204 — see `peekMutationClaim` in `services/ledger/idempotency.ts`.
 *
 * The "pure parts of the queue logic" half of this task's test plan is
 * `apps/web/src/lib/persist.test.ts` (`shouldPersistMutation`) — it already
 * covers what the CLIENT decides is worth persisting; this file covers what
 * the SERVER does when a persisted mutation is finally delivered, once or
 * twice.
 */
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { financeMutationClaims as mutationClaims, financeTransactions as transactions } from "../src/modules/finance/schema.ts";
import { claimMutation, linkMutationClaim, pruneMutationClaims } from "../src/modules/finance/services/ledger/idempotency.ts";
import { body, call, createHousehold, createUser, type TestUser } from "./support/finance-harness.ts";

await runMigrations(db);

interface TransactionResponse {
  id: string;
  amountCents: number;
  description: string;
}

/** A real, manual transaction row — needed wherever a test claims against a `transactionId` FK. */
async function createManualTransaction(owner: TestUser, householdId: string, description: string): Promise<string> {
  const created = await body<TransactionResponse>(
    await call(`/api/households/${householdId}/finance/transactions`, {
      method: "POST",
      cookie: owner.cookie,
      body: { kind: "MINE_SPLIT", amountCents: 100, description },
    }),
  );
  return created.id;
}

describe("claimMutation — the primitive", () => {
  test("the first claim wins and links to no transaction yet (the POST shape)", async () => {
    const owner = await createUser("Owner");
    const householdId = await createHousehold(owner, "Claim eins");
    const mutationId = crypto.randomUUID();

    const claim = await claimMutation(db, mutationId, householdId);
    expect(claim.claimed).toBe(true);
    expect(claim.transactionId).toBeNull();
  });

  test("a second claim of the SAME id does not win, and reads the linked row back (the PATCH/DELETE shape)", async () => {
    const owner = await createUser("Owner");
    const householdId = await createHousehold(owner, "Claim zwei");
    const transactionId = await createManualTransaction(owner, householdId, "Ziel der Buchung");
    const mutationId = crypto.randomUUID();

    const first = await claimMutation(db, mutationId, householdId, transactionId);
    expect(first.claimed).toBe(true);
    expect(first.transactionId).toBe(transactionId);

    const second = await claimMutation(db, mutationId, householdId);
    expect(second.claimed).toBe(false);
    expect(second.transactionId).toBe(transactionId);

    const rows = await db.select().from(mutationClaims).where(eq(mutationClaims.id, mutationId));
    expect(rows).toHaveLength(1);
  });

  test("linkMutationClaim attaches the row a POST created after an initially unlinked claim", async () => {
    const owner = await createUser("Owner");
    const householdId = await createHousehold(owner, "Verknuepfen");
    const transactionId = await createManualTransaction(owner, householdId, "Nachtraeglich verknuepft");
    const mutationId = crypto.randomUUID();

    const claim = await claimMutation(db, mutationId, householdId, null);
    expect(claim.transactionId).toBeNull();

    await linkMutationClaim(db, mutationId, transactionId);

    const replay = await claimMutation(db, mutationId, householdId);
    expect(replay.claimed).toBe(false);
    expect(replay.transactionId).toBe(transactionId);
  });

  test(
    "two CONCURRENT claims of the same id: exactly one wins — this is why it is an INSERT, not a SELECT-then-write",
    async () => {
      const owner = await createUser("Owner");
      const householdId = await createHousehold(owner, "Wettlauf");
      // Created SEQUENTIALLY — only the two `claimMutation` calls below need
      // to race; a local libSQL file is one serialized write track
      // (docs/reference-architecture.md §3.2), and two concurrent HTTP
      // creates would just contend over that, not exercise anything this
      // test cares about.
      const candidateA = await createManualTransaction(owner, householdId, "Kandidat A");
      const candidateB = await createManualTransaction(owner, householdId, "Kandidat B");
      const mutationId = crypto.randomUUID();

      const [a, b] = await Promise.all([
        claimMutation(db, mutationId, householdId, candidateA!),
        claimMutation(db, mutationId, householdId, candidateB!),
      ]);

      const winners = [a, b].filter((result) => result.claimed);
      expect(winners).toHaveLength(1);
      // The loser reads back whichever transactionId the winner claimed
      // with — never null, and never its OWN candidate id (a SELECT-then-
      // write implementation could let both read "not yet applied" and both
      // report their own candidate as the winner — this is what catches that).
      const loser = a.claimed ? b : a;
      expect(loser.claimed).toBe(false);
      expect(loser.transactionId).toBe(winners[0]!.transactionId);
      expect(loser.transactionId === candidateA || loser.transactionId === candidateB).toBe(true);

      const rows = await db.select().from(mutationClaims).where(eq(mutationClaims.id, mutationId));
      expect(rows).toHaveLength(1);
    },
  );
});

describe("pruneMutationClaims — TTL", () => {
  test("drops claims past the TTL, keeps claims within it", async () => {
    const owner = await createUser("Owner");
    const householdId = await createHousehold(owner, "TTL");
    const ttlMs = 14 * 24 * 60 * 60 * 1000;

    const stale = crypto.randomUUID();
    const fresh = crypto.randomUUID();
    await claimMutation(db, stale, householdId);
    await claimMutation(db, fresh, householdId);

    // `appliedAt` is stamped from the wall clock at insert time (schema.ts's
    // own `$defaultFn`, not the `lib/clock.ts` seam — that seam is for the
    // fixed-cost plan's period reasoning, not row timestamps). Backdating the
    // stale row directly is what makes the TTL boundary testable without
    // waiting fourteen real days.
    await db
      .update(mutationClaims)
      .set({ appliedAt: Date.now() - ttlMs - 60_000 })
      .where(eq(mutationClaims.id, stale));

    const deleted = await pruneMutationClaims(db, ttlMs);
    expect(deleted).toBeGreaterThanOrEqual(1);

    const remainingIds = (await db.select({ id: mutationClaims.id }).from(mutationClaims)).map((row) => row.id);
    expect(remainingIds).not.toContain(stale);
    expect(remainingIds).toContain(fresh);
  });
});

describe("PATCH and DELETE replay over HTTP", () => {
  test("a replayed mutationId on PATCH applies the edit exactly once", async () => {
    const owner = await createUser("Owner");
    const householdId = await createHousehold(owner, "Patch-Replay");
    const transactionId = await createManualTransaction(owner, householdId, "Original");
    const mutationId = crypto.randomUUID();
    const patchBody = { description: "Editiert", amountCents: 750, mutationId };

    const first = await call(`/api/households/${householdId}/finance/transactions/${transactionId}`, {
      method: "PATCH",
      cookie: owner.cookie,
      body: patchBody,
    });
    expect(first.status).toBe(200);
    expect((await body<TransactionResponse>(first)).amountCents).toBe(750);

    // Replayed with the SAME mutationId: must not re-apply — a queued edit
    // delivered twice must not clobber a DIFFERENT, later manual edit.
    await call(`/api/households/${householdId}/finance/transactions/${transactionId}`, {
      method: "PATCH",
      cookie: owner.cookie,
      body: { description: "Von Hand danach geaendert" },
    });

    const replay = await call(`/api/households/${householdId}/finance/transactions/${transactionId}`, {
      method: "PATCH",
      cookie: owner.cookie,
      body: patchBody,
    });
    expect(replay.status).toBe(200);
    const replayPayload = await body<TransactionResponse>(replay);
    expect(replayPayload.description).toBe("Von Hand danach geaendert");
    expect(replayPayload.amountCents).toBe(750); // unrelated field the manual edit did not touch stays as-is
  });

  test("a replayed mutationId on DELETE deletes exactly once and never 404s on the replay", async () => {
    const owner = await createUser("Owner");
    const householdId = await createHousehold(owner, "Delete-Replay");
    const transactionId = await createManualTransaction(owner, householdId, "Weg damit");
    const mutationId = crypto.randomUUID();

    const first = await call(`/api/households/${householdId}/finance/transactions/${transactionId}?mutationId=${mutationId}`, {
      method: "DELETE",
      cookie: owner.cookie,
    });
    expect(first.status).toBe(204);

    const rows = await db.select().from(transactions).where(eq(transactions.id, transactionId));
    expect(rows).toHaveLength(0);

    // The row is gone; a naive load-then-claim ordering would 404 here
    // (this is the gap the fix in `deleteTransaction` closes — see file doc).
    const second = await call(`/api/households/${householdId}/finance/transactions/${transactionId}?mutationId=${mutationId}`, {
      method: "DELETE",
      cookie: owner.cookie,
    });
    expect(second.status).toBe(204);
  });

  test("DELETE with no mutationId on an already-deleted row still 404s (no claim, no idempotency promise made)", async () => {
    const owner = await createUser("Owner");
    const householdId = await createHousehold(owner, "Delete-ohne-Schluessel");
    const transactionId = await createManualTransaction(owner, householdId, "Weg, ohne Schluessel");

    const first = await call(`/api/households/${householdId}/finance/transactions/${transactionId}`, { method: "DELETE", cookie: owner.cookie });
    expect(first.status).toBe(204);

    const second = await call(`/api/households/${householdId}/finance/transactions/${transactionId}`, { method: "DELETE", cookie: owner.cookie });
    expect(second.status).toBe(404);
  });
});

describe("no mutationId — no replay guard, and that is by design", () => {
  test("two POSTs with no mutationId at all create two rows (docs/spec.md §3.1: idempotency is opt-in)", async () => {
    const owner = await createUser("Owner");
    const householdId = await createHousehold(owner, "Ohne Schluessel");
    const requestBody = { kind: "MINE_SPLIT" as const, amountCents: 111, description: "Kein Schluessel" };

    const first = await call(`/api/households/${householdId}/finance/transactions`, { method: "POST", cookie: owner.cookie, body: requestBody });
    const second = await call(`/api/households/${householdId}/finance/transactions`, { method: "POST", cookie: owner.cookie, body: requestBody });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const rows = await db.select().from(transactions).where(eq(transactions.householdId, householdId));
    expect(rows).toHaveLength(2);
  });
});

describe("cross-household isolation", () => {
  test("the same mutationId reused across two households still only claims once — the primary key is global", async () => {
    const owner = await createUser("Owner");
    const householdA = await createHousehold(owner, "Haushalt A");
    const householdB = await createHousehold(owner, "Haushalt B");
    const rowA = await createManualTransaction(owner, householdA, "In Haushalt A");
    const mutationId = crypto.randomUUID();

    const claimA = await claimMutation(db, mutationId, householdA, rowA);
    // `mutation_claims.id` IS the client-minted `mutationId` and is the
    // table's PRIMARY KEY, full stop — it is not scoped per household. A
    // second household reusing the exact same id (an astronomically
    // unlikely UUID collision in practice) still hits the same row, so it
    // must not silently "win" a second time just because the household
    // differs.
    const claimB = await claimMutation(db, mutationId, householdB, null);

    expect(claimA.claimed).toBe(true);
    expect(claimB.claimed).toBe(false);
    expect(claimB.transactionId).toBe(rowA);
  });
});
