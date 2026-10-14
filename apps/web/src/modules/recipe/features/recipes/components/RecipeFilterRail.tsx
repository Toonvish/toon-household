/**
 * Desktop recipe library filter rail — the permanent 220px left column from `lg` up
 * (`RecipeListPage`'s `lg:grid-cols-[220px_minmax(0,1fr)]`). `[RECON]`: no `1b` artboard
 * exists for it (D10, `docs/redesign/SPEC.md`), so its shape is reconstructed from the
 * mobile sheet's requirements rather than transcribed — only T8.1–T8.3 would be revisited
 * if that artboard is ever drawn.
 *
 * `RecipeFilterSheet` renders the exact same `RecipeFilterFields` inside a `Dialog` for
 * phones — this module is the sole owner of that shared body, so the two surfaces can
 * never drift apart.
 *
 * Splits the household's tag listing into two sections by `kind` (D5):
 *  - **Gänge** (`kind === "course"`) — SINGLE-select. This is forced by the API, not by
 *    taste: `tagIds` is AND-combined server-side, so selecting two courses would return
 *    zero rows every time (a recipe cannot carry both `Hauptspeise` and `Dessert`).
 *    `courseAny` is the "no course selected" option.
 *  - **Tags** (`kind === "free"`) — multi-select, unchanged from the old panel.
 * Both write into the SAME `tagIds` filter / `tags` URL param (R25) — a course *is* a tag
 * under D5, and "a recipe must carry every selected tag" is already the right semantics
 * for "this recipe's course is X".
 *
 * The rail's own heading (`courseLegend`, `tagsLegend`, `moreFilters`, …) is INTERFACE;
 * the course and tag NAMES rendered inside it are CONTENT and never go through `t()` —
 * see `CourseEyebrow`'s doc comment for the same split. Per-course `recipeCount`s are
 * whatever the household's tag listing already carries (household-wide, not recomputed per
 * filter state — that would be a `count(*)` per course per keystroke against a
 * serialised write lane, see CLAUDE.md's libSQL-is-one-lane gotcha).
 */
import { useState } from "react";
import { ChevronDown, FilterX } from "lucide-react";
import type { Collection, Difficulty, RecipeSort, Tag } from "@toon/shared";
import { cn } from "@/lib/cn";
import { Badge, Button, Select, Skeleton } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { TagFilterButton } from "@/modules/recipe/features/tags/components/TagChip";
import { AppLink } from "@/lib/nav";
import { DIFFICULTY_LABEL_KEYS } from "../lib/difficultyLabels";
import { SORT_LABELS } from "../lib/format";
import type { RecipeListFilters } from "../lib/queries";

export interface RecipeFilterFieldsProps {
  filters: RecipeListFilters;
  onFiltersChange: (filters: RecipeListFilters) => void;
  tags: readonly Tag[];
  tagsLoading?: boolean;
  collections: readonly Collection[];
  /** Number of matches, announced politely. Omitted on the rail today (`RecipeListPage`
   * shows its own count above the list) but kept so a caller CAN wire it up. */
  total?: number;
  isFetching?: boolean;
  /** Tag chips wrap onto new lines in the rail's narrow column; the sheet keeps the
   * old horizontal scroller, which fits a wide phone screen better. */
  tagsLayout?: "wrap" | "scroll";
}

/** Same counting rule as the old `RecipeFilters.tsx` — a course selection is one more
 * entry in `tagIds`, so it counts itself without any special-casing here. */
export function countActiveFilters(filters: RecipeListFilters): number {
  let count = 0;
  if (filters.tagIds && filters.tagIds.length > 0) count += filters.tagIds.length;
  if (filters.collectionId) count += 1;
  if (filters.maxMinutes !== undefined) count += 1;
  if (filters.difficulty) count += 1;
  return count;
}

/**
 * The controls shared by the rail and the sheet: course single-select, tag multi-select,
 * the "Mehr Filter" disclosure (Sammlung / Schwierigkeit / Zeit) and the manage-links.
 * Exported so `RecipeFilterSheet` can mount it verbatim inside its `Dialog`.
 */
export function RecipeFilterFields({
  filters,
  onFiltersChange,
  tags,
  tagsLoading = false,
  collections,
  total,
  isFetching = false,
  tagsLayout = "wrap",
}: RecipeFilterFieldsProps) {
  const t = useT();
  const courseTags = tags.filter((tag) => tag.kind === "course");
  const freeTags = tags.filter((tag) => tag.kind === "free");
  const courseTagIds = new Set(courseTags.map((tag) => tag.id));

  const selectedTagIds = filters.tagIds ?? [];
  const selectedCourseId = selectedTagIds.find((id) => courseTagIds.has(id));

  const secondaryActive =
    Boolean(filters.collectionId) || filters.maxMinutes !== undefined || Boolean(filters.difficulty);
  const [moreOpen, setMoreOpen] = useState(secondaryActive);

  const activeCount = countActiveFilters(filters);

  function selectCourse(courseId: string | null) {
    const withoutCourse = selectedTagIds.filter((id) => !courseTagIds.has(id));
    onFiltersChange({
      ...filters,
      tagIds: courseId ? [...withoutCourse, courseId] : withoutCourse,
    });
  }

  function toggleTag(tagId: string) {
    const next = selectedTagIds.includes(tagId)
      ? selectedTagIds.filter((id) => id !== tagId)
      : [...selectedTagIds, tagId];
    onFiltersChange({ ...filters, tagIds: next });
  }

  function reset() {
    onFiltersChange({ sort: filters.sort });
  }

  const sortOptions = (Object.keys(SORT_LABELS) as RecipeSort[]).map((value) => ({
    value,
    label: t(SORT_LABELS[value]),
  }));

  const timeOptions = [
    { value: "", label: t("recipe.recipes.filters.maxDuration.any") },
    { value: "15", label: t("recipe.recipes.filters.maxDuration.upTo15") },
    { value: "30", label: t("recipe.recipes.filters.maxDuration.upTo30") },
    { value: "45", label: t("recipe.recipes.filters.maxDuration.upTo45") },
    { value: "60", label: t("recipe.recipes.filters.maxDuration.upTo60") },
    { value: "120", label: t("recipe.recipes.filters.maxDuration.upTo120") },
  ];

  const difficultyOptions = [
    { value: "", label: t("recipe.recipes.filters.difficulty.any") },
    { value: "einfach", label: t(DIFFICULTY_LABEL_KEYS.einfach) },
    { value: "mittel", label: t(DIFFICULTY_LABEL_KEYS.mittel) },
    { value: "schwer", label: t(DIFFICULTY_LABEL_KEYS.schwer) },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* `min-w-0` is load-bearing on both fieldsets below — a <fieldset> carries the
          browser's own `min-inline-size: min-content` and ignores the rule you would
          apply to any other grid/flex item, which is exactly how the old tag row grew
          its fieldset to 580px on a 390px phone and made the whole page scroll
          sideways (CLAUDE.md). */}
      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="text-sm font-medium text-fg">{t("recipe.recipes.filters.courseLegend")}</legend>
        <div className="flex flex-col gap-0.5">
          <button
            type="button"
            aria-pressed={selectedCourseId === undefined}
            onClick={() => selectCourse(null)}
            className={cn(
              "rounded-control px-2.5 py-1.5 text-left text-sm transition-colors",
              selectedCourseId === undefined
                ? "bg-brand-soft font-medium text-brand-soft-fg"
                : "text-fg-muted hover:bg-surface-2 hover:text-fg",
            )}
          >
            {t("recipe.recipes.filters.courseAny")}
          </button>
          {tagsLoading ? (
            <div className="flex flex-col gap-1 px-2.5 py-1">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-20" />
            </div>
          ) : (
            courseTags.map((tag) => (
              <button
                key={tag.id}
                type="button"
                aria-pressed={selectedCourseId === tag.id}
                onClick={() => selectCourse(tag.id === selectedCourseId ? null : tag.id)}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-control px-2.5 py-1.5 text-left text-sm transition-colors",
                  selectedCourseId === tag.id
                    ? "bg-brand-soft font-medium text-brand-soft-fg"
                    : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                )}
              >
                {/* CONTENT: the course NAME, verbatim, never through t(). */}
                <span className="truncate">{tag.name}</span>
                {typeof tag.recipeCount === "number" ? (
                  <span className="shrink-0 text-xs text-fg-subtle">{tag.recipeCount}</span>
                ) : null}
              </button>
            ))
          )}
        </div>
      </fieldset>

      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="text-sm font-medium text-fg">{t("recipe.recipes.filters.tagsLegend")}</legend>
        {tagsLoading ? (
          <div className="flex gap-2">
            <Skeleton className="h-7 w-20" rounded="full" />
            <Skeleton className="h-7 w-24" rounded="full" />
            <Skeleton className="h-7 w-16" rounded="full" />
          </div>
        ) : freeTags.length === 0 ? (
          <p className="text-sm text-fg-muted">{t("recipe.recipes.filters.tagsEmpty")}</p>
        ) : tagsLayout === "wrap" ? (
          <div className="flex min-w-0 flex-wrap gap-1.5">
            {freeTags.map((tag) => (
              <TagFilterButton
                key={tag.id}
                tag={tag}
                active={selectedTagIds.includes(tag.id)}
                onToggle={toggleTag}
              />
            ))}
          </div>
        ) : (
          <div className="scroll-x no-scrollbar -mx-1 flex min-w-0 gap-1.5 px-1 pb-1">
            {freeTags.map((tag) => (
              <TagFilterButton
                key={tag.id}
                tag={tag}
                active={selectedTagIds.includes(tag.id)}
                onToggle={toggleTag}
              />
            ))}
          </div>
        )}
        {selectedTagIds.filter((id) => !courseTagIds.has(id)).length > 1 ? (
          <p className="text-xs text-fg-subtle">{t("recipe.recipes.filters.tagsAllRequired")}</p>
        ) : null}
      </fieldset>

      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => setMoreOpen((value) => !value)}
          aria-expanded={moreOpen}
          aria-controls="recipe-filter-more"
          className="flex items-center justify-between gap-2 text-sm font-medium text-fg"
        >
          <span className="flex items-center gap-1.5">
            {t("recipe.recipes.filters.moreFilters")}
            {secondaryActive ? (
              <Badge size="sm" variant="brand">
                {[filters.collectionId, filters.maxMinutes !== undefined, filters.difficulty].filter(
                  Boolean,
                ).length}
              </Badge>
            ) : null}
          </span>
          <ChevronDown
            aria-hidden="true"
            className={cn("size-4 shrink-0 transition-transform", moreOpen && "rotate-180")}
          />
        </button>

        <div id="recipe-filter-more" hidden={!moreOpen} className="flex flex-col gap-3">
          <Select
            label={t("recipe.recipes.filters.sort.label")}
            options={sortOptions}
            value={filters.sort ?? "newest"}
            onChange={(event) =>
              onFiltersChange({ ...filters, sort: event.target.value as RecipeSort })
            }
          />
          <Select
            label={t("recipe.recipes.filters.collection.label")}
            options={[
              { value: "", label: t("recipe.recipes.filters.collection.all") },
              ...collections.map((collection) => ({ value: collection.id, label: collection.name })),
            ]}
            value={filters.collectionId ?? ""}
            onChange={(event) =>
              onFiltersChange({
                ...filters,
                collectionId: event.target.value === "" ? undefined : event.target.value,
              })
            }
          />
          <Select
            label={t("recipe.recipes.filters.maxDuration.label")}
            options={timeOptions}
            value={filters.maxMinutes === undefined ? "" : String(filters.maxMinutes)}
            onChange={(event) =>
              onFiltersChange({
                ...filters,
                maxMinutes:
                  event.target.value === "" ? undefined : Number.parseInt(event.target.value, 10),
              })
            }
          />
          <Select
            label={t("recipe.recipes.filters.difficulty.label")}
            options={difficultyOptions}
            value={filters.difficulty ?? ""}
            onChange={(event) =>
              onFiltersChange({
                ...filters,
                difficulty:
                  event.target.value === "" ? undefined : (event.target.value as Difficulty),
              })
            }
          />
        </div>
      </div>

      {typeof total === "number" || activeCount > 0 ? (
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          {typeof total === "number" ? (
            <p aria-live="polite" className={cn("text-sm", isFetching ? "text-fg-subtle" : "text-fg-muted")}>
              {t("recipe.recipes.filters.resultsCount", { count: total })}
            </p>
          ) : null}
          {activeCount > 0 ? (
            <Button type="button" variant="ghost" size="sm" onClick={reset} leftIcon={<FilterX className="size-4" />}>
              {t("recipe.recipes.filters.reset")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* Both management links live here AND in the sheet (R30) — the sheet's copy is
          the ONLY phone route to either screen, since neither is a tab and neither is
          in `SECONDARY_NAV_ITEMS` (sidebar-only, invisible below `lg`). */}
      <div className="flex flex-col gap-1 border-t border-line pt-4 text-sm">
        <AppLink to="/recipe/collections" className="text-fg-muted hover:text-fg">
          {t("recipe.recipes.filters.manageCollections")}
        </AppLink>
        <AppLink to="/recipe/tags" className="text-fg-muted hover:text-fg">
          {t("recipe.recipes.filters.manageTags")}
        </AppLink>
      </div>
    </div>
  );
}

export interface RecipeFilterRailProps {
  filters: RecipeListFilters;
  onFiltersChange: (filters: RecipeListFilters) => void;
  tags: readonly Tag[];
  tagsLoading?: boolean;
  collections: readonly Collection[];
  total?: number;
  isFetching?: boolean;
}

/** The permanent desktop rail — `RecipeListPage` mounts it inside `hidden lg:block`. */
export function RecipeFilterRail(props: RecipeFilterRailProps) {
  return <RecipeFilterFields {...props} tagsLayout="wrap" />;
}
