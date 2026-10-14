/**
 * BoughtHistoryPanel — the "Bought history" rail panel on `/recipe/shopping` (artboards
 * 1c/1g), column 3. Reads the SAME cross-list feed `/recipe/shopping/history` (T8.8) pages
 * through in full; this panel only ever shows its first three day buckets and links
 * `Alle`/`All` to that screen for the rest.
 *
 * Unlike `WeekPlanPanel`, this segment IS on the persist allow-list
 * (`"shopping-bought"`, R24) — its rows are readable with no connection, so it is
 * worth reading offline, and the asymmetry with the plan panel is deliberate (see
 * that file's own doc comment).
 *
 * Renders NOTHING AT ALL — heading included — while pending or with no history
 * (R44, the same rule as `BoughtSection` on the list detail): a day-grouped rail
 * panel with nothing to show is not a screen the user navigated to, so there is no
 * `recipe.shopping.history.empty` here; that key belongs to the `/recipe/shopping/history` page,
 * which the user *did* choose to open.
 */
import type { ShoppingBoughtItem } from "@toon/shared";
import { groupByLocalDay, todayPlanDate } from "@toon/shared";
import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader } from "@/components/ui";
import { formatShortWeekdayDate } from "@/modules/recipe/lib/format";
import { useT } from "@/lib/i18n";
import { boughtHistoryQuery } from "@/modules/recipe/lib/queries";
import { AppLink } from "@/lib/nav";

/** Rows the panel groups into day buckets — three buckets need at most this many rows. */
const PANEL_ROW_LIMIT = 60;

/** How many day buckets the panel shows before pointing at the full history. */
const PANEL_DAY_COUNT = 3;

export interface BoughtHistoryPanelProps {
  householdId: string;
  /** `1c`'s `4 items · Eric` (`false`, default) vs. `1g`'s `Today · 4` (`true`). */
  compact?: boolean;
}

/**
 * One buyer summary for a day bucket — mirrors `/recipe/shopping/history`'s own
 * (unexported) helper: the single name when every row was bought by the same
 * person, `recipe.shopping.bought.buyers` ("{first} +{count}") once a second shows up.
 */
function buyerSummary(rows: readonly ShoppingBoughtItem[], t: ReturnType<typeof useT>): string {
  const names = rows.map((row) => row.boughtByName ?? t("recipe.shopping.bought.unknownBuyer"));
  const distinct = [...new Set(names)];
  const first = distinct[0] ?? t("recipe.shopping.bought.unknownBuyer");
  if (distinct.length <= 1) return first;
  return t("recipe.shopping.bought.buyers", { first, count: distinct.length - 1 });
}

export function BoughtHistoryPanel({ householdId, compact = false }: BoughtHistoryPanelProps) {
  const t = useT();
  const history = useQuery(boughtHistoryQuery(householdId, { limit: PANEL_ROW_LIMIT }));

  if (history.isPending || history.isError) return null;

  const dayGroups = groupByLocalDay(history.data.items, (row) => row.boughtAt).slice(
    0,
    PANEL_DAY_COUNT,
  );
  if (dayGroups.length === 0) return null;

  const today = todayPlanDate();

  return (
    <Card className="flex flex-col gap-1">
      <CardHeader
        className="mb-1"
        title={compact ? t("recipe.shopping.history.titleShort") : t("recipe.shopping.history.title")}
        action={
          <AppLink to="/recipe/shopping/history" className="text-sm font-semibold text-fg">
            {t("recipe.shopping.history.all")}
          </AppLink>
        }
      />
      <ul className="flex flex-col">
        {dayGroups.map((group) => {
          const dayLabel =
            group.dayKey === today ? t("recipe.shopping.history.today") : formatShortWeekdayDate(group.dayKey);
          // `1g`'s condensed tile draws ONE combined line per day ("Today · 4");
          // `1c`'s wider rail splits day and meta across the row (R7/artboard).
          return compact ? (
            <li key={group.dayKey} className="py-1 text-sm text-fg-muted">
              {t("recipe.shopping.history.dayMetaShort", { day: dayLabel, count: group.rows.length })}
            </li>
          ) : (
            <li
              key={group.dayKey}
              className="flex items-center justify-between gap-3 border-t border-line py-1.75 text-sm first:border-t-0"
            >
              <span className="text-fg">{dayLabel}</span>
              <span className="text-fg-muted">
                {t("recipe.shopping.history.dayMeta", {
                  items: t("recipe.shopping.history.itemCount", { count: group.rows.length }),
                  who: buyerSummary(group.rows, t),
                })}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
