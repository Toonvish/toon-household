/**
 * The 21 default categories seeded into every new household
 * (docs/ledger-spec.md §7.1, docs/spec.md §6.6). `slug` is the stable,
 * code-facing key; the display label always comes from the
 * `categories.name.<slug>` i18n catalog entry unless the household has
 * renamed the row (`customLabel` set) — see `apps/api/src/db/schema.ts`'s
 * `categories` table.
 *
 * `fixkosten` is system-owned: not deletable, not renameable, because the
 * fixed-cost plan books into it every month.
 */

export const DEFAULT_CATEGORY_SLUGS = [
  "tiere",
  "miete",
  "nebenkosten",
  "fixkosten",
  "versicherung",
  "steuern_abgaben",
  "baumarkt",
  "moebel_wohnen",
  "elektronik",
  "lebensmittel",
  "haushalt_kueche",
  "drogerie",
  "kleidung",
  "spiele_medien",
  "hobby_kreativ",
  "mobilitaet",
  "reisen",
  "freizeit",
  "geschenke",
  "ausgleich",
  "sonstiges",
] as const;

export type DefaultCategorySlug = (typeof DEFAULT_CATEGORY_SLUGS)[number];

/** The one category the fixed-cost plan writes into. Not deletable, not renameable. */
export const SYSTEM_CATEGORY_SLUG: DefaultCategorySlug = "fixkosten";

export function isSystemCategory(slug: string): boolean {
  return slug === SYSTEM_CATEGORY_SLUG;
}
