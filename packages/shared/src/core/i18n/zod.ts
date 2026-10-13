/**
 * Turns a finished Zod issue into a catalog key + values, for BOTH sides that
 * run the same schemas (browser `safeParse`, server `parse`). See docs/i18n.md
 * §5 for why this has to happen after the parse rather than via a per-parse
 * error map, and why the schemas themselves must never carry a message.
 */
import type { ZodError } from "zod";
import type { $ZodIssue } from "zod/v4/core";
import { DEFAULT_LOCALE, type Locale } from "./locale.ts";
import { resolveCatalogKey } from "./translate.ts";
import type { MessageValues } from "./types.ts";
import { SERVER_CATALOGS, type ServerKey } from "./catalogs/index.ts";

/**
 * Attaches an explicit key to a custom `.refine()`/`.superRefine()` check.
 * Zod 4 puts `params` on the issue (`$ZodIssueCustom.params`), which survives
 * onto the wire in `details`. Inference (below) cannot cover a refinement: it
 * has no `origin` and often an empty `path`, so several unrelated refinements
 * would otherwise key identically.
 *
 * Pure metadata — no locale is read here, nothing is resolved, and the schema
 * stays free of any i18n import at module-eval time.
 */
export function refineKey(key: ServerKey): { params: { i18n: ServerKey } } {
  return { params: { i18n: key } };
}

/** The last NON-NUMERIC path segment — an array element's tail is its index. */
function lastNamedSegment(path: ReadonlyArray<PropertyKey>): string {
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const segment = path[index];
    if (typeof segment === "number") continue;
    return String(segment);
  }
  return "";
}

function boundOf(issue: $ZodIssue): number | bigint | undefined {
  if (issue.code === "too_small") return issue.minimum;
  if (issue.code === "too_big") return issue.maximum;
  return undefined;
}

function facetOf(issue: $ZodIssue): string {
  if (issue.code === "invalid_format") return issue.format;
  if (issue.code === "invalid_type") return issue.expected;
  if ("origin" in issue && typeof issue.origin === "string") return issue.origin;
  return "_";
}

/** Key candidates for one issue, most specific first (§5). */
function candidatesFor(issue: $ZodIssue): { candidates: string[]; field: string; bound?: number | bigint; facet: string } {
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

/** Resolves ONE issue to a key + the message rendered in `locale`. */
export function resolveZodIssue(
  issue: $ZodIssue,
  locale: Locale = DEFAULT_LOCALE,
): { message: string; key: ServerKey; values: MessageValues } {
  // (b) an explicit key on a custom refinement always wins.
  const customKey =
    issue.code === "custom" && typeof issue.params?.i18n === "string" ? issue.params.i18n : undefined;

  const { candidates, field, bound, facet } = candidatesFor(issue);
  const catalog = SERVER_CATALOGS[locale] ?? SERVER_CATALOGS[DEFAULT_LOCALE];
  const key = (customKey ??
    candidates.find((candidate) => Object.hasOwn(catalog, candidate)) ??
    "server.zod.fallback") as ServerKey;

  const values: MessageValues = { field, facet, ...(bound !== undefined ? { bound: Number(bound) } : {}) };
  const message = resolveCatalogKey(catalog, locale, key, values) ?? key;
  return { message, key, values };
}

/** Renders EVERY issue on a finished `ZodError` for the wire (`details`, §4). */
export function toValidationIssues(
  error: ZodError,
  locale: Locale = DEFAULT_LOCALE,
): Array<{ path: string; code: string; message: string; i18n: { key: ServerKey; values: MessageValues } }> {
  return error.issues.map((issue) => {
    const resolved = resolveZodIssue(issue as $ZodIssue, locale);
    return {
      path: issue.path.join("."),
      code: issue.code,
      message: resolved.message,
      i18n: { key: resolved.key, values: resolved.values },
    };
  });
}
