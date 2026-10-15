/**
 * Pure helpers of the grouped transaction list (toon-finance 00ea694, gotchas
 * 61 and 64). No React, no i18n: `TransactionList` and `TransactionRow` feed
 * them and render the result.
 */
import type { TransactionResponse } from "@toon/shared";

export interface DayGroup {
  /** `YYYY-MM-DD`, the UTC calendar day of `bookedAt`. */
  key: string;
  items: TransactionResponse[];
  /** Plain sum of `amountCents` in integer cents (see `groupByDay`). */
  totalCents: number;
}

/** Calendar-day grouping key from an ISO timestamp. */
export function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Groups items by `bookedAt` day, keeping first-seen order (items already arrive
 * sorted `-bookedAt`, so this only has to detect boundaries) and the order of
 * the items inside a day.
 *
 * The day total is the plain sum of `amountCents`, settlements included: it is
 * "what moved on this day", not "what we consumed". The expenses-only view
 * lives on the overview (`isExpense`, ledger-spec §2.3); mixing the two
 * definitions in one app is how a ledger stops adding up. Integer cents only.
 */
export function groupByDay(items: readonly TransactionResponse[]): DayGroup[] {
  const map = new Map<string, DayGroup>();
  for (const item of items) {
    const key = dayKey(item.bookedAt);
    const group = map.get(key);
    if (group) {
      group.items.push(item);
      group.totalCents += item.amountCents;
    } else {
      map.set(key, { key, items: [item], totalCents: item.amountCents });
    }
  }
  return [...map.values()];
}

export interface MetaPart<N> {
  key: string;
  node: N;
}

export type JoinedMetaPart<N> = { kind: "part"; key: string; node: N } | { kind: "separator"; key: string };

/**
 * Puts a separator BETWEEN parts, never after one (gotcha 64): a separator
 * appended to a part in the hope that something follows ends a phone row on a
 * lone "·". Zero or one part yields no separator at all.
 */
export function joinMetaParts<N>(parts: readonly MetaPart<N>[]): JoinedMetaPart<N>[] {
  const out: JoinedMetaPart<N>[] = [];
  parts.forEach((part, index) => {
    if (index > 0) out.push({ kind: "separator", key: `sep-${part.key}` });
    out.push({ kind: "part", key: part.key, node: part.node });
  });
  return out;
}
