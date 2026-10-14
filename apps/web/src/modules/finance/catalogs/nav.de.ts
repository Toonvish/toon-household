import type { NamespaceCatalog } from "@toon/shared";

export const financeNavDe = {
  "finance.nav.overview": "Übersicht",
  "finance.nav.transactions": "Buchungen",
  "finance.nav.create": "Erfassen",
  "finance.nav.profile": "Profil",
  "finance.nav.plan": "Fixkosten",
  "finance.nav.categories": "Kategorien",
  "finance.nav.household": "Haushalt",
} as const satisfies NamespaceCatalog<"finance">;

export type FinanceNavCatalog = typeof financeNavDe;
