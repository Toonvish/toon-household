/**
 * "Häufig gekauft" — one-tap suggestions, restyled onto the shared `Chip` primitive
 * (R7) and relocated into the desktop right rail (artboard `1d`, §8.1). On a phone
 * it renders `compact`: the bare chip scroller that lives INSIDE the docked add
 * bar (§8.2) — no heading, no hint line, no "Show all" link, because there is no
 * room for them there and the long-press affordance still works without a printed
 * explanation on a screen that small.
 *
 * The per-chip `×` is gone: SPEC §4.6 moves hiding to a long-press / right-click,
 * which is exactly what `Chip`'s own `onContextMenu` slot exists for — a real
 * right-click on desktop, and the `contextmenu` event mobile browsers already fire
 * for a press-and-hold, so no extra pointer-handler wiring is needed here (unlike
 * `ShoppingItemTile`, which has no such native event to lean on). A hidden entry
 * keeps its `useCount` (`PATCH …/catalog/:entryId {hidden:true}`), so unhiding it
 * from the "Alle {n} anzeigen" sheet does not reset its rank.
 *
 * Selection (which entries make the row) and display order (how they are sorted)
 * are two different operations, done as two calls — R8. `sortEntriesByFoldedName`
 * runs again inside the "Show all" sheet, this time over the WHOLE catalog.
 *
 * "Alle {n} anzeigen" expands `catalog` — already in the detail payload, so no
 * fetch, and it works offline (R20). Only the "Ausgeblendete anzeigen" toggle
 * INSIDE that sheet reaches the network (`GET …/catalog?includeHidden=1`), and it
 * is a toggle on the sheet's own header row, not a second sheet nested inside the
 * first — two focus traps for one hint sentence would be the wrong trade.
 */
import { useState } from "react";
import { Plus } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  selectMostBoughtEntries,
  sortEntriesByFoldedName,
  type ShoppingCatalogEntry,
  type ShoppingListDetailResponse,
} from "@toon/shared";
import { Chip, ConfirmDialog, Dialog, Switch, useToast } from "@/components/ui";
import { setShoppingCatalogEntryHidden } from "@/modules/recipe/lib/api";
import { useT } from "@/lib/i18n";
import { catalogPageQuery, invalidate, queryKeys } from "@/modules/recipe/lib/queries";

export interface FrequentlyUsedProps {
  householdId: string;
  listId: string;
  /** `detail.catalog` — already excludes hidden entries, capped at `catalogSuggestions`. */
  catalog: ShoppingCatalogEntry[];
  onAdd: (entry: ShoppingCatalogEntry) => void;
  canMutate: boolean;
  /**
   * Gates hide/unhide only (R28): adding a suggestion is an ordinary queued item
   * write and works offline, while `PATCH …/catalog/:entryId` is an online-only
   * write with no outbox — so the long-press affordance is disabled without a
   * connection rather than opening a confirm whose request can only fail.
   */
  isOnline: boolean;
  /** The phone bottom bar's bare chip scroller — no heading, no hint, no "Show all". */
  compact?: boolean;
}

export function FrequentlyUsed({
  householdId,
  listId,
  catalog,
  onAdd,
  canMutate,
  isOnline,
  compact = false,
}: FrequentlyUsedProps) {
  const t = useT();
  const client = useQueryClient();
  const toast = useToast();
  const [showAllOpen, setShowAllOpen] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [hideTarget, setHideTarget] = useState<ShoppingCatalogEntry | null>(null);

  // Online-only and unpersisted (R20) — reached only from the toggle below.
  const hiddenPage = useQuery({
    ...catalogPageQuery(householdId, listId, { includeHidden: true, limit: 200 }),
    enabled: showAllOpen && showHidden,
  });
  const hiddenEntries = (hiddenPage.data?.items ?? []).filter((entry) => entry.hiddenAt !== null);

  function writeDetail(data: ShoppingListDetailResponse) {
    client.setQueryData(queryKeys.shoppingList(householdId, listId), data);
  }

  async function setHidden(entry: ShoppingCatalogEntry, hidden: boolean) {
    try {
      const data = await setShoppingCatalogEntryHidden(householdId, listId, entry.id, { hidden });
      writeDetail(data);
      if (hidden) {
        toast.success(t("recipe.shopping.frequentlyUsed.hiddenToast"));
      } else {
        toast.success(t("recipe.shopping.frequentlyUsed.unhiddenToast"));
        await invalidate.catalogPage(client, householdId, listId);
      }
    } catch (error) {
      toast.fromError(error);
    }
  }

  if (catalog.length === 0) return null;

  // STEP 1 (selection) then STEP 2 (display order) — two calls, never one `sortBy` (R8).
  const chips = sortEntriesByFoldedName(selectMostBoughtEntries(catalog));

  const canHide = canMutate && isOnline;

  const onContextMenuFor = (entry: ShoppingCatalogEntry) => (event: { preventDefault: () => void }) => {
    event.preventDefault();
    if (canHide) setHideTarget(entry);
  };

  if (compact) {
    return (
      <ul aria-label={t("recipe.shopping.frequentlyUsed.heading")} className="scroll-x no-scrollbar flex gap-2">
        {chips.map((entry) => (
          <li key={entry.id} className="shrink-0">
            <Chip
              label={entry.name}
              leadingIcon={<Plus aria-hidden="true" className="size-3.5 text-fg-muted" />}
              disabled={!canMutate}
              onSelect={() => onAdd(entry)}
              onContextMenu={onContextMenuFor(entry)}
            />
          </li>
        ))}
      </ul>
    );
  }

  const allSorted = sortEntriesByFoldedName(catalog);

  return (
    <section aria-labelledby="frequently-used-heading" className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2">
        <span
          id="frequently-used-heading"
          className="font-display text-display-sm font-medium text-fg"
        >
          {t("recipe.shopping.frequentlyUsed.heading")}
        </span>
        <button
          type="button"
          onClick={() => setShowAllOpen(true)}
          className="ml-auto text-xs font-semibold text-brand-hover"
        >
          {t("recipe.shopping.frequentlyUsed.showAll", { count: catalog.length })}
        </button>
      </div>
      <ul className="flex flex-wrap gap-2">
        {chips.map((entry) => (
          <li key={entry.id}>
            <Chip
              label={entry.name}
              leadingIcon={<Plus aria-hidden="true" className="size-3.5 text-fg-muted" />}
              disabled={!canMutate}
              onSelect={() => onAdd(entry)}
              onContextMenu={onContextMenuFor(entry)}
            />
          </li>
        ))}
      </ul>
      {canHide ? (
        <p className="text-xs text-fg-faint">{t("recipe.shopping.frequentlyUsed.hideHint")}</p>
      ) : null}

      <Dialog
        open={showAllOpen}
        onClose={() => setShowAllOpen(false)}
        title={t("recipe.shopping.frequentlyUsed.heading")}
        size="md"
      >
        <div className="flex flex-col gap-4">
          <Switch
            checked={showHidden}
            onChange={setShowHidden}
            label={t("recipe.shopping.frequentlyUsed.showHidden")}
          />
          <ul className="flex flex-wrap gap-2">
            {allSorted.map((entry) => (
              <li key={entry.id}>
                <Chip
                  label={entry.name}
                  leadingIcon={<Plus aria-hidden="true" className="size-3.5 text-fg-muted" />}
                  disabled={!canMutate}
                  onSelect={() => onAdd(entry)}
                  onContextMenu={onContextMenuFor(entry)}
                />
              </li>
            ))}
          </ul>
          {showHidden ? (
            hiddenEntries.length > 0 ? (
              <ul className="flex flex-col gap-1 border-t border-line pt-3">
                {hiddenEntries.map((entry) => (
                  <li key={entry.id} className="flex min-h-11 items-center justify-between gap-2 text-sm">
                    <span className="truncate text-fg-muted">{entry.name}</span>
                    <button
                      type="button"
                      disabled={!canHide}
                      title={isOnline ? undefined : t("recipe.shopping.lists.offlineHint")}
                      onClick={() => void setHidden(entry, false)}
                      className="shrink-0 font-semibold text-brand-hover disabled:pointer-events-none disabled:opacity-55"
                    >
                      {t("recipe.shopping.frequentlyUsed.unhide")}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null
          ) : null}
        </div>
      </Dialog>

      <ConfirmDialog
        open={hideTarget !== null}
        onClose={() => setHideTarget(null)}
        title={t("recipe.shopping.frequentlyUsed.hideConfirm.title", { name: hideTarget?.name ?? "" })}
        description={t("recipe.shopping.frequentlyUsed.hideConfirm.description")}
        confirmLabel={t("recipe.shopping.frequentlyUsed.dismissTitle")}
        onConfirm={async () => {
          if (hideTarget) await setHidden(hideTarget, true);
        }}
      />
    </section>
  );
}
