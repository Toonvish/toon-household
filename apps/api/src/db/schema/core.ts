/**
 * Core Drizzle (libSQL/SQLite) schema for toon-household: users/auth, households with
 * their members and invites, household_modules and legacy_ids (SPEC §4). Module tables
 * live in `schema/<module>.ts` (SPEC D7).
 *
 * Conventions
 * - ids: crypto.randomUUID() text primary keys
 * - timestamps: integer unix MILLISECONDS (exposed as ISO strings by the API)
 * - booleans: integer 0/1 via mode: "boolean"
 * - every FK used for listing has an index; household-scoped tables cascade from `households`
 *
 * Authorship columns (`created_by`, `invited_by`) cascade on user deletion. A future
 * "Konto löschen" flow MUST first transfer ownership/authorship inside shared households,
 * otherwise the household would lose those rows — see docs/API.md.
 */
import { relations } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const now = () => Date.now();

/* -------------------------------------------------------------------------- */
/* users / auth                                                               */
/* -------------------------------------------------------------------------- */

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    avatarUrl: text("avatar_url"),
    emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
    /**
     * WHEN the address was proved: a confirmation click on a mailed link, or an
     * OAuth provider that reported it verified. Always written together with
     * `emailVerified` (see markEmailVerified in services/auth/emailVerification.ts).
     *
     * The boolean alone is NOT evidence — self-registration used to set it and that
     * was an account-takeover via OAuth auto-linking. Anything that wants to trust
     * the address must look at this timestamp.
     */
    emailVerifiedAt: integer("email_verified_at"),
    /** argon2id hash from Bun.password. NULL for OAuth-only accounts. */
    passwordHash: text("password_hash"),
    /**
     * Last household the user had selected. Deliberately WITHOUT a FK: it is a soft
     * UI pointer and a FK here would create a users <-> households cycle in the
     * generated migration. Readers must tolerate a stale/absent household id.
     */
    activeHouseholdId: text("active_household_id"),
    /**
     * The account's INTERFACE locale ("de" | "en"), mirrored from the device
     * preference only because mail is delivered outside any browser. NULL
     * means "never chosen" — `env.defaultLocale` wins for those, which is
     * what lets a deployment's default change without a backfill. This is
     * NOT `recipes.language` (the CONTENT axis); see CLAUDE.md.
     */
    locale: text("locale"),
    createdAt: integer("created_at").notNull().$defaultFn(now),
    updatedAt: integer("updated_at").notNull().$defaultFn(now),
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)],
);

export const oauthAccounts = sqliteTable(
  "oauth_accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** "google" | "github" */
    provider: text("provider").notNull(),
    providerUserId: text("provider_user_id").notNull(),
    providerEmail: text("provider_email"),
    createdAt: integer("created_at").notNull().$defaultFn(now),
  },
  (table) => [
    uniqueIndex("oauth_accounts_provider_user_unique").on(table.provider, table.providerUserId),
    index("oauth_accounts_user_id_idx").on(table.userId),
  ],
);

export const sessions = sqliteTable(
  "sessions",
  {
    /** Opaque random id — this IS the cookie value. */
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Sliding 30-day expiry, refreshed on use. */
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull().$defaultFn(now),
    lastUsedAt: integer("last_used_at").notNull().$defaultFn(now),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
  },
  (table) => [
    index("sessions_user_id_idx").on(table.userId),
    index("sessions_expires_at_idx").on(table.expiresAt),
  ],
);

/**
 * Single-use secrets from a mailed link: password reset and e-mail confirmation.
 *
 * WE STORE A SHA-256 HASH, NEVER THE TOKEN. Note the deliberate difference from
 * `household_invites.token` below, which keeps the raw value: a leaked invites table
 * costs you household membership, a leaked reset table would cost every account. The
 * hash is unsalted and un-stretched on purpose — the input is already 256 bits of
 * CSPRNG output, so there is nothing to brute-force and argon2 here would only
 * make lookup-by-token impossible.
 *
 * `used_at` makes consumption one-shot; rows are never updated in place, so a
 * replay is a plain `used_at IS NOT NULL` check.
 */
export const passwordResetTokens = sqliteTable(
  "password_reset_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 (hex) of the token that travelled in the link. */
    tokenHash: text("token_hash").notNull(),
    /** 1 hour after creation — far shorter than the invites' 14 days. */
    expiresAt: integer("expires_at").notNull(),
    usedAt: integer("used_at"),
    /** For abuse forensics; only trustworthy when TRUST_PROXY=1. */
    requestedIp: text("requested_ip"),
    createdAt: integer("created_at").notNull().$defaultFn(now),
  },
  (table) => [
    uniqueIndex("password_reset_tokens_hash_unique").on(table.tokenHash),
    index("password_reset_tokens_user_id_idx").on(table.userId),
    index("password_reset_tokens_expires_at_idx").on(table.expiresAt),
  ],
);

/** Same shape and the same hashing rule as `password_reset_tokens`, 24 h TTL. */
export const emailVerificationTokens = sqliteTable(
  "email_verification_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    /**
     * Address the token was issued FOR. Checked on confirm, so a token minted
     * before a profile e-mail change cannot verify the new address.
     */
    email: text("email").notNull(),
    expiresAt: integer("expires_at").notNull(),
    usedAt: integer("used_at"),
    requestedIp: text("requested_ip"),
    createdAt: integer("created_at").notNull().$defaultFn(now),
  },
  (table) => [
    uniqueIndex("email_verification_tokens_hash_unique").on(table.tokenHash),
    index("email_verification_tokens_user_id_idx").on(table.userId),
    index("email_verification_tokens_expires_at_idx").on(table.expiresAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* households / membership                                                    */
/* -------------------------------------------------------------------------- */

export const households = sqliteTable(
  "households",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    imageUrl: text("image_url"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull().$defaultFn(now),
    updatedAt: integer("updated_at").notNull().$defaultFn(now),
  },
  (table) => [index("households_created_by_idx").on(table.createdBy)],
);

export const householdMembers = sqliteTable(
  "household_members",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** "owner" | "admin" | "member" (HouseholdRole in @toon/shared) */
    role: text("role").notNull().default("member"),
    createdAt: integer("created_at").notNull().$defaultFn(now),
  },
  (table) => [
    uniqueIndex("household_members_household_user_unique").on(table.householdId, table.userId),
    index("household_members_household_id_idx").on(table.householdId),
    index("household_members_user_id_idx").on(table.userId),
  ],
);

export const householdInvites = sqliteTable(
  "household_invites",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    /** "admin" | "member" */
    role: text("role").notNull().default("member"),
    /** Random URL-safe token; the invite link carries it. */
    token: text("token").notNull(),
    /** "pending" | "accepted" | "revoked" | "expired" */
    status: text("status").notNull().default("pending"),
    invitedBy: text("invited_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    acceptedBy: text("accepted_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: integer("expires_at").notNull(),
    acceptedAt: integer("accepted_at"),
    createdAt: integer("created_at").notNull().$defaultFn(now),
  },
  (table) => [
    uniqueIndex("household_invites_token_unique").on(table.token),
    index("household_invites_household_id_idx").on(table.householdId),
    index("household_invites_email_idx").on(table.email),
    index("household_invites_invited_by_idx").on(table.invitedBy),
  ],
);

/* -------------------------------------------------------------------------- */
/* modules / migration ledger                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Which modules a household has switched on (SPEC D2). A module absent here is
 * disabled for that household: the shell hides it and its routes answer
 * `404 module_disabled` (`requireModule`). `settings` is the module's own JSON
 * (e.g. finance's two participant slots), validated by the module, never by core.
 */
export const householdModules = sqliteTable(
  "household_modules",
  {
    householdId: text("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    /** A `ModuleId` from @toon/shared; an id this build does not know reads as disabled. */
    moduleId: text("module_id").notNull(),
    enabledAt: integer("enabled_at").notNull().$defaultFn(now),
    /** Module-owned JSON text; NULL = the module's defaults. */
    settings: text("settings"),
  },
  (table) => [primaryKey({ columns: [table.householdId, table.moduleId] })],
);

/**
 * The idempotency ledger of `bun run migrate:legacy` (SPEC D12, §6): every row the
 * migration writes records where it came from, and a second run skips what is
 * already mapped.
 *
 * The SQL column is named `table`, as D12 spells it. It is a keyword, but drizzle
 * quotes every identifier it emits, so it is harmless; the TS property is
 * `tableName` because `table` reads badly in code.
 */
export const legacyIds = sqliteTable(
  "legacy_ids",
  {
    /** The NEW table the row was written to, e.g. "households" or "recipe_recipes". */
    tableName: text("table").notNull(),
    /** Which old database the row came from, e.g. "recipe" or "finance". */
    legacySource: text("legacy_source").notNull(),
    /** The row's id in that database. */
    legacyId: text("legacy_id").notNull(),
    /** The id it was written under here (may equal `legacy_id`). */
    newId: text("new_id").notNull(),
    createdAt: integer("created_at").notNull().$defaultFn(now),
  },
  (table) => [primaryKey({ columns: [table.tableName, table.legacySource, table.legacyId] })],
);

/* -------------------------------------------------------------------------- */
/* relations (for drizzle query API)                                          */
/* -------------------------------------------------------------------------- */

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  oauthAccounts: many(oauthAccounts),
  memberships: many(householdMembers),
  passwordResetTokens: many(passwordResetTokens),
  emailVerificationTokens: many(emailVerificationTokens),
}));

export const passwordResetTokensRelations = relations(passwordResetTokens, ({ one }) => ({
  user: one(users, { fields: [passwordResetTokens.userId], references: [users.id] }),
}));

export const emailVerificationTokensRelations = relations(emailVerificationTokens, ({ one }) => ({
  user: one(users, { fields: [emailVerificationTokens.userId], references: [users.id] }),
}));

export const householdsRelations = relations(households, ({ many, one }) => ({
  members: many(householdMembers),
  invites: many(householdInvites),
  modules: many(householdModules),
  creator: one(users, { fields: [households.createdBy], references: [users.id] }),
}));

export const householdMembersRelations = relations(householdMembers, ({ one }) => ({
  household: one(households, { fields: [householdMembers.householdId], references: [households.id] }),
  user: one(users, { fields: [householdMembers.userId], references: [users.id] }),
}));

export const householdModulesRelations = relations(householdModules, ({ one }) => ({
  household: one(households, { fields: [householdModules.householdId], references: [households.id] }),
}));

/* -------------------------------------------------------------------------- */
/* row types                                                                  */
/* -------------------------------------------------------------------------- */

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type OAuthAccountRow = typeof oauthAccounts.$inferSelect;
export type NewOAuthAccountRow = typeof oauthAccounts.$inferInsert;
export type SessionRow = typeof sessions.$inferSelect;
export type NewSessionRow = typeof sessions.$inferInsert;
export type PasswordResetTokenRow = typeof passwordResetTokens.$inferSelect;
export type NewPasswordResetTokenRow = typeof passwordResetTokens.$inferInsert;
export type EmailVerificationTokenRow = typeof emailVerificationTokens.$inferSelect;
export type NewEmailVerificationTokenRow = typeof emailVerificationTokens.$inferInsert;
export type HouseholdRow = typeof households.$inferSelect;
export type NewHouseholdRow = typeof households.$inferInsert;
export type HouseholdMemberRow = typeof householdMembers.$inferSelect;
export type NewHouseholdMemberRow = typeof householdMembers.$inferInsert;
export type HouseholdInviteRow = typeof householdInvites.$inferSelect;
export type NewHouseholdInviteRow = typeof householdInvites.$inferInsert;
export type HouseholdModuleRow = typeof householdModules.$inferSelect;
export type NewHouseholdModuleRow = typeof householdModules.$inferInsert;
export type LegacyIdRow = typeof legacyIds.$inferSelect;
export type NewLegacyIdRow = typeof legacyIds.$inferInsert;
