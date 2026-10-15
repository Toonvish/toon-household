import { z } from "zod";
import { LOCALES } from "../i18n/locale.ts";
import { refineKey } from "../i18n/zod.ts";
import { IdSchema, IsoDateSchema } from "./common.ts";

/** OAuth providers wired up in this app. */
export const OAuthProviderSchema = z.enum(["google", "github"]);
export type OAuthProvider = z.infer<typeof OAuthProviderSchema>;

export const PasswordSchema = z.string().min(8).max(200);

/** Trims + lowercases BEFORE validating, so " Foo@Bar.DE " is accepted. */
export const EmailSchema = z.string().max(254).trim().toLowerCase().pipe(z.email());

export const DisplayNameSchema = z.string().trim().min(1).max(80);

/** The full user record as the API exposes it to the user themself. */
export const UserSchema = z.object({
  id: IdSchema,
  email: z.string(),
  name: z.string(),
  avatarUrl: z.string().nullish(),
  emailVerified: z.boolean(),
  /**
   * WHEN the address was proved — either by a confirmation click
   * (`POST /api/auth/email/verify/confirm`) or by an OAuth provider that reported
   * it as verified. Null while `emailVerified` is false. This timestamp, never the
   * boolean alone, is what a future OAuth auto-link may be gated on.
   */
  emailVerifiedAt: IsoDateSchema.nullish(),
  /** false when the account was created via OAuth only. */
  hasPassword: z.boolean(),
  /** Last household the user had active; the web app restores it after login. */
  activeHouseholdId: IdSchema.nullish(),
  /**
   * The account's INTERFACE locale (never `recipes.language`, the CONTENT
   * axis). Nullable: null means "never chosen", which is what lets a
   * deployment's `DEFAULT_LOCALE` win for an install that changed its
   * default. Mirrors the device preference only because mail is delivered
   * outside any browser (docs/i18n.md §6).
   */
  locale: z.enum(LOCALES).nullish(),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
});
export type User = z.infer<typeof UserSchema>;

/**
 * A user as seen by other members of the same household. Never returned to
 * non-members, which is why the e-mail may be included.
 */
export const PublicUserSchema = z.object({
  id: IdSchema,
  name: z.string(),
  /** `null` for a placeholder member: a person without an account (ADR 0006). */
  email: z.string().nullable(),
  avatarUrl: z.string().nullish(),
});
export type PublicUser = z.infer<typeof PublicUserSchema>;

/** A login session. `id` is the opaque cookie value; it is never returned in listings. */
export const SessionSchema = z.object({
  id: z.string(),
  userId: IdSchema,
  expiresAt: IsoDateSchema,
  createdAt: IsoDateSchema,
  lastUsedAt: IsoDateSchema,
  ipAddress: z.string().nullish(),
  userAgent: z.string().nullish(),
});
export type Session = z.infer<typeof SessionSchema>;

/** Session listing entry — id is a stable public handle, not the cookie value. */
export const SessionInfoSchema = z.object({
  id: z.string(),
  current: z.boolean(),
  createdAt: IsoDateSchema,
  lastUsedAt: IsoDateSchema,
  expiresAt: IsoDateSchema,
  ipAddress: z.string().nullish(),
  userAgent: z.string().nullish(),
});
export type SessionInfo = z.infer<typeof SessionInfoSchema>;

export const SessionListResponseSchema = z.object({ items: z.array(SessionInfoSchema) });
export type SessionListResponse = z.infer<typeof SessionListResponseSchema>;

/* ------------------------------- requests -------------------------------- */

export const RegisterRequestSchema = z.object({
  email: EmailSchema,
  name: DisplayNameSchema,
  password: PasswordSchema,
  /** Optional: name of the first household created for the user (default "Meine Rezepte"). */
  householdName: z.string().trim().min(1).max(80).optional(),
  /** Optional invite token: joins that household instead of creating one. */
  inviteToken: z.string().min(10).max(200).optional(),
});
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const LoginRequestSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const UpdateProfileRequestSchema = z
  .object({
    name: DisplayNameSchema.optional(),
    avatarUrl: z.string().max(1000).nullish(),
    activeHouseholdId: IdSchema.nullish(),
    /** Picking a locale mirrors the device choice onto the account (§6). */
    locale: z.enum(LOCALES).nullish(),
  })
  .refine((value) => Object.keys(value).length > 0, refineKey("server.validation.noChanges"));
export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequestSchema>;

export const ChangePasswordRequestSchema = z.object({
  /** Required when the account already has a password; omit for OAuth-only accounts. */
  currentPassword: z.string().min(1).optional(),
  newPassword: PasswordSchema,
});
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;

/**
 * Opaque single-use secret from a mailed link (password reset, e-mail
 * confirmation). 32 random bytes as base64url = 43 chars; the bounds are wide
 * enough for a future format change and narrow enough to reject junk early.
 */
export const OpaqueTokenSchema = z.string().trim().min(20).max(200);

/**
 * POST /api/auth/password/forgot — ALWAYS answers 204, whether or not the address
 * exists. Anything else would turn this endpoint into a user-enumeration oracle.
 */
export const ForgotPasswordRequestSchema = z.object({ email: EmailSchema });
export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequestSchema>;

/**
 * POST /api/auth/password/reset — consumes the token, sets the new password and
 * deletes EVERY session of that user. The client then signs in at /login.
 * `password` reuses {@link PasswordSchema}, so the reset rule and the register
 * rule can never drift apart.
 */
export const ResetPasswordRequestSchema = z.object({
  token: OpaqueTokenSchema,
  password: PasswordSchema,
});
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequestSchema>;

/** POST /api/auth/email/verify/confirm */
export const VerifyEmailRequestSchema = z.object({ token: OpaqueTokenSchema });
export type VerifyEmailRequest = z.infer<typeof VerifyEmailRequestSchema>;

/* ------------------------------- responses ------------------------------- */

export const UserResponseSchema = z.object({ user: UserSchema });
export type UserResponse = z.infer<typeof UserResponseSchema>;

export const OAuthStartResponseSchema = z.object({ url: z.string() });
export type OAuthStartResponse = z.infer<typeof OAuthStartResponseSchema>;

/**
 * One row of `GET /api/auth/oauth`.
 * `configured` says whether the deployment has client id + secret for the
 * provider (so the login screen can hide dead buttons); `linked` is only
 * meaningful with a session and says whether the current user can sign in with it.
 */
export const OAuthProviderStatusSchema = z.object({
  provider: OAuthProviderSchema,
  configured: z.boolean(),
  linked: z.boolean(),
  /** Address the provider reported when the link was made. */
  linkedEmail: z.string().nullish(),
});
export type OAuthProviderStatus = z.infer<typeof OAuthProviderStatusSchema>;

export const OAuthProvidersResponseSchema = z.object({
  providers: z.array(OAuthProviderStatusSchema),
});
export type OAuthProvidersResponse = z.infer<typeof OAuthProvidersResponseSchema>;
