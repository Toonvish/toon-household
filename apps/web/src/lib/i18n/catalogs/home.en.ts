/**
 * English — namespace "home". See `home.de.ts` for who owns this file.
 */
import type { LocaleCatalog } from "@toon/shared";
import type { HomeCatalog } from "./home.de.ts";

export const homeEn: LocaleCatalog<HomeCatalog> = {
  "home.appName": "Household",
  "home.nav.label": "Home",
  "home.title": "Home",
  "home.empty.title": "No modules enabled yet",
  "home.empty.body": "Once a module is enabled for this household, it shows up here.",
  "home.eyebrow": "Household",
  "home.modules.availableTitle": "Available modules",
  "home.modules.enable": "Enable",
  "home.modules.memberHint": "Only admins and owners can enable modules.",
  "home.modules.manage": "Manage modules",
  "home.modules.manageDescription": "Modules apply to the whole household. A disabled module keeps its data.",
  "home.modules.disable": "Disable",
  "home.modules.enabledToast": "Module enabled",
  "home.modules.disabledToast": "Module disabled",
  "home.modules.disableConfirmTitle": "Disable module?",
  "home.modules.disableConfirmDescription": "“{name}” disappears for every member of this household. Its data is kept.",
  "home.moduleSwitcher.title": "Switch module",
  "home.moduleSwitcher.label": "Modules",
  "home.moduleDisabled.toast": "This module is not enabled for this household.",
};
