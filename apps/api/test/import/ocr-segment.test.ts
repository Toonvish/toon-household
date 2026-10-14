/**
 * OCR text -> recipe segmentation, quantity repair, and the image/PDF pipelines.
 * A FAKE OcrEngine is injected everywhere — real Tesseract never runs in tests.
 *
 * THE RASTERIZER IS STUBBED VIA `setPdfRasterizer` AND RESET IN `afterEach`, not
 * with `mock.module`. That used to be the mechanism, and it was a trap: this file
 * stubbed `pdf-to-img` process-globally, bun never restores a module mock between
 * files, and file execution order is FILESYSTEM order rather than alphabetical — so
 * the stub broke `pdf-rasterize.test.ts` (the one test using the REAL rasterizer)
 * on whichever machine happened to enumerate this file first. It passed locally and
 * failed in CI for exactly that reason. An explicit seam cannot leak that way.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { ApiError } from "../../src/lib/errors.ts";
import { importFromImage, importFromPdf, importFromText } from "../../src/modules/recipe/services/import/ocr/index.ts";
import {
  repairIngredientLine,
  repairOcrText,
  repairUnitToken,
} from "../../src/modules/recipe/services/import/ocr/quantity-fix.ts";
import {
  findTitle,
  mergeWrappedSteps,
  prepareLines,
  scanMeta,
  segmentRecipeText,
} from "../../src/modules/recipe/services/import/ocr/segment.ts";
import {
  isUsableTextLayer,
  normalizePdfText,
  pdfToText,
  setPdfRasterizer,
} from "../../src/modules/recipe/services/ocr/pdf.ts";
import {
  ocrInFlight,
  ocrQueued,
  setOcrConcurrencyForTests,
  withOcrSlot,
  withOcrTimeout,
} from "../../src/modules/recipe/services/ocr/index.ts";
import { normalizeLangs } from "../../src/modules/recipe/services/ocr/tesseract.ts";
import { createFakeOcrEngine, expectApiError, fixture, makeTestPng } from "./helpers.ts";

const OCR_DUMP = fixture("ocr-zwiebelkuchen.txt");

describe("OCR quantity repair", () => {
  test.each([
    ["25O g Mehl", "250 g Mehl"],
    ["1OO g Zucker", "100 g Zucker"],
    ["l00 ml Sahne", "100 ml Sahne"],
    ["1,S kg Kartoffeln", "1,5 kg Kartoffeln"],
    ["1.5 l Wasser", "1,5 l Wasser"],
    ["l EL Zucker", "1 EL Zucker"],
    ["S EL Öl", "5 EL Öl"],
    ["250 9 Mehl", "250 g Mehl"],
    ["500 mI Milch", "500 ml Milch"],
    ["2 TI Backpulver", "2 TL Backpulver"],
    ["2 E1 Zucker", "2 EL Zucker"],
    ["1 Prlse Salz", "1 Prise Salz"],
    ["1 Pck Vanillezucker", "1 Pck. Vanillezucker"],
  ])("repairs %p -> %p", (input, expected) => {
    expect(repairIngredientLine(input)).toBe(expected);
  });

  test.each([
    "Salz und Pfeffer",
    "Stück Butter",
    "Olivenöl zum Braten",
    "Zwiebeln, gewürfelt",
    "Sahne",
    "Zucker 100 g",
    "Butter, weich",
    "Schokolade zum Verzieren",
    "2-3 Eier",
    "½ TL Zimt",
    "1 Prise Salz",
    "4 Scheiben Schinken",
    "Bananen",
    "Zimt",
    "3 Ei(er)",
  ])("leaves %p completely untouched", (line) => {
    expect(repairIngredientLine(line)).toBe(line);
  });

  test('never turns "EI" (Ei = egg) into "EL"', () => {
    expect(repairIngredientLine("3 EI Mehl")).toBe("3 EI Mehl");
    expect(repairUnitToken("EI")).toBe("EI");
  });

  test("global repairs fix ligatures and quote glyphs but not words", () => {
    expect(repairOcrText("ﬂeischig ﬁnden „Test“")).toBe('fleischig finden "Test"');
  });
});

describe("line preparation", () => {
  test("drops page numbers, running headers and separator lines", () => {
    const lines = prepareLines(
      ["Kochbuch", "- 128 -", "Seite 12", "Kochbuch", "Zwiebelkuchen", "***", "Kochbuch", "250 g Mehl"].join("\n"),
    );
    const texts = lines.map((line) => line.text);
    expect(texts).not.toContain("- 128 -");
    expect(texts).not.toContain("Seite 12");
    expect(texts).not.toContain("***");
    // "Kochbuch" appears 3x -> running header, removed everywhere.
    expect(texts).not.toContain("Kochbuch");
    expect(texts).toContain("Zwiebelkuchen");
    expect(texts).toContain("250 g Mehl");
  });

  test('classifies "4 Portionen" as metadata, not as an ingredient', () => {
    const [line] = prepareLines("4 Portionen");
    expect(line?.kind).toBe("meta");
  });

  test('classifies "4 Scheiben Schinken" as an ingredient, not as servings', () => {
    const [line] = prepareLines("4 Scheiben Schinken");
    expect(line?.kind).toBe("ingredient");
  });

  test("recognises numbered steps and headings", () => {
    const lines = prepareLines(["Zutaten", "Zubereitung", "1. Mehl sieben und Eier zugeben.", "Für den Teig:"].join("\n"));
    expect(lines.map((line) => line.kind)).toEqual(["ingredientsHeading", "stepsHeading", "numbered", "sectionHeading"]);
  });
});

describe("meta scanning", () => {
  test("a label never captures the NEXT badge on the same line", () => {
    const meta = scanMeta(prepareLines("4 Portionen   Arbeitszeit ca. 30 Minuten   Backzeit 45 Min."));
    expect(meta.prepMinutes).toBe(30);
    expect(meta.cookMinutes).toBe(45);
    expect(meta.servings).toEqual({ amount: 4, unit: "Portionen" });
  });

  test("handles 'Std./Min.' compound durations", () => {
    const meta = scanMeta(prepareLines("Gesamtzeit: ca. 1 Std. 15 Min."));
    expect(meta.totalMinutes).toBe(75);
  });

  test("a rest time is captured separately, not as prep", () => {
    const meta = scanMeta(prepareLines("Arbeitszeit 20 Minuten\nRuhezeit 12 Stunden"));
    expect(meta.prepMinutes).toBe(20);
    expect(meta.restMinutes).toBe(720);
  });

  test("difficulty synonyms map onto the enum", () => {
    expect(scanMeta(prepareLines("Schwierigkeitsgrad: leicht")).difficulty).toBe("einfach");
    expect(scanMeta(prepareLines("Niveau: anspruchsvoll")).difficulty).toBe("schwer");
    expect(scanMeta(prepareLines("Schwierigkeit: normal")).difficulty).toBe("mittel");
  });

  test("an UNLABELLED duration inside a step is ignored", () => {
    const meta = scanMeta(prepareLines("Den Teig 30 Minuten gehen lassen, dann weiterarbeiten."));
    expect(meta.prepMinutes).toBeUndefined();
    expect(meta.totalMinutes).toBeUndefined();
  });
});

describe("title detection", () => {
  test("takes the first substantial line and title-cases a SHOUTED one", () => {
    const scan = findTitle(prepareLines(OCR_DUMP));
    expect(scan.title).toBe("Schwäbischer Zwiebelkuchen");
    expect(scan.sourceLine).toBe("SCHWÄBISCHER ZWIEBELKUCHEN");
    expect(scan.explicit).toBe(true);
  });

  test("skips a leading badge line", () => {
    const scan = findTitle(prepareLines("4 Portionen\nApfelkuchen\nZutaten\n250 g Mehl"));
    expect(scan.title).toBe("Apfelkuchen");
  });

  test("skips a leading ingredient line", () => {
    const scan = findTitle(prepareLines("250 g Mehl\n3 Eier"));
    expect(scan.title).toBeUndefined();
  });
});

describe("wrapped step merging", () => {
  test("numbered markers rule when present", () => {
    const steps = mergeWrappedSteps([
      { text: "1. Mehl sieben", numbered: true },
      { text: "und Eier zugeben.", numbered: false },
      { text: "2. Alles verrühren.", numbered: true },
    ]);
    expect(steps).toHaveLength(2);
    expect(steps[0]?.text).toBe("1. Mehl sieben und Eier zugeben.");
  });

  test("short sentences are merged into one readable step", () => {
    const steps = mergeWrappedSteps([
      { text: "Mehl sieben.", numbered: false },
      { text: "Eier zugeben.", numbered: false },
    ]);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.text).toBe("Mehl sieben. Eier zugeben.");
  });

  test("a section change starts a new step", () => {
    const steps = mergeWrappedSteps([
      { text: "Teig kneten", section: "Teig", numbered: false },
      { text: "Ofen vorheizen", section: "Backen", numbered: false },
    ]);
    expect(steps.map((step) => step.section)).toEqual(["Teig", "Backen"]);
  });
});

describe("segmentRecipeText on a realistic German OCR dump", () => {
  const result = segmentRecipeText(OCR_DUMP, { source: "ocr", ocrConfidence: 0.82 });
  const fields = result.fields;

  test("finds the ingredient and step blocks via their headings", () => {
    expect(result.diagnostics.ingredientsVia).toBe("heading");
    expect(result.diagnostics.stepsVia).toBe("heading");
  });

  test("extracts the title", () => {
    expect(fields.title).toBe("Schwäbischer Zwiebelkuchen");
  });

  test("extracts servings, times and difficulty from the badge line", () => {
    expect(fields.servings).toEqual({ amount: 4, unit: "Portionen" });
    expect(fields.prepMinutes).toBe(30);
    expect(fields.cookMinutes).toBe(45);
    expect(fields.totalMinutes).toBe(75);
    expect(fields.difficulty).toBe("einfach");
  });

  test("the badge lines never leak into the ingredient list", () => {
    const names = (fields.ingredients ?? []).map((ingredient) => ingredient.name);
    expect(names.some((name) => /Arbeitszeit|Schwierigkeitsgrad|Portionen/.test(name))).toBe(false);
  });

  test("produces exactly the 12 ingredients of the page", () => {
    expect(fields.ingredients).toHaveLength(12);
  });

  test("both 'Für ...' headings become sections", () => {
    const sections = (fields.ingredients ?? []).map((ingredient) => ingredient.section);
    expect(sections.slice(0, 5)).toEqual(new Array(5).fill("Für den Hefeteig"));
    expect(sections.slice(5)).toEqual(new Array(7).fill("Für den Belag"));
  });

  test("OCR digit confusions are repaired in the quantities", () => {
    // Looked up by `raw` because "Mehl" legitimately appears twice on the page.
    const byRaw = new Map((fields.ingredients ?? []).map((ingredient) => [ingredient.raw, ingredient]));
    expect(byRaw.get("30O g Mehl")).toMatchObject({ quantity: 300, unit: "g", name: "Mehl" });
    expect(byRaw.get("150 mI lauwarmes Wasser")).toMatchObject({ quantity: 150, unit: "ml" });
    expect(byRaw.get("1,S kg Zwiebeln")).toMatchObject({ quantity: 1.5, unit: "kg", name: "Zwiebeln" });
    expect(byRaw.get("l TL Salz")).toMatchObject({ quantity: 1, unit: "TL", name: "Salz" });
    expect(byRaw.get("1/2 Pck. Trockenhefe")).toMatchObject({ quantity: 0.5, unit: "Pck." });
  });

  test("`raw` keeps the ORIGINAL OCR line, not the repaired one", () => {
    const mehl = (fields.ingredients ?? []).find((ingredient) => ingredient.name === "Mehl");
    expect(mehl?.raw).toBe("30O g Mehl");
  });

  test("an ingredient wrapped over two lines is re-joined", () => {
    const speck = (fields.ingredients ?? []).find((ingredient) => ingredient.name.includes("Speck"));
    expect(speck).toMatchObject({ quantity: 200, unit: "g" });
    expect(speck?.note).toBe("in feine Würfel geschnitten");
  });

  test('"l TL Salz" is a separate ingredient, not a continuation of "2 EL Öl"', () => {
    const oil = (fields.ingredients ?? []).find((ingredient) => ingredient.name === "Öl");
    expect(oil).toMatchObject({ quantity: 2, unit: "EL" });
    expect(oil?.name).toBe("Öl");
  });

  test("a quantity-less line stays an ingredient", () => {
    const names = (fields.ingredients ?? []).map((ingredient) => ingredient.name);
    expect(names).toContain("Salz und Pfeffer");
  });

  test("the 5 numbered steps are merged from their wrapped lines", () => {
    expect(fields.steps).toHaveLength(5);
    expect(fields.steps?.[0]?.text).toBe(
      "Mehl in eine Schüssel geben, Hefe mit dem lauwarmen Wasser verrühren und zum Mehl geben. Öl und Salz zugeben.",
    );
    expect(fields.steps?.[4]?.text).toContain("200 °C etwa 45 Minuten backen");
  });

  test("step numbering is stripped from the text", () => {
    for (const step of fields.steps ?? []) {
      expect(step.text).not.toMatch(/^\d+\./);
    }
  });

  test("the Tipp trailer becomes notes, not a step", () => {
    expect(fields.notes).toBe("Dazu passt ein Glas neuer Wein oder Federweißer.");
    expect(fields.steps?.some((step) => step.text.includes("Federweißer"))).toBe(false);
  });

  test("per-field confidence is emitted and reflects the OCR quality", () => {
    expect(result.confidence.overall).toBeGreaterThan(0.6);
    expect(result.confidence.ingredients).toBeGreaterThan(0.5);
    expect(result.confidence.steps).toBeGreaterThan(0.5);
    expect(result.confidence.title).toBeGreaterThan(0.5);
  });

  test("a worse OCR confidence lowers every score", () => {
    const worse = segmentRecipeText(OCR_DUMP, { source: "ocr", ocrConfidence: 0.2 });
    expect(worse.confidence.overall).toBeLessThan(result.confidence.overall);
  });

  test("an exact PDF text layer scores higher than the same text from OCR", () => {
    const exact = segmentRecipeText(OCR_DUMP, { source: "pdf-text" });
    expect(exact.confidence.overall).toBeGreaterThan(result.confidence.overall);
  });
});

describe("segmentRecipeText without headings", () => {
  test("detects the ingredient block from a RUN of quantity lines", () => {
    const text = [
      "Omelett",
      "3 Eier",
      "50 ml Milch",
      "1 Prise Salz",
      "20 g Butter",
      "Die Eier mit der Milch verquirlen und salzen.",
      "Butter in der Pfanne schmelzen und die Masse hineingeben.",
    ].join("\n");
    const result = segmentRecipeText(text, { source: "manual" });
    expect(result.diagnostics.ingredientsVia).toBe("run");
    expect(result.fields.title).toBe("Omelett");
    expect(result.fields.ingredients).toHaveLength(4);
    // Two SHORT consecutive sentences are deliberately merged into one step
    // (see mergeWrappedSteps): a 45-character step is not worth its own card.
    expect(result.fields.steps).toHaveLength(1);
    expect(result.fields.steps?.[0]?.text).toContain("verquirlen");
    expect(result.fields.steps?.[0]?.text).toContain("Pfanne");
  });

  test("switches to steps on the first prose sentence", () => {
    const result = segmentRecipeText(
      ["Zutaten", "2 Eier", "100 g Mehl", "Alles gut verrühren und in der Pfanne ausbacken."].join("\n"),
      { source: "manual" },
    );
    expect(result.fields.ingredients).toHaveLength(2);
    expect(result.fields.steps).toHaveLength(1);
  });

  test("empty input yields an empty parse instead of throwing", () => {
    const result = segmentRecipeText("", { source: "ocr" });
    expect(result.fields.ingredients).toEqual([]);
    expect(result.fields.steps).toEqual([]);
    expect(result.confidence.overall).toBe(0);
  });
});

describe("importFromText", () => {
  test("produces a contract-valid ParsedRecipe", () => {
    const result = importFromText("Pfannkuchen\nZutaten\n250 g Mehl\n3 Eier\nZubereitung\nAlles verrühren.");
    expect(result.parsed.title).toBe("Pfannkuchen");
    expect(result.parsed.ingredients).toHaveLength(2);
    expect(result.parsed.steps).toHaveLength(1);
    expect(result.sourceMeta.method).toBe("manual");
    expect(result.rawText).toContain("250 g Mehl");
  });

  test("an explicit title overrides the detected one", () => {
    const result = importFromText("Irgendwas\n250 g Mehl\n2 Eier", { title: "Mein Rezept" });
    expect(result.parsed.title).toBe("Mein Rezept");
  });

  test("rejects empty text", () => {
    expect(() => importFromText("   ")).toThrow(ApiError);
  });
});

describe("importFromImage with a fake engine", () => {
  test("recognises a real image and segments the result", async () => {
    const png = await makeTestPng(400, 300);
    const engine = createFakeOcrEngine({
      text: "Milchreis\nZutaten\n1 l Milch\n250 g Milchreis\n2 EL Zucker\nZubereitung\n1. Milch aufkochen und Reis einruehren.",
      confidence: 0.66,
    });
    const result = await importFromImage(png, { mimeType: "image/png", engine, store: false });

    expect(engine.calls).toBe(1);
    // sharp preprocessing ran: the engine never sees the original bytes.
    expect(engine.callOptions[0]?.layout).toBe("page");
    expect(result.parsed.title).toBe("Milchreis");
    expect(result.parsed.ingredients).toHaveLength(3);
    expect(result.parsed.steps).toHaveLength(1);
    expect(result.sourceMeta.method).toBe("ocr");
    expect(result.sourceMeta.storedPath).toBeUndefined();
    // The engine's own confidence is blended into the field scores.
    expect(result.parsed.confidence.overall).toBeGreaterThan(0);
    expect(result.parsed.confidence.overall).toBeLessThan(0.9);
  });

  test("a recognition failure propagates instead of producing a bogus draft", async () => {
    const png = await makeTestPng(200, 150);
    const engine = createFakeOcrEngine({ text: "", fail: new Error("worker died") });
    await expect(importFromImage(png, { mimeType: "image/png", engine, store: false })).rejects.toThrow("worker died");
  });

  test("422 ocr_failed when the engine returns nothing usable", async () => {
    const png = await makeTestPng(200, 150);
    const engine = createFakeOcrEngine({ text: "  \n \n" });
    const error = await expectApiError(importFromImage(png, { mimeType: "image/png", engine, store: false }));
    expect(error.status).toBe(422);
    expect(error.code).toBe("ocr_failed");
  });

  test("an unreadable image fails as 415 before OCR is even attempted", async () => {
    const engine = createFakeOcrEngine({ text: "irrelevant" });
    const error = await expectApiError(
      importFromImage(new Uint8Array(64), { mimeType: "image/png", engine, store: false }),
    );
    expect(error.status).toBe(415);
    expect(engine.calls).toBe(0);
  });
});

describe("withOcrTimeout", () => {
  test("returns the value when the operation is fast enough", async () => {
    expect(await withOcrTimeout(async () => "ok", 500)).toBe("ok");
  });

  test("answers 504 ocr_failed when the budget is exhausted", async () => {
    const error = await expectApiError(
      withOcrTimeout(
        (signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new Error("aborted")));
          }),
        20,
      ),
    );
    expect(error.status).toBe(504);
    expect(error.code).toBe("ocr_failed");
  });

  test("aborts the injected engine via its signal", async () => {
    const engine = createFakeOcrEngine({ text: "zu spät", delayMs: 200 });
    const promise = withOcrTimeout(async (signal) => await engine.recognize(new Uint8Array(1), { signal }), 20);
    await expect(promise).rejects.toThrow(ApiError);
  });

  /**
   * The signal is COOPERATIVE and unpdf/tesseract ignore it, so the deadline has to
   * be a race — otherwise a stuck worker holds the request open past the "hard cap"
   * forever, which is exactly what used to happen.
   */
  test("answers at the deadline even when the operation ignores the signal", async () => {
    const startedAt = Date.now();
    const error = await expectApiError(
      withOcrTimeout(() => new Promise((resolve) => setTimeout(() => resolve("nie"), 5_000)), 30),
    );
    expect(error.status).toBe(504);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });
});

/**
 * The gate is the app's memory ceiling: it is directly the peak number of
 * concurrent `tesseract` processes. Since the default dropped to ONE slot, a
 * collision between two family members is routine rather than exotic, so a
 * request that finds the gate full WAITS instead of failing — bounded twice over,
 * by the wait budget and by the queue depth.
 *
 * Every test sets the limit explicitly through the seam and hands it back in
 * `afterEach`, because `env` is frozen at module load and `bun test` shares one
 * process across every file.
 */
describe("withOcrSlot", () => {
  afterEach(() => {
    setOcrConcurrencyForTests(null);
  });

  test("runs up to the configured limit at once", async () => {
    setOcrConcurrencyForTests(2);
    expect(ocrInFlight()).toBe(0);

    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held = Array.from({ length: 2 }, () => withOcrSlot(() => gate));
    expect(ocrInFlight()).toBe(2);

    release();
    await Promise.all(held);
    expect(ocrInFlight()).toBe(0);
  });

  test("a request that finds the gate full WAITS for a slot instead of failing", async () => {
    setOcrConcurrencyForTests(1);

    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = withOcrSlot(() => gate);
    expect(ocrInFlight()).toBe(1);

    // The second one is queued, not rejected — and has not started.
    let secondRan = false;
    const second = withOcrSlot(async () => {
      secondRan = true;
      return "zweiter";
    });
    await Promise.resolve();
    expect(ocrQueued()).toBe(1);
    expect(secondRan).toBe(false);

    release();
    await first;
    expect(await second).toBe("zweiter");
    expect(ocrInFlight()).toBe(0);
    expect(ocrQueued()).toBe(0);
  });

  test("429s once the queue itself is full, rather than backing up without bound", async () => {
    setOcrConcurrencyForTests(1);

    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const running = withOcrSlot(() => gate);
    // MAX_WAITERS_PER_SLOT is 2, so two may wait behind the single running job.
    const queued = [withOcrSlot(() => gate), withOcrSlot(() => gate)];
    await Promise.resolve();
    expect(ocrQueued()).toBe(2);

    const error = await expectApiError(withOcrSlot(async () => "nope"));
    expect(error.status).toBe(429);
    expect(error.code).toBe("rate_limited");

    release();
    await Promise.all([running, ...queued]);
    expect(ocrInFlight()).toBe(0);
  });

  test("gives up with 429 when the wait budget expires", async () => {
    setOcrConcurrencyForTests(1);

    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const running = withOcrSlot(() => gate);

    // 20 ms stands in for OCR_SLOT_WAIT_MS; the branch is the same one.
    const error = await expectApiError(withOcrSlot(async () => "zu spät", 20));
    expect(error.status).toBe(429);
    expect(error.code).toBe("rate_limited");
    // The waiter is gone, so it cannot be handed a slot after it has answered.
    expect(ocrQueued()).toBe(0);

    release();
    await running;
    expect(ocrInFlight()).toBe(0);
  });

  test("hands a freed slot to the WAITER, not to a request that just arrived", async () => {
    setOcrConcurrencyForTests(1);

    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const order: string[] = [];
    const running = withOcrSlot(() => gate);

    const queued = withOcrSlot(async () => {
      order.push("queued");
    });
    await Promise.resolve();

    release();
    await running;
    // Arrives after the slot was freed; without the baton pass it could overtake.
    const latecomer = withOcrSlot(async () => {
      order.push("latecomer");
    });

    await Promise.all([queued, latecomer]);
    expect(order).toEqual(["queued", "latecomer"]);
  });

  test("releases the slot when the operation throws", async () => {
    await expect(
      withOcrSlot(() => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
    expect(ocrInFlight()).toBe(0);
  });
});

describe("tesseract language normalisation", () => {
  test.each([
    ["deu+eng", "deu+eng"],
    ["de,en", "deu+eng"],
    ["  deu  +  eng ", "deu+eng"],
    ["german", "deu"],
    ["", "deu+eng"],
    [undefined, "deu+eng"],
    ["deu+deu", "deu"],
  ])("%p -> %p", (input, expected) => {
    expect(normalizeLangs(input)).toBe(expected);
  });
});

describe("PDF text handling", () => {
  test("isUsableTextLayer rejects sparse scanner noise", () => {
    expect(isUsableTextLayer("")).toBe(false);
    expect(isUsableTextLayer("Kapitel 3")).toBe(false);
    expect(isUsableTextLayer("x ".repeat(120))).toBe(false); // 240 chars, no real words
  });

  test("isUsableTextLayer accepts a real page of text", () => {
    const page = "Zutaten 250 g Mehl 3 Eier 500 ml Milch eine Prise Salz und zwei Esslöffel Zucker ".repeat(4);
    expect(isUsableTextLayer(page)).toBe(true);
  });

  test("normalizePdfText undoes hyphenation across line breaks", () => {
    expect(normalizePdfText("Kar-\ntoffeln")).toBe("Kartoffeln");
    expect(normalizePdfText("Zutaten\n\n\n\n250 g Mehl")).toBe("Zutaten\n\n250 g Mehl");
  });

  test("a PDF without a text layer AND without a rasterizer answers 422 pdf_no_text_layer", async () => {
    const engine = createFakeOcrEngine({ text: "irrelevant" });
    const notAPdf = new TextEncoder().encode("this is definitely not a pdf");
    const error = await expectApiError(pdfToText(notAPdf, engine, { maxPages: 1 }));
    expect(error.status).toBe(422);
    expect(error.code).toBe("pdf_no_text_layer");
  });

  test("importFromPdf surfaces the same 422 for an unreadable PDF", async () => {
    const engine = createFakeOcrEngine({ text: "irrelevant" });
    const error = await expectApiError(
      importFromPdf(new TextEncoder().encode("%PDF-1.4 broken"), { engine, store: false, maxPages: 1 }),
    );
    expect(error.code).toBe("pdf_no_text_layer");
  });

  test("the rasterize + OCR fallback runs one recognise call per page, capped", async () => {
    const png = await makeTestPng();
    // A 25-page document with maxPages 2: the rasterizer is asked for the cap, so
    // it returns exactly that many pages and OCR runs twice, not 25 times.
    setPdfRasterizer(async (_bytes, maxPages) =>
      Array.from({ length: Math.min(25, maxPages) }, (_unused, index) => ({
        pageNumber: index + 1,
        bytes: png,
      })),
    );

    const engine = createFakeOcrEngine({ text: ["Seite eins Text", "Seite zwei Text"], confidence: 0.7 });
    const result = await pdfToText(new TextEncoder().encode("%PDF-1.4 stub"), engine, {
      useTextLayer: false,
      maxPages: 2,
    });

    expect(result.method).toBe("ocr");
    expect(result.pages).toBe(2);
    expect(engine.calls).toBe(2);
    expect(result.text).toBe("Seite eins Text\n\nSeite zwei Text");
    expect(result.confidence).toBeCloseTo(0.7, 5);
    expect(result.engine).toBe("fake-ocr");
    // sharp preprocessing ran before every recognise call.
    expect(engine.callOptions).toHaveLength(2);
  });

  test("importFromPdf reports method 'ocr' and the page count in sourceMeta", async () => {
    const png = await makeTestPng();
    setPdfRasterizer(async () => [{ pageNumber: 1, bytes: png }]);

    const engine = createFakeOcrEngine({
      text: "Apfelkuchen\nZutaten\n300 g Mehl\n4 Eier\nZubereitung\n1. Alles verruehren und backen.",
      confidence: 0.9,
    });
    const result = await importFromPdf(new TextEncoder().encode("%PDF-1.4 stub"), {
      engine,
      store: false,
      useTextLayer: false,
      maxPages: 1,
      originalName: "rezept.pdf",
    });

    expect(result.sourceMeta.method).toBe("ocr");
    expect(result.sourceMeta.pages).toBe(1);
    expect(result.sourceMeta.filename).toBe("rezept.pdf");
    expect(result.sourceMeta.engine).toBe("fake-ocr");
    expect(result.parsed.title).toBe("Apfelkuchen");
    expect(result.parsed.ingredients).toHaveLength(2);
    expect(result.rawText).toContain("300 g Mehl");
  });
});

/**
 * Hands the REAL poppler rasterizer back after every test.
 *
 * Non-negotiable for the same reason `setMailer(null)` is: `bun test` runs every
 * file in ONE process, so a seam left overridden here stays overridden for every
 * file that runs afterwards — and `pdf-rasterize.test.ts` is the only test that
 * exercises the real rasterizer, so it would fail its rendered-size assertion,
 * which is precisely the failure that assertion exists to catch. `afterEach` rather
 * than `afterAll` so one stubbing test cannot affect the next test in this file.
 */
afterEach(() => {
  setPdfRasterizer(null);
});
