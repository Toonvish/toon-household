import { Schema, type Types } from "effect";
import { IdSchema, MailDeliverySchema } from "./common.ts";
import { HouseholdWithRoleSchema } from "./household.ts";
import { UserSchema } from "./user.ts";

/** Returned by register + login. The session cookie is set by the response headers. */
export const AuthSessionResponseSchema = Schema.Struct({
  user: UserSchema,
  households: Schema.Array(HouseholdWithRoleSchema),
  activeHouseholdId: Schema.optional(Schema.NullOr(IdSchema)),
});
export type AuthSessionResponse = Types.DeepMutable<typeof AuthSessionResponseSchema.Type>;

/** GET /api/auth/me — identical payload, so the web app has one bootstrap shape. */
export const MeResponseSchema = AuthSessionResponseSchema;
export type MeResponse = Types.DeepMutable<typeof MeResponseSchema.Type>;

/**
 * POST /api/auth/email/verify/request.
 *
 * It used to answer 204, which left the UI no choice but to claim "E-Mail
 * unterwegs" for a send that never left the machine. Reporting the outcome is safe
 * HERE — unlike `POST /password/forgot` — because the endpoint needs a session and
 * only ever mails the session's OWN address, so the answer reveals nothing about
 * whether some other address has an account. Do not copy this onto the reset flow.
 */
export const EmailVerificationRequestResponseSchema = Schema.Struct({
  mailDelivery: MailDeliverySchema,
});
export type EmailVerificationRequestResponse = Types.DeepMutable<typeof EmailVerificationRequestResponseSchema.Type>;
