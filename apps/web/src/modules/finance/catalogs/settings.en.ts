import type { LocaleCatalog } from "@toon/shared";
import type { FinanceSettingsCatalog } from "./settings.de.ts";

export const financeSettingsEn: LocaleCatalog<FinanceSettingsCatalog> = {
  "finance.settings.household.title": "Household",
  "finance.settings.household.manage": "Manage household",
  "finance.settings.household.members": "Members",
  "finance.settings.household.you": "you",
  "finance.settings.household.joinedAt": "joined {date}",
  "finance.settings.household.displayName": "Display name",
  "finance.settings.household.invite": "Invite second person",
  "finance.settings.household.placeholderTitle": "Add without an account",
  "finance.settings.household.placeholderDescription":
    "Enter the second person by name only. You can book for them right away and link an account later.",
  "finance.settings.household.placeholderCreate": "Add person",
  "finance.settings.household.placeholderBadge": "no account",
  "finance.settings.household.placeholderHint": "Cannot sign in yet.",
  "finance.settings.household.placeholderRename": "Rename",
  "finance.settings.household.linkAccount": "Link an account for {name}",
  "finance.settings.household.linkAccountHint":
    "The link creates the account for this seat. All existing transactions stay with this person.",
  "finance.settings.household.linkAccountCreate": "Create link",
  "finance.settings.household.linkAccountLinkHint":
    "The link is valid for 14 days. Whoever opens it creates the account for this seat.",
};
