/**
 * The Zod side of the issue resolution, kept until E1-T11 removes zod (plan e1 P8). The resolver itself lives in
 * `./issues.ts` (`resolveIssue` over a `FlatIssue`); `resolveZodIssue` selects a zod issue's wire fields and
 * resolves them the same way, for BOTH sides that still run zod schemas (browser `safeParse`, server `parse`).
 * See docs/i18n.md section 5 for why this has to happen after the parse rather than via a per-parse error map,
 * and why the schemas themselves must never carry a message.
 */
import type { $ZodIssue } from "zod/v4/core";
import { fromZodIssue, resolveIssue } from "./issues.ts";
import type { Locale } from "./locale.ts";
import type { MessageValues } from "./types.ts";
import type { ServerKey } from "./catalogs/index.ts";

/**
 * Attaches an explicit key to a custom `.refine()`/`.superRefine()` check.
 * Zod 4 puts `params` on the issue (`$ZodIssueCustom.params`), which survives
 * onto the wire in `details`. Inference (`./issues.ts`) cannot cover a refinement: it
 * has no `origin` and often an empty `path`, so several unrelated refinements
 * would otherwise key identically.
 *
 * Pure metadata — no locale is read here, nothing is resolved, and the schema
 * stays free of any i18n import at module-eval time.
 */
export function refineKey(key: ServerKey): { params: { i18n: ServerKey } } {
  return { params: { i18n: key } };
}

/** Resolves ONE zod issue to a key + the message rendered in `locale` (`resolveIssue` on its wire fields). */
export function resolveZodIssue(
  issue: $ZodIssue,
  locale?: Locale,
): { message: string; key: ServerKey; values: MessageValues } {
  return resolveIssue(fromZodIssue(issue), locale);
}
