/**
 * OWNER: auth agent.
 *
 * Served at /api/auth (see src/http/app.ts). Handles email+password registration
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
  OAUTH_PROVIDERS,
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
import { Cause, Effect, Option, Predicate, type Schema } from "effect";
import type { HttpServerRequest, HttpServerResponse } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import type { UserRow } from "../../db/schema.ts";
import { env } from "../../env.ts";
import { CurrentSession, CurrentUser, MaybeSession } from "../../http/context.ts";
import {
  clearOAuthCookies,
  clearSessionCookie,
  readOAuthCookies,
  setOAuthCookies,
  setSessionCookie,
} from "../../http/cookies.ts";
import { UNINTERRUPTIBLE } from "../../http/middleware.ts";
import { clientIp, header, queryParam, rawJsonOr, requestLocale } from "../../http/request.ts";
import { created, json, noContent, redirect } from "../../http/response.ts";
import {
  ApiFailure,
  BadRequest,
  Conflict,
  InvalidCredentials,
  NotFound,
  Unauthorized,
  ValidationFailed,
  isApiError,
} from "../../lib/errors.ts";
import { decode, decodeOption, type Decodable, type Decoded } from "../../lib/validate.ts";
import {
  type OAuthProvider,
  OAuthProviders,
  createAuthorization,
  isProviderConfigured,
  safeNextPath,
  webUrl,
} from "../../lib/oauth.ts";
import { normalizeStoredUploadUrl } from "../../lib/uploadUrls.ts";
import { AuthBootstrap } from "../services/auth/bootstrap.ts";
import { EMAIL_VERIFICATION_TTL_HOURS, EmailVerification } from "../services/auth/emailVerification.ts";
import { AuthInvites } from "../services/auth/invites.ts";
import { OAuthAccounts } from "../services/auth/oauthAccounts.ts";
import { PASSWORD_RESET_TTL_MINUTES, PasswordReset } from "../services/auth/passwordReset.ts";
import { Passwords } from "../services/auth/passwords.ts";
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
  RateLimiter,
} from "../services/auth/rateLimit.ts";
import { MailerService, mailDeliveryOf, passwordResetMail, verifyEmailMail } from "../services/mail/index.ts";
import { Sessions } from "../services/auth/sessions.ts";
import { DEFAULT_HOUSEHOLD_NAME, type UserPatch, Users } from "../services/auth/users.ts";
import { Households } from "../services/households/households.service.ts";
import { AuthApi } from "./auth.api.ts";

/* ------------------------------- helpers --------------------------------- */

/**
 * Parses + validates a JSON body. A malformed body is 400, a decode failure becomes 422
 * `validation_failed` — and a body that does not DECLARE itself JSON is 400 too:
 * `Request.json()` happily parses a `text/plain` form post, which is exactly the body
 * an HTML form on a foreign page can send with the cookie attached. Requiring the
 * content type is what `validate("json", …)` does for every other router; this
 * helper must not be the one exception (toon-finance gotcha 66, 1715207; the other
 * half of the CSRF defence is middleware/originGuard.ts).
 */
const readJson = Effect.fn("auth.readJson")(function* <S extends Decodable>(
  schema: S,
): Effect.fn.Return<Decoded<S>, BadRequest | Schema.SchemaError, HttpServerRequest.HttpServerRequest> {
  const contentType = (yield* header("content-type")) ?? "";
  if (!/^application\/json\b/i.test(contentType.trim())) {
    return yield* new BadRequest({ text: "server.auth.invalidJsonBody" });
  }
  const raw: unknown = yield* rawJsonOr(() => new BadRequest({ text: "server.auth.invalidJsonBody" }));
  return yield* decode(schema, raw);
});

/** What we store on a session row for the "Signed-in devices" screen. */
const fingerprint = Effect.fnUntraced(function* (): Effect.fn.Return<
  { ipAddress: string; userAgent: string | null },
  never,
  HttpServerRequest.HttpServerRequest
> {
  return { ipAddress: yield* clientIp, userAgent: (yield* header("user-agent")) ?? null };
});

/** Creates the session row and sets the cookie. */
const startSession = Effect.fn("auth.startSession")(function* (userId: string) {
  const sessions = yield* Sessions;
  const session = yield* sessions.createSession(userId, yield* fingerprint());
  yield* setSessionCookie(session.id, session.expiresAt);
});

/** Loads the row behind c.var.user and builds the bootstrap payload. */
const authPayload = Effect.fn("auth.authPayload")(function* (userId: string) {
  const users = yield* Users;
  const bootstrap = yield* AuthBootstrap;
  const row = yield* users.findUserById(userId);
  if (!row) return yield* new Unauthorized();
  const payload: AuthSessionResponse = yield* bootstrap.buildAuthSession(row);
  return payload;
});

/** Path param -> provider, 404 for anything else. */
const readProvider = Effect.fnUntraced(function* (provider: string | undefined): Effect.fn.Return<OAuthProvider, NotFound> {
  const parsed = decodeOption(OAuthProviderSchema, provider);
  if (Option.isNone(parsed)) return yield* new NotFound({ text: "server.auth.unknownOauthProvider" });
  return parsed.value;
});

/**
 * Mails an already-minted confirmation link and reports what became of it.
 *
 * Split from the minting on purpose: `/email/verify/request` must let
 * `createEmailVerificationToken`'s 409 ("already confirmed") reach the client,
 * while registration must swallow everything. Sharing the send half keeps the two
 * mails byte-identical without forcing one error policy on both.
 */
const mailVerificationLink = Effect.fn("auth.mailVerificationLink")(function* (user: UserRow, token: string) {
  const users = yield* Users;
  const mailer = yield* MailerService;
  const sent = yield* mailer.trySendMail(
    verifyEmailMail({
      // A session user or a fresh registration always has an e-mail; a placeholder
      // (ADR 0006) has no login path, so this fails 401 only on a programming error.
      to: yield* users.accountEmail(user),
      name: user.name,
      verifyUrl: webUrl(`/verify-email/${token}`),
      expiresInHours: EMAIL_VERIFICATION_TTL_HOURS,
      locale: isLocale(user.locale) ? user.locale : env.defaultLocale,
    }),
  );
  const delivery: MailDelivery = mailDeliveryOf(sent);
  return delivery;
});

/**
 * Registration's fire-and-forget variant: mints and mails, and lets nothing
 * escape. The account exists and the session is about to be issued — a mail
 * problem must not undo either (same rule as every other send in this codebase,
 * see the trySendMail contract in services/mail/index.ts). Ends in
 * `Effect.catchCause`: a typed failure, a defect and a rejection are all swallowed
 * (plan e2 P2, P12).
 */
const sendVerificationLinkQuietly = Effect.fn("auth.sendVerificationLinkQuietly")(
  function* (user: UserRow) {
    const verification = yield* EmailVerification;
    const { token } = yield* verification.createEmailVerificationToken(user, { requestedIp: (yield* clientIp) });
    yield* mailVerificationLink(user, token);
  },
  Effect.catchCause((cause) =>
    Effect.sync(() => {
      const error = Cause.squash(cause);
      const reason = Predicate.isTagged(error, "DatabaseError") && "cause" in error ? error.cause : error;
      // English, like every other ops line here — one language in a log is a feature.
      console.error(
        `[auth] Could not send the confirmation link: ${Predicate.isError(reason) ? reason.message : String(reason)}`,
      );
    }),
  ),
);

/** The handshake cookies `readOAuthCookies` returns. */
type OAuthCookies = Effect.Success<typeof readOAuthCookies>;

/**
 * The body of the OAuth callback: the provider's abort, the state check, the code exchange and then either the link
 * or the login, answering the success redirect. Every failure of it, typed or not, is recovered by
 * `oauthCallbackRecovery` (the handler applies `Effect.catchCause`, plan e2 P12).
 */
export const oauthCallbackFlow = Effect.fn("auth.oauthCallbackFlow")(function* (
  provider: OAuthProvider,
  cookies: OAuthCookies,
  next: string,
  linking: boolean,
) {
  const providers = yield* OAuthProviders;
  const oauthAccounts = yield* OAuthAccounts;

  const providerError = yield* queryParam("error");
  if (providerError) {
    return yield* new ApiFailure({
      status: 400,
      code: "oauth_failed",
      text: { key: "server.auth.oauthProviderAborted", values: { providerError } },
    });
  }
  const code = yield* queryParam("code");
  const state = yield* queryParam("state");
  if (!code || !state) {
    return yield* new ApiFailure({ status: 400, code: "oauth_failed", text: "server.auth.oauthIncompleteResponse" });
  }
  if (!cookies.state || state !== cookies.state) {
    return yield* new ApiFailure({ status: 400, code: "oauth_failed", text: "server.auth.oauthSessionExpired" });
  }

  const profile = yield* providers.exchangeCodeForProfile(provider, code, cookies.codeVerifier);

  if (linking) {
    // The session cookie survives the provider round-trip (SameSite=Lax on a
    // top-level GET); without it we cannot know whose account to extend.
    const sessionUser = (yield* MaybeSession).user;
    if (!sessionUser) return yield* new Unauthorized({ text: "server.auth.pleaseSignInAgain" });
    yield* oauthAccounts.linkOAuthAccount(sessionUser.id, profile);
    return redirect(webUrl(next, { linked: provider }));
  }

  const { user } = yield* oauthAccounts.loginWithOAuthProfile(profile);
  yield* startSession(user.id);
  return redirect(webUrl(next));
});

/**
 * The recovery of the OAuth callback: catch-all, because the code it replaces caught everything (plan e2 P2, P12).
 * `Cause.squash(cause)` is the value the old `catch (error)` saw: a member of the API error family chooses the
 * redirect's `error` code and is not logged; anything else (a defect, a rejection, a `DatabaseError`, a transport
 * failure) is logged `[auth] OAuth callback failed:` and becomes `oauth_failed`. Never `Effect.catch` /
 * `Effect.catchTags`: they would let a defect through as `500 internal_error` JSON.
 */
export function oauthCallbackRecovery(
  next: string,
  linking: boolean,
): (cause: Cause.Cause<unknown>) => Effect.Effect<HttpServerResponse.HttpServerResponse> {
  return (cause) =>
    Effect.sync(() => {
      const error = Cause.squash(cause);
      const errorCode = isApiError(error) ? String(error.code) : "oauth_failed";
      if (!isApiError(error)) {
        const reason =
          (Predicate.isTagged(error, "DatabaseError") || Predicate.isTagged(error, "OAuthTransportError")) &&
          "cause" in error
            ? error.cause
            : error;
        console.error("[auth] OAuth callback failed:", reason);
      }
      if (linking) return redirect(webUrl(next, { error: errorCode }));
      return redirect(webUrl("/login", { error: errorCode }));
    });
}

/* ------------------------------- handlers -------------------------------- */

export const authHandlers = HttpApiBuilder.group(AuthApi, "auth", (handlers) =>
  handlers

    /* ----------------------------- registration ------------------------------ */

    .handle(
      "postRegister",
      Effect.fn("auth.postRegister")(function* () {
        const rateLimiter = yield* RateLimiter;
        const invites = yield* AuthInvites;
        const users = yield* Users;
        const passwords = yield* Passwords;

        const body = yield* readJson(RegisterRequestSchema);
        yield* rateLimiter.enforce("register", (yield* clientIp), REGISTER_RULE);

        // Validate the invite BEFORE creating anything, so a bad token cannot leave a
        // user without a household behind.
        const invite = body.inviteToken ? yield* invites.loadRedeemableInvite(body.inviteToken) : undefined;
        // A spent CLAIM link is no capability any more (toon-finance gotcha 55): 404 before anything
        // else, so a second registration onto it never reaches the account it created.
        if (invite?.claimsUserId && invite.status !== "pending") {
          return yield* new ApiFailure({ status: 404, code: "invite_invalid", text: "server.invite.invalid" });
        }

        // Before the claim too: an address that already has an account never claims a placeholder.
        if (yield* users.findUserByEmail(body.email)) {
          return yield* new Conflict({ code: "email_taken", text: "server.auth.emailTaken" });
        }

        const passwordHash = yield* passwords.hashPassword(body.password);

        // A CLAIM invite creates no user (ADR 0006 decision 4, toon-finance b1b517d): it writes this
        // registration's credentials onto the placeholder it names, in place, so every membership,
        // seat and ledger row keeps naming the same id. Unconfirmed like any registration (D4).
        if (invite?.claimsUserId) {
          const claimedId = yield* invites.claimInvite(invite, {
            email: body.email,
            name: body.name,
            passwordHash,
          });
          const claimed = yield* users.findUserById(claimedId);
          if (!claimed) return yield* new Unauthorized();
          yield* sendVerificationLinkQuietly(claimed);
          yield* startSession(claimedId);
          return created(yield* authPayload(claimedId));
        }
        const user = yield* users.createUser({
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
          const accepted = yield* invites.acceptInvite(body.inviteToken, user.id);
          yield* users.setActiveHousehold(user.id, accepted.householdId);
        } else {
          yield* users.createOwnedHousehold(user.id, body.householdName ?? DEFAULT_HOUSEHOLD_NAME);
        }

        // Mail the confirmation link straight away. Without this the new account would
        // land on a read-only app (services/auth/verifiedEmail.ts) and have to go and
        // find the "resend" button on /settings to discover why — a gate has to arrive
        // with its own way out. Always attempted, never awaited for its verdict: a
        // failed send must not fail the registration, and on a ConsoleMailer install
        // the gate is off anyway, so the logged link is a convenience rather than the
        // only route in.
        yield* sendVerificationLinkQuietly(user);

        yield* startSession(user.id);
        return created(yield* authPayload(user.id));
      }),
      UNINTERRUPTIBLE,
    )

    /* -------------------------------- login ---------------------------------- */

    .handle(
      "postLogin",
      Effect.fn("auth.postLogin")(function* () {
        const rateLimiter = yield* RateLimiter;
        const users = yield* Users;
        const passwords = yield* Passwords;

        const body = yield* readJson(LoginRequestSchema);
        yield* rateLimiter.enforce("login", `${(yield* clientIp)}|${body.email}`, LOGIN_RULE);
        // Second ceiling that no forwarding header can reset — see LOGIN_EMAIL_RULE.
        yield* rateLimiter.enforce("login-email", body.email, LOGIN_EMAIL_RULE);

        const user = yield* users.findUserByEmail(body.email);
        // Always runs an argon2id verification (dummy hash for unknown accounts), so
        // the response time does not reveal whether the e-mail exists.
        const matches = yield* passwords.verifyPassword(body.password, user?.passwordHash ?? null);

        if (!user) return yield* new InvalidCredentials();
        if (!user.passwordHash) return yield* new InvalidCredentials({ text: "server.auth.noPasswordSet" });
        if (!matches) return yield* new InvalidCredentials();

        yield* startSession(user.id);
        const payload: AuthSessionResponse = yield* authPayload(user.id);
        return json(payload);
      }),
      UNINTERRUPTIBLE,
    )

    /* -------------------------------- logout --------------------------------- */

    .handle(
      "postLogout",
      Effect.fn("auth.postLogout")(function* () {
        const sessions = yield* Sessions;
        const sessionId = (yield* CurrentSession).sessionId;
        if (sessionId) yield* sessions.deleteSession(sessionId);
        yield* clearSessionCookie;
        return noContent();
      }),
      UNINTERRUPTIBLE,
    )

    /* --------------------------------- me ------------------------------------ */

    .handle(
      "getMe",
      Effect.fn("auth.getMe")(function* () {
        const user = yield* CurrentUser;
        const payload: MeResponse = yield* authPayload(user.id);
        return json(payload);
      }),
      UNINTERRUPTIBLE,
    )

    .handle(
      "patchMe",
      Effect.fn("auth.patchMe")(function* () {
        const users = yield* Users;
        const households = yield* Households;
        const bootstrap = yield* AuthBootstrap;

        const user = yield* CurrentUser;
        const body = yield* readJson(UpdateProfileRequestSchema);

        if (typeof body.activeHouseholdId === "string") {
          // Not a member (or no such household): both answer the same 422 below.
          const member = yield* households
            .getMember(body.activeHouseholdId, user.id)
            .pipe(Effect.catchTag("NotFound", () => Effect.succeed(undefined)));
          if (!member) {
            const locale = (yield* requestLocale);
            return yield* new ValidationFailed({
              text: "server.group.notAMember",
              details: [
                {
                  path: "activeHouseholdId",
                  code: "custom",
                  message: serverText(locale, "server.group.fieldNotAMember"),
                  i18n: { key: "server.group.fieldNotAMember" },
                },
              ],
            });
          }
        }

        const patch: UserPatch = {};
        if (body.name !== undefined) patch.name = body.name;
        // The client sends back the signed avatar URL it was served; store the bare
        // `/uploads/<file>` so the row never holds an expiring value (lib/uploadUrls.ts).
        if (body.avatarUrl !== undefined) {
          patch.avatarUrl = normalizeStoredUploadUrl(body.avatarUrl) ?? null;
        }
        if (body.activeHouseholdId !== undefined) patch.activeHouseholdId = body.activeHouseholdId ?? null;

        const row = yield* users.updateUser(user.id, patch);
        const session = yield* bootstrap.buildAuthSession(row);
        const payload: UserResponse = { user: session.user };
        return json(payload);
      }),
      UNINTERRUPTIBLE,
    )

    /* ------------------------------ password --------------------------------- */

    .handle(
      "postPassword",
      Effect.fn("auth.postPassword")(function* () {
        const rateLimiter = yield* RateLimiter;
        const users = yield* Users;
        const passwords = yield* Passwords;
        const sessions = yield* Sessions;

        const user = yield* CurrentUser;
        const body = yield* readJson(ChangePasswordRequestSchema);
        yield* rateLimiter.enforce("password", user.id, PASSWORD_RULE);

        const row = yield* users.findUserById(user.id);
        if (!row) return yield* new Unauthorized();

        if (row.passwordHash) {
          if (!body.currentPassword) {
            return yield* new InvalidCredentials({ text: "server.auth.currentPasswordRequired" });
          }
          const matches = yield* passwords.verifyPassword(body.currentPassword, row.passwordHash);
          if (!matches) return yield* new InvalidCredentials({ text: "server.auth.currentPasswordWrong" });
        }

        const passwordHash = yield* passwords.hashPassword(body.newPassword);
        yield* users.updateUser(user.id, { passwordHash });
        // A password change signs every other device out.
        yield* sessions.deleteOtherSessions(user.id, (yield* CurrentSession).sessionId);
        return noContent();
      }),
      UNINTERRUPTIBLE,
    )

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
    .handle(
      "postPasswordForgot",
      Effect.fn("auth.postPasswordForgot")(function* () {
        const rateLimiter = yield* RateLimiter;
        const users = yield* Users;
        const passwordReset = yield* PasswordReset;
        const mailer = yield* MailerService;

        const body = yield* readJson(ForgotPasswordRequestSchema);
        yield* rateLimiter.enforce("password-forgot", (yield* clientIp), FORGOT_PASSWORD_RULE);
        yield* rateLimiter.enforce("password-forgot-email", body.email, FORGOT_PASSWORD_EMAIL_RULE);

        const user = yield* users.findUserByEmail(body.email);
        // A lookup by e-mail never finds a placeholder (its e-mail is NULL, ADR 0006); the
        // explicit `email !== null` keeps the narrowing visible and the answer uniform.
        if (user && user.email !== null) {
          // An OAuth-only account has no password to reset. Sending the link anyway
          // would be a dead end; not sending it keeps the answer uniform.
          const { token } = yield* passwordReset.createPasswordResetToken(user.id, { requestedIp: (yield* clientIp) });
          yield* mailer.trySendMail(
            passwordResetMail({
              to: user.email,
              name: user.name,
              resetUrl: webUrl(`/reset-password/${token}`),
              expiresInMinutes: PASSWORD_RESET_TTL_MINUTES,
              locale: isLocale(user.locale) ? user.locale : env.defaultLocale,
            }),
          );
        }

        return noContent();
      }),
      UNINTERRUPTIBLE,
    )

    /**
     * POST /api/auth/password/reset — spends the token and sets the new password.
     *
     * Answers 204 and does NOT sign the user in: every session of that user is
     * deleted (the whole point — a stolen cookie must not survive a reset), and the
     * web app sends them to `/login` to prove they know the new password. See
     * docs/API.md.
     */
    .handle(
      "postPasswordReset",
      Effect.fn("auth.postPasswordReset")(function* () {
        const rateLimiter = yield* RateLimiter;
        const passwordReset = yield* PasswordReset;

        const body = yield* readJson(ResetPasswordRequestSchema);
        yield* rateLimiter.enforce("password-reset", (yield* clientIp), PASSWORD_RESET_RULE);

        yield* passwordReset.consumePasswordReset(body.token, body.password);
        // The caller had no session, and every existing one was just revoked, so there
        // is nothing to clear — but be explicit in case a stale cookie is present.
        yield* clearSessionCookie;
        return noContent();
      }),
      UNINTERRUPTIBLE,
    )

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
    .handle(
      "postEmailVerifyRequest",
      Effect.fn("auth.postEmailVerifyRequest")(function* () {
        const rateLimiter = yield* RateLimiter;
        const users = yield* Users;
        const verification = yield* EmailVerification;

        const user = yield* CurrentUser;
        yield* rateLimiter.enforce("email-verify", user.id, EMAIL_VERIFY_RULE);

        const row = yield* users.findUserById(user.id);
        if (!row) return yield* new Unauthorized();

        const { token } = yield* verification.createEmailVerificationToken(row, { requestedIp: (yield* clientIp) });
        // The token is stored either way — a failed mail must not invalidate a link the
        // operator can still fish out of the log.
        const mailDelivery = yield* mailVerificationLink(row, token);
        return json({ mailDelivery } satisfies EmailVerificationRequestResponse);
      }),
      UNINTERRUPTIBLE,
    )

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
    .handle(
      "postEmailVerifyConfirm",
      Effect.fn("auth.postEmailVerifyConfirm")(function* () {
        const rateLimiter = yield* RateLimiter;
        const verification = yield* EmailVerification;
        const bootstrap = yield* AuthBootstrap;

        const body = yield* readJson(VerifyEmailRequestSchema);
        yield* rateLimiter.enforce("email-verify-confirm", (yield* clientIp), EMAIL_VERIFY_RULE);

        const { user } = yield* verification.confirmEmailVerification(body.token);
        const payload: UserResponse = { user: (yield* bootstrap.buildAuthSession(user)).user };
        return json(payload);
      }),
      UNINTERRUPTIBLE,
    )

    /* ------------------------------- sessions -------------------------------- */

    .handle(
      "getSessions",
      Effect.fn("auth.getSessions")(function* () {
        const sessions = yield* Sessions;
        const user = yield* CurrentUser;
        const items = yield* sessions.listSessionsForUser(user.id, (yield* CurrentSession).sessionId);
        const payload: SessionListResponse = { items };
        return json(payload);
      }),
      UNINTERRUPTIBLE,
    )

    .handle(
      "deleteSessionsBySessionId",
      Effect.fn("auth.deleteSessionsBySessionId")(function* ({ params }) {
        const sessions = yield* Sessions;
        const user = yield* CurrentUser;
        const target = yield* sessions.findSessionByHandle(user.id, params.sessionId);
        if (!target) return yield* new NotFound({ text: "server.auth.sessionNotFound" });

        yield* sessions.deleteSession(target.id);
        if (target.id === (yield* CurrentSession).sessionId) yield* clearSessionCookie;
        return noContent();
      }),
      UNINTERRUPTIBLE,
    )

    /* --------------------------------- OAuth --------------------------------- */

    /**
     * GET /api/auth/oauth — which providers this deployment can actually use, plus
     * (with a session) which of them the current user has linked. The login screen
     * hides unconfigured buttons with it, the profile screen renders the link list.
     * Additive to the contract. MUST stay registered before "/oauth/:provider".
     */
    .handle(
      "getOauth",
      Effect.fn("auth.getOauth")(function* () {
        const oauthAccounts = yield* OAuthAccounts;
        const user = (yield* MaybeSession).user;
        const links = user ? yield* oauthAccounts.listOAuthAccounts(user.id) : [];
        const payload: OAuthProvidersResponse = {
          providers: OAUTH_PROVIDERS.map((provider) => {
            const link = links.find((row) => row.provider === provider);
            return {
              provider,
              configured: isProviderConfigured(provider),
              linked: link !== undefined,
              linkedEmail: link?.providerEmail ?? null,
            };
          }),
        };
        return json(payload);
      }),
      UNINTERRUPTIBLE,
    )

    /**
     * GET /api/auth/oauth/:provider/link — starts the SAME arctic handshake as a
     * login, but for an authenticated user, and marks the flow as "link" so the
     * callback attaches the identity instead of logging somebody in. This is the only
     * way password and OAuth end up on one account (there is no auto-link on e-mail
     * match — see services/auth/oauthAccounts.ts). Additive to the contract.
     */
    .handle(
      "getOauthByProviderLink",
      Effect.fn("auth.getOauthByProviderLink")(function* ({ params }) {
        const providers = yield* OAuthProviders;
        const provider = yield* readProvider(params.provider);
        yield* providers.requireProviderConfigured(provider);

        const start = yield* createAuthorization(provider);
        const next = safeNextPath(yield* queryParam("next")) ?? "/settings";
        yield* setOAuthCookies({
          state: start.state,
          codeVerifier: start.codeVerifier,
          next,
          intent: "link",
        });

        if ((yield* queryParam("json")) === "1") return json({ url: start.url });
        return redirect(start.url);
      }),
      UNINTERRUPTIBLE,
    )

    /** DELETE /api/auth/oauth/:provider — detach a provider. Additive. */
    .handle(
      "deleteOauthByProvider",
      Effect.fn("auth.deleteOauthByProvider")(function* ({ params }) {
        const users = yield* Users;
        const oauthAccounts = yield* OAuthAccounts;
        const provider = yield* readProvider(params.provider);
        const user = yield* CurrentUser;
        const row = yield* users.findUserById(user.id);
        if (!row) return yield* new Unauthorized();
        yield* oauthAccounts.unlinkOAuthAccount(row, provider);
        return noContent();
      }),
      UNINTERRUPTIBLE,
    )

    .handle(
      "getOauthByProvider",
      Effect.fn("auth.getOauthByProvider")(function* ({ params }) {
        const providers = yield* OAuthProviders;
        const provider = yield* readProvider(params.provider);

        // A browser navigation must never dead-end on raw JSON: the Google/GitHub
        // buttons are visible on a default install where OAuth is not configured, so
        // send the user back to the login screen, which already renders
        // ?error=oauth_not_configured as a German message. Only the ?json=1 form
        // (used by scripts/tests) still gets the 400.
        if (!isProviderConfigured(provider)) {
          if ((yield* queryParam("json")) === "1") yield* providers.requireProviderConfigured(provider);
          return redirect(webUrl("/login", { error: "oauth_not_configured" }));
        }

        const start = yield* createAuthorization(provider);
        const next = safeNextPath(yield* queryParam("next"));
        yield* setOAuthCookies({ state: start.state, codeVerifier: start.codeVerifier, next });

        if ((yield* queryParam("json")) === "1") return json({ url: start.url });
        return redirect(start.url);
      }),
      UNINTERRUPTIBLE,
    )

    .handle(
      "getOauthByProviderCallback",
      Effect.fn("auth.getOauthByProviderCallback")(function* ({ params }) {
        const providers = yield* OAuthProviders;
        const rateLimiter = yield* RateLimiter;

        const provider = yield* readProvider(params.provider);
        // "Not configured" is a server-side problem, not a failed login: answer JSON
        // (400 oauth_not_configured) instead of bouncing the user to the web app.
        yield* providers.requireProviderConfigured(provider);
        yield* rateLimiter.enforce("oauth", (yield* clientIp), OAUTH_RULE);

        const cookies = yield* readOAuthCookies;
        yield* clearOAuthCookies;
        const next = safeNextPath(cookies.next) ?? "/";
        const linking = cookies.intent === "link";

        return yield* oauthCallbackFlow(provider, cookies, next, linking).pipe(
          Effect.catchCause(oauthCallbackRecovery(next, linking)),
        );
      }),
      UNINTERRUPTIBLE,
    )
);
