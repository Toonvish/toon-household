/**
 * Device-level locale resolution + `<html lang>` — the browser/DOM concerns
 * that `packages/shared/src/i18n` cannot own (that package is pure, no
 * `window`/`document`/`localStorage`).
 */
import { DEFAULT_LOCALE, isLocale, type Locale } from "@toon/shared";
import { readStorage, storageKeys } from "@/lib/storage";

/**
 * What the user chose, which is NOT the same thing as the active locale:
 * `"system"` means "keep following the browser/OS", so it resolves to a
 * different `Locale` when the device language changes. Mirrors
 * `ThemePreference` in `lib/theme.ts` deliberately — same three-state shape,
 * same "absent from storage means system" encoding, so the two settings cards
 * behave identically.
 */
export type LocalePreference = Locale | "system";

/** The device's stored preference, or `null` if it has never chosen one. */
export function readStoredLocale(): Locale | null {
  const stored = readStorage(storageKeys.locale);
  return isLocale(stored) ? stored : null;
}

/**
 * The stored preference as the three-state value the UI shows. Absent storage
 * is `"system"`, not `DEFAULT_LOCALE`: those are different states, and
 * collapsing them is what would make the picker show "Deutsch" to someone who
 * has never chosen anything and is only seeing German because their phone is.
 */
export function readLocalePreference(): LocalePreference {
  return readStoredLocale() ?? "system";
}

/**
 * What the BROWSER/OS asks for, ignoring any stored preference — the default
 * this app starts from. `navigator.languages` is in the user's own preference
 * order, so the first supported entry wins; `DEFAULT_LOCALE` is only reached
 * when the device asks for nothing we speak.
 */
export function resolveSystemLocale(): Locale {
  if (typeof navigator !== "undefined") {
    for (const tag of navigator.languages ?? [navigator.language]) {
      const primary = tag?.split("-")[0]?.toLowerCase();
      if (primary && isLocale(primary)) return primary;
    }
  }
  return DEFAULT_LOCALE;
}

/**
 * `localStorage["toon.locale"] -> navigator.languages -> DEFAULT_LOCALE` (§6).
 * Never writes anything — it READS a preference; `setLocalePreference()` is
 * what SETS one.
 */
export function resolveDeviceLocale(): Locale {
  return readStoredLocale() ?? resolveSystemLocale();
}

/** Sets `<html lang>` — the one DOM side effect a locale change owns. */
export function applyDocumentLocale(locale: Locale): void {
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale;
  }
}
