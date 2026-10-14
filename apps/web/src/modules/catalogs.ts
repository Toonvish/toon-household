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
 * `./recipe/catalogs/index.ts` spreads the module's six namespace files (`recipe.*`) and
 * `./finance/catalogs/index.ts` the finance ones (`finance.*`), each as one more spread of the
 * literal objects.
 */
import { financeDe, financeEn } from "./finance/catalogs/index.ts";
import { recipeDe, recipeEn } from "./recipe/catalogs/index.ts";

export const MODULE_CATALOGS_DE = { ...recipeDe, ...financeDe } as const;
export const MODULE_CATALOGS_EN = { ...recipeEn, ...financeEn } as const;
