/**
 * CardsPage — the wallet, at `/recipe/shopping/cards`.
 *
 * Why it lives under `/recipe/shopping` and not behind its own tab: cards are used in the
 * same five minutes as the shopping list, and the tab bar is full (four items, and
 * `nav-items.ts` is deliberate about that). The route is reached from the "Karten"
 * card on `/recipe/shopping`, which is two taps from anywhere — the same pattern
 * `GroupsCard` on `/settings` uses to keep group management reachable on a phone.
 *
 * `useCanMutate()` IS the right gate here, unlike on the shopping screens. Reading
 * the wallet works offline (the query is persisted, which is the whole point of a
 * card at a till), but SAVING one is an online-only, do-it-at-home action, so there
 * is no outbox and nothing to queue — see ./lib/queries.ts.
 */
import { useState } from "react";
import { ChevronLeft, CreditCard, Pencil, Plus, Trash2 } from "lucide-react";
import type { Card as CardEntity } from "@toon/shared";
import {
  ActionMenu,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Skeleton,
  useToast,
} from "@/components/ui";
import { errorMessage } from "@/modules/recipe/lib/api";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { useCanMutate } from "@/lib/session";
import { AppLink } from "@/lib/nav";
import { BarcodeImage } from "./components/BarcodeImage";
import { CardDisplayDialog } from "./components/CardDisplayDialog";
import { CardFormDialog } from "./components/CardFormDialog";
import { CARD_FORMAT_LABEL_KEYS } from "./lib/formats";
import { useCards, useDeleteCard } from "./lib/queries";
import { PhoneHeaderRow } from "@/components/layout/PhoneHeaderRow";

export default function CardsPage() {
  const t = useT();
  const toast = useToast();
  const cards = useCards();
  const remove = useDeleteCard();
  const { canMutate, reason } = useCanMutate();

  const [showing, setShowing] = useState<CardEntity | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  /** The card being edited; null with `formOpen` means "add". */
  const [editing, setEditing] = useState<CardEntity | null>(null);
  const [deleting, setDeleting] = useState<CardEntity | null>(null);

  const items = cards.data ?? [];

  const openAdd = (): void => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (card: CardEntity): void => {
    setEditing(card);
    setFormOpen(true);
  };

  return (
    <div className="flex flex-col gap-4">
      <PhoneHeaderRow />
      <AppLink
        to="/recipe/shopping"
        className="inline-flex w-fit items-center gap-1 text-sm text-fg-muted hover:text-fg"
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
        {t("recipe.shopping.lists.heading")}
      </AppLink>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-display-2xl font-medium text-fg lg:text-display-3xl">{t("recipe.cards.heading")}</h1>
          <p className="text-sm text-fg-muted">{t("recipe.cards.subtitle")}</p>
        </div>
        <Button
          onClick={openAdd}
          leftIcon={<Plus className="size-4" />}
          disabled={!canMutate}
          title={reason}
        >
          {t("recipe.cards.add")}
        </Button>
      </header>

      {cards.isPending ? (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1].map((index) => (
            <li key={index}>
              <Card className="flex flex-col gap-3">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-16 w-full" />
              </Card>
            </li>
          ))}
        </ul>
      ) : cards.isError ? (
        <ErrorState error={cards.error} onRetry={() => void cards.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<CreditCard />}
          title={t("recipe.cards.empty.title")}
          description={t("recipe.cards.empty.description")}
          action={
            <Button onClick={openAdd} fullWidth disabled={!canMutate} title={reason}>
              {t("recipe.cards.empty.action")}
            </Button>
          }
        />
      ) : (
        <>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((card) => (
              <li key={card.id}>
                <CardTile
                  card={card}
                  canMutate={canMutate}
                  reason={reason}
                  onShow={() => setShowing(card)}
                  onEdit={() => openEdit(card)}
                  onDelete={() => setDeleting(card)}
                />
              </li>
            ))}
          </ul>
          <p className="text-sm text-fg-muted">{t("recipe.cards.privateHint")}</p>
        </>
      )}

      <CardDisplayDialog card={showing} onClose={() => setShowing(null)} />
      <CardFormDialog open={formOpen} onClose={() => setFormOpen(false)} card={editing} />
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={t("recipe.cards.delete.title")}
        description={
          deleting === null ? "" : t("recipe.cards.delete.description", { label: deleting.label })
        }
        confirmLabel={t("recipe.cards.action.delete")}
        cancelLabel={t("recipe.cards.action.cancel")}
        destructive
        // `ConfirmDialog` closes itself when this resolves and stays open when it
        // rejects, so the failure is re-thrown after the toast rather than
        // swallowed — a card the server refused to delete is still there.
        onConfirm={async () => {
          const card = deleting;
          if (card === null) return;
          try {
            await remove.mutateAsync(card.id);
            toast.success(t("recipe.cards.delete.success", { label: card.label }));
            setDeleting(null);
          } catch (error) {
            toast.error(t("recipe.cards.delete.error"), errorMessage(error));
            throw error;
          }
        }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* one card                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A tile whose whole surface shows the card — the same "the card IS the button"
 * rule the shopping list's items follow, because at a till you tap with one hand
 * and no attention to spare.
 *
 * The barcode itself is a tiny preview, so the tile is recognisable at a glance
 * (a card is easier to spot by its stripe pattern than by its name), and the
 * overflow menu holds edit/delete rather than a row of icon buttons that would
 * eat the label's width on a phone.
 *
 * **Flat `bg-surface-2`, no gradient, no per-card colour** (R42). The design's
 * Payback-blue tile is one mock instance, not a brand requirement, and a
 * six-pair id-derived gradient table would be decoration nobody asked for —
 * `cards` has no colour column and stays that way.
 */
function CardTile({
  card,
  canMutate,
  reason,
  onShow,
  onEdit,
  onDelete,
}: {
  card: CardEntity;
  canMutate: boolean;
  reason: string | undefined;
  onShow: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useT();

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onShow}
        aria-label={t("recipe.cards.tile.show")}
        className="flex w-full flex-col gap-3 rounded-card bg-surface-2 p-4 pr-14 text-left text-fg transition-transform duration-150 active:scale-[0.995] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span className="flex min-w-0 flex-col">
          <span className="font-display truncate text-display-sm font-medium text-fg">{card.label}</span>
          <span className="truncate text-sm text-fg-subtle">
            {t(CARD_FORMAT_LABEL_KEYS[card.format])} · {card.value}
          </span>
        </span>
        {/* White strip, because a barcode is black on white in every theme. A
            matrix keeps its aspect ratio inside it, so it needs more height than a
            linear code to be recognisable at all. */}
        <span
          className={cn(
            "block w-full overflow-hidden rounded-md bg-white px-2 py-1",
            card.format === "qr" ? "h-16" : "h-12",
          )}
        >
          <BarcodeImage format={card.format} value={card.value} label={card.label} />
        </span>
      </button>
      <span className="absolute top-3 right-3">
        <ActionMenu
          label={t("recipe.cards.tile.menu", { label: card.label })}
          title={card.label}
          triggerVariant="ghost"
          items={[
            {
              label: t("recipe.cards.action.edit"),
              icon: <Pencil className="size-4" />,
              onSelect: onEdit,
              disabled: !canMutate,
              description: canMutate ? undefined : reason,
            },
            {
              label: t("recipe.cards.action.delete"),
              icon: <Trash2 className="size-4" />,
              onSelect: onDelete,
              variant: "danger",
              disabled: !canMutate,
              description: canMutate ? undefined : reason,
            },
          ]}
        />
      </span>
    </div>
  );
}
