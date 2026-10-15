import { z } from "zod";
import { IdSchema, IsoDateSchema } from "../../../core/schemas/common.ts";
import { MemberSlotSchema } from "./common.ts";

/**
 * Finance participants (M3 decision 4, D3): the two household members who keep
 * the household budget, seated in slot 1 and slot 2. Replaces F's
 * `household_members` contract (`MemberResponse`), same shape, renamed.
 *
 * Distinctness and membership are service checks (F gotcha 47), never
 * refinements: a Zod `.refine()` cannot carry its own error code.
 */

/** F `DisplayNameSchema`: trimmed, 1–80 characters. */
export const FinanceDisplayNameSchema = z.string().trim().min(1).max(80);

/** GET …/finance/participants: one row per seat, ordered by slot. */
export const FinanceParticipantResponseSchema = z.object({
  userId: IdSchema,
  memberSlot: MemberSlotSchema,
  displayName: z.string(),
  name: z.string(),
  /** `null` for a placeholder: there is no account behind this seat (yet) (ADR 0006). */
  email: z.string().nullable(),
  /** `false` for a placeholder member (core `isPlaceholderUser`, ADR 0006). */
  hasAccount: z.boolean(),
  joinedAt: IsoDateSchema,
});
export type FinanceParticipantResponse = z.infer<typeof FinanceParticipantResponseSchema>;

/** `viewerSlot` is the caller's seat, or null for a household member who is not a participant. */
export const FinanceParticipantListResponseSchema = z.object({
  items: z.array(FinanceParticipantResponseSchema),
  viewerSlot: MemberSlotSchema.nullable(),
});
export type FinanceParticipantListResponse = z.infer<typeof FinanceParticipantListResponseSchema>;

/** Exactly two entries; slots {1, 2} and distinct users are checked by the service, not here. */
export const FinanceParticipantAssignmentSchema = z
  .array(z.object({ userId: IdSchema, memberSlot: MemberSlotSchema }))
  .length(2);
export type FinanceParticipantAssignment = z.infer<typeof FinanceParticipantAssignmentSchema>;

/** PUT …/finance/participants */
export const UpdateFinanceParticipantsRequestSchema = z.object({
  participants: FinanceParticipantAssignmentSchema,
});
export type UpdateFinanceParticipantsRequest = z.infer<typeof UpdateFinanceParticipantsRequestSchema>;

/** The `settings` body of POST …/modules/finance (core `household_modules.settings`). */
export const FinanceEnableSettingsSchema = UpdateFinanceParticipantsRequestSchema;
export type FinanceEnableSettings = z.infer<typeof FinanceEnableSettingsSchema>;

/** PATCH …/finance/participants/me */
export const UpdateFinanceDisplayNameRequestSchema = z.object({
  displayName: FinanceDisplayNameSchema,
});
export type UpdateFinanceDisplayNameRequest = z.infer<typeof UpdateFinanceDisplayNameRequestSchema>;
