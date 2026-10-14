/**
 * RecipeListPage — the app's home screen (redesign screens A · desktop / B · mobile,
 * `docs/redesign/specs/04-*.md` §3/§4).
 *
 * ONE component, ONE markup tree: the desktop/mobile split lives almost entirely in
 * Tailwind's `lg:` breakpoint (1024px, the sidebar's own breakpoint) — the header
 * actions, the search field's width, the filter rail vs. the "Filter" sheet trigger,
 * and the two-column grid are all plain CSS. The one exception is `useIsWideViewport()`
 * (`sm`, 640px — see `RecipeEditorialRow`'s own doc comment for why that breakpoint is
 * deliberately different from `lg`): it still gates the editorial row's internal density
 * and the loading skeleton's row count, because a `display:none` `<img>` is still
 * fetched and rendering both row shapes at once would load every thumbnail twice
 * (CLAUDE.md, "The recipe list switches MARKUP at `sm`, in JS").
 *
 * `WeekStrip` and `RecentlyCookedShelf` size themselves via their own internal `lg:`
 * breakpoint (same pattern as `SkeletonList`'s `"daycards"` variant) — this page only
 * mounts them with a `householdId`, it does not choose their layout.
 *
 * All filters live in the URL (see lib/url-filters.ts), so a filtered view can be
 * shared and the back button restores it.
 */
import { useState } from "react";
import { ChefHat, Plus, ScanText, Search } from "lucide-react";
import {
  Button,
  EmptyState,
  ErrorState,
  SkeletonList,
  Spinner,
  buttonClasses,
  Input,
} from "@/components/ui";
import { PhoneHeaderRow } from "@/components/layout";
import { useT } from "@/lib/i18n";
import { useActiveHousehold, useEmailVerificationBlock, useRequiredHouseholdId } from "@/lib/session";
import { useIsWideViewport } from "@/lib/viewport";
import { useTags } from "@/modules/recipe/features/tags/lib/queries";
import { useCollections } from "@/modules/recipe/features/collections/lib/queries";
import { WeekStrip } from "@/modules/recipe/features/plan/components/WeekStrip";
import { AppLink } from "@/lib/nav";
import { flattenPages, totalCount, useHouseholdRecipeCount, useRecipeList } from "./lib/queries";
import { useUrlRecipeFilters } from "./lib/url-filters";
import { RecipeEditorialRow } from "./components/RecipeEditorialRow";
import { RecentlyCookedShelf } from "./components/RecentlyCookedShelf";
import { RecipeFilterRail, countActiveFilters } from "./components/RecipeFilterRail";
import { RecipeFilterSheet } from "./components/RecipeFilterSheet";
import { LibraryCreateMenu } from "./components/LibraryCreateMenu";

export default function RecipeListPage() {
  const t = useT();
  const { household } = useActiveHousehold();
  // Non-null: this screen only ever renders below the "household-scoped" layout route's
  // <RequireActiveHousehold>, and `WeekStrip`/`RecentlyCookedShelf` require a real id.
  const householdId = useRequiredHouseholdId();
  /** False while an unconfirmed e-mail address holds the account read-only. */
  const canCreate = useEmailVerificationBlock() === undefined;
  /** Row density only (§10.2) — NOT the page's own `lg:` layout breakpoint. */
  const wide = useIsWideViewport();
  const { searchText, setSearchText, filters, setFilters, effectiveFilters, hasFilters, reset } =
    useUrlRecipeFilters("/recipe");
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);

  const list = useRecipeList(householdId, effectiveFilters);
  const tags = useTags(householdId);
  const collections = useCollections(householdId);
  const recipeCount = useHouseholdRecipeCount(householdId);

  const recipes = flattenPages(list.data);
  const total = totalCount(list.data);
  const activeFilterCount = countActiveFilters(filters);
  // Never "0 Rezepte durchsuchen" nor "undefined Rezepte durchsuchen" while the first
  // page is still in flight — the field simply carries no placeholder until then.
  const searchPlaceholder = list.isSuccess
    ? t("recipe.recipes.list.searchPlaceholder", { count: total })
    : undefined;

  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      {/* The phone-only household chip + "+" row; hides itself from `lg` (PhoneHeaderRow). */}
      <PhoneHeaderRow action={canCreate ? <LibraryCreateMenu /> : null} />

      <header className="flex items-end gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-display-2xl leading-[1.05] font-medium text-fg lg:text-display-3xl lg:leading-[1.1]">
            {t("recipe.recipes.list.title")}
          </h1>
          {household && recipeCount !== undefined ? (
            <p className="mt-1.5 truncate text-sm text-fg-subtle">
              {/* Two composed strings, one CSS-hidden: the desktop chrome (S4: 1c's
                  subtitle) shows member AND recipe counts, the phone row keeps the
                  shorter pre-existing summary — both catalog keys stay in use. */}
              <span className="lg:hidden">
                {t("recipe.recipes.list.groupSummary", { name: household.name, count: recipeCount })}
              </span>
              <span className="hidden lg:inline">
                {t("recipe.recipes.list.sharedSummary", {
                  group: household.name,
                  members: t("household.count.members", { count: household.memberCount }),
                  recipes: t("recipe.count.recipes", { count: recipeCount }),
                })}
              </span>
            </p>
          ) : null}
        </div>
        {/* Hidden, not disabled, while the address is unconfirmed: these are
            <a>s, and a link cannot carry a disabled state or a tooltip. The
            banner in AppShell is what explains the absence, and both
            destinations refuse the write themselves anyway. Desktop only —
            the phone route is the "+" sheet in PhoneHeaderRow above. */}
        {canCreate ? (
          <div className="ml-auto hidden shrink-0 gap-2 lg:flex">
            <AppLink to="/recipe/import" className={buttonClasses({ variant: "outline" })}>
              {t("recipe.recipes.list.importAction")}
            </AppLink>
            <AppLink to="/recipe/recipes/new" className={buttonClasses({ variant: "primary" })}>
              {t("common.sidenav.newRecipe")}
            </AppLink>
          </div>
        ) : null}
      </header>

      <div className="flex gap-2">
        <Input
          type="search"
          size="lg"
          leftIcon={<Search />}
          aria-label={t("recipe.recipes.filters.searchAriaLabel")}
          containerClassName="min-w-0 flex-1 lg:max-w-[520px]"
          className="text-base"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          placeholder={searchPlaceholder}
        />
        {/* The desktop rail is permanent (below), so this trigger — and the sheet it
            opens — only exist on a phone. */}
        <button
          type="button"
          onClick={() => setFilterSheetOpen(true)}
          className="shrink-0 self-center px-1 text-xs font-semibold text-brand-hover lg:hidden"
        >
          {activeFilterCount > 0
            ? t("recipe.recipes.list.filterActionWithCount", { count: activeFilterCount })
            : t("recipe.recipes.list.filterAction")}
        </button>
      </div>

      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-9">
        {/* A household with no recipes yet still gets the rail — it renders with empty
            sections rather than disappearing (R44). */}
        <div className="hidden lg:block">
          <RecipeFilterRail
            filters={filters}
            onFiltersChange={setFilters}
            tags={tags.data ?? []}
            tagsLoading={tags.isPending}
            collections={collections.data ?? []}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-8">
          {/* Neither shelf is about the recipe LIST below, so both still render for a
              household with zero recipes (R44) — a new household's first useful action may
              well be planning or importing. Both are empty-for-everything on day one
              for every pre-redesign install (R41) and render nothing at all in that
              state — no heading, no reserved height (their own concern, not this page's). */}
          <WeekStrip householdId={householdId} />
          <RecentlyCookedShelf householdId={householdId} />

          <section className="flex flex-col gap-2.5">
            <header className="flex items-baseline gap-2.5">
              <h2 className="font-display text-xl font-medium">{t("recipe.recipes.list.allRecipes")}</h2>
              {list.isSuccess ? (
                <span className="text-[12.5px] text-fg-subtle">{total}</span>
              ) : null}
            </header>

            {list.isPending ? (
              <SkeletonList variant="editorial" count={wide ? 8 : 6} />
            ) : list.isError ? (
              <ErrorState error={list.error} onRetry={() => void list.refetch()} />
            ) : recipes.length === 0 ? (
              hasFilters ? (
                <EmptyState
                  icon={<ChefHat />}
                  title={t("recipe.recipes.list.empty.filtered.title")}
                  description={t("recipe.recipes.list.empty.filtered.description")}
                  action={
                    <Button variant="secondary" onClick={reset} fullWidth>
                      {t("recipe.recipes.filters.reset")}
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  icon={<ChefHat />}
                  title={t("recipe.recipes.list.empty.none.title")}
                  description={t("recipe.recipes.list.empty.none.description")}
                  action={
                    canCreate ? (
                      <AppLink
                        to="/recipe/recipes/new"
                        className={buttonClasses({ variant: "primary", fullWidth: true })}
                      >
                        <Plus aria-hidden="true" className="size-4" />
                        {t("recipe.recipes.list.empty.createAction")}
                      </AppLink>
                    ) : undefined
                  }
                  secondaryAction={
                    canCreate ? (
                      <AppLink to="/recipe/import" className={buttonClasses({ variant: "ghost", size: "sm" })}>
                        <ScanText aria-hidden="true" className="size-4" />
                        {t("recipe.recipes.list.empty.importAction")}
                      </AppLink>
                    ) : undefined
                  }
                />
              )
            ) : (
              <>
                <ul className="flex flex-col divide-y divide-line">
                  {recipes.map((recipe) => (
                    <li key={recipe.id}>
                      <RecipeEditorialRow recipe={recipe} />
                    </li>
                  ))}
                </ul>

                <p aria-live="polite" className="text-center text-sm text-fg-muted">
                  {t("recipe.recipes.list.resultsCount", { shown: recipes.length, count: total })}
                </p>

                {list.hasNextPage ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void list.fetchNextPage()}
                    loading={list.isFetchingNextPage}
                    fullWidth
                    className="sm:mx-auto sm:w-64"
                  >
                    {t("recipe.recipes.list.loadMore")}
                  </Button>
                ) : null}

                {list.isFetching && !list.isFetchingNextPage ? (
                  <div className="flex justify-center">
                    <Spinner label={t("recipe.recipes.list.refreshing")} />
                  </div>
                ) : null}
              </>
            )}
          </section>
        </div>
      </div>

      <RecipeFilterSheet
        open={filterSheetOpen}
        onOpenChange={setFilterSheetOpen}
        filters={filters}
        onFiltersChange={setFilters}
        tags={tags.data ?? []}
        tagsLoading={tags.isPending}
        collections={collections.data ?? []}
      />
    </div>
  );
}

/** Named export as well, for the feature barrel; the router imports the default. */
export { RecipeListPage };
