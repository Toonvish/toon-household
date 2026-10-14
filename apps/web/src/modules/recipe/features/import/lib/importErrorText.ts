/**
 * Rendering seam for the import feature's unrendered error copy.
 *
 * `importApi.ts` cannot translate its own errors: it is not a component, so it
 * has no `useT()`, and the ambient `translate()` would freeze the copy at the
 * moment the error was thrown — which `useAutosave` then holds in React state
 * for as long as the review screen is open. So the errors carry
 * `ImportErrorText` and the RENDERER resolves it, which is also what
 * docs/i18n.md §10 rule 6 requires ("`useT()` in components").
 *
 * Two entry points, same rule as `useT()` vs `translate()`:
 *  - `useImportError()` in a component — re-renders on a locale switch,
 *  - `resolveImportErrorText(t, …)` where a `t` is already in hand (a callback
 *    that fires a toast, for instance).
 */
import type { Translator } from "@toon/shared";
import { useT } from "@/lib/i18n";
import type { CATALOGS } from "@/lib/i18n/catalogs/index.ts";
import { describeError, type ImportErrorText } from "./importApi";

type AppTranslator = Translator<typeof CATALOGS.de>;

/**
 * Renders one `ImportErrorText`.
 *
 * The `as never` casts mirror `translate()` in `lib/i18n/store.ts` and exist for
 * the same reason: `Translator` checks the placeholder set per literal key, and
 * a key only known at runtime cannot carry that proof. The keys themselves are
 * still `MessageKey`, so a typo is a compile error at the point the error is
 * CONSTRUCTED — which is where it matters.
 */
export function resolveImportErrorText(t: AppTranslator, text: ImportErrorText): string {
  return "text" in text ? text.text : t(text.key as never, text.values as never);
}

export interface RenderedImportError {
  readonly title: string;
  readonly hint: string;
  readonly retryable: boolean;
}

/**
 * `describeError()` + translation, for a caller that already holds a `t`.
 *
 * Use this rather than `useImportError()` wherever the call is not
 * unconditional — inside an `if` branch that returns early, or in a `useCallback`
 * that fires a toast. Both are places a hook cannot go.
 */
export function resolveDescribedError(t: AppTranslator, error: unknown): RenderedImportError {
  const described = describeError(error);
  return {
    title: resolveImportErrorText(t, described.title),
    hint: resolveImportErrorText(t, described.hint),
    retryable: described.retryable,
  };
}

/** `describeError()` + translation, bound to the active locale. */
export function useImportError(error: unknown): RenderedImportError {
  return resolveDescribedError(useT(), error);
}
