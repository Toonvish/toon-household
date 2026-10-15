import { z } from "zod";
import { refineKey } from "../i18n/zod.ts";

/** All ids are crypto.randomUUID() strings. */
export const IdSchema = z.uuid();
export type Id = z.infer<typeof IdSchema>;

/** All timestamps travel over the wire as ISO-8601 strings (stored as unix ms). */
export const IsoDateSchema = z.iso.datetime({ offset: true });
export type IsoDate = z.infer<typeof IsoDateSchema>;

/** True for `http:`/`https:` URLs and nothing else. */
export function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * A link that is safe to put into an `href`. Used for every URL a CLIENT may
 * send (recipe `sourceUrl`, draft `sourceUrl`): without it, a group member could
 * store `javascript:…` and have it execute on the app origin, with the victim's
 * session, as soon as an admin clicked the "Quelle" link.
 *
 * Response schemas stay a plain string on purpose so a legacy row can still be
 * read — the UI defends itself with `safeHttpUrl()` in apps/web/src/lib/format.ts.
 */
export const HttpUrlSchema = z
  .string()
  .max(2000)
  .refine(isHttpUrl, refineKey("server.validation.httpUrlOnly"));

/** Machine-readable error codes. `ApiError.code` is a plain string for forward compat. */
export const ERROR_CODES = [
  "bad_request",
  "validation_failed",
  "unauthorized",
  "invalid_credentials",
  "forbidden",
  "not_found",
  "conflict",
  "email_taken",
  "group_name_taken",
  "tag_name_taken",
  "shopping_list_name_taken",
  /** This user already saved a card with the same symbology and number. */
  "card_already_saved",
  /** The user already has `CARD_LIMITS.perUser` saved cards. */
  "too_many_cards",
  /** The list already holds `SHOPPING_LIMITS.itemsPerList` lines. */
  "shopping_list_full",
  /** The household already has `SHOPPING_LIMITS.listsPerHousehold` lists. */
  "too_many_shopping_lists",
  "invite_invalid",
  "invite_expired",
  /** The member already has an account: a placeholder action on a real account (ADR 0006). */
  "member_has_account",
  /** A claim invite is redeemed only by registration, never by `POST …/invites/accept` (ADR 0006). */
  "invite_claim_requires_register",
  /**
   * A password-reset token is unknown, expired or already used. ONE code for all
   * three on purpose: telling them apart would confirm that a token existed.
   */
  "reset_token_invalid",
  /** An e-mail-confirmation token is unknown, expired or already used. */
  "verification_token_invalid",
  "last_owner",
  /**
   * The account's e-mail address has never been confirmed, and this deployment
   * makes such an account READ-ONLY (see `features.verifiedEmailRequired`).
   *
   * 403, not 401: the session is perfectly valid and every GET still works, so
   * a client must not react by logging the user out. Distinct from `forbidden`,
   * which means "this account may never do this" — here the user can lift it
   * themselves by clicking the link in their confirmation mail, and the UI keys
   * off the code to offer exactly that.
   */
  "email_unverified",
  "payload_too_large",
  "unsupported_media_type",
  "rate_limited",
  "fetch_failed",
  "parse_failed",
  "ocr_failed",
  "pdf_no_text_layer",
  /**
   * Photo/PDF import is switched off on this deployment (IMPORT_OCR_ENABLED).
   * 501, not 503: it is a property of how the server was configured/built, not a
   * temporary outage, and retrying will not help. Distinct from `ocr_failed`,
   * which means OCR ran (or tried to) and could not deliver.
   */
  "ocr_disabled",
  "oauth_failed",
  "oauth_not_configured",
  /** The provider identity is already attached to another account. */
  "oauth_already_linked",
  /** Unlinking would leave the user with no way to sign in. */
  "last_login_method",
  "internal_error",
  /** A single day already holds `PLAN_LIMITS.entriesPerDay` planned recipes. */
  "meal_plan_day_full",
  /**
   * The household has not enabled the module this route belongs to (SPEC D2/D8).
   * 404, not 403: for that household the module's routes do not exist.
   */
  "module_disabled",
  /** Finance (F docs/spec.md §3.2): a transaction amount of 0 is rejected. */
  "transaction_amount_zero",
  /** Finance: a fixed-cost-plan booking is read-only; only the plan can change it. */
  "transaction_generated",
  /** Finance: the balance the client quoted is no longer current. */
  "balance_stale",
  /** Finance: a settlement amount must be greater than 0. */
  "settlement_amount_invalid",
  /** Finance: a category still has transactions and cannot be removed. */
  "category_in_use",
  /** Finance: a system category cannot be changed. */
  "category_system",
  /** Finance: another category of this household already has that slug. */
  "category_slug_taken",
  /** Finance: the fixed-cost plan is not enabled for this household. */
  "plan_disabled",
  /** Finance: the plan lacks fixed costs or an income for the calculation. */
  "plan_incomplete",
  /** Finance: a booking already exists for the requested period. */
  "plan_period_locked",
  /** Finance: the requested period lies outside the plan's range. */
  "plan_period_out_of_range",
  /** Finance (M3 decision 3): a household member without a participant slot may not read or write the ledger. */
  "finance_not_participant",
  /** Finance (M3 decision 4): the participants must be exactly two different household members in slots 1 and 2. */
  "finance_participants_required",
  /** Finance (M3 decision 4): a participant who has ledger entries cannot give up their slot. */
  "finance_participant_in_use",
  /** Finance (toon-finance, SPEC D13): a seated participant with ledger entries cannot leave the household. */
  "member_has_ledger",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** The one and only error envelope every endpoint uses. */
export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

/**
 * One entry of a `validation_failed` error's `details` array.
 *
 * `message` is rendered in the locale the request negotiated — display it if
 * you cannot use `i18n`. `i18n` is the structured form, so a client can
 * re-render the issue in ITS OWN active locale regardless of what the server
 * negotiated; resolve it with `resolveWireKey`, never with a cast to a
 * catalog's key type (see the i18n runtime's `resolveWireKey`).
 *
 * `path` is a `string` on the wire (`issue.path.join(".")`), not an array —
 * `fromIssues` in apps/web/src/lib/validation.ts accepts both shapes because an
 * older server-side branch used to send an array and some code still tests for
 * it; see docs/i18n.md §4 for why that matters for where a field error lands.
 */
export const ValidationIssueSchema = z.object({
  path: z.string(),
  code: z.string(),
  message: z.string(),
  i18n: z
    .object({
      key: z.string(),
      values: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
    })
    .optional(),
});
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;

/** Shared list envelope: `{ items, total, limit, offset }`. */
export function listResponse<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
  });
}

/** Query params for every paginated list endpoint (strings are coerced). */
export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(24),
  offset: z.coerce.number().int().min(0).default(0),
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

/**
 * Optional parts of the app a deployment can be built or configured without.
 *
 * Core features are named here; each module's `healthFeatures()` merges its own booleans in (SPEC §2) —
 * recipe's `ocrImport`/`pdfImport` arrive through its `healthFeatures()`. An unknown key reads as unavailable.
 *
 * This is what lets the UI stop offering something the server cannot do, instead
 * of showing a button that answers 501. It rides on `/api/health` because that is
 * already the "what is this server" probe, needs no session, and is never cached
 * by the service worker — so the answer is always the running server's, and a
 * self-hoster debugging a missing button finds it in the same place ops does.
 */
export const ServerFeaturesSchema = z.object({
  /**
   * This deployment makes an account with an UNCONFIRMED address read-only:
   * every write answers 403 `email_unverified` until the address is confirmed.
   * It follows whether mail is configured at all — a server that cannot send a
   * confirmation link must not gate anything on clicking one.
   *
   * UNKNOWN READS AS `false`, which is the opposite bias from `ocrImport`, and
   * deliberately so. Guessing "off" for a capability hides one button until the
   * probe lands; guessing "on" for this would grey out every write in the app
   * and tell the user to confirm an address a server of that vintage never asks
   * about. The 403 remains the enforcement either way — this field only decides
   * what the UI offers, never what the server allows.
   */
  verifiedEmailRequired: z.boolean().optional(),
}).catchall(z.boolean());
export type ServerFeatures = z.infer<typeof ServerFeaturesSchema>;

/** GET /api/health */
export const HealthResponseSchema = z.object({
  /** Always true on a healthy answer; what uptime probes and the M0 exit check read. */
  ok: z.literal(true),
  status: z.literal("ok"),
  version: z.string(),
  time: IsoDateSchema,
  database: z.enum(["file", "remote"]),
  /** The modules this BUILD contains (SPEC §2), not what a household enabled. Strings, not `ModuleId`, so an old client tolerates a newer server. */
  modules: z.array(z.string()),
  /**
   * Optional so an OLD client can still read a NEW server's health, and — more
   * to the point — so a new client treats a server that predates the field as
   * "feature unknown" rather than crashing. The web app resolves unknown to
   * "hide it": briefly hiding an available button is self-correcting, offering a
   * missing one is not.
   */
  features: ServerFeaturesSchema.optional(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/**
 * What became of a mail the request tried to send.
 *
 * THREE states, not a boolean, because the two non-deliveries need different copy
 * and only the server can tell them apart:
 *
 *  - `sent`           — a configured transport accepted the message.
 *  - `not_configured` — no MAIL_TRANSPORT: the ConsoleMailer wrote the link to the
 *                       log. A working self-hosted install, nothing is broken, the
 *                       link just has to be forwarded by hand.
 *  - `failed`         — a configured transport REFUSED it (expired API key,
 *                       unverified sender domain, relay down). Somebody has to look
 *                       at `docker compose logs app`.
 *
 * The action that triggered the send never fails over this (see `trySendMail`), so
 * this is a status, not an error — but the UI must not report the last two as
 * success. Collapsing them into one boolean is how the invite panel came to greet
 * an install with no mail configured with "Eine E-Mail ist unterwegs".
 */
export const MailDeliverySchema = z.enum(["sent", "not_configured", "failed"]);
export type MailDelivery = z.infer<typeof MailDeliverySchema>;

/** Response of every "no body needed but say something" mutation. */
export const OkResponseSchema = z.object({ ok: z.literal(true) });
export type OkResponse = z.infer<typeof OkResponseSchema>;

/** Result of an upload endpoint (recipe image, avatar). */
export const UploadResponseSchema = z.object({
  url: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
});
export type UploadResponse = z.infer<typeof UploadResponseSchema>;

/** Hard limit for every upload (bytes). Enforced by the API, mirrored in the UI. */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export const ACCEPTED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/avif",
] as const;

export const ACCEPTED_PDF_MIME_TYPES = ["application/pdf"] as const;
