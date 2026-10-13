/**
 * The typed API client — the ONLY place in the web app that talks to the network.
 *
 * Rules for every other frontend module:
 *  - never call `fetch` yourself, import a function from here,
 *  - every argument/return type comes from `@toon/shared` (the frozen contract),
 *  - errors are always an {@link ApiError} (code + message + HTTP status).
 *
 * Module API files (`apps/web/src/modules/<id>/api.ts`) build on {@link request};
 * they never call `fetch` (SPEC §2).
 *
 * Session handling: the API sets an HttpOnly cookie, so every request goes out with
 * `credentials: "include"`. A 401 on a guarded endpoint triggers the global
 * unauthorized handler (see {@link setUnauthorizedHandler}) which sends the user to
 * `/login?next=<current path>`.
 */
import {
  MAX_UPLOAD_BYTES,
  type AcceptInviteRequest,
  type AcceptInviteResponse,
  type AuthSessionResponse,
  type ChangePasswordRequest,
  type CreateHouseholdRequest,
  type CreateInviteRequest,
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
  type UpdateProfileRequest,
  type UserResponse,
  type VerifyEmailRequest,
} from "@toon/shared";
import { getLocale, translate } from "@/lib/i18n/store.ts";

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
  "http://localhost:3001"
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
 * Every failed request throws this. `code` is one of `ERROR_CODES` from
 * `@toon/shared` (plus the client-only codes `network_error` / `client_error`).
 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(options: { code: string; message: string; status: number; details?: unknown }) {
    super(options.message);
    this.name = "ApiError";
    this.code = options.code;
    this.status = options.status;
    this.details = options.details;
  }

  /** 4xx = the user can fix it; retrying is pointless. */
  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  get isOffline(): boolean {
    return this.code === "network_error";
  }
}

/** Alias for code that already imports a type called `ApiError` from @toon/shared. */
export { ApiError as ApiClientError };

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** User-facing message for any thrown value, in the active locale. Safe to render directly. */
export function errorMessage(error: unknown): string {
  if (isApiError(error)) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return translate("common.error.unknown");
}

/* -------------------------------------------------------------------------- */
/* 401 handling                                                               */
/* -------------------------------------------------------------------------- */

type UnauthorizedHandler = (next: string) => void;

let unauthorizedHandler: UnauthorizedHandler | null = null;
let lastRedirectAt = 0;

/**
 * Registered once by the router/session provider so a 401 can be handled with a
 * client-side navigation instead of a full page load.
 */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler;
}

function handleUnauthorized(): void {
  if (typeof window === "undefined") return;
  const { pathname, search, hash } = window.location;
  if (pathname === "/login" || pathname === "/register" || pathname.startsWith("/invite/")) return;
  // Never loop: at most one redirect per second.
  const now = Date.now();
  if (now - lastRedirectAt < 1000) return;
  lastRedirectAt = now;

  const next = `${pathname}${search}${hash}`;
  if (unauthorizedHandler) {
    unauthorizedHandler(next);
    return;
  }
  window.location.assign(`/login?next=${encodeURIComponent(next)}`);
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

export interface RequestOptions {
  signal?: AbortSignal | undefined;
  /** Skip the global 401 -> /login redirect (bootstrap + auth screens use this). */
  allowUnauthorized?: boolean;
}

interface RequestInput extends RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** JSON body — serialised automatically. Use `form` for multipart. */
  body?: unknown;
  form?: FormData;
}

export async function request<T>(path: string, input: RequestInput = {}): Promise<T> {
  const { method = "GET", body, form, signal, allowUnauthorized } = input;

  // Accept-Language is CORS-safelisted, so this adds no preflight and no CORS
  // change — the server negotiates `message`'s locale from it (docs/i18n.md §4).
  const headers: Record<string, string> = { Accept: "application/json", "Accept-Language": getLocale() };
  let payload: BodyInit | undefined;
  if (form) {
    payload = form; // fetch sets the multipart boundary itself
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      method,
      credentials: "include",
      headers,
      body: payload,
      signal: signal ?? null,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new ApiError({
      code: "network_error",
      status: 0,
      message: translate("common.error.network"),
      details: cause,
    });
  }

  if (response.status === 401 && !allowUnauthorized) handleUnauthorized();

  if (response.status === 204 || response.status === 205) return undefined as T;

  const raw = await response.text();
  let parsed: unknown = undefined;
  if (raw.length > 0) {
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      parsed = undefined;
    }
  }

  if (!response.ok) throw toApiError(response.status, parsed, raw);
  return parsed as T;
}

function toApiError(status: number, parsed: unknown, raw: string): ApiError {
  const envelope =
    typeof parsed === "object" && parsed !== null && "error" in parsed
      ? (parsed as { error?: { code?: unknown; message?: unknown; details?: unknown } }).error
      : undefined;

  const code = typeof envelope?.code === "string" ? envelope.code : fallbackCode(status);
  const message =
    typeof envelope?.message === "string" && envelope.message.length > 0
      ? envelope.message
      : fallbackMessage(status, raw);

  return new ApiError({ code, message, status, details: envelope?.details });
}

function fallbackCode(status: number): string {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 413) return "payload_too_large";
  if (status === 415) return "unsupported_media_type";
  if (status === 422) return "validation_failed";
  if (status >= 500) return "internal_error";
  return "bad_request";
}

function fallbackMessage(status: number, raw: string): string {
  switch (status) {
    case 401:
      return translate("common.error.unauthorized");
    case 403:
      return translate("common.error.forbidden");
    case 404:
      return translate("common.error.notFound");
    case 409:
      return translate("common.error.conflict");
    case 413:
      return translate("common.error.payloadTooLarge");
    case 415:
      return translate("common.error.unsupportedMediaType");
    case 422:
      return translate("common.error.validationFailed");
    default:
      return status >= 500 ? translate("common.error.serverError") : raw.slice(0, 200) || translate("common.error.requestFailed");
  }
}

/** Client-side guard so a 15 MB+ file never leaves the phone. */
export function assertUploadSize(file: File): void {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new ApiError({
      code: "payload_too_large",
      status: 413,
      message: translate("common.upload.tooLarge", {
        filename: file.name,
        size: (file.size / (1024 * 1024)).toFixed(1),
      }),
    });
  }
}

export function fileForm(file: File): FormData {
  assertUploadSize(file);
  const form = new FormData();
  // The API expects exactly one field named `file` (ImportFileFieldName).
  form.append("file", file, file.name);
  return form;
}

/* -------------------------------------------------------------------------- */
/* health                                                                     */
/* -------------------------------------------------------------------------- */

export function fetchHealth(options?: RequestOptions): Promise<HealthResponse> {
  return request<HealthResponse>("/api/health", { ...options, allowUnauthorized: true });
}

/* -------------------------------------------------------------------------- */
/* auth                                                                       */
/* -------------------------------------------------------------------------- */

export function registerAccount(
  body: RegisterRequest,
  options?: RequestOptions,
): Promise<AuthSessionResponse> {
  return request<AuthSessionResponse>("/api/auth/register", {
    ...options,
    method: "POST",
    body,
    allowUnauthorized: true,
  });
}

export function loginWithPassword(
  body: LoginRequest,
  options?: RequestOptions,
): Promise<AuthSessionResponse> {
  return request<AuthSessionResponse>("/api/auth/login", {
    ...options,
    method: "POST",
    body,
    allowUnauthorized: true,
  });
}

export function logout(options?: RequestOptions): Promise<void> {
  return request<void>("/api/auth/logout", {
    ...options,
    method: "POST",
    allowUnauthorized: true,
  });
}

/** Bootstrap call: user + households + activeHouseholdId. 401 here is normal (= logged out). */
export function fetchMe(options?: RequestOptions): Promise<MeResponse> {
  return request<MeResponse>("/api/auth/me", { ...options, allowUnauthorized: true });
}

export function updateProfile(
  body: UpdateProfileRequest,
  options?: RequestOptions,
): Promise<UserResponse> {
  return request<UserResponse>("/api/auth/me", { ...options, method: "PATCH", body });
}

export function changePassword(
  body: ChangePasswordRequest,
  options?: RequestOptions,
): Promise<void> {
  return request<void>("/api/auth/password", { ...options, method: "POST", body });
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
  return request<void>("/api/auth/password/forgot", {
    ...options,
    method: "POST",
    body,
    allowUnauthorized: true,
  });
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
  return request<void>("/api/auth/password/reset", {
    ...options,
    method: "POST",
    body,
    allowUnauthorized: true,
  });
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
  return request<EmailVerificationRequestResponse>("/api/auth/email/verify/request", {
    ...options,
    method: "POST",
    body: {},
  });
}

/**
 * Confirms an address from a mailed link. Works without a session — the link is
 * regularly opened on a different device than the one that is signed in.
 */
export function confirmEmailVerification(
  body: VerifyEmailRequest,
  options?: RequestOptions,
): Promise<UserResponse> {
  return request<UserResponse>("/api/auth/email/verify/confirm", {
    ...options,
    method: "POST",
    body,
    allowUnauthorized: true,
  });
}

export function fetchSessions(options?: RequestOptions): Promise<SessionListResponse> {
  return request<SessionListResponse>("/api/auth/sessions", options);
}

export function revokeSession(sessionId: string, options?: RequestOptions): Promise<void> {
  return request<void>(`/api/auth/sessions/${encodeURIComponent(sessionId)}`, {
    ...options,
    method: "DELETE",
  });
}

/**
 * URL to send the browser to for an OAuth login. Must be a real navigation
 * (`window.location.assign`) — not fetch — because the API answers with a 302.
 */
export function oauthStartUrl(provider: OAuthProvider, next?: string): string {
  return apiUrl(`/api/auth/oauth/${provider}${queryString({ next })}`);
}

/** Same as {@link oauthStartUrl} but returns the provider URL as JSON (`?json=1`). */
export function fetchOAuthStartUrl(
  provider: OAuthProvider,
  options?: RequestOptions,
): Promise<OAuthStartResponse> {
  return request<OAuthStartResponse>(`/api/auth/oauth/${provider}?json=1`, {
    ...options,
    allowUnauthorized: true,
  });
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
  return request<OAuthProvidersResponse>("/api/auth/oauth", {
    ...options,
    allowUnauthorized: true,
  });
}

/**
 * Attaches a provider to the account that is signed in RIGHT NOW. Also a full-page
 * navigation — the API answers with a 302 into the consent screen and bounces back
 * to `next` with `?linked=<provider>` (or `?error=…`).
 */
export function startOAuthLink(provider: OAuthProvider, next = "/settings"): void {
  window.location.assign(apiUrl(`/api/auth/oauth/${provider}/link${queryString({ next })}`));
}

/** Detaches a provider. 409 `last_login_method` when it is the only way in. */
export function unlinkOAuthProvider(
  provider: OAuthProvider,
  options?: RequestOptions,
): Promise<void> {
  return request<void>(`/api/auth/oauth/${provider}`, { ...options, method: "DELETE" });
}

/* -------------------------------------------------------------------------- */
/* households, members, invites, modules                                     */
/* -------------------------------------------------------------------------- */

export function fetchHouseholds(options?: RequestOptions): Promise<HouseholdListResponse> {
  return request<HouseholdListResponse>("/api/households", options);
}

export function createHousehold(
  body: CreateHouseholdRequest,
  options?: RequestOptions,
): Promise<HouseholdResponse> {
  return request<HouseholdResponse>("/api/households", { ...options, method: "POST", body });
}

/** Public invite preview for the landing page — works without a session. */
export function fetchInvitePreview(
  token: string,
  options?: RequestOptions,
): Promise<InvitePreviewResponse> {
  return request<InvitePreviewResponse>(`/api/households/invites/${encodeURIComponent(token)}`, {
    ...options,
    allowUnauthorized: true,
  });
}

export function acceptInvite(
  body: AcceptInviteRequest,
  options?: RequestOptions,
): Promise<AcceptInviteResponse> {
  return request<AcceptInviteResponse>("/api/households/invites/accept", {
    ...options,
    method: "POST",
    body,
  });
}

export function fetchHousehold(householdId: string, options?: RequestOptions): Promise<HouseholdDetailResponse> {
  return request<HouseholdDetailResponse>(`/api/households/${householdId}`, options);
}

export function updateHousehold(
  householdId: string,
  body: UpdateHouseholdRequest,
  options?: RequestOptions,
): Promise<HouseholdResponse> {
  return request<HouseholdResponse>(`/api/households/${householdId}`, { ...options, method: "PATCH", body });
}

export function deleteHousehold(householdId: string, options?: RequestOptions): Promise<void> {
  return request<void>(`/api/households/${householdId}`, { ...options, method: "DELETE" });
}

export function fetchHouseholdMembers(
  householdId: string,
  options?: RequestOptions,
): Promise<HouseholdMemberListResponse> {
  return request<HouseholdMemberListResponse>(`/api/households/${householdId}/members`, options);
}

export function updateMemberRole(
  householdId: string,
  userId: string,
  body: UpdateMemberRoleRequest,
  options?: RequestOptions,
): Promise<HouseholdMemberResponse> {
  return request<HouseholdMemberResponse>(`/api/households/${householdId}/members/${userId}`, {
    ...options,
    method: "PATCH",
    body,
  });
}

/** Also used to leave a household (pass your own user id). */
export function removeHouseholdMember(
  householdId: string,
  userId: string,
  options?: RequestOptions,
): Promise<void> {
  return request<void>(`/api/households/${householdId}/members/${userId}`, {
    ...options,
    method: "DELETE",
  });
}

export function fetchHouseholdInvites(
  householdId: string,
  query: Partial<PaginationQuery> = {},
  options?: RequestOptions,
): Promise<HouseholdInviteListResponse> {
  return request<HouseholdInviteListResponse>(
    `/api/households/${householdId}/invites${queryString({ limit: query.limit, offset: query.offset })}`,
    options,
  );
}

export function createHouseholdInvite(
  householdId: string,
  body: CreateInviteRequest,
  options?: RequestOptions,
): Promise<HouseholdInviteResponse> {
  return request<HouseholdInviteResponse>(`/api/households/${householdId}/invites`, {
    ...options,
    method: "POST",
    body,
  });
}

export function revokeHouseholdInvite(
  householdId: string,
  inviteId: string,
  options?: RequestOptions,
): Promise<void> {
  return request<void>(`/api/households/${householdId}/invites/${inviteId}`, {
    ...options,
    method: "DELETE",
  });
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
  return request<HouseholdResponse>(`/api/households/${householdId}/modules/${moduleId}`, {
    ...options,
    method: "POST",
    body: settings === undefined ? {} : { settings },
  });
}

/** Disables a module for a household (admin, verified e-mail). Its data stays in its tables. */
export function disableModule(
  householdId: string,
  moduleId: ModuleId,
  options?: RequestOptions,
): Promise<void> {
  return request<void>(`/api/households/${householdId}/modules/${moduleId}`, {
    ...options,
    method: "DELETE",
  });
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
