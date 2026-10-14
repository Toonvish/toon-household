/**
 * The editorial recipe row — the ONE row every consumer renders: the library list
 * (both breakpoints), the collection detail screen, the plan recipe picker and the
 * plan panels. Callers used to fork `RecipeCard` (a 4:3 hero grid) and `RecipeRow` (a
 * compact 64px list row); both are gone, replaced by this single 84px-thumb layout
 * that differs only in title step and whether the description shows.
 *
 * The desktop/phone split is `useIsWideViewport()`, i.e. Tailwind's `sm` —
 * `SM_QUERY = "(min-width: 40rem)"` (`lib/viewport.ts`), **640px, not `lg`**. So in the
 * 640–1024px band (`sm` to `lg`) this renders its *desktop* shape — description
 * visible, larger title — with no sidebar next to it, because the sidebar only
 * appears from `lg`. That is intended: it is what the whole band looks like for
 * every screen this row appears on, not a bug in this component.
 *
 * The `<h3>` carries no `line-clamp`, no `truncate`, no `overflow-hidden` and no
 * fixed height — only `text-pretty` — because `block` (which a clamp needs to work)
 * silently wins over `line-clamp-N` in the cascade, and removing the clamp outright
 * was the actual fix, not reordering the classes (CLAUDE.md, "`block` beats
 * `line-clamp-N`").
 */
import type { ReactNode } from "react";
import { UtensilsCrossed } from "lucide-react";
import type { RecipeListItem } from "@toon/shared";
import { cn } from "@/lib/cn";
import { thumbnailUrl } from "@/modules/recipe/lib/api";
import { useIsWideViewport } from "@/lib/viewport";
import { AppLink } from "@/lib/nav";
import { optionalMinutes, optionalServings } from "../lib/format";
import { CourseEyebrow } from "./CourseEyebrow";

export interface RecipeEditorialRowProps {
  recipe: RecipeListItem;
  className?: string;
  /**
   * Renders the row as a `<button>` that calls `onSelect` instead of an `<a>` that
   * navigates — `/recipe/plan`'s `PlanRecipePicker` selects a recipe rather than leaving the
   * dialog. The two props move together: `as="button"` with no `onSelect` is a
   * button that does nothing, and the default (`as` omitted) is always the link.
   */
  as?: "button";
  onSelect?: () => void;
  /** An extra muted line under the meta — the plan picker's "Zuletzt geplant". */
  note?: ReactNode;
}

const rowClassName = cn(
  "grid grid-cols-[84px_minmax(0,1fr)] items-start gap-3.5 rounded-xl -mx-2 px-2 py-3.5 text-left text-fg",
  "transition-colors duration-150 hover:bg-surface-2/50",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
);

function Thumbnail({ recipe }: { recipe: RecipeListItem }) {
  const image = thumbnailUrl(recipe);
  if (image) {
    return (
      <img
        src={image}
        alt=""
        loading="lazy"
        decoding="async"
        className="aspect-square w-[84px] rounded-xl bg-surface-2 object-cover"
      />
    );
  }
  return (
    <span className="grid aspect-square w-[84px] place-items-center rounded-xl bg-surface-2 text-fg-subtle">
      <UtensilsCrossed aria-hidden="true" className="size-6" />
    </span>
  );
}

function RowBody({ recipe, wide, note }: { recipe: RecipeListItem; wide: boolean; note?: ReactNode }) {
  const time = optionalMinutes(recipe.totalMinutes ?? recipe.cookMinutes ?? recipe.prepMinutes);
  const servings = optionalServings(recipe.servingsAmount, recipe.servingsUnit);
  const meta = [time, servings].filter(Boolean).join(" · ");

  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <CourseEyebrow tags={recipe.tags} />
      <h3
        className={cn(
          "font-display leading-[1.2] font-medium text-pretty",
          wide ? "text-display-md" : "text-display-sm",
        )}
      >
        {recipe.title}
      </h3>
      {wide && recipe.description ? (
        <p className="text-sm text-fg-muted">{recipe.description}</p>
      ) : null}
      {meta ? <p className="text-[12.5px] text-fg-subtle">{meta}</p> : null}
      {note ? <p className="text-[12.5px] text-fg-subtle">{note}</p> : null}
    </div>
  );
}

export function RecipeEditorialRow({ recipe, className, as, onSelect, note }: RecipeEditorialRowProps) {
  const wide = useIsWideViewport();
  const children: ReactNode = (
    <>
      <Thumbnail recipe={recipe} />
      <RowBody recipe={recipe} wide={wide} note={note} />
    </>
  );

  if (as === "button") {
    return (
      <button type="button" onClick={onSelect} className={cn(rowClassName, "w-full", className)}>
        {children}
      </button>
    );
  }

  return (
    <AppLink
      to="/recipe/recipes/$recipeId"
      params={{ recipeId: recipe.id }}
      className={cn(rowClassName, className)}
    >
      {children}
    </AppLink>
  );
}
