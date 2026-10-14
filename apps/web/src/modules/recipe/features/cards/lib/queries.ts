/**
 * TanStack Query hooks for saved cards.
 *
 * READ OFFLINE, WRITE ONLINE — and the asymmetry is the design, not a gap:
 *
 *  - the LIST is persisted (`shouldPersistQuery` in lib/persist.ts) and its query
 *    is `offlineFirst`, because a card is shown at a till where the phone may have
 *    no signal at all,
 *  - the MUTATIONS are ordinary online mutations with no offline queue. Saving a
 *    card is a deliberate, one-off action performed at home, so there is nothing to
 *    gain from an outbox — and a lot to lose: `setMutationDefaults` plus a
 *    client-minted idempotency token exist for the shopping list because items
 *    MERGE, and none of that machinery would be paying for itself here.
 *
 * That is why these screens use `useCanMutate()` (false offline) — the exact
 * opposite of the shopping screens, which must not.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Card, CreateCardRequest, UpdateCardRequest } from "@toon/shared";
import { createCard, deleteCard, markCardUsed, updateCard } from "@/modules/recipe/lib/api";
import { cardsQuery, invalidate, queryKeys } from "@/modules/recipe/lib/queries";

/** The user's wallet, unwrapped to `Card[]`, most recently used first. */
export function useCards() {
  return useQuery({ ...cardsQuery(), select: (response) => response.items });
}

export function useCreateCard() {
  const client = useQueryClient();
  return useMutation<Card, Error, CreateCardRequest>({
    mutationFn: async (input) => (await createCard(input)).card,
    onSuccess: async () => {
      await invalidate.cards(client);
    },
  });
}

export function useUpdateCard() {
  const client = useQueryClient();
  return useMutation<Card, Error, { cardId: string; patch: UpdateCardRequest }>({
    mutationFn: async ({ cardId, patch }) => (await updateCard(cardId, patch)).card,
    onSuccess: async () => {
      await invalidate.cards(client);
    },
  });
}

export function useDeleteCard() {
  const client = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (cardId) => deleteCard(cardId),
    onSuccess: async () => {
      await invalidate.cards(client);
    },
  });
}

/**
 * Records that a card was shown, which is what the wallet's ordering is built on.
 *
 * FIRE AND FORGET, and not a mutation at all. Three things can make this request
 * fail and none of them may reach the user: there is no signal at the till, the
 * account's address is unconfirmed (the server answers 403 to every write), or the
 * card was deleted on another device. The barcode is already on screen; a toast
 * about a sort order would be noise at the worst possible moment.
 *
 * The cache is patched locally so the reordering is visible even offline, and the
 * next successful list fetch overwrites it with the server's truth.
 */
export function useMarkCardUsed(): (cardId: string) => void {
  const client = useQueryClient();
  return (cardId: string) => {
    const shownAt = new Date().toISOString();
    client.setQueryData<{ items: Card[] }>(queryKeys.cards(), (current) =>
      current === undefined
        ? current
        : {
            items: current.items.map((card) =>
              card.id === cardId ? { ...card, lastUsedAt: shownAt } : card,
            ),
          },
    );
    void markCardUsed(cardId).catch(() => undefined);
  };
}
