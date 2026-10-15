/**
 * OWNER: auth agent.
 *
 * User records: lookup, creation (incl. the first household every account needs)
 * and the row -> `User` DTO mapping used by every auth response.
 */
import type { User } from "@toon/shared";
import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "../../../db/client.ts";
import { type UserRow, householdMembers, households, users } from "../../../db/schema.ts";
import { ApiError } from "../../../lib/errors.ts";
import { toIso, toIsoOrNull } from "../../../lib/http.ts";
import { signUploadUrl } from "../../../lib/uploadUrls.ts";
import { initializeHousehold } from "../households/modules.ts";
import type { DbLike } from "../households/support.ts";

/** Default name of the household created for a brand-new account. */
export const DEFAULT_HOUSEHOLD_NAME = "Meine Rezepte";

/**
 * A PLACEHOLDER is a household member without an account (ADR 0006, plan m3b decision 1):
 * `email` AND `password_hash` are both NULL. Both, because in this app an OAuth-only account
 * also has a NULL hash (toon-finance's predicate, the hash alone, does not fit here), and an
 * account always has an e-mail. This is the one predicate; nothing else decides it. A
 * placeholder has no OAuth link, no session and no confirmed address, and cannot sign in:
 * login, password reset and OAuth all look up by e-mail or provider id.
 */
export function isPlaceholderUser(row: Pick<UserRow, "email" | "passwordHash">): boolean {
  return row.email === null && row.passwordHash === null;
}

/**
 * The e-mail of a row that must be an account: a session user, a user found by e-mail, the
 * recipient of an auth mail. A placeholder has no login path, so a session naming one is a
 * programming error, not a user-facing state: refused as 401 (toon-finance's
 * `requireAccountEmail`) rather than inventing an empty address.
 */
export function requireAccountEmail(row: Pick<UserRow, "email">): string {
  if (row.email === null) throw ApiError.unauthorized();
  return row.email;
}

/** Row -> the shape every auth endpoint returns. `hasPassword` hides the hash. */
export function toUserDto(row: UserRow, activeHouseholdId?: string | null): User {
  return {
    id: row.id,
    email: requireAccountEmail(row),
    name: row.name,
    avatarUrl: signUploadUrl(row.avatarUrl),
    emailVerified: row.emailVerified,
    emailVerifiedAt: toIsoOrNull(row.emailVerifiedAt),
    hasPassword: typeof row.passwordHash === "string" && row.passwordHash.length > 0,
    activeHouseholdId: activeHouseholdId === undefined ? row.activeHouseholdId : activeHouseholdId,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

/** Case-insensitive lookup (e-mails are stored normalized to lowercase). */
export async function findUserByEmail(
  database: Database,
  email: string,
): Promise<UserRow | undefined> {
  const rows = await database
    .select()
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .limit(1);
  return rows[0];
}

export async function findUserById(database: Database, id: string): Promise<UserRow | undefined> {
  const rows = await database.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0];
}

export interface CreateUserInput {
  email: string;
  name: string;
  /** argon2id hash, or null for OAuth-only accounts. */
  passwordHash?: string | null;
  avatarUrl?: string | null;
  /**
   * ONLY set this when something actually proved the address belongs to the user
   * at CREATION time — today that means an OAuth provider that reports it as
   * verified. Self-registration must leave it `false` (the default) and earn the
   * flag later by clicking a confirmation link (see
   * services/auth/emailVerification.ts): a trusted-looking flag set by the
   * registrant themselves was once enough to hand a victim's OAuth login to
   * whoever registered their address first.
   */
  emailVerified?: boolean;
}

/** Inserts a user, mapping the unique-email constraint to 409 `email_taken`. */
export async function createUser(database: Database, input: CreateUserInput): Promise<UserRow> {
  const now = Date.now();
  const emailVerified = input.emailVerified ?? false;
  const row: UserRow = {
    id: crypto.randomUUID(),
    email: input.email.trim().toLowerCase(),
    name: input.name.trim(),
    avatarUrl: input.avatarUrl ?? null,
    emailVerified,
    // The flag and its evidence are always written together — see the column
    // comment in db/schema.ts and markEmailVerified() in emailVerification.ts.
    emailVerifiedAt: emailVerified ? now : null,
    passwordHash: input.passwordHash ?? null,
    activeHouseholdId: null,
    // NULL = "never chosen" (docs/i18n.md §6) — env.defaultLocale wins for a
    // brand-new account until it picks one.
    locale: null,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await database.insert(users).values(row);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw ApiError.conflict("email_taken", "server.auth.emailTaken");
    }
    throw error;
  }
  return row;
}

/**
 * Inserts a PLACEHOLDER user (ADR 0006, plan m3b decision 1): a name and nothing else, so
 * `isPlaceholderUser` holds. Only `addPlaceholderMember` (households.service.ts) calls it, inside
 * the transaction that also writes the membership: a placeholder in no household is an orphan
 * nobody can see or claim (toon-finance `createPlaceholderUser`). `locale` stays NULL, so
 * `env.defaultLocale` applies until the claimed account picks one; `activeHouseholdId` is the
 * household it is created in, which is where the claimed account lands first.
 */
export async function createPlaceholderUser(
  database: DbLike,
  name: string,
  householdId: string,
): Promise<UserRow> {
  const now = Date.now();
  const row: UserRow = {
    id: crypto.randomUUID(),
    email: null,
    name: name.trim(),
    avatarUrl: null,
    emailVerified: false,
    emailVerifiedAt: null,
    passwordHash: null,
    activeHouseholdId: householdId,
    locale: null,
    createdAt: now,
    updatedAt: now,
  };
  await database.insert(users).values(row);
  return row;
}

export interface ClaimPlaceholderInput {
  email: string;
  name: string;
  /** argon2id hash of the password chosen at registration. */
  passwordHash: string;
}

/**
 * Turns a placeholder into an account IN PLACE (ADR 0006, plan m3b decision 4): same id, so
 * every membership, `finance_participants`, `payer_id` and `person_id` row keeps naming the
 * same person. ONE conditional statement, never check-then-write (toon-finance gotcha 72): two
 * registrations through the same claim link race on the `WHERE … IS NULL` conditions, the first
 * one writes, the second matches zero rows and gets `409 member_has_account` instead of
 * overwriting the first one's e-mail and password. The address arrives unconfirmed
 * (`email_verified = 0`, D4): the verified-e-mail gate keeps the account read-only until the
 * confirmation link is used. A unique violation on the address is `409 email_taken`.
 */
export async function claimPlaceholderUser(
  database: DbLike,
  userId: string,
  input: ClaimPlaceholderInput,
): Promise<void> {
  let claimed: Array<{ id: string }>;
  try {
    claimed = await database
      .update(users)
      .set({
        email: input.email.trim().toLowerCase(),
        name: input.name.trim(),
        passwordHash: input.passwordHash,
        emailVerified: false,
        emailVerifiedAt: null,
        updatedAt: Date.now(),
      })
      .where(and(eq(users.id, userId), isNull(users.passwordHash), isNull(users.email)))
      .returning({ id: users.id });
  } catch (error) {
    if (isUniqueViolation(error)) throw ApiError.conflict("email_taken", "server.auth.emailTaken");
    throw error;
  }
  if (claimed.length === 0) {
    throw ApiError.conflict("member_has_account", "server.household.memberHasAccount");
  }
}

/** Creates a household with `userId` as its owner and makes it the active household. */
export async function createOwnedHousehold(
  database: Database,
  userId: string,
  name: string,
  description?: string | null,
): Promise<{ householdId: string }> {
  const now = Date.now();
  const householdId = crypto.randomUUID();
  await database.insert(households).values({
    id: householdId,
    name: name.trim().length > 0 ? name.trim() : DEFAULT_HOUSEHOLD_NAME,
    description: description ?? null,
    imageUrl: null,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  });
  await database.insert(householdMembers).values({
    id: crypto.randomUUID(),
    householdId,
    userId,
    role: "owner",
    createdAt: now,
  });
  // The default module rows + build modules' onHouseholdCreated hooks (SPEC D2).
  await initializeHousehold(database, householdId);
  await setActiveHousehold(database, userId, householdId);
  return { householdId };
}

/** Writes `users.active_household_id` (a soft UI pointer, no FK). */
export async function setActiveHousehold(
  database: Database,
  userId: string,
  householdId: string | null,
): Promise<void> {
  await database
    .update(users)
    .set({ activeHouseholdId: householdId, updatedAt: Date.now() })
    .where(eq(users.id, userId));
}

/** Applies a profile patch and returns the updated row. */
export async function updateUser(
  database: Database,
  userId: string,
  /**
   * `emailVerified` is deliberately NOT patchable here: the flag and
   * `emailVerifiedAt` must move together, so markEmailVerified()
   * (services/auth/emailVerification.ts) is the only writer.
   */
  patch: Partial<Pick<UserRow, "name" | "avatarUrl" | "activeHouseholdId" | "passwordHash">>,
): Promise<UserRow> {
  await database
    .update(users)
    .set({ ...patch, updatedAt: Date.now() })
    .where(eq(users.id, userId));
  const row = await findUserById(database, userId);
  if (!row) throw ApiError.notFound("server.auth.userNotFound");
  return row;
}

const UNIQUE_VIOLATION_RE = /unique constraint|sqlite_constraint_unique|constraint failed: users\.email/i;

/**
 * True for a SQLite UNIQUE constraint failure, whatever the driver wraps it in
 * — and it always wraps it in something. Drizzle turns EVERY query failure
 * into a `DrizzleQueryError` whose own `message` is only `Failed query: insert
 * into "…" …` and whose `code` is `undefined`; the driver's `LibsqlError`
 * (`SQLITE_CONSTRAINT: UNIQUE constraint failed: …`) sits one level down in
 * `cause`. Inspecting just the top level therefore answers `false` for every
 * unique violation drizzle can produce and turns each 409 built on this helper
 * into a 500 (toon-finance gotcha 50, plan M3 decision 16). Hence: walk the
 * chain, depth-capped so a self-referential `cause` cannot spin.
 */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current !== null && current !== undefined && depth < 5; depth++) {
    const text =
      current instanceof Error
        ? `${current.message} ${String((current as { code?: unknown }).code ?? "")}`
        : String(current);
    if (UNIQUE_VIOLATION_RE.test(text)) return true;
    current = current instanceof Error ? current.cause : undefined;
  }
  return false;
}

/** Fallback display name for OAuth profiles without a name ("max" from "max@x.de"). */
export function displayNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  const cleaned = local.replace(/[._-]+/g, " ").trim();
  if (cleaned.length === 0) return "Nutzer";
  return cleaned
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
    .slice(0, 80);
}
