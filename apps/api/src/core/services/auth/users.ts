/**
 * OWNER: auth agent.
 *
 * User records: lookup, creation (incl. the first household every account needs)
 * and the row -> `User` DTO mapping used by every auth response.
 */
import type { User } from "@toon/shared";
import { eq } from "drizzle-orm";
import type { Database } from "../../../db/client.ts";
import { type UserRow, householdMembers, households, users } from "../../../db/schema.ts";
import { ApiError } from "../../../lib/errors.ts";
import { toIso, toIsoOrNull } from "../../../lib/http.ts";
import { signUploadUrl } from "../../../lib/uploadUrls.ts";
import { initializeHousehold } from "../households/modules.ts";

/** Default name of the household created for a brand-new account. */
export const DEFAULT_HOUSEHOLD_NAME = "Meine Rezepte";

/** Row -> the shape every auth endpoint returns. `hasPassword` hides the hash. */
export function toUserDto(row: UserRow, activeHouseholdId?: string | null): User {
  return {
    id: row.id,
    email: row.email,
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

/** True for a SQLite UNIQUE constraint failure, whatever the driver wraps it in. */
export function isUniqueViolation(error: unknown): boolean {
  const message = error instanceof Error ? `${error.message} ${String((error as { code?: unknown }).code ?? "")}` : String(error);
  return /unique constraint|sqlite_constraint_unique|constraint failed: users\.email/i.test(message);
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
