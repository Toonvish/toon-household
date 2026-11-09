/**
 * Drizzle (libSQL/SQLite) schema of the calendar module (docs/modules/calendar.md §1.2, plan m8 P26, ADR 0016).
 *
 * - Every SQL table, index and CHECK is prefixed `calendar_` (SQLite index names are global); the TS identifiers
 *   carry a `calendar` prefix too, because `db/schema.ts` re-exports every module schema FLAT.
 * - ids are `crypto.randomUUID()` text keys; timestamps are integer unix MILLISECONDS without a `$defaultFn`: the
 *   services stamp `created_at`, `updated_at`, `imported_at` and `archived_at` from `Clock.currentTimeMillis`
 *   (CLAUDE.md idioms rule (11)).
 * - Wall-clock dates (`YYYY-MM-DD`) and times (`HH:MM`) are text without a zone, GLOB-checked: a household calendar
 *   lives in one zone, so DST is no concern of the database (design §1.2).
 * - Household-scoped tables cascade from `households`; `created_by`, `done_by` and `imported_by` are SET NULL; member
 *   rows cascade from `users`. `resource_id` is `NO ACTION`, not `RESTRICT`: a booked car still cannot be deleted
 *   (the service answers `409 calendar_resource_in_use` first, P13), but SQLite checks a RESTRICT immediately, INSIDE
 *   the cascade of a household delete, and refused deleting a household that has a car booking; NO ACTION is
 *   checked at the end of the statement, when the cascade has removed both rows (db-calendar-migration.test.ts).
 *
 * `users` and `households` come from `db/schema/core.ts` directly, never from `db/schema.ts` (which re-exports
 * this file: a cycle). The migrations `apps/api/drizzle/0004_calendar.sql` and `apps/api/drizzle/0005_calendar_feed.sql` (M9) are
 * GENERATED from this file.
 */
import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { households, users } from "../../db/schema/core.ts";

const DATE_GLOB = "[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]";
const TIME_GLOB = "[0-2][0-9]:[0-5][0-9]";

/* -------------------------------------------------------------------------- */
/* calendar_resources — the household's cars                                   */
/* -------------------------------------------------------------------------- */

/** A car (`kind = 'car'`). Archived (`archived_at`), never deleted while a booking references it (P13). */
export const calendarResources = sqliteTable(
  "calendar_resources",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("car"),
    name: text("name").notNull(),
    archivedAt: integer("archived_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("calendar_resources_household_idx").on(t.householdId),
    check("calendar_resources_kind", sql`${t.kind} = 'car'`),
  ],
);

export type CalendarResourceRow = typeof calendarResources.$inferSelect;
export type NewCalendarResourceRow = typeof calendarResources.$inferInsert;

/* -------------------------------------------------------------------------- */
/* calendar_waste_imports — one per (household, provider, year)                */
/* -------------------------------------------------------------------------- */

/** One imported flyer year; its entries cascade with it. Re-importing a year REPLACES the row (P20). */
export const calendarWasteImports = sqliteTable(
  "calendar_waste_imports",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    year: integer("year").notNull(),
    tour: integer("tour").notNull(),
    // 'url' | 'upload'
    source: text("source").notNull(),
    // The URL, or the uploaded file's name (<= 200).
    sourceName: text("source_name").notNull(),
    entryCount: integer("entry_count").notNull(),
    importedAt: integer("imported_at").notNull(),
    importedBy: text("imported_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("calendar_waste_imports_household_year_uidx").on(t.householdId, t.provider, t.year),
    check("calendar_waste_imports_provider", sql`${t.provider} in ('hattingen')`),
    check("calendar_waste_imports_tour", sql`${t.tour} between 1 and 9`),
    check("calendar_waste_imports_source", sql`${t.source} in ('url', 'upload')`),
  ],
);

export type CalendarWasteImportRow = typeof calendarWasteImports.$inferSelect;
export type NewCalendarWasteImportRow = typeof calendarWasteImports.$inferInsert;

/* -------------------------------------------------------------------------- */
/* calendar_entries — the series                                               */
/* -------------------------------------------------------------------------- */

/**
 * One entry (a series): an event, a task or a car booking. `title` is NULL only on a waste entry (its label is the
 * catalog's, by `category`). `repeat_weekdays` is `MO,TU,…` for a weekly rhythm, else NULL.
 */
export const calendarEntries = sqliteTable(
  "calendar_entries",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
    // 'event' | 'task' | 'car'
    kind: text("kind").notNull(),
    title: text("title"),
    notes: text("notes"),
    location: text("location"),
    allDay: integer("all_day", { mode: "boolean" }).notNull(),
    startDate: text("start_date").notNull(),
    startTime: text("start_time"),
    endDate: text("end_date").notNull(),
    endTime: text("end_time"),
    // 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'
    repeatFreq: text("repeat_freq").notNull().default("none"),
    repeatInterval: integer("repeat_interval").notNull().default(1),
    repeatWeekdays: text("repeat_weekdays"),
    repeatUntil: text("repeat_until"),
    resourceId: text("resource_id").references(() => calendarResources.id, { onDelete: "no action" }),
    // 'none' | 'fixed' | 'rotate' (tasks; events and car bookings keep 'none')
    assigneeMode: text("assignee_mode").notNull().default("none"),
    category: text("category"),
    categoryDetail: text("category_detail"),
    wasteImportId: text("waste_import_id").references(() => calendarWasteImports.id, { onDelete: "cascade" }),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("calendar_entries_household_start_idx").on(t.householdId, t.startDate),
    index("calendar_entries_household_freq_idx").on(t.householdId, t.repeatFreq),
    index("calendar_entries_resource_idx").on(t.resourceId),
    index("calendar_entries_waste_import_idx").on(t.wasteImportId),
    check("calendar_entries_kind", sql`${t.kind} in ('event', 'task', 'car')`),
    check("calendar_entries_repeat_freq", sql`${t.repeatFreq} in ('none', 'daily', 'weekly', 'monthly', 'yearly')`),
    check("calendar_entries_repeat_interval", sql`${t.repeatInterval} between 1 and 99`),
    check("calendar_entries_assignee_mode", sql`${t.assigneeMode} in ('none', 'fixed', 'rotate')`),
    check(
      "calendar_entries_category",
      sql`${t.category} is null or ${t.category} in ('waste_rest', 'waste_yellow', 'waste_bio', 'waste_paper', 'waste_tree')`,
    ),
    check("calendar_entries_category_detail", sql`${t.categoryDetail} is null or ${t.categoryDetail} in ('bio_cleaning')`),
    check("calendar_entries_title_or_category", sql`${t.title} is not null or ${t.category} is not null`),
    check("calendar_entries_start_date_format", sql`${t.startDate} glob '${sql.raw(DATE_GLOB)}'`),
    check("calendar_entries_end_date_format", sql`${t.endDate} glob '${sql.raw(DATE_GLOB)}'`),
    check("calendar_entries_date_order", sql`${t.endDate} >= ${t.startDate}`),
    check("calendar_entries_start_time_format", sql`${t.startTime} is null or ${t.startTime} glob '${sql.raw(TIME_GLOB)}'`),
    check("calendar_entries_end_time_format", sql`${t.endTime} is null or ${t.endTime} glob '${sql.raw(TIME_GLOB)}'`),
    check("calendar_entries_until_format", sql`${t.repeatUntil} is null or ${t.repeatUntil} glob '${sql.raw(DATE_GLOB)}'`),
  ],
);

export type CalendarEntryRow = typeof calendarEntries.$inferSelect;
export type NewCalendarEntryRow = typeof calendarEntries.$inferInsert;

/* -------------------------------------------------------------------------- */
/* calendar_entry_members — attendees and assignees                            */
/* -------------------------------------------------------------------------- */

/** Who an entry names: `attendee` (events, car bookings) or `assignee` (tasks; `position` is the rotation order). */
export const calendarEntryMembers = sqliteTable(
  "calendar_entry_members",
  {
    entryId: text("entry_id").notNull().references(() => calendarEntries.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    // 'attendee' | 'assignee'
    role: text("role").notNull(),
    position: integer("position").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.entryId, t.userId, t.role] }),
    index("calendar_entry_members_user_idx").on(t.userId),
    check("calendar_entry_members_role", sql`${t.role} in ('attendee', 'assignee')`),
  ],
);

export type CalendarEntryMemberRow = typeof calendarEntryMembers.$inferSelect;
export type NewCalendarEntryMemberRow = typeof calendarEntryMembers.$inferInsert;

/* -------------------------------------------------------------------------- */
/* calendar_occurrence_states — done / skipped marks                           */
/* -------------------------------------------------------------------------- */

/** A marked occurrence (keyed by its start date); "open" has no row, a reset deletes it (P12). */
export const calendarOccurrenceStates = sqliteTable(
  "calendar_occurrence_states",
  {
    entryId: text("entry_id").notNull().references(() => calendarEntries.id, { onDelete: "cascade" }),
    occurrenceDate: text("occurrence_date").notNull(),
    // 'done' | 'skipped'
    status: text("status").notNull(),
    doneBy: text("done_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.entryId, t.occurrenceDate] }),
    check("calendar_occurrence_states_status", sql`${t.status} in ('done', 'skipped')`),
    check("calendar_occurrence_states_date_format", sql`${t.occurrenceDate} glob '${sql.raw(DATE_GLOB)}'`),
  ],
);

export type CalendarOccurrenceStateRow = typeof calendarOccurrenceStates.$inferSelect;
export type NewCalendarOccurrenceStateRow = typeof calendarOccurrenceStates.$inferInsert;

/* -------------------------------------------------------------------------- */
/* calendar_waste_settings + calendar_waste_assignees                          */
/* -------------------------------------------------------------------------- */

/** The household's waste provider, tour and assignee rule (one row per household). */
export const calendarWasteSettings = sqliteTable(
  "calendar_waste_settings",
  {
    householdId: text("household_id").primaryKey().references(() => households.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    tour: integer("tour").notNull(),
    // The last URL an import fetched.
    sourceUrl: text("source_url"),
    assigneeMode: text("assignee_mode").notNull().default("none"),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    check("calendar_waste_settings_provider", sql`${t.provider} in ('hattingen')`),
    check("calendar_waste_settings_tour", sql`${t.tour} between 1 and 9`),
    check("calendar_waste_settings_assignee_mode", sql`${t.assigneeMode} in ('none', 'fixed', 'rotate')`),
  ],
);

export type CalendarWasteSettingsRow = typeof calendarWasteSettings.$inferSelect;
export type NewCalendarWasteSettingsRow = typeof calendarWasteSettings.$inferInsert;

/** The waste settings' members in rotation order (P15). */
export const calendarWasteAssignees = sqliteTable(
  "calendar_waste_assignees",
  {
    householdId: text("household_id")
      .notNull()
      .references(() => calendarWasteSettings.householdId, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.userId] }), index("calendar_waste_assignees_user_idx").on(t.userId)],
);

export type CalendarWasteAssigneeRow = typeof calendarWasteAssignees.$inferSelect;
export type NewCalendarWasteAssigneeRow = typeof calendarWasteAssignees.$inferInsert;

/* -------------------------------------------------------------------------- */
/* calendar_feed_tokens — one subscription link per member and household (M9) */
/* -------------------------------------------------------------------------- */

/**
 * A member's calendar subscription link (plan m9 P3, P13; ADR 0017): the feed route
 * `GET /api/calendar/feed/<token>.ics` authenticates by the token alone. Only the token's SHA-256 (64 lower-case hex
 * characters) is stored; the token itself is shown once, in the answer of the POST that creates it. One row per
 * `(household, user)`: a new link REPLACES the old one (the old token dies at once). `scope` is `all` (every entry of
 * the household) or `mine` (the P10 member filter). `last_used_at` is written at most once per hour (P7). The row
 * cascades with the household and the user; the member-removal hook deletes it when the member leaves (P14).
 */
export const calendarFeedTokens = sqliteTable(
  "calendar_feed_tokens",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    // 'all' | 'mine'
    scope: text("scope").notNull(),
    createdAt: integer("created_at").notNull(),
    lastUsedAt: integer("last_used_at"),
  },
  (t) => [
    uniqueIndex("calendar_feed_tokens_token_hash_uidx").on(t.tokenHash),
    uniqueIndex("calendar_feed_tokens_household_user_uidx").on(t.householdId, t.userId),
    index("calendar_feed_tokens_user_idx").on(t.userId),
    check("calendar_feed_tokens_scope", sql`${t.scope} in ('all', 'mine')`),
    check("calendar_feed_tokens_token_hash_format", sql`length(${t.tokenHash}) = 64`),
  ],
);

export type CalendarFeedTokenRow = typeof calendarFeedTokens.$inferSelect;
export type NewCalendarFeedTokenRow = typeof calendarFeedTokens.$inferInsert;

/** Every calendar table, for the manifest's `schema` (SPEC D7: all prefixed `calendar_`). */
export const calendarTables = {
  calendarResources,
  calendarWasteImports,
  calendarEntries,
  calendarEntryMembers,
  calendarOccurrenceStates,
  calendarWasteSettings,
  calendarWasteAssignees,
  calendarFeedTokens,
};
