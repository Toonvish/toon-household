/**
 * Helpers that turn a handful of valid fixtures into the golden corpus's input
 * tables (plan e1 P1, E1-T01). Plain data only: nothing here imports zod or a
 * shared schema, so the corpus keeps building after the flips. The recorded
 * result of every input comes from zod 4.5.4 in `build.ts`, never from here.
 */

export interface Case {
  id: string;
  schema: string;
  input: unknown;
}

export const NAN = Number.NaN;
export const INF = Number.POSITIVE_INFINITY;
export const NEG_INF = Number.NEGATIVE_INFINITY;

type PathSegment = string | number;
type Path = PathSegment[];

/** A short, stable, file-safe label for an input value. */
export function slug(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "NaN";
    return String(value);
  }
  if (typeof value === "boolean") return String(value);
  if (typeof value === "string") {
    const escaped = JSON.stringify(value)
      .slice(1, -1)
      .replace(/[^\x20-\x7e]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
    return value.length > 44 ? `s(${escaped.slice(0, 32)}~len${value.length})` : `s(${escaped})`;
  }
  if (Array.isArray(value) || typeof value === "object") {
    const text = JSON.stringify(value, (_key, inner: unknown) => {
      if (inner === undefined) return "undefined";
      if (typeof inner === "number" && !Number.isFinite(inner)) return String(inner);
      return inner;
    });
    return text.length > 56 ? `${text.slice(0, 52)}~${text.length}` : text;
  }
  return typeof value;
}

/** Appends `-2`, `-3`, … to a repeated id so every id of a file is unique. */
export function uniqueIds(cases: Case[]): Case[] {
  const seen = new Map<string, number>();
  return cases.map((entry) => {
    const count = (seen.get(entry.id) ?? 0) + 1;
    seen.set(entry.id, count);
    return count === 1 ? entry : { ...entry, id: `${entry.id}-${count}` };
  });
}

/** `schema#label` for every `[label, input]` pair. */
export function table(schema: string, rows: ReadonlyArray<readonly [string, unknown]>): Case[] {
  return rows.map(([label, input]) => ({ id: `${schema}#${label}`, schema, input }));
}

/** `schema#<slug of the value>` for every value. */
export function probe(schema: string, values: readonly unknown[], prefix = ""): Case[] {
  return values.map((value) => ({ id: `${schema}#${prefix}${slug(value)}`, schema, input: value }));
}

/** The type probes every leaf schema gets, whatever it expects. */
export const TYPE_PROBES: readonly unknown[] = [
  undefined,
  null,
  "",
  0,
  1,
  true,
  false,
  [],
  {},
  NAN,
  INF,
  NEG_INF,
];

/** Leaf schema (a string rule): the type probes plus the given values. */
export function leaf(schema: string, values: readonly unknown[]): Case[] {
  return [...probe(schema, TYPE_PROBES, "type-"), ...probe(schema, values)];
}

/** Number leaf: the usual number probes (non-finite, fractional, huge) plus the given values. */
export const NUMBER_PROBES: readonly unknown[] = [
  0,
  1,
  -1,
  2,
  1.5,
  -1.5,
  0.1,
  100,
  1e20,
  -1e20,
  9007199254740991,
  -9007199254740991,
  9007199254740992,
  -9007199254740992,
  NAN,
  INF,
  NEG_INF,
  "1",
  "abc",
  "",
  null,
  undefined,
  true,
  [],
  {},
];

export function numberLeaf(schema: string, values: readonly unknown[] = []): Case[] {
  return [...probe(schema, NUMBER_PROBES, "n-"), ...probe(schema, values)];
}

/** Enum / literal leaf: every member, a variant, a wrong value, wrong types. */
export function enumLeaf(schema: string, members: readonly string[], extra: readonly unknown[] = []): Case[] {
  const variants = [
    members[0]?.toUpperCase() ?? "X",
    ` ${members[0] ?? "x"}`,
    `${members[0] ?? "x"} `,
    "nope",
    "",
    ...extra,
  ];
  return [...probe(schema, members, "member-"), ...probe(schema, variants, "bad-"), ...probe(schema, TYPE_PROBES, "type-")];
}

/* -------------------------------------------------------------------------- */
/* Structural mutations of a valid object                                      */
/* -------------------------------------------------------------------------- */

/** Marks a key to delete in `withPath`. */
export const REMOVE = Symbol("remove");

function setAt(root: unknown, path: Path, value: unknown): unknown {
  const copy = structuredClone(root) as unknown;
  if (path.length === 0) return value;
  let node = copy as Record<PathSegment, unknown>;
  for (let index = 0; index < path.length - 1; index += 1) {
    node = node[path[index] as PathSegment] as Record<PathSegment, unknown>;
  }
  const last = path[path.length - 1] as PathSegment;
  if (value === REMOVE) {
    if (Array.isArray(node)) node.splice(Number(last), 1);
    else delete node[last];
  } else {
    node[last] = value;
  }
  return copy;
}

interface Node {
  path: Path;
  value: unknown;
}

function nodesOf(value: unknown, path: Path = [], out: Node[] = []): Node[] {
  if (Array.isArray(value)) {
    if (path.length > 0) out.push({ path, value });
    if (value.length > 0) nodesOf(value[0], [...path, 0], out);
    return out;
  }
  if (value !== null && typeof value === "object") {
    if (path.length > 0) out.push({ path, value });
    for (const [key, child] of Object.entries(value)) nodesOf(child, [...path, key], out);
    return out;
  }
  out.push({ path, value });
  return out;
}

export interface GenOptions {
  /** `full` for request / query schemas, `light` for responses and entities. */
  mode?: "full" | "light";
  /** The smallest valid input (optional / nullish keys absent). */
  minimal?: unknown;
  /** A valid input with every nullable / nullish key set to `null`. */
  allNull?: unknown;
  /** Further hand-written inputs, `label -> input`. */
  extra?: Record<string, unknown>;
  /** Dotted paths whose string length (or array length) is probed at these sizes. */
  lens?: Record<string, readonly number[]>;
  /** The element an array path is padded with in `lens` (default: its first element). */
  lenItem?: Record<string, unknown>;
  /** Dotted paths left out of the mutations (covered by hand); `a.b.*` leaves out everything below `a.b`. */
  skip?: readonly string[];
  /** Light mode: nodes deeper than this get only the type and non-finite probes (default 1). */
  depth?: number;
}

const dotted = (path: Path): string => path.join(".");

function lensFor(sample: unknown, size: number, element: unknown): unknown {
  if (typeof sample === "string") return "a".repeat(size);
  if (Array.isArray(sample)) return Array.from({ length: size }, () => structuredClone(element));
  return sample;
}

function mutationsFor(node: Node, mode: "full" | "light", lens: readonly number[], deep: boolean, item: unknown): Array<[string, unknown]> {
  const { value } = node;
  const full = mode === "full";
  const out: Array<[string, unknown]> = [];
  const typed = (label: string, probeValue: unknown): void => {
    out.push([label, probeValue]);
  };
  if (typeof value === "number") {
    typed("nan", NAN);
    typed("inf", INF);
    typed("neg-inf", NEG_INF);
    typed("str-x", "x");
    if (deep) return out;
    typed("missing", REMOVE);
    typed("null", null);
    typed("neg1", -1);
    typed("frac", 1.5);
    if (full) {
      typed("undefined", undefined);
      typed("str-1", "1");
      typed("zero", 0);
      typed("big", 1e20);
      typed("neg-big", -1e20);
      typed("max-safe-plus-1", 9007199254740992);
    }
    return out;
  }
  if (typeof value === "string") {
    typed("num", 1);
    if (deep) return out;
    typed("missing", REMOVE);
    typed("null", null);
    if (full) {
      typed("undefined", undefined);
      typed("empty", "");
      typed("blank", "   ");
      typed("padded", `  ${value}  `);
    }
    for (const size of lens) typed(`len${size}`, lensFor(value, size, undefined));
    return out;
  }
  if (typeof value === "boolean") {
    typed("str-x", "x");
    if (deep) return out;
    typed("missing", REMOVE);
    typed("null", null);
    if (full) {
      typed("undefined", undefined);
      typed("str-true", "true");
      typed("num1", 1);
    }
    return out;
  }
  if (Array.isArray(value)) {
    typed("str-x", "x");
    if (deep) return out;
    typed("missing", REMOVE);
    typed("null", null);
    if (full) {
      typed("undefined", undefined);
      typed("with-null", [null]);
      typed("empty", []);
    }
    for (const size of lens) typed(`len${size}`, lensFor(value, size, item === undefined ? value[0] : item));
    return out;
  }
  if (value === null) {
    typed("str-x", "x");
    if (deep) return out;
    typed("missing", REMOVE);
    if (full) {
      typed("undefined", undefined);
      typed("num1", 1);
    }
    return out;
  }
  // an object node
  typed("str-x", "x");
  if (deep) return out;
  typed("missing", REMOVE);
  typed("null", null);
  if (full) {
    typed("undefined", undefined);
    typed("array", []);
  }
  return out;
}

/**
 * The inputs of one object-shaped schema: the valid fixture, the minimal and
 * all-null variants, non-object roots, an unknown key, and a mutation table for
 * every node of the valid fixture (see `GenOptions`).
 */
export function gen(schema: string, valid: unknown, options: GenOptions = {}): Case[] {
  const mode = options.mode ?? "light";
  const maxDepth = options.depth ?? (mode === "full" ? 99 : 1);
  const skip = new Set(options.skip ?? []);
  const cases: Case[] = [{ id: `${schema}#valid`, schema, input: valid }];
  if (options.minimal !== undefined) cases.push({ id: `${schema}#minimal`, schema, input: options.minimal });
  if (options.allNull !== undefined) cases.push({ id: `${schema}#all-null`, schema, input: options.allNull });
  for (const [label, input] of Object.entries(options.extra ?? {})) {
    cases.push({ id: `${schema}#${label}`, schema, input });
  }
  const isRecord = valid !== null && typeof valid === "object" && !Array.isArray(valid);
  for (const [label, input] of [
    ["root-null", null],
    ["root-undefined", undefined],
    ["root-string", "x"],
    ["root-array", []],
    ["root-number", 1],
    ["root-nan", NAN],
    ["root-true", true],
    ["root-empty-object", {}],
  ] as const) {
    cases.push({ id: `${schema}#${label}`, schema, input });
  }
  if (isRecord) {
    cases.push({ id: `${schema}#unknown-key`, schema, input: { ...(valid as object), unknownKey: 1 } });
  }
  for (const node of nodesOf(valid)) {
    if (node.path.length === 0) continue;
    const name = dotted(node.path);
    if (skip.has(name) || [...skip].some((entry) => entry.endsWith(".*") && name.startsWith(entry.slice(0, -1)))) continue;
    const deep = node.path.length > maxDepth;
    for (const [label, replacement] of mutationsFor(node, mode, options.lens?.[name] ?? [], deep, options.lenItem?.[name])) {
      cases.push({ id: `${schema}#${name}=${label}`, schema, input: setAt(valid, node.path, replacement) });
    }
  }
  return uniqueIds(cases);
}

/** `value` with the given dotted paths replaced (hand-written variations of a fixture). */
export function withPath(base: unknown, path: string, value: unknown): unknown {
  return setAt(base, path.split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : part)), value);
}

/** `value` without the given top-level keys. */
export function without(base: object, ...keys: string[]): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const key of keys) delete copy[key];
  return copy;
}

/** Every nullable / nullish key of an object set to `null` (top level only). */
export function nulled(base: object, keys: readonly string[]): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const key of keys) copy[key] = null;
  return copy;
}

/** `{ ...base, key: value }` keys given as `[key, value]` pairs, one case each. */
export function variants(
  schema: string,
  base: object,
  prefix: string,
  entries: ReadonlyArray<readonly [string, unknown]>,
): Case[] {
  return entries.map(([key, value]) => ({
    id: `${schema}#${prefix}${key}=${slug(value)}`,
    schema,
    input: { ...(base as Record<string, unknown>), [key]: value },
  }));
}

/** Query-string inputs: every value a `searchParams` object can carry. */
export const COERCE_STRINGS: readonly unknown[] = [
  "",
  "abc",
  "1.5",
  "-1",
  "0",
  "24",
  " 12 ",
  "1e2",
  "Infinity",
  "-Infinity",
  "NaN",
  "0x10",
  "1_000",
  ["1", "2"],
  1,
  24,
  0,
  -1,
  1.5,
  101,
  NAN,
  INF,
  NEG_INF,
  null,
  true,
  [],
  {},
];

/**
 * For a schema over an object with optional keys: every key alone, alone with
 * `undefined`, alone with `null`, and every pair of the first four keys; the
 * shapes the "at least one key" refinements and `.partial()` act on.
 */
export function singleKeys(schema: string, valid: Record<string, unknown>, pairs = true): Case[] {
  const keys = Object.keys(valid);
  const cases: Case[] = [];
  for (const key of keys) {
    cases.push({ id: `${schema}#only-${key}`, schema, input: { [key]: valid[key] } });
    cases.push({ id: `${schema}#only-${key}-undefined`, schema, input: { [key]: undefined } });
    cases.push({ id: `${schema}#only-${key}-null`, schema, input: { [key]: null } });
  }
  if (pairs) {
    const head = keys.slice(0, 4);
    for (let first = 0; first < head.length; first += 1) {
      for (let second = first + 1; second < head.length; second += 1) {
        const a = head[first] as string;
        const b = head[second] as string;
        cases.push({ id: `${schema}#pair-${a}+${b}`, schema, input: { [a]: valid[a], [b]: valid[b] } });
      }
    }
  }
  return cases;
}
