/**
 * Heuristic segmentation of raw OCR / PDF-text-layer output into a recipe.
 *
 * A scanned cookbook page has no markup, so structure has to be inferred:
 *
 *   TITLE      the first substantial line that is not a page header, a page
 *              number or an ingredient line
 *   META       "4 Portionen", "Arbeitszeit ca. 20 Minuten", "Backzeit 45 Min.",
 *              "Schwierigkeitsgrad: einfach" — scanned from the WHOLE page,
 *              because these badges sit anywhere on the layout
 *   INGREDIENTS  entered via a heading ("Zutaten", "Für den Teig") OR detected
 *              by a RUN of lines that parse with a quantity (+ unit)
 *   STEPS      entered via a heading ("Zubereitung", "Und so geht's") or by
 *              numbered lines ("1.", "2)"); wrapped lines are re-joined into
 *              whole sentences before becoming steps
 *   NOTES      "Tipp", "Hinweis", "Variante" trailer
 *
 * Everything is per-field scored so the review screen can flag what to check.
 * The full rawText is always kept on the draft — the segmenter is allowed to be
 * wrong, the user can always read the source next to the parsed fields.
 */
import type { ParsedRecipeConfidence } from "@toon/shared";
import { parseDuration, parseIngredientLine, parseServings } from "@toon/shared";
import { cleanText } from "../html/entities.ts";
import {
  type ParsedFields,
  buildIngredients,
  buildSteps,
  computeOverallConfidence,
  isIngredientSectionHeading,
  normalizeDifficulty,
  normalizeSection,
} from "../parsed.ts";
import {
  STRONG_META_LABEL_RE,
  isStandaloneServings,
  readDifficulty,
  readLabelledTimes,
  readServings,
} from "../times.ts";
import { repairIngredientLine, repairOcrText } from "./quantity-fix.ts";

/* ------------------------------ line patterns ----------------------------- */

const INGREDIENTS_HEADING_RE =
  /^\s*(zutaten(?:liste)?|ingredients?|einkaufsliste|du brauchst|was du brauchst|man braucht)\b/iu;
const STEPS_HEADING_RE =
  /^\s*(zubereitung(?:sschritte)?|anleitung|und so geht'?s|so geht'?s|so wird'?s gemacht|arbeitsschritte|vorgehen|schritte|instructions?|preparation|zubereitungsart)\b\s*:?\s*$/iu;
const STEPS_HEADING_INLINE_RE =
  /^\s*(zubereitung(?:sschritte)?|anleitung|und so geht'?s|so geht'?s|arbeitsschritte|instructions?|preparation)\b\s*:\s*\S/iu;
const NOTES_HEADING_RE = /^\s*(tipp?s?|hinweise?|anmerkungen?|notizen|varianten?|gut zu wissen|info|zubehör)\b\s*:?/iu;
const NUMBERED_STEP_RE = /^\s*\(?(\d{1,2})\s*[.)\]]\s+(?=\S)/u;
const SCHRITT_STEP_RE = /^\s*schritt\s*(\d{1,2})\s*[:.)]?\s*/iu;

/** Page furniture: numbers, running heads, scanner artefacts. */
const PAGE_NOISE_RES: readonly RegExp[] = [
  /^\s*[-–—|]?\s*\d{1,4}\s*[-–—|]?\s*$/u,
  /^\s*seite\s+\d{1,4}(\s+von\s+\d{1,4})?\s*$/iu,
  /^\s*page\s+\d{1,4}\s*$/iu,
  /^\s*\d{1,4}\s*\/\s*\d{1,4}\s*$/u,
  /^[^\p{L}\p{N}]+$/u,
  /^\s*(www\.|https?:\/\/)\S+\s*$/iu,
  /^\s*©.*$/u,
];

const TEMPERATURE_RE = /\b\d{2,3}\s*(?:°\s*c|grad)\b/iu;

/* -------------------------------- line model ------------------------------ */

type LineKind =
  | "blank"
  | "ingredientsHeading"
  | "stepsHeading"
  | "notesHeading"
  | "sectionHeading"
  | "numbered"
  | "meta"
  | "ingredient"
  | "prose";

interface Line {
  text: string;
  kind: LineKind;
  /** True when parseIngredientLine found a quantity. */
  hasQuantity: boolean;
  /** True when it found a quantity AND a unit — a very strong signal. */
  hasQuantityAndUnit: boolean;
}

/** Splits, de-noises and pre-classifies the OCR dump. */
export function prepareLines(rawText: string): Line[] {
  const repaired = repairOcrText(rawText);
  const rawLines = repaired.split("\n").map((line) => line.replace(/[ \t]+/g, " ").trim());

  // A line repeated on every scanned page is a running header/footer.
  const counts = new Map<string, number>();
  for (const line of rawLines) {
    if (line.length < 4 || line.length > 60) continue;
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }

  const out: Line[] = [];
  for (const raw of rawLines) {
    if (raw.length === 0) {
      if (out.length > 0 && out[out.length - 1]!.kind !== "blank") {
        out.push({ text: "", kind: "blank", hasQuantity: false, hasQuantityAndUnit: false });
      }
      continue;
    }
    if (PAGE_NOISE_RES.some((pattern) => pattern.test(raw))) continue;
    if ((counts.get(raw) ?? 0) >= 3) continue;
    out.push(classifyLine(raw));
  }
  while (out.length > 0 && out[out.length - 1]!.kind === "blank") out.pop();
  return out;
}

function classifyLine(text: string): Line {
  const probe = parseIngredientLine(repairIngredientLine(text));
  const hasQuantity = typeof probe.quantity === "number";
  const hasQuantityAndUnit = hasQuantity && typeof probe.unit === "string";

  const base = { text, hasQuantity, hasQuantityAndUnit };

  if (STEPS_HEADING_RE.test(text) || STEPS_HEADING_INLINE_RE.test(text)) return { ...base, kind: "stepsHeading" };
  if (INGREDIENTS_HEADING_RE.test(text)) return { ...base, kind: "ingredientsHeading" };
  if (NOTES_HEADING_RE.test(text)) return { ...base, kind: "notesHeading" };
  if (NUMBERED_STEP_RE.test(text) || SCHRITT_STEP_RE.test(text)) return { ...base, kind: "numbered" };
  if (isIngredientSectionHeading(text)) return { ...base, kind: "sectionHeading" };

  const wordCount = text.split(/\s+/).length;
  // A trailing "." is only sentence-final when it is not an abbreviation —
  // "Backzeit 45 Min." is a badge, not a sentence.
  const endsWithAbbreviation =
    /(?:^|\s)(?:min|mins|std|stdn|sek|ca|etwa|evtl|bzw|inkl|zzgl|usw|etc|Pck|EL|TL|Msp|Stk|g|kg|mg|ml|cl|l|St)\.$/iu.test(
      text,
    );
  const looksLikeSentence = /[.!?]\s*$/.test(text) && wordCount >= 6 && !endsWithAbbreviation;
  // A metadata badge either carries an explicit label ("Backzeit 45 Min.") or is
  // nothing but a servings count ("4 Portionen"). Both must stay out of the
  // ingredient list — note that "4 Portionen" DOES parse as quantity+unit, which
  // is exactly why this check runs before the ingredient check.
  const isMeta =
    text.length <= 120 &&
    !looksLikeSentence &&
    (STRONG_META_LABEL_RE.test(text) || isStandaloneServings(text));
  if (isMeta) return { ...base, kind: "meta" };
  if (hasQuantity && text.length <= 110 && !looksLikeSentence) return { ...base, kind: "ingredient" };
  if (!hasQuantity && text.length <= 45 && wordCount <= 6 && !looksLikeSentence && !TEMPERATURE_RE.test(text)) {
    // Short, quantity-less lines are ingredients too ("Salz", "Olivenöl").
    return { ...base, kind: "ingredient" };
  }
  return { ...base, kind: "prose" };
}

/* -------------------------------- meta scan ------------------------------- */

export interface RecipeMeta {
  servings?: ParsedFields["servings"];
  prepMinutes?: number;
  cookMinutes?: number;
  totalMinutes?: number;
  restMinutes?: number;
  difficulty?: ParsedFields["difficulty"];
  /** True when at least one value came from an explicit label. */
  labelled: boolean;
}

/**
 * Scans the whole page for servings/times/difficulty. Deliberately global:
 * on a scanned page these badges sit above the title, next to the photo, or in
 * a footer — position tells us nothing.
 */
export function scanMeta(lines: readonly Line[]): RecipeMeta {
  const meta: RecipeMeta = { labelled: false };
  // Scan line by line so a label can never capture the NEXT line's value.
  const candidates = lines.filter((line) => line.kind === "meta" || line.kind === "prose" || line.kind === "ingredient");

  for (const line of candidates) {
    const times = readLabelledTimes(line.text);
    for (const field of ["prepMinutes", "cookMinutes", "totalMinutes", "restMinutes"] as const) {
      const value = times[field];
      if (value === undefined || meta[field] !== undefined) continue;
      meta[field] = value;
      meta.labelled = true;
    }
    if (meta.difficulty === undefined) {
      const difficulty = readDifficulty(line.text);
      if (difficulty) {
        meta.difficulty = difficulty;
        meta.labelled = true;
      }
    }
    // Only badge lines may define the servings — "4 Scheiben Brot" in the
    // ingredient list must not become "4 Scheiben" servings.
    const isBadgeLine =
      line.kind === "meta" || (line.kind !== "ingredient" && line.text.length <= 120 && STRONG_META_LABEL_RE.test(line.text));
    if (meta.servings === undefined && isBadgeLine) {
      const scan = readServings(line.text);
      if (scan.servings) {
        meta.servings = scan.servings;
        if (scan.labelled) meta.labelled = true;
      }
    }
  }

  // Derive a total when only the parts are known.
  if (meta.totalMinutes === undefined && (meta.prepMinutes !== undefined || meta.cookMinutes !== undefined)) {
    meta.totalMinutes = (meta.prepMinutes ?? 0) + (meta.cookMinutes ?? 0) + (meta.restMinutes ?? 0);
  }
  return meta;
}

/* --------------------------------- title ---------------------------------- */

const TITLE_REJECT_RE =
  /^(rezept|rezepte|recipe|zutaten|zubereitung|anleitung|inhalt|inhaltsverzeichnis|kapitel|vorwort|register|foto|bild|abbildung)\b/iu;

export interface TitleScan {
  /** Display title (SHOUTED lines are title-cased). */
  title?: string;
  /** The ORIGINAL line the title came from, so the segmenter can skip it. */
  sourceLine?: string;
  explicit: boolean;
}

/** Finds the recipe title in the lines before the first structural heading. */
export function findTitle(lines: readonly Line[]): TitleScan {
  for (const line of lines) {
    if (line.kind === "ingredientsHeading" || line.kind === "stepsHeading") break;
    if (line.kind === "blank" || line.kind === "meta" || line.kind === "numbered") continue;
    if (line.hasQuantity) continue;
    const text = cleanText(line.text).replace(/\s*[|·•]\s*$/u, "");
    if (text.length < 3 || text.length > 120) continue;
    if (TITLE_REJECT_RE.test(text)) continue;
    if (!/\p{L}{3}/u.test(text)) continue;
    // A page that starts with prose has no title line; the first sentence is
    // not one either.
    if (line.kind === "prose" && /[.!?]\s*$/.test(text) && text.split(/\s+/).length > 8) continue;
    return { title: prettifyTitle(text), sourceLine: line.text, explicit: true };
  }
  return { explicit: false };
}

/** SHOUTED cookbook titles become readable German title case. */
function prettifyTitle(text: string): string {
  if (text.length < 4 || /\p{Ll}/u.test(text)) return text;
  return text
    .toLocaleLowerCase("de-DE")
    .replace(/(^|[\s(\-–/])(\p{L})/gu, (_match, prefix: string, letter: string) => prefix + letter.toLocaleUpperCase("de-DE"));
}

/* ------------------------------ segmentation ------------------------------ */

type Mode = "preamble" | "ingredients" | "steps" | "notes";

interface Blocks {
  ingredientLines: Array<{ text: string; section?: string }>;
  stepLines: Array<{ text: string; section?: string; numbered: boolean }>;
  noteLines: string[];
  /** How the ingredient block was found. */
  ingredientsVia: "heading" | "run" | "none";
  /** How the step block was found. */
  stepsVia: "heading" | "numbered" | "prose" | "none";
}

/** True when a line inside the ingredient block clearly starts the method. */
function looksLikeInstruction(line: Line): boolean {
  if (line.kind === "numbered") return true;
  if (line.hasQuantityAndUnit) return false;
  const words = line.text.split(/\s+/).length;
  return (
    line.kind === "prose" &&
    words >= 7 &&
    (/[.!?]\s*$/.test(line.text) || line.text.length > 90 || TEMPERATURE_RE.test(line.text))
  );
}

/** Walks the classified lines and assigns them to the ingredient/step blocks. */
export function segmentBlocks(lines: readonly Line[], titleText: string | undefined): Blocks {
  const blocks: Blocks = {
    ingredientLines: [],
    stepLines: [],
    noteLines: [],
    ingredientsVia: "none",
    stepsVia: "none",
  };

  let mode: Mode = "preamble";
  let section: string | undefined;
  /** Buffered preamble lines that may retroactively become ingredients. */
  let pendingIngredients: Array<{ text: string; section?: string }> = [];

  const pushIngredient = (text: string): void => {
    blocks.ingredientLines.push(section === undefined ? { text } : { text, section });
  };
  const pushStep = (text: string, numbered: boolean): void => {
    blocks.stepLines.push(section === undefined ? { text, numbered } : { text, section, numbered });
  };

  for (const [index, line] of lines.entries()) {
    if (line.kind === "blank") {
      if (mode === "preamble") pendingIngredients = [];
      continue;
    }
    if (titleText !== undefined && line.text === titleText && blocks.ingredientLines.length === 0) continue;

    switch (line.kind) {
      case "ingredientsHeading": {
        mode = "ingredients";
        if (blocks.ingredientsVia === "none") blocks.ingredientsVia = "heading";
        section = undefined;
        pendingIngredients = [];
        continue;
      }
      case "stepsHeading": {
        mode = "steps";
        if (blocks.stepsVia === "none") blocks.stepsVia = "heading";
        section = undefined;
        // "Zubereitung: Mehl sieben …" carries content on the heading line.
        const inline = line.text.replace(STEPS_HEADING_INLINE_RE, "").trim();
        if (STEPS_HEADING_INLINE_RE.test(line.text) && inline.length > 0) pushStep(inline, false);
        continue;
      }
      case "notesHeading": {
        mode = "notes";
        const rest = line.text.replace(NOTES_HEADING_RE, "").trim();
        if (rest.length > 0) blocks.noteLines.push(rest);
        continue;
      }
      case "sectionHeading": {
        const heading = normalizeSection(line.text);
        section = heading.length > 0 ? heading : undefined;
        // A "Für den Teig:" heading also OPENS the ingredient block.
        if (mode === "preamble") {
          mode = "ingredients";
          if (blocks.ingredientsVia === "none") blocks.ingredientsVia = "heading";
          for (const pending of pendingIngredients) blocks.ingredientLines.push(pending);
          pendingIngredients = [];
        }
        continue;
      }
      default:
        break;
    }

    if (mode === "notes") {
      blocks.noteLines.push(line.text);
      continue;
    }

    if (mode === "steps") {
      pushStep(line.text, line.kind === "numbered");
      continue;
    }

    if (mode === "ingredients") {
      if (looksLikeInstruction(line)) {
        mode = "steps";
        if (blocks.stepsVia === "none") blocks.stepsVia = line.kind === "numbered" ? "numbered" : "prose";
        section = undefined;
        pushStep(line.text, line.kind === "numbered");
        continue;
      }
      pushIngredient(line.text);
      continue;
    }

    // --- preamble: decide what this line starts -----------------------------
    if (line.kind === "numbered") {
      mode = "steps";
      blocks.stepsVia = "numbered";
      pushStep(line.text, true);
      continue;
    }
    if (line.kind === "meta") continue;

    if (line.hasQuantity) {
      pendingIngredients.push({ text: line.text });
      // Two consecutive quantity lines (or one with a unit followed by another
      // ingredient-ish line) mean the ingredient block has started.
      const next = lines[index + 1];
      const runContinues = next !== undefined && (next.hasQuantity || next.kind === "ingredient");
      if (pendingIngredients.length >= 2 || (line.hasQuantityAndUnit && runContinues)) {
        mode = "ingredients";
        blocks.ingredientsVia = "run";
        for (const pending of pendingIngredients) blocks.ingredientLines.push(pending);
        pendingIngredients = [];
      }
      continue;
    }

    if (line.kind === "prose" && line.text.split(/\s+/).length >= 8) {
      mode = "steps";
      blocks.stepsVia = "prose";
      pushStep(line.text, false);
      continue;
    }
    pendingIngredients = [];
  }

  return blocks;
}

/* ---------------------------- wrapped-line repair ------------------------- */

/**
 * Re-joins OCR line wrapping inside the ingredient block: a continuation line
 * has no quantity of its own and starts lowercase, e.g.
 *   "200 g Zartbitterschokolade,"
 *   "grob gehackt"
 */
function mergeWrappedIngredients(entries: ReadonlyArray<{ text: string; section?: string }>): Array<{
  text: string;
  section?: string;
}> {
  const out: Array<{ text: string; section?: string }> = [];
  for (const entry of entries) {
    const previous = out[out.length - 1];
    const startsLower = /^[\p{Ll}(]/u.test(entry.text);
    const previousOpen = previous !== undefined && /[,;(\-–]$/.test(previous.text.trim());
    const short = entry.text.length <= 45;
    // Probe the REPAIRED line: "l TL Salz" is a real ingredient ("1 TL Salz"),
    // not a continuation of the previous one.
    const hasOwnQuantity = typeof parseIngredientLine(repairIngredientLine(entry.text)).quantity === "number";

    if (previous !== undefined && !hasOwnQuantity && short && (previousOpen || startsLower)) {
      previous.text = `${previous.text.replace(/[-–]$/, "")} ${entry.text}`.replace(/\s+/g, " ").trim();
      continue;
    }
    out.push({ ...entry });
  }
  return out;
}

/**
 * Re-joins wrapped instruction lines into whole steps.
 *
 * With numbering present the markers rule; otherwise a step ends when the buffer
 * ends with sentence punctuation AND is long enough to stand alone (60 chars) —
 * that merges "Mehl sieben." + "Eier zugeben." into one readable step while
 * still splitting genuinely separate instructions.
 */
export function mergeWrappedSteps(
  entries: ReadonlyArray<{ text: string; section?: string; numbered: boolean }>,
): Array<{ text: string; section?: string | null }> {
  const anyNumbered = entries.some((entry) => entry.numbered);
  const out: Array<{ text: string; section?: string | null }> = [];

  let buffer = "";
  let bufferSection: string | undefined;

  const flush = (): void => {
    const text = buffer.replace(/\s+/g, " ").trim();
    if (text.length > 0) out.push({ text, section: bufferSection ?? null });
    buffer = "";
  };

  for (const entry of entries) {
    const isNewSection = entry.section !== bufferSection;
    if (anyNumbered && entry.numbered && buffer.length > 0) flush();
    if (isNewSection && buffer.length > 0) flush();
    if (buffer.length === 0) bufferSection = entry.section;

    buffer = buffer.length === 0 ? entry.text : `${buffer} ${entry.text}`;

    if (!anyNumbered) {
      const complete = /[.!?:]\s*$/.test(buffer.trim());
      if (complete && buffer.trim().length >= 60) flush();
    }
  }
  flush();
  return out;
}

/* --------------------------------- public --------------------------------- */

export interface SegmentTextOptions {
  /** Mean OCR confidence (0..1). Ignored for an exact PDF text layer. */
  ocrConfidence?: number;
  /** "pdf-text" is exact, "ocr" and "manual" are not. */
  source?: "ocr" | "pdf-text" | "manual";
  /** Title supplied by the user (pasted-text import) — always wins. */
  titleOverride?: string;
}

export interface SegmentTextResult {
  fields: ParsedFields;
  confidence: ParsedRecipeConfidence;
  /** Diagnostics, surfaced in tests and useful for tuning. */
  diagnostics: {
    ingredientsVia: Blocks["ingredientsVia"];
    stepsVia: Blocks["stepsVia"];
    lineCount: number;
  };
}

/**
 * Turns a raw OCR / text-layer dump into `ParsedFields` + per-field confidence.
 * Pure and synchronous — no I/O, so it is exhaustively unit-testable.
 */
export function segmentRecipeText(rawText: string, options: SegmentTextOptions = {}): SegmentTextResult {
  const lines = prepareLines(rawText);
  const meta = scanMeta(lines);
  const detected = findTitle(lines);
  const titleOverride = options.titleOverride?.trim();
  const title = titleOverride !== undefined && titleOverride.length > 0 ? titleOverride : detected.title;

  const blocks = segmentBlocks(lines, detected.sourceLine);

  // Nothing recognised as an ingredient block but plenty of quantity lines?
  // Treat every quantity line as an ingredient — better a rough draft than none.
  if (blocks.ingredientLines.length === 0) {
    const fallback = lines.filter((line) => line.hasQuantity && line.kind !== "meta");
    if (fallback.length >= 2) {
      blocks.ingredientLines = fallback.map((line) => ({ text: line.text }));
      blocks.ingredientsVia = "run";
    }
  }

  const mergedIngredients = mergeWrappedIngredients(blocks.ingredientLines);
  const ingredients = buildIngredientsWithSections(mergedIngredients);
  const steps = buildSteps(mergeWrappedSteps(blocks.stepLines));

  const fields: ParsedFields = { ingredients, steps, language: "de" };
  if (title !== undefined) fields.title = title;
  if (meta.servings !== undefined) fields.servings = meta.servings;
  if (meta.prepMinutes !== undefined) fields.prepMinutes = meta.prepMinutes;
  if (meta.cookMinutes !== undefined) fields.cookMinutes = meta.cookMinutes;
  if (meta.totalMinutes !== undefined) fields.totalMinutes = meta.totalMinutes;
  if (meta.difficulty !== undefined) fields.difficulty = meta.difficulty;

  const notes: string[] = [];
  if (blocks.noteLines.length > 0) notes.push(blocks.noteLines.join(" ").replace(/\s+/g, " ").trim());
  if (meta.restMinutes !== undefined) notes.push(`Ruhezeit: ca. ${meta.restMinutes} Minuten`);
  if (notes.length > 0) fields.notes = notes.join("\n\n");

  const confidence = scoreSegmentation(fields, {
    ...options,
    ingredientsVia: blocks.ingredientsVia,
    stepsVia: blocks.stepsVia,
    titleExplicit: (titleOverride !== undefined && titleOverride.length > 0) || detected.explicit,
    metaLabelled: meta.labelled,
  });

  return {
    fields,
    confidence,
    diagnostics: {
      ingredientsVia: blocks.ingredientsVia,
      stepsVia: blocks.stepsVia,
      lineCount: lines.length,
    },
  };
}

/** Runs the shared ingredient builder while preserving per-entry sections. */
function buildIngredientsWithSections(
  entries: ReadonlyArray<{ text: string; section?: string }>,
): NonNullable<ParsedFields["ingredients"]> {
  const out: NonNullable<ParsedFields["ingredients"]> = [];
  for (const entry of entries) {
    const built = buildIngredients([entry.text], {
      repairLine: repairIngredientLine,
      ...(entry.section === undefined ? {} : { initialSection: entry.section }),
    });
    for (const ingredient of built) out.push({ ...ingredient, position: out.length });
  }
  return out;
}

interface ScoreContext extends SegmentTextOptions {
  ingredientsVia: Blocks["ingredientsVia"];
  stepsVia: Blocks["stepsVia"];
  titleExplicit: boolean;
  metaLabelled: boolean;
}

/**
 * Per-field confidence for a text segmentation. An exact PDF text layer starts
 * high; OCR is blended with the engine's own mean confidence.
 */
export function scoreSegmentation(fields: ParsedFields, context: ScoreContext): ParsedRecipeConfidence {
  const base =
    context.source === "pdf-text"
      ? 0.9
      : context.source === "manual"
        ? 0.75
        : 0.5 + 0.4 * Math.min(1, Math.max(0, context.ocrConfidence ?? 0.6));

  const ingredients = fields.ingredients ?? [];
  const withAmount = ingredients.filter(
    (ingredient) => typeof ingredient.quantity === "number" || typeof ingredient.unit === "string",
  ).length;
  const amountShare = ingredients.length === 0 ? 0 : withAmount / ingredients.length;

  const parts: Omit<ParsedRecipeConfidence, "overall"> = {
    title: fields.title === undefined ? 0 : base * (context.titleExplicit ? 1 : 0.7),
    ingredients:
      ingredients.length === 0
        ? 0
        : base * (0.45 + 0.55 * amountShare) * (context.ingredientsVia === "heading" ? 1 : 0.85),
    steps:
      (fields.steps?.length ?? 0) === 0
        ? 0
        : base *
          (context.stepsVia === "heading" ? 1 : context.stepsVia === "numbered" ? 0.95 : 0.75) *
          ((fields.steps?.length ?? 0) === 1 ? 0.8 : 1),
    servings: fields.servings === undefined ? 0 : base * (context.metaLabelled ? 0.95 : 0.75),
    times:
      fields.prepMinutes === undefined && fields.cookMinutes === undefined && fields.totalMinutes === undefined
        ? 0
        : base * (context.metaLabelled ? 0.95 : 0.7),
  };

  return { ...parts, overall: computeOverallConfidence(parts) };
}
