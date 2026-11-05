/** The auth routes (registration, login, sessions, password, e-mail verification, OAuth); served at /api/auth (docs/API.md "Auth"). */
import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { chain, coreApi, OptionalSession, RequireSession } from "../../http/middleware.ts";

export const AuthGroup = HttpApiGroup.make("auth")
  .add(
    /** POST /api/auth/register */
    HttpApiEndpoint.post("postRegister", "/register"),
    /** POST /api/auth/login */
    HttpApiEndpoint.post("postLogin", "/login"),
    /** POST /api/auth/logout */
    HttpApiEndpoint.post("postLogout", "/logout").pipe(chain(RequireSession)),
    /** GET /api/auth/me */
    HttpApiEndpoint.get("getMe", "/me").pipe(chain(RequireSession)),
    /** PATCH /api/auth/me */
    HttpApiEndpoint.patch("patchMe", "/me").pipe(chain(RequireSession)),
    /** POST /api/auth/password */
    HttpApiEndpoint.post("postPassword", "/password").pipe(chain(RequireSession)),
    /** POST /api/auth/password/forgot */
    HttpApiEndpoint.post("postPasswordForgot", "/password/forgot"),
    /** POST /api/auth/password/reset */
    HttpApiEndpoint.post("postPasswordReset", "/password/reset"),
    /** POST /api/auth/email/verify/request */
    HttpApiEndpoint.post("postEmailVerifyRequest", "/email/verify/request").pipe(chain(RequireSession)),
    /** POST /api/auth/email/verify/confirm */
    HttpApiEndpoint.post("postEmailVerifyConfirm", "/email/verify/confirm").pipe(chain(OptionalSession)),
    /** GET /api/auth/sessions */
    HttpApiEndpoint.get("getSessions", "/sessions").pipe(chain(RequireSession)),
    /** DELETE /api/auth/sessions/:sessionId */
    HttpApiEndpoint.delete("deleteSessionsBySessionId", "/sessions/:sessionId", {
      params: { sessionId: Schema.String },
    }).pipe(chain(RequireSession)),
    /** GET /api/auth/oauth */
    HttpApiEndpoint.get("getOauth", "/oauth").pipe(chain(OptionalSession)),
    /** GET /api/auth/oauth/:provider/link */
    HttpApiEndpoint.get("getOauthByProviderLink", "/oauth/:provider/link", {
      params: { provider: Schema.String },
    }).pipe(chain(RequireSession)),
    /** DELETE /api/auth/oauth/:provider */
    HttpApiEndpoint.delete("deleteOauthByProvider", "/oauth/:provider", {
      params: { provider: Schema.String },
    }).pipe(chain(RequireSession)),
    /** GET /api/auth/oauth/:provider */
    HttpApiEndpoint.get("getOauthByProvider", "/oauth/:provider", { params: { provider: Schema.String } }),
    /** GET /api/auth/oauth/:provider/callback */
    HttpApiEndpoint.get("getOauthByProviderCallback", "/oauth/:provider/callback", {
      params: { provider: Schema.String },
    }).pipe(chain(OptionalSession)),
  )
  .prefix("/api/auth");

export const AuthApi = coreApi(HttpApi.make("auth").add(AuthGroup));
