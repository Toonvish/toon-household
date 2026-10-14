import { describe, expect, test } from "bun:test";
import { QrTooLongError, encodeQr, type QrEccLevel } from "../src/modules/recipe/qr.ts";

/** Reads the module at (x, y) — `true` = dark. */
function dark(matrix: { modules: readonly boolean[][] }, x: number, y: number): boolean {
  return matrix.modules[y]?.[x] === true;
}

describe("encodeQr", () => {
  test("picks the smallest version that fits and reports it", () => {
    const short = encodeQr("4059123456788");
    expect(short.version).toBe(1);
    expect(short.size).toBe(21);
    expect(short.modules).toHaveLength(21);
    expect(short.modules[0]).toHaveLength(21);
  });

  test("size is always 17 + 4 * version", () => {
    for (const text of ["1", "9".repeat(80), "9".repeat(400), "x".repeat(300)]) {
      const matrix = encodeQr(text);
      expect(matrix.size).toBe(17 + 4 * matrix.version);
    }
  });

  test("a numeric value is denser than the same length in bytes", () => {
    // Numeric mode packs three digits into ten bits, byte mode one per eight.
    const numeric = encodeQr("1".repeat(120));
    const bytes = encodeQr("ä".repeat(120));
    expect(numeric.version).toBeLessThan(bytes.version);
  });

  test("a higher ECC level needs the same or more space", () => {
    const levels: QrEccLevel[] = ["L", "M", "Q", "H"];
    const versions = levels.map((ecc) => encodeQr("9".repeat(200), { ecc }).version);
    for (let index = 1; index < versions.length; index += 1) {
      expect(versions[index] as number).toBeGreaterThanOrEqual(versions[index - 1] as number);
    }
  });

  test("draws the three finder patterns", () => {
    const matrix = encodeQr("PAYBACK");
    for (const [originX, originY] of [
      [0, 0],
      [matrix.size - 7, 0],
      [0, matrix.size - 7],
    ] as const) {
      // A finder is a 7x7 ring: dark border, light ring, dark 3x3 core.
      for (let index = 0; index < 7; index += 1) {
        expect(dark(matrix, originX + index, originY)).toBe(true);
        expect(dark(matrix, originX + index, originY + 6)).toBe(true);
        expect(dark(matrix, originX, originY + index)).toBe(true);
        expect(dark(matrix, originX + 6, originY + index)).toBe(true);
      }
      expect(dark(matrix, originX + 1, originY + 1)).toBe(false);
      expect(dark(matrix, originX + 3, originY + 3)).toBe(true);
    }
  });

  test("draws the timing patterns and the always-dark module", () => {
    const matrix = encodeQr("PAYBACK");
    for (let index = 8; index < matrix.size - 8; index += 1) {
      expect(dark(matrix, index, 6)).toBe(index % 2 === 0);
      expect(dark(matrix, 6, index)).toBe(index % 2 === 0);
    }
    expect(dark(matrix, 8, matrix.size - 8)).toBe(true);
  });

  test("separators around the top-left finder stay light", () => {
    const matrix = encodeQr("PAYBACK");
    for (let index = 0; index <= 7; index += 1) {
      expect(dark(matrix, index, 7)).toBe(false);
      expect(dark(matrix, 7, index)).toBe(false);
    }
  });

  test("versions 7 and up carry the version information block", () => {
    const small = encodeQr("1");
    expect(small.version).toBeLessThan(7);
    const large = encodeQr("9".repeat(400), { ecc: "L" });
    expect(large.version).toBeGreaterThanOrEqual(7);
    // The block is 3x6 modules next to the bottom-left and top-right finders,
    // and cannot be all light for any version number.
    let anyDark = false;
    for (let x = large.size - 11; x < large.size - 8; x += 1) {
      for (let y = 0; y < 6; y += 1) if (dark(large, x, y)) anyDark = true;
    }
    expect(anyDark).toBe(true);
  });

  test("minVersion raises the version without changing the payload", () => {
    const forced = encodeQr("4059123456788", { minVersion: 5 });
    expect(forced.version).toBe(5);
    expect(forced.size).toBe(37);
  });

  test("the same input always produces the same matrix", () => {
    const a = encodeQr("https://example.com/loyalty/9982371");
    const b = encodeQr("https://example.com/loyalty/9982371");
    expect(a.modules).toEqual(b.modules);
  });

  test("throws rather than truncating when nothing can hold the text", () => {
    // Version 40-H holds well under 1300 bytes.
    expect(() => encodeQr("x".repeat(4000), { ecc: "H" })).toThrow(QrTooLongError);
  });
});
