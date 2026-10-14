/**
 * Free-text tags — normalised rows, never a JSON column (docs/spec.md §2.7).
 */

export const TAG_MAX_LENGTH = 40;

/**
 * `lower(trim(collapse whitespace))` — the merge key behind
 * `tags_household_name_key_uidx`, so `"Amazon"`, `"amazon"` and `" Amazon "`
 * all resolve to the same tag.
 */
export function normalizeTagName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Marks an imported lump-sum settlement row (the one `44 588,91 €` "Partner
 * überwiesen" transaction, docs/ledger-spec.md §6.6) so a chart can offer a
 * "hide aggregate bookings" toggle without it drowning out every other bar.
 */
export const SAMMELBUCHUNG_TAG = "sammelbuchung";
