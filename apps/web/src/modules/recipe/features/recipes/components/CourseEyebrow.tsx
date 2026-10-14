/**
 * The honey uppercase eyebrow above a recipe title: "Hauptspeise · Eintopf".
 *
 * CONTENT, not interface — both segments are raw German tag names read verbatim
 * from `recipeEyebrow()` (`@toon/shared`). Never `t()`, never keyed, never
 * locale-dependent; the only interface decision is the "·" separator, which is
 * the same character in both languages.
 *
 * A recipe with no `kind:'course'` tag renders **nothing** — not an empty span,
 * not a placeholder (SPEC.md §4.4) — so a library that hasn't adopted courses yet
 * (every install on day one, R41) shows a plain two-line stack instead of a blank
 * eyebrow-shaped gap.
 */
import { recipeEyebrow, type TagKind } from "@toon/shared";
import { cn } from "@/lib/cn";

export interface CourseEyebrowProps {
  tags: ReadonlyArray<{ name: string; kind: TagKind }>;
  className?: string;
}

export function CourseEyebrow({ tags, className }: CourseEyebrowProps) {
  const { course, detail } = recipeEyebrow(tags);
  if (!course) return null;
  return (
    <span className={cn("eyebrow text-accent-strong", className)}>
      {detail ? `${course} · ${detail}` : course}
    </span>
  );
}
