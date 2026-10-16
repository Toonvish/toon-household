/**
 * The validation-issue adapter (docs/EFFECT.md E4, plan e1 P2/P3): a failed decode's `SchemaIssue` tree becomes
 * a flat list of wire issues (`FlatIssue`), each resolved to a catalog key and a message in the requested
 * locale. Nothing here reads an Effect message: the wire issue rides on the schema as the `WIRE_ISSUE`
 * annotation of `../schemas/checks.ts`. The resolver ladder is the one docs/i18n.md section 5 describes,
 * unchanged since the Zod era (the catalog keys keep their `server.zod.*` names).
 *
 * Until E1-T11 `toValidationIssues` also takes a `ZodError` (plan e1 P8); its issues go through the same field
 * selection (`fromZodIssue`) and the same resolver.
 */
import { Predicate, SchemaAST, SchemaIssue } from "effect";
import type { ZodError } from "zod";
import type { $ZodIssue } from "zod/v4/core";
import { WIRE_ISSUE } from "../schemas/checks.ts";
import { SERVER_CATALOGS, type ServerKey } from "./catalogs/index.ts";
import { DEFAULT_LOCALE, type Locale } from "./locale.ts";
import { resolveCatalogKey } from "./translate.ts";
import type { MessageValues } from "./types.ts";

/**
 * One issue as the wire knows it (plan e1 P2): `code`, `path` and only the fields zod reported that the resolver
 * or a test reads. `origin` only for `too_small` / `too_big`, `expected` only for `invalid_type`, `format` only
 * for `invalid_format`, `minimum` only for `too_small`, `maximum` only for `too_big`, `params` only for a keyed
 * `custom` issue.
 */
export interface FlatIssue {
  readonly code: string;
  readonly path: ReadonlyArray<string | number>;
  readonly origin?: string;
  readonly expected?: string;
  readonly format?: string;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly params?: { readonly i18n: ServerKey };
}

type WireIssue = Omit<FlatIssue, "path">;

/** One `details` item of a `validation_failed` error. */
type ValidationIssueItem = {
  path: string;
  code: string;
  message: string;
  i18n: { key: ServerKey; values: MessageValues };
};

// ---------------------------------------------------------------------------------------------------------------
// SchemaIssue tree to FlatIssue list
// ---------------------------------------------------------------------------------------------------------------

/** The wire issue an AST carries as its own annotation, if any. */
function ownWire(ast: SchemaAST.AST): WireIssue | undefined {
  const value = ast.annotations?.[WIRE_ISSUE];
  return Predicate.isObject(value) ? (value as WireIssue) : undefined;
}

/** A union whose other members are only `null` / `undefined` (`Schema.NullOr`, `Schema.optional`): the one other member. */
function transparentMember(union: SchemaAST.Union): SchemaAST.AST | undefined {
  const others = union.types.filter((member) => !SchemaAST.isNull(member) && !SchemaAST.isUndefined(member));
  return others.length === 1 ? others[0] : undefined;
}

/** The innermost encoded side of a transformation chain. */
function encodedSide(ast: SchemaAST.AST): SchemaAST.AST {
  const encoding = ast.encoding;
  return encoding === undefined ? ast : encodedSide(encoding[encoding.length - 1]!.to);
}

/** The wire issue for an AST's runtime-type check: its annotation, else zod's wording for the AST's kind. */
function typeWire(ast: SchemaAST.AST): WireIssue | undefined {
  if (ast.encoding !== undefined) {
    // The type check runs on the encoded side (a transformation's source); a coercion from `unknown` has none,
    // and then the decoded side names the type (z.coerce.number() on a missing key: expected "number").
    return typeWire(encodedSide(ast)) ?? ownWire(ast) ?? kindWire(ast);
  }
  return ownWire(ast) ?? kindWire(ast);
}

/** zod's issue for a value of the wrong runtime type, by AST kind (P3 fallback for an un-annotated AST). */
function kindWire(ast: SchemaAST.AST): WireIssue | undefined {
  switch (ast._tag) {
    case "String":
      return { code: "invalid_type", expected: "string" };
    case "Number":
      return { code: "invalid_type", expected: "number" };
    case "Boolean":
      return { code: "invalid_type", expected: "boolean" };
    case "Null":
      return { code: "invalid_type", expected: "null" };
    case "Undefined":
      return { code: "invalid_type", expected: "undefined" };
    case "Arrays":
      return { code: "invalid_type", expected: "array" };
    case "Objects":
      return ast.propertySignatures.length === 0 && ast.indexSignatures.length > 0
        ? { code: "invalid_type", expected: "record" }
        : { code: "invalid_type", expected: "object" };
    case "Literal":
      return { code: "invalid_value" };
    case "Union": {
      const member = transparentMember(ast);
      if (member !== undefined) return typeWire(member);
      return ast.types.every(SchemaAST.isLiteral) ? { code: "invalid_value" } : { code: "invalid_union" };
    }
    default:
      return undefined;
  }
}

/** The wire issue for a value that matched no member of `union` (an `AnyOf` without member issues). */
function unionWire(union: SchemaAST.Union): WireIssue {
  return typeWire(union) ?? { code: "invalid_union" };
}

/** A filter's wire issue, if it carries one. */
function filterWire(filter: SchemaAST.Filter<unknown>): WireIssue | undefined {
  const value = filter.annotations?.[WIRE_ISSUE];
  return Predicate.isObject(value) ? (value as WireIssue) : undefined;
}

/** An `InvalidValue`'s own wire issue (`wireIssue(...)`), if any. */
function valueWire(issue: SchemaIssue.InvalidValue): WireIssue | undefined {
  const value = issue.annotations?.[WIRE_ISSUE];
  return Predicate.isObject(value) ? (value as WireIssue) : undefined;
}

/** The declared type of property `name` of a struct AST. */
function propertyType(container: SchemaAST.AST | undefined, name: PropertyKey): SchemaAST.AST | undefined {
  if (container === undefined || !SchemaAST.isObjects(container)) return undefined;
  return container.propertySignatures.find((signature) => signature.name === name)?.type;
}

function emit(out: Array<FlatIssue>, path: ReadonlyArray<string | number>, meta: WireIssue): void {
  out.push({ ...meta, path });
}

function toSegment(key: PropertyKey): string | number {
  return Predicate.isNumber(key) ? key : String(key);
}

function walk(
  issue: SchemaIssue.Issue,
  path: ReadonlyArray<string | number>,
  container: SchemaAST.AST | undefined,
  inherited: WireIssue | undefined,
  out: Array<FlatIssue>,
): void {
  switch (issue._tag) {
    case "Pointer": {
      const next = [...path, ...issue.path.map(toSegment)];
      if (issue.issue._tag === "MissingKey") {
        // A missing key reports the field type's own issue, as zod parses `undefined` against it.
        const name = issue.path[issue.path.length - 1];
        const type = name === undefined ? undefined : propertyType(container, name);
        emit(out, next, (type && typeWire(type)) ?? { code: "invalid_type" });
        return;
      }
      walk(issue.issue, next, container, inherited, out);
      return;
    }
    case "Composite":
      for (const child of issue.issues) walk(child, path, issue.ast, inherited, out);
      return;
    case "AnyOf": {
      const member = transparentMember(issue.ast);
      if (member !== undefined && ownWire(issue.ast) === undefined) {
        // `.nullable()` / `.optional()` are wrappers in zod, not unions: report the wrapped schema's issue.
        if (issue.issues.length === 0) emit(out, path, typeWire(member) ?? { code: "invalid_union" });
        else for (const child of issue.issues) walk(child, path, container, inherited, out);
        return;
      }
      emit(out, path, unionWire(issue.ast));
      return;
    }
    case "Encoding":
      walk(issue.issue, path, container, inherited, out);
      return;
    case "Filter":
      walk(issue.issue, path, container, filterWire(issue.filter) ?? inherited, out);
      return;
    case "InvalidValue":
      emit(out, path, valueWire(issue) ?? inherited ?? { code: "custom" });
      return;
    case "InvalidType":
      emit(out, path, typeWire(issue.ast) ?? { code: "invalid_type" });
      return;
    case "MissingKey":
      emit(out, path, { code: "invalid_type" });
      return;
    case "UnexpectedKey":
      emit(out, path, { code: "unrecognized_keys" });
      return;
    case "OneOf":
      emit(out, path, { code: "invalid_union" });
      return;
    case "Forbidden":
      emit(out, path, { code: "custom" });
      return;
  }
}

/** Flattens a decode failure's issue tree into the wire issues zod would have reported, in order (P3). */
export function flattenIssue(issue: SchemaIssue.Issue): Array<FlatIssue> {
  const out: Array<FlatIssue> = [];
  walk(issue, [], undefined, undefined, out);
  return out;
}

/**
 * The P2 field selection of a zod issue (transitional, removed with zod in E1-T11): what `toValidationIssues`
 * and `resolveZodIssue` resolve for a zod issue.
 */
export function fromZodIssue(issue: $ZodIssue): FlatIssue {
  const path = issue.path.map(toSegment);
  switch (issue.code) {
    case "too_small":
      return { code: issue.code, path, origin: issue.origin, minimum: Number(issue.minimum) };
    case "too_big":
      return { code: issue.code, path, origin: issue.origin, maximum: Number(issue.maximum) };
    case "invalid_type":
      return { code: issue.code, path, expected: issue.expected };
    case "invalid_format":
      return { code: issue.code, path, format: issue.format };
    case "custom": {
      const key = issue.params?.["i18n"];
      return Predicate.isString(key) ? { code: issue.code, path, params: { i18n: key as ServerKey } } : { code: issue.code, path };
    }
    default:
      return { code: issue.code, path };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// FlatIssue to catalog key and message
// ---------------------------------------------------------------------------------------------------------------

/** The last NON-NUMERIC path segment: an array element's tail is its index. */
function lastNamedSegment(path: ReadonlyArray<string | number>): string {
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const segment = path[index];
    if (Predicate.isNumber(segment)) continue;
    return String(segment);
  }
  return "";
}

function boundOf(issue: FlatIssue): number | undefined {
  if (issue.code === "too_small") return issue.minimum;
  if (issue.code === "too_big") return issue.maximum;
  return undefined;
}

function facetOf(issue: FlatIssue): string {
  if (issue.code === "invalid_format" && issue.format !== undefined) return issue.format;
  if (issue.code === "invalid_type" && issue.expected !== undefined) return issue.expected;
  if (issue.origin !== undefined) return issue.origin;
  return "_";
}

/** Key candidates for one issue, most specific first (docs/i18n.md section 5). */
function candidatesFor(issue: FlatIssue): { candidates: string[]; field: string; bound?: number; facet: string } {
  const field = lastNamedSegment(issue.path);
  const bound = boundOf(issue);
  const facet = facetOf(issue);
  const candidates = [
    bound !== undefined ? `server.zod.field.${field}.${issue.code}.${bound}` : undefined,
    `server.zod.field.${field}.${issue.code}`,
    `server.zod.${issue.code}.${facet}`,
    `server.zod.${issue.code}`,
    "server.zod.fallback",
  ].filter((candidate): candidate is string => candidate !== undefined);
  return { candidates, field, bound, facet };
}

/** Resolves ONE wire issue to a key and the message rendered in `locale`; an explicit `params.i18n` wins. */
export function resolveIssue(
  issue: FlatIssue,
  locale: Locale = DEFAULT_LOCALE,
): { message: string; key: ServerKey; values: MessageValues } {
  const customKey = issue.code === "custom" && Predicate.isString(issue.params?.i18n) ? issue.params.i18n : undefined;

  const { candidates, field, bound, facet } = candidatesFor(issue);
  const catalog = SERVER_CATALOGS[locale] ?? SERVER_CATALOGS[DEFAULT_LOCALE];
  const key = (customKey ??
    candidates.find((candidate) => Object.hasOwn(catalog, candidate)) ??
    "server.zod.fallback") as ServerKey;

  const values: MessageValues = { field, facet, ...(bound !== undefined ? { bound } : {}) };
  const message = resolveCatalogKey(catalog, locale, key, values) ?? key;
  return { message, key, values };
}

/**
 * Renders EVERY issue of a failed decode for the wire (`details`, docs/i18n.md section 4): a `SchemaIssue` tree
 * (an Effect `Schema` decode) or, until E1-T11, a `ZodError`.
 */
export function toValidationIssues(
  source: SchemaIssue.Issue | ZodError,
  locale: Locale = DEFAULT_LOCALE,
): Array<ValidationIssueItem> {
  const issues = SchemaIssue.isIssue(source)
    ? flattenIssue(source)
    : source.issues.map((issue) => fromZodIssue(issue as $ZodIssue));
  return issues.map((issue) => {
    const resolved = resolveIssue(issue, locale);
    return {
      path: issue.path.join("."),
      code: issue.code,
      message: resolved.message,
      i18n: { key: resolved.key, values: resolved.values },
    };
  });
}
