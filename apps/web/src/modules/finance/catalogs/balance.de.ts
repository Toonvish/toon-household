import type { NamespaceCatalog } from "@toon/shared";

/**
 * `balance` — the balance never renders a raw sign; it always goes through
 * `balance.owesYou` / `balance.youOwe` / `balance.settled` (docs/spec.md §3.8).
 */
export const financeBalanceDe = {
  "finance.balance.title": "Saldo",
  "finance.balance.owesYou": "{name} schuldet dir {amount}",
  "finance.balance.youOwe": "Du schuldest {name} {amount}",
  "finance.balance.settled": "Ausgeglichen",
  "finance.balance.asOf": "Stand {date}",
  "finance.balance.details": "Details",
  "finance.balance.breakdown.title": "Woraus der Saldo besteht",
  "finance.balance.breakdown.split": "Geteilte Ausgaben",
  "finance.balance.breakdown.forOther": "Für {name} bezahlt",
  "finance.balance.breakdown.settled": "Bereits ausgeglichen",
  "finance.balance.breakdown.count": { one: "aus 1 Buchung", other: "aus {count} Buchungen" },
  "finance.balance.settle.action": "Jetzt ausgleichen",
  "finance.balance.settle.title": "Ausgleichszahlung",
  "finance.balance.settle.full": "Vollständig ausgleichen ({amount})",
  "finance.balance.settle.partial": "Anderer Betrag",
  "finance.balance.settle.amount": "Betrag",
  "finance.balance.settle.direction": "{from} zahlt an {to}",
  "finance.balance.settle.note": "Notiz",
  "finance.balance.settle.notePlaceholder": "z. B. Überweisung vom 09.08.",
  "finance.balance.settle.submit": "Ausgleich buchen",
  "finance.balance.settle.overpayHint": "Mehr als der Saldo — danach schuldet {name} dir Geld.",
  "finance.balance.settle.stale": "Der Saldo hat sich gerade geändert. Er steht jetzt bei {amount}.",
  "finance.balance.settle.staleAction": "Neu laden und weiter",
  "finance.balance.settle.done": "Ausgleich gebucht.",
  "finance.balance.month.title": "Dieser Monat",
  "finance.balance.month.total": "Ausgaben",
  "finance.balance.month.delta": "{amount} gegenüber dem Vormonat",
  "finance.balance.month.count": { one: "1 Buchung", other: "{count} Buchungen" },
  "finance.balance.byCategory.title": "Ausgaben nach Kategorie",
  "finance.balance.byCategory.other": "Sonstige",
  "finance.balance.byCategory.none": "Ohne Kategorie",
  "finance.balance.byCategory.empty": "In diesem Zeitraum gibt es keine Ausgaben.",
  "finance.balance.recent.title": "Zuletzt erfasst",
  "finance.balance.recent.all": "Alle Buchungen",
  "finance.balance.history.title": "Verlauf",
  "finance.balance.history.hideAggregates": "Sammelbuchungen ausblenden",
} as const satisfies NamespaceCatalog<"finance">;

export type FinanceBalanceCatalog = typeof financeBalanceDe;
