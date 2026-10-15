/**
 * The claim invites of migrated toon-finance placeholders (plan m3b decisions 13 and 14, ADR 0006).
 *
 * Runs after `migrateFinance` (the seats exist) and before `verifyBalances`. Per placeholder the
 * users step migrated (`ctx.ids.users.finance`), exactly ONE pending claim invite in
 * `household_invites`, recorded in the ledger as `household_invites` / `finance` /
 * `claim:<F user id>`:
 *
 * - **reuse**: the newest legacy claim invite of that placeholder that is still pending (status
 *   `pending`, `expires_at` after the run time) in a finance household that landed in the same
 *   target household. Its token, `email`, `created_at` and `expires_at` are kept; `invited_by` is the
 *   mapped inviter, or the target household's owner when the inviter was not migrated; the id is the
 *   legacy id unless the target already uses it. A token the target already holds gets a fresh one
 *   (with a warning). The legacy invite's own id is recorded in the ledger too, so the "not migrated
 *   by design" count of finance `invites` excludes it on every later run.
 * - **create** otherwise: a fresh id, a token from the core's `generateInviteToken`, no e-mail, role
 *   `member`, invited by the target household's owner, `created_at` = run time, `expires_at` = run
 *   time + `INVITE_TTL_MS` (14 days).
 *
 * The target household is the one the placeholder's first finance membership (by `joined_at`)
 * landed in. Like every step, a dry-run pass writes its scratch target and reports the decision
 * (`would-reuse`, `would-create`); the claim link `<webOrigin>/invite/<token>` is put into the report
 * ONLY in an apply pass with `ctx.webOrigin` (the CLI's real pass of `--apply`), and on a later apply
 * for an invite that is still pending (read through the ledger, nothing written).
 *
 * No module-scope code beyond imports and constants (plan m5 decision 5); the target comes from the
 * context, never the shared `db`. `invites.ts` is imported after the CLI's redirect like every
 * library file (the CLI loads this file dynamically through `run.ts`).
 */
import { generateInviteToken, INVITE_TTL_MS } from "../../src/core/services/auth/invites.ts";
import { householdInvites } from "../../src/db/schema.ts";
import { recordSkip, type WriteEntry, writeEntries } from "./copy.ts";
import { lookupMany } from "./ledger.ts";
import { addCount } from "./report.ts";
import { readAll } from "./sources.ts";
import { isLegacyPlaceholder } from "./users.ts";
import type { MigrationContext, PlaceholderEntry, Row, TableCount } from "./types.ts";

/** The ledger's `table` of a claim invite (the target table's SQL name). */
const LEDGER_TABLE = "household_invites";

/** The ledger key of a placeholder's claim invite. */
export function claimLedgerKey(financeUserId: string): string {
  return `claim:${financeUserId}`;
}

/** `<origin>/invite/<token>`, the link the web app's `/invite/$token` route redeems. */
export function claimInviteUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/invite/${token}`;
}

function str(value: unknown): string {
  return String(value ?? "");
}

function num(value: unknown): number {
  return Number(value ?? 0);
}

interface Planned {
  entry: WriteEntry;
  report: PlaceholderEntry;
  token: string;
  reused: boolean;
}

/**
 * Migrates one claim invite per placeholder and fills `ctx.report.placeholders`. Idempotent through
 * the ledger; a second apply writes nothing and re-reads the pending link.
 */
export async function migrateClaimInvites(ctx: MigrationContext): Promise<void> {
  const { finance, target, report } = ctx;
  if (!finance) return;
  const runTime = Date.now();
  const showLinks = ctx.mode === "apply" && ctx.webOrigin !== undefined && ctx.webOrigin !== "";

  const placeholderRows = (await readAll(finance, "SELECT id, password_hash FROM users ORDER BY rowid")).filter(
    isLegacyPlaceholder,
  );
  const count: TableCount = {
    table: LEDGER_TABLE,
    source: "finance",
    read: 0,
    written: 0,
    alreadyMigrated: 0,
    skipped: 0,
  };
  report.placeholders = [];
  if (placeholderRows.length > 0) {
    const memberRows = await readAll(
      finance,
      "SELECT household_id, user_id, member_slot, joined_at FROM household_members ORDER BY joined_at, household_id",
    );
    const claimRows = await readAll(
      finance,
      "SELECT * FROM invites WHERE claims_user_id IS NOT NULL ORDER BY created_at DESC, rowid DESC",
    );
    const ledger = await lookupMany(
      target.client,
      LEDGER_TABLE,
      "finance",
      placeholderRows.map((row) => claimLedgerKey(str(row.id))),
    );
    const ownerOf = async (householdId: string): Promise<string | undefined> => {
      const result = await target.client.execute({
        sql: "SELECT user_id FROM household_members WHERE household_id = ? AND role = 'owner' ORDER BY created_at, id LIMIT 1",
        args: [householdId],
      });
      const owner = result.rows[0]?.user_id;
      return owner === undefined || owner === null ? undefined : str(owner);
    };
    const exists = async (column: "id" | "token", value: string): Promise<boolean> => {
      const result = await target.client.execute({
        sql: `SELECT 1 FROM household_invites WHERE ${column} = ? LIMIT 1`,
        args: [value],
      });
      return result.rows.length > 0;
    };
    const claimedIds = new Set<string>(); // invite ids decided in this run
    const claimedTokens = new Set<string>();
    const planned: Planned[] = [];

    for (const row of placeholderRows) {
      const legacyUserId = str(row.id);
      const targetUserId = ctx.ids.users.finance.get(legacyUserId);
      // not migrated (the users step recorded why): no invite to hand out
      if (targetUserId === undefined) continue;
      count.read += 1;
      const key = claimLedgerKey(legacyUserId);
      const memberships = memberRows.filter((member) => str(member.user_id) === legacyUserId);
      const landed = memberships.find((member) => ctx.ids.households.finance.has(str(member.household_id)));
      const entry: PlaceholderEntry = {
        financeUserId: legacyUserId,
        targetUserId,
        financeHouseholdId: landed ? str(landed.household_id) : (memberships[0] ? str(memberships[0].household_id) : null),
        targetHouseholdId: landed ? (ctx.ids.households.finance.get(str(landed.household_id)) ?? null) : null,
        slot: landed ? num(landed.member_slot) : (memberships[0] ? num(memberships[0].member_slot) : null),
        claimInvite: "already-migrated",
      };
      report.placeholders.push(entry);

      // Already migrated: nothing is written; an apply pass re-reads a still-pending link.
      const knownInviteId = ledger.get(key);
      if (knownInviteId !== undefined) {
        count.alreadyMigrated += 1;
        entry.inviteId = knownInviteId;
        if (showLinks) {
          const result = await target.client.execute({
            sql: "SELECT token, status, expires_at FROM household_invites WHERE id = ?",
            args: [knownInviteId],
          });
          const invite = result.rows[0];
          if (invite && str(invite.status) === "pending" && num(invite.expires_at) > runTime) {
            entry.inviteUrl = claimInviteUrl(ctx.webOrigin as string, str(invite.token));
          }
        }
        continue;
      }

      const targetHouseholdId = entry.targetHouseholdId;
      if (!landed || targetHouseholdId === null) {
        entry.claimInvite = "no-household";
        recordSkip(ctx, count, key, `placeholder ${legacyUserId}: none of its finance households was migrated, no claim invite`, false);
        continue;
      }
      const owner = await ownerOf(targetHouseholdId);
      if (owner === undefined) {
        entry.claimInvite = "failed";
        recordSkip(ctx, count, key, `placeholder ${legacyUserId}: target household ${targetHouseholdId} has no owner`, true);
        continue;
      }

      // The newest still-pending legacy claim invite of this placeholder that lands in the same household.
      const legacy = claimRows.find(
        (invite) =>
          str(invite.claims_user_id) === legacyUserId &&
          str(invite.status) === "pending" &&
          num(invite.expires_at) > runTime &&
          ctx.ids.households.finance.get(str(invite.household_id)) === targetHouseholdId,
      );

      let values: Row;
      const ledgerEntries: WriteEntry["ledger"] = [{ source: "finance", legacyId: key }];
      if (legacy) {
        const legacyInviteId = str(legacy.id);
        let id = legacyInviteId;
        if (claimedIds.has(id) || (await exists("id", id))) {
          id = crypto.randomUUID();
          report.warnings.push(
            `claim invite ${legacyInviteId} (finance id) of placeholder ${legacyUserId}: the id is already taken in the target, new id ${id}`,
          );
        }
        let token = str(legacy.token);
        if (claimedTokens.has(token) || (await exists("token", token))) {
          token = generateInviteToken();
          report.warnings.push(
            `claim invite ${legacyInviteId} (finance id) of placeholder ${legacyUserId}: its token is already used in the target, a fresh token was minted (the old link no longer works)`,
          );
        }
        const inviter = ctx.ids.users.finance.get(str(legacy.invited_by));
        values = {
          id,
          household_id: targetHouseholdId,
          email: legacy.email === undefined || legacy.email === null ? null : str(legacy.email),
          role: "member",
          token,
          status: "pending",
          invited_by: inviter ?? owner,
          accepted_by: null,
          expires_at: num(legacy.expires_at),
          accepted_at: null,
          created_at: num(legacy.created_at),
          claims_user_id: targetUserId,
        };
        ledgerEntries.push({ source: "finance", legacyId: legacyInviteId });
      } else {
        values = {
          id: crypto.randomUUID(),
          household_id: targetHouseholdId,
          email: null,
          role: "member",
          token: generateInviteToken(),
          status: "pending",
          invited_by: owner,
          accepted_by: null,
          expires_at: runTime + INVITE_TTL_MS,
          accepted_at: null,
          created_at: runTime,
          claims_user_id: targetUserId,
        };
      }
      claimedIds.add(str(values.id));
      claimedTokens.add(str(values.token));
      entry.inviteId = str(values.id);
      planned.push({
        entry: { values, ledger: ledgerEntries, newId: str(values.id), label: `claim invite of placeholder ${legacyUserId}` },
        report: entry,
        token: str(values.token),
        reused: legacy !== undefined,
      });
    }

    const written = new Set(await writeEntries(ctx, householdInvites, planned.map((p) => p.entry), count));
    for (const item of planned) {
      if (!written.has(item.entry)) {
        item.report.claimInvite = "failed";
        delete item.report.inviteId;
        continue;
      }
      if (ctx.mode === "dry-run") {
        item.report.claimInvite = item.reused ? "would-reuse" : "would-create";
      } else {
        item.report.claimInvite = item.reused ? "reused" : "created";
        if (showLinks) item.report.inviteUrl = claimInviteUrl(ctx.webOrigin as string, item.token);
      }
    }
  }
  addCount(report, count);

  // F's other invites stay "not migrated by design"; a legacy claim invite reused as a placeholder's
  // claim invite (in this run or an earlier one: its ledger entry) is migrated and not counted.
  const inviteIds = (await readAll(finance, "SELECT id FROM invites")).map((row) => str(row.id));
  const migrated = await lookupMany(target.client, LEDGER_TABLE, "finance", inviteIds);
  const notMigrated = report.notMigrated.find((item) => item.table === "invites" && item.source === "finance");
  if (notMigrated) notMigrated.rows = inviteIds.length - migrated.size;
}
