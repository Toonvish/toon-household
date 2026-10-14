/**
 * The four transaction kinds — labels, hints, live "what does this mean for
 * the balance" copy, and icons. One place, so `KindPicker`, `TransactionRow`
 * and the filter panel never invent their own strings (CLAUDE.md gotcha #26:
 * a label resolved once at import time would freeze on whichever locale
 * loaded first — every lookup here is a KEY, resolved through `t()` at
 * render time).
 */
import { ArrowLeftRight, Gift, HandCoins, Users, type LucideIcon } from "lucide-react";
import { halfForOther, type Translator, type TxKindValue } from "@toon/shared";
import type { CATALOGS } from "@/lib/i18n/catalogs/index.ts";
import type { MessageKey } from "@/lib/i18n";
import { formatCurrency } from "@/modules/finance/lib/format";

/** The exact catalog `useT()` binds against — kept local so this file needs no runtime import of the catalog data, only its type. */
type AppCatalog = typeof CATALOGS.de;

/** The four kinds, in the order the `KindPicker` 2x2 grid renders them (docs/spec.md §4.5). */
export const TX_KINDS: readonly TxKindValue[] = ["MINE_SPLIT", "THEIRS_SPLIT", "FOR_THEM", "TRANSFER"];

/** The most common kind on import (111 of 263 rows, docs/spec.md §4.5) — the form's default. */
export const DEFAULT_TX_KIND: TxKindValue = "MINE_SPLIT";

export const TX_KIND_LABEL_KEYS: Record<TxKindValue, MessageKey> = {
  MINE_SPLIT: "finance.transactions.kind.mineSplit.label",
  THEIRS_SPLIT: "finance.transactions.kind.theirsSplit.label",
  FOR_THEM: "finance.transactions.kind.forThem.label",
  TRANSFER: "finance.transactions.kind.transfer.label",
};

export const TX_KIND_HINT_KEYS: Record<TxKindValue, MessageKey> = {
  MINE_SPLIT: "finance.transactions.kind.mineSplit.hint",
  THEIRS_SPLIT: "finance.transactions.kind.theirsSplit.hint",
  FOR_THEM: "finance.transactions.kind.forThem.hint",
  TRANSFER: "finance.transactions.kind.transfer.hint",
};

const TX_KIND_EFFECT_KEYS: Record<TxKindValue, MessageKey> = {
  MINE_SPLIT: "finance.transactions.kind.mineSplit.effect",
  THEIRS_SPLIT: "finance.transactions.kind.theirsSplit.effect",
  FOR_THEM: "finance.transactions.kind.forThem.effect",
  TRANSFER: "finance.transactions.kind.transfer.effect",
};

export const TX_KIND_ICONS: Record<TxKindValue, LucideIcon> = {
  MINE_SPLIT: HandCoins,
  THEIRS_SPLIT: Users,
  FOR_THEM: Gift,
  TRANSFER: ArrowLeftRight,
};

/**
 * Renders a kind's label/hint/effect key with whatever placeholder values it
 * happens to need. The four catalog entries behind `TX_KIND_LABEL_KEYS` /
 * `TX_KIND_HINT_KEYS` / the effect keys do NOT all take the same
 * placeholders (`transfer.label` takes none, `theirsSplit.label` takes
 * `{name}`) — looked up through a `Record<TxKindValue, MessageKey>` the way
 * `nav-items.ts` does, `t()`'s per-literal placeholder check can no longer
 * see which one it is (the key type widens to the whole `MessageKey` union).
 * `lib/i18n/store.ts`'s `translate()` faces the exact same problem for the
 * exact same reason and resolves it the same way: cast the translator to a
 * loosely-typed callable at this one boundary, never inside a component's
 * own literal `t("...")` calls.
 */
export function translateKind(
  t: Translator<AppCatalog>,
  key: MessageKey,
  values: Record<string, string | number>,
): string {
  const call = t as unknown as (resolvedKey: string, resolvedValues: Record<string, string | number>) => string;
  return call(key, values);
}

/**
 * The live explain line under the `KindPicker` (docs/spec.md §4.5): "Ihr
 * teilt 12,50 € — Robin trägt 6,25 €." — recomputed on every keystroke from
 * `halfForOther`, never a second, independent rounding.
 */
export function kindEffectText(
  t: Translator<AppCatalog>,
  kind: TxKindValue,
  amountCents: number,
  otherName: string,
): string {
  const absoluteCents = Math.abs(amountCents);
  const shareCents = halfForOther(absoluteCents);
  return translateKind(t, TX_KIND_EFFECT_KEYS[kind], {
    amount: formatCurrency(absoluteCents),
    share: formatCurrency(shareCents),
    name: otherName,
  });
}
