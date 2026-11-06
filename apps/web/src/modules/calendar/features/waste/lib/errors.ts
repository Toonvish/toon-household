/**
 * What a refused waste preview or import says (plan m8 P17, P18): one sentence per error code, the fetch failure
 * by its `reason`, the parser's refusal by its `check`. The server's own message is the fallback for anything
 * this table does not know (a rate limit, a newer server).
 */
import { isApiError } from "@/modules/calendar/lib/api";
import { translate, type MessageKey } from "@/lib/i18n";

const FETCH_REASONS = {
  network: "calendar.waste.error.fetch.network",
  status: "calendar.waste.error.fetch.status",
  redirects: "calendar.waste.error.fetch.redirects",
  timeout: "calendar.waste.error.fetch.timeout",
  tooLarge: "calendar.waste.error.fetch.tooLarge",
} as const satisfies Record<string, MessageKey>;

const CHECKS = {
  notPdf: "calendar.waste.error.check.notPdf",
  encrypted: "calendar.waste.error.check.encrypted",
  pages: "calendar.waste.error.check.pages",
  timeout: "calendar.waste.error.check.timeout",
  year: "calendar.waste.error.check.year",
  months: "calendar.waste.error.check.months",
  consensus: "calendar.waste.error.check.consensus",
  values: "calendar.waste.error.check.values",
  tourCount: "calendar.waste.error.check.tourCount",
  sundays: "calendar.waste.error.check.sundays",
  noTourDates: "calendar.waste.error.check.noTourDates",
} as const satisfies Record<string, MessageKey>;

/** The first `details` item's string field `name`, if any. */
function detail(details: unknown, name: string): string | undefined {
  if (!Array.isArray(details)) return undefined;
  const first: unknown = details[0];
  if (typeof first !== "object" || first === null) return undefined;
  const value = (first as Record<string, unknown>)[name];
  return typeof value === "string" ? value : undefined;
}

function lookup<T extends Record<string, MessageKey>>(table: T, key: string | undefined): MessageKey | undefined {
  return key !== undefined && Object.hasOwn(table, key) ? table[key as keyof T] : undefined;
}

/** The message and an optional hint for a refused preview or import. */
export function wasteErrorMessage(error: unknown): { message: string; hint?: string } {
  if (!isApiError(error)) return { message: translate("common.error.unknown") };
  switch (error.code) {
    case "calendar_waste_source_refused":
      return { message: translate("calendar.waste.error.sourceRefused") };
    case "calendar_waste_fetch_failed": {
      const key = lookup(FETCH_REASONS, detail(error.details, "reason"));
      return { message: key ? translate(key) : error.message, hint: translate("calendar.waste.error.fetchHint") };
    }
    case "calendar_waste_unparseable": {
      const key = lookup(CHECKS, detail(error.details, "check"));
      return { message: key ? translate(key) : translate("calendar.waste.error.unparseable") };
    }
    case "payload_too_large":
      return { message: translate("calendar.waste.error.tooLarge") };
    case "unsupported_media_type":
      return { message: translate("calendar.waste.error.notPdf") };
    default:
      return { message: error.message };
  }
}
