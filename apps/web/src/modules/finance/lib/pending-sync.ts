/**
 * Which paused mutations count as "waiting for transfer" in the finance module (M4 decision 7).
 * Finance's offline outbox is its transaction mutations (`TX_MUTATION_KEYS` in
 * `features/transactions/lib/offline.ts`: `["toon","finance","tx", …]`); a paused mutation under any
 * other namespace (recipe shopping, say) belongs to another module and is never counted here.
 * Pure on purpose, so the rule is testable without a QueryClient.
 */
const OUTBOX_PREFIX = ["toon", "finance", "tx"] as const;

export function isFinanceOutboxMutation(mutationKey: readonly unknown[] | undefined): boolean {
  if (!mutationKey || mutationKey.length < OUTBOX_PREFIX.length) return false;
  return OUTBOX_PREFIX.every((segment, index) => mutationKey[index] === segment);
}

export function countPendingFinanceSync(
  states: ReadonlyArray<{ mutationKey?: readonly unknown[]; isPaused: boolean }>,
): number {
  return states.filter((state) => state.isPaused && isFinanceOutboxMutation(state.mutationKey)).length;
}
