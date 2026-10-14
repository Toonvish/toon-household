import type { NamespaceCatalog } from "@toon/shared";

/**
 * `plan.bookingDescription` and `plan.adjustmentDescription` are the only two
 * keys here the SERVER also renders (into `transactions.description`, in
 * `households.defaultLocale`, docs/spec.md §6.7) — the web app renders them
 * like any other key otherwise.
 */
export const financePlanDe = {
  "finance.plan.title": "Fixkostenplan",
  "finance.plan.description":
    "Aus euren Einkommen und den festen Kosten wird jeden Monat automatisch der Anteil von {name} gebucht.",
  "finance.plan.enabled": "Plan aktiv",
  "finance.plan.disabledHint": "Der Fixkostenplan ist aus. Trag Fixkosten und Einkommen ein, dann kann er buchen.",
  "finance.plan.setup": "Fixkosten einrichten",
  "finance.plan.payer": "Wer zahlt die Fixkosten?",
  "finance.plan.startPeriod": "Erste Buchung ab",
  "finance.plan.costTotal": "Fixkosten gesamt",
  "finance.plan.incomeTotal": "Einkommen gesamt",
  "finance.plan.quote": "Quote",
  "finance.plan.quoteHint": "{cost} von {income} — {percent} des gemeinsamen Einkommens.",
  "finance.plan.shareOther": "{name} zahlt",
  "finance.plan.sharePayer": "{name} trägt",
  "finance.plan.sharePayerYou": "Du trägst",
  "finance.plan.monthly": "Monatsanteil",
  "finance.plan.nextBooking": "Nächste Buchung: {period}",
  "finance.plan.lastBooked": "Zuletzt gebucht: {period}",
  "finance.plan.pendingNotice": {
    one: "1 Monat ist noch nicht gebucht.",
    other: "{count} Monate sind noch nicht gebucht.",
  },
  "finance.plan.run": "Jetzt buchen",
  "finance.plan.toast.run": { one: "1 Monat gebucht.", other: "{count} Monate gebucht." },
  "finance.plan.toast.nothingToDo": "Alles bereits gebucht.",
  "finance.plan.items.title": "Fixkosten",
  "finance.plan.items.add": "Position hinzufügen",
  "finance.plan.items.label": "Bezeichnung",
  "finance.plan.items.amount": "Betrag pro Monat",
  "finance.plan.items.activeFrom": "Gültig ab",
  "finance.plan.items.activeTo": "Gültig bis",
  "finance.plan.items.open": "offen",
  "finance.plan.items.validity": "{from} bis {to}",
  "finance.plan.items.validityOpen": "ab {from}",
  "finance.plan.items.supersedeHint":
    "Betrag geändert? Beende die alte Position und leg eine neue an — so bleibt jeder Monat nachvollziehbar.",
  "finance.plan.items.supersede": "Alte Position beenden und neue anlegen",
  "finance.plan.items.empty": "Noch keine Fixkosten eingetragen.",
  "finance.plan.incomes.title": "Einkommen",
  "finance.plan.incomes.add": "Einkommen hinzufügen",
  "finance.plan.incomes.person": "Person",
  "finance.plan.incomes.amount": "Netto pro Monat",
  "finance.plan.incomes.validFrom": "Gültig ab",
  "finance.plan.incomes.validTo": "Gültig bis",
  "finance.plan.incomes.empty": "Für mindestens eine Person fehlt das Einkommen.",
  "finance.plan.periods.title": "Gebuchte Monate",
  "finance.plan.periods.pending": "offen",
  "finance.plan.periods.empty": "Noch nichts gebucht.",
  "finance.plan.recalculate.title": "Neuberechnung",
  "finance.plan.recalculate.description":
    "Prüft alle gebuchten Monate gegen die heutigen Daten. Gebuchte Monate werden nie geändert — Abweichungen entstehen als Korrekturbuchung.",
  "finance.plan.recalculate.preview": "Vorschau berechnen",
  "finance.plan.recalculate.period": "Monat",
  "finance.plan.recalculate.booked": "gebucht",
  "finance.plan.recalculate.recomputed": "neu berechnet",
  "finance.plan.recalculate.delta": "Differenz",
  "finance.plan.recalculate.total": "Summe der Korrekturen",
  "finance.plan.recalculate.confirm": "Korrekturen buchen",
  "finance.plan.recalculate.none": "Keine Abweichung. Alle gebuchten Monate stimmen.",
  "finance.plan.recalculate.done": {
    one: "1 Korrektur gebucht.",
    other: "{count} Korrekturen gebucht.",
  },
  "finance.plan.lastRun": "Letzter Lauf: {date}",
  "finance.plan.lastRunResult": "{booked} gebucht, {skipped} übersprungen",
  "finance.plan.error.incomplete":
    "Für diese Berechnung fehlen Angaben: mindestens eine Fixkostenposition und für beide Personen ein Einkommen.",
  "finance.plan.error.disabled": "Der Fixkostenplan ist nicht aktiv.",
  "finance.plan.bookingDescription": "Fixkostenanteil {period}",
  "finance.plan.adjustmentDescription": "Korrektur Fixkostenanteil {period}",
} as const satisfies NamespaceCatalog<"finance">;

export type FinancePlanCatalog = typeof financePlanDe;
