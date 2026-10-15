/**
 * Which variant of the invite landing page applies (ADR 0006, plan m3b decision 7).
 *
 *  - `join`:            a plain invite, signed in: one tap joins the group
 *  - `register`:        a plain invite, signed out: register or sign in first
 *  - `claim-register`:  a CLAIM invite, signed out: the only way to redeem it is registering
 *  - `claim-logged-in`: a CLAIM invite, signed in: the link creates an account for someone else,
 *                       so the page asks to sign out first (it never joins the current user)
 *
 * Pure so the four cases are testable without rendering.
 */
export type InviteMode = "join" | "register" | "claim-register" | "claim-logged-in";

export interface InviteModeInput {
  /** `InvitePreviewResponse.claimsDisplayName`: the placeholder's name, `null` for a plain invite. */
  claimsDisplayName: string | null | undefined;
}

export function isClaimInvite(preview: InviteModeInput | null | undefined): boolean {
  return preview?.claimsDisplayName !== null && preview?.claimsDisplayName !== undefined;
}

export function inviteMode(preview: InviteModeInput, isLoggedIn: boolean): InviteMode {
  if (isClaimInvite(preview)) return isLoggedIn ? "claim-logged-in" : "claim-register";
  return isLoggedIn ? "join" : "register";
}
