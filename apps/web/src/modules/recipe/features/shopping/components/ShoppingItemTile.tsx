/**
 * One shopping line as a TILE, for the phone grid. The Bring-style layout.
 *
 * The whole tile is one button and there is nothing else on it: the name is the
 * headline, everything measurable ("500 g", a note) is one muted subtitle under it,
 * and the recipe a line came from is deliberately NOT shown — in the shop it is noise,
 * and it is one long-press away in `ItemDetailDialog`.
 *
 * No checkbox. Checking off deletes the row (it reappears under "Häufig gekauft"), so
 * the tile is gone a beat later anyway; the feedback is the tile itself turning green
 * with a check laid over it. That badge is ABSOLUTE on purpose — a check that took part
 * in the layout would reflow the name at the moment the thumb is on it.
 *
 * The desktop equivalent is `ShoppingItemCard` (a row with visible edit/remove
 * buttons); `ShoppingListDetailPage` picks one, it never renders both.
 *
 * The name is `line-clamp-2` with a fixed `min-h`, NOT the artboard's single
 * truncated line (R39) — a clamped German compound ("Rinderhackfl…") is
 * unreadable at 175px on the one screen whose whole job is being read at a
 * shelf. The `min-h` keeps the 2-up grid even whether a line wraps or not, and
 * the clamp stays the ONLY `display` utility on the element (`block` beats
 * `line-clamp-N`).
 */
import { useState } from "react";
import { Check } from "lucide-react";
import { formatQuantity, formatShoppingAmount, type ShoppingItem } from "@toon/shared";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { useLongPress } from "../lib/useLongPress";

export interface ShoppingItemTileProps {
  item: ShoppingItem;
  onCheck: (itemId: string) => void;
  /** Long press, right click, or the screen-reader-only button below the tile. */
  onOpenDetails: (item: ShoppingItem) => void;
  /** False while the household is read-only for this user (see useCanMutate). */
  canMutate: boolean;
}

export function ShoppingItemTile({
  item,
  onCheck,
  onOpenDetails,
  canMutate,
}: ShoppingItemTileProps) {
  const t = useT();
  const [ticking, setTicking] = useState(false);
  const press = useLongPress(() => onOpenDetails(item));

  const amount = formatShoppingAmount(item, formatQuantity);
  const subtitle = [amount, item.note].filter((part) => Boolean(part)).join(" · ");

  const check = () => {
    if (press.consume()) return;
    if (!canMutate || ticking) return;
    setTicking(true);
    onCheck(item.id);
  };

  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={check}
        disabled={!canMutate}
        aria-label={t("recipe.shopping.item.checkAriaLabel", { name: item.name })}
        {...press.handlers}
        className={cn(
          "relative flex h-full w-full touch-manipulation flex-col justify-center gap-1",
          "rounded-card border border-line bg-surface px-3 py-3 text-left select-none",
          "min-h-24 [-webkit-touch-callout:none]",
          "transition-[background-color,border-color,opacity] duration-150",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          "active:bg-surface-2 disabled:opacity-60",
          ticking && "border-success bg-success-soft opacity-70",
        )}
      >
        {/* No `hyphens-auto`: the names are German CONTENT but `<html lang>` follows the
            INTERFACE locale, so an English UI would hyphenate them by English rules. */}
        <span className="line-clamp-2 min-h-[2.6rem] text-lg leading-tight font-semibold break-words text-fg">
          {item.name}
        </span>
        {subtitle ? (
          <span className="line-clamp-2 text-sm leading-snug break-words text-fg-muted">
            {subtitle}
          </span>
        ) : null}

        {ticking ? (
          <span
            aria-hidden="true"
            className="absolute inset-0 flex items-center justify-center rounded-card bg-success-soft/70"
          >
            <Check className="size-8 text-success" strokeWidth={3} />
          </span>
        ) : null}
      </button>

      {/* A press-and-hold is unreachable with a screen reader or a keyboard, so the
          same sheet gets a real (invisible) button. */}
      <button type="button" onClick={() => onOpenDetails(item)} className="sr-only">
        {t("recipe.shopping.item.details", { name: item.name })}
      </button>
    </li>
  );
}
