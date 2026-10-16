import { Schema, type Types } from "effect";
import { LOCALES } from "../i18n/locale.ts";
import { Bool, Email, Enum, Str, keyed, lowercase, maxLength, minLength, trim } from "./checks.ts";
import { IdSchema, IsoDateSchema } from "./common.ts";

/** OAuth providers wired up in this app. */
export const OAUTH_PROVIDERS = ["google", "github"] as const;
export const OAuthProviderSchema = Enum(OAUTH_PROVIDERS);
export type OAuthProvider = Types.DeepMutable<typeof OAuthProviderSchema.Type>;

export const PasswordSchema = Str.check(minLength(8), maxLength(200));

/** Trims + lowercases BEFORE validating, so " Foo@Bar.DE " is accepted. */
export const EmailSchema = Str.check(maxLength(254)).pipe(trim, lowercase, Schema.decodeTo(Email));

/**
 * No control characters (`\p{Cc}`: line breaks, tabs, NUL, …) in a display or household
 * name (toon-finance 1715207): a `\n` in a household name would otherwise travel into the
 * invite mail's Subject and be refused by the SMTP header guard — a user-triggerable
 * delivery failure.
 */
const NO_CONTROL_CHARS = /^[^\p{Cc}]*$/u;

/** True when `value` contains no control character (see NO_CONTROL_CHARS). */
export function hasNoControlChars(value: string): boolean {
  return NO_CONTROL_CHARS.test(value);
}

/** Display names: 1–80 chars after trimming, no control characters. */
export const DisplayNameSchema = Str.pipe(trim).check(
  minLength(1),
  maxLength(80),
  keyed(hasNoControlChars, "server.validation.noControlChars"),
);

/**
 * Household names: the same rules as a display name (1–80 chars, no control characters).
 * Used by register's `householdName` and by the create/update household requests.
 */
export const HouseholdNameSchema = DisplayNameSchema;

/** The full user record as the API exposes it to the user themself. */
export const UserSchema = Schema.Struct({
  id: IdSchema,
  email: Str,
  name: Str,
  avatarUrl: Schema.optional(Schema.NullOr(Str)),
  emailVerified: Bool,
  /**
   * WHEN the address was proved — either by a confirmation click
   * (`POST /api/auth/email/verify/confirm`) or by an OAuth provider that reported
   * it as verified. Null while `emailVerified` is false. This timestamp, never the
   * boolean alone, is what a future OAuth auto-link may be gated on.
   */
  emailVerifiedAt: Schema.optional(Schema.NullOr(IsoDateSchema)),
  /** false when the account was created via OAuth only. */
  hasPassword: Bool,
  /** Last household the user had active; the web app restores it after login. */
  activeHouseholdId: Schema.optional(Schema.NullOr(IdSchema)),
  /**
   * The account's INTERFACE locale (never `recipes.language`, the CONTENT
   * axis). Nullable: null means "never chosen", which is what lets a
   * deployment's `DEFAULT_LOCALE` win for an install that changed its
   * default. Mirrors the device preference only because mail is delivered
   * outside any browser (docs/i18n.md §6).
   */
  locale: Schema.optional(Schema.NullOr(Enum(LOCALES))),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
});
export type User = Types.DeepMutable<typeof UserSchema.Type>;

/**
 * A user as seen by other members of the same household. Never returned to
 * non-members, which is why the e-mail may be included.
 */
export const PublicUserSchema = Schema.Struct({
  id: IdSchema,
  name: Str,
  /** `null` for a placeholder member: a person without an account (ADR 0006). */
  email: Schema.NullOr(Str),
  avatarUrl: Schema.optional(Schema.NullOr(Str)),
});
export type PublicUser = Types.DeepMutable<typeof PublicUserSchema.Type>;

/** A login session. `id` is the opaque cookie value; it is never returned in listings. */
export const SessionSchema = Schema.Struct({
  id: Str,
  userId: IdSchema,
  expiresAt: IsoDateSchema,
  createdAt: IsoDateSchema,
  lastUsedAt: IsoDateSchema,
  ipAddress: Schema.optional(Schema.NullOr(Str)),
  userAgent: Schema.optional(Schema.NullOr(Str)),
});
export type Session = Types.DeepMutable<typeof SessionSchema.Type>;

/** Session listing entry — id is a stable public handle, not the cookie value. */
export const SessionInfoSchema = Schema.Struct({
  id: Str,
  current: Bool,
  createdAt: IsoDateSchema,
  lastUsedAt: IsoDateSchema,
  expiresAt: IsoDateSchema,
  ipAddress: Schema.optional(Schema.NullOr(Str)),
  userAgent: Schema.optional(Schema.NullOr(Str)),
});
export type SessionInfo = Types.DeepMutable<typeof SessionInfoSchema.Type>;

export const SessionListResponseSchema = Schema.Struct({ items: Schema.Array(SessionInfoSchema) });
export type SessionListResponse = Types.DeepMutable<typeof SessionListResponseSchema.Type>;

/* ------------------------------- requests -------------------------------- */

export const RegisterRequestSchema = Schema.Struct({
  email: EmailSchema,
  name: DisplayNameSchema,
  password: PasswordSchema,
  /** Optional: name of the first household created for the user (default "Meine Rezepte"). */
  householdName: Schema.optional(HouseholdNameSchema),
  /** Optional invite token: joins that household instead of creating one. */
  inviteToken: Schema.optional(Str.check(minLength(10), maxLength(200))),
});
export type RegisterRequest = Types.DeepMutable<typeof RegisterRequestSchema.Type>;

/**
 * A password as SUBMITTED for verification (login, current password): no new minimum —
 * a legacy or wrong password must still reach argon2 and fail there, indistinguishably —
 * but the same ceiling as `PasswordSchema` (toon-finance 1715207): the request body limit
 * is 20 MB, and argon2id over a multi-megabyte string on an unauthenticated endpoint is a
 * CPU-pinning primitive, not a login.
 */
const SUBMITTED_PASSWORD_MAX = 200;

export const LoginRequestSchema = Schema.Struct({
  email: EmailSchema,
  password: Str.check(minLength(1), maxLength(SUBMITTED_PASSWORD_MAX)),
});
export type LoginRequest = Types.DeepMutable<typeof LoginRequestSchema.Type>;

export const UpdateProfileRequestSchema = Schema.Struct({
  name: Schema.optional(DisplayNameSchema),
  avatarUrl: Schema.optional(Schema.NullOr(Str.check(maxLength(1000)))),
  activeHouseholdId: Schema.optional(Schema.NullOr(IdSchema)),
  /** Picking a locale mirrors the device choice onto the account (§6). */
  locale: Schema.optional(Schema.NullOr(Enum(LOCALES))),
}).check(keyed((value) => Object.keys(value).length > 0, "server.validation.noChanges"));
export type UpdateProfileRequest = Types.DeepMutable<typeof UpdateProfileRequestSchema.Type>;

export const ChangePasswordRequestSchema = Schema.Struct({
  /** Required when the account already has a password; omit for OAuth-only accounts. */
  currentPassword: Schema.optional(Str.check(minLength(1), maxLength(SUBMITTED_PASSWORD_MAX))),
  newPassword: PasswordSchema,
});
export type ChangePasswordRequest = Types.DeepMutable<typeof ChangePasswordRequestSchema.Type>;

/**
 * Opaque single-use secret from a mailed link (password reset, e-mail
 * confirmation). 32 random bytes as base64url = 43 chars; the bounds are wide
 * enough for a future format change and narrow enough to reject junk early.
 */
export const OpaqueTokenSchema = Str.pipe(trim).check(minLength(20), maxLength(200));

/**
 * POST /api/auth/password/forgot — ALWAYS answers 204, whether or not the address
 * exists. Anything else would turn this endpoint into a user-enumeration oracle.
 */
export const ForgotPasswordRequestSchema = Schema.Struct({ email: EmailSchema });
export type ForgotPasswordRequest = Types.DeepMutable<typeof ForgotPasswordRequestSchema.Type>;

/**
 * POST /api/auth/password/reset — consumes the token, sets the new password and
 * deletes EVERY session of that user. The client then signs in at /login.
 * `password` reuses {@link PasswordSchema}, so the reset rule and the register
 * rule can never drift apart.
 */
export const ResetPasswordRequestSchema = Schema.Struct({
  token: OpaqueTokenSchema,
  password: PasswordSchema,
});
export type ResetPasswordRequest = Types.DeepMutable<typeof ResetPasswordRequestSchema.Type>;

/** POST /api/auth/email/verify/confirm */
export const VerifyEmailRequestSchema = Schema.Struct({ token: OpaqueTokenSchema });
export type VerifyEmailRequest = Types.DeepMutable<typeof VerifyEmailRequestSchema.Type>;

/* ------------------------------- responses ------------------------------- */

export const UserResponseSchema = Schema.Struct({ user: UserSchema });
export type UserResponse = Types.DeepMutable<typeof UserResponseSchema.Type>;

export const OAuthStartResponseSchema = Schema.Struct({ url: Str });
export type OAuthStartResponse = Types.DeepMutable<typeof OAuthStartResponseSchema.Type>;

/**
 * One row of `GET /api/auth/oauth`.
 * `configured` says whether the deployment has client id + secret for the
 * provider (so the login screen can hide dead buttons); `linked` is only
 * meaningful with a session and says whether the current user can sign in with it.
 */
export const OAuthProviderStatusSchema = Schema.Struct({
  provider: OAuthProviderSchema,
  configured: Bool,
  linked: Bool,
  /** Address the provider reported when the link was made. */
  linkedEmail: Schema.optional(Schema.NullOr(Str)),
});
export type OAuthProviderStatus = Types.DeepMutable<typeof OAuthProviderStatusSchema.Type>;

export const OAuthProvidersResponseSchema = Schema.Struct({
  providers: Schema.Array(OAuthProviderStatusSchema),
});
export type OAuthProvidersResponse = Types.DeepMutable<typeof OAuthProvidersResponseSchema.Type>;
