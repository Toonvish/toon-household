/**
 * OWNER: auth agent — public surface of the auth services.
 *
 * Other backend agents should import the middleware from src/middleware/* and,
 * if they need a building block (e.g. invite redemption inside the households
 * router), take it from here rather than re-implementing it.
 */
export { buildAuthSession, loadUserHouseholds } from "./bootstrap.ts";
export {
  INVITE_TTL_MS,
  acceptInvite,
  findInviteByToken,
  generateInviteToken,
  loadRedeemableInvite,
  type AcceptedInvite,
} from "./invites.ts";
export {
  listOAuthAccounts,
  loginWithOAuthProfile,
  type OAuthLoginResult,
  type OAuthOutcome,
} from "./oauthAccounts.ts";
export { fakeVerifyPassword, hashPassword, verifyPassword } from "./passwords.ts";
export {
  LOGIN_RULE,
  OAUTH_RULE,
  PASSWORD_RULE,
  REGISTER_RULE,
  checkRateLimit,
  clientIp,
  enforceRateLimit,
  resetRateLimits,
  type RateLimitRule,
} from "./rateLimit.ts";
export {
  createSession,
  deleteOtherSessions,
  deleteSession,
  findSessionByHandle,
  generateSessionId,
  listSessionsForUser,
  resolveSession,
  sessionHandle,
  sweepExpiredSessions,
  type RequestFingerprint,
  type ResolvedSession,
} from "./sessions.ts";
export {
  DEFAULT_HOUSEHOLD_NAME,
  createOwnedHousehold,
  createUser,
  displayNameFromEmail,
  findUserByEmail,
  findUserById,
  isUniqueViolation,
  setActiveHousehold,
  toUserDto,
  updateUser,
  type CreateUserInput,
} from "./users.ts";
export {
  isVerifiedEmailRequired,
  setVerifiedEmailRequired,
  hasVerifiedEmail,
  assertEmailVerified,
  type VerifiableUser,
} from "./verifiedEmail.ts";
