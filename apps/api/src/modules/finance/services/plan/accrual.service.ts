/**
 * The monthly run: books the non-payer's income-proportional share of the
 * fixed costs as one `OTHER_ONLY` transaction per period, strictly idempotent
 * per `(household_id, external_key)` (docs/spec.md §3.7, ledger-spec.md
 * §4.3-§4.6). Also owns `recalculate` — booked periods are immutable, so a
 * retroactive data change produces a NEW adjustment transaction, never an
 * edit of the old one.
 *
 * AS A SERVICE (docs/EFFECT.md E5, E6, E7, E12; plan `docs/plans/e4-finance-services.md` P2, P6, P7, P10). `FinanceAccrual`
 * keeps the old function names with the leading `db` parameter dropped (`runCatchUp`, `runPlanNow`, `recalculatePlan`);
 * the booking and `lastBookedPeriod` share ONE `database.transaction`, the time is the module clock
 * (`financeTimeMillis`, so a `TestClock` drives the stamps), and a refusal is a member of the API error family. The
 * catch-all of the booking transaction stays a catch-all: `Effect.catchCause` sees a typed failure, a defect and a
 * rejection alike (CLAUDE.md "Catch-all stays catch-all"). The legacy bridges at the end keep the Promise functions
 * the routes, the seed and `apps/api/scripts/plan-run.ts` still call.
 */
import type { RecalculatePlanResponse, RunPlanResponse, TransactionResponse } from "@toon/shared";
import { comparePeriods, computePlanForPeriod, currentPeriod, periodStartMs, periodsInclusive, serverText } from "@toon/shared";
import { and, eq, isNotNull } from "drizzle-orm";
import { Cause, Context, Effect, Layer, Predicate } from "effect";
import type { Database as DrizzleDatabase } from "../../../../db/client.ts";
import { Database } from "../../../../db/database.ts";
import {
  type FinanceAccrualRunRow as AccrualRunRow,
  financeAccrualRuns as accrualRuns,
  financeFixedCostPlans as fixedCostPlans,
  financeTransactions as transactions,
} from "../../schema.ts";
import { Conflict, isDatabaseError } from "../../../../lib/errors.ts";
import type { DatabaseError, Internal } from "../../../../lib/errors.ts";
import { runFinanceBridge } from "../../bridge.ts";
import { financeTimeMillis } from "../../lib/clock.ts";
import { FinanceCategories } from "../categories/categories.service.ts";
import { FinanceParticipants } from "../participants/participants.service.ts";
import { FinanceSettings } from "../settings/settings.service.ts";
import { FinanceTransactions } from "../ledger/transactions.service.ts";
import { FinanceTags } from "../tags/tags.service.ts";
import { catchUpRange, isPlanComputable, periodAsMonthSlashYear } from "./period-scan.ts";
import { FinancePlan, toAccrualRunResponse } from "./plan.service.ts";

/** The fixed-cost plan books into this category (docs/spec.md §2.6, §3.7). */
const PLAN_CATEGORY_SLUG = "fixkosten";

export interface RunCatchUpOptions {
  trigger: AccrualRunRow["trigger"];
  /** Only honoured when it is BEFORE the current period — a run never books the future. */
  through?: string;
  /** `POST …/plan/run`: true (409 `plan_disabled`). Boot/interval ticks: false (silently a no-op). */
  requireEnabled: boolean;
  /** `POST …/plan/run`: true (409 `plan_incomplete` when nothing at all could be booked). Boot/interval ticks: false. */
  throwOnIncomplete: boolean;
}

export interface RunCatchUpResult {
  bookedPeriods: string[];
  skippedPeriods: string[];
  bookedCents: number;
  run: AccrualRunRow;
}

export interface RecalculationLine {
  period: string;
  bookedCents: number;
  recomputedCents: number;
  deltaCents: number;
}

/** What every method of the accrual can fail with. */
type AccrualError = Conflict | Internal | DatabaseError;

/** The monthly fixed-cost booking: the catch-up loop, the manual run and the retroactive recalculation. */
export class FinanceAccrual extends Context.Service<
  FinanceAccrual,
  {
    /**
     * The catch-up loop (ledger-spec.md §4.5). Booking + `lastBookedPeriod` run inside ONE `database.transaction`; the
     * `accrual_runs` audit row is written AFTER that transaction settles (success OR the domain "nothing bookable"
     * case) so a `plan_incomplete` raised to the caller never rolls back an audit trail that already reflects what
     * actually happened. A genuinely unexpected failure inside the transaction still gets an audit row (`error` set to
     * the error's name only, never its message) before it is raised again.
     */
    readonly runCatchUp: (householdId: string, options: RunCatchUpOptions) => Effect.Effect<RunCatchUpResult, AccrualError>;
    /** `POST …/plan/run`. */
    readonly runPlanNow: (householdId: string, through?: string) => Effect.Effect<RunPlanResponse, AccrualError>;
    /** `POST …/plan/recalculate` (ledger-spec.md §4.6). */
    readonly recalculatePlan: (
      householdId: string,
      viewerId: string,
      dryRun: boolean,
    ) => Effect.Effect<RecalculatePlanResponse, AccrualError>;
  }
>()("toon/api/modules/finance/services/plan/accrual.service/FinanceAccrual") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const database = yield* Database;
      const categories = yield* FinanceCategories;
      const settings = yield* FinanceSettings;
      const participants = yield* FinanceParticipants;
      const ledger = yield* FinanceTransactions;
      const tags = yield* FinanceTags;
      const plans = yield* FinancePlan;

      const recordRun = Effect.fnUntraced(function* (
        householdId: string,
        trigger: AccrualRunRow["trigger"],
        fromPeriod: string | null,
        toPeriod: string | null,
        periodsBooked: number,
        periodsSkipped: number,
        bookedCents: number,
        error: string | null,
        startedAt: number,
      ) {
        const id = crypto.randomUUID();
        const finishedAt = yield* financeTimeMillis;
        yield* database.use((db) =>
          db.insert(accrualRuns).values({
            id,
            householdId,
            trigger,
            fromPeriod,
            toPeriod,
            periodsBooked,
            periodsSkipped,
            bookedCents,
            error,
            startedAt,
            finishedAt,
          }),
        );
        const run: AccrualRunRow = {
          id,
          householdId,
          trigger,
          fromPeriod,
          toPeriod,
          periodsBooked,
          periodsSkipped,
          bookedCents,
          error,
          startedAt,
          finishedAt,
        };
        return run;
      });

      const runCatchUp = Effect.fn("FinanceAccrual.runCatchUp")(function* (householdId: string, options: RunCatchUpOptions) {
        const startedAt = yield* financeTimeMillis;
        const plan = yield* plans.loadPlanRow(householdId);

        if (options.requireEnabled && !plan.enabled) {
          return yield* new Conflict({ code: "plan_disabled", text: "server.plan.disabled" });
        }
        if (!plan.enabled) {
          const run = yield* recordRun(householdId, options.trigger, null, null, 0, 0, 0, null, startedAt);
          const result: RunCatchUpResult = { bookedPeriods: [], skippedPeriods: [], bookedCents: 0, run };
          return result;
        }

        const nowPeriod = currentPeriod(yield* financeTimeMillis);
        const { from, to } = catchUpRange(plan.startPeriod, plan.lastBookedPeriod, nowPeriod, options.through);

        if (comparePeriods(from, to) > 0) {
          const run = yield* recordRun(householdId, options.trigger, null, null, 0, 0, 0, null, startedAt);
          const result: RunCatchUpResult = { bookedPeriods: [], skippedPeriods: [], bookedCents: 0, run };
          return result;
        }

        const otherId = yield* participants.otherMemberId(householdId, plan.payerId);
        const candidatePeriods = periodsInclusive(from, to);

        const outcome = yield* database
          .transaction(
            Effect.gen(function* () {
              if (!otherId) {
                // No second member yet — nothing can be booked as OTHER_ONLY for them.
                return {
                  bookedPeriods: [] as string[],
                  skippedPeriods: candidatePeriods,
                  bookedCents: 0,
                  allIncomplete: candidatePeriods.length > 0,
                };
              }

              const { items, incomeRows } = yield* plans.listPlanInputRows(householdId);
              const household = yield* settings.loadHouseholdRow(householdId);
              const categoryId = yield* categories.categoryIdBySlug(householdId, PLAN_CATEGORY_SLUG);

              const bookedPeriods: string[] = [];
              const skippedPeriods: string[] = [];
              let bookedCents = 0;
              // true once a period is skipped for lack of data (ledger-spec.md §4.5's
              // "gap"). `lastBookedPeriod` must never advance PAST such a period —
              // otherwise the next run's `catchUpRange` starts after it and the gap
              // can never be booked again, even once the missing data is filled in
              // (docs/spec.md's "catch-up books every missed period" would silently
              // stop being true). A period skipped for any OTHER reason (already
              // covered by an import, or a genuine zero share) is fully resolved, so
              // it is safe to advance past as long as no real gap came before it.
              let dataGapSeen = false;
              // true once at least one candidate period resolved to *something* —
              // covered, zero-share, or booked. Stays false only when EVERY candidate
              // failed `isPlanComputable`, which is the one case `plan_incomplete`
              // (`throwOnIncomplete`) should actually fire for.
              let anyResolved = false;
              let lastBooked = plan.lastBookedPeriod;

              for (const period of candidatePeriods) {
                // Already occupied by ANY origin — most commonly the one-time xlsx
                // import's rent series (`xlsx:rent:<period>`, ledger-spec.md §4.7).
                // Its `externalKey` lives in a different namespace than
                // `fixedplan:{hh}:{period}`, so the unique index below would never
                // catch this on its own — without this check the period would be
                // booked TWICE, once by the import and once by this loop.
                if (yield* plans.isPeriodBooked(householdId, period)) {
                  skippedPeriods.push(period);
                  anyResolved = true;
                  if (!dataGapSeen) lastBooked = period;
                  continue;
                }

                if (!isPlanComputable(items, incomeRows, period, plan.payerId, otherId)) {
                  skippedPeriods.push(period);
                  dataGapSeen = true;
                  continue;
                }
                anyResolved = true;

                const computation = computePlanForPeriod({ period, items, incomes: incomeRows, payerId: plan.payerId, otherId });
                if (computation.bookableCents === 0) {
                  skippedPeriods.push(period);
                  if (!dataGapSeen) lastBooked = period;
                  continue;
                }

                const id = crypto.randomUUID();
                const timestamp = yield* financeTimeMillis;
                const description = serverText(household.defaultLocale, {
                  key: "server.content.planBookingDescription",
                  values: { period: periodAsMonthSlashYear(period) },
                });
                const inserted = yield* database.use((db) =>
                  db
                    .insert(transactions)
                    .values({
                      id,
                      householdId,
                      payerId: plan.payerId,
                      splitMode: "OTHER_ONLY",
                      amountCents: computation.bookableCents,
                      description,
                      categoryId,
                      bookedAt: periodStartMs(period),
                      dateSource: "exact",
                      origin: "fixed_plan",
                      planPeriod: period,
                      categorySource: "system",
                      importSeq: null,
                      externalKey: `fixedplan:${householdId}:${period}`,
                      createdBy: null,
                      createdAt: timestamp,
                      updatedAt: timestamp,
                    })
                    .onConflictDoNothing({ target: [transactions.householdId, transactions.externalKey] })
                    .returning({ id: transactions.id }),
                );

                if (inserted.length > 0) {
                  yield* tags.syncTransactionTags(householdId, id, ["fixkosten", "auto"]);
                  bookedPeriods.push(period);
                  bookedCents += computation.bookableCents;
                  if (!dataGapSeen) lastBooked = period;
                } else {
                  // Another concurrent run already booked this exact period.
                  skippedPeriods.push(period);
                  if (!dataGapSeen) lastBooked = period;
                }
              }

              const updatedAt = yield* financeTimeMillis;
              yield* database.use((db) =>
                db.update(fixedCostPlans).set({ lastBookedPeriod: lastBooked, updatedAt }).where(eq(fixedCostPlans.householdId, householdId)),
              );

              return { bookedPeriods, skippedPeriods, bookedCents, allIncomplete: !anyResolved && candidatePeriods.length > 0 };
            }),
          )
          .pipe(
            Effect.catchCause((cause) =>
              Effect.gen(function* () {
                // An interruption (shutdown) is not a failure of the run: nothing to log, nothing to record.
                if (Cause.hasInterruptsOnly(cause)) return yield* Effect.failCause(cause);
                // `accrual_runs.error` is read by both participants via `GET …/plan/runs`. A driver error's
                // message is the failed SQL WITH its bound parameters, so only the error's name goes into the
                // row; the full text goes to the log (toon-finance 1715207, gotcha 73).
                const squashed = Cause.squash(cause);
                const original = isDatabaseError(squashed) ? squashed.cause : squashed;
                yield* Effect.sync(() => console.error(`[plan] catch-up failed for household ${householdId}:`, original));
                const marker = Predicate.isError(original) ? `${original.name}: see server log` : "unknown error: see server log";
                yield* recordRun(householdId, options.trigger, from, to, 0, 0, 0, marker, startedAt);
                return yield* Effect.failCause(cause);
              }),
            ),
          );

        const run = yield* recordRun(
          householdId,
          options.trigger,
          from,
          to,
          outcome.bookedPeriods.length,
          outcome.skippedPeriods.length,
          outcome.bookedCents,
          null,
          startedAt,
        );

        if (options.throwOnIncomplete && outcome.bookedPeriods.length === 0 && outcome.allIncomplete) {
          return yield* new Conflict({ code: "plan_incomplete", text: "server.plan.incomplete" });
        }

        const result: RunCatchUpResult = {
          bookedPeriods: outcome.bookedPeriods,
          skippedPeriods: outcome.skippedPeriods,
          bookedCents: outcome.bookedCents,
          run,
        };
        return result;
      });

      const runPlanNow = Effect.fn("FinanceAccrual.runPlanNow")(function* (householdId: string, through?: string) {
        const result = yield* runCatchUp(householdId, { trigger: "manual", through, requireEnabled: true, throwOnIncomplete: true });
        const response: RunPlanResponse = {
          bookedPeriods: result.bookedPeriods,
          skippedPeriods: result.skippedPeriods,
          bookedCents: result.bookedCents,
          run: toAccrualRunResponse(result.run),
        };
        return response;
      });

      /**
       * `POST …/plan/recalculate` (ledger-spec.md §4.6). Every already-booked
       * `fixed_plan` period is recomputed against TODAY's items/incomes; a
       * difference produces a preview line, and — unless `dryRun` — a NEW
       * `fixed_plan_adjustment` transaction (never an edit of the booked row).
       * `externalKey` encodes the superseded amount, so re-running against
       * unchanged data collides (no-op) while a second correction gets its own key.
       *
       * "Superseded amount" means the EFFECTIVE booked amount — the original
       * `fixed_plan` row PLUS every `fixed_plan_adjustment` already booked for that
       * same period — not the original row alone. A second retroactive correction
       * of the same period must diff against what the first correction left
       * behind, otherwise its `externalKey` collides with the first adjustment's
       * (both would encode the same original amount) and `onConflictDoNothing`
       * silently drops it: `applied: true` but `adjustments: []`, and the ledger
       * never learns about the second change at all (ledger-spec.md §4.6).
       *
       * The candidate set is NOT "every period that has a `fixed_plan` row". A
       * period whose share came out as exactly 0 writes no row at all (`runCatchUp`'s
       * `bookableCents === 0` branch) and still advances `lastBookedPeriod`, so a
       * row-driven recalculation cannot see it and the catch-up loop never returns
       * to it either — a later income/item correction that turns that share non-zero
       * would be lost for good, with no API path back. `[startPeriod,
       * lastBookedPeriod]` — every period a run has already walked past — is
       * therefore part of the candidate set, and a period with no plan row simply
       * diffs against 0.
       *
       * Each period is recomputed for the payer THAT PERIOD was booked under, read
       * off its own row (`payerByPeriod`), never `plan.payerId`. That column is
       * mutable via `PATCH …/plan { payerId }` and carries no history, so using it
       * for a historical month would recompute January under whoever pays today: the
       * two incomes swap places in `share(other) = income × costTotal / incomeTotal`,
       * every already-booked period reports a delta that corresponds to no change in
       * the data, and the household gets a full set of adjustments the moment it
       * decides the other person takes over the fixed costs. Periods with no plan row
       * (a share of exactly 0) have no payer of record and fall back to the plan's.
       */
      const recalculatePlan = Effect.fn("FinanceAccrual.recalculatePlan")(function* (
        householdId: string,
        viewerId: string,
        dryRun: boolean,
      ) {
        const plan = yield* plans.loadPlanRow(householdId);
        if (!plan.enabled) return yield* new Conflict({ code: "plan_disabled", text: "server.plan.disabled" });

        const { items, incomeRows } = yield* plans.listPlanInputRows(householdId);

        // Every row claiming a plan period, in ONE query, partitioned by origin:
        // `fixed_plan` + `fixed_plan_adjustment` together are the EFFECTIVE booked
        // amount, while ANY other origin (the one-time xlsx rent series, a manual
        // row carrying a planPeriod) means the plan deliberately never booked that
        // month — `runCatchUp`'s `isPeriodBooked` skip — and must not start now.
        const periodRows = yield* database.use((db) =>
          db
            .select({
              planPeriod: transactions.planPeriod,
              origin: transactions.origin,
              amountCents: transactions.amountCents,
              payerId: transactions.payerId,
            })
            .from(transactions)
            .where(and(eq(transactions.householdId, householdId), isNotNull(transactions.planPeriod))),
        );

        const bookedByPeriod = new Map<string, number>();
        const adjustmentSumByPeriod = new Map<string, number>();
        const foreignPeriods = new Set<string>();
        // The payer OF RECORD per period, read off the row the plan actually wrote.
        // `plan.payerId` is the payer of TODAY, not of that month.
        const payerByPeriod = new Map<string, string>();
        for (const row of periodRows) {
          const period = row.planPeriod;
          if (!period) continue;
          if (row.origin === "fixed_plan") {
            bookedByPeriod.set(period, (bookedByPeriod.get(period) ?? 0) + row.amountCents);
            payerByPeriod.set(period, row.payerId);
          } else if (row.origin === "fixed_plan_adjustment") {
            adjustmentSumByPeriod.set(period, (adjustmentSumByPeriod.get(period) ?? 0) + row.amountCents);
            // Only as a fallback: a period whose share came out 0 has no `fixed_plan`
            // row, so its adjustments are the only record of who was paying.
            if (!payerByPeriod.has(period)) payerByPeriod.set(period, row.payerId);
          } else {
            foreignPeriods.add(period);
          }
        }

        /** The payer/other pair that was in effect for `period`. */
        const otherIdByPayer = new Map<string, string | null>();
        const membersForPeriod = Effect.fnUntraced(function* (period: string) {
          const payerId = payerByPeriod.get(period) ?? plan.payerId;
          if (!otherIdByPayer.has(payerId)) otherIdByPayer.set(payerId, yield* participants.otherMemberId(householdId, payerId));
          return { payerId, otherId: otherIdByPayer.get(payerId) ?? null };
        });

        const candidatePeriods = new Set<string>(bookedByPeriod.keys());
        if (plan.lastBookedPeriod !== null && comparePeriods(plan.startPeriod, plan.lastBookedPeriod) <= 0) {
          for (const period of periodsInclusive(plan.startPeriod, plan.lastBookedPeriod)) candidatePeriods.add(period);
        }

        const lines: RecalculationLine[] = [];
        for (const period of candidatePeriods) {
          const { payerId, otherId } = yield* membersForPeriod(period);
          if (!otherId) continue;
          if (!isPlanComputable(items, incomeRows, period, payerId, otherId)) continue;
          // Occupied by an import/manual row rather than by the plan: that period
          // is somebody else's, and an adjustment on top would double-count it.
          if (!bookedByPeriod.has(period) && foreignPeriods.has(period)) continue;
          const effectiveBookedCents = (bookedByPeriod.get(period) ?? 0) + (adjustmentSumByPeriod.get(period) ?? 0);
          const computation = computePlanForPeriod({ period, items, incomes: incomeRows, payerId, otherId });
          const delta = computation.bookableCents - effectiveBookedCents;
          if (delta !== 0) {
            lines.push({ period, bookedCents: effectiveBookedCents, recomputedCents: computation.bookableCents, deltaCents: delta });
          }
        }
        lines.sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));
        const totalDeltaCents = lines.reduce((sum, line) => sum + line.deltaCents, 0);

        if (dryRun || lines.length === 0) {
          const preview: RecalculatePlanResponse = { items: lines, totalDeltaCents, applied: false, adjustments: [] };
          return preview;
        }

        const adjustments = yield* database.transaction(
          Effect.gen(function* () {
            const household = yield* settings.loadHouseholdRow(householdId);
            const categoryId = yield* categories.categoryIdBySlug(householdId, PLAN_CATEGORY_SLUG);
            const person1Id = yield* participants.slot1UserId(householdId);
            const created: TransactionResponse[] = [];

            for (const line of lines) {
              const id = crypto.randomUUID();
              const timestamp = yield* financeTimeMillis;
              const description = serverText(household.defaultLocale, {
                key: "server.content.planAdjustmentDescription",
                values: { period: periodAsMonthSlashYear(line.period) },
              });
              const inserted = yield* database.use((db) =>
                db
                  .insert(transactions)
                  .values({
                    id,
                    householdId,
                    // The period's own payer, for the same reason the delta was computed
                    // against them: attributing a correction of a month A paid for to B
                    // flips the sign the balance moves in.
                    payerId: payerByPeriod.get(line.period) ?? plan.payerId,
                    splitMode: "OTHER_ONLY",
                    amountCents: line.deltaCents,
                    description,
                    categoryId,
                    bookedAt: timestamp,
                    dateSource: "exact",
                    origin: "fixed_plan_adjustment",
                    planPeriod: line.period,
                    categorySource: "system",
                    importSeq: null,
                    externalKey: `fixedplan-adj:${householdId}:${line.period}:${line.bookedCents}`,
                    createdBy: viewerId,
                    createdAt: timestamp,
                    updatedAt: timestamp,
                  })
                  .onConflictDoNothing({ target: [transactions.householdId, transactions.externalKey] })
                  .returning({ id: transactions.id }),
              );

              if (inserted.length === 0) continue; // re-run against unchanged data: already applied
              yield* tags.syncTransactionTags(householdId, id, ["fixkosten", "korrektur"]);
              const rows = yield* database.use((db) => db.select().from(transactions).where(eq(transactions.id, id)).limit(1));
              created.push(yield* ledger.toTransactionResponse(rows[0]!, person1Id));
            }
            return created;
          }),
        );

        const applied: RecalculatePlanResponse = { items: lines, totalDeltaCents, applied: true, adjustments };
        return applied;
      });

      return FinanceAccrual.of({ runCatchUp, runPlanNow, recalculatePlan });
    }),
  );
}

/* legacy bridges: callers listed; E3 (recipe), E4 (finance), E5 (scripts) remove them */

/**
 * Callers: `seed.ts` (E4-T07), `apps/api/scripts/plan-run.ts` (E5), `apps/api/test/finance-security.test.ts` (pinned, E5). A
 * survivor of E4 (plan P1): it rejects with the `DatabaseError`'s `cause`, the raw driver error the old function threw.
 */
export function runCatchUp(db: DrizzleDatabase, householdId: string, options: RunCatchUpOptions): Promise<RunCatchUpResult> {
  return runFinanceBridge(FinanceAccrual.use((service) => service.runCatchUp(householdId, options)), db);
}

/** Callers: `routes/plan.ts` (E4-T08 deletes it). */
export function runPlanNow(db: DrizzleDatabase, householdId: string, through?: string): Promise<RunPlanResponse> {
  return runFinanceBridge(FinanceAccrual.use((service) => service.runPlanNow(householdId, through)), db);
}

/** Callers: `routes/plan.ts` (E4-T08 deletes it). */
export function recalculatePlan(
  db: DrizzleDatabase,
  householdId: string,
  viewerId: string,
  dryRun: boolean,
): Promise<RecalculatePlanResponse> {
  return runFinanceBridge(FinanceAccrual.use((service) => service.recalculatePlan(householdId, viewerId, dryRun)), db);
}
