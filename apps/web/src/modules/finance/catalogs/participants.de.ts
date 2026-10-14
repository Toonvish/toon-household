import type { NamespaceCatalog } from "@toon/shared";

/**
 * German — finance participants, enable flow and non-participant state (SPEC D10,
 * finance decision 11). ALL NEW COPY: none of these strings has a base-tree or
 * toon-finance counterpart, so every key is listed in `NEW_GERMAN` in
 * `scripts/i18n-check.ts`.
 */
export const financeParticipantsDe = {
  "finance.module.name": "Finanzen",
  "finance.participants.title": "Finanzen: Teilnehmende",
  "finance.participants.description":
    "Die Haushaltskasse rechnet zwischen genau zwei Personen ab. Platz 1 ist der Bezugspunkt des Saldos.",
  "finance.participants.slot1": "Platz 1",
  "finance.participants.slot2": "Platz 2",
  "finance.participants.save": "Teilnehmende speichern",
  "finance.participants.saved": "Teilnehmende gespeichert",
  "finance.participants.sameMember": "Bitte zwei verschiedene Personen wählen.",
  "finance.participants.adminOnly": "Nur Inhaber und Admins können die Teilnehmenden ändern.",
  "finance.participants.needsTwoMembers":
    "Für die Haushaltskasse braucht der Haushalt mindestens zwei Mitglieder. Lade zuerst jemanden ein.",
  "finance.participants.enableTitle": "Finanzen aktivieren",
  "finance.participants.notParticipantTitle": "Du nimmst an der Haushaltskasse nicht teil",
  "finance.participants.notParticipantBody":
    "Die Haushaltskasse dieses Haushalts führen {first} und {second}.",
  "finance.participants.notParticipantAdminHint":
    "Inhaber und Admins können die Teilnehmenden in den Einstellungen ändern.",
  "finance.participants.toSettings": "Zu den Einstellungen",
} as const satisfies NamespaceCatalog<"finance">;

export type FinanceParticipantsCatalog = typeof financeParticipantsDe;
