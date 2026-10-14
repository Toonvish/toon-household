/**
 * ShoppingListPreviewCard — one list's tile on the `/recipe/shopping` overview (artboards
 * 1c/1g).
 *
 * A household can own several lists (locked decision 7), so this is COLUMN 1's repeating
 * unit under R46 — the artboard draws exactly one because its mock household has one
 * list, not because the layout assumes it. `ShoppingListsPage` stacks these,
 * last-opened-first then alphabetically.
 *
 * Opening a list from here writes `storageKeys.lastShoppingListId`, which is the
 * SAME signal R9's target-list resolution reads everywhere else (this screen's own
 * `WeekPlanPanel`, a recipe detail's "add all"): the list you last opened is the one
 * a one-tap "add" targets next, so this tap has to be the thing that updates it.
 */
import { ArrowRight, Pencil, ShoppingBasket, Trash2 } from "lucide-react";
import { formatShoppingAmount, formatQuantity, shoppingProgressPercent, type ShoppingList } from "@toon/shared";
import { ActionMenu, ProgressBar } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { storageKeys, writeStorage } from "@/lib/storage";
import { AppLink } from "@/lib/nav";

export interface ShoppingListPreviewCardProps {
  list: ShoppingList;
  householdId: string;
  /** Gates rename/delete, same rule as the page header's own "+ Neue Liste". */
  canManage: boolean;
  manageHint: string | undefined;
  onRename: (list: ShoppingList) => void;
  onDelete: (list: ShoppingList) => void;
}

export function ShoppingListPreviewCard({
  list,
  householdId,
  canManage,
  manageHint,
  onRename,
  onDelete,
}: ShoppingListPreviewCardProps) {
  const t = useT();
  const itemCount = list.itemCount ?? 0;
  const boughtCount = list.boughtCount ?? 0;
  const previewItems = list.previewItems ?? [];
  const percent = shoppingProgressPercent(itemCount, boughtCount);
  // shoppingProgressPercent's own denominator (toBuy + bought) is exactly the
  // "hide when 0" condition the done-when clause asks for — no separate check.
  const hasProgress = itemCount + boughtCount > 0;
  const overflow = Math.max(0, itemCount - previewItems.length);

  return (
    <div className="relative">
      <AppLink
        to="/recipe/shopping/$listId"
        params={{ listId: list.id }}
        onClick={() => writeStorage(storageKeys.lastShoppingListId, `${householdId}:${list.id}`)}
        className="flex flex-col gap-3.5 rounded-card border border-line bg-surface p-5 pr-12 text-fg shadow-card transition-[box-shadow,border-color] hover:border-line-strong hover:shadow-pop focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-soft-fg">
            <ShoppingBasket aria-hidden="true" className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <span className="font-display block truncate text-display-md font-medium">
              {list.name}
            </span>
            <span className="text-sm text-fg-muted">
              {t("recipe.shopping.lists.counts", { open: itemCount, bought: boughtCount })}
            </span>
          </div>
          <span className="flex shrink-0 items-center gap-1 text-sm font-semibold text-accent-strong">
            {t("recipe.shopping.lists.openList")}
            <ArrowRight aria-hidden="true" className="size-4" />
          </span>
        </div>

        {hasProgress ? (
          <ProgressBar
            value={percent}
            label={t("recipe.shopping.lists.progressAriaLabel", { percent })}
            tone="success"
          />
        ) : null}

        {itemCount > 0 && previewItems.length > 0 ? (
          <>
            {/*
              The one place a CSS-only `lg:` branch replaces the JS one
              (CLAUDE.md, "the recipe list switches MARKUP at `sm`, in JS"): that
              rule exists because a `display:none` <img> is still fetched, and
              this preview is text-only, so rendering both trees costs nothing
              extra.
            */}
            <ul className="hidden grid-cols-2 gap-x-4 gap-y-1.5 text-sm text-fg lg:grid">
              {previewItems.map((item, index) => (
                <li
                  key={index}
                  className="flex items-baseline gap-2 overflow-hidden text-ellipsis whitespace-nowrap"
                >
                  <span className="min-w-9 shrink-0 tabular-nums text-fg-faint">
                    {formatShoppingAmount(item, formatQuantity)}
                  </span>
                  {item.name}
                </li>
              ))}
            </ul>
            <p className="text-sm text-fg-muted lg:hidden">
              {previewItems.map((item) => item.name).join(", ")}
              {overflow > 0 ? (
                <span className="text-fg-faint">
                  {" "}
                  {t("recipe.shopping.lists.previewMore", { count: overflow })}
                </span>
              ) : null}
            </p>
            {overflow > 0 ? (
              <span className="hidden text-sm text-fg-faint lg:block">
                {t("recipe.shopping.lists.previewMore", { count: overflow })}
              </span>
            ) : null}
          </>
        ) : null}
      </AppLink>

      <div className="absolute top-3.5 right-3.5">
        <ActionMenu
          label={t("recipe.shopping.lists.cardMenuLabel", { name: list.name })}
          triggerVariant="ghost"
          items={[
            {
              label: t("recipe.shopping.lists.rename"),
              icon: <Pencil />,
              disabled: !canManage,
              description: !canManage ? manageHint : undefined,
              onSelect: () => onRename(list),
            },
            {
              label: t("recipe.shopping.lists.delete"),
              icon: <Trash2 />,
              variant: "danger",
              disabled: !canManage,
              description: !canManage ? manageHint : undefined,
              onSelect: () => onDelete(list),
            },
          ]}
        />
      </div>
    </div>
  );
}
