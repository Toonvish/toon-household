/**
 * The typed API client — the ONLY place in the web app that talks to the network.
 *
 * Rules for every other frontend module:
 *  - never call `fetch` yourself, import a function from here,
 *  - every argument/return type comes from `@toon/shared` (the frozen contract),
 *  - errors are always an {@link ApiError} (code + message + HTTP status).
 *
 * Module API files (`apps/web/src/modules/<id>/api.ts`) build on the helpers here
 * ({@link getJson}, {@link sendJson}, {@link sendForm}, {@link sendVoid}; {@link request} until E6-T09);
 * they never call `fetch` (SPEC §2).
 *
 * Transport (docs/EFFECT.md E11; plan docs/plans/e6-web-client.md P3, P7, P8): every request is described ONCE as
 * an Effect — a member of {@link CoreApi} — that goes through the `ApiClient` service
 * (apps/web/src/lib/api-client.ts) on the web's one runtime (apps/web/src/lib/runtime.ts, `FetchHttpClient`)
 * and decodes the response with the shared `…ResponseSchema`, structure and types only (`DECODE_OPTIONS`). The
 * exported functions keep their names, signatures and `Promise` results as facades over `runPromise`.
 *
 * Session handling: the API sets an HttpOnly cookie, so every request goes out with
 * `credentials: "include"`. A 401 on a guarded endpoint triggers the global
 * unauthorized handler (see {@link setUnauthorizedHandler}) which sends the user to
 * `/login?next=<current path>`.
 */
import {
  AcceptInviteResponseSchema,
  AuthSessionResponseSchema,
  EmailVerificationRequestResponseSchema,
  HealthResponseSchema,
  HouseholdDetailResponseSchema,
  HouseholdInviteListResponseSchema,
  HouseholdInviteResponseSchema,
  HouseholdListResponseSchema,
  HouseholdMemberListResponseSchema,
  HouseholdMemberResponseSchema,
  HouseholdResponseSchema,
  InvitePreviewResponseSchema,
  MAX_UPLOAD_BYTES,
  MeResponseSchema,
  OAuthProvidersResponseSchema,
  OAuthStartResponseSchema,
  SessionListResponseSchema,
  UserResponseSchema,
  type AcceptInviteRequest,
  type AcceptInviteResponse,
  type AuthSessionResponse,
  type ChangePasswordRequest,
  type CreateHouseholdRequest,
  type CreateInviteRequest,
  type CreatePlaceholderMemberRequest,
  type EmailVerificationRequestResponse,
  type ForgotPasswordRequest,
  type HealthResponse,
  type HouseholdDetailResponse,
  type HouseholdInviteListResponse,
  type HouseholdInviteResponse,
  type HouseholdListResponse,
  type HouseholdMemberListResponse,
  type HouseholdMemberResponse,
  type HouseholdResponse,
  type InvitePreviewResponse,
  type LoginRequest,
  type MeResponse,
  type ModuleId,
  type OAuthProvider,
  type OAuthProvidersResponse,
  type OAuthStartResponse,
  type PaginationQuery,
  type RegisterRequest,
  type ResetPasswordRequest,
  type SessionListResponse,
  type UpdateHouseholdRequest,
  type UpdateMemberRoleRequest,
  type UpdatePlaceholderMemberRequest,
  type UpdateProfileRequest,
  type UserResponse,
  type VerifyEmailRequest,
} from "@toon/shared";
import { Effect, Predicate, Schema, type SchemaAST, type Types } from "effect";
import { translate } from "@/lib/i18n/store.ts";
import { ApiClient, ApiError, isApiError, type ApiMethod, type ApiRequest, type ApiResponse } from "./api-client.ts";
import { runPromise } from "./runtime.ts";

/* -------------------------------------------------------------------------- */
/* base url                                                                   */
/* -------------------------------------------------------------------------- */

const buildEnv = import.meta.env as unknown as Record<string, string | undefined>;

/**
 * Base URL of the API without a trailing slash.
 * `PUBLIC_API_URL` is the documented name (root .env, inlined by vite);
 * `VITE_API_URL` is accepted as an alias.
 */
export const API_BASE_URL: string = (
  buildEnv.PUBLIC_API_URL ??
  buildEnv.VITE_API_URL ??
  // Only a dev server falls back to the cross-origin API port. A production build that sets
  // neither variable is served by the API itself and must use relative URLs: the API's CSP says
  // `connect-src 'self'` (toon-finance gotcha 50), and the literal must not survive in the bundle.
  // `import.meta.env.PROD` is replaced statically by Vite, so this branch is dropped from it.
  (import.meta.env.PROD ? "" : "http://localhost:3001")
).replace(/\/+$/, "");

/** Absolute URL for an API path (`/api/health` -> `http://localhost:3001/api/health`). */
export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Turns a stored media path into something an `<img src>` can use.
 * The API returns `/uploads/<uuid>.<ext>`; absolute URLs and data: URIs pass through.
 */
export function mediaUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  return apiUrl(url);
}

/**
 * `<img src>` for a LIST row or card: the downscaled derivative the API minted, and
 * the original only when there is none (an external hero image, an older payload).
 * A recipe list renders up to 24 of these, so it must never pull the full-size photo.
 * Detail screens keep using `mediaUrl(imageUrl)` — there the big one is the point.
 */
export function thumbnailUrl(
  media: { thumbnailUrl?: string | null; imageUrl?: string | null },
): string | undefined {
  return mediaUrl(media.thumbnailUrl ?? media.imageUrl);
}

/* -------------------------------------------------------------------------- */
/* errors                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Every failed request fails with {@link ApiError} (apps/web/src/lib/api-client.ts: a `Schema.TaggedError`
 * with `code`, `status`, `message`, `details` and the getters `isClientError`, `isUnauthorized`,
 * `isForbidden`, `isNotFound`, `isOffline`).
 */
export { ApiError, isApiError, setUnauthorizedHandler } from "./api-client.ts";

/** Alias for code that already imports a type called `ApiError` from @toon/shared. */
export { ApiError as ApiClientError } from "./api-client.ts";

/** User-facing message for any thrown value, in the active locale. Safe to render directly. */
export function errorMessage(error: unknown): string {
  if (isApiError(error)) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return translate("common.error.unknown");
}

/* -------------------------------------------------------------------------- */
/* core request                                                               */
/* -------------------------------------------------------------------------- */

export type QueryValue = string | number | boolean | null | undefined;

/** Builds `?a=1&b=x`, skipping null/undefined/"" values. */
export function queryString(params: Record<string, QueryValue> = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : "";
}

/**
 * Every value interpolated into a URL PATH goes through here (toon-finance 1715207). Ids are
 * UUIDs from our own responses, but some arrive via route params the address bar controls: an
 * unencoded `..%2F`, `?` or `/` would re-target the request to another endpoint.
 */
export function seg(value: string): string {
  return encodeURIComponent(value);
}

export interface RequestOptions {
  signal?: AbortSignal | undefined;
  /** Skip the global 401 -> /login redirect (bootstrap + auth screens use this). */
  allowUnauthorized?: boolean;
}

/* -------------------------------------------------------------------------- */
/* decode helpers                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The ONE set of decode options for responses (plan e6 P7): structure and types only. The server is the
 * authority on the wire checks (UUID and ISO patterns, lengths, ranges) and applied them on the way in; rows
 * written before a limit tightened, migrated legacy rows and placeholder rows must still render. A plain
 * object literal (P16: no imported binding at module scope).
 */
export const DECODE_OPTIONS: SchemaAST.ParseOptions = { disableChecks: true };

/** A schema the browser can decode a response with: no decoding services. */
export type ResponseSchema = Schema.Decoder<unknown, never>;

/** The decoded value a helper hands out: the schema's `Type`, made mutable (the shared `…Response` types). */
export type Decoded<S extends ResponseSchema> = Types.DeepMutable<S["Type"]>;

/**
 * The `lenient(schema)` marker (plan e6 P7c): a route whose shared schema cannot match the wire without
 * breaking `packages/shared/test` validates with `DECODE_OPTIONS`, logs a mismatch in DEV and hands out the
 * raw payload, on reads too. Every use is listed with its reason in an `apps/api/test/web-contract-*.test.ts` row.
 */
export interface Lenient<S extends ResponseSchema> {
  readonly _tag: "Lenient";
  readonly schema: S;
}

export function lenient<S extends ResponseSchema>(schema: S): Lenient<S> {
  return { _tag: "Lenient", schema };
}

type SchemaSpec<S extends ResponseSchema> = S | Lenient<S>;

function isLenient<S extends ResponseSchema>(spec: SchemaSpec<S>): spec is Lenient<S> {
  return Predicate.isTagged(spec, "Lenient");
}

/** What a 2xx whose body fails the decode does: a READ fails, a WRITE (P7a) or a lenient row passes it through. */
type OnMismatch = "fail" | "passThrough";

function warnMismatch(path: string, error: Schema.SchemaError): Effect.Effect<void> {
  return Effect.sync(() => {
    if (import.meta.env.DEV) {
      console.warn(`[api] response from ${path} does not match the schema`, error);
    }
  });
}

/**
 * The shared decode step of every helper. A 204/205 is `undefined` WITHOUT decoding (the pre-E6 `request<T>` rule);
 * otherwise the parsed body is decoded with `DECODE_OPTIONS`. On a mismatch a READ fails with
 * `invalid_response` (the 2xx status, the generic unknown-error text, the issue as `details`); a WRITE and a
 * lenient row log in DEV and succeed with the raw payload.
 */
function decodeResponse<S extends ResponseSchema>(
  spec: SchemaSpec<S>,
  response: ApiResponse,
  onMismatch: OnMismatch,
  path: string,
): Effect.Effect<Decoded<S>, ApiError> {
  const passThrough = onMismatch === "passThrough" || isLenient(spec);
  const schema: ResponseSchema = isLenient(spec) ? spec.schema : spec;
  const value: Effect.Effect<unknown, ApiError> = response.noContent
    ? Effect.succeed(undefined)
    : Schema.decodeUnknownEffect(schema, DECODE_OPTIONS)(response.parsed).pipe(
        Effect.catchTag("SchemaError", (error) =>
          passThrough
            ? Effect.as(warnMismatch(path, error), response.parsed)
            : Effect.fail(
                new ApiError({
                  code: "invalid_response",
                  status: response.status,
                  message: translate("common.error.unknown"),
                  details: error.message,
                }),
              ),
        ),
      );
  // The ONE cast of a decoded value: decoding builds fresh objects and arrays, so handing them out
  // mutable is sound, and the raw payload of the pass-through paths is freshly parsed JSON too.
  return Effect.map(value, (decoded) => decoded as Types.DeepMutable<S["Type"]>);
}

function execute(request: ApiRequest): Effect.Effect<ApiResponse, ApiError, ApiClient> {
  return ApiClient.use((client) => client.execute(request));
}

/** A READ: `GET path`, decoded strictly (a mismatch is `invalid_response`, plan e6 P7). */
export function getJson<S extends ResponseSchema>(
  schema: SchemaSpec<S>,
  path: string,
  options?: RequestOptions,
): Effect.Effect<Decoded<S>, ApiError, ApiClient> {
  return Effect.flatMap(
    execute({ method: "GET", url: apiUrl(path), allowUnauthorized: options?.allowUnauthorized }),
    (response) => decodeResponse(schema, response, "fail", path),
  );
}

/** A WRITE with a JSON body and a JSON answer; a decode mismatch passes the payload through (plan e6 P7a). */
export function sendJson<S extends ResponseSchema>(
  method: Exclude<ApiMethod, "GET">,
  schema: SchemaSpec<S>,
  path: string,
  body?: unknown,
  options?: RequestOptions,
): Effect.Effect<Decoded<S>, ApiError, ApiClient> {
  return Effect.flatMap(
    execute({ method, url: apiUrl(path), body, allowUnauthorized: options?.allowUnauthorized }),
    (response) => decodeResponse(schema, response, "passThrough", path),
  );
}

/** A multipart upload of ONE file (`POST`, field `file`, the 15 MB cap inside the effect, plan e6 P11). */
export function sendForm<S extends ResponseSchema>(
  schema: SchemaSpec<S>,
  path: string,
  file: File,
  options?: RequestOptions,
): Effect.Effect<Decoded<S>, ApiError, ApiClient> {
  return uploadForm(file).pipe(
    Effect.flatMap((form) =>
      execute({ method: "POST", url: apiUrl(path), form, allowUnauthorized: options?.allowUnauthorized }),
    ),
    Effect.flatMap((response) => decodeResponse(schema, response, "passThrough", path)),
  );
}

/** A request whose answer the caller ignores (204, or a body nobody reads). */
export function sendVoid(
  method: ApiMethod,
  path: string,
  body?: unknown,
  options?: RequestOptions,
): Effect.Effect<void, ApiError, ApiClient> {
  return Effect.asVoid(execute({ method, url: apiUrl(path), body, allowUnauthorized: options?.allowUnauthorized }));
}

function uploadTooLarge(file: File): ApiError {
  return new ApiError({
    code: "payload_too_large",
    status: 413,
    message: translate("common.upload.tooLarge", {
      filename: file.name,
      size: (file.size / (1024 * 1024)).toFixed(1),
    }),
  });
}

/** Client-side guard so a 15 MB+ file never leaves the phone. */
export function assertUploadSize(file: File): void {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw uploadTooLarge(file);
  }
}

export function fileForm(file: File): FormData {
  assertUploadSize(file);
  const form = new FormData();
  // The API expects exactly one field named `file` (ImportFileFieldName).
  form.append("file", file, file.name);
  return form;
}

/** {@link fileForm} as an effect: the same cap and message, failing instead of throwing (plan e6 P11). */
export function uploadForm(file: File): Effect.Effect<FormData, ApiError> {
  return Effect.suspend(() =>
    file.size > MAX_UPLOAD_BYTES ? Effect.fail(uploadTooLarge(file)) : Effect.sync(() => fileForm(file)),
  );
}

/* -------------------------------------------------------------------------- */
/* the core endpoints, described once                                         */
/* -------------------------------------------------------------------------- */

/**
 * Every core request as an Effect (plan e6 P8): the member name is the facade's name, the parameters are the
 * facade's without the signal, and only `allowUnauthorized` is read from `options` (a hard-coded `true` stays
 * where the function set it). Members are arrow functions: nothing is read at definition (P16).
 */
export const CoreApi = {
  fetchHealth: (_options?: RequestOptions) =>
    getJson(HealthResponseSchema, "/api/health", { allowUnauthorized: true }),

  registerAccount: (body: RegisterRequest, _options?: RequestOptions) =>
    sendJson("POST", AuthSessionResponseSchema, "/api/auth/register", body, { allowUnauthorized: true }),

  loginWithPassword: (body: LoginRequest, _options?: RequestOptions) =>
    sendJson("POST", AuthSessionResponseSchema, "/api/auth/login", body, { allowUnauthorized: true }),

  logout: (_options?: RequestOptions) =>
    sendVoid("POST", "/api/auth/logout", undefined, { allowUnauthorized: true }),

  fetchMe: (_options?: RequestOptions) =>
    getJson(MeResponseSchema, "/api/auth/me", { allowUnauthorized: true }),

  updateProfile: (body: UpdateProfileRequest, options?: RequestOptions) =>
    sendJson("PATCH", UserResponseSchema, "/api/auth/me", body, options),

  changePassword: (body: ChangePasswordRequest, options?: RequestOptions) =>
    sendVoid("POST", "/api/auth/password", body, options),

  requestPasswordReset: (body: ForgotPasswordRequest, _options?: RequestOptions) =>
    sendVoid("POST", "/api/auth/password/forgot", body, { allowUnauthorized: true }),

  resetPassword: (body: ResetPasswordRequest, _options?: RequestOptions) =>
    sendVoid("POST", "/api/auth/password/reset", body, { allowUnauthorized: true }),

  requestEmailVerification: (options?: RequestOptions) =>
    sendJson("POST", EmailVerificationRequestResponseSchema, "/api/auth/email/verify/request", {}, options),

  confirmEmailVerification: (body: VerifyEmailRequest, _options?: RequestOptions) =>
    sendJson("POST", UserResponseSchema, "/api/auth/email/verify/confirm", body, { allowUnauthorized: true }),

  fetchSessions: (options?: RequestOptions) =>
    getJson(SessionListResponseSchema, "/api/auth/sessions", options),

  revokeSession: (sessionId: string, options?: RequestOptions) =>
    sendVoid("DELETE", `/api/auth/sessions/${seg(sessionId)}`, undefined, options),

  fetchOAuthStartUrl: (provider: OAuthProvider, _options?: RequestOptions) =>
    getJson(OAuthStartResponseSchema, `/api/auth/oauth/${seg(provider)}?json=1`, { allowUnauthorized: true }),

  fetchOAuthProviders: (_options?: RequestOptions) =>
    getJson(OAuthProvidersResponseSchema, "/api/auth/oauth", { allowUnauthorized: true }),

  unlinkOAuthProvider: (provider: OAuthProvider, options?: RequestOptions) =>
    sendVoid("DELETE", `/api/auth/oauth/${seg(provider)}`, undefined, options),

  fetchHouseholds: (options?: RequestOptions) =>
    getJson(HouseholdListResponseSchema, "/api/households", options),

  createHousehold: (body: CreateHouseholdRequest, options?: RequestOptions) =>
    sendJson("POST", HouseholdResponseSchema, "/api/households", body, options),

  fetchInvitePreview: (token: string, _options?: RequestOptions) =>
    getJson(InvitePreviewResponseSchema, `/api/households/invites/${seg(token)}`, { allowUnauthorized: true }),

  acceptInvite: (body: AcceptInviteRequest, options?: RequestOptions) =>
    sendJson("POST", AcceptInviteResponseSchema, "/api/households/invites/accept", body, options),

  fetchHousehold: (householdId: string, options?: RequestOptions) =>
    getJson(HouseholdDetailResponseSchema, `/api/households/${seg(householdId)}`, options),

  updateHousehold: (householdId: string, body: UpdateHouseholdRequest, options?: RequestOptions) =>
    sendJson("PATCH", HouseholdResponseSchema, `/api/households/${seg(householdId)}`, body, options),

  deleteHousehold: (householdId: string, options?: RequestOptions) =>
    sendVoid("DELETE", `/api/households/${seg(householdId)}`, undefined, options),

  fetchHouseholdMembers: (householdId: string, options?: RequestOptions) =>
    getJson(HouseholdMemberListResponseSchema, `/api/households/${seg(householdId)}/members`, options),

  updateMemberRole: (householdId: string, userId: string, body: UpdateMemberRoleRequest, options?: RequestOptions) =>
    sendJson(
      "PATCH",
      HouseholdMemberResponseSchema,
      `/api/households/${seg(householdId)}/members/${seg(userId)}`,
      body,
      options,
    ),

  createPlaceholderMember: (householdId: string, body: CreatePlaceholderMemberRequest, options?: RequestOptions) =>
    sendJson("POST", HouseholdMemberResponseSchema, `/api/households/${seg(householdId)}/members`, body, options),

  renamePlaceholderMember: (
    householdId: string,
    userId: string,
    body: UpdatePlaceholderMemberRequest,
    options?: RequestOptions,
  ) =>
    sendJson(
      "PATCH",
      HouseholdMemberResponseSchema,
      `/api/households/${seg(householdId)}/members/${seg(userId)}/placeholder`,
      body,
      options,
    ),

  removeHouseholdMember: (householdId: string, userId: string, options?: RequestOptions) =>
    sendVoid("DELETE", `/api/households/${seg(householdId)}/members/${seg(userId)}`, undefined, options),

  fetchHouseholdInvites: (householdId: string, query: Partial<PaginationQuery> = {}, options?: RequestOptions) =>
    getJson(
      HouseholdInviteListResponseSchema,
      `/api/households/${seg(householdId)}/invites${queryString({ limit: query.limit, offset: query.offset })}`,
      options,
    ),

  createHouseholdInvite: (householdId: string, body: CreateInviteRequest, options?: RequestOptions) =>
    sendJson("POST", HouseholdInviteResponseSchema, `/api/households/${seg(householdId)}/invites`, body, options),

  revokeHouseholdInvite: (householdId: string, inviteId: string, options?: RequestOptions) =>
    sendVoid("DELETE", `/api/households/${seg(householdId)}/invites/${seg(inviteId)}`, undefined, options),

  enableModule: (
    householdId: string,
    moduleId: ModuleId,
    settings?: Record<string, unknown>,
    options?: RequestOptions,
  ) =>
    sendJson(
      "POST",
      HouseholdResponseSchema,
      `/api/households/${seg(householdId)}/modules/${seg(moduleId)}`,
      settings === undefined ? {} : { settings },
      options,
    ),

  disableModule: (householdId: string, moduleId: ModuleId, options?: RequestOptions) =>
    sendVoid("DELETE", `/api/households/${seg(householdId)}/modules/${seg(moduleId)}`, undefined, options),
};

/* -------------------------------------------------------------------------- */
/* health                                                                     */
/* -------------------------------------------------------------------------- */

export function fetchHealth(options?: RequestOptions): Promise<HealthResponse> {
  return runPromise(CoreApi.fetchHealth(options), options);
}

/* -------------------------------------------------------------------------- */
/* auth                                                                       */
/* -------------------------------------------------------------------------- */

export function registerAccount(
  body: RegisterRequest,
  options?: RequestOptions,
): Promise<AuthSessionResponse> {
  return runPromise(CoreApi.registerAccount(body, options), options);
}

export function loginWithPassword(
  body: LoginRequest,
  options?: RequestOptions,
): Promise<AuthSessionResponse> {
  return runPromise(CoreApi.loginWithPassword(body, options), options);
}

export function logout(options?: RequestOptions): Promise<void> {
  return runPromise(CoreApi.logout(options), options);
}

/** Bootstrap call: user + households + activeHouseholdId. 401 here is normal (= logged out). */
export function fetchMe(options?: RequestOptions): Promise<MeResponse> {
  return runPromise(CoreApi.fetchMe(options), options);
}

export function updateProfile(
  body: UpdateProfileRequest,
  options?: RequestOptions,
): Promise<UserResponse> {
  return runPromise(CoreApi.updateProfile(body, options), options);
}

export function changePassword(
  body: ChangePasswordRequest,
  options?: RequestOptions,
): Promise<void> {
  return runPromise(CoreApi.changePassword(body, options), options);
}

/**
 * "Passwort vergessen" — ALWAYS resolves for a syntactically valid address.
 *
 * The API answers 204 whether or not the account exists (no user enumeration), so
 * the calling screen must show the same confirmation either way and must NOT try to
 * infer anything from the result. A 429 still surfaces, which is intentional.
 */
export function requestPasswordReset(
  body: ForgotPasswordRequest,
  options?: RequestOptions,
): Promise<void> {
  return runPromise(CoreApi.requestPasswordReset(body, options), options);
}

/**
 * Spends a reset token from a mailed link. On success EVERY session of that user is
 * gone — including any this browser held — and the user must sign in again, so the
 * screen navigates to `/login`. 400 `reset_token_invalid` covers
 * unknown/expired/already-used alike.
 */
export function resetPassword(
  body: ResetPasswordRequest,
  options?: RequestOptions,
): Promise<void> {
  return runPromise(CoreApi.resetPassword(body, options), options);
}

/**
 * Mails a confirmation link to the signed-in account's address.
 *
 * `mailDelivery` says whether it really went out — a send can fail without the
 * request failing, so a resolved promise is NOT "the mail is on its way".
 */
export function requestEmailVerification(
  options?: RequestOptions,
): Promise<EmailVerificationRequestResponse> {
  return runPromise(CoreApi.requestEmailVerification(options), options);
}

/**
 * Confirms an address from a mailed link. Works without a session — the link is
 * regularly opened on a different device than the one that is signed in.
 */
export function confirmEmailVerification(
  body: VerifyEmailRequest,
  options?: RequestOptions,
): Promise<UserResponse> {
  return runPromise(CoreApi.confirmEmailVerification(body, options), options);
}

export function fetchSessions(options?: RequestOptions): Promise<SessionListResponse> {
  return runPromise(CoreApi.fetchSessions(options), options);
}

export function revokeSession(sessionId: string, options?: RequestOptions): Promise<void> {
  return runPromise(CoreApi.revokeSession(sessionId, options), options);
}

/**
 * URL to send the browser to for an OAuth login. Must be a real navigation
 * (`window.location.assign`) — not fetch — because the API answers with a 302.
 */
export function oauthStartUrl(provider: OAuthProvider, next?: string): string {
  return apiUrl(`/api/auth/oauth/${seg(provider)}${queryString({ next })}`);
}

/** Same as {@link oauthStartUrl} but returns the provider URL as JSON (`?json=1`). */
export function fetchOAuthStartUrl(
  provider: OAuthProvider,
  options?: RequestOptions,
): Promise<OAuthStartResponse> {
  return runPromise(CoreApi.fetchOAuthStartUrl(provider, options), options);
}

/** Full-page navigation into the provider's consent screen. */
export function startOAuth(provider: OAuthProvider, next?: string): void {
  window.location.assign(oauthStartUrl(provider, next));
}

/**
 * Which providers this deployment configured (+ what the current user linked).
 * Public: a missing session just reports `linked: false`, so `allowUnauthorized`.
 */
export function fetchOAuthProviders(options?: RequestOptions): Promise<OAuthProvidersResponse> {
  return runPromise(CoreApi.fetchOAuthProviders(options), options);
}

/**
 * Attaches a provider to the account that is signed in RIGHT NOW. Also a full-page
 * navigation — the API answers with a 302 into the consent screen and bounces back
 * to `next` with `?linked=<provider>` (or `?error=…`).
 */
export function startOAuthLink(provider: OAuthProvider, next = "/settings"): void {
  window.location.assign(apiUrl(`/api/auth/oauth/${seg(provider)}/link${queryString({ next })}`));
}

/** Detaches a provider. 409 `last_login_method` when it is the only way in. */
export function unlinkOAuthProvider(
  provider: OAuthProvider,
  options?: RequestOptions,
): Promise<void> {
  return runPromise(CoreApi.unlinkOAuthProvider(provider, options), options);
}

/* -------------------------------------------------------------------------- */
/* households, members, invites, modules                                     */
/* -------------------------------------------------------------------------- */

export function fetchHouseholds(options?: RequestOptions): Promise<HouseholdListResponse> {
  return runPromise(CoreApi.fetchHouseholds(options), options);
}

export function createHousehold(
  body: CreateHouseholdRequest,
  options?: RequestOptions,
): Promise<HouseholdResponse> {
  return runPromise(CoreApi.createHousehold(body, options), options);
}

/** Public invite preview for the landing page — works without a session. */
export function fetchInvitePreview(
  token: string,
  options?: RequestOptions,
): Promise<InvitePreviewResponse> {
  return runPromise(CoreApi.fetchInvitePreview(token, options), options);
}

export function acceptInvite(
  body: AcceptInviteRequest,
  options?: RequestOptions,
): Promise<AcceptInviteResponse> {
  return runPromise(CoreApi.acceptInvite(body, options), options);
}

export function fetchHousehold(householdId: string, options?: RequestOptions): Promise<HouseholdDetailResponse> {
  return runPromise(CoreApi.fetchHousehold(householdId, options), options);
}

export function updateHousehold(
  householdId: string,
  body: UpdateHouseholdRequest,
  options?: RequestOptions,
): Promise<HouseholdResponse> {
  return runPromise(CoreApi.updateHousehold(householdId, body, options), options);
}

export function deleteHousehold(householdId: string, options?: RequestOptions): Promise<void> {
  return runPromise(CoreApi.deleteHousehold(householdId, options), options);
}

export function fetchHouseholdMembers(
  householdId: string,
  options?: RequestOptions,
): Promise<HouseholdMemberListResponse> {
  return runPromise(CoreApi.fetchHouseholdMembers(householdId, options), options);
}

export function updateMemberRole(
  householdId: string,
  userId: string,
  body: UpdateMemberRoleRequest,
  options?: RequestOptions,
): Promise<HouseholdMemberResponse> {
  return runPromise(CoreApi.updateMemberRole(householdId, userId, body, options), options);
}

/** Adds a PLACEHOLDER member: a person by name, without an account (admin+, ADR 0006). */
export function createPlaceholderMember(
  householdId: string,
  body: CreatePlaceholderMemberRequest,
  options?: RequestOptions,
): Promise<HouseholdMemberResponse> {
  return runPromise(CoreApi.createPlaceholderMember(householdId, body, options), options);
}

/** Renames a placeholder member (admin+). 409 `member_has_account` for a member with an account. */
export function renamePlaceholderMember(
  householdId: string,
  userId: string,
  body: UpdatePlaceholderMemberRequest,
  options?: RequestOptions,
): Promise<HouseholdMemberResponse> {
  return runPromise(CoreApi.renamePlaceholderMember(householdId, userId, body, options), options);
}

/** Also used to leave a household (pass your own user id). */
export function removeHouseholdMember(
  householdId: string,
  userId: string,
  options?: RequestOptions,
): Promise<void> {
  return runPromise(CoreApi.removeHouseholdMember(householdId, userId, options), options);
}

export function fetchHouseholdInvites(
  householdId: string,
  query: Partial<PaginationQuery> = {},
  options?: RequestOptions,
): Promise<HouseholdInviteListResponse> {
  return runPromise(CoreApi.fetchHouseholdInvites(householdId, query, options), options);
}

export function createHouseholdInvite(
  householdId: string,
  body: CreateInviteRequest,
  options?: RequestOptions,
): Promise<HouseholdInviteResponse> {
  return runPromise(CoreApi.createHouseholdInvite(householdId, body, options), options);
}

export function revokeHouseholdInvite(
  householdId: string,
  inviteId: string,
  options?: RequestOptions,
): Promise<void> {
  return runPromise(CoreApi.revokeHouseholdInvite(householdId, inviteId, options), options);
}

/**
 * Enables a module for a household (admin, verified e-mail). Idempotent; `settings` replaces
 * the stored settings only when sent. Answers the household with its refreshed `modules`.
 */
export function enableModule(
  householdId: string,
  moduleId: ModuleId,
  settings?: Record<string, unknown>,
  options?: RequestOptions,
): Promise<HouseholdResponse> {
  return runPromise(CoreApi.enableModule(householdId, moduleId, settings, options), options);
}

/** Disables a module for a household (admin, verified e-mail). Its data stays in its tables. */
export function disableModule(
  householdId: string,
  moduleId: ModuleId,
  options?: RequestOptions,
): Promise<void> {
  return runPromise(CoreApi.disableModule(householdId, moduleId, options), options);
}

/* -------------------------------------------------------------------------- */
/* grouped facade                                                             */
/* -------------------------------------------------------------------------- */

export const api = {
  health: fetchHealth,
  auth: {
    register: registerAccount,
    login: loginWithPassword,
    logout,
    me: fetchMe,
    updateProfile,
    changePassword,
    requestPasswordReset,
    resetPassword,
    requestEmailVerification,
    confirmEmailVerification,
    sessions: fetchSessions,
    revokeSession,
    oauthStartUrl,
    fetchOAuthStartUrl,
    startOAuth,
    oauthProviders: fetchOAuthProviders,
    startOAuthLink,
    unlinkOAuthProvider,
  },
  households: {
    list: fetchHouseholds,
    create: createHousehold,
    detail: fetchHousehold,
    update: updateHousehold,
    remove: deleteHousehold,
    members: fetchHouseholdMembers,
    updateMemberRole,
    createPlaceholderMember,
    renamePlaceholderMember,
    removeMember: removeHouseholdMember,
    invites: fetchHouseholdInvites,
    createInvite: createHouseholdInvite,
    revokeInvite: revokeHouseholdInvite,
    invitePreview: fetchInvitePreview,
    acceptInvite,
    enableModule,
    disableModule,
  },
};
