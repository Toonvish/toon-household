/**
 * The finance module's per-household settings row (`finance_settings`), which holds
 * what toon-finance kept on `households.default_locale` (plan M3 decision 2).
 *
 * Replaces F `services/households/households.service.ts#loadHouseholdRow` for the
 * ledger: the ported services read `household.defaultLocale` (the language
 * server-written ledger text is stored in, F gotcha 42, never the request's locale)
 * and nothing else of F's household row, so `loadHouseholdRow` keeps its name and
 * returns `{ householdId, defaultLocale }`.
 *
 * AS A SERVICE (docs/EFFECT.md E7; plan `docs/plans/e4-finance-services.md` P2, P6). `FinanceSettings` reads the
 * deployment default from `AppConfig` (yielded at build) and the time from the module clock on every call.
 */
import type { Locale } from "@toon/shared";
import { eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { AppConfig } from "../../../../config.ts";
import { Database } from "../../../../db/database.ts";
import type { DatabaseError } from "../../../../lib/errors.ts";
import { runFinanceBridge } from "../../bridge.ts";
import { financeTimeMillis } from "../../lib/clock.ts";
import { financeSettings } from "../../schema.ts";
import type { DbLike } from "../support.ts";

export interface FinanceHouseholdRow {
  householdId: string;
  defaultLocale: Locale;
}

/** The finance module's per-household settings row. */
export class FinanceSettings extends Context.Service<
  FinanceSettings,
  {
    /**
     * The household's finance settings. A household without a `finance_settings` row (only possible for one created
     * before M3 that never enabled finance) reads the deployment default: `ensureFinanceHousehold` writes the row on
     * enable.
     */
    readonly loadHouseholdRow: (householdId: string) => Effect.Effect<FinanceHouseholdRow, DatabaseError>;
    /** Writes the `finance_settings` row with `locale` unless the household has one already. */
    readonly ensureFinanceSettings: (householdId: string, locale: Locale) => Effect.Effect<void, DatabaseError>;
  }
>()("toon/api/modules/finance/services/settings/settings.service/FinanceSettings") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const database = yield* Database;
      const config = yield* AppConfig;

      const loadHouseholdRow = Effect.fn("FinanceSettings.loadHouseholdRow")(function* (householdId: string) {
        const rows = yield* database.use((db) =>
          db
            .select({ defaultLocale: financeSettings.defaultLocale })
            .from(financeSettings)
            .where(eq(financeSettings.householdId, householdId))
            .limit(1),
        );
        return { householdId, defaultLocale: rows[0]?.defaultLocale ?? config.defaultLocale };
      });

      const ensureFinanceSettings = Effect.fn("FinanceSettings.ensureFinanceSettings")(function* (
        householdId: string,
        locale: Locale,
      ) {
        const timestamp = yield* financeTimeMillis;
        yield* database.use((db) =>
          db
            .insert(financeSettings)
            .values({ householdId, defaultLocale: locale, createdAt: timestamp, updatedAt: timestamp })
            .onConflictDoNothing(),
        );
      });

      return FinanceSettings.of({ loadHouseholdRow, ensureFinanceSettings });
    }),
  );
}

/* legacy bridges: callers listed; E3 (recipe), E4 (finance), E5 (scripts) remove them */

/** Callers: `services/ledger/settlements.service.ts` (E4-T04), `services/plan/accrual.service.ts` (E4-T06). */
export function loadHouseholdRow(db: DbLike, householdId: string): Promise<FinanceHouseholdRow> {
  return runFinanceBridge(FinanceSettings.use((service) => service.loadHouseholdRow(householdId)), db);
}

/** Callers: `setup.ts` (E4-T07). */
export function ensureFinanceSettings(db: DbLike, householdId: string, locale: Locale): Promise<void> {
  return runFinanceBridge(FinanceSettings.use((service) => service.ensureFinanceSettings(householdId, locale)), db);
}
