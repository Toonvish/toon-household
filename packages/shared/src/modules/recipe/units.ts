/**
 * Unit vocabulary + normalisation. German first, English aliases accepted.
 * Pure, no I/O — safe to import from api, web and tests.
 */

export type UnitKind = "mass" | "volume" | "spoon" | "count" | "length" | "unknown";

/**
 * Canonical unit tokens. These are the ONLY strings that `normalizeUnit` emits for
 * known units, and the strings the UI renders verbatim.
 */
export const CANONICAL_UNITS = [
  // mass
  "mg",
  "g",
  "kg",
  "oz",
  "lb",
  // volume
  "ml",
  "cl",
  "l",
  "Tasse",
  "Becher",
  // spoons / tips
  "EL",
  "TL",
  "Msp.",
  "Schuss",
  "Spritzer",
  "Tropfen",
  // countables
  "Stück",
  "Prise",
  "Bund",
  "Pck.",
  "Dose",
  "Glas",
  "Flasche",
  "Beutel",
  "Tube",
  "Zehe",
  "Knolle",
  "Kopf",
  "Stange",
  "Zweig",
  "Blatt",
  "Scheibe",
  "Würfel",
  "Kugel",
  "Handvoll",
  "Rispe",
  "Portion",
  "Riegel",
  "Päckchen",
  // length
  "cm",
  "mm",
] as const;

export type CanonicalUnit = (typeof CANONICAL_UNITS)[number];

const KIND_BY_UNIT: Record<CanonicalUnit, UnitKind> = {
  mg: "mass",
  g: "mass",
  kg: "mass",
  oz: "mass",
  lb: "mass",
  ml: "volume",
  cl: "volume",
  l: "volume",
  Tasse: "volume",
  Becher: "volume",
  EL: "spoon",
  TL: "spoon",
  "Msp.": "spoon",
  Schuss: "spoon",
  Spritzer: "spoon",
  Tropfen: "spoon",
  "Stück": "count",
  Prise: "count",
  Bund: "count",
  "Pck.": "count",
  Dose: "count",
  Glas: "count",
  Flasche: "count",
  Beutel: "count",
  Tube: "count",
  Zehe: "count",
  Knolle: "count",
  Kopf: "count",
  Stange: "count",
  Zweig: "count",
  Blatt: "count",
  Scheibe: "count",
  "Würfel": "count",
  Kugel: "count",
  Handvoll: "count",
  Rispe: "count",
  Portion: "count",
  Riegel: "count",
  "Päckchen": "count",
  cm: "length",
  mm: "length",
};

/**
 * alias (lowercased, dots stripped) -> canonical unit.
 * Keys must be lowercase and free of "." because lookup normalises the input the same way.
 */
const UNIT_ALIASES: Record<string, CanonicalUnit> = {
  // mass
  mg: "mg",
  milligramm: "mg",
  g: "g",
  gr: "g",
  gramm: "g",
  gramme: "g",
  gram: "g",
  grams: "g",
  kg: "kg",
  kilo: "kg",
  kilos: "kg",
  kilogramm: "kg",
  kilogram: "kg",
  kilograms: "kg",
  oz: "oz",
  ounce: "oz",
  ounces: "oz",
  unze: "oz",
  unzen: "oz",
  lb: "lb",
  lbs: "lb",
  pound: "lb",
  pounds: "lb",
  pfund: "lb",
  // volume
  ml: "ml",
  milliliter: "ml",
  millilitre: "ml",
  milliliters: "ml",
  cc: "ml",
  cl: "cl",
  centiliter: "cl",
  l: "l",
  liter: "l",
  litre: "l",
  liters: "l",
  litres: "l",
  tasse: "Tasse",
  tassen: "Tasse",
  cup: "Tasse",
  cups: "Tasse",
  becher: "Becher",
  // spoons
  el: "EL",
  esslöffel: "EL",
  esslöffeln: "EL",
  essloeffel: "EL",
  eßl: "EL",
  tbsp: "EL",
  tbs: "EL",
  tablespoon: "EL",
  tablespoons: "EL",
  tl: "TL",
  teelöffel: "TL",
  teeloeffel: "TL",
  tsp: "TL",
  teaspoon: "TL",
  teaspoons: "TL",
  msp: "Msp.",
  messerspitze: "Msp.",
  messerspitzen: "Msp.",
  schuss: "Schuss",
  spritzer: "Spritzer",
  dash: "Spritzer",
  splash: "Schuss",
  tropfen: "Tropfen",
  drop: "Tropfen",
  drops: "Tropfen",
  // countables
  stück: "Stück",
  stueck: "Stück",
  stk: "Stück",
  st: "Stück",
  piece: "Stück",
  pieces: "Stück",
  prise: "Prise",
  prisen: "Prise",
  pinch: "Prise",
  pinches: "Prise",
  bund: "Bund",
  bündel: "Bund",
  bunch: "Bund",
  bunches: "Bund",
  pck: "Pck.",
  pkg: "Pck.",
  pack: "Pck.",
  packung: "Pck.",
  packungen: "Pck.",
  package: "Pck.",
  packages: "Pck.",
  päckchen: "Päckchen",
  paeckchen: "Päckchen",
  dose: "Dose",
  dosen: "Dose",
  can: "Dose",
  cans: "Dose",
  tin: "Dose",
  glas: "Glas",
  gläser: "Glas",
  jar: "Glas",
  flasche: "Flasche",
  flaschen: "Flasche",
  bottle: "Flasche",
  beutel: "Beutel",
  bag: "Beutel",
  sachet: "Beutel",
  tube: "Tube",
  zehe: "Zehe",
  zehen: "Zehe",
  clove: "Zehe",
  cloves: "Zehe",
  knolle: "Knolle",
  knollen: "Knolle",
  kopf: "Kopf",
  köpfe: "Kopf",
  head: "Kopf",
  stange: "Stange",
  stangen: "Stange",
  stalk: "Stange",
  stalks: "Stange",
  stick: "Stange",
  sticks: "Stange",
  zweig: "Zweig",
  zweige: "Zweig",
  sprig: "Zweig",
  sprigs: "Zweig",
  blatt: "Blatt",
  blätter: "Blatt",
  blaetter: "Blatt",
  leaf: "Blatt",
  leaves: "Blatt",
  scheibe: "Scheibe",
  scheiben: "Scheibe",
  slice: "Scheibe",
  slices: "Scheibe",
  würfel: "Würfel",
  wuerfel: "Würfel",
  cube: "Würfel",
  cubes: "Würfel",
  kugel: "Kugel",
  kugeln: "Kugel",
  scoop: "Kugel",
  handvoll: "Handvoll",
  handful: "Handvoll",
  rispe: "Rispe",
  rispen: "Rispe",
  portion: "Portion",
  portionen: "Portion",
  serving: "Portion",
  servings: "Portion",
  riegel: "Riegel",
  bar: "Riegel",
  // length
  cm: "cm",
  zentimeter: "cm",
  mm: "mm",
};

/** Alias keys sorted longest-first — used by the ingredient tokeniser. */
export const UNIT_ALIAS_KEYS: readonly string[] = Object.keys(UNIT_ALIASES).sort(
  (a, b) => b.length - a.length,
);

function aliasKey(raw: string): string {
  return raw
    .trim()
    .replace(/\.$/, "")
    .replace(/\.$/, "")
    .toLowerCase();
}

/**
 * Maps any spelling of a unit onto its canonical token.
 * Unknown units are returned trimmed and otherwise untouched (never dropped),
 * so hand-typed exotic units survive a round-trip.
 */
export function normalizeUnit(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return "";
  const direct = UNIT_ALIASES[aliasKey(trimmed)];
  if (direct) return direct;
  // "g." / "EL." / trailing punctuation
  const stripped = trimmed.replace(/[.,;:]+$/, "").trim();
  const second = UNIT_ALIASES[aliasKey(stripped)];
  if (second) return second;
  return stripped.length > 0 ? stripped : trimmed;
}

/** True when `raw` is a unit this app knows (in any spelling). */
export function isKnownUnit(raw: string): boolean {
  const key = aliasKey(raw.replace(/[.,;:]+$/, ""));
  return key.length > 0 && key in UNIT_ALIASES;
}

/** Classifies a unit. Accepts canonical or alias spelling. */
export function unitKind(raw: string): UnitKind {
  const canonical = normalizeUnit(raw);
  return KIND_BY_UNIT[canonical as CanonicalUnit] ?? "unknown";
}

/**
 * Units whose amount is *not* meaningfully scalable by a servings factor
 * (a "Prise" stays a "Prise"). Kept here so UI and API agree.
 */
export const NON_SCALING_UNITS: readonly string[] = ["Prise", "Msp.", "Spritzer", "Schuss"];

/* -------------------------------------------------------------------------- */
/* conversion                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * How many BASE units one of this unit is worth, per kind.
 *
 * Only kinds with a fixed physical ratio are listed. `spoon`, `count` and `unknown`
 * are deliberately absent: an "EL" is not a reliable volume (it depends on what is
 * in it), and a "Dose" has no size at all. Those units only ever compare equal to
 * themselves — see {@link areUnitsCompatible}.
 *
 * `Tasse`/`Becher` are volume by kind but have no standard size in German recipes,
 * so they are excluded here too and behave like countables.
 */
const BASE_FACTORS: Partial<Record<CanonicalUnit, number>> = {
  // mass, base = g
  mg: 0.001,
  g: 1,
  kg: 1000,
  oz: 28.349523125,
  lb: 453.59237,
  // volume, base = ml
  ml: 1,
  cl: 10,
  l: 1000,
  // length, base = mm
  mm: 1,
  cm: 10,
};

/** Base unit each convertible kind is normalised to. */
const BASE_UNIT: Partial<Record<UnitKind, CanonicalUnit>> = {
  mass: "g",
  volume: "ml",
  length: "mm",
};

/**
 * Display preference per kind, largest first: the first unit whose value comes out
 * at >= 1 wins. `1200 g` therefore renders as `1.2 kg` and `800 g` stays `800 g`.
 */
const DISPLAY_LADDER: Partial<Record<UnitKind, readonly CanonicalUnit[]>> = {
  mass: ["kg", "g"],
  volume: ["l", "ml"],
  length: ["cm", "mm"],
};

/** True when `raw` has a fixed ratio to its kind's base unit. */
export function isConvertibleUnit(raw: string): boolean {
  return normalizeUnit(raw) in BASE_FACTORS;
}

/**
 * Converts `value` between two units of the SAME kind.
 * Returns undefined when either unit has no fixed ratio or the kinds differ —
 * callers must treat that as "cannot be combined", never as zero.
 */
export function convertUnit(value: number, from: string, to: string): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  const fromUnit = normalizeUnit(from) as CanonicalUnit;
  const toUnit = normalizeUnit(to) as CanonicalUnit;
  if (fromUnit === toUnit) return value;
  if (unitKind(fromUnit) !== unitKind(toUnit)) return undefined;
  const fromFactor = BASE_FACTORS[fromUnit];
  const toFactor = BASE_FACTORS[toUnit];
  if (fromFactor === undefined || toFactor === undefined) return undefined;
  return (value * fromFactor) / toFactor;
}

/**
 * True when two amounts can be added into ONE amount.
 *
 * Either the units are the same token, or they belong to the same convertible kind
 * ("g" + "kg"). Two absent units are compatible ("3 Eier" + "2 Eier"); an absent
 * unit never merges with a present one, because "200 g Mehl" and "Mehl" are a
 * different statement about how much to buy.
 */
export function areUnitsCompatible(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const left = a ? normalizeUnit(a) : "";
  const right = b ? normalizeUnit(b) : "";
  if (left === right) return true;
  if (left === "" || right === "") return false;
  return convertUnit(1, left, right) !== undefined;
}

/**
 * Picks the nicest unit for an amount within its own kind
 * (`{ quantity: 1200, unit: "g" }` -> `{ quantity: 1.2, unit: "kg" }`).
 * Non-convertible units are returned untouched.
 */
export function preferredDisplayUnit(
  quantity: number,
  unit: string,
): { quantity: number; unit: string } {
  const canonical = normalizeUnit(unit) as CanonicalUnit;
  const kind = unitKind(canonical);
  const ladder = DISPLAY_LADDER[kind];
  const base = BASE_UNIT[kind];
  if (!ladder || !base || BASE_FACTORS[canonical] === undefined) {
    return { quantity, unit: canonical };
  }
  for (const candidate of ladder) {
    const converted = convertUnit(quantity, canonical, candidate);
    if (converted !== undefined && Math.abs(converted) >= 1) {
      return { quantity: converted, unit: candidate };
    }
  }
  // Everything below 1 of the smallest rung: keep the smallest rung.
  const smallest = ladder[ladder.length - 1]!;
  return { quantity: convertUnit(quantity, canonical, smallest) ?? quantity, unit: smallest };
}
