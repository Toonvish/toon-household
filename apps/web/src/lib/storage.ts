/**
 * Tiny typed localStorage wrapper. Private-mode Safari throws on access, so every
 * call is guarded and silently degrades to "no persistence".
 */

const PREFIX = "toon.";

export const storageKeys = {
  activeHouseholdId: `${PREFIX}activeHouseholdId`,
  theme: `${PREFIX}theme`,
  /** The device's chosen INTERFACE locale — see lib/i18n/locale.ts. */
  locale: `${PREFIX}locale`,
  installPromptDismissedAt: `${PREFIX}installPromptDismissedAt`,
  lastRecipeSort: `${PREFIX}recipeSort`,
  /**
   * Which shopping list a household last had open — the target of "add" actions that
   * don't otherwise know which list to use ("From this week's plan", a "Häufig
   * gekauft" chip tapped from `/shopping`). Stored as `"<householdId>:<listId>"`, the
   * same shape discipline as {@link activeHouseholdId}, so switching the active household
   * can never resolve to a foreign household's list id.
   */
  lastShoppingListId: `${PREFIX}lastShoppingListId`,
  /**
   * Which account the persisted offline cache belongs to (see lib/persist.ts).
   *
   * A POINTER, never data: it has to be readable synchronously at boot so an
   * offline start knows which IndexedDB blob to restore before any network call.
   * Cleared on logout, together with the blob itself.
   */
  lastUserId: `${PREFIX}lastUserId`,
} as const;

export function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — not fatal */
  }
}

export function readJsonStorage<T>(key: string, fallback: T): T {
  const raw = readStorage(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJsonStorage(key: string, value: unknown): void {
  try {
    writeStorage(key, JSON.stringify(value));
  } catch {
    /* not serialisable — ignore */
  }
}
