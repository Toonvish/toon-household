import { z } from "zod";
import { IdSchema, MailDeliverySchema } from "./common.ts";
import { HouseholdWithRoleSchema } from "./household.ts";
import { UserSchema } from "./user.ts";

/** Returned by register + login. The session cookie is set by the response headers. */
export const AuthSessionResponseSchema = z.object({
  user: UserSchema,
  households: z.array(HouseholdWithRoleSchema),
  activeHouseholdId: IdSchema.nullish(),
});
export type AuthSessionResponse = z.infer<typeof AuthSessionResponseSchema>;

/** GET /api/auth/me — identical payload, so the web app has one bootstrap shape. */
export const MeResponseSchema = AuthSessionResponseSchema;
export type MeResponse = z.infer<typeof MeResponseSchema>;

/**
 * POST /api/auth/email/verify/request.
 *
 * It used to answer 204, which left the UI no choice but to claim "E-Mail
 * unterwegs" for a send that never left the machine. Reporting the outcome is safe
 * HERE — unlike `POST /password/forgot` — because the endpoint needs a session and
 * only ever mails the session's OWN address, so the answer reveals nothing about
 * whether some other address has an account. Do not copy this onto the reset flow.
 */
export const EmailVerificationRequestResponseSchema = z.object({
  mailDelivery: MailDeliverySchema,
});
export type EmailVerificationRequestResponse = z.infer<
  typeof EmailVerificationRequestResponseSchema
>;
