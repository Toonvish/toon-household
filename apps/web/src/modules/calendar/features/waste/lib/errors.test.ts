/** Every refusal of plan m8 P17/P18 has its own sentence (M8-T17). */
import { afterAll, describe, expect, test } from "bun:test";
import { DEFAULT_LOCALE } from "@toon/shared";
import { ApiError } from "@/lib/api";
import { setLocaleForTest } from "@/lib/i18n";
import { wasteErrorMessage, wasteWarningGroups } from "./errors";

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

describe("wasteWarningGroups (the preview's warnings, M8-T19)", () => {
  test("hiddenCopyDiffers is one sentence with its dates in order, never the raw code", () => {
    setLocaleForTest("de");
    const groups = wasteWarningGroups([
      { code: "hiddenCopyDiffers", date: "2027-02-16" },
      { code: "hiddenCopyDiffers", date: "2027-01-15" },
      { code: "hiddenCopyDiffers", date: "2027-01-15" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.text).toContain("ältere Fassung");
    expect(groups[0]!.text).not.toContain("hiddenCopyDiffers");
    expect(groups[0]!.dates).toEqual(["2027-01-15", "2027-02-16"]);
    setLocaleForTest("en");
    expect(wasteWarningGroups([{ code: "hiddenCopyDiffers", date: "2027-01-15" }])[0]!.text).toContain("older version");
  });

  test("an unknown code (a newer server) shows the code; a warning without a date has no dates", () => {
    setLocaleForTest("de");
    expect(wasteWarningGroups([{ code: "brandNew", date: null }])).toEqual([{ text: "brandNew", dates: [] }]);
    expect(wasteWarningGroups([])).toEqual([]);
  });
});
