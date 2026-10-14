/**
 * The "Treuekarten" panel on `/recipe/shopping` — the ONLY way into the wallet on a phone.
 *
 * `/recipe/shopping/cards` is not a tab (the tab bar is full and deliberately so, see
 * `components/layout/nav-items.ts`) and there is no sidebar below `lg`, so deleting
 * this panel would make the whole feature unreachable on the device it exists for.
 * Same rule as `GroupsCard` on `/settings`.
 *
 * It shows the saved cards as chips that open the till screen DIRECTLY, because
 * that is the actual journey: you are standing at the checkout with the shopping
 * list open and you need the Payback code now, not after two more taps. Managing
 * them is the secondary action.
 *
 * `compact` is `1g`'s condensed phone tile in the overview's 2-up grid (a heading
 * plus the single most relevant card); the default is `1c`'s wider desktop panel
 * (the chip row, the "Manage" link and a dashed "+ Karte hinzufügen" tile). Both are
 * ONE component with ONE data source (`useCards`) — the compact tile still routes
 * to `/recipe/shopping/cards`, so it never becomes a second, forked way into the wallet.
 *
 * The dashed add tile is gated with `useCanMutate()` — the OPPOSITE rule from this
 * screen's list/plan actions (`ShoppingListsPage`'s own `canManage`): a card write
 * is an ordinary online mutation with no offline outbox, so `canMutate: false`
 * offline is exactly right here, unlike on the shopping screens themselves.
 * Showing a barcode is a read and is never gated at all.
 */
import { useState } from "react";
import { CreditCard, Plus } from "lucide-react";
import type { Card as CardEntity } from "@toon/shared";
import { Button, Card, CardHeader } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { useCanMutate } from "@/lib/session";
import { AppLink } from "@/lib/nav";
import { CardDisplayDialog } from "./CardDisplayDialog";
import { CardFormDialog } from "./CardFormDialog";
import { useCards } from "../lib/queries";

/** How many chips fit before the row starts to look like a list. */
const MAX_CHIPS = 4;

export interface CardsCardProps {
  /** `1g`'s condensed 2-up tile. Default: `1c`'s wider desktop panel. */
  compact?: boolean;
}

export function CardsCard({ compact = false }: CardsCardProps) {
  const t = useT();
  const cards = useCards();
  const [showing, setShowing] = useState<CardEntity | null>(null);
  const [adding, setAdding] = useState(false);
  const { canMutate, reason } = useCanMutate();

  // While the wallet is loading — or has failed, which offline is the normal case —
  // the panel still renders its link. An empty panel that says what it is for beats
  // one that vanishes, because vanishing hides the whole feature.
  const items = cards.data ?? [];

  if (compact) {
    return (
      <AppLink
        to="/recipe/shopping/cards"
        className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4 text-fg transition-colors hover:border-line-strong"
      >
        <span className="font-display text-display-sm font-medium">{t("recipe.cards.heading")}</span>
        <span className="truncate text-sm text-fg-muted">
          {items.length > 0 ? items[0]!.label : t("recipe.cards.empty.title")}
        </span>
      </AppLink>
    );
  }

  return (
    <Card className="flex flex-col gap-3">
      <CardHeader
        className="mb-0"
        title={
          <span className="flex items-center gap-2">
            <CreditCard aria-hidden="true" className="size-4 text-brand" />
            {t("recipe.cards.link.panelTitle")}
          </span>
        }
        description={t("recipe.cards.link.description")}
        action={
          <AppLink to="/recipe/shopping/cards" className="text-sm font-semibold text-fg">
            {t("recipe.cards.link.action")}
          </AppLink>
        }
      />

      {items.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {items.slice(0, MAX_CHIPS).map((card) => (
            <li key={card.id}>
              <button
                type="button"
                onClick={() => setShowing(card)}
                className="min-h-11 max-w-full truncate rounded-full border border-line bg-surface-2 px-4 text-sm font-medium text-fg transition-colors hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {card.label}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-fg-muted">{t("recipe.cards.empty.title")}</p>
      )}

      <Button
        variant="dashed"
        leftIcon={<Plus className="size-4" />}
        disabled={!canMutate}
        title={reason}
        onClick={() => setAdding(true)}
        fullWidth
      >
        {t("recipe.cards.add")}
      </Button>

      <CardDisplayDialog card={showing} onClose={() => setShowing(null)} />
      <CardFormDialog open={adding} onClose={() => setAdding(false)} card={null} />
    </Card>
  );
}
