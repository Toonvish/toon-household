/**
 * The recipe module's web catalogs (SPEC D10, plan §2 Table E): one literal-typed `as const`
 * object per locale, spread from the six namespace files. NO type annotation on either object:
 * `modules/catalogs.ts` spreads them into `MODULE_CATALOGS_DE/EN`, and an index-signature type
 * here would widen `MessageKey` to `string` (see `modules/catalogs.ts`).
 */
import { cardsDe } from "./cards.de.ts";
import { cardsEn } from "./cards.en.ts";
import { importDe } from "./import.de.ts";
import { importEn } from "./import.en.ts";
import { organiseDe } from "./organise.de.ts";
import { organiseEn } from "./organise.en.ts";
import { planDe } from "./plan.de.ts";
import { planEn } from "./plan.en.ts";
import { recipesDe } from "./recipes.de.ts";
import { recipesEn } from "./recipes.en.ts";
import { shoppingDe } from "./shopping.de.ts";
import { shoppingEn } from "./shopping.en.ts";

export const recipeDe = {
  ...recipesDe,
  ...shoppingDe,
  ...planDe,
  ...importDe,
  ...cardsDe,
  ...organiseDe,
} as const;

export const recipeEn = {
  ...recipesEn,
  ...shoppingEn,
  ...planEn,
  ...importEn,
  ...cardsEn,
  ...organiseEn,
} as const;
