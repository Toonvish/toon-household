/**
 * Tag chips. Built on the shared `Badge` (which already picks a legible text colour for
 * a user-chosen hex value) so a FREE tag looks identical everywhere.
 *
 * A COURSE tag (D5, `kind: 'course'`) is not a chip you could imagine removing — it is
 * the recipe's category — so it does not get the coloured pill at all. It renders the
 * same honey eyebrow `CourseEyebrow` draws above a recipe title: `.eyebrow text-accent-
 * strong`, uppercase, no background. `kind` defaults to `"free"`, which is every tag
 * before D5 and every call site that only ever had a name/color to hand.
 */
import type { Tag, TagKind } from "@toon/shared";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui";

export interface TagChipProps {
  tag: Pick<Tag, "name" | "color"> & { recipeCount?: number };
  kind?: TagKind;
  size?: "sm" | "md";
  showCount?: boolean;
  className?: string;
}

export function TagChip({
  tag,
  kind = "free",
  size = "md",
  showCount = false,
  className,
}: TagChipProps) {
  const content =
    showCount && typeof tag.recipeCount === "number"
      ? `${tag.name} · ${tag.recipeCount}`
      : tag.name;

  if (kind === "course") {
    // CONTENT: the course name is German, rendered verbatim, never through t() — same
    // rule as `CourseEyebrow`. Only the two-family SPLIT (this vs. the pill below) is a
    // design decision, not a translation.
    return <span className={cn("eyebrow text-accent-strong", className)}>{content}</span>;
  }

  return (
    <Badge size={size} variant="neutral" color={tag.color ?? undefined} className={className}>
      {content}
    </Badge>
  );
}

export interface TagFilterButtonProps {
  tag: Tag;
  active: boolean;
  onToggle: (tagId: string) => void;
}

/**
 * Keyboard-operable filter chip for the recipe list. Active state is conveyed by
 * `aria-pressed` plus a ring, never by colour alone.
 */
export function TagFilterButton({ tag, active, onToggle }: TagFilterButtonProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onToggle(tag.id)}
      className={cn(
        "shrink-0 rounded-full transition-shadow",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        active && "ring-2 ring-brand ring-offset-1 ring-offset-bg",
      )}
    >
      <TagChip
        tag={tag}
        showCount
        className={cn("cursor-pointer", active && !tag.color && "bg-brand-soft text-brand-soft-fg")}
      />
    </button>
  );
}
