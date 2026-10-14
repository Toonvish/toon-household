/**
 * The finance module's web catalogs (SPEC D10, plan §2 Table E): one literal-typed `as const`
 * object per locale, spread from the eight namespace files. NO type annotation on either object:
 * `modules/catalogs.ts` spreads them into `MODULE_CATALOGS_DE/EN`, and an index-signature type
 * here would widen `MessageKey` to `string` (see `modules/catalogs.ts`).
 */
import { financeBalanceDe } from "./balance.de.ts";
import { financeBalanceEn } from "./balance.en.ts";
import { financeCategoriesDe } from "./categories.de.ts";
import { financeCategoriesEn } from "./categories.en.ts";
import { financeCommonDe } from "./common.de.ts";
import { financeCommonEn } from "./common.en.ts";
import { financeNavDe } from "./nav.de.ts";
import { financeNavEn } from "./nav.en.ts";
import { financeParticipantsDe } from "./participants.de.ts";
import { financeParticipantsEn } from "./participants.en.ts";
import { financePlanDe } from "./plan.de.ts";
import { financePlanEn } from "./plan.en.ts";
import { financeSettingsDe } from "./settings.de.ts";
import { financeSettingsEn } from "./settings.en.ts";
import { financeTransactionsDe } from "./transactions.de.ts";
import { financeTransactionsEn } from "./transactions.en.ts";

export const financeDe = {
  ...financeCommonDe,
  ...financeNavDe,
  ...financeTransactionsDe,
  ...financeCategoriesDe,
  ...financePlanDe,
  ...financeBalanceDe,
  ...financeSettingsDe,
  ...financeParticipantsDe,
} as const;

export const financeEn = {
  ...financeCommonEn,
  ...financeNavEn,
  ...financeTransactionsEn,
  ...financeCategoriesEn,
  ...financePlanEn,
  ...financeBalanceEn,
  ...financeSettingsEn,
  ...financeParticipantsEn,
} as const;
