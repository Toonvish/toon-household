/**
 * Saved cards ("Karten") — wire contract.
 *
 * A card is a loyalty/membership barcode the user keeps in the app so the plastic
 * one can stay at home: Payback, DeutschlandCard, the gym, the library. The
 * shopping list is the screen it is used from, but the DATA IS THE USER'S, NOT
 * THE HOUSEHOLD'S — the one entity in this app that is, and it is a deliberate
 * exception to "households own the content":
 *
 *  - a loyalty number is tied to a person, not to a household, and it is worth
 *    money and points; putting it in a household would share it with every flatmate
 *    who was ever invited, retroactively and irreversibly,
 *  - it must follow the user into every household they belong to, because the card in
 *    their wallet does,
 *  - nothing about it is collaborative: no merging, no positions, no provenance.
 *
 * So the endpoints live at `/api/cards` (see apps/api/src/routes/cards.ts) with
 * `requireSession()` and no household middleware at all, and `householdId` appears
 * nowhere in this file.
 *
 * Values are NORMALISED and CHECK-DIGIT VALIDATED by these schemas (../barcode.ts),
 * because a card that scans as "unknown member" at a till is the failure this
 * feature exists to avoid and the check digit is the only evidence available at
 * save time.
 */
import { z } from "zod";
import {
  BARCODE_FORMATS,
  checkBarcodeValue,
  normalizeBarcodeValue,
  type BarcodeFormat,
  type BarcodeValueReason,
} from "../barcode.ts";
import type { ServerKey } from "../../../core/i18n/catalogs/index.ts";
import { IdSchema, IsoDateSchema } from "../../../core/schemas/common.ts";

/** Upper bounds, mirrored by the UI so a phone never sends a doomed request. */
export const CARD_LIMITS = {
  /** Per USER, not per household. A wallet does not hold fifty cards either. */
  perUser: 50,
  labelMax: 60,
  /** Matches the longest value any supported symbology accepts (QR). */
  valueMax: 512,
  noteMax: 300,
} as const;

/** The symbologies a card may be saved as — see ../barcode.ts for why these. */
export const BarcodeFormatSchema = z.enum(BARCODE_FORMATS);

/* --------------------------------- entities ------------------------------- */

export const CardSchema = z.object({
  id: IdSchema,
  /** What the user calls it: "Payback", "Rewe", "Stadtbibliothek". */
  label: z.string(),
  format: BarcodeFormatSchema,
  /** Normalised: digits only for the numeric formats, check digit included. */
  value: z.string(),
  note: z.string().nullable(),
  /**
   * When the card was last SHOWN, which is what the list is ordered by — the
   * card you used yesterday is the one you want at the till today. Null until
   * it has been shown once.
   */
  lastUsedAt: IsoDateSchema.nullable(),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
});
export type Card = z.infer<typeof CardSchema>;

/* -------------------------------- validation ------------------------------ */

/**
 * The catalog key for each way a value can be wrong. One key per REASON rather
 * than one per format: "check digit does not match" reads the same whether the
 * card is an EAN-13 or a UPC-A, and the format is already on screen.
 */
const VALUE_ISSUE_KEYS: Readonly<Record<BarcodeValueReason, ServerKey>> = {
  empty: "server.card.valueEmpty",
  too_long: "server.card.valueTooLong",
  digits_only: "server.card.valueDigitsOnly",
  wrong_length: "server.card.valueWrongLength",
  odd_length: "server.card.valueOddLength",
  charset: "server.card.valueCharset",
  check_digit: "server.card.valueCheckDigit",
};

/** The catalog key for `value`'s problem, or `null` when there is none. */
export function cardValueIssueKey(format: BarcodeFormat, value: string): ServerKey | null {
  const reason = checkBarcodeValue(format, value);
  return reason === null ? null : VALUE_ISSUE_KEYS[reason];
}

/**
 * Adds the keyed `value` issue to a parse, if any.
 *
 * The issue's path is `["value"]` so the web form marks the field the user has
 * to fix, and `params.i18n` carries the key so BOTH sides can render it in their
 * own language (see `refineKey`/`resolveZodIssue` in ../i18n/zod.ts — a schema
 * never carries a sentence).
 */
function checkValue(
  input: { format: BarcodeFormat; value: string },
  ctx: z.RefinementCtx,
): void {
  const key = cardValueIssueKey(input.format, input.value);
  if (key === null) return;
  ctx.addIssue({ code: "custom", path: ["value"], params: { i18n: key } });
}

/**
 * `value` as it will be stored: separators stripped, case fixed, a missing
 * EAN/UPC check digit completed. Applied on the SERVER as well as in the form,
 * so an older client (or a hand-written request) cannot store a value the
 * display path would refuse to encode.
 */
function normalized<T extends { format: BarcodeFormat; value: string }>(input: T): T {
  return { ...input, value: normalizeBarcodeValue(input.format, input.value) };
}

/* --------------------------------- requests ------------------------------- */

const cardFields = {
  label: z.string().trim().min(1).max(CARD_LIMITS.labelMax),
  format: BarcodeFormatSchema,
  value: z.string().trim().min(1).max(CARD_LIMITS.valueMax),
  note: z.string().trim().max(CARD_LIMITS.noteMax).nullish(),
};

export const CreateCardRequestSchema = z
  .object(cardFields)
  .transform(normalized)
  .superRefine(checkValue);
export type CreateCardRequest = z.input<typeof CreateCardRequestSchema>;
/** What a handler sees AFTER normalisation — the shape written to the row. */
export type CreateCardInput = z.output<typeof CreateCardRequestSchema>;

/**
 * PATCH. `format` and `value` travel TOGETHER or not at all: a value cannot be
 * check-digit validated without knowing its symbology, and changing one without
 * the other is how a stored value stops matching its format. The web form sends
 * every field anyway; this only closes the door on a hand-written request.
 */
export const UpdateCardRequestSchema = z
  .object({
    label: cardFields.label.optional(),
    format: cardFields.format.optional(),
    value: cardFields.value.optional(),
    note: cardFields.note,
  })
  .refine(
    (input) => (input.format === undefined) === (input.value === undefined),
    { params: { i18n: "server.card.formatAndValue" satisfies ServerKey }, path: ["value"] },
  )
  .refine(
    (input) => Object.values(input).some((field) => field !== undefined),
    { params: { i18n: "server.validation.noChanges" satisfies ServerKey } },
  )
  .transform((input) =>
    input.format === undefined || input.value === undefined
      ? input
      : { ...input, value: normalizeBarcodeValue(input.format, input.value) },
  )
  .superRefine((input, ctx) => {
    if (input.format === undefined || input.value === undefined) return;
    checkValue({ format: input.format, value: input.value }, ctx);
  });
export type UpdateCardRequest = z.input<typeof UpdateCardRequestSchema>;
export type UpdateCardInput = z.output<typeof UpdateCardRequestSchema>;

/* -------------------------------- responses ------------------------------- */

/**
 * The whole wallet, newest use first. NOT the `{ items, total, limit, offset }`
 * envelope: `CARD_LIMITS.perUser` is the page size, so a paginated wallet would
 * be a contract nobody could use and a screen nobody could render offline.
 */
export const CardListResponseSchema = z.object({ items: z.array(CardSchema) });
export type CardListResponse = z.infer<typeof CardListResponseSchema>;

export const CardResponseSchema = z.object({ card: CardSchema });
export type CardResponse = z.infer<typeof CardResponseSchema>;
