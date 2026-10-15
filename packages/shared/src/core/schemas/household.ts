import { z } from "zod";
import { refineKey } from "../i18n/zod.ts";
import { IdSchema, IsoDateSchema, MailDeliverySchema, listResponse } from "./common.ts";
import { DisplayNameSchema, EmailSchema, PublicUserSchema } from "./user.ts";

/**
 * Household DTOs: R's GroupSchema family renamed (SPEC D1).
 */

/** owner > admin > member. Exactly one owner per household at any time. */
export const HouseholdRoleSchema = z.enum(["owner", "admin", "member"]);
export type HouseholdRole = z.infer<typeof HouseholdRoleSchema>;

/** Roles that can be handed out in an invite (never "owner"). */
export const InvitableRoleSchema = z.enum(["admin", "member"]);
export type InvitableRole = z.infer<typeof InvitableRoleSchema>;

export const ROLE_RANK: Record<HouseholdRole, number> = { member: 1, admin: 2, owner: 3 };

/** True when `role` satisfies `required` (owner satisfies admin, etc.). */
export function roleAtLeast(role: HouseholdRole, required: HouseholdRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[required];
}

export const HouseholdSchema = z.object({
  id: IdSchema,
  name: z.string(),
  description: z.string().nullish(),
  imageUrl: z.string().nullish(),
  createdBy: IdSchema,
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
});
export type Household = z.infer<typeof HouseholdSchema>;

/** A household plus the calling user's relationship to it — what the switcher renders. */
export const HouseholdWithRoleSchema = HouseholdSchema.extend({
  role: HouseholdRoleSchema,
  memberCount: z.number().int().nonnegative(),
  /**
   * `modules`: ids of the household's enabled modules this codebase knows (MODULE_IDS order).
   * Strings, not ModuleId, so an old client tolerates a newer server; the web treats an id
   * without a WebModule as disabled (SPEC §2). The core never counts a module's rows.
   */
  modules: z.array(z.string()),
});
export type HouseholdWithRole = z.infer<typeof HouseholdWithRoleSchema>;

export const HouseholdMemberSchema = z.object({
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
  hasAccount: z.boolean(),
});
export type HouseholdMember = z.infer<typeof HouseholdMemberSchema>;

export const InviteStatusSchema = z.enum(["pending", "accepted", "revoked", "expired"]);
export type InviteStatus = z.infer<typeof InviteStatusSchema>;

export const HouseholdInviteSchema = z.object({
  id: IdSchema,
  householdId: IdSchema,
  /** `null` for a claim invite created without an address (ADR 0006). */
  email: z.string().nullable(),
  role: InvitableRoleSchema,
  /** Shareable token; only ever returned to admins/owners of the household. */
  token: z.string(),
  status: InviteStatusSchema,
  invitedBy: IdSchema,
  invitedByName: z.string(),
  expiresAt: IsoDateSchema,
  createdAt: IsoDateSchema,
  acceptedAt: IsoDateSchema.nullish(),
  /**
   * Set on a CLAIM invite: the placeholder member this link turns into an account (redeemed
   * only by registration, ADR 0006). `null` for a plain invite.
   */
  claimsUserId: IdSchema.nullable(),
});
export type HouseholdInvite = z.infer<typeof HouseholdInviteSchema>;

/* ------------------------------- requests -------------------------------- */

export const CreateHouseholdRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
});
export type CreateHouseholdRequest = z.infer<typeof CreateHouseholdRequestSchema>;

export const UpdateHouseholdRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(500).nullish(),
    imageUrl: z.string().max(1000).nullish(),
  })
  .refine((value) => Object.keys(value).length > 0, refineKey("server.validation.noChanges"));
export type UpdateHouseholdRequest = z.infer<typeof UpdateHouseholdRequestSchema>;

export const CreateInviteRequestSchema = z.object({
  email: EmailSchema,
  role: InvitableRoleSchema.default("member"),
});
export type CreateInviteRequest = z.infer<typeof CreateInviteRequestSchema>;

/**
 * `POST /api/households/:householdId/members` (admin+): adds a PLACEHOLDER member, a person
 * without an account, by display name (ADR 0006; toon-finance's request name).
 */
export const CreatePlaceholderMemberRequestSchema = z.object({ displayName: DisplayNameSchema });
export type CreatePlaceholderMemberRequest = z.infer<typeof CreatePlaceholderMemberRequestSchema>;

/** `PATCH /api/households/:householdId/members/:userId/placeholder` (admin+): renames a placeholder. */
export const UpdatePlaceholderMemberRequestSchema = z.object({ name: DisplayNameSchema });
export type UpdatePlaceholderMemberRequest = z.infer<typeof UpdatePlaceholderMemberRequestSchema>;

export const UpdateMemberRoleRequestSchema = z.object({
  role: HouseholdRoleSchema,
});
export type UpdateMemberRoleRequest = z.infer<typeof UpdateMemberRoleRequestSchema>;

export const AcceptInviteRequestSchema = z.object({
  token: z.string().min(10).max(200),
});
export type AcceptInviteRequest = z.infer<typeof AcceptInviteRequestSchema>;

/**
 * POST /api/households/:householdId/modules/:moduleId — body optional; settings are module-owned JSON.
 */
export const EnableModuleRequestSchema = z.object({ settings: z.record(z.string(), z.unknown()).optional() });
export type EnableModuleRequest = z.infer<typeof EnableModuleRequestSchema>;

/* ------------------------------- responses ------------------------------- */

export const HouseholdResponseSchema = z.object({ household: HouseholdWithRoleSchema });
export type HouseholdResponse = z.infer<typeof HouseholdResponseSchema>;

export const HouseholdListResponseSchema = z.object({ items: z.array(HouseholdWithRoleSchema) });
export type HouseholdListResponse = z.infer<typeof HouseholdListResponseSchema>;

export const HouseholdDetailResponseSchema = z.object({
  household: HouseholdWithRoleSchema,
  members: z.array(HouseholdMemberSchema),
});
export type HouseholdDetailResponse = z.infer<typeof HouseholdDetailResponseSchema>;

export const HouseholdMemberResponseSchema = z.object({ member: HouseholdMemberSchema });
export type HouseholdMemberResponse = z.infer<typeof HouseholdMemberResponseSchema>;

export const HouseholdMemberListResponseSchema = z.object({ items: z.array(HouseholdMemberSchema) });
export type HouseholdMemberListResponse = z.infer<typeof HouseholdMemberListResponseSchema>;

export const HouseholdInviteResponseSchema = z.object({
  invite: HouseholdInviteSchema,
  /**
   * Ready-to-share link built from WEB_ORIGIN. THE SOURCE OF TRUTH — the invite is
   * valid because this row exists, whether or not a mail went out, so the UI always
   * shows the copyable link.
   */
  inviteUrl: z.string(),
  /**
   * Whether an invite e-mail really went out — i.e. `mailDelivery === "sent"`.
   *
   * Kept for older clients; new code reads `mailDelivery`, which says WHICH of the
   * two non-deliveries happened. Note this is false for an install with no
   * MAIL_TRANSPORT: the ConsoleMailer logging the link is not a delivery, and
   * reporting it as one is what made the UI promise a mail nobody would get.
   */
  emailSent: z.boolean().optional(),
  /**
   * Why no mail arrived, when none did. Optional so an older client keeps working
   * and a newer client can treat a server that predates the field as "unknown"
   * (fall back to `emailSent`). Creating the invite succeeded either way — the
   * `inviteUrl` above is the source of truth.
   */
  mailDelivery: MailDeliverySchema.optional(),
});
export type HouseholdInviteResponse = z.infer<typeof HouseholdInviteResponseSchema>;

export const HouseholdInviteListResponseSchema = listResponse(HouseholdInviteSchema);
export type HouseholdInviteListResponse = z.infer<typeof HouseholdInviteListResponseSchema>;

/** Public preview shown on the "Du wurdest eingeladen" landing page. */
export const InvitePreviewResponseSchema = z.object({
  householdName: z.string(),
  invitedByName: z.string(),
  /** `null` for a claim invite created without an address (ADR 0006). */
  email: z.string().nullable(),
  role: InvitableRoleSchema,
  status: InviteStatusSchema,
  expiresAt: IsoDateSchema,
  /** Display name of the placeholder this CLAIM invite hands over; `null` for a plain invite. */
  claimsDisplayName: z.string().nullable(),
});
export type InvitePreviewResponse = z.infer<typeof InvitePreviewResponseSchema>;

export const AcceptInviteResponseSchema = z.object({
  household: HouseholdWithRoleSchema,
  member: HouseholdMemberSchema,
});
export type AcceptInviteResponse = z.infer<typeof AcceptInviteResponseSchema>;
