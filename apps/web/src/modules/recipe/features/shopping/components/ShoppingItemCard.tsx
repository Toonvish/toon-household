/**
 * One line on a shopping list, as a LARGE row. **Desktop only** — from `sm` up;
 * a phone gets the two-column grid of `ShoppingItemTile` instead, and
 * `ShoppingListDetailPage` renders one or the other, never both.
 *
 * Sizing is the whole point: this is read and tapped one-handed, possibly with a
 * trolley in the other hand. So the row is ~72px tall, the ENTIRE row is the check-off
 * button (not a small checkbox), and the secondary actions sit in their own >=44px
 * targets that stop the click from reaching it.
 *
 * Checking off REMOVES the line (it reappears under "Häufig gekauft"), so the visual
 * feedback is a beat of green rather than a strikethrough — there is nothing left to
 * strike through. It used to be a filled checkbox square; that square was the only
 * checkbox left in the feature and it read as "tick me" next to a card whose whole
 * surface already does that, so the tint carries it alone now.
 *
 * The interior is a `grid-cols-[64px_minmax(0,1fr)_auto]` row (artboard `1d`, §8.1):
 * the amount in its own right-aligned column so a stack of lines reads like a
 * receipt, the name/note in the middle, and a right-aligned PROVENANCE label in
 * the third column — never a raw id, and never a count read off
 * `sourceRecipeIds` (which deliberately keeps ids whose recipe was deleted, so the
 * two arrays disagree by design; only `sources`, the resolved array, may be shown).
 */
import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { formatQuantity, formatShoppingAmount, isVagueAmount, type ShoppingItem } from "@toon/shared";
import { IconButton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { isPendingItemId } from "../lib/offline";

/**
 * The right column's "from" label. Nothing for zero sources (even when
 * `sourceRecipeIds` is not empty — a deleted recipe's id has no title to show),
 * the first title alone for one, `sourcesMore` beyond that.
 */
function provenanceLabel(item: ShoppingItem, t: ReturnType<typeof useT>): string | null {
  if (item.sources.length === 0) return null;
  const [first, ...rest] = item.sources;
  if (!first) return null;
  if (rest.length === 0) return t("recipe.shopping.item.sources", { sources: first.title });
  return t("recipe.shopping.item.sourcesMore", { name: first.title, count: rest.length });
}

export interface ShoppingItemCardProps {
  item: ShoppingItem;
  onCheck: (itemId: string) => void;
  onEdit: (item: ShoppingItem) => void;
  onRemove: (itemId: string) => void;
  /** False while the household is read-only for this user (see useCanMutate). */
  canMutate: boolean;
}

export function ShoppingItemCard({
  item,
  onCheck,
  onEdit,
  onRemove,
  canMutate,
}: ShoppingItemCardProps) {
  const t = useT();
  /**
   * Purely visual: the row leaves the list as soon as the optimistic update lands, so
   * without a beat of "ticked" feedback the item would simply vanish under the thumb.
   */
  const [ticking, setTicking] = useState(false);

  // A line that only exists optimistically has no server id yet, so editing or
  // deleting it by id would 404. Checking it off is fine — the queue is ordered.
  const pending = isPendingItemId(item.id);
  const amount = formatShoppingAmount(item, formatQuantity);
  const vague = isVagueAmount(item);
  const from = provenanceLabel(item, t);

  const check = () => {
    if (!canMutate || ticking) return;
    setTicking(true);
    onCheck(item.id);
  };

  return (
    <li className="relative">
      <button
        type="button"
        onClick={check}
        disabled={!canMutate}
        aria-label={t("recipe.shopping.item.checkAriaLabel", { name: item.name })}
        className={cn(
          "grid w-full grid-cols-[4rem_minmax(0,1fr)_auto] items-center gap-3.5 rounded-card border border-line bg-surface py-3 pl-3 text-left",
          "min-h-[4.5rem] transition-[background-color,border-color,opacity] duration-150",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          "active:bg-surface-2 disabled:opacity-60 sm:min-h-16 sm:pl-4",
          ticking && "border-success bg-success-soft opacity-70",
          // Room for the two 44px action buttons that overlay the right edge (two
          // `size-11` + `gap-1` + `right-2` = 100px). Left and right padding are set
          // SEPARATELY on purpose: an `sm:px-4` here used to override `pr-24` at every
          // width this desktop-only card renders at, and the buttons sat on the text.
          canMutate && !pending ? "pr-[6.75rem]" : "pr-3 sm:pr-4",
        )}
      >
        <span
          className={cn(
            "text-right text-[15px] font-semibold tabular-nums",
            vague ? "text-fg-faint" : "text-accent-strong",
          )}
        >
          {amount}
        </span>

        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-base leading-snug font-medium break-words text-fg sm:text-[1.05rem]">
            {item.name}
          </span>
          {item.note ? (
            <span className="truncate text-sm text-fg-muted">{item.note}</span>
          ) : null}
        </span>

        {from ? <span className="truncate text-xs text-fg-faint">{from}</span> : <span />}
      </button>

      {canMutate && !pending ? (
        <span className="absolute inset-y-0 right-2 flex items-center gap-1">
          <IconButton
            label={t("recipe.shopping.item.edit")}
            variant="ghost"
            onClick={() => onEdit(item)}
            icon={<Pencil />}
          />
          <IconButton
            label={t("recipe.shopping.item.remove")}
            variant="ghost"
            onClick={() => onRemove(item.id)}
            icon={<Trash2 />}
          />
        </span>
      ) : null}
    </li>
  );
}
