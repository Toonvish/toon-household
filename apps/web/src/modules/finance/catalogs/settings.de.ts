import type { NamespaceCatalog } from "@toon/shared";

/**
 * `settings.language.de` / `.en` are AUTONYMS and byte-identical in both
 * catalogs (docs/spec.md §6.9) — checked by `lib/i18n/i18n.test.ts`.
 */
export const financeSettingsDe = {
  "finance.settings.household.title": "Haushalt",
  "finance.settings.household.manage": "Haushalt verwalten",
  "finance.settings.household.members": "Mitglieder",
  "finance.settings.household.you": "du",
  "finance.settings.household.joinedAt": "dabei seit {date}",
  "finance.settings.household.displayName": "Anzeigename",
  "finance.settings.household.invite": "Zweite Person einladen",
  "finance.settings.household.placeholderTitle": "Ohne Konto hinzufügen",
  "finance.settings.household.placeholderDescription":
    "Trag die zweite Person nur mit Namen ein. Du kannst sofort für sie buchen; ein Konto verknüpfst du später.",
  "finance.settings.household.placeholderCreate": "Person eintragen",
  "finance.settings.household.placeholderBadge": "ohne Konto",
  "finance.settings.household.placeholderHint": "Kann sich noch nicht anmelden.",
  "finance.settings.household.placeholderRename": "Umbenennen",
  "finance.settings.household.linkAccount": "Konto für {name} verknüpfen",
  "finance.settings.household.linkAccountHint":
    "Der Link legt das Konto für diesen Platz an. Alle bisherigen Buchungen bleiben dieser Person zugeordnet.",
  "finance.settings.household.linkAccountCreate": "Link zum Verknüpfen erstellen",
  "finance.settings.household.linkAccountLinkHint":
    "Der Link gilt 14 Tage. Wer ihn öffnet, erstellt damit das Konto für diesen Platz.",
} as const satisfies NamespaceCatalog<"finance">;

export type FinanceSettingsCatalog = typeof financeSettingsDe;
