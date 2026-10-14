/**
 * ShoppingListDetailPage — the screen you actually hold in a supermarket.
 *
 * Design rules this screen follows, in priority order:
 *
 *  1. **One-handed and offline.** Every item is a large card whose whole surface checks
 *     it off, and every edit works with no signal: the mutations are queued and
 *     replayed (features/shopping/lib/offline.ts), so this screen never disables itself
 *     for being offline the way the rest of the app does.
 *     Below `sm` that card is a TILE in a two-column grid (`ShoppingItemTile`): a name
 *     in large type, one muted subtitle, no source and no buttons, with a long press
 *     opening `ItemDetailDialog` for the rest. From `sm` up it is the wider
 *     `ShoppingItemCard` row with its edit/remove buttons in place. The branch is JS
 *     (`useIsWideViewport`) and not `sm:hidden`, because rendering both would give every
 *     item two check-off buttons and read it twice to a screen reader.
 *  2. **Checked items LEAVE the list** and reappear as one-tap chips under "Häufig
 *     gekauft", so the list only ever shows what is still missing, AND write a
 *     `shopping_bought_items` row that draws "Heute gekauft" below the to-buy
 *     section (D4) — a log, not a flag, so undoing one folds its amount back onto
 *     the list rather than clearing a bit.
 *  3. **No optimistic flicker.** Adding merges locally with the same algebra the server
 *     uses, so "200 g Mehl" onto an existing 200 g line reads 400 g immediately and does
 *     not jump when the response lands.
 *  4. **Desktop is a two-column grid** (artboard `1d`, §8.1) — the add bar moves to
 *     the TOP in flow, and the right rail holds THREE panels: `FrequentlyUsed`,
 *     `ListRecipesPanel` and the loyalty wallet (`CardsCard`, reused as-is rather
 *     than forked — SPEC §4.7 keeps "Loyalty cards" in the list rail too).
 *
 * `useCanMutate()` is deliberately NOT used here — it reports false when offline, which
 * is the opposite of what this feature needs. Its OTHER half is used, though:
 * `useEmailVerificationBlock()` is the one condition under which this screen does go
 * read-only, because the server answers 403 to an unconfirmed account's writes and a
 * queued mutation that can never succeed would just fail again on every reconnect.
 * `Gekauftes leeren`, the catalog hide/unhide toggle and `Entfernen` (recipes) are
 * ADDITIONALLY gated on `isOnline` (R28) — they are plain online writes, unlike the
 * to-buy section itself, which is the one thing on this screen editable offline.
 */
import { useMemo, useState } from "react";
import { CheckCheck, ChevronLeft, MailWarning, Trash2, WifiOff } from "lucide-react";
import { useIsMutating } from "@tanstack/react-query";
import { foldText, formatQuantity, formatShoppingAmount, type ShoppingBoughtItem, type ShoppingItem } from "@toon/shared";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  IconButton,
  SectionHeader,
  Select,
  Skeleton,
  useToast,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { useActiveHousehold, useEmailVerificationBlock, useSession } from "@/lib/session";
import { useIsWideViewport } from "@/lib/viewport";
import { AppLink, shareOrCopy, useRouteParam } from "@/modules/recipe/features/recipes";
import { CardsCard } from "@/modules/recipe/features/cards/components/CardsCard";
import { AddItemBar } from "./components/AddItemBar";
import { BoughtSection } from "./components/BoughtSection";
import { EditItemDialog } from "./components/EditItemDialog";
import { FrequentlyUsed } from "./components/FrequentlyUsed";
import { ItemDetailDialog } from "./components/ItemDetailDialog";
import { ListRecipesPanel } from "./components/ListRecipesPanel";
import { ShoppingItemCard } from "./components/ShoppingItemCard";
import { ShoppingItemTile } from "./components/ShoppingItemTile";
import {
  useAddShoppingItems,
  useAddShoppingSuggestion,
  useCheckShoppingItem,
  useClearShoppingList,
  useRemoveShoppingItem,
  useShoppingList,
  useUndoBoughtItem,
  useUpdateShoppingItem,
} from "./lib/queries";

type SortOption = "position" | "newest" | "alpha";

/** R32: three client-side options over the already-loaded array, default unchanged. */
function sortItems(items: ShoppingItem[], sort: SortOption): ShoppingItem[] {
  if (sort === "newest") return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (sort === "alpha") {
    return [...items].sort(
      (a, b) => foldText(a.name).localeCompare(foldText(b.name)) || a.name.localeCompare(b.name),
    );
  }
  return items; // "position" — today's server order, the default.
}

export default function ShoppingListDetailPage() {
  const t = useT();
  const { householdId } = useActiveHousehold();
  const { isOnline } = useSession();
  const unverified = useEmailVerificationBlock();
  const canMutate = unverified === undefined;
  const listId = useRouteParam("listId") ?? "";
  const toast = useToast();
  const wide = useIsWideViewport();

  const list = useShoppingList(householdId, listId);
  const add = useAddShoppingItems(householdId ?? "", listId);
  const check = useCheckShoppingItem(householdId ?? "", listId);
  const remove = useRemoveShoppingItem(householdId ?? "", listId);
  const update = useUpdateShoppingItem(householdId ?? "", listId);
  const clear = useClearShoppingList(householdId ?? "", listId);
  const undo = useUndoBoughtItem(householdId ?? "", listId);
  const suggestion = useAddShoppingSuggestion(householdId ?? "", listId);

  const [sort, setSort] = useState<SortOption>("position");
  const [editing, setEditing] = useState<ShoppingItem | null>(null);
  /**
   * The tile whose long press opened the detail sheet (phones only). Held as an ID and
   * looked up again on every render, so the sheet follows a merge and closes itself
   * when the line leaves the list — a captured snapshot would keep rendering a row that
   * no longer exists.
   */
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [boughtDetail, setBoughtDetail] = useState<ShoppingBoughtItem | null>(null);
  const [boughtCollapsed, setBoughtCollapsed] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);

  /** How many writes are still waiting to reach the server. */
  const queued = useIsMutating({ mutationKey: ["toon", "recipe", "shopping"] });

  const detail = list.data;
  const items = detail?.items ?? [];
  const bought = detail?.bought ?? [];
  const sortedItems = useMemo(() => sortItems(items, sort), [items, sort]);
  const detailsItem = items.find((item) => item.id === detailsId) ?? null;

  async function share() {
    if (!detail) return;
    const lines = items
      .map((item) => [formatShoppingAmount(item, formatQuantity), item.name].filter(Boolean).join(" "))
      .join("\n");
    const result = await shareOrCopy({ title: detail.list.name, text: [detail.list.name, "", lines].join("\n") });
    if (result === "copied") toast.success(t("recipe.shopping.detail.shareCopiedToast"));
    else if (result === "unavailable") toast.error(t("recipe.shopping.detail.shareUnavailableToast"));
  }

  if (list.isPending && !detail) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-48" />
        {/* Same shape as the branch below, or the list visibly jumps when data lands. */}
        <div className={wide ? "flex flex-col gap-2" : "grid grid-cols-2 gap-2"}>
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className={cn("w-full rounded-card", wide ? "h-18" : "h-24")} />
          ))}
        </div>
      </div>
    );
  }

  // A hard error with nothing cached. With a cached copy the list renders instead: it
  // is exactly the "no signal in the shop" case this screen exists for.
  if (list.isError && !detail) {
    return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  }
  if (!detail) return null;

  const subtitle = wide
    ? t("recipe.shopping.detail.subtitle", { open: items.length, bought: bought.length })
    : t("recipe.shopping.detail.subtitleShort", { open: items.length, bought: bought.length });

  const banner =
    unverified !== undefined ? (
      <p className="mb-3 flex items-center gap-2 rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning-soft-fg">
        <MailWarning aria-hidden="true" className="size-4 shrink-0" />
        {unverified}
      </p>
    ) : !isOnline ? (
      <p className="mb-3 flex items-center gap-2 rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning-soft-fg">
        <WifiOff aria-hidden="true" className="size-4 shrink-0" />
        {t("recipe.shopping.detail.offlineBanner")}
      </p>
    ) : null;

  const toBuySection =
    items.length === 0 ? (
      <EmptyState
        icon={<CheckCheck />}
        title={t("recipe.shopping.detail.empty.title")}
        description={
          detail.catalog.length > 0
            ? t("recipe.shopping.detail.empty.descriptionWithCatalog")
            : t("recipe.shopping.detail.empty.description")
        }
      />
    ) : wide ? (
      <>
        <SectionHeader tone="faint" title={t("recipe.shopping.toBuy.heading")} count={items.length} />
        <ul className="flex flex-col gap-1.5">
          {sortedItems.map((item) => (
            <ShoppingItemCard
              key={item.id}
              item={item}
              canMutate={canMutate}
              onCheck={check.check}
              onRemove={remove.remove}
              onEdit={setEditing}
            />
          ))}
        </ul>
      </>
    ) : (
      <>
        <SectionHeader tone="faint" title={t("recipe.shopping.toBuy.headingWithCount", { count: items.length })} />
        <ul className="grid grid-cols-2 gap-2">
          {sortedItems.map((item) => (
            <ShoppingItemTile
              key={item.id}
              item={item}
              canMutate={canMutate}
              onCheck={check.check}
              onOpenDetails={(target) => setDetailsId(target.id)}
            />
          ))}
        </ul>
        {/* The press-and-hold is the tile's only route to the amount, the note and
            the edit/remove actions, and nothing on the tile advertises it. */}
        <p className="mt-2 text-xs text-fg-muted">{t("recipe.shopping.item.longPressHint")}</p>
      </>
    );

  const boughtSection = (
    <BoughtSection
      layout={wide ? "rows" : "tiles"}
      entries={bought}
      householdId={householdId ?? ""}
      listId={listId}
      canMutate={canMutate}
      isOnline={isOnline}
      onOpenDetail={setBoughtDetail}
      collapsed={boughtCollapsed}
      onToggleCollapse={() => setBoughtCollapsed((value) => !value)}
    />
  );

  return (
    <div className="flex flex-1 flex-col gap-3.5">
      {wide ? (
        <AppLink
          to="/recipe/shopping"
          className="inline-flex w-fit items-center gap-1 text-sm text-fg-muted hover:text-fg"
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
          {t("recipe.shopping.detail.backToLists")}
        </AppLink>
      ) : (
        <div className="flex items-center gap-2.5 text-[13px] text-fg-muted">
          <AppLink to="/recipe/shopping" className="inline-flex items-center gap-1 hover:text-fg">
            <ChevronLeft aria-hidden="true" className="size-4" />
            {t("recipe.shopping.detail.backToListsShort")}
          </AppLink>
          <button
            type="button"
            onClick={() => void share()}
            className="ml-auto font-semibold text-brand-hover"
          >
            {t("recipe.shopping.detail.share")}
          </button>
        </div>
      )}

      <div className={wide ? "flex flex-wrap items-end gap-4" : ""}>
        <div className="min-w-0">
          <h1
            className={
              wide
                ? "font-display truncate text-[38px] leading-[1.1] font-medium text-fg"
                : "font-display truncate text-[30px] leading-[1.05] font-medium text-fg"
            }
          >
            {detail.list.name}
          </h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-fg-subtle">
            {subtitle}
            {queued > 0 ? (
              <span className="inline-flex items-center gap-1 text-warning-soft-fg">
                <WifiOff aria-hidden="true" className="size-3.5" />
                {t("recipe.shopping.detail.queuedCount", { count: queued })}
              </span>
            ) : null}
          </p>
        </div>
        {wide ? (
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Select
              aria-label={t("recipe.shopping.detail.sort.label")}
              value={sort}
              onChange={(event) => setSort(event.target.value as SortOption)}
              options={[
                { value: "position", label: t("recipe.shopping.detail.sort.position") },
                { value: "newest", label: t("recipe.shopping.detail.sort.newest") },
                { value: "alpha", label: t("recipe.shopping.detail.sort.alpha") },
              ]}
            />
            <Button variant="outline" size="sm" onClick={() => void share()}>
              {t("recipe.shopping.detail.share")}
            </Button>
            {items.length > 0 && canMutate ? (
              <IconButton
                label={t("recipe.shopping.detail.clearList")}
                variant="ghost"
                icon={<Trash2 />}
                onClick={() => setClearOpen(true)}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      {banner}

      {wide ? (
        <div className="grid grid-cols-[minmax(0,1fr)_340px] content-start gap-10">
          <div className="flex min-w-0 flex-col gap-1.5">
            <AddItemBar placement="inline" onAdd={(newItems) => add.add(newItems)} disabled={!canMutate} />
            {toBuySection}
            {boughtSection}
          </div>
          <aside className="flex flex-col gap-6.5 pt-11">
            <FrequentlyUsed
              householdId={householdId ?? ""}
              listId={listId}
              catalog={detail.catalog}
              canMutate={canMutate}
              isOnline={isOnline}
              onAdd={(entry) => suggestion.addSuggestion(entry.id, entry.name)}
            />
            <ListRecipesPanel
              householdId={householdId ?? ""}
              listId={listId}
              list={detail.list}
              recipes={detail.recipes}
              canMutate={canMutate}
              isOnline={isOnline}
            />
            <CardsCard />
          </aside>
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-1.5">
          {toBuySection}
          {boughtSection}
          <div className="flex-1" />
          <div className="bottom-tabbar sticky z-20 -mb-4 bleed-gutter-inset flex flex-col gap-2.5 bg-[linear-gradient(to_top,var(--bg)_70%,transparent)] pt-7 pb-5">
            <FrequentlyUsed
              compact
              householdId={householdId ?? ""}
              listId={listId}
              catalog={detail.catalog}
              canMutate={canMutate}
              isOnline={isOnline}
              onAdd={(entry) => suggestion.addSuggestion(entry.id, entry.name)}
            />
            <AddItemBar placement="docked" onAdd={(newItems) => add.add(newItems)} disabled={!canMutate} />
          </div>
        </div>
      )}

      <ItemDetailDialog
        item={detailsItem}
        boughtItem={boughtDetail}
        canMutate={canMutate}
        onClose={() => {
          setDetailsId(null);
          setBoughtDetail(null);
        }}
        onCheck={check.check}
        onEdit={setEditing}
        onRemove={remove.remove}
        onUndo={(boughtId) => undo.undo(boughtId)}
      />

      <EditItemDialog
        item={editing}
        siblings={items}
        onClose={() => setEditing(null)}
        onSave={update.update}
      />

      <ConfirmDialog
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        title={t("recipe.shopping.clear.title")}
        description={t("recipe.shopping.clear.description", {
          itemCount: t("recipe.shopping.list.itemCount", { count: items.length }),
          sectionName: t("recipe.shopping.frequentlyUsed.heading"),
        })}
        confirmLabel={t("recipe.shopping.action.clear")}
        destructive
        onConfirm={() => {
          clear.clear();
        }}
      />
    </div>
  );
}
