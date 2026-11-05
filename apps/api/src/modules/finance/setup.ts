/**
 * The finance module's household hooks (SPEC §2, plan M3 decision 4) — what toon-finance's
 * `services/households/households.service.ts#createHousehold` seeded into every fresh
 * household (the 21 default categories, the disabled fixed-cost plan row, the household
 * locale), split along H's lifecycle:
 *
 * - `onFinanceHouseholdCreated` runs for EVERY new household, finance enabled or not: the
 *   21 categories and the `finance_settings` row (locale = the creator's, else the
 *   deployment default).
 * - `onFinanceEnable` runs when a household enables finance: it seats the two participants
 *   from the enable settings, or requires two existing ones (a re-enable keeps its data,
 *   D2), else refuses with `422 finance_participants_required` — before the core writes
 *   the `household_modules` row, so a refusal writes nothing.
 * - `ensureFinanceHousehold` completes a household for the ledger: the categories (for a
 *   household created before M3), the settings row and the plan row (`enabled: false`,
 *   payer = slot 1, start period = the current period).
 *
 * AS A SERVICE (docs/EFFECT.md E7, E12; plan `docs/plans/e4-finance-services.md` P2, P5, P6, P7). `FinanceSetup` keeps
 * the old function names with the leading executor parameter dropped; it reads the current executor of `Database` on
 * every call (inside the core's transaction for a hook: the manifest runs it through `withFinanceServices`, `./layer.ts`),
 * the deployment default locale from `AppConfig`, and refuses with the API error family (same status, code and text).
 *
 * TIME: the module clock `./lib/clock.ts` is the ONLY time source here (every
 * `created_at`/`updated_at` and the plan's `start_period`; `financeTimeMillis`: the `setClockForTest` override, else
 * the `Clock`), never the wall clock directly or the core helper, so a test that calls `setClockForTest` before
 * creating a household pins the plan's start period exactly as in toon-finance.
 */
import { currentPeriod, FinanceEnableSettingsSchema, isLocale } from "@toon/shared";
import { eq } from "drizzle-orm";
import { Context, Effect, Layer, Option, Predicate } from "effect";
import { AppConfig } from "../../config.ts";
import { Database } from "../../db/database.ts";
import { households, users } from "../../db/schema.ts";
import { ApiFailure } from "../../lib/errors.ts";
import type { Conflict, DatabaseError, Internal, ValidationFailed } from "../../lib/errors.ts";
import { decodeOption } from "../../lib/validate.ts";
import { financeTimeMillis } from "./lib/clock.ts";
import { financeCategories, financeFixedCostPlans, financeParticipants } from "./schema.ts";
import { defaultCategorySeeds } from "./services/categories/defaults.ts";
import { FinanceParticipants } from "./services/participants/participants.service.ts";
import { FinanceSettings } from "./services/settings/settings.service.ts";

/** `422 finance_participants_required` without details (the enable hook's refusal). */
function participantsRequired(): ApiFailure {
  return new ApiFailure({
    status: 422,
    code: "finance_participants_required",
    text: "server.finance.participantsRequired",
  });
}

/** The household hooks of the finance module: categories, settings, the plan row, the enable gate. */
export class FinanceSetup extends Context.Service<
  FinanceSetup,
  {
    /** Inserts the 21 default categories unless the household already has a category. */
    readonly seedDefaultCategories: (householdId: string) => Effect.Effect<void, DatabaseError>;
    /** `onHouseholdCreated`: categories + `finance_settings` on every new household (SPEC §2). */
    readonly onFinanceHouseholdCreated: (householdId: string) => Effect.Effect<void, DatabaseError>;
    /**
     * Completes a household for the ledger (idempotent): the default categories if it has
     * none, the `finance_settings` row, and the fixed-cost plan row if missing (`enabled:
     * false`, `payer_id` = the slot-1 participant, `start_period` = the module clock's current
     * period — F `createHousehold`). Requires a slot-1 participant.
     */
    readonly ensureFinanceHousehold: (householdId: string) => Effect.Effect<void, Internal | DatabaseError>;
    /**
     * `onEnable`. Settings carrying `participants` must parse as `FinanceEnableSettingsSchema`
     * and are applied with the PUT rules (`assignParticipants`); a malformed `participants`
     * value is refused like a missing one. Without `participants`, the household must already
     * have its two participant rows (a re-enable after a disable, D2). The core stores the
     * settings JSON in `household_modules.settings`; finance never reads it back
     * (`finance_participants` is the truth).
     */
    readonly onFinanceEnable: (
      householdId: string,
      settings: unknown,
    ) => Effect.Effect<void, ApiFailure | ValidationFailed | Conflict | Internal | DatabaseError>;
  }
>()("toon/api/modules/finance/setup/FinanceSetup") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const database = yield* Database;
      const config = yield* AppConfig;
      const participants = yield* FinanceParticipants;
      const settings = yield* FinanceSettings;

      const seedDefaultCategories = Effect.fn("FinanceSetup.seedDefaultCategories")(function* (householdId: string) {
        const existing = yield* database.use((db) =>
          db
            .select({ id: financeCategories.id })
            .from(financeCategories)
            .where(eq(financeCategories.householdId, householdId))
            .limit(1),
        );
        if (existing.length > 0) return;
        const timestamp = yield* financeTimeMillis;
        yield* database.use((db) =>
          db.insert(financeCategories).values(
            defaultCategorySeeds().map((seed) => ({
              id: crypto.randomUUID(),
              householdId,
              slug: seed.slug,
              customLabel: null,
              isSystem: seed.isSystem,
              isHidden: false,
              position: seed.position,
              createdAt: timestamp,
              updatedAt: timestamp,
            })),
          ),
        );
      });

      /** The creator's `users.locale` when it is `de`/`en`, else the deployment default. */
      const creatorLocale = Effect.fnUntraced(function* (householdId: string) {
        const rows = yield* database.use((db) =>
          db
            .select({ locale: users.locale })
            .from(households)
            .innerJoin(users, eq(users.id, households.createdBy))
            .where(eq(households.id, householdId))
            .limit(1),
        );
        const locale = rows[0]?.locale;
        return isLocale(locale) ? locale : config.defaultLocale;
      });

      const onFinanceHouseholdCreated = Effect.fn("FinanceSetup.onFinanceHouseholdCreated")(function* (
        householdId: string,
      ) {
        yield* seedDefaultCategories(householdId);
        yield* settings.ensureFinanceSettings(householdId, yield* creatorLocale(householdId));
      });

      const ensureFinanceHousehold = Effect.fn("FinanceSetup.ensureFinanceHousehold")(function* (householdId: string) {
        yield* seedDefaultCategories(householdId);
        yield* settings.ensureFinanceSettings(householdId, yield* creatorLocale(householdId));
        const plans = yield* database.use((db) =>
          db
            .select({ householdId: financeFixedCostPlans.householdId })
            .from(financeFixedCostPlans)
            .where(eq(financeFixedCostPlans.householdId, householdId))
            .limit(1),
        );
        if (plans.length > 0) return;
        const timestamp = yield* financeTimeMillis;
        const payerId = yield* participants.slot1UserId(householdId);
        yield* database.use((db) =>
          db.insert(financeFixedCostPlans).values({
            householdId,
            enabled: false,
            payerId,
            startPeriod: currentPeriod(timestamp),
            lastBookedPeriod: null,
            createdAt: timestamp,
            updatedAt: timestamp,
          }),
        );
      });

      const onFinanceEnable = Effect.fn("FinanceSetup.onFinanceEnable")(function* (
        householdId: string,
        enableSettings: unknown,
      ) {
        if (Predicate.hasProperty(enableSettings, "participants")) {
          const parsed = decodeOption(FinanceEnableSettingsSchema, enableSettings);
          if (Option.isNone(parsed)) return yield* participantsRequired();
          yield* participants.assignParticipants(householdId, parsed.value.participants);
        } else {
          const seated = yield* database.use((db) =>
            db
              .select({ memberSlot: financeParticipants.memberSlot })
              .from(financeParticipants)
              .where(eq(financeParticipants.householdId, householdId)),
          );
          if (seated.length !== 2) return yield* participantsRequired();
        }
        yield* ensureFinanceHousehold(householdId);
      });

      return FinanceSetup.of({
        seedDefaultCategories,
        onFinanceHouseholdCreated,
        ensureFinanceHousehold,
        onFinanceEnable,
      });
    }),
  );
}
