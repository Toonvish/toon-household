export { I18nProvider, useT, useLocale, useLocalePreference } from "./I18nProvider.tsx";
export {
  translate,
  getLocale,
  setLocalePreference,
  refreshSystemLocale,
  setLocaleForTest,
  initLocale,
} from "./store.ts";
export {
  readStoredLocale,
  readLocalePreference,
  resolveDeviceLocale,
  resolveSystemLocale,
  applyDocumentLocale,
  type LocalePreference,
} from "./locale.ts";
export type { MessageKey } from "./catalogs/index.ts";
