/**
 * ShoppingListsPage — `/recipe/shopping`, the household's shopping overview (redesign screen E,
 * artboards 1c/1g, `docs/redesign/briefs/T8.5.md`).
 *
 * Several named lists per household, because one household shops in more than one place
 * ("Rewe", "Drogerie", "Getränkemarkt") — locked decision 7. The artboard draws
 * exactly ONE list-preview cell because its mock household has one list; R46 is what
 * makes that survive a real household with several: column 1 becomes a vertical STACK of
 * `ShoppingListPreviewCard`s, last-opened-first then alphabetically, while columns 2
 * (`WeekPlanPanel`) and 3 (`CardsCard` + `BoughtHistoryPanel`) stay fixed. The phone
 * layout stacks everything full-width, except the trailing Cards/History row, which
 * is the ONE 2-up grid on this screen (unchanged from the artboard either way).
 *
 * Creating, renaming and deleting a list needs a connection (see the note in
 * lib/offline.ts), so this screen — unlike the list detail — really is read-only
 * offline, and says so. An unconfirmed e-mail address blocks the same three
 * actions for a different reason (the server answers 403), so both conditions
 * fold into one `canManage`, with the address taking precedence in the copy: a
 * signal will come back on its own, a confirmation click will not.
 *
 * This is the ONE screen where `useCanMutate()` must NOT gate the list/plan
 * actions (CLAUDE.md) — `canManage` above is the reason why — while `CardsCard`,
 * mounted right here, uses exactly that hook for its own writes. Same screen,
 * opposite rule, because a card write has no offline outbox and a list/plan write
 * does.
 */
import { useState } from "react";
import { ListPlus, ShoppingBasket } from "lucide-react";
import { foldText } from "@toon/shared";
import { CreateShoppingListRequestSchema, type ShoppingList } from "@toon/shared";
import { useQuery } from "@tanstack/react-query";
import {
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  Input,
  SkeletonList,
  useToast,
} from "@/components/ui";
import { PhoneHeaderRow } from "@/components/layout";
import { errorMessage } from "@/modules/recipe/lib/api";
import { formatRelativeShort } from "@/modules/recipe/lib/format";
import { useT } from "@/lib/i18n";
import { boughtHistoryQuery } from "@/modules/recipe/lib/queries";
import { useActiveHousehold, useEmailVerificationBlock, useRequiredHouseholdId, useSession } from "@/lib/session";
import { readStorage, storageKeys } from "@/lib/storage";
import { apiFieldErrors, validate, type FieldErrors } from "@/lib/validation";
import { CardsCard } from "@/modules/recipe/features/cards/components/CardsCard";
import {
  useCreateShoppingList,
  useDeleteShoppingList,
  useRenameShoppingList,
  useShoppingLists,
} from "./lib/queries";
import { ShoppingListPreviewCard } from "./components/ShoppingListPreviewCard";
import { WeekPlanPanel } from "./components/WeekPlanPanel";
import { BoughtHistoryPanel } from "./components/BoughtHistoryPanel";

/** A shopper counts as "active" for this long after their last check-off (R33). */
const SHOPPER_ACTIVE_WINDOW_MS = 15 * 60 * 1000;

/**
 * R46's stacking order for column 1: the last-opened list first
 * (`storageKeys.lastShoppingListId`, R9), then every other list alphabetically by
 * its FOLDED name (`foldText`, never a raw `localeCompare` — see CLAUDE.md,
 * "Äpfel" would otherwise sort after "Z").
 */
function orderForOverview(householdId: string, lists: readonly ShoppingList[]): ShoppingList[] {
  const saved = readStorage(storageKeys.lastShoppingListId);
  let lastId: string | null = null;
  if (saved) {
    const [savedHouseholdId, savedListId] = saved.split(":");
    if (savedHouseholdId === householdId) lastId = savedListId ?? null;
  }
  const rest = [...lists]
    .filter((list) => list.id !== lastId)
    .sort((a, b) => foldText(a.name).localeCompare(foldText(b.name)) || a.name.localeCompare(b.name));
  const last = lastId ? lists.find((list) => list.id === lastId) : undefined;
  return last ? [last, ...rest] : rest;
}

export default function ShoppingListsPage() {
  const t = useT();
  const { household } = useActiveHousehold();
  const householdId = useRequiredHouseholdId();
  const { isOnline, user } = useSession();
  const unverified = useEmailVerificationBlock();
  const canManage = isOnline && unverified === undefined;
  const manageHint = unverified ?? (isOnline ? undefined : t("recipe.shopping.lists.offlineHint"));
  const lists = useShoppingLists(householdId);

  // Just enough of the bought feed to draw "{name} kauft gerade ein" (R33) — a
  // separate, tiny query from `BoughtHistoryPanel`'s own (which needs several day
  // buckets, not just the newest row), same rule as `WeekStrip` vs. `PlanDayCard`
  // each fetching only what they draw.
  const latestBought = useQuery(boughtHistoryQuery(householdId, { limit: 1 }));

  const [createOpen, setCreateOpen] = useState(false);
  const [renaming, setRenaming] = useState<ShoppingList | null>(null);
  const [deleting, setDeleting] = useState<ShoppingList | null>(null);

  const items = lists.data ?? [];
  const ordered = orderForOverview(householdId, items);

  const syncedAt = lists.dataUpdatedAt > 0 ? formatRelativeShort(new Date(lists.dataUpdatedAt).toISOString()) : null;
  const activeShopperRow = latestBought.data?.items[0];
  const activeShopperName =
    activeShopperRow &&
    activeShopperRow.boughtBy !== null &&
    activeShopperRow.boughtBy !== user?.id &&
    Date.now() - new Date(activeShopperRow.boughtAt).getTime() < SHOPPER_ACTIVE_WINDOW_MS
      ? activeShopperRow.boughtByName
      : null;

  const createAction = (
    <Button
      size="sm"
      variant="ghost"
      leftIcon={<ListPlus className="size-4" />}
      disabled={!canManage}
      title={manageHint}
      onClick={() => setCreateOpen(true)}
    >
      {t("recipe.shopping.lists.create")}
    </Button>
  );

  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      <PhoneHeaderRow action={createAction} />

      <header className="flex items-end gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-display-2xl leading-[1.05] font-medium text-fg lg:text-display-3xl lg:leading-[1.1]">
            {t("recipe.shopping.lists.heading")}
          </h1>
          {household && syncedAt ? (
            <p className="mt-1.5 truncate text-sm text-fg-subtle">
              <span className="hidden lg:inline">
                {t("recipe.shopping.lists.sharedSummarySynced", {
                  group: household.name,
                  members: t("household.count.members", { count: household.memberCount }),
                  synced: syncedAt,
                })}
              </span>
              <span className="lg:hidden">
                {t("recipe.shopping.lists.syncedRelative", { relative: syncedAt })}
                {activeShopperName ? (
                  <> · {t("recipe.shopping.lists.shopperActive", { name: activeShopperName })}</>
                ) : null}
              </span>
            </p>
          ) : (
            <p className="mt-1.5 text-sm text-fg-subtle">{t("recipe.shopping.lists.subtitle")}</p>
          )}
        </div>
        <div className="ml-auto hidden shrink-0 lg:block">
          <Button
            leftIcon={<ListPlus className="size-4" />}
            disabled={!canManage}
            title={manageHint}
            onClick={() => setCreateOpen(true)}
          >
            {t("recipe.shopping.lists.create")}
          </Button>
        </div>
      </header>

      {lists.isPending ? (
        <SkeletonList variant="tiles" count={2} />
      ) : lists.isError ? (
        <ErrorState error={lists.error} onRetry={() => void lists.refetch()} />
      ) : items.length === 0 ? (
        <>
          <EmptyState
            icon={<ShoppingBasket />}
            title={t("recipe.shopping.lists.empty.title")}
            description={t("recipe.shopping.lists.empty.description")}
            action={
              <Button onClick={() => setCreateOpen(true)} fullWidth disabled={!canManage}>
                {t("recipe.shopping.lists.empty.action")}
              </Button>
            }
          />
          {/* Neither panel is about the list index itself (R44): the plan panel
              still explains it has no target, and the history/cards panels render
              themselves regardless of whether a list exists yet. */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <WeekPlanPanel householdId={householdId} lists={items} listsLoading={false} />
            <div className="flex flex-col gap-4">
              <CardsCard />
              <BoughtHistoryPanel householdId={householdId} />
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Desktop: the literal `1c` three-column grid (R46). */}
          <div className="hidden items-start gap-4 lg:grid lg:grid-cols-[1.25fr_minmax(0,1fr)_minmax(0,1fr)]">
            <div className="flex flex-col gap-4">
              {ordered.map((list) => (
                <ShoppingListPreviewCard
                  key={list.id}
                  list={list}
                  householdId={householdId}
                  canManage={canManage}
                  manageHint={manageHint}
                  onRename={setRenaming}
                  onDelete={setDeleting}
                />
              ))}
            </div>
            <WeekPlanPanel householdId={householdId} lists={items} listsLoading={lists.isPending} />
            <div className="flex flex-col gap-4">
              <CardsCard />
              <BoughtHistoryPanel householdId={householdId} />
            </div>
          </div>

          {/* Phone: everything stacks full-width, except the Cards/History row,
              which is `1g`'s own 2-up grid and stays one regardless of list count
              (R46 — it already handles N lists because it isn't about lists). */}
          <div className="flex flex-col gap-4 lg:hidden">
            {ordered.map((list) => (
              <ShoppingListPreviewCard
                key={list.id}
                list={list}
                householdId={householdId}
                canManage={canManage}
                manageHint={manageHint}
                onRename={setRenaming}
                onDelete={setDeleting}
              />
            ))}
            <WeekPlanPanel householdId={householdId} lists={items} listsLoading={lists.isPending} />
            <div className="grid grid-cols-2 gap-3">
              <CardsCard compact />
              <BoughtHistoryPanel householdId={householdId} compact />
            </div>
          </div>
        </>
      )}

      <CreateListDialog open={createOpen} onClose={() => setCreateOpen(false)} householdId={householdId} />
      <RenameListDialog list={renaming} onClose={() => setRenaming(null)} householdId={householdId} />
      <DeleteListDialog list={deleting} onClose={() => setDeleting(null)} householdId={householdId} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* dialogs                                                                    */
/* -------------------------------------------------------------------------- */

function CreateListDialog({
  open,
  onClose,
  householdId,
}: {
  open: boolean;
  onClose: () => void;
  householdId: string | null;
}) {
  const t = useT();
  const toast = useToast();
  const create = useCreateShoppingList(householdId);
  const [name, setName] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});

  const close = () => {
    setName("");
    setErrors({});
    onClose();
  };

  const submit = () => {
    const result = validate(CreateShoppingListRequestSchema, { name });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    create.mutate(result.data, {
      onSuccess: (list) => {
        toast.success(t("recipe.shopping.create.success", { name: list.name }));
        close();
      },
      onError: (error) => setErrors(apiFieldErrors(error)),
    });
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t("recipe.shopping.create.title")}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t("recipe.shopping.action.cancel")}
          </Button>
          <Button onClick={submit} loading={create.isPending}>
            {t("recipe.shopping.action.create")}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Input
          label={t("recipe.shopping.list.name.label")}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("recipe.shopping.list.name.placeholder")}
          error={errors.name}
          autoFocus
        />
      </form>
    </Dialog>
  );
}

function RenameListDialog({
  list,
  onClose,
  householdId,
}: {
  list: ShoppingList | null;
  onClose: () => void;
  householdId: string | null;
}) {
  const t = useT();
  const rename = useRenameShoppingList(householdId);
  const [name, setName] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});

  // Seeded from the row each time the dialog opens.
  const open = list !== null;
  const currentName = list?.name ?? "";
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (open && seededFor !== list.id) {
    setSeededFor(list.id);
    setName(currentName);
    setErrors({});
  }

  const submit = () => {
    if (!list) return;
    const result = validate(CreateShoppingListRequestSchema, { name });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    rename.mutate(
      { listId: list.id, name: result.data.name },
      { onSuccess: onClose, onError: (error) => setErrors(apiFieldErrors(error)) },
    );
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("recipe.shopping.rename.title")}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("recipe.shopping.action.cancel")}
          </Button>
          <Button onClick={submit} loading={rename.isPending}>
            {t("recipe.shopping.action.save")}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Input
          label={t("recipe.shopping.list.name.label")}
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={errors.name}
          autoFocus
        />
      </form>
    </Dialog>
  );
}

function DeleteListDialog({
  list,
  onClose,
  householdId,
}: {
  list: ShoppingList | null;
  onClose: () => void;
  householdId: string | null;
}) {
  const t = useT();
  const toast = useToast();
  const remove = useDeleteShoppingList(householdId);

  return (
    <ConfirmDialog
      open={list !== null}
      onClose={onClose}
      title={t("recipe.shopping.delete.title")}
      description={
        list
          ? t("recipe.shopping.delete.confirmDescription", {
              name: list.name,
              itemCount: t("recipe.shopping.list.itemCount", { count: list.itemCount ?? 0 }),
            })
          : ""
      }
      confirmLabel={t("recipe.shopping.action.delete")}
      destructive
      onConfirm={async () => {
        if (!list) return;
        try {
          await remove.mutateAsync(list.id);
          toast.success(t("recipe.shopping.delete.success", { name: list.name }));
        } catch (error) {
          toast.error(t("recipe.shopping.delete.error"), errorMessage(error));
          // Rethrow so ConfirmDialog keeps itself open on failure.
          throw error;
        }
      }}
    />
  );
}
