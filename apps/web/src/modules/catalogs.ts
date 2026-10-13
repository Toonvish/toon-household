/**
 * The module catalog registry for the web i18n layer (SPEC D10, §2 `catalogs`).
 *
 * It imports ONLY each module's `catalogs/*.ts` files — never a module's `index.ts`
 * manifest, which imports routes and screens that import `@/lib/i18n` again (plan §1
 * decision 6: the circular-import guard).
 *
 * BOTH OBJECTS MUST STAY LITERAL-TYPED. `lib/i18n/catalogs/index.ts` spreads them into
 * the merged catalog whose `keyof` is `MessageKey`; an annotation such as
 * a string-keyed record type, an unprefixed `NamespaceCatalog`, a `Partial` or any other
 * index-signature type widens `MessageKey` to `string`, and every `t()` typo compiles.
 * No type annotation, ever — let inference keep the literal keys.
 *
 * M2/M3 extend it as the spread of the modules' literal catalogs (the intersection of
 * their literal types):
 *
 *   import { recipeDe } from "./recipe/catalogs/recipe.de.ts";
 *   import { financeDe } from "./finance/catalogs/finance.de.ts";
 *   export const MODULE_CATALOGS_DE = { ...recipeDe, ...financeDe } as const;
 *   (and MODULE_CATALOGS_EN likewise with recipeEn / financeEn)
 */
export const MODULE_CATALOGS_DE = {} as const;
export const MODULE_CATALOGS_EN = {} as const;
