/**
 * German — namespace "home" (`core/features/home/**` and the shell's brand line).
 * The only genuinely NEW German of M0 (SPEC D10; docs/plans/m0-scaffold.md §1
 * decision 3). Every key is listed in `scripts/i18n-check.ts`'s `NEW_GERMAN`.
 */
import type { NamespaceCatalog } from "@toon/shared";

export const homeDe = {
  /** The brand line next to the logo in the sidebar. */
  "home.appName": "Haushalt",
  /** The Home tab / sidebar item. */
  "home.nav.label": "Start",
  "home.title": "Start",
  "home.empty.title": "Noch keine Module aktiviert",
  "home.empty.body": "Sobald ein Modul für diesen Haushalt aktiviert ist, erscheint es hier.",
  "home.eyebrow": "Haushalt",
  "home.modules.availableTitle": "Verfügbare Module",
  "home.modules.enable": "Aktivieren",
  "home.modules.memberHint": "Nur Administrator:innen und Besitzer:innen können Module aktivieren.",
  "home.modules.manage": "Module verwalten",
  "home.modules.manageDescription": "Module gelten für den ganzen Haushalt. Die Daten eines deaktivierten Moduls bleiben erhalten.",
  "home.modules.disable": "Deaktivieren",
  "home.modules.enabledToast": "Modul aktiviert",
  "home.modules.disabledToast": "Modul deaktiviert",
  "home.modules.disableConfirmTitle": "Modul deaktivieren?",
  "home.modules.disableConfirmDescription": "„{name}“ verschwindet für alle Mitglieder dieses Haushalts. Die Daten bleiben erhalten.",
  "home.moduleSwitcher.title": "Modul wechseln",
  "home.moduleSwitcher.label": "Module",
  "home.moduleDisabled.toast": "Dieses Modul ist für diesen Haushalt nicht aktiviert.",
} as const satisfies NamespaceCatalog<"home">;

export type HomeCatalog = typeof homeDe;
