/**
 * Which shopping list a screen picks without asking (R9, plus the household's primary list).
 *
 * The household's primary list (`isPrimary`, "Hauptliste", set on the overview's card menu) wins everywhere it
 * applies: first in the `/recipe/shopping` overview, the Home card's link and the preselected target when a
 * recipe or the week plan is added. Without one, each screen keeps its earlier rule: the last-opened list
 * (`storageKeys.lastShoppingListId`, `<householdId>:<listId>`), then alphabetical order.
 *
 * Pure apart from reading the storage key; imported by `HomeCard.tsx` (the manifest's static graph), so it imports
 * neither the module registry nor the shell.
 */
import { foldText } from "@toon/shared";
import { readStorage, storageKeys } from "@/lib/storage";

interface ListLike {
  id: string;
  name: string;
  isPrimary?: boolean | undefined;
}

/** The household's primary list, if one is set and present. */
export function primaryShoppingList<T extends Pick<ListLike, "id" | "isPrimary">>(lists: readonly T[]): T | undefined {
  return lists.find((list) => list.isPrimary === true);
}

/** The id of the list last opened in this household on this device, or `null`. */
export function lastOpenedShoppingListId(householdId: string): string | null {
  const saved = readStorage(storageKeys.lastShoppingListId);
  if (!saved) return null;
  const [savedHouseholdId, savedListId] = saved.split(":");
  return savedHouseholdId === householdId && savedListId ? savedListId : null;
}

/**
 * The default target when adding to a list: the primary list, then the last-opened one, then the alphabetically
 * first (`localeCompare` in German, as before). `null` without lists.
 */
export function defaultTargetList<T extends ListLike>(householdId: string, lists: readonly T[]): T | null {
  const primary = primaryShoppingList(lists);
  if (primary) return primary;
  const lastId = lastOpenedShoppingListId(householdId);
  const last = lastId ? lists.find((list) => list.id === lastId) : undefined;
  if (last) return last;
  return [...lists].sort((a, b) => a.name.localeCompare(b.name, "de"))[0] ?? null;
}

/**
 * The overview's stacking order (R46): the primary list, then the last-opened one, then every other list by its
 * FOLDED name (`foldText`: "Äpfel" must not sort after "Z").
 */
export function orderShoppingListsForOverview<T extends ListLike>(householdId: string, lists: readonly T[]): T[] {
  const primary = primaryShoppingList(lists);
  const lastId = lastOpenedShoppingListId(householdId);
  const last = lastId && lastId !== primary?.id ? lists.find((list) => list.id === lastId) : undefined;
  const head = [primary, last].filter((list): list is T => list !== undefined);
  const rest = lists
    .filter((list) => !head.includes(list))
    .sort((a, b) => foldText(a.name).localeCompare(foldText(b.name)) || a.name.localeCompare(b.name));
  return [...head, ...rest];
}
