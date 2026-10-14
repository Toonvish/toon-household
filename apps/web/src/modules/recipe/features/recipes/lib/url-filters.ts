/**
 * Recipe filters as REAL URL STATE.
 *
 * `/` declares `q/tags/collectionId/maxMinutes/difficulty/sort` as search params, but the
 * list screen used to keep them in `useState` only — so a filtered view could not be
 * shared or bookmarked, and the back button after filtering silently lost everything.
 * This hook is the single owner of that mapping.
 *
 * `/search` declares the same params and redirects to `/` with them, so links from before
 * search moved into the list still land on the same filtered view.
 *
 * The search TEXT is special: it stays in local state for input responsiveness and
 * is written to the URL debounced, so typing does not create one history entry per
 * keystroke (`replace: true` keeps it to one).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Difficulty, RecipeSort } from "@toon/shared";
import { useSearchParams } from "@/lib/navigation";
import { useAppNavigate } from "@/lib/nav";
import { useDebouncedValue } from "./hooks";
import type { RecipeListFilters } from "./queries";

const DIFFICULTIES: readonly Difficulty[] = ["einfach", "mittel", "schwer"];
const SORTS: readonly RecipeSort[] = ["newest", "oldest", "title", "rating", "time", "lastCooked"];

export const DEFAULT_SORT: RecipeSort = "newest";

/** Query-string shape both routes validate (all values are strings). */
export type RecipeSearchParams = Partial<
  Record<"q" | "tags" | "collectionId" | "maxMinutes" | "difficulty" | "sort", string>
>;

/** URL -> filters. Unknown or malformed values are ignored, never thrown on. */
export function filtersFromSearch(search: Record<string, string | undefined>): RecipeListFilters {
  const difficulty = DIFFICULTIES.find((value) => value === search.difficulty);
  const sort = SORTS.find((value) => value === search.sort) ?? DEFAULT_SORT;
  const tagIds = (search.tags ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  const maxMinutes = Number.parseInt(search.maxMinutes ?? "", 10);

  return {
    sort,
    ...(search.q && search.q.length > 0 ? { q: search.q } : {}),
    ...(tagIds.length > 0 ? { tagIds } : {}),
    ...(search.collectionId ? { collectionId: search.collectionId } : {}),
    ...(Number.isFinite(maxMinutes) && maxMinutes > 0 ? { maxMinutes } : {}),
    ...(difficulty ? { difficulty } : {}),
  };
}

/** Filters -> query string. Defaults and empty values are omitted, not encoded. */
export function searchFromFilters(filters: RecipeListFilters, q: string): RecipeSearchParams {
  return {
    ...(q.trim().length > 0 ? { q: q.trim() } : {}),
    ...(filters.tagIds && filters.tagIds.length > 0 ? { tags: [...filters.tagIds].join(",") } : {}),
    ...(filters.collectionId ? { collectionId: filters.collectionId } : {}),
    ...(filters.maxMinutes !== undefined ? { maxMinutes: String(filters.maxMinutes) } : {}),
    ...(filters.difficulty ? { difficulty: filters.difficulty } : {}),
    ...(filters.sort && filters.sort !== DEFAULT_SORT ? { sort: filters.sort } : {}),
  };
}

export interface UrlRecipeFilters {
  /** Raw text of the search box (updates on every keystroke). */
  searchText: string;
  setSearchText: (value: string) => void;
  /** Everything except the search text, straight from the URL. */
  filters: RecipeListFilters;
  setFilters: (next: RecipeListFilters) => void;
  /** `filters` plus the debounced search text — pass this to `useRecipeList`. */
  effectiveFilters: RecipeListFilters;
  /** True when anything is narrowing the list. */
  hasFilters: boolean;
  reset: () => void;
}

/**
 * @param route the path the current screen is mounted at ("/recipe") — needed because the URL
 *   is rewritten in place.
 */
export function useUrlRecipeFilters(route: string, debounceMs = 300): UrlRecipeFilters {
  const search = useSearchParams();
  const navigate = useAppNavigate();

  const filters = useMemo(() => filtersFromSearch(search), [search]);
  const urlQuery = search.q ?? "";

  const [searchText, setSearchText] = useState(urlQuery);
  const debouncedText = useDebouncedValue(searchText, debounceMs);

  const push = useCallback(
    (next: RecipeSearchParams) => {
      navigate({ to: route, search: next, replace: true });
    },
    [navigate, route],
  );

  // Local text -> URL, debounced. The guard is what stops the two effects here
  // from ping-ponging.
  useEffect(() => {
    if (debouncedText === urlQuery) return;
    push(searchFromFilters(filters, debouncedText));
  }, [debouncedText, urlQuery, filters, push]);

  // URL -> local text, so back/forward and a pasted link fill the input.
  useEffect(() => {
    if (urlQuery !== debouncedText) setSearchText(urlQuery);
    // Only react to the URL changing; `debouncedText` is read, not depended on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlQuery]);

  const effectiveFilters = useMemo<RecipeListFilters>(
    () => ({ ...filters, ...(debouncedText.trim().length > 0 ? { q: debouncedText } : { q: "" }) }),
    [filters, debouncedText],
  );

  const setFilters = useCallback(
    (next: RecipeListFilters) => push(searchFromFilters(next, searchText)),
    [push, searchText],
  );

  const reset = useCallback(() => {
    setSearchText("");
    push(searchFromFilters({ sort: filters.sort }, ""));
  }, [push, filters.sort]);

  const hasFilters =
    debouncedText.trim().length > 0 ||
    (filters.tagIds?.length ?? 0) > 0 ||
    filters.collectionId !== undefined ||
    filters.maxMinutes !== undefined ||
    filters.difficulty !== undefined;

  return { searchText, setSearchText, filters, setFilters, effectiveFilters, hasFilters, reset };
}
