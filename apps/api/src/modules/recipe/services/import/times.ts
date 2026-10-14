/**
 * Labelled time / servings / difficulty scanning for free text.
 *
 * Shared by the OCR segmenter and the HTML site adapters, because both face the
 * same German label vocabulary ("Arbeitszeit ca. 20 Minuten", "Koch-/Backzeit",
 * "Ruhezeit", "4 Portionen", "Schwierigkeitsgrad: simpel").
 *
 * The value capture is deliberately NARROW: an early version captured
 * "[^,;|]{1,40}" and happily swallowed the next badge, so
 * "Arbeitszeit ca. 30 Minuten Backzeit 45 Min." parsed as 75 minutes. The
 * pattern below only matches a real duration expression.
 */
import { type Servings, parseDuration, parseServings } from "@toon/shared";
import { normalizeDifficulty } from "./parsed.ts";

/** One duration expression: "30 Minuten", "1 Std. 15 Min.", "20-25 Min", "1,5 h". */
const NUMBER = String.raw`\d{1,4}(?:[.,]\d{1,2})?|[½¼¾⅓⅔]|\d{1,4}\s*[½¼¾⅓⅔]`;
const TIME_UNIT = String.raw`minuten?|min\.?|stunden?|stdn?\.?|std\.?|h\b|tage?|d\b|sekunden?|sek\.?`;
const DURATION = String.raw`(?:${NUMBER})(?:\s*(?:-|–|—|bis|to)\s*(?:${NUMBER}))?\s*(?:${TIME_UNIT})(?:\s*(?:${NUMBER})\s*(?:minuten?|min\.?|sekunden?|sek\.?))?`;

/** Optional hedge between the label and the value ("ca.", "etwa", "rund"). */
const HEDGE = String.raw`(?:\s*(?::|=|–|-)?\s*(?:ca\.?|etwa|rund|circa|zirka|ungef(?:ä|a)hr|approx\.?|mind\.?|max\.?)?\s*)`;

export type TimeField = "prepMinutes" | "cookMinutes" | "totalMinutes" | "restMinutes";

const TIME_LABELS: ReadonlyArray<readonly [string, TimeField]> = [
  [String.raw`arbeitszeit|zubereitungszeit|vorbereitungszeit|vorbereitung|aktive\s+zeit|prep\s*time`, "prepMinutes"],
  [
    String.raw`koch-?\s*\/?\s*backzeit|back-?\s*\/?\s*kochzeit|backzeit|garzeit|kochzeit|bratzeit|ofenzeit|cook\s*time|bake\s*time`,
    "cookMinutes",
  ],
  [String.raw`gesamtzeit|zeit\s+insgesamt|gesamtdauer|total\s*time|dauer`, "totalMinutes"],
  [
    String.raw`ruhezeit|wartezeit|k(?:ü|u)hlzeit|gehzeit|marinierzeit|quellzeit|rest\s*time|chill\s*time`,
    "restMinutes",
  ],
];

const TIME_PATTERNS: ReadonlyArray<readonly [RegExp, TimeField]> = TIME_LABELS.map(([labels, field]) => [
  new RegExp(String.raw`(?:${labels})${HEDGE}(${DURATION})`, "iu"),
  field,
]);

export type LabelledTimes = Partial<Record<TimeField, number>> & { labelled: boolean };

/**
 * Extracts labelled durations from a text blob.
 * Unlabelled durations are intentionally ignored — "30 Minuten gehen lassen"
 * inside a step is not the recipe's prep time.
 */
export function readLabelledTimes(text: string): LabelledTimes {
  const out: LabelledTimes = { labelled: false };
  if (typeof text !== "string" || text.length === 0) return out;
  for (const [pattern, field] of TIME_PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;
    const minutes = parseDuration(match[1]!.trim());
    if (minutes === undefined || minutes <= 0) continue;
    out[field] = minutes;
    out.labelled = true;
  }
  return out;
}

/** Yield nouns that make a number a servings count. */
const SERVINGS_UNIT = String.raw`portionen?|personen|st(?:ü|u)cke?|gl(?:ä|a)ser|glas|muffins?|scheiben|st(?:a|ä)ngen|bleche?|k(?:u|ü)chen|servings?|people`;
const SERVINGS_AMOUNT = String.raw`\d{1,3}(?:\s*(?:-|–|—|bis|to)\s*\d{1,3})?`;

/** "4 Portionen", "für 6 Personen", "12 Stück" anywhere in the text. */
const SERVINGS_INLINE_RE = new RegExp(
  String.raw`(?:f(?:ü|u)r\s+)?(${SERVINGS_AMOUNT})\s*(${SERVINGS_UNIT})\b`,
  "iu",
);
/** "Portionen: 4", "Ergibt 12", "Menge: 4 Gläser". */
const SERVINGS_LABEL_RE = new RegExp(
  String.raw`(?:portionen|ergibt|menge|ausbeute|reicht\s+f(?:ü|u)r|yield|serves)\s*:?\s*(${SERVINGS_AMOUNT})\s*(${SERVINGS_UNIT})?`,
  "iu",
);
/** A line that is nothing but a servings badge. */
const SERVINGS_STANDALONE_RE = new RegExp(
  String.raw`^\s*(?:f(?:ü|u)r\s+)?${SERVINGS_AMOUNT}\s*(?:${SERVINGS_UNIT})\s*$`,
  "iu",
);

export interface ServingsScan {
  servings?: Servings;
  /** True when an explicit label (not just "4 Portionen" in prose) was found. */
  labelled: boolean;
}

/**
 * Finds the servings/yield in free text. The inline "number + noun" form wins,
 * because the labelled form can otherwise capture a neighbouring badge.
 */
export function readServings(text: string): ServingsScan {
  if (typeof text !== "string" || text.length === 0) return { labelled: false };

  const inline = SERVINGS_INLINE_RE.exec(text);
  if (inline) {
    const servings = parseServings(`${inline[1]} ${inline[2]}`);
    if (servings) return { servings, labelled: true };
  }

  const labelled = SERVINGS_LABEL_RE.exec(text);
  if (labelled) {
    const servings = parseServings(`${labelled[1]} ${labelled[2] ?? "Portionen"}`);
    if (servings) return { servings, labelled: true };
  }

  return { labelled: false };
}

/** True when the whole line is just a servings badge ("4 Portionen"). */
export function isStandaloneServings(line: string): boolean {
  return SERVINGS_STANDALONE_RE.test(line);
}

const DIFFICULTY_RE = /(?:schwierigkeit(?:sgrad)?|niveau|difficulty)\s*:?\s*([\p{L}]{3,20})/iu;

/** Extracts "Schwierigkeitsgrad: einfach" style difficulty labels. */
export function readDifficulty(text: string): ReturnType<typeof normalizeDifficulty> {
  const match = DIFFICULTY_RE.exec(text);
  return normalizeDifficulty(match?.[1]);
}

/**
 * Labels that mark a line as recipe METADATA rather than an ingredient or a
 * step. Used by the OCR segmenter to drop badge lines.
 */
export const STRONG_META_LABEL_RE =
  /(arbeitszeit|zubereitungszeit|vorbereitungszeit|back-?\s*\/?\s*kochzeit|koch-?\s*\/?\s*backzeit|backzeit|garzeit|kochzeit|bratzeit|gesamtzeit|gesamtdauer|ruhezeit|wartezeit|k(?:ü|u)hlzeit|gehzeit|marinierzeit|schwierigkeit(?:sgrad)?|niveau|kalorien|\bkcal\b|n(?:ä|a)hrwert|portionsgr(?:ö|o)(?:ß|ss)e|ergibt|reicht f(?:ü|u)r|zubereitungsdauer|prep\s*time|cook\s*time|total\s*time)/iu;
