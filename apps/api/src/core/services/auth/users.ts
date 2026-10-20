/**
 * OWNER: auth agent.
 *
 * User records: lookup, creation (incl. the first household every account needs)
 * and the row -> `User` DTO mapping used by every auth response.
 *
 * The `Users` service (docs/EFFECT.md E7; plan `docs/plans/e2-api-core-services.md` P2, P7) reads the current
 * executor of `Database` on every call, so a bridge's `db` and an open transaction reach it; timestamps come from
 * the `Clock`. `userDto` and `accountEmail` are service-free Effects (they read no database), so their bridges
 * `toUserDto` and `requireAccountEmail` stay SYNCHRONOUS through `Effect.runSync` (plan e2 P1): a placeholder row
 * throws the `Unauthorized` refusal synchronously, as before. The pure helpers (`isPlaceholderUser`,
 * `isUniqueViolation`, `displayNameFromEmail`, `DEFAULT_HOUSEHOLD_NAME`) stay plain.
 */
import type { User } from "@toon/shared";
import { and, eq, isNull } from "drizzle-orm";
import { Clock, Context, Effect, Layer } from "effect";
import type { Database as DrizzleDatabase } from "../../../db/client.ts";
import { Database } from "../../../db/database.ts";
import { type UserRow, householdMembers, households, users } from "../../../db/schema.ts";
import { Conflict, type DatabaseError, NotFound, Unauthorized } from "../../../lib/errors.ts";
import { toIso, toIsoOrNull } from "../../../lib/http.ts";
import { signUploadUrl } from "../../../lib/uploadUrls.ts";
import type { HookError } from "../../../modules/types.ts";
import { runtime } from "../../../runtime.ts";
import { HouseholdModules } from "../households/modules.ts";
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
 * `requireAccountEmail`) rather than inventing an empty address. Service-free (no database).
 */
export const accountEmail = Effect.fnUntraced(function* (
  row: Pick<UserRow, "email">,
): Effect.fn.Return<string, Unauthorized> {
  if (row.email === null) return yield* new Unauthorized();
  return row.email;
});

/** Row -> the shape every auth endpoint returns. `hasPassword` hides the hash. Service-free (no database). */
export const userDto = Effect.fnUntraced(function* (
  row: UserRow,
  activeHouseholdId?: string | null,
): Effect.fn.Return<User, Unauthorized> {
  return {
    id: row.id,
    email: yield* accountEmail(row),
    name: row.name,
    avatarUrl: signUploadUrl(row.avatarUrl),
    emailVerified: row.emailVerified,
    emailVerifiedAt: toIsoOrNull(row.emailVerifiedAt),
    hasPassword: typeof row.passwordHash === "string" && row.passwordHash.length > 0,
    activeHouseholdId: activeHouseholdId === undefined ? row.activeHouseholdId : activeHouseholdId,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
});

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

export interface ClaimPlaceholderInput {
  email: string;
  name: string;
  /** argon2id hash of the password chosen at registration. */
  passwordHash: string;
}

/** A profile patch `updateUser` accepts. */
export type UserPatch = Partial<Pick<UserRow, "name" | "avatarUrl" | "activeHouseholdId" | "passwordHash">>;

/** The `email_taken` refusal of a unique violation on `users.email`. */
function emailTaken(): Conflict {
  return new Conflict({ code: "email_taken", text: "server.auth.emailTaken" });
}

/** User rows: lookup, creation, the placeholder claim, the profile patch and the DTO mapping. */
export class Users extends Context.Service<
  Users,
  {
    /** Case-insensitive lookup (e-mails are stored normalized to lowercase). */
    readonly findUserByEmail: (email: string) => Effect.Effect<UserRow | undefined, DatabaseError>;
    readonly findUserById: (id: string) => Effect.Effect<UserRow | undefined, DatabaseError>;
    /** Inserts a user, mapping the unique-email constraint to 409 `email_taken`. */
    readonly createUser: (input: CreateUserInput) => Effect.Effect<UserRow, Conflict | DatabaseError>;
    /**
     * Inserts a PLACEHOLDER user (ADR 0006, plan m3b decision 1): a name and nothing else, so
     * `isPlaceholderUser` holds. Only `addPlaceholderMember` (households.service.ts) calls it, inside
     * the transaction that also writes the membership: a placeholder in no household is an orphan
     * nobody can see or claim (toon-finance `createPlaceholderUser`). `locale` stays NULL, so
     * `env.defaultLocale` applies until the claimed account picks one; `activeHouseholdId` is the
     * household it is created in, which is where the claimed account lands first.
     */
    readonly createPlaceholderUser: (name: string, householdId: string) => Effect.Effect<UserRow, DatabaseError>;
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
    readonly claimPlaceholderUser: (
      userId: string,
      input: ClaimPlaceholderInput,
    ) => Effect.Effect<void, Conflict | DatabaseError>;
    /** Creates a household with `userId` as its owner and makes it the active household. */
    readonly createOwnedHousehold: (
      userId: string,
      name: string,
      description?: string | null,
    ) => Effect.Effect<{ householdId: string }, HookError>;
    /** Writes `users.active_household_id` (a soft UI pointer, no FK). */
    readonly setActiveHousehold: (userId: string, householdId: string | null) => Effect.Effect<void, DatabaseError>;
    /**
     * Applies a profile patch and returns the updated row. `emailVerified` is deliberately NOT
     * patchable here: the flag and `emailVerifiedAt` must move together, so markEmailVerified()
     * (services/auth/emailVerification.ts) is the only writer.
     */
    readonly updateUser: (userId: string, patch: UserPatch) => Effect.Effect<UserRow, NotFound | DatabaseError>;
    /** {@link userDto}. */
    readonly userDto: (row: UserRow, activeHouseholdId?: string | null) => Effect.Effect<User, Unauthorized>;
    /** {@link accountEmail}. */
    readonly accountEmail: (row: Pick<UserRow, "email">) => Effect.Effect<string, Unauthorized>;
  }
>()("toon/api/core/services/auth/users/Users") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const database = yield* Database;
      const householdModules = yield* HouseholdModules;

      const findUserByEmail = Effect.fn("Users.findUserByEmail")(function* (email: string) {
        const rows = yield* database.use((db) =>
          db
            .select()
            .from(users)
            .where(eq(users.email, email.trim().toLowerCase()))
            .limit(1),
        );
        return rows[0];
      });

      const findUserById = Effect.fn("Users.findUserById")(function* (id: string) {
        const rows = yield* database.use((db) => db.select().from(users).where(eq(users.id, id)).limit(1));
        return rows[0];
      });

      const createUser = Effect.fn("Users.createUser")(function* (input: CreateUserInput) {
        const now = yield* Clock.currentTimeMillis;
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
        yield* database
          .use((db) => db.insert(users).values(row))
          .pipe(
            Effect.catchTag("DatabaseError", (error) =>
              Effect.fail(isUniqueViolation(error.cause) ? emailTaken() : error),
            ),
          );
        return row;
      });

      const createPlaceholderUser = Effect.fn("Users.createPlaceholderUser")(function* (
        name: string,
        householdId: string,
      ) {
        const now = yield* Clock.currentTimeMillis;
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
        yield* database.use((db) => db.insert(users).values(row));
        return row;
      });

      const claimPlaceholderUser = Effect.fn("Users.claimPlaceholderUser")(function* (
        userId: string,
        input: ClaimPlaceholderInput,
      ) {
        const now = yield* Clock.currentTimeMillis;
        const claimed = yield* database
          .use((db) =>
            db
              .update(users)
              .set({
                email: input.email.trim().toLowerCase(),
                name: input.name.trim(),
                passwordHash: input.passwordHash,
                emailVerified: false,
                emailVerifiedAt: null,
                updatedAt: now,
              })
              .where(and(eq(users.id, userId), isNull(users.passwordHash), isNull(users.email)))
              .returning({ id: users.id }),
          )
          .pipe(
            Effect.catchTag("DatabaseError", (error) =>
              Effect.fail(isUniqueViolation(error.cause) ? emailTaken() : error),
            ),
          );
        if (claimed.length === 0) {
          return yield* new Conflict({ code: "member_has_account", text: "server.household.memberHasAccount" });
        }
      });

      const setActiveHousehold = Effect.fn("Users.setActiveHousehold")(function* (
        userId: string,
        householdId: string | null,
      ) {
        const now = yield* Clock.currentTimeMillis;
        yield* database.use((db) =>
          db.update(users).set({ activeHouseholdId: householdId, updatedAt: now }).where(eq(users.id, userId)),
        );
      });

      const createOwnedHousehold = Effect.fn("Users.createOwnedHousehold")(function* (
        userId: string,
        name: string,
        description?: string | null,
      ) {
        const now = yield* Clock.currentTimeMillis;
        const householdId = crypto.randomUUID();
        yield* database.use((db) =>
          db.insert(households).values({
            id: householdId,
            name: name.trim().length > 0 ? name.trim() : DEFAULT_HOUSEHOLD_NAME,
            description: description ?? null,
            imageUrl: null,
            createdBy: userId,
            createdAt: now,
            updatedAt: now,
          }),
        );
        yield* database.use((db) =>
          db.insert(householdMembers).values({
            id: crypto.randomUUID(),
            householdId,
            userId,
            role: "owner",
            createdAt: now,
          }),
        );
        // The default module rows + build modules' onHouseholdCreated hooks (SPEC D2).
        yield* householdModules.initializeHousehold(householdId);
        yield* setActiveHousehold(userId, householdId);
        return { householdId };
      });

      const updateUser = Effect.fn("Users.updateUser")(function* (userId: string, patch: UserPatch) {
        const now = yield* Clock.currentTimeMillis;
        yield* database.use((db) =>
          db
            .update(users)
            .set({ ...patch, updatedAt: now })
            .where(eq(users.id, userId)),
        );
        const row = yield* findUserById(userId);
        if (!row) return yield* new NotFound({ text: "server.auth.userNotFound" });
        return row;
      });

      return Users.of({
        findUserByEmail,
        findUserById,
        createUser,
        createPlaceholderUser,
        claimPlaceholderUser,
        createOwnedHousehold,
        setActiveHousehold,
        updateUser,
        userDto,
        accountEmail,
      });
    }),
  );
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
 * into a 500 (toon-finance gotcha 51, plan M3 decision 16). Hence: walk the
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

/* legacy bridges: callers listed; E3 (recipe), E4 (finance), E5 (scripts) remove them */

// `requireAccountEmail` and `toUserDto` stay SYNCHRONOUS with their old return types (plan e2 P1): each runs a
// service-free effect with `Effect.runSync`, which throws the `Unauthorized` refusal itself (`Cause.squash`).

/** Callers: `core/routes/auth.ts`, `emailVerification.ts` (E2-T08/E2-T10). */
export function requireAccountEmail(row: Pick<UserRow, "email">): string {
  return Effect.runSync(accountEmail(row));
}

/** Callers: `middleware/session.ts` (E2-T12), `auth/bootstrap.ts` (E2-T09). */
export function toUserDto(row: UserRow, activeHouseholdId?: string | null): User {
  return Effect.runSync(userDto(row, activeHouseholdId));
}

/** Callers: `core/routes/auth.ts`, `oauthAccounts.ts`, `scripts/reset-password.ts` (E5). */
export function findUserByEmail(database: DrizzleDatabase, email: string): Promise<UserRow | undefined> {
  return runtime.runPromise(Users.use((service) => service.findUserByEmail(email)).pipe(Database.withExecutor(database)));
}

/** Callers: `core/routes/auth.ts`, `emailVerification.ts`, `oauthAccounts.ts`, `passwordReset.ts`. */
export function findUserById(database: DrizzleDatabase, id: string): Promise<UserRow | undefined> {
  return runtime.runPromise(Users.use((service) => service.findUserById(id)).pipe(Database.withExecutor(database)));
}

/** Callers: `core/routes/auth.ts`, `oauthAccounts.ts`, `apps/api/test/auth.test.ts` (OAuth, invite parts). */
export function createUser(database: DrizzleDatabase, input: CreateUserInput): Promise<UserRow> {
  return runtime.runPromise(Users.use((service) => service.createUser(input)).pipe(Database.withExecutor(database)));
}

/** Callers: `households.service.ts` (E2-T09), inside the membership's transaction. */
export function createPlaceholderUser(database: DbLike, name: string, householdId: string): Promise<UserRow> {
  return runtime.runPromise(
    Users.use((service) => service.createPlaceholderUser(name, householdId)).pipe(Database.withExecutor(database)),
  );
}

/** Callers: `auth/invites.ts` (E2-T07), `apps/api/test/placeholders.test.ts` (pinned: the two-claim race). */
export function claimPlaceholderUser(database: DbLike, userId: string, input: ClaimPlaceholderInput): Promise<void> {
  return runtime.runPromise(
    Users.use((service) => service.claimPlaceholderUser(userId, input)).pipe(Database.withExecutor(database)),
  );
}

/** Callers: `core/routes/auth.ts`, `oauthAccounts.ts`, `apps/api/test/auth.test.ts` (OAuth, invite parts). */
export function createOwnedHousehold(
  database: DrizzleDatabase,
  userId: string,
  name: string,
  description?: string | null,
): Promise<{ householdId: string }> {
  return runtime.runPromise(
    Users.use((service) => service.createOwnedHousehold(userId, name, description)).pipe(
      Database.withExecutor(database),
    ),
  );
}

/** Callers: `core/routes/auth.ts`, `auth/bootstrap.ts`. */
export function setActiveHousehold(
  database: DrizzleDatabase,
  userId: string,
  householdId: string | null,
): Promise<void> {
  return runtime.runPromise(
    Users.use((service) => service.setActiveHousehold(userId, householdId)).pipe(Database.withExecutor(database)),
  );
}

/** Callers: `core/routes/auth.ts`, `oauthAccounts.ts`, `apps/api/test/auth.test.ts` (OAuth part). */
export function updateUser(database: DrizzleDatabase, userId: string, patch: UserPatch): Promise<UserRow> {
  return runtime.runPromise(Users.use((service) => service.updateUser(userId, patch)).pipe(Database.withExecutor(database)));
}
