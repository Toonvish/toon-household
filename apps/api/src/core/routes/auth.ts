/**
 * OWNER: auth agent.
 *
 * Mounted at /api/auth (see src/index.ts). Handles email+password registration
 * and login, Bun.password (argon2id) hashing, opaque DB sessions with a 30-day
 * sliding cookie, and OAuth (Google + GitHub) via `arctic`.
 *
 * Endpoint contract: docs/API.md (section "Auth"). Request/response schemas come
 * from @toon/shared — do not invent new shapes here.
 * IMPORTANT: this file's agent also owns src/middleware/session.ts
 * (requireSession / optionalSession) and src/middleware/household.ts
 * (requireHouseholdRole); both are consumed by the other routers.
 */
import {
  type AuthSessionResponse,
  ChangePasswordRequestSchema,
  type EmailVerificationRequestResponse,
  ForgotPasswordRequestSchema,
  LoginRequestSchema,
  type MailDelivery,
  type MeResponse,
  type OAuthProvidersResponse,
  OAuthProviderSchema,
  RegisterRequestSchema,
  ResetPasswordRequestSchema,
  type SessionListResponse,
  UpdateProfileRequestSchema,
  type UserResponse,
  VerifyEmailRequestSchema,
  isLocale,
  serverText,
} from "@toon/shared";
import { Hono } from "hono";
import type { z } from "zod";
import { db } from "../../db/client.ts";
import type { UserRow } from "../../db/schema.ts";
import { env } from "../../env.ts";
import {
  clearOAuthCookies,
  clearSessionCookie,
  readOAuthCookies,
  setOAuthCookies,
  setSessionCookie,
} from "../../lib/cookies.ts";
import { ApiError } from "../../lib/errors.ts";
import { created, json, noContent } from "../../lib/http.ts";
import { requestLocale } from "../../lib/locale.ts";
import {
  type OAuthProvider,
  createAuthorization,
  exchangeCodeForProfile,
  isProviderConfigured,
  requireProviderConfigured,
  safeNextPath,
  webUrl,
} from "../../lib/oauth.ts";
import { type AppContext, type AppEnv, requireUser } from "../../lib/types.ts";
import { normalizeStoredUploadUrl } from "../../lib/uploadUrls.ts";
import { resolveMembership } from "../../middleware/household.ts";
import { optionalSession, requireSession } from "../../middleware/session.ts";
import { buildAuthSession } from "../services/auth/bootstrap.ts";
import {
  EMAIL_VERIFICATION_TTL_HOURS,
  confirmEmailVerification,
  createEmailVerificationToken,
} from "../services/auth/emailVerification.ts";
import { acceptInvite, claimInvite, loadRedeemableInvite } from "../services/auth/invites.ts";
import {
  linkOAuthAccount,
  listOAuthAccounts,
  loginWithOAuthProfile,
  unlinkOAuthAccount,
} from "../services/auth/oauthAccounts.ts";
import {
  PASSWORD_RESET_TTL_MINUTES,
  consumePasswordReset,
  createPasswordResetToken,
} from "../services/auth/passwordReset.ts";
import { hashPassword, verifyPassword } from "../services/auth/passwords.ts";
import {
  EMAIL_VERIFY_RULE,
  FORGOT_PASSWORD_EMAIL_RULE,
  FORGOT_PASSWORD_RULE,
  LOGIN_EMAIL_RULE,
  LOGIN_RULE,
  OAUTH_RULE,
  PASSWORD_RESET_RULE,
  PASSWORD_RULE,
  REGISTER_RULE,
  clientIp,
  enforceRateLimit,
} from "../services/auth/rateLimit.ts";
import {
  mailDeliveryOf,
  passwordResetMail,
  trySendMail,
  verifyEmailMail,
} from "../services/mail/index.ts";
import {
  createSession,
  deleteOtherSessions,
  deleteSession,
  findSessionByHandle,
  listSessionsForUser,
} from "../services/auth/sessions.ts";
import {
  DEFAULT_HOUSEHOLD_NAME,
  createOwnedHousehold,
  createUser,
  findUserByEmail,
  findUserById,
  requireAccountEmail,
  setActiveHousehold,
  updateUser,
} from "../services/auth/users.ts";

export const authRoutes = new Hono<AppEnv>();

/* ------------------------------- helpers --------------------------------- */

/**
 * Parses + validates a JSON body. A malformed body is 400, a ZodError becomes 422
 * `validation_failed` — and a body that does not DECLARE itself JSON is 400 too:
 * `Request.json()` happily parses a `text/plain` form post, which is exactly the body
 * an HTML form on a foreign page can send with the cookie attached. Requiring the
 * content type is what `zValidator("json", …)` does for every other router; this
 * helper must not be the one exception (toon-finance gotcha 66, 1715207; the other
 * half of the CSRF defence is middleware/originGuard.ts).
 */
async function readJson<S extends z.ZodType>(c: AppContext, schema: S): Promise<z.output<S>> {
  const contentType = c.req.header("content-type") ?? "";
  if (!/^application\/json\b/i.test(contentType.trim())) {
    throw ApiError.badRequest("server.auth.invalidJsonBody");
  }
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw ApiError.badRequest("server.auth.invalidJsonBody");
  }
  return schema.parse(raw) as z.output<S>;
}

/** What we store on a session row for the "Signed-in devices" screen. */
function fingerprint(c: AppContext): { ipAddress: string; userAgent: string | null } {
  return { ipAddress: clientIp(c), userAgent: c.req.header("user-agent") ?? null };
}

/** Creates the session row and sets the cookie. */
async function startSession(c: AppContext, userId: string): Promise<void> {
  const session = await createSession(db, userId, fingerprint(c));
  setSessionCookie(c, session.id, session.expiresAt);
}

/** Loads the row behind c.var.user and builds the bootstrap payload. */
async function authPayload(userId: string): Promise<AuthSessionResponse> {
  const row = await findUserById(db, userId);
  if (!row) throw ApiError.unauthorized();
  return buildAuthSession(db, row);
}

/** Path param -> provider, 404 for anything else. */
function readProvider(c: AppContext): OAuthProvider {
  const parsed = OAuthProviderSchema.safeParse(c.req.param("provider"));
  if (!parsed.success) throw ApiError.notFound("server.auth.unknownOauthProvider");
  return parsed.data;
}

/* ----------------------------- registration ------------------------------ */

authRoutes.post("/register", async (c) => {
  const body = await readJson(c, RegisterRequestSchema);
  enforceRateLimit(c, "register", clientIp(c), REGISTER_RULE);

  // Validate the invite BEFORE creating anything, so a bad token cannot leave a
  // user without a household behind.
  const invite = body.inviteToken ? await loadRedeemableInvite(db, body.inviteToken) : undefined;
  // A spent CLAIM link is no capability any more (toon-finance gotcha 55): 404 before anything
  // else, so a second registration onto it never reaches the account it created.
  if (invite?.claimsUserId && invite.status !== "pending") {
    throw new ApiError(404, "invite_invalid", "server.invite.invalid");
  }

  // Before the claim too: an address that already has an account never claims a placeholder.
  if (await findUserByEmail(db, body.email)) {
    throw ApiError.conflict("email_taken", "server.auth.emailTaken");
  }

  const passwordHash = await hashPassword(body.password);

  // A CLAIM invite creates no user (ADR 0006 decision 4, toon-finance b1b517d): it writes this
  // registration's credentials onto the placeholder it names, in place, so every membership,
  // seat and ledger row keeps naming the same id. Unconfirmed like any registration (D4).
  if (invite?.claimsUserId) {
    const claimedId = await claimInvite(db, invite, {
      email: body.email,
      name: body.name,
      passwordHash,
    });
    const claimed = await findUserById(db, claimedId);
    if (!claimed) throw ApiError.unauthorized();
    await sendVerificationLinkQuietly(c, claimed);
    await startSession(c, claimedId);
    return created(c, await authPayload(claimedId));
  }
  const user = await createUser(db, {
    email: body.email,
    name: body.name,
    passwordHash,
    // FALSE ON PURPOSE. There is no confirmation-mail flow, so self-registration
    // proves nothing about who owns the address. Claiming `true` here used to let
    // an attacker pre-register a victim's address and have the victim's later
    // Google/GitHub login auto-linked into the attacker's account — see the
    // header of services/auth/oauthAccounts.ts.
    emailVerified: false,
  });

  if (body.inviteToken) {
    const accepted = await acceptInvite(db, body.inviteToken, user.id);
    await setActiveHousehold(db, user.id, accepted.householdId);
  } else {
    await createOwnedHousehold(db, user.id, body.householdName ?? DEFAULT_HOUSEHOLD_NAME);
  }

  // Mail the confirmation link straight away. Without this the new account would
  // land on a read-only app (services/auth/verifiedEmail.ts) and have to go and
  // find the "resend" button on /settings to discover why — a gate has to arrive
  // with its own way out. Always attempted, never awaited for its verdict: a
  // failed send must not fail the registration, and on a ConsoleMailer install
  // the gate is off anyway, so the logged link is a convenience rather than the
  // only route in.
  await sendVerificationLinkQuietly(c, user);

  await startSession(c, user.id);
  return created(c, await authPayload(user.id));
});

/**
 * Mails an already-minted confirmation link and reports what became of it.
 *
 * Split from the minting on purpose: `/email/verify/request` must let
 * `createEmailVerificationToken`'s 409 ("already confirmed") reach the client,
 * while registration must swallow everything. Sharing the send half keeps the two
 * mails byte-identical without forcing one error policy on both.
 */
async function mailVerificationLink(user: UserRow, token: string): Promise<MailDelivery> {
  const sent = await trySendMail(
    verifyEmailMail({
      // A session user or a fresh registration always has an e-mail; a placeholder
      // (ADR 0006) has no login path, so this throws 401 only on a programming error.
      to: requireAccountEmail(user),
      name: user.name,
      verifyUrl: webUrl(`/verify-email/${token}`),
      expiresInHours: EMAIL_VERIFICATION_TTL_HOURS,
      locale: isLocale(user.locale) ? user.locale : env.defaultLocale,
    }),
  );
  return mailDeliveryOf(sent);
}

/**
 * Registration's fire-and-forget variant: mints and mails, and lets nothing
 * escape. The account exists and the session is about to be issued — a mail
 * problem must not undo either (same rule as every other send in this codebase,
 * see the trySendMail contract in services/mail/index.ts).
 */
async function sendVerificationLinkQuietly(c: AppContext, user: UserRow): Promise<void> {
  try {
    const { token } = await createEmailVerificationToken(db, user, { requestedIp: clientIp(c) });
    await mailVerificationLink(user, token);
  } catch (error) {
    // English, like every other ops line here — one language in a log is a feature.
    console.error(
      `[auth] Could not send the confirmation link: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/* -------------------------------- login ---------------------------------- */

authRoutes.post("/login", async (c) => {
  const body = await readJson(c, LoginRequestSchema);
  enforceRateLimit(c, "login", `${clientIp(c)}|${body.email}`, LOGIN_RULE);
  // Second ceiling that no forwarding header can reset — see LOGIN_EMAIL_RULE.
  enforceRateLimit(c, "login-email", body.email, LOGIN_EMAIL_RULE);

  const user = await findUserByEmail(db, body.email);
  // Always runs an argon2id verification (dummy hash for unknown accounts), so
  // the response time does not reveal whether the e-mail exists.
  const matches = await verifyPassword(body.password, user?.passwordHash ?? null);

  if (!user) throw ApiError.invalidCredentials();
  if (!user.passwordHash) {
    throw new ApiError(401, "invalid_credentials", "server.auth.noPasswordSet");
  }
  if (!matches) throw ApiError.invalidCredentials();

  await startSession(c, user.id);
  const payload: AuthSessionResponse = await authPayload(user.id);
  return json(c, payload);
});

/* -------------------------------- logout --------------------------------- */

authRoutes.post("/logout", requireSession(), async (c) => {
  const sessionId = c.get("sessionId");
  if (sessionId) await deleteSession(db, sessionId);
  clearSessionCookie(c);
  return noContent(c);
});

/* --------------------------------- me ------------------------------------ */

authRoutes.get("/me", requireSession(), async (c) => {
  const user = requireUser(c);
  const payload: MeResponse = await authPayload(user.id);
  return json(c, payload);
});

authRoutes.patch("/me", requireSession(), async (c) => {
  const user = requireUser(c);
  const body = await readJson(c, UpdateProfileRequestSchema);

  if (typeof body.activeHouseholdId === "string") {
    const access = await resolveMembership(body.activeHouseholdId, user.id);
    if (!access.membership) {
      const locale = requestLocale(c);
      throw ApiError.validationFailed(
        [
          {
            path: "activeHouseholdId",
            code: "custom",
            message: serverText(locale, "server.group.fieldNotAMember"),
            i18n: { key: "server.group.fieldNotAMember" },
          },
        ],
        "server.group.notAMember",
      );
    }
  }

  const patch: Parameters<typeof updateUser>[2] = {};
  if (body.name !== undefined) patch.name = body.name;
  // The client sends back the signed avatar URL it was served; store the bare
  // `/uploads/<file>` so the row never holds an expiring value (lib/uploadUrls.ts).
  if (body.avatarUrl !== undefined) {
    patch.avatarUrl = normalizeStoredUploadUrl(body.avatarUrl) ?? null;
  }
  if (body.activeHouseholdId !== undefined) patch.activeHouseholdId = body.activeHouseholdId ?? null;

  const row = await updateUser(db, user.id, patch);
  const session = await buildAuthSession(db, row);
  const payload: UserResponse = { user: session.user };
  return json(c, payload);
});

/* ------------------------------ password --------------------------------- */

authRoutes.post("/password", requireSession(), async (c) => {
  const user = requireUser(c);
  const body = await readJson(c, ChangePasswordRequestSchema);
  enforceRateLimit(c, "password", user.id, PASSWORD_RULE);

  const row = await findUserById(db, user.id);
  if (!row) throw ApiError.unauthorized();

  if (row.passwordHash) {
    if (!body.currentPassword) {
      throw ApiError.invalidCredentials("server.auth.currentPasswordRequired");
    }
    const matches = await verifyPassword(body.currentPassword, row.passwordHash);
    if (!matches) throw ApiError.invalidCredentials("server.auth.currentPasswordWrong");
  }

  const passwordHash = await hashPassword(body.newPassword);
  await updateUser(db, user.id, { passwordHash });
  // A password change signs every other device out.
  await deleteOtherSessions(db, user.id, c.get("sessionId"));
  return noContent(c);
});

/* --------------------------- forgot / reset ------------------------------- */

/**
 * POST /api/auth/password/forgot — mails a reset link.
 *
 * ALWAYS 204. Not "204 when it worked": the response, its status, its timing and
 * its body are identical for a known and an unknown address, because anything else
 * turns this into a "does this person have an account here?" oracle. The three
 * things that make that true:
 *
 *  - the rate limit is enforced BEFORE the lookup, so a limited request and an
 *    unknown address are indistinguishable,
 *  - a missing account simply skips the send,
 *  - a failed send is swallowed by `trySendMail` and never becomes a 5xx.
 *
 * With no MAIL_TRANSPORT configured the ConsoleMailer logs the link, so a
 * self-hosted install without mail is served by `bun run auth:reset-password`
 * (apps/api/scripts/reset-password.ts) instead — same tokens, same endpoint.
 */
authRoutes.post("/password/forgot", async (c) => {
  const body = await readJson(c, ForgotPasswordRequestSchema);
  enforceRateLimit(c, "password-forgot", clientIp(c), FORGOT_PASSWORD_RULE);
  enforceRateLimit(c, "password-forgot-email", body.email, FORGOT_PASSWORD_EMAIL_RULE);

  const user = await findUserByEmail(db, body.email);
  // A lookup by e-mail never finds a placeholder (its e-mail is NULL, ADR 0006); the
  // explicit `email !== null` keeps the narrowing visible and the answer uniform.
  if (user && user.email !== null) {
    // An OAuth-only account has no password to reset. Sending the link anyway
    // would be a dead end; not sending it keeps the answer uniform.
    const { token } = await createPasswordResetToken(db, user.id, { requestedIp: clientIp(c) });
    await trySendMail(
      passwordResetMail({
        to: user.email,
        name: user.name,
        resetUrl: webUrl(`/reset-password/${token}`),
        expiresInMinutes: PASSWORD_RESET_TTL_MINUTES,
        locale: isLocale(user.locale) ? user.locale : env.defaultLocale,
      }),
    );
  }

  return noContent(c);
});

/**
 * POST /api/auth/password/reset — spends the token and sets the new password.
 *
 * Answers 204 and does NOT sign the user in: every session of that user is
 * deleted (the whole point — a stolen cookie must not survive a reset), and the
 * web app sends them to `/login` to prove they know the new password. See
 * docs/API.md.
 */
authRoutes.post("/password/reset", async (c) => {
  const body = await readJson(c, ResetPasswordRequestSchema);
  enforceRateLimit(c, "password-reset", clientIp(c), PASSWORD_RESET_RULE);

  await consumePasswordReset(db, body.token, body.password);
  // The caller had no session, and every existing one was just revoked, so there
  // is nothing to clear — but be explicit in case a stale cookie is present.
  clearSessionCookie(c);
  return noContent(c);
});

/* --------------------------- e-mail verification -------------------------- */

/**
 * POST /api/auth/email/verify/request — mails a confirmation link to the address
 * of the CURRENT session's account. Authenticated on purpose: an unauthenticated
 * variant would be another enumeration oracle, and there is no reason to need one.
 *
 * 409 when the address is already confirmed.
 *
 * Answers 200 `{ mailDelivery }` rather than the 204 it used to: the send can fail
 * (or be a ConsoleMailer log) without the request failing, and with an empty body
 * the UI had nothing to go on and said "E-Mail unterwegs" either way. Reporting it
 * is safe here and NOT on `/password/forgot` — this endpoint needs a session and
 * mails only that session's own address, so the answer says nothing about whether
 * any other address has an account. Keep that asymmetry.
 */
authRoutes.post("/email/verify/request", requireSession(), async (c) => {
  const user = requireUser(c);
  enforceRateLimit(c, "email-verify", user.id, EMAIL_VERIFY_RULE);

  const row = await findUserById(db, user.id);
  if (!row) throw ApiError.unauthorized();

  const { token } = await createEmailVerificationToken(db, row, { requestedIp: clientIp(c) });
  // The token is stored either way — a failed mail must not invalidate a link the
  // operator can still fish out of the log.
  const mailDelivery = await mailVerificationLink(row, token);
  return json(c, { mailDelivery } satisfies EmailVerificationRequestResponse);
});

/**
 * POST /api/auth/email/verify/confirm — spends the token and sets
 * `users.email_verified_at`.
 *
 * Deliberately usable WITHOUT a session: the link is often opened on a different
 * device than the one that is signed in. The token is the authorisation.
 *
 * NOTE FOR WHOEVER TOUCHES OAUTH NEXT: a confirmed address still does NOT enable
 * auto-linking. `loginWithOAuthProfile()` answers 409 `email_taken` for a taken
 * address by design; the takeover this prevents is described in
 * services/auth/oauthAccounts.ts. This timestamp is the flag such a feature would
 * have to be gated on — it is not a switch that turns it on.
 */
authRoutes.post("/email/verify/confirm", optionalSession(), async (c) => {
  const body = await readJson(c, VerifyEmailRequestSchema);
  enforceRateLimit(c, "email-verify-confirm", clientIp(c), EMAIL_VERIFY_RULE);

  const { user } = await confirmEmailVerification(db, body.token);
  const payload: UserResponse = { user: (await buildAuthSession(db, user)).user };
  return json(c, payload);
});

/* ------------------------------- sessions -------------------------------- */

authRoutes.get("/sessions", requireSession(), async (c) => {
  const user = requireUser(c);
  const items = await listSessionsForUser(db, user.id, c.get("sessionId"));
  const payload: SessionListResponse = { items };
  return json(c, payload);
});

authRoutes.delete("/sessions/:sessionId", requireSession(), async (c) => {
  const user = requireUser(c);
  const target = await findSessionByHandle(db, user.id, c.req.param("sessionId"));
  if (!target) throw ApiError.notFound("server.auth.sessionNotFound");

  await deleteSession(db, target.id);
  if (target.id === c.get("sessionId")) clearSessionCookie(c);
  return noContent(c);
});

/* --------------------------------- OAuth --------------------------------- */

/**
 * GET /api/auth/oauth — which providers this deployment can actually use, plus
 * (with a session) which of them the current user has linked. The login screen
 * hides unconfigured buttons with it, the profile screen renders the link list.
 * Additive to the contract. MUST stay registered before "/oauth/:provider".
 */
authRoutes.get("/oauth", optionalSession(), async (c) => {
  const user = c.get("user");
  const links = user ? await listOAuthAccounts(db, user.id) : [];
  const payload: OAuthProvidersResponse = {
    providers: OAuthProviderSchema.options.map((provider) => {
      const link = links.find((row) => row.provider === provider);
      return {
        provider,
        configured: isProviderConfigured(provider),
        linked: link !== undefined,
        linkedEmail: link?.providerEmail ?? null,
      };
    }),
  };
  return json(c, payload);
});

/**
 * GET /api/auth/oauth/:provider/link — starts the SAME arctic handshake as a
 * login, but for an authenticated user, and marks the flow as "link" so the
 * callback attaches the identity instead of logging somebody in. This is the only
 * way password and OAuth end up on one account (there is no auto-link on e-mail
 * match — see services/auth/oauthAccounts.ts). Additive to the contract.
 */
authRoutes.get("/oauth/:provider/link", requireSession(), async (c) => {
  const provider = readProvider(c);
  requireProviderConfigured(provider);

  const start = createAuthorization(provider);
  const next = safeNextPath(c.req.query("next")) ?? "/settings";
  setOAuthCookies(c, {
    state: start.state,
    codeVerifier: start.codeVerifier,
    next,
    intent: "link",
  });

  if (c.req.query("json") === "1") return json(c, { url: start.url });
  return c.redirect(start.url, 302);
});

/** DELETE /api/auth/oauth/:provider — detach a provider. Additive. */
authRoutes.delete("/oauth/:provider", requireSession(), async (c) => {
  const provider = readProvider(c);
  const user = requireUser(c);
  const row = await findUserById(db, user.id);
  if (!row) throw ApiError.unauthorized();
  await unlinkOAuthAccount(db, row, provider);
  return noContent(c);
});

authRoutes.get("/oauth/:provider", async (c) => {
  const provider = readProvider(c);

  // A browser navigation must never dead-end on raw JSON: the Google/GitHub
  // buttons are visible on a default install where OAuth is not configured, so
  // send the user back to the login screen, which already renders
  // ?error=oauth_not_configured as a German message. Only the ?json=1 form
  // (used by scripts/tests) still gets the 400.
  if (!isProviderConfigured(provider)) {
    if (c.req.query("json") === "1") requireProviderConfigured(provider);
    return c.redirect(webUrl("/login", { error: "oauth_not_configured" }), 302);
  }

  const start = createAuthorization(provider);
  const next = safeNextPath(c.req.query("next"));
  setOAuthCookies(c, { state: start.state, codeVerifier: start.codeVerifier, next });

  if (c.req.query("json") === "1") return json(c, { url: start.url });
  return c.redirect(start.url, 302);
});

authRoutes.get("/oauth/:provider/callback", optionalSession(), async (c) => {
  const provider = readProvider(c);
  // "Not configured" is a server-side problem, not a failed login: answer JSON
  // (400 oauth_not_configured) instead of bouncing the user to the web app.
  requireProviderConfigured(provider);
  enforceRateLimit(c, "oauth", clientIp(c), OAUTH_RULE);

  const cookies = readOAuthCookies(c);
  clearOAuthCookies(c);
  const next = safeNextPath(cookies.next) ?? "/";
  const linking = cookies.intent === "link";

  try {
    const providerError = c.req.query("error");
    if (providerError) {
      throw new ApiError(400, "oauth_failed", { key: "server.auth.oauthProviderAborted", values: { providerError } });
    }
    const code = c.req.query("code");
    const state = c.req.query("state");
    if (!code || !state) {
      throw new ApiError(400, "oauth_failed", "server.auth.oauthIncompleteResponse");
    }
    if (!cookies.state || state !== cookies.state) {
      throw new ApiError(400, "oauth_failed", "server.auth.oauthSessionExpired");
    }

    const profile = await exchangeCodeForProfile(provider, code, cookies.codeVerifier);

    if (linking) {
      // The session cookie survives the provider round-trip (SameSite=Lax on a
      // top-level GET); without it we cannot know whose account to extend.
      const sessionUser = c.get("user");
      if (!sessionUser) throw ApiError.unauthorized("server.auth.pleaseSignInAgain");
      await linkOAuthAccount(db, sessionUser.id, profile);
      return c.redirect(webUrl(next, { linked: provider }), 302);
    }

    const { user } = await loginWithOAuthProfile(db, profile);
    await startSession(c, user.id);
    return c.redirect(webUrl(next), 302);
  } catch (error) {
    const errorCode = error instanceof ApiError ? String(error.code) : "oauth_failed";
    if (!(error instanceof ApiError)) console.error("[auth] OAuth callback failed:", error);
    if (linking) return c.redirect(webUrl(next, { error: errorCode }), 302);
    return c.redirect(webUrl("/login", { error: errorCode }), 302);
  }
});

export default authRoutes;
