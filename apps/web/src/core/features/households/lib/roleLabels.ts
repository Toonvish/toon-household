/**
 * Role labels as translator keys, so they resolve at render time under the
 * active locale (docs/i18n.md §10 rule 8) instead of freezing at import time
 * the way `lib/format.ts`'s old `roleLabels` map did. The map's KEYS
 * (`owner`/`admin`/`member`) are the wire values and stay locked; only the
 * label moves into the catalog.
 */
import type { HouseholdRole } from "@toon/shared";
import type { MessageKey } from "@/lib/i18n";

export const ROLE_LABEL_KEYS: Record<HouseholdRole, MessageKey> = {
  owner: "household.role.owner",
  admin: "household.role.admin",
  member: "household.role.member",
};
