import { describe, expect, test } from "bun:test";
import { toValidationIssues } from "../src/core/i18n/issues.ts";
import {
  CARD_LIMITS,
  CreateCardRequestSchema,
  UpdateCardRequestSchema,
  cardValueIssueKey,
} from "../src/modules/recipe/schemas/card.ts";
import { safeParse } from "./support/schema.ts";

/** The catalog keys a failed parse reported, in order. */
function issueKeys(error: { readonly issue: Parameters<typeof toValidationIssues>[0] }): string[] {
  return toValidationIssues(error.issue).map((issue) => issue.i18n.key);
}

describe("CreateCardRequestSchema", () => {
  test("normalises the value it stores", () => {
    const result = safeParse(CreateCardRequestSchema, {
      label: "  Payback  ",
      format: "ean13",
      // The twelve digits printed under the barcode, with the card's spacing.
      value: "4 059 123 456 78",
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual({
      label: "Payback",
      format: "ean13",
      value: "4059123456788",
    });
  });

  test("rejects a mistyped digit via the check digit, on the value field", () => {
    const result = safeParse(CreateCardRequestSchema, {
      label: "Payback",
      format: "ean13",
      value: "4059123456789",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issues = toValidationIssues(result.error.issue);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe("value");
    expect(issues[0]?.i18n.key).toBe("server.card.valueCheckDigit");
  });

  test("reports the symbology's own rule when it is broken", () => {
    // Note how few of these there are: normalisation absorbs the differences a
    // user can reasonably produce (spacing, case, an odd ITF digit count, a
    // missing check digit), so what is left is a value that is genuinely wrong.
    const cases = [
      [{ format: "ean13", value: "12345" }, "server.card.valueWrongLength"],
      [{ format: "code39", value: "Kunde#42" }, "server.card.valueCharset"],
      [{ format: "code128", value: "Kundenkarte-Müller" }, "server.card.valueCharset"],
      [{ format: "ean8", value: "12345678901234" }, "server.card.valueTooLong"],
      [{ format: "ean13", value: "- - -" }, "server.card.valueEmpty"],
    ] as const;
    for (const [input, key] of cases) {
      const result = safeParse(CreateCardRequestSchema, { label: "X", ...input });
      expect(result.success).toBe(false);
      if (!result.success) expect(issueKeys(result.error)).toContain(key);
    }
  });

  test("rejects a label that is missing or too long", () => {
    expect(safeParse(CreateCardRequestSchema, { label: "  ", format: "qr", value: "x" }).success).toBe(
      false,
    );
    expect(
      safeParse(CreateCardRequestSchema, {
        label: "x".repeat(CARD_LIMITS.labelMax + 1),
        format: "qr",
        value: "x",
      }).success,
    ).toBe(false);
  });

  test("an unknown symbology is not a card this app can display", () => {
    expect(
      safeParse(CreateCardRequestSchema, { label: "X", format: "pdf417", value: "1234" }).success,
    ).toBe(false);
  });
});

describe("UpdateCardRequestSchema", () => {
  test("accepts a label-only or note-only change", () => {
    expect(safeParse(UpdateCardRequestSchema, { label: "Rewe" }).success).toBe(true);
    expect(safeParse(UpdateCardRequestSchema, { note: "Karte von Anna" }).success).toBe(true);
    // null clears the note.
    expect(safeParse(UpdateCardRequestSchema, { note: null }).success).toBe(true);
  });

  test("refuses an empty patch", () => {
    const result = safeParse(UpdateCardRequestSchema, {});
    expect(result.success).toBe(false);
    if (!result.success) expect(issueKeys(result.error)).toContain("server.validation.noChanges");
  });

  test("format and value can only move together", () => {
    for (const patch of [{ value: "12345678" }, { format: "itf" as const }]) {
      const result = safeParse(UpdateCardRequestSchema, patch);
      expect(result.success).toBe(false);
      if (!result.success) expect(issueKeys(result.error)).toContain("server.card.formatAndValue");
    }
    const both = safeParse(UpdateCardRequestSchema, { format: "code39", value: " mitglied-42 " });
    expect(both.success).toBe(true);
    // Normalised on the way through, exactly like a create.
    expect(both.success && both.data.value).toBe("MITGLIED-42");
  });

  test("still validates the pair's check digit", () => {
    const result = safeParse(UpdateCardRequestSchema, { format: "ean13", value: "4059123456789" });
    expect(result.success).toBe(false);
    if (!result.success) expect(issueKeys(result.error)).toContain("server.card.valueCheckDigit");
  });
});

describe("cardValueIssueKey", () => {
  test("null for a value that can be displayed", () => {
    expect(cardValueIssueKey("ean13", "4059123456788")).toBeNull();
    expect(cardValueIssueKey("qr", "https://example.com/x")).toBeNull();
  });

  test("a key for every reason, so the form can render one in the user's language", () => {
    expect(cardValueIssueKey("ean13", "")).toBe("server.card.valueEmpty");
    expect(cardValueIssueKey("ean13", "405912345678")).toBe("server.card.valueWrongLength");
    expect(cardValueIssueKey("ean13", "4059123456789")).toBe("server.card.valueCheckDigit");
    expect(cardValueIssueKey("itf", "123")).toBe("server.card.valueOddLength");
    expect(cardValueIssueKey("code39", "kleinbuchstaben")).toBe("server.card.valueCharset");
    expect(cardValueIssueKey("qr", "x".repeat(CARD_LIMITS.valueMax + 1))).toBe(
      "server.card.valueTooLong",
    );
    expect(cardValueIssueKey("ean8", "1234567A")).toBe("server.card.valueDigitsOnly");
  });
});
