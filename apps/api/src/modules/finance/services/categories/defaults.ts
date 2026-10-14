/**
 * The 21 default categories seeded into every new household
 * (docs/spec.md §2.6, ledger-spec.md §7.1). `DEFAULT_CATEGORY_SLUGS` (order =
 * seed position) and `SYSTEM_CATEGORY_SLUG` are the pure facts, exported from
 * `@toon/shared` so the importer ([IMPORT]) can reuse them without depending
 * on `apps/api`; this module only adds the DB-row shape around them.
 */
import { DEFAULT_CATEGORY_SLUGS, type DefaultCategorySlug, SYSTEM_CATEGORY_SLUG } from "@toon/shared";

export interface DefaultCategorySeed {
  slug: DefaultCategorySlug;
  position: number;
  isSystem: boolean;
}

/** One seed row per default slug, in seed order — what `seedDefaultCategories` (setup.ts) inserts. */
export function defaultCategorySeeds(): DefaultCategorySeed[] {
  return DEFAULT_CATEGORY_SLUGS.map((slug, position) => ({
    slug,
    position,
    isSystem: slug === SYSTEM_CATEGORY_SLUG,
  }));
}
