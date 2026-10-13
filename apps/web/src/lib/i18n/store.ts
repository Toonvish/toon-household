/**
 * The ambient locale store: one module-level value, subscribers for React, and
 * the ONE place `localStorage`/`document`/the network are touched for a
 * locale change. `translate()` is for OUTSIDE React (lib/api.ts fallbacks,
 * toasts fired from event handlers, thrown messages, ErrorBoundary); a
 * component must use `useT()`/`useLocale()` from `I18nProvider.tsx` so it
 * re-renders on a switch (§7/§10 rule 6).
 */
import { createTranslator, DEFAULT_LOCALE, type Locale, type MessageValues } from "@toon/shared";
import { updateProfile } from "@/lib/api";
import { storageKeys, writeStorage } from "@/lib/storage";
import { CATALOGS, type MessageKey } from "./catalogs/index.ts";
import { applyDocumentLocale, resolveSystemLocale, type LocalePreference } from "./locale.ts";

let currentLocale: Locale = DEFAULT_LOCALE;
const subscribers = new Set<() => void>();

/** Current ambient locale. Read once — a component wanting re-renders uses `useLocale()`. */
export function getLocale(): Locale {
  return currentLocale;
}

export function subscribeLocale(callback: () => void): () => void {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

function notify(): void {
  for (const callback of subscribers) callback();
}

/**
 * Seeds the store AND `<html lang>` from a resolved device locale. Called ONCE
 * from main.tsx before the first render. Deliberately does NOT write storage
 * and does NOT PATCH the API — it is reading a preference, not setting one.
 */
export function initLocale(locale: Locale): void {
  currentLocale = locale;
  applyDocumentLocale(locale);
}

/**
 * The user action: writes `localStorage`, updates the store (re-render),
 * updates `<html lang>`, and — best-effort, fire-and-forget — mirrors the
 * choice onto the account so mail follows. A failed PATCH is not fatal (the UI
 * already switched) and MUST stay fire-and-forget: queueing it as a TanStack
 * mutation would pause it offline for no benefit (`shouldPersistMutation`
 * would not even persist it) and risks an unhandled rejection in airplane
 * mode.
 *
 * `"system"` REMOVES the stored key rather than storing a resolved locale, so
 * the device keeps following the browser afterwards (same encoding as
 * `ThemePreference`). The PATCH still sends the RESOLVED locale, never `null`:
 * `users.locale` exists only so mail can pick a language, and a server that
 * cannot see `navigator.languages` needs the concrete answer. The cost is that
 * mail goes stale if the device language later changes while the preference is
 * `"system"` — mail only, and it re-syncs the next time the picker is touched.
 */
export function setLocalePreference(preference: LocalePreference): void {
  const effective = preference === "system" ? resolveSystemLocale() : preference;
  currentLocale = effective;
  writeStorage(storageKeys.locale, preference === "system" ? null : preference);
  applyDocumentLocale(effective);
  notify();
  void updateProfile({ locale: effective }).catch(() => undefined);
}

/**
 * Re-resolves the active locale from the browser/OS. Only meaningful while the
 * preference is `"system"`; called by `useLocalePreference()` on the
 * `languagechange` event. Writes no storage and fires no PATCH — the device
 * changed, the user did not choose anything.
 */
export function refreshSystemLocale(): void {
  const effective = resolveSystemLocale();
  if (effective === currentLocale) return;
  currentLocale = effective;
  applyDocumentLocale(effective);
  notify();
}

/**
 * DOM-free seam for `bun test` (no `localStorage`/`document`/network there).
 * Store only, no side effects. A test that calls this MUST reset it in
 * `afterAll` (`setLocaleForTest(null)` is not meaningful — reset to
 * `DEFAULT_LOCALE`), same rule as `setMailer`/`setOcrEngine`: `bun test` runs
 * every file in one process and a module-global left on `en` is inherited by
 * every later file.
 */
export function setLocaleForTest(locale: Locale): void {
  currentLocale = locale;
}

/**
 * Renders a key OUTSIDE React, at the CURRENT ambient locale (see file doc).
 *
 * Deliberately looser than `useT()`: inferring the exact placeholder set for
 * an ambient, not-yet-known locale would need the same generic machinery
 * `Translator<C>` gives a single fixed catalog, for marginal benefit at the
 * handful of call sites this is for. `useT()` inside components keeps the
 * full compile-time placeholder check; this is the escape hatch, not the rule.
 */
export function translate(key: MessageKey, values?: MessageValues): string {
  return createTranslator(CATALOGS[currentLocale], currentLocale)(key as never, values as never);
}
