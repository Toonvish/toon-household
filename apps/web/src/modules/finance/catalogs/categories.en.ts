import type { LocaleCatalog } from "@toon/shared";
import type { FinanceCategoriesCatalog } from "./categories.de.ts";

/**
 * English category names are taken verbatim from docs/ledger-spec.md §7.1 —
 * they are not invented here.
 */
export const financeCategoriesEn: LocaleCatalog<FinanceCategoriesCatalog> = {
  "finance.categories.title": "Categories",
  "finance.categories.description": "Categories organise your expenses. Tags are for anything finer.",
  "finance.categories.manage": "Manage categories",
  "finance.categories.add": "Add category",
  "finance.categories.label": "Label",
  "finance.categories.system": "System",
  "finance.categories.systemHint": "This category belongs to the fixed-cost plan and cannot be changed.",
  "finance.categories.hidden": "Hidden",
  "finance.categories.hide": "Hide",
  "finance.categories.show": "Show",
  "finance.categories.usage": { one: "1 transaction", other: "{count} transactions" },
  "finance.categories.renameHint": "After renaming, this category no longer follows the interface language.",
  "finance.categories.delete.title": "Delete category?",
  "finance.categories.delete.reassign": "Reassign transactions to",
  "finance.categories.delete.inUse": "{count} transactions use this category. Choose a target category.",
  "finance.categories.toast.created": "Category created.",
  "finance.categories.toast.updated": "Category saved.",
  "finance.categories.toast.deleted": "Category deleted.",
  "finance.categories.name.tiere": "Pets",
  "finance.categories.name.miete": "Rent",
  "finance.categories.name.nebenkosten": "Utilities",
  "finance.categories.name.fixkosten": "Fixed costs",
  "finance.categories.name.versicherung": "Insurance",
  "finance.categories.name.steuern_abgaben": "Taxes & fees",
  "finance.categories.name.baumarkt": "DIY & renovation",
  "finance.categories.name.moebel_wohnen": "Furniture & home",
  "finance.categories.name.elektronik": "Electronics",
  "finance.categories.name.lebensmittel": "Groceries",
  "finance.categories.name.haushalt_kueche": "Household & kitchen",
  "finance.categories.name.drogerie": "Drugstore & care",
  "finance.categories.name.kleidung": "Clothing & accessories",
  "finance.categories.name.spiele_medien": "Games & media",
  "finance.categories.name.hobby_kreativ": "Hobby & crafts",
  "finance.categories.name.mobilitaet": "Transport",
  "finance.categories.name.reisen": "Travel",
  "finance.categories.name.freizeit": "Leisure & going out",
  "finance.categories.name.geschenke": "Gifts & donations",
  "finance.categories.name.ausgleich": "Settlement & refunds",
  "finance.categories.name.sonstiges": "Other",
};
