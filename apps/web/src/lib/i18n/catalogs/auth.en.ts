/**
 * English — namespace "auth". See `auth.de.ts` for who owns this file and what
 * it covers.
 */
import type { LocaleCatalog } from "@toon/shared";
import type { AuthCatalog } from "./auth.de.ts";

export const authEn: LocaleCatalog<AuthCatalog> = {
  /* ------------------------------ shared/common ----------------------------- */
  "auth.common.loginLink": "Sign in",
  "auth.common.backToLoginLink": "Back to sign in",
  "auth.common.signIn": "Sign in",
  "auth.common.signOut": "Sign out",
  "auth.common.somethingWentWrong": "Something went wrong",
  "auth.common.linkExpiredTitle": "Link no longer valid",
  "auth.common.emailOnTheWay": "E-mail on its way",
  "auth.field.email.label": "E-mail",
  "auth.field.email.placeholder": "you@example.com",
  "auth.field.name.label": "Name",
  "auth.field.password.label": "Password",
  "auth.field.password.placeholder": "••••••••",
  "auth.password.minLengthHint": "At least 8 characters.",
  "auth.password.new.label": "New password",

  /* ------------------------------- LoginPage.tsx ----------------------------- */
  "auth.login.title": "Welcome back",
  "auth.login.description": "Sign in to access your groups' recipes.",
  "auth.login.noAccount": "No account yet?",
  "auth.login.registerLink": "Sign up now",
  "auth.login.error.title": "Sign-in failed",
  "auth.login.resetSuccess": "Your password has been changed. Sign in once with the new password.",
  "auth.login.forgotPasswordLink": "Forgot your password?",
  "auth.login.submit": "Sign in",
  "auth.login.error.notConfigured": "This provider is not configured on the server.",
  "auth.login.error.cancelled": "The provider cancelled the sign-in. Please try again.",
  "auth.login.error.sessionExpired": "Your session has expired. Please sign in again.",
  "auth.login.error.generic": "Please try again.",

  /* ---------------------------- OAuthButtons.tsx ----------------------------- */
  "auth.oauth.signIn": "Sign in with {provider}",
  "auth.oauth.signUp": "Sign up with {provider}",
  "auth.oauth.or": "or",
  "auth.oauth.orWithEmail": "or with e-mail",

  /* --------------------------- ForgotPasswordPage.tsx ------------------------ */
  "auth.forgotPassword.sent.title": "E-mail on its way",
  "auth.forgotPassword.sent.description": "Check your inbox.",
  "auth.forgotPassword.sent.lead":
    "If there is an account with the address {email}, we've sent a link to reset the password.",
  "auth.forgotPassword.sent.hint":
    "The link is valid for one hour and can only be used once. Check your spam folder if needed.",
  "auth.forgotPassword.sent.useOther": "Use a different address",
  "auth.forgotPassword.title": "Forgot password",
  "auth.forgotPassword.description": "We'll send you a link to set a new password.",
  "auth.forgotPassword.rememberedPrompt": "Remembered your password?",
  "auth.forgotPassword.submit": "Request link",
  "auth.forgotPassword.oauthHint":
    "Sign in with Google or GitHub if that's how you created your account — then you don't need a password.",

  /* ------------------------------- InvitePage.tsx ---------------------------- */
  "auth.invite.title": "Invite",
  "auth.invite.missingToken.title": "Invalid link",
  "auth.invite.missingToken.description": "This link is missing the invite code.",
  "auth.invite.checking": "Checking invite …",
  "auth.invite.invalid.title": "Invite not valid",
  "auth.invite.invalid.description":
    "This link has expired or been withdrawn. Please ask for a new invite.",
  "auth.invite.readyTitle": "You've been invited",
  "auth.invite.invitedBy": "{name} is inviting you to “{groupName}”.",
  "auth.invite.roleAndEmail": "Role: {role} · Invite for {email}",
  "auth.invite.validUntil": "Valid until {date}",
  "auth.invite.status.accepted": "This invite has already been accepted.",
  "auth.invite.status.expired": "This invite has expired.",
  "auth.invite.status.revoked": "This invite has been withdrawn.",
  "auth.invite.join": "Join group",
  "auth.invite.registerAndJoin": "Create account and join",
  "auth.invite.haveAccount": "I already have an account",
  "auth.invite.joined.title": "Welcome!",
  "auth.invite.joined.description": "You're now a member of “{groupName}”.",
  "auth.invite.joinFailed": "Failed to join",

  /* --------------------------- OAuthCallbackPage.tsx ------------------------- */
  "auth.oauthCallback.cancelledTitle": "Sign-in cancelled",
  "auth.oauthCallback.notConfigured": "This sign-in provider is not configured on the server.",
  "auth.oauthCallback.incomplete": "The provider did not complete the sign-in. Please try again.",
  "auth.oauthCallback.slowTitle": "Sign-in is taking a while",
  "auth.oauthCallback.noSession.title": "No session found",
  "auth.oauthCallback.noSession.description":
    "Cookies may have been blocked. Please sign in again.",
  "auth.oauthCallback.inProgress.title": "Signing in",
  "auth.oauthCallback.inProgress.description": "One moment, we're setting everything up …",
  "auth.oauthCallback.checkingSession": "Checking session …",

  /* ------------------------------ RegisterPage.tsx --------------------------- */
  "auth.register.title": "Create account",
  "auth.register.descriptionInvite": "Sign up to join the group.",
  "auth.register.description": "Collect your recipes in one place – together with family and friends.",
  "auth.register.haveAccount": "Already have an account?",
  "auth.register.invitedBy": "{name} has invited you to the group {groupName}.",
  "auth.register.inviteInvalid.title": "Invite invalid",
  "auth.register.inviteInvalid.description": "You can still sign up and join later.",
  "auth.register.name.placeholder": "What should others call you?",
  "auth.register.householdName.label": "Name of your first group",
  "auth.register.householdName.placeholder": "Family",
  "auth.register.householdName.hint": "Leave empty for “My recipes”.",
  "auth.register.submit": "Create account",

  /* --------------------------- ResetPasswordPage.tsx ------------------------- */
  "auth.resetPassword.passwordInvalid": "Password invalid",
  "auth.resetPassword.passwordMismatch": "The passwords don't match",
  "auth.resetPassword.expired.description": "This link has already been used or has expired.",
  "auth.resetPassword.requestNew.action": "Request new link",
  "auth.resetPassword.requestNew.description":
    "Reset links are valid for one hour and can only be used once. Just request a new one.",
  "auth.resetPassword.title": "New password",
  "auth.resetPassword.description": "Choose a new password for your account.",
  "auth.resetPassword.repeat.label": "Repeat password",
  "auth.resetPassword.submit": "Save password",
  "auth.resetPassword.securityNote":
    "For security reasons you'll be signed out on all devices afterwards and will need to sign in again once.",

  /* ---------------------------- VerifyEmailPage.tsx -------------------------- */
  "auth.verifyEmail.checking": "Confirming e-mail address …",
  "auth.verifyEmail.failedTitle": "Confirmation failed",
  "auth.verifyEmail.expired.description":
    "Confirmation links are valid for 24 hours and can only be used once. Request a new one in settings.",
  "auth.verifyEmail.tryLater": "Please try again later.",
  "auth.verifyEmail.toSettings": "Go to settings",
  "auth.verifyEmail.success.title": "E-mail confirmed",
  "auth.verifyEmail.success.description": "Thanks — the address is now yours.",
  "auth.verifyEmail.success.hint": "You can now reset your password at any time via “Forgot password”.",
  "auth.verifyEmail.toRecipes": "Go to recipes",

  /* -------------------------- AccountSettingsPage.tsx ------------------------ */
  "auth.settings.title": "Profile",
  "auth.settings.description": "Account, groups, appearance and signed-in devices.",
  "auth.settings.save": "Save",
  "auth.settings.account.title": "Your account",
  "auth.settings.account.saved": "Profile saved",
  "auth.settings.account.nameInvalid": "Name invalid",

  "auth.settings.households.title": "Groups",
  "auth.settings.households.none": "You're not in a group yet.",
  "auth.settings.households.count": { one: "{count} group", other: "{count} groups" },
  "auth.settings.households.countWithActive": {
    one: "{count} group · active: {groupName}",
    other: "{count} groups · active: {groupName}",
  },
  "auth.settings.households.manage": "Manage groups",
  "auth.settings.households.manageHint": "Members, invites and roles",

  "auth.settings.email.title": "E-mail address",
  "auth.settings.email.readOnlyUntilConfirmed":
    "Until you confirm, you can only read along: creating recipes, importing and changing shopping lists are blocked. Accepting invitations still works.",
  "auth.settings.email.confirmedAt": "Confirmed on {date}.",
  "auth.settings.email.confirmTitle": "Confirm e-mail address",
  "auth.settings.email.notConfirmed": "Not confirmed yet.",
  "auth.settings.email.confirmHint": "Confirm {email} so you can reset your password by e-mail.",
  "auth.settings.email.resend": "Resend",
  "auth.settings.email.sendLink": "Send confirmation link",
  "auth.settings.email.sentToast.description": "We've sent a confirmation link to {email}.",
  "auth.settings.email.notSentToast.title": "No e-mail sent",
  "auth.settings.email.notConfigured":
    "No mail sending is set up on this server. The confirmation link is in the server log.",
  "auth.settings.email.deliveryFailed":
    "Delivery failed. Please try again later — details are in the server log.",
  "auth.settings.email.sendFailedTitle": "Couldn't be sent",
  "auth.settings.email.sendFailedFallback": "Please try again later.",

  "auth.settings.theme.system": "System",
  "auth.settings.theme.light": "Light",
  "auth.settings.theme.dark": "Dark",
  "auth.settings.appearance.title": "Appearance",
  "auth.settings.appearance.description": "Follows your system theme by default.",

  /* The language names are autonyms — identical in every catalog. See auth.de.ts. */
  "auth.settings.language.title": "Language",
  "auth.settings.language.description":
    "Affects the interface only. Recipes keep the language they were saved in.",
  "auth.settings.language.system": "System",
  "auth.settings.language.systemHint": "Follows your browser ({locale}).",
  "auth.settings.language.de": "Deutsch",
  "auth.settings.language.en": "English",

  "auth.settings.password.changeTitle": "Change password",
  "auth.settings.password.setTitle": "Set password",
  "auth.settings.password.oauthOnlyHint": "Your account currently only signs in via Google/GitHub.",
  "auth.settings.password.checkInputs": "Check your input",
  "auth.settings.password.updated": "Password updated",
  "auth.settings.password.current.label": "Current password",

  "auth.settings.oauth.linkedToast": "{provider} linked",
  "auth.settings.oauth.error.alreadyLinked":
    "This provider account is already linked to another user.",
  "auth.settings.oauth.error.notConfigured": "This provider is not configured on the server.",
  "auth.settings.oauth.error.generic": "Linking failed. Please try again.",
  "auth.settings.oauth.unlinked": "Link removed",
  "auth.settings.oauth.unlinkFailed": "Failed to remove link",
  "auth.settings.oauth.title": "Linked accounts",
  "auth.settings.oauth.noneConfigured": "No Google or GitHub sign-in is configured on this server.",
  "auth.settings.oauth.description": "Link a provider so you can also sign in with it in future.",
  "auth.settings.oauth.linkedFallback": "linked",
  "auth.settings.oauth.notLinked": "not linked",
  "auth.settings.oauth.setPasswordFirst": "Set a password first.",
  "auth.settings.oauth.unlink": "Unlink",
  "auth.settings.oauth.link": "Link",
  "auth.settings.oauth.unlinkConfirm.title": "Remove link?",
  "auth.settings.oauth.unlinkConfirm.description": "You won't be able to sign in via this provider afterwards.",

  "auth.settings.sessions.title": "Signed-in devices",
  "auth.settings.sessions.description": "Sessions expire automatically after 30 days of inactivity.",
  "auth.settings.sessions.unknownDevice": "Unknown device",
  "auth.settings.sessions.thisDevice": "This device",
  "auth.settings.sessions.lastActive": "Last active {relative} · signed in on {date}",
  "auth.settings.sessions.revoked": "Device signed out",
  "auth.settings.sessions.revokeFailed": "Failed to sign out",
  "auth.settings.sessions.revokeConfirm.title": "Sign out device?",
  "auth.settings.sessions.revokeConfirm.description": "The session will end immediately.",

  "auth.settings.logout.description": "Ends the session on this device.",
};
