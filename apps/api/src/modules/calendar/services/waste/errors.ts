/**
 * The waste import's refusals (plan m8 P17, P18, P19): one constructor per wire shape, so the extractor, the fetch, the
 * parser's caller and the upload reader answer the same envelopes.
 *
 * - `wasteUnparseable(check, extra)`: `422 calendar_waste_unparseable`, `details: [{ check, message, i18n, date?, readings? }]`
 *   (`message` is the check's catalog text in the default locale, as `CalendarMembers.assertMembers` writes its details;
 *   `i18n.key` lets the client show its own language).
 * - `wasteSourceRefused()`: `400 calendar_waste_source_refused` (scheme or host, on the first URL or on a redirect hop).
 * - `wasteFetchFailed(reason)`: `502 calendar_waste_fetch_failed`, `details: [{ reason }]`.
 *
 * Pure: imports only the shared catalog and the error family (no runtime, no service).
 */
import { DEFAULT_LOCALE, serverText } from "@toon/shared";
import { ApiFailure } from "../../../../lib/errors.ts";

/** The parser's and the extractor's check names (P19), each with its `server.calendar.wasteCheck.<check>` text. */
export type WasteCheck =
  | "notPdf"
  | "encrypted"
  | "pages"
  | "timeout"
  | "year"
  | "months"
  | "consensus"
  | "values"
  | "tourCount"
  | "sundays"
  | "noTourDates";

/** Why fetching the flyer failed (P17). */
export type WasteFetchReason = "network" | "status" | "redirects" | "timeout" | "tooLarge";

/** What a refusal may add to its one `details` item: the date it found and, for `consensus`, the two readings. */
export interface WasteUnparseableExtra {
  readonly date?: string | undefined;
  readonly readings?: ReadonlyArray<unknown> | undefined;
}

/** `422 calendar_waste_unparseable` naming the failed check. */
export function wasteUnparseable(check: WasteCheck, extra: WasteUnparseableExtra = {}): ApiFailure {
  const key = `server.calendar.wasteCheck.${check}` as const;
  return new ApiFailure({
    status: 422,
    code: "calendar_waste_unparseable",
    text: "server.calendar.wasteUnparseable",
    details: [
      {
        check,
        message: serverText(DEFAULT_LOCALE, key),
        i18n: { key },
        ...(extra.date === undefined ? {} : { date: extra.date }),
        ...(extra.readings === undefined ? {} : { readings: extra.readings }),
      },
    ],
  });
}

/** `400 calendar_waste_source_refused`: the URL is not https or its host is not the provider's (also a redirect hop). */
export function wasteSourceRefused(): ApiFailure {
  return new ApiFailure({ status: 400, code: "calendar_waste_source_refused", text: "server.calendar.wasteSourceRefused" });
}

/** `502 calendar_waste_fetch_failed` with `details: [{ reason }]`. */
export function wasteFetchFailed(reason: WasteFetchReason): ApiFailure {
  return new ApiFailure({
    status: 502,
    code: "calendar_waste_fetch_failed",
    text: "server.calendar.wasteFetchFailed",
    details: [{ reason }],
  });
}
