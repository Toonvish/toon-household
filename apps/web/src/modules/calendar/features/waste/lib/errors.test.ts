/** Every refusal of plan m8 P17/P18 has its own sentence (M8-T17). */
import { afterAll, describe, expect, test } from "bun:test";
import { DEFAULT_LOCALE } from "@toon/shared";
import { ApiError } from "@/lib/api";
import { setLocaleForTest } from "@/lib/i18n";
import { wasteErrorMessage } from "./errors";

afterAll(() => setLocaleForTest(DEFAULT_LOCALE));

const failure = (code: string, status: number, details?: unknown) => new ApiError({ code, status, message: `server:${code}`, details });

describe("wasteErrorMessage (de)", () => {
  test("source refused, fetch reasons with the upload hint, parser checks", () => {
    setLocaleForTest("de");
    expect(wasteErrorMessage(failure("calendar_waste_source_refused", 400)).message).toContain("www.hattingen.de");
    const timeout = wasteErrorMessage(failure("calendar_waste_fetch_failed", 502, [{ reason: "timeout" }]));
    expect(timeout.message).toBe("Die Website der Stadt hat zu lange gebraucht.");
    expect(timeout.hint).toContain("PDF hochladen");
    for (const reason of ["network", "status", "redirects", "tooLarge"]) {
      expect(wasteErrorMessage(failure("calendar_waste_fetch_failed", 502, [{ reason }])).message).not.toBe(
        "server:calendar_waste_fetch_failed",
      );
    }
    for (const check of ["notPdf", "encrypted", "pages", "timeout", "year", "months", "consensus", "values", "tourCount", "sundays", "noTourDates"]) {
      const message = wasteErrorMessage(failure("calendar_waste_unparseable", 422, [{ check }])).message;
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toContain("calendar.");
    }
    expect(wasteErrorMessage(failure("calendar_waste_unparseable", 422, [{ check: "brandNew" }])).message).toContain("Hattingen");
    expect(wasteErrorMessage(failure("payload_too_large", 413)).message).toBe("Die Datei ist größer als 10 MB.");
    expect(wasteErrorMessage(failure("unsupported_media_type", 415)).message).toBe("Die Datei ist kein PDF.");
  });

  test("anything else keeps the server's message", () => {
    expect(wasteErrorMessage(failure("rate_limited", 429)).message).toBe("server:rate_limited");
    expect(wasteErrorMessage(failure("calendar_waste_fetch_failed", 502, "x")).message).toBe("server:calendar_waste_fetch_failed");
  });
});
