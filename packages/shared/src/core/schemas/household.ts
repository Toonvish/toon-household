import { Effect, Schema, type Types } from "effect";
import { Bool, Enum, Int, Str, UnknownRecord, keyed, maxLength, minLength, nonnegative, trim } from "./checks.ts";
import { IdSchema, IsoDateSchema, MailDeliverySchema, listResponse } from "./common.ts";
import { DisplayNameSchema, EmailSchema, HouseholdNameSchema, PublicUserSchema } from "./user.ts";

/**
 * Household DTOs: R's GroupSchema family renamed (SPEC D1).
 */

/** owner > admin > member. Exactly one owner per household at any time. */
export const HouseholdRoleSchema = Enum(["owner", "admin", "member"]);
export type HouseholdRole = Types.DeepMutable<typeof HouseholdRoleSchema.Type>;

/** Roles that can be handed out in an invite (never "owner"). */
export const InvitableRoleSchema = Enum(["admin", "member"]);
export type InvitableRole = Types.DeepMutable<typeof InvitableRoleSchema.Type>;

export const ROLE_RANK: Record<HouseholdRole, number> = { member: 1, admin: 2, owner: 3 };

/** True when `role` satisfies `required` (owner satisfies admin, etc.). */
export function roleAtLeast(role: HouseholdRole, required: HouseholdRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[required];
}

export const HouseholdSchema = Schema.Struct({
  id: IdSchema,
  name: Str,
  description: Schema.optional(Schema.NullOr(Str)),
  imageUrl: Schema.optional(Schema.NullOr(Str)),
  createdBy: IdSchema,
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
});
export type Household = Types.DeepMutable<typeof HouseholdSchema.Type>;

/** A household plus the calling user's relationship to it — what the switcher renders. */
export const HouseholdWithRoleSchema = Schema.Struct({
  ...HouseholdSchema.fields,
  role: HouseholdRoleSchema,
  memberCount: Int.check(nonnegative()),
  /**
   * `modules`: ids of the household's enabled modules this codebase knows (MODULE_IDS order).
   * Strings, not ModuleId, so an old client tolerates a newer server; the web treats an id
   * without a WebModule as disabled (SPEC §2). The core never counts a module's rows.
   */
  modules: Schema.Array(Str),
});
export type HouseholdWithRole = Types.DeepMutable<typeof HouseholdWithRoleSchema.Type>;

export const HouseholdMemberSchema = Schema.Struct({
  id: IdSchema,
  householdId: IdSchema,
  userId: IdSchema,
  role: HouseholdRoleSchema,
  createdAt: IsoDateSchema,
  user: PublicUserSchema,
  /**
   * `false` for a PLACEHOLDER member (ADR 0006): a person added by name, without e-mail or
   * password, who cannot sign in until a claim invite is redeemed by registration.
   */
  hasAccount: Bool,
});
export type HouseholdMember = Types.DeepMutable<typeof HouseholdMemberSchema.Type>;

export const InviteStatusSchema = Enum(["pending", "accepted", "revoked", "expired"]);
export type InviteStatus = Types.DeepMutable<typeof InviteStatusSchema.Type>;

export const HouseholdInviteSchema = Schema.Struct({
  id: IdSchema,
  householdId: IdSchema,
  /** `null` for a claim invite created without an address (ADR 0006). */
  email: Schema.NullOr(Str),
  role: InvitableRoleSchema,
  /** Shareable token; only ever returned to admins/owners of the household. */
  token: Str,
  status: InviteStatusSchema,
  invitedBy: IdSchema,
  invitedByName: Str,
  expiresAt: IsoDateSchema,
  createdAt: IsoDateSchema,
  acceptedAt: Schema.optional(Schema.NullOr(IsoDateSchema)),
  /**
   * Set on a CLAIM invite: the placeholder member this link turns into an account (redeemed
   * only by registration, ADR 0006). `null` for a plain invite.
   */
  claimsUserId: Schema.NullOr(IdSchema),
});
export type HouseholdInvite = Types.DeepMutable<typeof HouseholdInviteSchema.Type>;

/* ------------------------------- requests -------------------------------- */

export const CreateHouseholdRequestSchema = Schema.Struct({
  /** 1–80 chars, no control characters (toon-finance 1715207; see `HouseholdNameSchema`). */
  name: HouseholdNameSchema,
  description: Schema.optional(Str.pipe(trim).check(maxLength(500))),
});
export type CreateHouseholdRequest = Types.DeepMutable<typeof CreateHouseholdRequestSchema.Type>;

export const UpdateHouseholdRequestSchema = Schema.Struct({
  name: Schema.optional(HouseholdNameSchema),
  description: Schema.optional(Schema.NullOr(Str.pipe(trim).check(maxLength(500)))),
  imageUrl: Schema.optional(Schema.NullOr(Str.check(maxLength(1000)))),
}).check(keyed((value) => Object.keys(value).length > 0, "server.validation.noChanges"));
export type UpdateHouseholdRequest = Types.DeepMutable<typeof UpdateHouseholdRequestSchema.Type>;

/**
 * `POST /api/households/:householdId/invites` (admin+). A plain invite needs `email`. A CLAIM
 * invite names a placeholder member in `claimsUserId` (ADR 0006, plan m3b decision 4): its
 * `email` is optional (the link is only mailed when one is given) and its role is always
 * `member`, whatever `role` says. Hence `email` is required unless `claimsUserId` is present.
 */
export const CreateInviteRequestSchema = Schema.Struct({
  email: Schema.optional(EmailSchema),
  role: InvitableRoleSchema.pipe(Schema.withDecodingDefault(Effect.succeed("member" as const))),
  claimsUserId: Schema.optional(IdSchema),
}).check(
  keyed(
    (value) => value.email !== undefined || value.claimsUserId !== undefined,
    "server.zod.field.email.invalid_format",
    { path: ["email"] },
  ),
);
export type CreateInviteRequest = Types.DeepMutable<typeof CreateInviteRequestSchema.Type>;

/**
 * `POST /api/households/:householdId/members` (admin+): adds a PLACEHOLDER member, a person
 * without an account, by display name (ADR 0006; toon-finance's request name).
 */
export const CreatePlaceholderMemberRequestSchema = Schema.Struct({ displayName: DisplayNameSchema });
export type CreatePlaceholderMemberRequest = Types.DeepMutable<typeof CreatePlaceholderMemberRequestSchema.Type>;

/** `PATCH /api/households/:householdId/members/:userId/placeholder` (admin+): renames a placeholder. */
export const UpdatePlaceholderMemberRequestSchema = Schema.Struct({ name: DisplayNameSchema });
export type UpdatePlaceholderMemberRequest = Types.DeepMutable<typeof UpdatePlaceholderMemberRequestSchema.Type>;

export const UpdateMemberRoleRequestSchema = Schema.Struct({
  role: HouseholdRoleSchema,
});
export type UpdateMemberRoleRequest = Types.DeepMutable<typeof UpdateMemberRoleRequestSchema.Type>;

export const AcceptInviteRequestSchema = Schema.Struct({
  token: Str.check(minLength(10), maxLength(200)),
});
export type AcceptInviteRequest = Types.DeepMutable<typeof AcceptInviteRequestSchema.Type>;

/**
 * POST /api/households/:householdId/modules/:moduleId — body optional; settings are module-owned JSON.
 */
export const EnableModuleRequestSchema = Schema.Struct({ settings: Schema.optional(UnknownRecord) });
export type EnableModuleRequest = Types.DeepMutable<typeof EnableModuleRequestSchema.Type>;

/* ------------------------------- responses ------------------------------- */

export const HouseholdResponseSchema = Schema.Struct({ household: HouseholdWithRoleSchema });
export type HouseholdResponse = Types.DeepMutable<typeof HouseholdResponseSchema.Type>;

export const HouseholdListResponseSchema = Schema.Struct({ items: Schema.Array(HouseholdWithRoleSchema) });
export type HouseholdListResponse = Types.DeepMutable<typeof HouseholdListResponseSchema.Type>;

export const HouseholdDetailResponseSchema = Schema.Struct({
  household: HouseholdWithRoleSchema,
  members: Schema.Array(HouseholdMemberSchema),
});
export type HouseholdDetailResponse = Types.DeepMutable<typeof HouseholdDetailResponseSchema.Type>;

export const HouseholdMemberResponseSchema = Schema.Struct({ member: HouseholdMemberSchema });
export type HouseholdMemberResponse = Types.DeepMutable<typeof HouseholdMemberResponseSchema.Type>;

export const HouseholdMemberListResponseSchema = Schema.Struct({ items: Schema.Array(HouseholdMemberSchema) });
export type HouseholdMemberListResponse = Types.DeepMutable<typeof HouseholdMemberListResponseSchema.Type>;

export const HouseholdInviteResponseSchema = Schema.Struct({
  invite: HouseholdInviteSchema,
  /**
   * Ready-to-share link built from WEB_ORIGIN. THE SOURCE OF TRUTH — the invite is
   * valid because this row exists, whether or not a mail went out, so the UI always
   * shows the copyable link.
   */
  inviteUrl: Str,
  /**
   * Whether an invite e-mail really went out — i.e. `mailDelivery === "sent"`.
   *
   * Kept for older clients; new code reads `mailDelivery`, which says WHICH of the
   * two non-deliveries happened. Note this is false for an install with no
   * MAIL_TRANSPORT: the ConsoleMailer logging the link is not a delivery, and
   * reporting it as one is what made the UI promise a mail nobody would get.
   */
  emailSent: Schema.optional(Bool),
  /**
   * Why no mail arrived, when none did. Optional so an older client keeps working
   * and a newer client can treat a server that predates the field as "unknown"
   * (fall back to `emailSent`). Creating the invite succeeded either way — the
   * `inviteUrl` above is the source of truth.
   */
  mailDelivery: Schema.optional(MailDeliverySchema),
});
export type HouseholdInviteResponse = Types.DeepMutable<typeof HouseholdInviteResponseSchema.Type>;

export const HouseholdInviteListResponseSchema = listResponse(HouseholdInviteSchema);
export type HouseholdInviteListResponse = Types.DeepMutable<typeof HouseholdInviteListResponseSchema.Type>;

/** Public preview shown on the "Du wurdest eingeladen" landing page. */
export const InvitePreviewResponseSchema = Schema.Struct({
  householdName: Str,
  invitedByName: Str,
  /** `null` for a claim invite created without an address (ADR 0006). */
  email: Schema.NullOr(Str),
  role: InvitableRoleSchema,
  status: InviteStatusSchema,
  expiresAt: IsoDateSchema,
  /** Display name of the placeholder this CLAIM invite hands over; `null` for a plain invite. */
  claimsDisplayName: Schema.NullOr(Str),
});
export type InvitePreviewResponse = Types.DeepMutable<typeof InvitePreviewResponseSchema.Type>;

export const AcceptInviteResponseSchema = Schema.Struct({
  household: HouseholdWithRoleSchema,
  member: HouseholdMemberSchema,
});
export type AcceptInviteResponse = Types.DeepMutable<typeof AcceptInviteResponseSchema.Type>;
