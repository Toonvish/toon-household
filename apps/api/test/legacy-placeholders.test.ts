/**
 * The claim invites of migrated toon-finance placeholders (plan m3b decisions 13, 14 and 18,
 * ADR 0006, task M3b-T09) on the committed fixtures (`test/fixtures/legacy/`, facts in `facts.ts`:
 * FH6's slot 2 is the placeholder pia with a pending legacy claim invite).
 *
 * Two layers:
 * - the claim-invite rule on the legacy harness's TEMP FILE targets (`createLegacyRun`): dry run,
 *   apply, a revoked and an expired legacy invite, a second apply;
 * - THE CLAIM (decision 18): a real finance-only apply into the SHARED `file::memory:` DB (the only
 *   one `app.request` sees), then pia registers with the claim token and becomes an account with her
 *   migrated id. `afterAll` deletes what the run wrote and proves the shared DB is back to its counts.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { INVITE_TTL_MS } from "../src/core/services/auth/invites.ts";
import { client as sharedClient, db as sharedDb } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { claimInviteUrl, claimLedgerKey } from "../scripts/legacy/claims.ts";
import { exitCodeFor, renderReport, totalWritten } from "../scripts/legacy/report.ts";
import { runLegacyMigration } from "../scripts/legacy/run.ts";
import { openLegacy } from "../scripts/legacy/sources.ts";
import type { LegacyDb, Report } from "../scripts/legacy/types.ts";
import { EXPECTED, FH6_CLAIM_INVITE, FINANCE_HOUSEHOLDS, FINANCE_USERS, GROUPS, RECIPE_USERS } from "./fixtures/legacy/facts.ts";
import { countRows, createLegacyRun, FIXTURE_DIR, type LegacyRun } from "./support/legacy-harness.ts";

const ORIGIN = "https://toon.example";
const PIA = FINANCE_USERS.pia.id;

const runs: LegacyRun[] = [];
const extraClients: LegacyDb[] = [];
afterEach(() => {
  for (const legacy of extraClients.splice(0)) legacy.client.close();
  for (const run of runs.splice(0)) run.cleanup();
});

async function harness(mode: "dry-run" | "apply" = "apply"): Promise<LegacyRun> {
  const run = await createLegacyRun({ mode });
  runs.push(run);
  return run;
}

function runOptions(run: LegacyRun, mode: "dry-run" | "apply", finance: LegacyDb | undefined = run.ctx.finance) {
  return {
    mode,
    ...(run.ctx.recipe ? { recipe: run.ctx.recipe } : {}),
    ...(finance ? { finance } : {}),
    target: run.target,
    uploads: { ...run.ctx.uploads, copy: mode === "apply" },
    webOrigin: ORIGIN,
  };
}

/** Edits the harness's operator-side finance copy and opens a fresh snapshot of it. */
async function mutatedFinance(run: LegacyRun, sql: string, args: (string | number)[]): Promise<LegacyDb> {
  const edit = createClient({ url: `file:${run.financePath}` });
  await edit.execute({ sql, args });
  edit.close();
  const scratch = join(run.dir, `scratch-${crypto.randomUUID()}`);
  mkdirSync(scratch);
  const finance = await openLegacy("finance", run.financePath, scratch);
  extraClients.push(finance);
  return finance;
}

interface InviteRow {
  id: string;
  household_id: string;
  email: string | null;
  role: string;
  token: string;
  status: string;
  invited_by: string;
  accepted_by: string | null;
  expires_at: number;
  accepted_at: number | null;
  created_at: number;
  claims_user_id: string | null;
}

async function claimInvites(run: LegacyRun): Promise<InviteRow[]> {
  const result = await run.target.client.execute("SELECT * FROM household_invites WHERE claims_user_id IS NOT NULL");
  return result.rows.map((row) => ({ ...row }) as unknown as InviteRow);
}

function piaEntry(report: Report) {
  const entry = report.placeholders.find((p) => p.financeUserId === PIA);
  expect(entry).toBeDefined();
  return entry!;
}

function financeInvitesNotMigrated(report: Report): number | undefined {
  return report.notMigrated.find((n) => n.table === "invites" && n.source === "finance")?.rows;
}

/** FH6 merges into G2 (facts.ts); G2 keeps its id in a fresh target. */
const G2_TARGET = GROUPS.G2.id;

describe("claim invites (legacy harness, temp file targets)", () => {
  test("a dry run lists pia with would-reuse and no link, even with a web origin", async () => {
    const run = await harness("dry-run");
    const report = await runLegacyMigration(runOptions(run, "dry-run"));
    expect(report.errors).toEqual([]);
    expect(report.placeholders).toHaveLength(EXPECTED.placeholders);
    const pia = piaEntry(report);
    expect(pia).toMatchObject({
      financeUserId: PIA,
      targetUserId: PIA,
      financeHouseholdId: FINANCE_HOUSEHOLDS.FH6.id,
      targetHouseholdId: G2_TARGET,
      slot: 2,
      claimInvite: "would-reuse",
    });
    expect(pia.inviteUrl).toBeUndefined();
    const text = renderReport(report);
    expect(text).not.toContain("/invite/");
    expect(text).not.toContain(FH6_CLAIM_INVITE.token);
    expect(JSON.stringify(report)).not.toContain(FH6_CLAIM_INVITE.token);
    // the reused legacy claim invite is migrated, ben's e-mail invite is not
    expect(financeInvitesNotMigrated(report)).toBe(EXPECTED.legacyRows.finance.invites! - 1);
  });

  test("apply reuses the pending legacy claim invite: token, dates and e-mail kept, link in the report", async () => {
    const run = await harness();
    const report = await runLegacyMigration(runOptions(run, "apply"));
    expect(report.errors).toEqual([]);
    expect(exitCodeFor(report)).toBe(0);

    const invites = await claimInvites(run);
    expect(invites).toHaveLength(1);
    expect(invites[0]).toEqual({
      id: FH6_CLAIM_INVITE.id,
      household_id: G2_TARGET,
      email: null,
      role: "member",
      token: FH6_CLAIM_INVITE.token,
      status: "pending",
      // anna invited pia in toon-finance; her finance id maps onto her recipe account
      invited_by: RECIPE_USERS.anna.id,
      accepted_by: null,
      expires_at: FH6_CLAIM_INVITE.expiresAt,
      accepted_at: null,
      created_at: FH6_CLAIM_INVITE.createdAt,
      claims_user_id: PIA,
    });
    const pia = piaEntry(report);
    expect(pia.claimInvite).toBe("reused");
    expect(pia.inviteId).toBe(FH6_CLAIM_INVITE.id);
    expect(pia.inviteUrl).toBe(`${ORIGIN}/invite/${FH6_CLAIM_INVITE.token}`);
    const text = renderReport(report);
    expect(text).toContain(`  ${PIA}  ${ORIGIN}/invite/${FH6_CLAIM_INVITE.token}`);

    // both ledger keys: the placeholder's claim and the reused legacy invite
    const ledger = await run.target.client.execute({
      sql: `SELECT legacy_id, new_id FROM legacy_ids WHERE "table" = 'household_invites' AND legacy_source = 'finance' ORDER BY legacy_id`,
      args: [],
    });
    expect(ledger.rows.map((row) => [row.legacy_id, row.new_id])).toEqual(
      [
        [FH6_CLAIM_INVITE.id, FH6_CLAIM_INVITE.id],
        [claimLedgerKey(PIA), FH6_CLAIM_INVITE.id],
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );
    const count = report.counts.find((c) => c.table === "household_invites" && c.source === "finance");
    expect(count).toMatchObject({ read: 1, written: 1, alreadyMigrated: 0, skipped: 0 });
    expect(financeInvitesNotMigrated(report)).toBe(EXPECTED.legacyRows.finance.invites! - 1);
  });

  for (const [label, sql, args] of [
    ["revoked", "UPDATE invites SET status = 'revoked' WHERE id = ?", [FH6_CLAIM_INVITE.id]],
    ["expired", "UPDATE invites SET expires_at = ? WHERE id = ?", [Date.UTC(2020, 0, 1), FH6_CLAIM_INVITE.id]],
  ] as const) {
    test(`a ${label} legacy claim invite is not reused: a fresh one is created`, async () => {
      const run = await harness();
      const finance = await mutatedFinance(run, sql, [...args]);
      const before = Date.now();
      const report = await runLegacyMigration(runOptions(run, "apply", finance));
      const after = Date.now();
      expect(report.errors).toEqual([]);

      const invites = await claimInvites(run);
      expect(invites).toHaveLength(1);
      const invite = invites[0]!;
      expect(invite.id).not.toBe(FH6_CLAIM_INVITE.id);
      expect(invite.token).not.toBe(FH6_CLAIM_INVITE.token);
      expect(invite.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(invite).toMatchObject({
        household_id: G2_TARGET,
        email: null,
        role: "member",
        status: "pending",
        invited_by: RECIPE_USERS.anna.id, // G2's owner
        accepted_by: null,
        accepted_at: null,
        claims_user_id: PIA,
      });
      const owner = await run.target.client.execute({
        sql: "SELECT user_id FROM household_members WHERE household_id = ? AND role = 'owner'",
        args: [G2_TARGET],
      });
      expect(owner.rows.map((row) => row.user_id)).toEqual([invite.invited_by]);
      expect(invite.created_at).toBeGreaterThanOrEqual(before);
      expect(invite.created_at).toBeLessThanOrEqual(after);
      expect(invite.expires_at).toBe(invite.created_at + INVITE_TTL_MS);
      expect(INVITE_TTL_MS).toBe(14 * 24 * 60 * 60 * 1000);

      const pia = piaEntry(report);
      expect(pia.claimInvite).toBe("created");
      expect(pia.inviteId).toBe(invite.id);
      expect(pia.inviteUrl).toBe(claimInviteUrl(ORIGIN, invite.token));
      // nothing was reused: both finance invites stay "not migrated"
      expect(financeInvitesNotMigrated(report)).toBe(EXPECTED.legacyRows.finance.invites!);
    });
  }

  test("a second apply writes 0 rows, no second invite, and re-prints the pending link", async () => {
    const run = await harness();
    await runLegacyMigration(runOptions(run, "apply"));
    const invitesBefore = await countRows(run.target.client, "household_invites");
    const ledgerBefore = await countRows(run.target.client, "legacy_ids");

    const second = await runLegacyMigration(runOptions(run, "apply"));
    expect(second.errors).toEqual([]);
    expect(totalWritten(second)).toBe(0);
    expect(await countRows(run.target.client, "household_invites")).toBe(invitesBefore);
    expect(await countRows(run.target.client, "legacy_ids")).toBe(ledgerBefore);
    expect(await claimInvites(run)).toHaveLength(1);
    const pia = piaEntry(second);
    expect(pia.claimInvite).toBe("already-migrated");
    expect(pia.inviteId).toBe(FH6_CLAIM_INVITE.id);
    expect(pia.inviteUrl).toBe(`${ORIGIN}/invite/${FH6_CLAIM_INVITE.token}`);
    expect(second.counts.find((c) => c.table === "household_invites" && c.source === "finance")).toMatchObject({
      read: 1,
      written: 0,
      alreadyMigrated: 1,
    });
    expect(financeInvitesNotMigrated(second)).toBe(EXPECTED.legacyRows.finance.invites! - 1);

    // a dry run against the migrated target never shows the link
    const dry = await runLegacyMigration(runOptions(run, "dry-run"));
    expect(piaEntry(dry).claimInvite).toBe("already-migrated");
    expect(piaEntry(dry).inviteUrl).toBeUndefined();

    // a spent link is not re-printed
    await run.target.client.execute({ sql: "UPDATE household_invites SET status = 'accepted' WHERE id = ?", args: [FH6_CLAIM_INVITE.id] });
    const third = await runLegacyMigration(runOptions(run, "apply"));
    expect(piaEntry(third).claimInvite).toBe("already-migrated");
    expect(piaEntry(third).inviteUrl).toBeUndefined();
  });
});

/* ------------------------- THE CLAIM, on the shared test DB ------------------------- */

/** Every address the finance-only run could write, plus the one pia registers with. */
const FIXTURE_EMAILS = [
  ...Object.values(FINANCE_USERS).flatMap((user): string[] => (user.emailNormalized === null ? [] : [user.emailNormalized])),
  "pia@example.test",
];
const PIA_EMAIL = "pia@example.test";
const PIA_PASSWORD = "pia-claims-her-seat";
const COUNTED = ["users", "households", "household_invites", "legacy_ids"] as const;

describe("a migrated placeholder is claimable by register (shared DB, finance-only input)", () => {
  let dir: string;
  let finance: LegacyDb;
  let report: Report;
  let before: Record<string, number>;
  let ledgerBefore: Set<string>;
  let piaTargetId: string;
  let fh6TargetId: string;
  let claimToken: string;

  const ledgerKey = (row: Record<string, unknown>) => `${row.table}|${row.legacy_source}|${row.legacy_id}`;

  beforeAll(async () => {
    await runMigrations(sharedDb);
    const present = await sharedClient.execute({
      sql: `SELECT email FROM users WHERE email IN (${FIXTURE_EMAILS.map(() => "?").join(", ")})`,
      args: FIXTURE_EMAILS,
    });
    if (present.rows.length > 0) {
      throw new Error(
        `the shared test DB already holds fixture e-mails (${present.rows.map((row) => row.email).join(", ")}); this test must run on a DB without them`,
      );
    }
    const fk = await sharedClient.execute("PRAGMA foreign_keys");
    if (Number(fk.rows[0]?.foreign_keys) !== 1) throw new Error("the shared test DB runs without foreign keys; the cleanup relies on cascades");
    before = {};
    for (const table of COUNTED) before[table] = await countRows(sharedClient, table);
    ledgerBefore = new Set((await sharedClient.execute('SELECT "table", legacy_source, legacy_id FROM legacy_ids')).rows.map(ledgerKey));

    // the finance-only input: the fixture finance.db copied to a temp dir, no recipe, no uploads
    dir = mkdtempSync(join(tmpdir(), "toon-legacy-claim-"));
    const input = join(dir, "finance.db");
    copyFileSync(join(FIXTURE_DIR, "finance.db"), input);
    mkdirSync(join(dir, "scratch"));
    finance = await openLegacy("finance", input, join(dir, "scratch"));
    report = await runLegacyMigration({
      mode: "apply",
      finance,
      target: { db: sharedDb, client: sharedClient, url: "file::memory:" },
      uploads: { targetDir: join(dir, "uploads"), copy: true },
      webOrigin: ORIGIN,
    });
    const pia = report.placeholders.find((p) => p.financeUserId === PIA);
    piaTargetId = pia?.targetUserId ?? "";
    fh6TargetId = pia?.targetHouseholdId ?? "";
    claimToken = (pia?.inviteUrl ?? "").split("/invite/")[1] ?? "";
  });

  afterAll(async () => {
    try {
      const written = (await sharedClient.execute('SELECT "table", legacy_source, legacy_id, new_id FROM legacy_ids')).rows.filter(
        (row) => !ledgerBefore.has(ledgerKey(row)),
      );
      const ids = (table: string) => [...new Set(written.filter((row) => row.table === table).map((row) => String(row.new_id)))];
      // households first: the cascade takes memberships, invites, module rows and every finance_* row
      for (const id of ids("households")) await sharedClient.execute({ sql: "DELETE FROM households WHERE id = ?", args: [id] });
      for (const id of ids("users")) await sharedClient.execute({ sql: "DELETE FROM users WHERE id = ?", args: [id] });
      for (const row of written) {
        await sharedClient.execute({
          sql: 'DELETE FROM legacy_ids WHERE "table" = ? AND legacy_source = ? AND legacy_id = ?',
          args: [String(row.table), String(row.legacy_source), String(row.legacy_id)],
        });
      }
      const after: Record<string, number> = {};
      for (const table of COUNTED) after[table] = await countRows(sharedClient, table);
      expect(after).toEqual(before);
    } finally {
      finance?.client.close();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the finance-only apply is clean and hands out pia's claim link", () => {
    expect(report.errors).toEqual([]);
    expect(exitCodeFor(report)).toBe(0);
    expect(report.balances.length).toBeGreaterThan(0);
    expect(report.balances.every((balance) => balance.ok)).toBe(true);
    const pia = report.placeholders.find((p) => p.financeUserId === PIA);
    // no recipe group: FH6 becomes a household of its own
    expect(report.decisions.find((d) => d.financeHouseholdId === FINANCE_HOUSEHOLDS.FH6.id)?.decision).toBe("new");
    expect(pia?.claimInvite).toBe("reused");
    expect(claimToken).toBe(FH6_CLAIM_INVITE.token);
    expect(pia?.inviteUrl).toBe(`${ORIGIN}/invite/${FH6_CLAIM_INVITE.token}`);
  });

  test("pia registers with the claim token and keeps her migrated id, seat and bookings", async () => {
    const { app } = await import("../src/index.ts");
    const registered = await app.request("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: PIA_EMAIL, name: "Pia", password: PIA_PASSWORD, inviteToken: claimToken }),
    });
    expect(registered.status).toBe(201);
    const session = (await registered.json()) as { user: { id: string; email: string }; activeHouseholdId: string | null };
    expect(session.user.id).toBe(piaTargetId);
    expect(session.user.email).toBe(PIA_EMAIL);
    expect(session.activeHouseholdId).toBe(fh6TargetId);

    const user = await sharedClient.execute({ sql: "SELECT email, password_hash FROM users WHERE id = ?", args: [piaTargetId] });
    expect(user.rows[0]?.email).toBe(PIA_EMAIL);
    expect(user.rows[0]?.password_hash).not.toBeNull();
    const invite = await sharedClient.execute({
      sql: "SELECT status, accepted_by FROM household_invites WHERE token = ?",
      args: [claimToken],
    });
    expect(invite.rows.map((row) => [row.status, row.accepted_by])).toEqual([["accepted", piaTargetId]]);

    // anna (a finance-only account here, her finance password) sees pia's seat as an account now
    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: FINANCE_USERS.anna.emailNormalized, password: FINANCE_USERS.anna.password }),
    });
    expect(login.status).toBe(200);
    const cookie = (login.headers.getSetCookie().find((c) => c.startsWith("toon_session=")) ?? "").split(";")[0] ?? "";
    expect(cookie).not.toBe("");
    const participants = await app.request(`/api/households/${fh6TargetId}/finance/participants`, { headers: { Cookie: cookie } });
    expect(participants.status).toBe(200);
    const list = (await participants.json()) as {
      items: { userId: string; memberSlot: number; displayName: string; hasAccount: boolean }[];
    };
    expect(list.items.find((item) => item.userId === piaTargetId)).toMatchObject({
      memberSlot: 2,
      displayName: "Pia",
      hasAccount: true,
    });

    // every booking pia paid still names her
    const legacyPaid = await finance.client.execute({
      sql: "SELECT count(*) AS n FROM transactions WHERE payer_id = ?",
      args: [PIA],
    });
    const migratedPaid = await sharedClient.execute({
      sql: "SELECT count(*) AS n FROM finance_transactions WHERE household_id = ? AND payer_id = ?",
      args: [fh6TargetId, piaTargetId],
    });
    expect(Number(legacyPaid.rows[0]?.n)).toBeGreaterThan(0);
    expect(Number(migratedPaid.rows[0]?.n)).toBe(Number(legacyPaid.rows[0]?.n));
  });
});
