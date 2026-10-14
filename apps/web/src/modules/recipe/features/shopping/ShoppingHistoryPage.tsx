/**
 * ShoppingHistoryPage — `/recipe/shopping/history`, the household-wide bought archive.
 *
 * EXTRAPOLATED (no artboard) — see docs/redesign/briefs/T8.8.md and ruling R45.
 * Artboard `1c` draws the overview panel's `Alle` link; this is what it points at,
 * pinned to the smallest honest scope: **read-only, day-grouped, `offset`-paged,
 * filterable by list, no per-row actions**. Undo lives on the list-detail bought
 * section, where a row can actually merge back into a real list — this screen has
 * no per-list watermark to clear and nothing to merge into, so it never offers it.
 *
 * Paging is a stack of independent, individually cached queries — one per 24-row
 * page, keyed by `(listId, pageOffset)` — rather than one query whose `limit` grows.
 * That is what makes `"shopping-bought"` on the persist allow-list actually useful
 * offline: the FIRST page is a query any earlier `/recipe/shopping` visit may already have
 * warmed, and it renders from that cache with no network at all; only `Mehr laden`
 * (which would need a page nobody has fetched yet) has to wait for a connection.
 */
import { useQueries } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import type { ShoppingBoughtItem } from "@toon/shared";
import { formatQuantity, formatShoppingAmount, groupByLocalDay, isVagueAmount, todayPlanDate } from "@toon/shared";
import { Button, EmptyState, ErrorState, SectionHeader, Select, Skeleton } from "@/components/ui";
import { formatRelativeShort, formatShortWeekdayDate } from "@/modules/recipe/lib/format";
import { useT } from "@/lib/i18n";
import { useSearchParams } from "@/lib/navigation";
import { boughtHistoryQuery } from "@/modules/recipe/lib/queries";
import { useRequiredHouseholdId, useSession } from "@/lib/session";
import { AppLink, useAppNavigate } from "@/lib/nav";
import { useShoppingLists } from "./lib/queries";

/** The endpoint's own default `limit` (`Lists` convention, CLAUDE.md) — never sent explicitly. */
const PAGE_SIZE = 24;

/**
 * One buyer summary for a day bucket's `SectionHeader` count — the single name when
 * every row in the bucket was bought by the same person (or nobody, i.e. every
 * `boughtByName` is null), and `recipe.shopping.bought.buyers` ("{first} +{count}") once a
 * second distinct buyer shows up. Mirrors the panel's own composition (§7.6).
 */
function buyerSummary(
  rows: readonly ShoppingBoughtItem[],
  t: ReturnType<typeof useT>,
): string {
  const names = rows.map((row) => row.boughtByName ?? t("recipe.shopping.bought.unknownBuyer"));
  const distinct = [...new Set(names)];
  const first = distinct[0] ?? t("recipe.shopping.bought.unknownBuyer");
  if (distinct.length <= 1) return first;
  return t("recipe.shopping.bought.buyers", { first, count: distinct.length - 1 });
}

export default function ShoppingHistoryPage() {
  const t = useT();
  const householdId = useRequiredHouseholdId();
  const { isOnline } = useSession();
  const navigate = useAppNavigate();
  const search = useSearchParams();
  const lists = useShoppingLists(householdId);

  // Defence in depth for a hand-edited URL (router.tsx's own `validateSearch` already
  // does this once) — a URL is user input, never trusted twice in one direction.
  const listId = search.listId;
  const parsedOffset = Number.parseInt(search.offset ?? "", 10);
  const offset = Number.isNaN(parsedOffset) ? 0 : parsedOffset;

  // `offset` is how many rows the URL claims are already loaded; reconstructing the
  // page-offset list from it (rather than trusting it as a single fetch's own
  // `offset`) is what lets "Mehr laden" simply bump it by `PAGE_SIZE` and have every
  // earlier page still be exactly the query that page already ran.
  const pageCount = Math.max(1, Math.floor(offset / PAGE_SIZE) + 1);
  const pageOffsets = Array.from({ length: pageCount }, (_, index) => index * PAGE_SIZE);

  const pages = useQueries({
    queries: pageOffsets.map((pageOffset) => boughtHistoryQuery(householdId, { listId, offset: pageOffset })),
  });

  // `pageOffsets` (and therefore `pages`) always has at least one entry — `pageCount`
  // is `Math.max(1, …)` — so this index is safe despite `noUncheckedIndexedAccess`.
  const firstPage = pages[0]!;
  const rows = pages.flatMap((page) => page.data?.items ?? []);
  const latestTotal = [...pages].reverse().find((page) => page.data)?.data?.total;
  const hasMore = latestTotal !== undefined && rows.length < latestTotal;

  const listOptions = [
    { value: "", label: t("recipe.shopping.lists.allLists") },
    ...(lists.data ?? []).map((list) => ({ value: list.id, label: list.name })),
  ];

  function setListId(value: string) {
    void navigate({
      to: "/recipe/shopping/history",
      search: { listId: value || undefined, offset: 0 },
    });
  }

  function loadMore() {
    void navigate({
      to: "/recipe/shopping/history",
      search: { listId, offset: pageCount * PAGE_SIZE },
    });
  }

  const dayGroups = groupByLocalDay(rows, (row) => row.boughtAt);
  const today = todayPlanDate();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <AppLink
          to="/recipe/shopping"
          className="inline-flex w-fit items-center gap-1.5 text-sm text-fg-muted hover:text-fg"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          {t("recipe.shopping.detail.backToLists")}
        </AppLink>
        <div>
          <h1 className="font-display text-display-2xl font-medium text-fg lg:text-display-3xl">
            {t("recipe.shopping.history.title")}
          </h1>
          <p className="mt-1.5 text-sm text-fg-subtle">{t("recipe.shopping.history.subtitle")}</p>
        </div>
      </div>

      {listOptions.length > 1 ? (
        <Select
          label={t("recipe.shopping.lists.allLists")}
          value={listId ?? ""}
          onChange={(event) => setListId(event.target.value)}
          options={listOptions}
          containerClassName="max-w-xs"
        />
      ) : null}

      {firstPage.isPending ? (
        <Skeleton lines={6} />
      ) : firstPage.isError && rows.length === 0 ? (
        <ErrorState error={firstPage.error} onRetry={() => void firstPage.refetch()} />
      ) : dayGroups.length === 0 ? (
        <EmptyState title={t("recipe.shopping.history.empty")} />
      ) : (
        <>
          {dayGroups.map((group) => (
            <section key={group.dayKey} aria-labelledby={`history-day-${group.dayKey}`}>
              <SectionHeader
                id={`history-day-${group.dayKey}`}
                title={group.dayKey === today ? t("recipe.shopping.history.today") : formatShortWeekdayDate(group.dayKey)}
                count={t("recipe.shopping.history.dayMeta", {
                  items: t("recipe.shopping.history.itemCount", { count: group.rows.length }),
                  who: buyerSummary(group.rows, t),
                })}
              />
              <ul className="flex flex-col gap-2">
                {group.rows.map((row) => {
                  const amount = formatShoppingAmount(row, formatQuantity);
                  const vague = isVagueAmount(row);
                  return (
                    <li
                      key={row.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3 py-2.5"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-base font-medium text-fg-muted line-through">
                          {row.name}
                        </span>
                        <span className="block text-xs text-fg-faint">
                          {t("recipe.shopping.bought.rowMeta", {
                            who: row.boughtByName ?? t("recipe.shopping.bought.unknownBuyer"),
                            when: formatRelativeShort(row.boughtAt),
                          })}
                        </span>
                      </span>
                      {amount ? (
                        <span
                          className={vague ? "text-item shrink-0 font-semibold tabular-nums text-fg-faint" : "text-item shrink-0 font-semibold tabular-nums text-accent-strong"}
                        >
                          {amount}
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          {hasMore ? (
            <Button
              variant="outline"
              onClick={loadMore}
              disabled={!isOnline}
              title={!isOnline ? t("recipe.shopping.lists.offlineHint") : undefined}
            >
              {t("recipe.shopping.history.loadMore")}
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
