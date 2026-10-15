/**
 * The finance module's per-household settings row (`finance_settings`), which holds
 * what toon-finance kept on `households.default_locale` (plan M3 decision 2).
 *
 * Replaces F `services/households/households.service.ts#loadHouseholdRow` for the
 * ledger: the ported services read `household.defaultLocale` (the language
 * server-written ledger text is stored in, F gotcha 42 — never the request's locale)
 * and nothing else of F's household row, so `loadHouseholdRow` keeps its name and
 * returns `{ householdId, defaultLocale }`.
 */
import type { Locale } from "@toon/shared";
import { eq } from "drizzle-orm";
import { env } from "../../../../env.ts";
import { financeSettings } from "../../schema.ts";
import { nowMs } from "../../lib/clock.ts";
import type { DbLike } from "../support.ts";

export interface FinanceHouseholdRow {
  householdId: string;
  defaultLocale: Locale;
}

/**
 * The household's finance settings. A household without a `finance_settings` row (only
 * possible for one created before M3 that never enabled finance) reads the deployment
 * default — `ensureFinanceHousehold` writes the row on enable.
 */
export async function loadHouseholdRow(db: DbLike, householdId: string): Promise<FinanceHouseholdRow> {
  const rows = await db
    .select({ defaultLocale: financeSettings.defaultLocale })
    .from(financeSettings)
    .where(eq(financeSettings.householdId, householdId))
    .limit(1);
  return { householdId, defaultLocale: rows[0]?.defaultLocale ?? env.defaultLocale };
}

/** Writes the `finance_settings` row with `locale` unless the household has one already. */
export async function ensureFinanceSettings(db: DbLike, householdId: string, locale: Locale): Promise<void> {
  const timestamp = nowMs();
  await db
    .insert(financeSettings)
    .values({ householdId, defaultLocale: locale, createdAt: timestamp, updatedAt: timestamp })
    .onConflictDoNothing();
}
