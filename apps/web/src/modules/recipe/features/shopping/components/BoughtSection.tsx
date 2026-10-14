/**
 * "Heute gekauft" — the log rows a check-off writes (D4), rendered under the
 * to-buy section (desktop, `layout="rows"`, artboard `1d` §8.1) or as a
 * collapsible tile grid (phone, `layout="tiles"`, artboard `1h` §8.2).
 *
 * RENDERS NOTHING AT ALL, `SectionHeader` included, when there are no bought
 * entries (R44) — there is deliberately no `recipe.shopping.bought.empty` key. A screen
 * the user navigated TO gets a real empty state; a secondary section under one
 * does not.
 *
 * Tapping a row opens the SAME `ItemDetailDialog` the to-buy tiles use (now
 * generalised to a `boughtItem` mode), which is where "Zurück auf die Liste"
 * lives together with the merge hint — see that file's own doc comment for why
 * that copy is not a toast. A `pending:` row (the optimistic entry a check-off
 * writes before the server confirms one) is non-interactive at `opacity-70`: it
 * has no server id yet, so acting on it would either 404 or duplicate the undo
 * once the real row lands.
 *
 * "Gekauftes leeren" moves a per-list WATERMARK (`POST …/bought/clear`) — the log
 * itself is never deleted, so the history panel and `/recipe/shopping/history` keep
 * every row. That is also why the copy is not destructive (R31): nothing is
 * actually removed, only this view.
 */
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { ShoppingBoughtItem, ShoppingListDetailResponse } from "@toon/shared";
import { formatQuantity, formatShoppingAmount } from "@toon/shared";
import { ConfirmDialog, IconButton, SectionHeader, useToast } from "@/components/ui";
import { clearBoughtSection } from "@/modules/recipe/lib/api";
import { useT } from "@/lib/i18n";
import { formatRelativeShort } from "@/modules/recipe/lib/format";
import { queryKeys } from "@/modules/recipe/lib/queries";
import { isPendingItemId } from "../lib/offline";
import { useLongPress } from "../lib/useLongPress";

export interface BoughtSectionProps {
  layout: "rows" | "tiles";
  entries: ShoppingBoughtItem[];
  householdId: string;
  listId: string;
  canMutate: boolean;
  /** Gates `Gekauftes leeren` — an online-only write, unlike undo (R28). */
  isOnline: boolean;
  onOpenDetail: (entry: ShoppingBoughtItem) => void;
  /** `layout="tiles"` only — default OPEN (artboard `1h`). */
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

function rowMeta(
  entry: ShoppingBoughtItem,
  t: ReturnType<typeof useT>,
): string {
  const who = isPendingItemId(entry.id)
    ? t("recipe.shopping.bought.you")
    : (entry.boughtByName ?? t("recipe.shopping.bought.unknownBuyer"));
  return t("recipe.shopping.bought.rowMeta", { who, when: formatRelativeShort(entry.boughtAt) });
}

function BoughtRow({
  entry,
  onOpen,
}: {
  entry: ShoppingBoughtItem;
  onOpen: (entry: ShoppingBoughtItem) => void;
}) {
  const t = useT();
  const pending = isPendingItemId(entry.id);
  const amount = formatShoppingAmount(entry, formatQuantity);

  return (
    <li>
      <button
        type="button"
        disabled={pending}
        onClick={() => onOpen(entry)}
        className={
          "grid w-full grid-cols-[4rem_minmax(0,1fr)_auto] items-center gap-3.5 rounded-card px-3 py-2 text-left text-fg-muted " +
          (pending ? "opacity-70" : "transition-colors duration-150 hover:bg-surface-2")
        }
      >
        <span className="text-right text-sm tabular-nums">{amount}</span>
        <span className="min-w-0 truncate text-[15px] line-through">{entry.name}</span>
        <span className="truncate text-xs">{rowMeta(entry, t)}</span>
      </button>
    </li>
  );
}

function BoughtTile({
  entry,
  onOpen,
}: {
  entry: ShoppingBoughtItem;
  onOpen: (entry: ShoppingBoughtItem) => void;
}) {
  const t = useT();
  const pending = isPendingItemId(entry.id);
  const amount = formatShoppingAmount(entry, formatQuantity);
  const press = useLongPress(() => !pending && onOpen(entry));

  return (
    <li className="min-w-0">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (press.consume()) return;
          if (!pending) onOpen(entry);
        }}
        {...press.handlers}
        className={
          "flex h-full w-full min-h-24 touch-manipulation flex-col justify-center gap-1 rounded-card border border-line bg-surface px-3 py-3 text-left select-none [-webkit-touch-callout:none] " +
          (pending ? "opacity-70" : "")
        }
      >
        <span className="line-clamp-2 min-h-[2.6rem] text-lg leading-tight font-semibold break-words text-fg-muted line-through">
          {entry.name}
        </span>
        <span className="truncate text-sm text-fg-faint">
          {[amount, rowMeta(entry, t)].filter(Boolean).join(" · ")}
        </span>
      </button>
    </li>
  );
}

export function BoughtSection({
  layout,
  entries,
  householdId,
  listId,
  canMutate,
  isOnline,
  onOpenDetail,
  collapsed = false,
  onToggleCollapse,
}: BoughtSectionProps) {
  const t = useT();
  const client = useQueryClient();
  const toast = useToast();
  const [clearOpen, setClearOpen] = useState(false);

  if (entries.length === 0) return null;

  async function clear() {
    const data: ShoppingListDetailResponse = await clearBoughtSection(householdId, listId);
    client.setQueryData(queryKeys.shoppingList(householdId, listId), data);
    toast.success(t("recipe.shopping.bought.clearedToast"));
  }

  const clearDisabled = !canMutate || !isOnline;
  const clearTitle = !isOnline ? t("recipe.shopping.lists.offlineHint") : undefined;

  return (
    <>
      <SectionHeader
        tone="success"
        title={t("recipe.shopping.bought.headingWithCount", { count: entries.length })}
        action={
          layout === "rows" ? (
            <button
              type="button"
              disabled={clearDisabled}
              title={clearTitle}
              onClick={() => setClearOpen(true)}
              className="text-xs font-semibold text-brand-hover disabled:pointer-events-none disabled:opacity-55"
            >
              {t("recipe.shopping.bought.clear")}
            </button>
          ) : (
            <IconButton
              label={collapsed ? t("recipe.shopping.bought.expand") : t("recipe.shopping.bought.collapse")}
              variant="ghost"
              size="sm"
              aria-expanded={!collapsed}
              onClick={onToggleCollapse}
              icon={
                <ChevronDown className={collapsed ? "" : "rotate-180 transition-transform"} />
              }
            />
          )
        }
      />

      {layout === "rows" ? (
        <ul className="flex flex-col">
          {entries.map((entry) => (
            <BoughtRow key={entry.id} entry={entry} onOpen={onOpenDetail} />
          ))}
        </ul>
      ) : collapsed ? null : (
        <ul className="grid grid-cols-2 gap-2">
          {entries.map((entry) => (
            <BoughtTile key={entry.id} entry={entry} onOpen={onOpenDetail} />
          ))}
        </ul>
      )}

      {layout === "rows" ? (
        <ConfirmDialog
          open={clearOpen}
          onClose={() => setClearOpen(false)}
          title={t("recipe.shopping.bought.clearConfirm.title")}
          description={t("recipe.shopping.bought.clearConfirm.description")}
          confirmLabel={t("recipe.shopping.bought.clearConfirm.confirm")}
          onConfirm={clear}
        />
      ) : null}
    </>
  );
}
