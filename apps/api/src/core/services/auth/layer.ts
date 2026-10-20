/**
 * The auth services tier (docs/EFFECT.md E7; plan `docs/plans/e2-api-core-services.md` P3): `Layer.mergeAll(
 * EmailVerification.layer, PasswordReset.layer, OAuthProviders.layer, OAuthAccounts.layer)`. No sibling dependencies:
 * all four stand on the base tier (`Database`, `Users`, `Sessions`, `Passwords`) and the infrastructure
 * (`AppConfig`), whose requirements travel outward to `coreServicesLayer()` and `src/runtime.ts`.
 *
 * Import cycle (CLAUDE.md "API import cycle"): a hoisted function only; nothing runs at import.
 */
import { Layer } from "effect";
import { OAuthProviders } from "../../../lib/oauth.ts";
import { EmailVerification } from "./emailVerification.ts";
import { OAuthAccounts } from "./oauthAccounts.ts";
import { PasswordReset } from "./passwordReset.ts";

/** Every service `authServicesLayer()` provides. */
export type AuthServices = EmailVerification | PasswordReset | OAuthProviders | OAuthAccounts;

export function authServicesLayer() {
  return Layer.mergeAll(EmailVerification.layer, PasswordReset.layer, OAuthProviders.layer, OAuthAccounts.layer);
}
