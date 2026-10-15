/**
 * Step 1 of the migration: users and their auth rows (plan m5 decision 9, Table M rows 1-5,
 * SPEC §6.2, D4).
 *
 * Union by `email.trim().toLowerCase()`:
 * - A user in both apps keeps the RECIPE row (id, name, avatar, verified flag and timestamp,
 *   password hash, locale) and gets two ledger rows (`users/recipe/<id>`, `users/finance/<id>`)
 *   pointing at it. A recipe account without a password (OAuth-only) stays without one: F never
 *   verified addresses, so carrying F's hash would let whoever registered that address in F sign
 *   into the OAuth account (toon-recipe's gotcha on auto-linking).
 * - A finance-only user is written read-only until confirmed: `email_verified` 0,
 *   `email_verified_at` NULL, F's hash and locale (SPEC §4).
 * - The new id is the legacy id unless it is CLAIMED: by a target `users` row (DB lookup) or by a
 *   user decided earlier in this run (the in-run `claimed` set). Every recipe user is decided
 *   before any finance-only user. A claimed id gets `crypto.randomUUID()` and a warning. Nothing
 *   here catches a PRIMARY KEY error to pick another id: that would re-key whichever row lost the
 *   race (possibly the recipe user) and the per-row fallback would record the loser as an error.
 * - A target user with the same e-mail and no ledger entry (somebody registered in the new app
 *   first) is matched ONLY when its `email_verified_at` is set; an unconfirmed account is never
 *   matched ("the boolean alone is NOT evidence"): the legacy user is skipped with
 *   `error: true`, exit 1, and the operator confirms or deletes that account and runs again.
 * - The same holds for a RESUMED run: a recipe user not yet in the ledger whose group's account was
 *   created by an earlier finance-only apply is refused while that account is unconfirmed (the
 *   `--finance-db`-alone then both-inputs sequence); the recipe row would otherwise lose to F's
 *   hash and the recipe user's OAuth rows would hang off an unconfirmed account (D4).
 * - A toon-finance PLACEHOLDER (F's predicate `password_hash IS NULL`, `b1b517d`; plan m3b
 *   decision 13, ADR 0006) is never grouped or matched by e-mail: it becomes its own target row
 *   with a NULL e-mail and hash (H's `isPlaceholderUser`), unconfirmed, no avatar, F's name and
 *   locale, ledger key `users/finance/<F id>`. Its id follows the same claimed-set rule, decided
 *   after every account. A row with a NULL hash but an e-mail is not a placeholder in either app:
 *   it is skipped as an error (exit 1). Its household is set by the households step.
 *
 * No module-scope code beyond imports and constants (decision 5); the library takes the target
 * from the context and never uses the shared `db`.
 */
import { copyTable, type WriteEntry, writeEntries } from "./copy.ts";
import { loadAll } from "./ledger.ts";
import { readAll } from "./sources.ts";
import { emailVerificationTokens, oauthAccounts, passwordResetTokens, users } from "../../src/db/schema.ts";
import { normalizeStoredUploadUrl } from "../../src/lib/uploadUrls.ts";
import type { LegacySource, MigrationContext, Row, TableCount, UserCollision } from "./types.ts";

/** The note of a collision whose recipe account has no password (decision 9). */
export const OAUTH_ONLY_NOTE = "finance password not carried (recipe account is OAuth-only; use password reset)";

interface LegacyRef {
  source: LegacySource;
  id: string;
}

interface UserGroup {
  email: string;
  recipe: Row[];
  finance: Row | undefined;
}

function str(value: unknown): string {
  return String(value ?? "");
}

function normalizeEmail(value: unknown): string {
  return str(value).trim().toLowerCase();
}

/**
 * toon-finance's placeholder predicate (F `isPlaceholderUser`: `password_hash IS NULL`; F has no
 * OAuth, so every account has a hash). The households step uses it too: placeholders do not count
 * when looking for a group (plan m3b decision 13).
 */
export function isLegacyPlaceholder(row: Row): boolean {
  return row.password_hash === null || row.password_hash === undefined;
}

/** A finance placeholder row must carry no address at all (F `0002_placeholder_members`). */
function placeholderHasEmail(row: Row): boolean {
  const present = (value: unknown) => value !== null && value !== undefined && str(value).trim() !== "";
  return present(row.email) || present(row.email_normalized);
}

function newCount(source: LegacySource): TableCount {
  return { table: "users", source, read: 0, written: 0, alreadyMigrated: 0, skipped: 0 };
}

/** The target row of a recipe-origin user (Table M row 1). */
function recipeUserRow(row: Row, id: string, email: string): Row {
  return {
    id,
    email,
    name: row.name ?? null,
    avatar_url: normalizeStoredUploadUrl(row.avatar_url === null ? null : str(row.avatar_url)),
    email_verified: row.email_verified ?? 0,
    email_verified_at: row.email_verified_at ?? null,
    password_hash: row.password_hash ?? null,
    active_household_id: row.active_group_id ?? null,
    locale: row.locale ?? null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
  };
}

/**
 * The target row of a finance placeholder (plan m3b decision 13, ADR 0006): no e-mail, no
 * password, unconfirmed, no avatar; `active_household_id` is set by the households step.
 */
function placeholderUserRow(row: Row, id: string): Row {
  return {
    id,
    email: null,
    name: row.name ?? null,
    avatar_url: null,
    email_verified: 0,
    email_verified_at: null,
    password_hash: null,
    active_household_id: null,
    locale: row.locale ?? null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
  };
}

/** The target row of a finance-only user (decision 9, SPEC §4: read-only until confirmed). */
function financeUserRow(row: Row, id: string, email: string): Row {
  return {
    id,
    email,
    name: row.name ?? null,
    avatar_url: null,
    email_verified: 0,
    email_verified_at: null,
    password_hash: row.password_hash ?? null,
    active_household_id: null,
    locale: row.locale ?? null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
  };
}

async function readUsers(ctx: MigrationContext, source: LegacySource): Promise<Row[]> {
  const legacy = ctx[source];
  return legacy ? readAll(legacy, "SELECT * FROM users ORDER BY rowid") : [];
}

async function scalar(ctx: MigrationContext, source: LegacySource, sql: string): Promise<number> {
  const legacy = ctx[source];
  if (!legacy) return 0;
  const rows = await readAll(legacy, sql);
  return Number(rows[0]?.n ?? 0);
}

/**
 * Migrates `users` of both sources (union by e-mail), then R's `oauth_accounts`,
 * `password_reset_tokens` and `email_verification_tokens`, fills `ctx.ids.users`, the users part
 * of the report and the "not migrated by design" entries for the sessions and F's reset tokens.
 * Idempotent: users already in the ledger only fill the id maps.
 */
export async function migrateUsers(ctx: MigrationContext): Promise<void> {
  const { target, report } = ctx;
  const recipeRows = await readUsers(ctx, "recipe");
  const financeRows = await readUsers(ctx, "finance");
  const ledger: Record<LegacySource, Map<string, string>> = {
    recipe: await loadAll(target.client, "users", "recipe"),
    finance: await loadAll(target.client, "users", "finance"),
  };

  // Union by normalised e-mail. Map order = every recipe user first, then the finance-only ones.
  const groups = new Map<string, UserGroup>();
  const groupOf = (email: string): UserGroup => {
    let group = groups.get(email);
    if (!group) {
      group = { email, recipe: [], finance: undefined };
      groups.set(email, group);
    }
    return group;
  };
  for (const row of recipeRows) groupOf(normalizeEmail(row.email)).recipe.push(row);
  // Placeholders never join the e-mail union (they have no address): decided after every account.
  const placeholderRows = financeRows.filter(isLegacyPlaceholder);
  for (const row of financeRows) {
    if (isLegacyPlaceholder(row)) continue;
    groupOf(normalizeEmail(row.email_normalized ?? row.email)).finance = row;
  }

  const counts: Record<LegacySource, TableCount> = { recipe: newCount("recipe"), finance: newCount("finance") };
  counts.recipe.read = recipeRows.length;
  counts.finance.read = financeRows.length;
  const claimed = new Set<string>();
  const entries: WriteEntry[] = [];
  const collisions: { group: UserGroup; entry: WriteEntry | null; knownTarget: string | null; note?: string }[] = [];

  const idTaken = async (id: string): Promise<boolean> => {
    if (claimed.has(id)) return true;
    const result = await target.client.execute({ sql: "SELECT 1 FROM users WHERE id = ? LIMIT 1", args: [id] });
    return result.rows.length > 0;
  };

  for (const group of groups.values()) {
    const refs: LegacyRef[] = [
      ...group.recipe.map((row) => ({ source: "recipe" as const, id: str(row.id) })),
      ...(group.finance ? [{ source: "finance" as const, id: str(group.finance.id) }] : []),
    ];
    const mapped = refs.filter((ref) => ledger[ref.source].has(ref.id));
    const unmapped = refs.filter((ref) => !ledger[ref.source].has(ref.id));
    let targetId: string | null = null;
    let entry: WriteEntry | null = null;

    const known = mapped[0] ? ledger[mapped[0].source].get(mapped[0].id) : undefined;
    if (known !== undefined) {
      // Resumed run: the group is (partly) in the ledger. Fill the maps; map the rest onto it.
      targetId = known;
      claimed.add(known);
      for (const ref of mapped) {
        ctx.ids.users[ref.source].set(ref.id, ledger[ref.source].get(ref.id) ?? known);
        counts[ref.source].alreadyMigrated += 1;
      }
      // A recipe user that is NOT in the ledger yet while the group's account was created from
      // finance alone (a finance-only apply came first): the target is a finance-only account,
      // read-only until confirmed. The recipe row always wins and the boolean is no evidence, so the
      // same rule as for a fresh run applies: only a target with `email_verified_at` is matched.
      const recipeArrives = unmapped.some((ref) => ref.source === "recipe");
      const recipeMapped = mapped.some((ref) => ref.source === "recipe");
      if (recipeArrives && !recipeMapped) {
        const targetRow = await target.client.execute({
          sql: "SELECT email_verified_at FROM users WHERE id = ? LIMIT 1",
          args: [known],
        });
        const verifiedAt = targetRow.rows[0]?.email_verified_at;
        if (targetRow.rows[0] && (verifiedAt === null || verifiedAt === undefined)) {
          const reason = `unverified target account ${group.email} blocks the merge`;
          for (const ref of unmapped) {
            counts[ref.source].skipped += 1;
            report.skipped.push({ table: "users", source: ref.source, legacyId: ref.id, reason, error: true });
          }
          report.errors.push(reason);
          continue;
        }
        report.warnings.push(`user ${group.email}: matched an existing account in the target (${known})`);
      }
      if (unmapped.length > 0) {
        entry = {
          values: null,
          ledger: unmapped.map((ref) => ({ source: ref.source, legacyId: ref.id })),
          newId: known,
          label: `users ${group.email}`,
        };
        entries.push(entry);
      }
      collisions.push({ group, entry: null, knownTarget: targetId });
      continue;
    }

    const existing = await target.client.execute({
      sql: "SELECT id, email_verified_at FROM users WHERE lower(email) = ? LIMIT 1",
      args: [group.email],
    });
    const existingRow = existing.rows[0];
    if (existingRow) {
      if (existingRow.email_verified_at === null || existingRow.email_verified_at === undefined) {
        // The boolean alone is NOT evidence: never hand a legacy user's households, cards and
        // finance seat to an unconfirmed account.
        const reason = `unverified target account ${group.email} blocks the merge`;
        for (const ref of refs) {
          counts[ref.source].skipped += 1;
          report.skipped.push({ table: "users", source: ref.source, legacyId: ref.id, reason, error: true });
        }
        report.errors.push(reason);
        continue;
      }
      targetId = str(existingRow.id);
      claimed.add(targetId);
      entry = {
        values: null,
        ledger: refs.map((ref) => ({ source: ref.source, legacyId: ref.id })),
        newId: targetId,
        label: `users ${group.email}`,
      };
      entries.push(entry);
      report.warnings.push(`user ${group.email}: matched an existing account in the target (${targetId})`);
      collisions.push({ group, entry, knownTarget: null, note: "matched an existing account in the target" });
      continue;
    }

    // A new account. The id is the legacy id unless claimed (in this run, or by a target row).
    const primary = group.recipe[0];
    const preferred = primary ? str(primary.id) : str(group.finance?.id);
    let id = preferred;
    if (await idTaken(preferred)) {
      id = crypto.randomUUID();
      const origin = primary ? "recipe" : "finance";
      report.warnings.push(
        `user ${group.email} (${origin} id ${preferred}): the id is already taken in the target, new id ${id}`,
      );
    }
    claimed.add(id);
    if (group.recipe.length > 1) {
      report.warnings.push(
        `user ${group.email}: ${group.recipe.length} recipe users share this address; all are mapped onto one account`,
      );
    }
    entry = {
      values: primary ? recipeUserRow(primary, id, group.email) : financeUserRow(group.finance as Row, id, group.email),
      ledger: refs.map((ref) => ({ source: ref.source, legacyId: ref.id })),
      newId: id,
      label: `users ${group.email}`,
    };
    entries.push(entry);
    collisions.push({ group, entry, knownTarget: null });
  }

  // Placeholders (plan m3b decision 13): their own row each, after every account, never matched
  // by e-mail; the id is the F id unless claimed (in this run or by a target row).
  for (const row of placeholderRows) {
    const legacyId = str(row.id);
    const known = ledger.finance.get(legacyId);
    if (known !== undefined) {
      claimed.add(known);
      ctx.ids.users.finance.set(legacyId, known);
      counts.finance.alreadyMigrated += 1;
      continue;
    }
    if (placeholderHasEmail(row)) {
      const reason = `finance user ${legacyId} has no password but an e-mail: not a placeholder (ADR 0006)`;
      counts.finance.skipped += 1;
      report.skipped.push({ table: "users", source: "finance", legacyId, reason, error: true });
      report.errors.push(reason);
      continue;
    }
    let id = legacyId;
    if (await idTaken(legacyId)) {
      id = crypto.randomUUID();
      report.warnings.push(`placeholder ${legacyId} (finance id): the id is already taken in the target, new id ${id}`);
    }
    claimed.add(id);
    entries.push({
      values: placeholderUserRow(row, id),
      ledger: [{ source: "finance", legacyId }],
      newId: id,
      label: `placeholder ${legacyId}`,
    });
  }

  // One write call for every recipe-origin entry followed by every finance-only entry, so the
  // chunking is the plain 500-row one (gina and cleo may share a batch: the claimed set, not a
  // caught PRIMARY KEY error, keeps their ids apart).
  const skippedBefore = report.skipped.length;
  const errorsBefore = report.errors.length;
  const scratch = newCount("recipe");
  const written = await writeEntries(ctx, users, entries, scratch);
  const failureReasons = new Map<string, string>();
  for (const row of report.skipped.splice(skippedBefore)) failureReasons.set(row.legacyId, row.reason);
  report.errors.length = errorsBefore;
  const writtenSet = new Set(written);
  const failed = new Set<WriteEntry>();
  for (const entry of entries) {
    if (writtenSet.has(entry)) {
      for (const item of entry.ledger) {
        ctx.ids.users[item.source].set(item.legacyId, entry.newId);
        counts[item.source].written += 1;
      }
      continue;
    }
    failed.add(entry);
    const reason = failureReasons.get(entry.ledger[0]?.legacyId ?? "") ?? "insert failed";
    for (const item of entry.ledger) {
      counts[item.source].skipped += 1;
      report.skipped.push({ table: "users", source: item.source, legacyId: item.legacyId, reason, error: true });
    }
    report.errors.push(`users ${entry.label}: ${reason}`);
  }

  // The users part of the report (assigned, not appended: a second call reports the same).
  const collisionRows: UserCollision[] = [];
  for (const { group, entry, knownTarget, note } of collisions) {
    const primary = group.recipe[0];
    if (!primary || !group.finance || (entry !== null && failed.has(entry))) continue;
    const targetUserId = knownTarget ?? entry?.newId;
    if (targetUserId === undefined) continue;
    const oauthOnly = primary.password_hash === null || primary.password_hash === undefined;
    const noteText = [note, oauthOnly ? OAUTH_ONLY_NOTE : undefined].filter(Boolean).join("; ");
    collisionRows.push({
      email: group.email,
      recipeUserId: str(primary.id),
      financeUserId: str(group.finance.id),
      targetUserId,
      passwordFrom: oauthOnly ? "none" : "recipe",
      ...(noteText ? { note: noteText } : {}),
    });
  }
  const targetIds = new Set([...ctx.ids.users.recipe.values(), ...ctx.ids.users.finance.values()]);
  report.users = {
    recipe: recipeRows.length,
    finance: financeRows.length,
    placeholders: placeholderRows.length,
    target: targetIds.size,
    collisions: collisionRows,
  };
  for (const source of ["recipe", "finance"] as const) {
    if (ctx[source]) report.counts = report.counts.filter((c) => !(c.table === "users" && c.source === source));
    if (ctx[source]) report.counts.push(counts[source]);
  }

  if (ctx.recipe) {
    const mapUser = (row: Row): string | null => ctx.ids.users.recipe.get(str(row.user_id)) ?? null;
    const unmapped = (row: Row) => ({ skip: `user ${str(row.user_id)} not migrated`, error: true });
    await copyTable(ctx, {
      source: "recipe",
      legacyTable: "oauth_accounts",
      target: oauthAccounts,
      transform: (row) => {
        const userId = mapUser(row);
        return userId === null ? unmapped(row) : { ...row, user_id: userId };
      },
    });
    for (const [legacyTable, table] of [
      ["password_reset_tokens", passwordResetTokens],
      ["email_verification_tokens", emailVerificationTokens],
    ] as const) {
      await copyTable(ctx, {
        source: "recipe",
        legacyTable,
        target: table,
        transform: (row) => {
          const userId = mapUser(row);
          return userId === null ? unmapped(row) : { ...row, user_id: userId };
        },
      });
    }
  }

  // Not migrated by design (decision 12); replaced, not appended, on a second call.
  const notMigrated = [
    ...(ctx.recipe
      ? [{ table: "sessions", source: "recipe" as const, rows: await scalar(ctx, "recipe", "SELECT count(*) AS n FROM sessions"), reason: "everyone logs in again" }]
      : []),
    ...(ctx.finance
      ? [
          { table: "sessions", source: "finance" as const, rows: await scalar(ctx, "finance", "SELECT count(*) AS n FROM sessions"), reason: "everyone logs in again" },
          { table: "password_reset_tokens", source: "finance" as const, rows: await scalar(ctx, "finance", "SELECT count(*) AS n FROM password_reset_tokens"), reason: "short-lived tokens; request a new reset link" },
        ]
      : []),
  ];
  report.notMigrated = report.notMigrated.filter(
    (item) => !notMigrated.some((n) => n.table === item.table && n.source === item.source),
  );
  report.notMigrated.push(...notMigrated);
}
