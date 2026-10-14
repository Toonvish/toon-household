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
 * TIME: the module clock `./lib/clock.ts` is the ONLY time source here (every
 * `created_at`/`updated_at` and the plan's `start_period`), never the wall clock directly
 * or the core helper, so a test that calls `setClockForTest` before creating a household
 * pins the plan's start period exactly as in toon-finance.
 */
import { currentPeriod, FinanceEnableSettingsSchema, isLocale, type Locale } from "@toon/shared";
import { eq } from "drizzle-orm";
import { households, users } from "../../db/schema.ts";
import { env } from "../../env.ts";
import { ApiError } from "../../lib/errors.ts";
import type { DbExecutor } from "../types.ts";
import { nowMs } from "./lib/clock.ts";
import { financeCategories, financeFixedCostPlans, financeParticipants } from "./schema.ts";
import { defaultCategorySeeds } from "./services/categories/defaults.ts";
import { assignParticipants, slot1UserId } from "./services/participants/participants.service.ts";
import { ensureFinanceSettings } from "./services/settings/settings.service.ts";
import type { DbLike } from "./services/support.ts";

/** Inserts the 21 default categories unless the household already has a category. */
export async function seedDefaultCategories(tx: DbLike, householdId: string): Promise<void> {
  const existing = await tx
    .select({ id: financeCategories.id })
    .from(financeCategories)
    .where(eq(financeCategories.householdId, householdId))
    .limit(1);
  if (existing.length > 0) return;
  const timestamp = nowMs();
  await tx.insert(financeCategories).values(
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
  );
}

/** The creator's `users.locale` when it is `de`/`en`, else the deployment default. */
async function creatorLocale(tx: DbLike, householdId: string): Promise<Locale> {
  const rows = await tx
    .select({ locale: users.locale })
    .from(households)
    .innerJoin(users, eq(users.id, households.createdBy))
    .where(eq(households.id, householdId))
    .limit(1);
  const locale = rows[0]?.locale;
  return isLocale(locale) ? locale : env.defaultLocale;
}

/** `onHouseholdCreated`: categories + `finance_settings` on every new household (SPEC §2). */
export async function onFinanceHouseholdCreated(householdId: string, tx: DbExecutor): Promise<void> {
  await seedDefaultCategories(tx, householdId);
  await ensureFinanceSettings(tx, householdId, await creatorLocale(tx, householdId));
}

/**
 * Completes a household for the ledger (idempotent): the default categories if it has
 * none, the `finance_settings` row, and the fixed-cost plan row if missing (`enabled:
 * false`, `payer_id` = the slot-1 participant, `start_period` = the module clock's current
 * period — F `createHousehold`). Requires a slot-1 participant.
 */
export async function ensureFinanceHousehold(tx: DbLike, householdId: string): Promise<void> {
  await seedDefaultCategories(tx, householdId);
  await ensureFinanceSettings(tx, householdId, await creatorLocale(tx, householdId));
  const plans = await tx
    .select({ householdId: financeFixedCostPlans.householdId })
    .from(financeFixedCostPlans)
    .where(eq(financeFixedCostPlans.householdId, householdId))
    .limit(1);
  if (plans.length > 0) return;
  const timestamp = nowMs();
  await tx.insert(financeFixedCostPlans).values({
    householdId,
    enabled: false,
    payerId: await slot1UserId(tx, householdId),
    startPeriod: currentPeriod(timestamp),
    lastBookedPeriod: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

function participantsRequired(): ApiError {
  return new ApiError(422, "finance_participants_required", "server.finance.participantsRequired");
}

/**
 * `onEnable`. Settings carrying `participants` must parse as `FinanceEnableSettingsSchema`
 * and are applied with the PUT rules (`assignParticipants`); a malformed `participants`
 * value is refused like a missing one. Without `participants`, the household must already
 * have its two participant rows (a re-enable after a disable, D2). The core stores the
 * settings JSON in `household_modules.settings`; finance never reads it back
 * (`finance_participants` is the truth).
 */
export async function onFinanceEnable(householdId: string, settings: unknown, tx: DbExecutor): Promise<void> {
  const hasParticipants = typeof settings === "object" && settings !== null && "participants" in settings;
  if (hasParticipants) {
    const parsed = FinanceEnableSettingsSchema.safeParse(settings);
    if (!parsed.success) throw participantsRequired();
    await assignParticipants(tx, householdId, parsed.data.participants);
  } else {
    const seated = await tx
      .select({ memberSlot: financeParticipants.memberSlot })
      .from(financeParticipants)
      .where(eq(financeParticipants.householdId, householdId));
    if (seated.length !== 2) throw participantsRequired();
  }
  await ensureFinanceHousehold(tx, householdId);
}
