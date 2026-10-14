/**
 * RecentlyCookedShelf — the library's "Kürzlich gekocht" carousel (A04 §3.3,
 * reconstructed, no artboard — SPEC.md §1/D10). Sits between `WeekStrip` and
 * "Alle Rezepte", never below it: the "all recipes" section is an infinite list
 * with "Mehr laden" at its foot, so nothing may sit under it or the shelf would
 * drift down the page every time another page loads.
 *
 * EMPTY ON DAY ONE for every existing install (R44) — R41 ships no
 * `tags.kind` backfill, but nothing here depends on that; the real reason this
 * shelf starts empty everywhere is that nothing back-dates `last_cooked_at`, so a
 * pre-redesign household has no `hasCooked` recipes until someone taps "Gekocht".
 * That is the *expected* day-one shape, not a bug: a heading over an empty
 * horizontal scroller reads as a broken carousel, so with zero results (or while
 * the query is still pending) this renders NOTHING AT ALL — no heading, no
 * reserved height — same rule as `BoughtSection` (T8.6).
 */
import { useQuery } from "@tanstack/react-query";
import type { RecipeListItem } from "@toon/shared";
import { formatRelativeShort } from "@/modules/recipe/lib/format";
import { recipesQuery } from "@/modules/recipe/lib/queries";
import { useT } from "@/lib/i18n";
import { thumbnailUrl } from "@/modules/recipe/lib/api";
import { AppLink } from "@/lib/nav";

const SHELF_LIMIT = 5;

export interface RecentlyCookedShelfProps {
  householdId: string;
}

function ShelfCard({ recipe }: { recipe: RecipeListItem }) {
  const t = useT();
  const image = thumbnailUrl(recipe);
  return (
    <li className="w-[180px] shrink-0">
      <AppLink to="/recipe/recipes/$recipeId" params={{ recipeId: recipe.id }} className="flex flex-col gap-2">
        {image ? (
          <img
            src={image}
            alt=""
            loading="lazy"
            decoding="async"
            className="aspect-4/3 w-full rounded-xl bg-surface-2 object-cover"
          />
        ) : (
          <div className="aspect-4/3 w-full rounded-xl bg-surface-2" />
        )}
        <span className="font-display text-[15px] leading-tight font-medium text-fg text-pretty">
          {recipe.title}
        </span>
        <span className="text-xs text-fg-subtle">
          {t("recipe.recipes.list.cookedRelative", { relative: formatRelativeShort(recipe.lastCookedAt) })}
        </span>
      </AppLink>
    </li>
  );
}

export function RecentlyCookedShelf({ householdId }: RecentlyCookedShelfProps) {
  const t = useT();
  const query = useQuery(
    recipesQuery(householdId, { sort: "lastCooked", hasCooked: true, limit: SHELF_LIMIT }),
  );

  const recipes = query.data?.items ?? [];

  // No heading, no skeleton, no reserved height — loading and empty look
  // identical from the outside, which is the point (R44).
  if (query.isPending || recipes.length === 0) return null;

  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="font-display text-xl font-medium">{t("recipe.recipes.list.recentlyCooked")}</h2>
      <ul
        aria-label={t("recipe.recipes.list.recentlyCooked")}
        className="scroll-x no-scrollbar flex gap-3 pb-1"
      >
        {recipes.map((recipe) => (
          <ShelfCard key={recipe.id} recipe={recipe} />
        ))}
      </ul>
    </section>
  );
}
