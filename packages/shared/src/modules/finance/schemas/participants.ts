import { Schema, type Types } from "effect";
import { IdSchema, IsoDateSchema } from "../../../core/schemas/common.ts";
import { Bool, Str, itemsExactly, keyed, maxLength, minLength, trim } from "../../../core/schemas/checks.ts";
import { MemberSlotSchema } from "./common.ts";

/**
 * Finance participants (M3 decision 4, D3): the two household members who keep
 * the household budget, seated in slot 1 and slot 2. Replaces F's
 * `household_members` contract (`MemberResponse`), same shape, renamed.
 *
 * Distinctness and membership are service checks (F gotcha 48), never
 * refinements: a Zod `.refine()` cannot carry its own error code.
 */

/**
 * F `DisplayNameSchema` at 1715207: trimmed, 1–80 characters, no control
 * characters (a `\n` in a name would reach a mail Subject).
 */
const NO_CONTROL_CHARS = /^[^\p{Cc}]*$/u;
export const FinanceDisplayNameSchema = Str.pipe(trim).check(
  minLength(1),
  maxLength(80),
  keyed((value: string) => NO_CONTROL_CHARS.test(value), "server.validation.noControlChars"),
);

/** GET …/finance/participants: one row per seat, ordered by slot. */
export const FinanceParticipantResponseSchema = Schema.Struct({
  userId: IdSchema,
  memberSlot: MemberSlotSchema,
  displayName: Str,
  name: Str,
  /** `null` for a placeholder: there is no account behind this seat (yet) (ADR 0006). */
  email: Schema.NullOr(Str),
  /** `false` for a placeholder member (core `isPlaceholderUser`, ADR 0006). */
  hasAccount: Bool,
  joinedAt: IsoDateSchema,
});
export type FinanceParticipantResponse = Types.DeepMutable<typeof FinanceParticipantResponseSchema.Type>;

/** `viewerSlot` is the caller's seat, or null for a household member who is not a participant. */
export const FinanceParticipantListResponseSchema = Schema.Struct({
  items: Schema.Array(FinanceParticipantResponseSchema),
  viewerSlot: Schema.NullOr(MemberSlotSchema),
});
export type FinanceParticipantListResponse = Types.DeepMutable<typeof FinanceParticipantListResponseSchema.Type>;

/** Exactly two entries; slots {1, 2} and distinct users are checked by the service, not here. */
export const FinanceParticipantAssignmentSchema = Schema.Array(
  Schema.Struct({ userId: IdSchema, memberSlot: MemberSlotSchema }),
).check(itemsExactly(2));
export type FinanceParticipantAssignment = Types.DeepMutable<typeof FinanceParticipantAssignmentSchema.Type>;

/** PUT …/finance/participants */
export const UpdateFinanceParticipantsRequestSchema = Schema.Struct({
  participants: FinanceParticipantAssignmentSchema,
});
export type UpdateFinanceParticipantsRequest = Types.DeepMutable<typeof UpdateFinanceParticipantsRequestSchema.Type>;

/** The `settings` body of POST …/modules/finance (core `household_modules.settings`). */
export const FinanceEnableSettingsSchema = UpdateFinanceParticipantsRequestSchema;
export type FinanceEnableSettings = Types.DeepMutable<typeof FinanceEnableSettingsSchema.Type>;

/** PATCH …/finance/participants/me */
export const UpdateFinanceDisplayNameRequestSchema = Schema.Struct({
  displayName: FinanceDisplayNameSchema,
});
export type UpdateFinanceDisplayNameRequest = Types.DeepMutable<typeof UpdateFinanceDisplayNameRequestSchema.Type>;
