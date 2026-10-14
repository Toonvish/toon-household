import type { TagKind } from "./schemas/recipe.ts";

/**
 * The single uppercase eyebrow above a recipe title: `Hauptspeise · Eintopf`.
 *
 * The first segment is the recipe's `kind:'course'` tag; the second is its first FREE
 * tag, which is what the artboards draw (`Vegan · Pasta`, and a bare `Beilage` where
 * there is no second). BOTH SEGMENTS ARE CONTENT — raw German tag names, rendered
 * verbatim, never keyed. The only interface decision here is the separator, and it is
 * the same "·" in both languages.
 *
 * A recipe with NO course tag returns `{ course: null }` and MUST render no eyebrow at
 * all — not an empty one, not a placeholder (SPEC.md §4.4).
 *
 * Input order matters and is already right: `tagsByRecipe` in `tags.service.ts` orders
 * by `asc(tags.name)`, so "the first free tag" is deterministic (alphabetical) rather
 * than insertion-ordered — this function needs no sort of its own.
 */
export function recipeEyebrow(tags: ReadonlyArray<{ name: string; kind: TagKind }>): {
  course: string | null;
  detail: string | null;
} {
  const course = tags.find((tag) => tag.kind === "course")?.name ?? null;
  const detail = tags.find((tag) => tag.kind === "free")?.name ?? null;
  return { course, detail };
}
