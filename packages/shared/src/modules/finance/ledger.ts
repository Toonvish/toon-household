/**
 * The pure ledger: how a transaction stores "who paid, how it's split", how
 * that projects onto the four UI kinds, and how a set of transactions
 * resolves to a single balance (docs/ledger-spec.md §2, §5.1-5.2).
 *
 * A transaction never stores "mine"/"theirs" — it stores `payerId` +
 * `splitMode`. With exactly two household members "the other person" is
 * unambiguous, so there is no `beneficiaryId` and there must never be one.
 */
import { halfForOther } from "./money.ts";

export type SplitMode = "SPLIT_EQUAL" | "OTHER_ONLY" | "SETTLEMENT";

/** The four kinds the create/edit flow and the list filter offer. */
export type TxKind = "MINE_SPLIT" | "THEIRS_SPLIT" | "FOR_THEM" | "TRANSFER";

export interface StoredSplit {
  payerId: string;
  splitMode: SplitMode;
}

/**
 * Translates a create/edit request's `kind` into the symmetric storage shape.
 * Runs SERVER-SIDE only, against the viewer resolved from the session
 * (`viewerId`) and the other household member (`otherId`) — never trust a
 * client-picked payer, and this is exactly why an offline-replayed mutation
 * stays correct regardless of who is logged in when it is finally sent.
 */
export function kindToStorage(kind: TxKind, viewerId: string, otherId: string): StoredSplit {
  switch (kind) {
    case "MINE_SPLIT":
      return { payerId: viewerId, splitMode: "SPLIT_EQUAL" };
    case "THEIRS_SPLIT":
      return { payerId: otherId, splitMode: "SPLIT_EQUAL" };
    case "FOR_THEM":
      return { payerId: viewerId, splitMode: "OTHER_ONLY" };
    case "TRANSFER":
      return { payerId: otherId, splitMode: "SETTLEMENT" };
  }
}

/**
 * Projects a stored `(payerId, splitMode)` back onto one of the four UI
 * kinds, FROM `viewerId`'s perspective. Reading the same row from the other
 * login flips the projection automatically, with no data migration.
 *
 * Two storage shapes have no creation button and therefore no name in the
 * four-kind enum, so this returns `null` for them rather than inventing a
 * fifth wire value:
 *  - `payerId = other, splitMode = OTHER_ONLY` — "the other person paid,
 *    100% mine" (importable data; a fifth button `THEIRS_FOR_ME` would cost
 *    zero schema changes if it is ever added).
 *  - `payerId = viewer, splitMode = SETTLEMENT` — the reverse settlement
 *    direction, created by `POST /settlements` when the viewer is the debtor.
 *
 * Callers that must render every row (the transaction list) fall back to a
 * splitMode+payer-based label for `null`; callers that only care about the
 * four created kinds (the `kind` query filter) treat `null` as "no match".
 */
export function projectKind(tx: StoredSplit, viewerId: string): TxKind | null {
  const payerIsViewer = tx.payerId === viewerId;
  if (tx.splitMode === "SPLIT_EQUAL") return payerIsViewer ? "MINE_SPLIT" : "THEIRS_SPLIT";
  if (tx.splitMode === "OTHER_ONLY") return payerIsViewer ? "FOR_THEM" : null;
  return payerIsViewer ? null : "TRANSFER";
}

/**
 * `splitMode !== 'SETTLEMENT'` — settlements are debt movement, not spend
 * (docs/ledger-spec.md §2.3). Excluded from category totals, monthly spend
 * and "how much did we spend on Tiere". One exported predicate, never an
 * ad-hoc filter at each call site.
 */
export function isExpense(tx: { splitMode: SplitMode }): boolean {
  return tx.splitMode !== "SETTLEMENT";
}

export interface BalanceTransaction {
  payerId: string;
  splitMode: SplitMode;
  amountCents: number;
}

/**
 * One transaction's signed contribution to the balance, expressed for
 * `person1Id`. **Positive = the other person owes `person1Id`.** See
 * docs/ledger-spec.md §2.3:
 *
 * | splitMode    | payer = person1Id   | payer = the other person |
 * | ------------ | ------------------- | ------------------------- |
 * | SPLIT_EQUAL  | `+halfForOther(a)`  | `-halfForOther(a)`         |
 * | OTHER_ONLY   | `+a`                | `-a`                       |
 * | SETTLEMENT   | `+a`                | `-a`                       |
 *
 * `SETTLEMENT` and `OTHER_ONLY` are arithmetically identical — they differ
 * only in reporting, via {@link isExpense}.
 */
export function deltaForTransaction(tx: BalanceTransaction, person1Id: string): number {
  const sign = tx.payerId === person1Id ? 1 : -1;
  const owedByOther = tx.splitMode === "SPLIT_EQUAL" ? halfForOther(tx.amountCents) : tx.amountCents;
  return sign * owedByOther;
}

/**
 * The balance's sub-totals, mirroring `BalanceResponse.breakdown` on the wire
 * (`schemas/balance.ts`) so the API can return exactly this shape without a
 * second derivation.
 */
export interface BalanceBreakdown {
  /** Same sign convention as `balanceCents`: positive = the other person owes `person1Id`. */
  balanceCents: number;
  /** Signed sum of `halfForOther` over `SPLIT_EQUAL` rows. */
  splitOtherCents: number;
  /** Signed sum of `OTHER_ONLY` rows. */
  forOtherCents: number;
  /** Signed sum of `SETTLEMENT` rows. */
  settledCents: number;
  transactionCount: number;
}

/**
 * The balance and its sub-totals for `person1Id`, computed from scratch.
 * Pure, total, order-independent, integer-exact — see
 * `computeBalance is order-independent` / `is antisymmetric` in
 * `test/ledger.test.ts`.
 */
export function computeBreakdown(
  txs: readonly BalanceTransaction[],
  person1Id: string,
): BalanceBreakdown {
  let splitOtherCents = 0;
  let forOtherCents = 0;
  let settledCents = 0;
  for (const tx of txs) {
    const delta = deltaForTransaction(tx, person1Id);
    if (tx.splitMode === "SPLIT_EQUAL") splitOtherCents += delta;
    else if (tx.splitMode === "OTHER_ONLY") forOtherCents += delta;
    else settledCents += delta;
  }
  return {
    balanceCents: splitOtherCents + forOtherCents + settledCents,
    splitOtherCents,
    forOtherCents,
    settledCents,
    transactionCount: txs.length,
  };
}

/** `computeBreakdown(...).balanceCents` — the balance alone, for call sites that don't need the breakdown. */
export function computeBalance(txs: readonly BalanceTransaction[], person1Id: string): number {
  return computeBreakdown(txs, person1Id).balanceCents;
}
