/**
 * The auth services tier (docs/EFFECT.md E7; plan `docs/plans/e2-api-core-services.md` P3). A stub until E2-T08:
 * then `Layer.mergeAll(EmailVerification.layer, PasswordReset.layer, OAuthProviders.layer, OAuthAccounts.layer)`
 * (no sibling dependencies: all stand on the base tier and the infrastructure).
 *
 * Import cycle (CLAUDE.md "API import cycle"): a hoisted function only; nothing runs at import.
 */
import { Layer } from "effect";

export function authServicesLayer() {
  return Layer.empty;
}
