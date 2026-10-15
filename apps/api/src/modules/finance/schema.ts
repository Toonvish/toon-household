/**
 * Drizzle (libSQL/SQLite) schema of the finance module — toon-finance's
 * `apps/api/src/db/schema.ts` (categories … accrual_runs, their relations and row
 * types) with the household renames of SPEC D3/D7 and plan M3 decision 2:
 *
 * - every SQL table carries the module prefix `finance_` (11 tables, SPEC §4), and
 *   so do every index and CHECK name (SQLite index names are global; recipe has a
 *   `tags` table too);
 * - the TS identifiers carry a `finance` prefix as well (`financeTags`,
 *   `financeTransactions`, …; plan M3 Table C) because `db/schema.ts` re-exports
 *   every module schema FLAT and recipe owns `tags`, `TagRow`, …; ported files
 *   import them under F's names (`import { financeTags as tags } from "…/schema.ts"`);
 * - `finance_participants` replaces F's `household_members` (the two slots, by user
 *   id, same PK / unique index / CHECK — F decision 1, SPEC D3);
 * - `finance_settings` holds what F kept in `households.default_locale` (the
 *   language server-written ledger text is stored in, F gotcha 42);
 * - `household_id` references the core `households.id` (cascade, as in F); user
 *   references keep F's `onDelete` (`restrict` for payer/person/participant,
 *   `set null` for `created_by`).
 *
 * `users` and `households` come from `db/schema/core.ts` directly, never from
 * `db/schema.ts` (which re-exports this file — importing it here would be a cycle).
 * The core relations gain no finance side (as for recipe, plan M2 decision 2).
 *
 * Conventions (toon-finance docs/spec.md §2):
 * - ids: crypto.randomUUID() text primary keys
 * - timestamps: integer unix MILLISECONDS (exposed as ISO strings by the API)
 * - money: integer CENTS, signed. never real(), never float. `real` here
 *   would be a bug.
 * - periods: text 'YYYY-MM', CHECK-constrained by GLOB
 * - booleans: integer 0/1 via mode: "boolean"
 * - every FK used for listing has an index; household-scoped tables cascade
 *   from `households`
 * - a user row is never cascade-deleted through the ledger: payer_id is
 *   RESTRICT
 */
import { relations, sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { households, users } from "../../db/schema/core.ts";

const now = (): number => Date.now();
const PERIOD_GLOB = "[0-9][0-9][0-9][0-9]-[0-9][0-9]";

/* -------------------------------------------------------------------------- */
/* finance_participants — the two seats, as a DB fact (F household_members)  */
/* -------------------------------------------------------------------------- */

/**
 * The two people who keep a household's budget (SPEC D3, F decision 1). Any number of
 * core household members may exist; exactly these (at most two) rows take part in
 * the ledger. `finance_participants_slot_uidx` + the slot CHECK make "two people" a
 * DB fact, not a service convention. A participant must also be a core member of
 * the household — the service checks that (`assignParticipants`).
 */
export const financeParticipants = sqliteTable(
  "finance_participants",
  {
    householdId: text("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    // 1 or 2 — slot 1 anchors the balance sign convention (F docs/spec.md §2.4).
    memberSlot: integer("member_slot").notNull(),
    // "Alex", "Robin" — the name visible inside this household's budget.
    displayName: text("display_name").notNull(),
    joinedAt: integer("joined_at").notNull().$defaultFn(now),
  },
  (t) => [
    primaryKey({ columns: [t.householdId, t.userId] }),
    uniqueIndex("finance_participants_slot_uidx").on(t.householdId, t.memberSlot),
    index("finance_participants_user_idx").on(t.userId),
    check("finance_participants_slot_range", sql`${t.memberSlot} in (1, 2)`),
  ],
);

export type FinanceParticipantRow = typeof financeParticipants.$inferSelect;
export type NewFinanceParticipantRow = typeof financeParticipants.$inferInsert;

/* -------------------------------------------------------------------------- */
/* finance_settings — F's households.default_locale                           */
/* -------------------------------------------------------------------------- */

/**
 * One row per household (written by `onHouseholdCreated`, SPEC §2, finance enabled or
 * not). `default_locale` is the language the server writes ledger text in (plan
 * booking descriptions) — never the request's locale (F gotcha 42).
 */
export const financeSettings = sqliteTable("finance_settings", {
  householdId: text("household_id")
    .primaryKey()
    .references(() => households.id, { onDelete: "cascade" }),
  defaultLocale: text("default_locale", { enum: ["de", "en"] }).notNull().default("de"),
  createdAt: integer("created_at").notNull().$defaultFn(now),
  updatedAt: integer("updated_at").notNull().$defaultFn(now),
});

export type FinanceSettingsRow = typeof financeSettings.$inferSelect;
export type NewFinanceSettingsRow = typeof financeSettings.$inferInsert;

/* -------------------------------------------------------------------------- */
/* finance_categories — stable slugs, label from the catalog                  */
/* -------------------------------------------------------------------------- */

export const financeCategories = sqliteTable(
  "finance_categories",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
    // "tiere", "fixkosten", … or "custom-<uuid8>" — the code-facing key.
    slug: text("slug").notNull(),
    // null = label is rendered from the i18n catalog on every read; set once
    // the household renames the row, and never re-translated after that.
    customLabel: text("custom_label"),
    isSystem: integer("is_system", { mode: "boolean" }).notNull().default(false),
    isHidden: integer("is_hidden", { mode: "boolean" }).notNull().default(false),
    position: integer("position").notNull(),
    createdAt: integer("created_at").notNull().$defaultFn(now),
    updatedAt: integer("updated_at").notNull().$defaultFn(now),
  },
  (t) => [
    uniqueIndex("finance_categories_household_slug_uidx").on(t.householdId, t.slug),
    index("finance_categories_household_position_idx").on(t.householdId, t.position),
  ],
);

export type FinanceCategoryRow = typeof financeCategories.$inferSelect;
export type NewFinanceCategoryRow = typeof financeCategories.$inferInsert;

/* -------------------------------------------------------------------------- */
/* finance_tags + finance_transaction_tags — normalized, autocomplete axis    */
/* -------------------------------------------------------------------------- */

export const financeTags = sqliteTable(
  "finance_tags",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // normalizeTagName(name) — lower(trim(collapse whitespace)).
    nameKey: text("name_key").notNull(),
    usageCount: integer("usage_count").notNull().default(0),
    createdAt: integer("created_at").notNull().$defaultFn(now),
  },
  (t) => [
    uniqueIndex("finance_tags_household_name_key_uidx").on(t.householdId, t.nameKey),
    index("finance_tags_household_usage_idx").on(t.householdId, t.usageCount),
  ],
);

export type FinanceTagRow = typeof financeTags.$inferSelect;
export type NewFinanceTagRow = typeof financeTags.$inferInsert;

export const financeTransactionTags = sqliteTable(
  "finance_transaction_tags",
  {
    transactionId: text("transaction_id")
      .notNull()
      .references(() => financeTransactions.id, { onDelete: "cascade" }),
    tagId: text("tag_id").notNull().references(() => financeTags.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.transactionId, t.tagId] }),
    index("finance_transaction_tags_tag_idx").on(t.tagId),
  ],
);

export type FinanceTransactionTagRow = typeof financeTransactionTags.$inferSelect;
export type NewFinanceTransactionTagRow = typeof financeTransactionTags.$inferInsert;

/* -------------------------------------------------------------------------- */
/* finance_transactions — the cash book                                       */
/* -------------------------------------------------------------------------- */

export const financeTransactions = sqliteTable(
  "finance_transactions",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
    payerId: text("payer_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    splitMode: text("split_mode", { enum: ["SPLIT_EQUAL", "OTHER_ONLY", "SETTLEMENT"] }).notNull(),
    // signed, NEVER 0 (the check below) — negative amounts are meaningful
    // (refunds, corrections) and must keep their sign.
    amountCents: integer("amount_cents").notNull(),
    description: text("description").notNull(),
    categoryId: text("category_id").references(() => financeCategories.id, { onDelete: "set null" }),
    // unix ms, 00:00 Europe/Berlin for day-precision entries.
    bookedAt: integer("booked_at").notNull(),
    dateSource: text("date_source", { enum: ["exact", "day", "month", "estimated"] }).notNull(),
    // NO default (F gotcha 38): `tsc` must fail at every insert that forgets it.
    origin: text("origin", {
      enum: ["manual", "fixed_plan", "fixed_plan_adjustment", "import"],
    }).notNull(),
    // 'YYYY-MM' for origin fixed_plan*, null otherwise.
    planPeriod: text("plan_period"),
    categorySource: text("category_source", { enum: ["manual", "heuristic", "system"] }).notNull(),
    // Sheet row of the one-time xlsx import — preserves import order.
    importSeq: integer("import_seq"),
    // Idempotency key; null for manual rows (SQLite treats every NULL as
    // distinct, so manual rows never collide on the unique index below).
    externalKey: text("external_key"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull().$defaultFn(now),
    updatedAt: integer("updated_at").notNull().$defaultFn(now),
  },
  (t) => [
    uniqueIndex("finance_transactions_household_external_key_uidx").on(t.householdId, t.externalKey),
    index("finance_transactions_household_booked_idx").on(t.householdId, t.bookedAt, t.importSeq),
    index("finance_transactions_household_category_idx").on(t.householdId, t.categoryId),
    index("finance_transactions_household_plan_idx").on(t.householdId, t.origin, t.planPeriod),
    check("finance_transactions_amount_not_zero", sql`${t.amountCents} <> 0`),
    check(
      "finance_transactions_plan_period_format",
      sql`${t.planPeriod} is null or ${t.planPeriod} glob '${sql.raw(PERIOD_GLOB)}'`,
    ),
  ],
);

export type FinanceTransactionRow = typeof financeTransactions.$inferSelect;
export type NewFinanceTransactionRow = typeof financeTransactions.$inferInsert;

/* -------------------------------------------------------------------------- */
/* finance_mutation_claims — replay protection for the offline queue          */
/* -------------------------------------------------------------------------- */

export const financeMutationClaims = sqliteTable(
  "finance_mutation_claims",
  {
    // the client-minted mutationId — claimMutation() is an INSERT on THIS
    // primary key with onConflictDoNothing(), never a select-then-write.
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
    transactionId: text("transaction_id").references(() => financeTransactions.id, { onDelete: "set null" }),
    appliedAt: integer("applied_at").notNull().$defaultFn(now),
  },
  (t) => [index("finance_mutation_claims_applied_at_idx").on(t.appliedAt)],
);

export type FinanceMutationClaimRow = typeof financeMutationClaims.$inferSelect;
export type NewFinanceMutationClaimRow = typeof financeMutationClaims.$inferInsert;

/* -------------------------------------------------------------------------- */
/* finance_fixed_cost_items — temporal fixed-cost line items                  */
/* -------------------------------------------------------------------------- */

export const financeFixedCostItems = sqliteTable(
  "finance_fixed_cost_items",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
    // "Miete", "Strom" — user content, never translated.
    label: text("label").notNull(),
    amountCents: integer("amount_cents").notNull(),
    activeFrom: text("active_from").notNull(),
    activeTo: text("active_to"),
    position: integer("position").notNull(),
    createdAt: integer("created_at").notNull().$defaultFn(now),
    updatedAt: integer("updated_at").notNull().$defaultFn(now),
  },
  (t) => [
    index("finance_fixed_cost_items_household_active_idx").on(t.householdId, t.activeFrom, t.activeTo),
    check("finance_fixed_cost_items_amount_positive", sql`${t.amountCents} > 0`),
    check("finance_fixed_cost_items_from_format", sql`${t.activeFrom} glob '${sql.raw(PERIOD_GLOB)}'`),
    check(
      "finance_fixed_cost_items_to_format",
      sql`${t.activeTo} is null or ${t.activeTo} glob '${sql.raw(PERIOD_GLOB)}'`,
    ),
    check("finance_fixed_cost_items_range", sql`${t.activeTo} is null or ${t.activeTo} >= ${t.activeFrom}`),
  ],
);

export type FinanceFixedCostItemRow = typeof financeFixedCostItems.$inferSelect;
export type NewFinanceFixedCostItemRow = typeof financeFixedCostItems.$inferInsert;

/* -------------------------------------------------------------------------- */
/* finance_incomes — temporal income per person                               */
/* -------------------------------------------------------------------------- */

export const financeIncomes = sqliteTable(
  "finance_incomes",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
    personId: text("person_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    amountCents: integer("amount_cents").notNull(),
    validFrom: text("valid_from").notNull(),
    validTo: text("valid_to"),
    createdAt: integer("created_at").notNull().$defaultFn(now),
    updatedAt: integer("updated_at").notNull().$defaultFn(now),
  },
  (t) => [
    uniqueIndex("finance_incomes_person_from_uidx").on(t.householdId, t.personId, t.validFrom),
    index("finance_incomes_household_person_idx").on(t.householdId, t.personId, t.validFrom, t.validTo),
    check("finance_incomes_amount_positive", sql`${t.amountCents} > 0`),
    check("finance_incomes_from_format", sql`${t.validFrom} glob '${sql.raw(PERIOD_GLOB)}'`),
    check("finance_incomes_to_format", sql`${t.validTo} is null or ${t.validTo} glob '${sql.raw(PERIOD_GLOB)}'`),
    check("finance_incomes_range", sql`${t.validTo} is null or ${t.validTo} >= ${t.validFrom}`),
  ],
);

export type FinanceIncomeRow = typeof financeIncomes.$inferSelect;
export type NewFinanceIncomeRow = typeof financeIncomes.$inferInsert;

/* -------------------------------------------------------------------------- */
/* finance_fixed_cost_plans — one row per household                           */
/* -------------------------------------------------------------------------- */

export const financeFixedCostPlans = sqliteTable(
  "finance_fixed_cost_plans",
  {
    householdId: text("household_id")
      .primaryKey()
      .references(() => households.id, { onDelete: "cascade" }),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    payerId: text("payer_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    startPeriod: text("start_period").notNull(),
    // CACHE for the scan start, NOT the source of truth — see the
    // finance_transactions_household_external_key_uidx comment.
    lastBookedPeriod: text("last_booked_period"),
    createdAt: integer("created_at").notNull().$defaultFn(now),
    updatedAt: integer("updated_at").notNull().$defaultFn(now),
  },
  (t) => [
    check("finance_fixed_cost_plans_start_format", sql`${t.startPeriod} glob '${sql.raw(PERIOD_GLOB)}'`),
    check(
      "finance_fixed_cost_plans_last_format",
      sql`${t.lastBookedPeriod} is null or ${t.lastBookedPeriod} glob '${sql.raw(PERIOD_GLOB)}'`,
    ),
  ],
);

export type FinanceFixedCostPlanRow = typeof financeFixedCostPlans.$inferSelect;
export type NewFinanceFixedCostPlanRow = typeof financeFixedCostPlans.$inferInsert;

/* -------------------------------------------------------------------------- */
/* finance_accrual_runs — audit log of the monthly runs, NOT the idempotency  */
/* -------------------------------------------------------------------------- */

export const financeAccrualRuns = sqliteTable(
  "finance_accrual_runs",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
    trigger: text("trigger", { enum: ["boot", "interval", "manual", "import"] }).notNull(),
    fromPeriod: text("from_period"),
    toPeriod: text("to_period"),
    periodsBooked: integer("periods_booked").notNull(),
    periodsSkipped: integer("periods_skipped").notNull(),
    bookedCents: integer("booked_cents").notNull(),
    // English ops text, null on success.
    error: text("error"),
    startedAt: integer("started_at").notNull(),
    finishedAt: integer("finished_at").notNull(),
  },
  (t) => [index("finance_accrual_runs_household_started_idx").on(t.householdId, t.startedAt)],
);

export type FinanceAccrualRunRow = typeof financeAccrualRuns.$inferSelect;
export type NewFinanceAccrualRunRow = typeof financeAccrualRuns.$inferInsert;

/* -------------------------------------------------------------------------- */
/* relations (finance side only; the core tables gain no reverse side)        */
/* -------------------------------------------------------------------------- */

export const financeParticipantsRelations = relations(financeParticipants, ({ one }) => ({
  household: one(households, { fields: [financeParticipants.householdId], references: [households.id] }),
  user: one(users, { fields: [financeParticipants.userId], references: [users.id] }),
}));

export const financeSettingsRelations = relations(financeSettings, ({ one }) => ({
  household: one(households, { fields: [financeSettings.householdId], references: [households.id] }),
}));

export const financeCategoriesRelations = relations(financeCategories, ({ one, many }) => ({
  household: one(households, { fields: [financeCategories.householdId], references: [households.id] }),
  transactions: many(financeTransactions),
}));

export const financeTagsRelations = relations(financeTags, ({ one, many }) => ({
  household: one(households, { fields: [financeTags.householdId], references: [households.id] }),
  transactionTags: many(financeTransactionTags),
}));

export const financeTransactionsRelations = relations(financeTransactions, ({ one, many }) => ({
  household: one(households, { fields: [financeTransactions.householdId], references: [households.id] }),
  payer: one(users, { fields: [financeTransactions.payerId], references: [users.id] }),
  category: one(financeCategories, {
    fields: [financeTransactions.categoryId],
    references: [financeCategories.id],
  }),
  tags: many(financeTransactionTags),
}));

export const financeTransactionTagsRelations = relations(financeTransactionTags, ({ one }) => ({
  transaction: one(financeTransactions, {
    fields: [financeTransactionTags.transactionId],
    references: [financeTransactions.id],
  }),
  tag: one(financeTags, { fields: [financeTransactionTags.tagId], references: [financeTags.id] }),
}));

export const financeFixedCostItemsRelations = relations(financeFixedCostItems, ({ one }) => ({
  household: one(households, { fields: [financeFixedCostItems.householdId], references: [households.id] }),
}));

export const financeIncomesRelations = relations(financeIncomes, ({ one }) => ({
  household: one(households, { fields: [financeIncomes.householdId], references: [households.id] }),
  person: one(users, { fields: [financeIncomes.personId], references: [users.id] }),
}));

export const financeFixedCostPlansRelations = relations(financeFixedCostPlans, ({ one }) => ({
  household: one(households, { fields: [financeFixedCostPlans.householdId], references: [households.id] }),
  payer: one(users, { fields: [financeFixedCostPlans.payerId], references: [users.id] }),
}));

export const financeAccrualRunsRelations = relations(financeAccrualRuns, ({ one }) => ({
  household: one(households, { fields: [financeAccrualRuns.householdId], references: [households.id] }),
}));

export const financeMutationClaimsRelations = relations(financeMutationClaims, ({ one }) => ({
  household: one(households, { fields: [financeMutationClaims.householdId], references: [households.id] }),
  transaction: one(financeTransactions, {
    fields: [financeMutationClaims.transactionId],
    references: [financeTransactions.id],
  }),
}));

/** The module's 11 tables — the manifest's `schema` (SPEC §2). */
export const financeTables = {
  financeParticipants,
  financeSettings,
  financeCategories,
  financeTags,
  financeTransactionTags,
  financeTransactions,
  financeMutationClaims,
  financeFixedCostItems,
  financeIncomes,
  financeFixedCostPlans,
  financeAccrualRuns,
};
