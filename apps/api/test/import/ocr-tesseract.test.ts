/**
 * The native Tesseract engine's output parsing.
 *
 * WHY THIS IS A PURE-FUNCTION TEST AND NOT AN END-TO-END ONE: the engine shells out
 * to the `tesseract` binary, which ships in the Docker image but is not installed on
 * a typical dev machine — so a test that ran real OCR would fail for everyone
 * without it, and `bun test` is a gate. `parseTesseractOutput` is where all the
 * logic lives, so it is fed the exact two files one `tesseract … txt tsv` run
 * writes. The binary itself is verified by building and running the image.
 */
import { describe, expect, test } from "bun:test";
import { parseTesseractOutput } from "../../src/modules/recipe/services/ocr/tesseract.ts";

/**
 * A real `tesseract … tsv` page, trimmed to two lines.
 *
 * Levels: 1 page, 2 block, 3 paragraph, 4 line, 5 word. Only level-5 rows carry
 * text and a confidence; every other level reports conf -1 and empty text, which is
 * exactly what must NOT be averaged into the page confidence.
 */
const TSV = [
  "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
  "1\t1\t0\t0\t0\t0\t0\t0\t1190\t1684\t-1\t",
  "2\t1\t1\t0\t0\t0\t100\t100\t400\t60\t-1\t",
  "3\t1\t1\t1\t0\t0\t100\t100\t400\t60\t-1\t",
  "4\t1\t1\t1\t1\t0\t100\t100\t400\t28\t-1\t",
  "5\t1\t1\t1\t1\t1\t100\t100\t180\t28\t96.1\tZutaten",
  "4\t1\t1\t1\t2\t0\t100\t140\t400\t28\t-1\t",
  "5\t1\t1\t1\t2\t1\t100\t140\t60\t28\t90.5\t250",
  "5\t1\t1\t1\t2\t2\t170\t140\t30\t28\t88.3\tg",
  "5\t1\t1\t1\t2\t3\t260\t140\t140\t28\t94.0\tMehl",
  "2\t1\t2\t0\t0\t0\t100\t300\t500\t40\t-1\t",
  "5\t1\t2\t1\t1\t1\t100\t300\t300\t30\t72.0\tZubereitung",
].join("\n");

/** What the txt renderer writes for the same page: a form feed and a trailing NL. */
const TXT = "Zutaten\n250 g   Mehl\n\nZubereitung\n\f";

describe("parseTesseractOutput", () => {
  test("text comes from the txt renderer, with the interword spacing intact", () => {
    const result = parseTesseractOutput(TXT, TSV);
    // The doubled spaces are the whole reason we read the txt file rather than
    // rebuilding the text from the tsv word boxes.
    expect(result.text).toBe("Zutaten\n250 g   Mehl\n\nZubereitung");
    expect(result.text).not.toContain("\f");
  });

  test("confidence is the mean over WORD rows only, normalised to 0..1", () => {
    const result = parseTesseractOutput(TXT, TSV);
    const expected = (96.1 + 90.5 + 88.3 + 94.0 + 72.0) / 5 / 100;
    expect(result.confidence).toBeCloseTo(expected, 6);
    // The -1 rows must not drag it down.
    expect(result.confidence).toBeGreaterThan(0.85);
  });

  test("one block per tesseract block, with the union of its word boxes", () => {
    const result = parseTesseractOutput(TXT, TSV);
    expect(result.blocks).toHaveLength(2);

    const [first, second] = result.blocks;
    expect(first?.text).toBe("Zutaten\n250 g Mehl");
    expect(first?.confidence).toBeCloseTo((96.1 + 90.5 + 88.3 + 94.0) / 4, 5);
    expect(first?.bbox).toEqual({ x0: 100, y0: 100, x1: 400, y1: 168 });

    expect(second?.text).toBe("Zubereitung");
    expect(second?.bbox).toEqual({ x0: 100, y0: 300, x1: 400, y1: 330 });
  });

  test("an empty page is 0 confidence and no blocks, not NaN", () => {
    const header = TSV.split("\n")[0]!;
    const result = parseTesseractOutput("", header);
    expect(result.text).toBe("");
    expect(result.confidence).toBe(0);
    expect(result.blocks).toEqual([]);
  });

  test("falls back to rebuilding the text from the tsv when txt is missing", () => {
    // A tesseract build that emitted no txt file must degrade, not return "".
    const result = parseTesseractOutput("", TSV);
    expect(result.text).toBe("Zutaten\n250 g Mehl\nZubereitung");
    expect(result.confidence).toBeGreaterThan(0);
  });

  test("malformed and short tsv rows are skipped rather than throwing", () => {
    const noisy = [
      TSV,
      "",
      "not a tsv row at all",
      "5\t1\t1", // truncated
      "5\t1\t9\t1\t1\t1\t0\t0\t0\t0\tNaN\tkaputt",
    ].join("\n");
    const result = parseTesseractOutput(TXT, noisy);
    expect(result.blocks).toHaveLength(2);
    expect(Number.isFinite(result.confidence)).toBe(true);
  });
});
