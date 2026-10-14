/**
 * Everything a phone tile leaves out, one long press away — and, since the
 * redesign, the same sheet for a "Heute gekauft" ROW too (`item` and `boughtItem`
 * are mutually exclusive; exactly one is non-null while the sheet is open).
 *
 * `ShoppingItemTile`/`ShoppingItemCard` show a name and one muted line and nothing
 * else — no source, no actions. This sheet is where the rest lives: the amount,
 * the note, the recipes a to-buy line was merged from, and the three things you
 * can do to it. A bought row instead shows who bought it and when
 * (`recipe.shopping.bought.rowMeta`) and offers exactly one action, "Zurück auf die
 * Liste" — the undo copy is deliberately not "Undo", because putting the line
 * back MAY MERGE with whatever is on the list now, and `undoMergeHint` says so
 * here, before the tap, rather than as a toast the decision has already been made
 * by the time it appears.
 *
 * Like `ActionMenu`, it CLOSES BEFORE IT ACTS and defers the callback by a frame:
 * every action either opens another dialog (`EditItemDialog`) or removes the row
 * this sheet is rendering, and running it while the panel is still mounted means
 * either two stacked sheets or a render against a row that no longer exists.
 */
import { Check, Pencil, Trash2, Undo2 } from "lucide-react";
import {
  formatQuantity,
  formatShoppingAmount,
  type ShoppingBoughtItem,
  type ShoppingItem,
} from "@toon/shared";
import { Button, Dialog } from "@/components/ui";
import { formatRelativeShort } from "@/modules/recipe/lib/format";
import { useT } from "@/lib/i18n";
import { isPendingItemId } from "../lib/offline";

export interface ItemDetailDialogProps {
  /** The to-buy item this sheet describes, or `null` when `boughtItem` is used instead. */
  item: ShoppingItem | null;
  /** A "Heute gekauft" row this sheet describes instead of a to-buy item. */
  boughtItem?: ShoppingBoughtItem | null;
  onClose: () => void;
  onCheck: (itemId: string) => void;
  onEdit: (item: ShoppingItem) => void;
  onRemove: (itemId: string) => void;
  /** Required when `boughtItem` is ever passed. */
  onUndo?: (boughtId: string) => void;
  /** False while the household is read-only for this user (see useCanMutate). */
  canMutate: boolean;
}

export function ItemDetailDialog({
  item,
  boughtItem = null,
  onClose,
  onCheck,
  onEdit,
  onRemove,
  onUndo,
  canMutate,
}: ItemDetailDialogProps) {
  const t = useT();
  const isBought = item === null && boughtItem !== null;
  const open = item !== null || boughtItem !== null;
  const name = item?.name ?? boughtItem?.name ?? "";

  // A line that exists only optimistically has no server id yet, so acting on it by
  // id would 404 (to-buy) or has nothing to undo yet (bought, see offline.ts).
  const pending =
    (item !== null && isPendingItemId(item.id)) ||
    (boughtItem !== null && isPendingItemId(boughtItem.id));
  const amount = item
    ? formatShoppingAmount(item, formatQuantity)
    : boughtItem
      ? formatShoppingAmount(boughtItem, formatQuantity)
      : "";
  const note = item?.note ?? boughtItem?.note ?? null;
  const sources = item?.sources ?? [];

  /** Close first, act afterwards — see the note at the top of the file. */
  const act = (run: () => void) => {
    onClose();
    requestAnimationFrame(run);
  };

  const rows: Array<{ label: string; value: string }> = [];
  if (amount) rows.push({ label: t("recipe.shopping.item.detail.amount"), value: amount });
  if (note) rows.push({ label: t("recipe.shopping.item.detail.note"), value: note });
  if (sources.length > 0) {
    rows.push({
      label: t("recipe.shopping.item.detail.sources", { count: sources.length }),
      value: sources.map((source) => source.title).join(", "),
    });
  }
  if (boughtItem) {
    rows.push({
      label: t("recipe.shopping.bought.heading"),
      value: t("recipe.shopping.bought.rowMeta", {
        who: pending
          ? t("recipe.shopping.bought.you")
          : (boughtItem.boughtByName ?? t("recipe.shopping.bought.unknownBuyer")),
        when: formatRelativeShort(boughtItem.boughtAt),
      }),
    });
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={name || undefined}
      description={isBought && !pending ? t("recipe.shopping.bought.undoMergeHint", { name }) : undefined}
      size="sm"
      footer={
        isBought ? (
          boughtItem && canMutate && !pending ? (
            <Button leftIcon={<Undo2 />} onClick={() => act(() => onUndo?.(boughtItem.id))}>
              {t("recipe.shopping.bought.undo")}
            </Button>
          ) : null
        ) : item ? (
          <>
            {canMutate && !pending ? (
              <Button
                variant="ghost"
                leftIcon={<Trash2 />}
                className="text-danger hover:bg-danger-soft"
                onClick={() => act(() => onRemove(item.id))}
              >
                {t("recipe.shopping.item.remove")}
              </Button>
            ) : null}
            {canMutate && !pending ? (
              <Button variant="outline" leftIcon={<Pencil />} onClick={() => act(() => onEdit(item))}>
                {t("recipe.shopping.item.edit")}
              </Button>
            ) : null}
            <Button
              leftIcon={<Check />}
              disabled={!canMutate}
              onClick={() => act(() => onCheck(item.id))}
            >
              {t("recipe.shopping.item.check")}
            </Button>
          </>
        ) : null
      }
    >
      {rows.length === 0 ? (
        <p className="py-1 text-sm text-fg-muted">{t("recipe.shopping.item.detail.empty")}</p>
      ) : (
        <dl className="flex flex-col gap-3 py-1">
          {rows.map((row) => (
            <div key={row.label} className="min-w-0">
              <dt className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
                {row.label}
              </dt>
              <dd className="mt-0.5 break-words text-fg">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </Dialog>
  );
}
