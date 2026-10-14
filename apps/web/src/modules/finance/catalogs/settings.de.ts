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
} as const satisfies NamespaceCatalog<"finance">;

export type FinanceSettingsCatalog = typeof financeSettingsDe;
