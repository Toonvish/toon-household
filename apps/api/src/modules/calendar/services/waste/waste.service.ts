/**
 * `CalendarWaste` (plan m8 P15, P16, P17, P20; design §5.5): the household's waste schedule.
 *
 * - `overview(householdId, from)` (P16): the settings (or null), the imports newest year first, and per waste type (in
 *   `WASTE_CATEGORIES` order) the earliest waste entry on or after `from` (the CLIENT's today) that is not skipped.
 * - `putSettings(householdId, body)` (P15): provider, tour and the assignee rule (members of THIS household, else
 *   `422 validation_failed` at `assigneeIds.<n>`); then every entry of every import of the household dated on or after
 *   `body.today` gets its assignee again.
 * - `preview(householdId, userId, source)`: the flyer (fetched from a URL or uploaded) parsed for the tour; NOTHING written.
 * - `importFlyer(householdId, userId, source)` (P20): the same parse, then ONE `Database.transaction`: upsert the settings
 *   (provider, tour, `source_url` for a URL; mode and assignees kept, default `none`), remember what the members wrote on
 *   the household's import of `(provider, year)` by `(category, date)` (the occurrence states, the notes, and an
 *   assignee set by hand: a person other than the rule's pick), delete that import (its entries cascade), insert the new
 *   import and one entry per `(category, date)` (`kind task`, all-day, `title NULL`, `category`, `category_detail`,
 *   `waste_import_id`) with its assignee under the rule, and put back what was remembered for every `(category, date)`
 *   that still exists.
 * - `removeImport(householdId, importId)`: `404 not_found` for another household's import; its entries go with it.
 *
 * ASSIGNEES PER PICKUP DAY (P15): a waste entry is a single all-day task, so a rotation over single entries would always
 * pick its first person. The pickup days of ALL the household's imports together, sorted ascending, go round the
 * settings' list (day `k` -> `assigneeIds[k mod n]`; every type of one day to the same person), so the rotation runs on
 * across New Year from one year's import into the next; each entry stores `assignee_mode "fixed"` with that one id, or
 * `"none"`; the settings keep the mode and the ordered list. An import deals only its own entries (another year's
 * import keeps its people; a save of the settings re-deals every import from the client's `today`).
 *
 * Preview and import share a per-user rate limit (`RateLimiter`, key `calendar-waste`, 30 per hour; off under test).
 * Time comes from the `Clock` (read in the method, never captured at build). The service writes its entries with its
 * own statements: the waste area does not depend on the entries area (P27). Its static `layer` references only
 * `effect` exports and its own class; its dependencies are yielded at build (CLAUDE.md "One composition point").
 */
import {
  type CalendarWasteImport,
  type CalendarWasteImportResponse,
  type CalendarWasteOverviewResponse,
  type CalendarWastePickup,
  type CalendarWastePreview,
  type CalendarWasteSettings,
  type PutCalendarWasteSettingsRequest,
  WASTE_CATEGORIES,
  type WasteCategory,
  type WasteDetail,
  type WasteProviderId,
} from "@toon/shared";
import { and, asc, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { Clock, Context, Effect, Layer } from "effect";
import type { RateLimitRule } from "../../../../core/services/auth/rateLimit.ts";
import { RateLimiter } from "../../../../core/services/auth/rateLimit.ts";
import { Database } from "../../../../db/database.ts";
import { type ApiFailure, type DatabaseError, NotFound, type RateLimited, type ValidationFailed } from "../../../../lib/errors.ts";
import { toIso } from "../../../../lib/http.ts";
import {
  calendarEntries,
  calendarEntryMembers,
  calendarOccurrenceStates,
  calendarWasteAssignees,
  calendarWasteImports,
  calendarWasteSettings,
} from "../../schema.ts";
import { CalendarMembers } from "../members.ts";
import { wasteUnparseable } from "./errors.ts";
import { WasteFlyerFetch } from "./fetch.ts";
import { type HattingenPickup, parseHattingenFlyer, selectTour } from "./hattingen.ts";
import { WastePdfText } from "./pdf-text.ts";

/** Preview and import together: 30 per user and hour (P17). */
export const WASTE_IMPORT_RULE: RateLimitRule = { limit: 30, windowMs: 60 * 60_000 };

/** Where the flyer comes from: a URL to fetch (P17), or an uploaded file (`./upload.ts`). */
export type WasteSource =
  | { readonly kind: "url"; readonly provider: WasteProviderId; readonly tour: number; readonly url: string }
  | {
      readonly kind: "upload";
      readonly provider: WasteProviderId;
      readonly tour: number;
      readonly bytes: Uint8Array;
      /** The uploaded file's name (<= 200), the import's `source_name`. */
      readonly fileName: string;
    };

/** What every refusal of preview and import is. */
export type WasteImportFailure = ApiFailure | RateLimited | DatabaseError;

/** A parsed flyer for one tour, ready to preview or to write. */
interface LoadedFlyer {
  readonly provider: WasteProviderId;
  readonly year: number;
  readonly tour: number;
  readonly pickups: ReadonlyArray<HattingenPickup>;
  readonly warnings: ReadonlyArray<{ readonly code: string; readonly date: string | null }>;
  readonly source: "url" | "upload";
  readonly sourceName: string;
  /** The URL the flyer was requested from (a URL source only). */
  readonly sourceUrl: string | null;
}

type AssigneeMode = "none" | "fixed" | "rotate";

/** P15: the one assignee of pickup day `k` under the rule, or null. */
export function assigneeForDay(mode: AssigneeMode, ids: ReadonlyArray<string>, k: number): string | null {
  if (mode === "none" || ids.length === 0) return null;
  if (mode === "fixed") return ids[0] ?? null;
  return ids[k % ids.length] ?? null;
}

/** P15: the index of each pickup day (the distinct dates of every import of the household, ascending). */
function dayIndex(dates: Iterable<string>): Map<string, number> {
  const sorted = [...new Set(dates)].sort();
  return new Map(sorted.map((date, index) => [date, index]));
}

const INSERT_CHUNK = 200;

function chunks<A>(rows: ReadonlyArray<A>, size: number = INSERT_CHUNK): A[][] {
  const out: A[][] = [];
  for (let start = 0; start < rows.length; start += size) out.push(rows.slice(start, start + size));
  return out;
}

const importDto = (row: typeof calendarWasteImports.$inferSelect): CalendarWasteImport => ({
  id: row.id,
  provider: row.provider as WasteProviderId,
  year: row.year,
  tour: row.tour,
  source: row.source as "url" | "upload",
  sourceName: row.sourceName,
  entryCount: row.entryCount,
  importedAt: toIso(row.importedAt),
  importedBy: row.importedBy,
});

export class CalendarWaste extends Context.Service<
  CalendarWaste,
  {
    /** P16. */
    readonly overview: (householdId: string, from: string) => Effect.Effect<CalendarWasteOverviewResponse, DatabaseError>;
    /** P15. */
    readonly putSettings: (
      householdId: string,
      body: PutCalendarWasteSettingsRequest,
    ) => Effect.Effect<CalendarWasteSettings, ValidationFailed | DatabaseError>;
    /** The parse for the tour; nothing written. */
    readonly preview: (
      householdId: string,
      userId: string,
      source: WasteSource,
    ) => Effect.Effect<CalendarWastePreview, WasteImportFailure>;
    /** P20. */
    readonly importFlyer: (
      householdId: string,
      userId: string,
      source: WasteSource,
    ) => Effect.Effect<CalendarWasteImportResponse, WasteImportFailure>;
    /** Deletes an import of this household with its entries; `404 not_found` otherwise. */
    readonly removeImport: (householdId: string, importId: string) => Effect.Effect<void, NotFound | DatabaseError>;
  }
>()("toon/api/modules/calendar/services/waste/waste.service/CalendarWaste") {
  static readonly layer = Layer.effect(
    CalendarWaste,
    Effect.gen(function* () {
      const database = yield* Database;
      const members = yield* CalendarMembers;
      const rateLimiter = yield* RateLimiter;
      const pdfText = yield* WastePdfText;
      const flyerFetch = yield* WasteFlyerFetch;

      /* ------------------------------- settings ------------------------------- */

      const readSettings = Effect.fn("CalendarWaste.readSettings")(function* (householdId: string) {
        const [row] = yield* database.use((db) =>
          db.select().from(calendarWasteSettings).where(eq(calendarWasteSettings.householdId, householdId)).limit(1),
        );
        if (row === undefined) return null;
        const assignees = yield* database.use((db) =>
          db
            .select({ userId: calendarWasteAssignees.userId })
            .from(calendarWasteAssignees)
            .where(eq(calendarWasteAssignees.householdId, householdId))
            .orderBy(asc(calendarWasteAssignees.position), asc(calendarWasteAssignees.userId)),
        );
        return {
          provider: row.provider as WasteProviderId,
          tour: row.tour,
          sourceUrl: row.sourceUrl,
          assigneeMode: row.assigneeMode as AssigneeMode,
          assigneeIds: assignees.map((assignee) => assignee.userId),
          updatedAt: toIso(row.updatedAt),
        } satisfies CalendarWasteSettings;
      });

      /** The waste entries of the household's imports with their dates, and the day index over all of them (P15). */
      const householdPickupDays = Effect.fnUntraced(function* (householdId: string) {
        const rows = yield* database.use((db) =>
          db
            .select({ id: calendarEntries.id, importId: calendarEntries.wasteImportId, date: calendarEntries.startDate })
            .from(calendarEntries)
            .where(and(eq(calendarEntries.householdId, householdId), isNotNull(calendarEntries.wasteImportId))),
        );
        return { rows, index: dayIndex(rows.map((row) => row.date)) };
      });

      /**
       * Gives the household's waste entries dated on or after `from` (all of them when `from` is null), only those of
       * `onlyImportId` when it is given, their assignee under the rule (P15): one `assignee` member row, `assignee_mode`
       * `fixed`, or none and `none`. The day index runs over every import of the household.
       */
      const assignEntries = Effect.fn("CalendarWaste.assignEntries")(function* (
        householdId: string,
        mode: AssigneeMode,
        ids: ReadonlyArray<string>,
        from: string | null,
        now: number,
        onlyImportId: string | null,
      ) {
        const { rows, index } = yield* householdPickupDays(householdId);
        const assigned = new Map<string, string[]>();
        const unassigned: string[] = [];
        for (const entry of rows) {
          if (onlyImportId !== null && entry.importId !== onlyImportId) continue;
          if (from !== null && entry.date < from) continue;
          const assignee = assigneeForDay(mode, ids, index.get(entry.date)!);
          if (assignee === null) unassigned.push(entry.id);
          else assigned.set(assignee, [...(assigned.get(assignee) ?? []), entry.id]);
        }
        const touched = [...unassigned, ...[...assigned.values()].flat()];
        for (const part of chunks(touched)) {
          yield* database.use((db) =>
            db
              .delete(calendarEntryMembers)
              .where(and(inArray(calendarEntryMembers.entryId, part), eq(calendarEntryMembers.role, "assignee"))),
          );
        }
        for (const part of chunks(unassigned)) {
          yield* database.use((db) =>
            db.update(calendarEntries).set({ assigneeMode: "none", updatedAt: now }).where(inArray(calendarEntries.id, part)),
          );
        }
        for (const [userId, entryIds] of assigned) {
          for (const part of chunks(entryIds)) {
            yield* database.use((db) =>
              db.update(calendarEntries).set({ assigneeMode: "fixed", updatedAt: now }).where(inArray(calendarEntries.id, part)),
            );
            yield* database.use((db) =>
              db
                .insert(calendarEntryMembers)
                .values(part.map((entryId) => ({ entryId, userId, role: "assignee", position: 0 }))),
            );
          }
        }
      });

      const putSettings = Effect.fn("CalendarWaste.putSettings")(function* (
        householdId: string,
        body: PutCalendarWasteSettingsRequest,
      ) {
        yield* members.assertMembers(householdId, body.assigneeIds, "assigneeIds");
        return yield* database.transaction(
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            yield* database.use((db) =>
              db
                .insert(calendarWasteSettings)
                .values({
                  householdId,
                  provider: body.provider,
                  tour: body.tour,
                  sourceUrl: null,
                  assigneeMode: body.assigneeMode,
                  updatedAt: now,
                })
                .onConflictDoUpdate({
                  target: calendarWasteSettings.householdId,
                  set: { provider: body.provider, tour: body.tour, assigneeMode: body.assigneeMode, updatedAt: now },
                }),
            );
            yield* database.use((db) =>
              db.delete(calendarWasteAssignees).where(eq(calendarWasteAssignees.householdId, householdId)),
            );
            if (body.assigneeIds.length > 0) {
              yield* database.use((db) =>
                db
                  .insert(calendarWasteAssignees)
                  .values(body.assigneeIds.map((userId, position) => ({ householdId, userId, position }))),
              );
            }
            yield* assignEntries(householdId, body.assigneeMode, body.assigneeIds, body.today, now, null);
            return (yield* readSettings(householdId))!;
          }),
        );
      });

      /* -------------------------------- overview ------------------------------- */

      const overview = Effect.fn("CalendarWaste.overview")(function* (householdId: string, from: string) {
        const settings = yield* readSettings(householdId);
        const imports = yield* database.use((db) =>
          db
            .select()
            .from(calendarWasteImports)
            .where(eq(calendarWasteImports.householdId, householdId))
            .orderBy(desc(calendarWasteImports.year), desc(calendarWasteImports.importedAt), asc(calendarWasteImports.id)),
        );
        const upcoming = yield* database.use((db) =>
          db
            .select({
              category: calendarEntries.category,
              detail: calendarEntries.categoryDetail,
              date: calendarEntries.startDate,
              status: calendarOccurrenceStates.status,
            })
            .from(calendarEntries)
            .leftJoin(
              calendarOccurrenceStates,
              and(
                eq(calendarOccurrenceStates.entryId, calendarEntries.id),
                eq(calendarOccurrenceStates.occurrenceDate, calendarEntries.startDate),
              ),
            )
            .where(
              and(
                eq(calendarEntries.householdId, householdId),
                isNotNull(calendarEntries.category),
                gte(calendarEntries.startDate, from),
              ),
            )
            .orderBy(asc(calendarEntries.startDate), asc(calendarEntries.id)),
        );
        const next = new Map<WasteCategory, CalendarWastePickup>();
        for (const row of upcoming) {
          const category = row.category as WasteCategory;
          if (row.status === "skipped" || next.has(category)) continue;
          next.set(category, { category, date: row.date, detail: (row.detail as WasteDetail | null) ?? null });
        }
        return {
          settings,
          imports: imports.map(importDto),
          next: WASTE_CATEGORIES.flatMap((category) => {
            const pickup = next.get(category);
            return pickup === undefined ? [] : [pickup];
          }),
        } satisfies CalendarWasteOverviewResponse;
      });

      /* ------------------------------ preview, import -------------------------- */

      /** Bytes -> items -> parse -> the tour's pickups; every refusal is the module's 4xx/5xx. */
      const load = Effect.fn("CalendarWaste.load")(function* (userId: string, source: WasteSource) {
        yield* rateLimiter.enforce("calendar-waste", userId, WASTE_IMPORT_RULE);
        const fetched =
          source.kind === "url"
            ? yield* flyerFetch.fetch(source.provider, source.url)
            : { bytes: source.bytes, url: null };
        const items = yield* pdfText.extract(fetched.bytes);
        const parsed = parseHattingenFlyer(items);
        if (!parsed.ok) {
          return yield* wasteUnparseable(parsed.check, { date: parsed.date, readings: parsed.readings });
        }
        const pickups = selectTour(parsed, source.tour);
        if (pickups.length === 0) return yield* wasteUnparseable("noTourDates");
        return {
          provider: source.provider,
          year: parsed.year,
          tour: source.tour,
          pickups,
          warnings: parsed.warnings.map((warning) => ({ code: warning.code, date: warning.date })),
          source: source.kind,
          sourceName: (source.kind === "url" ? source.url : source.fileName).slice(0, 200),
          sourceUrl: source.kind === "url" ? source.url : null,
        } satisfies LoadedFlyer;
      });

      const preview = Effect.fn("CalendarWaste.preview")(function* (
        _householdId: string,
        userId: string,
        source: WasteSource,
      ) {
        const flyer = yield* load(userId, source);
        const counts = { waste_rest: 0, waste_yellow: 0, waste_bio: 0, waste_paper: 0, waste_tree: 0 };
        for (const pickup of flyer.pickups) counts[pickup.category] += 1;
        return {
          provider: flyer.provider,
          year: flyer.year,
          tour: flyer.tour,
          counts,
          dates: flyer.pickups.map((pickup) => ({ category: pickup.category, date: pickup.date, detail: pickup.detail })),
          warnings: flyer.warnings.map((warning) => ({ code: warning.code, date: warning.date })),
        } satisfies CalendarWastePreview;
      });

      const importFlyer = Effect.fn("CalendarWaste.importFlyer")(function* (
        householdId: string,
        userId: string,
        source: WasteSource,
      ) {
        // The PDF is read and parsed BEFORE the transaction: no database lock is held over pdf.js.
        const flyer = yield* load(userId, source);
        return yield* database.transaction(
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;

            // 1. The settings: provider, tour and the URL; mode and assignees kept (default none).
            yield* database.use((db) =>
              db
                .insert(calendarWasteSettings)
                .values({
                  householdId,
                  provider: flyer.provider,
                  tour: flyer.tour,
                  sourceUrl: flyer.sourceUrl,
                  assigneeMode: "none",
                  updatedAt: now,
                })
                .onConflictDoUpdate({
                  target: calendarWasteSettings.householdId,
                  set: {
                    provider: flyer.provider,
                    tour: flyer.tour,
                    updatedAt: now,
                    ...(flyer.sourceUrl === null ? {} : { sourceUrl: flyer.sourceUrl }),
                  },
                }),
            );
            const settings = (yield* readSettings(householdId))!;

            // 2. The states of the import this one replaces, by (category, date).
            const [previous] = yield* database.use((db) =>
              db
                .select({ id: calendarWasteImports.id })
                .from(calendarWasteImports)
                .where(
                  and(
                    eq(calendarWasteImports.householdId, householdId),
                    eq(calendarWasteImports.provider, flyer.provider),
                    eq(calendarWasteImports.year, flyer.year),
                  ),
                )
                .limit(1),
            );
            const carried = new Map<string, { status: string; doneBy: string | null; updatedAt: number }>();
            const carriedNotes = new Map<string, string>();
            const carriedAssignees = new Map<string, string>();
            if (previous !== undefined) {
              // 2a. Notes and hand-set assignees (P8: a member may change both on a pickup). An assignee counts as set by
              // hand when it names a person other than the rule's pick for that day; a hand-set "nobody" cannot be told
              // from a pickup left unassigned (a member who left, O-12) and is dealt again.
              const { index: oldIndex } = yield* householdPickupDays(householdId);
              const written = yield* database.use((db) =>
                db
                  .select({
                    category: calendarEntries.category,
                    date: calendarEntries.startDate,
                    notes: calendarEntries.notes,
                    userId: calendarEntryMembers.userId,
                    position: calendarEntryMembers.position,
                  })
                  .from(calendarEntries)
                  .leftJoin(
                    calendarEntryMembers,
                    and(eq(calendarEntryMembers.entryId, calendarEntries.id), eq(calendarEntryMembers.role, "assignee")),
                  )
                  .where(eq(calendarEntries.wasteImportId, previous.id))
                  .orderBy(asc(calendarEntries.id), asc(calendarEntryMembers.position)),
              );
              for (const row of written) {
                const key = `${row.category}|${row.date}`;
                if (row.notes !== null) carriedNotes.set(key, row.notes);
                if (row.userId === null || carriedAssignees.has(key)) continue;
                const rulePick = assigneeForDay(settings.assigneeMode, settings.assigneeIds, oldIndex.get(row.date) ?? 0);
                // The first assignee row is the person (a pickup stored with a rotation before P15's refusal: its first).
                if (row.position === 0 && row.userId !== rulePick) carriedAssignees.set(key, row.userId);
              }
              const states = yield* database.use((db) =>
                db
                  .select({
                    category: calendarEntries.category,
                    date: calendarOccurrenceStates.occurrenceDate,
                    status: calendarOccurrenceStates.status,
                    doneBy: calendarOccurrenceStates.doneBy,
                    updatedAt: calendarOccurrenceStates.updatedAt,
                  })
                  .from(calendarOccurrenceStates)
                  .innerJoin(calendarEntries, eq(calendarEntries.id, calendarOccurrenceStates.entryId))
                  .where(eq(calendarEntries.wasteImportId, previous.id)),
              );
              for (const state of states) {
                carried.set(`${state.category}|${state.date}`, {
                  status: state.status,
                  doneBy: state.doneBy,
                  updatedAt: state.updatedAt,
                });
              }
              // 3. The replaced import goes, its entries (and their members and states) with it.
              yield* database.use((db) => db.delete(calendarWasteImports).where(eq(calendarWasteImports.id, previous.id)));
            }

            // 4. The new import and its entries, the assignee per pickup day (P15).
            const importId = crypto.randomUUID();
            const importRow = {
              id: importId,
              householdId,
              provider: flyer.provider,
              year: flyer.year,
              tour: flyer.tour,
              source: flyer.source,
              sourceName: flyer.sourceName,
              entryCount: flyer.pickups.length,
              importedAt: now,
              importedBy: userId,
            };
            yield* database.use((db) => db.insert(calendarWasteImports).values(importRow));

            const entries = flyer.pickups.map((pickup) => ({
              pickup,
              row: {
                id: crypto.randomUUID(),
                householdId,
                kind: "task",
                title: null,
                notes: carriedNotes.get(`${pickup.category}|${pickup.date}`) ?? null,
                location: null,
                allDay: true,
                startDate: pickup.date,
                startTime: null,
                endDate: pickup.date,
                endTime: null,
                repeatFreq: "none",
                repeatInterval: 1,
                repeatWeekdays: null,
                repeatUntil: null,
                resourceId: null,
                assigneeMode: "none",
                category: pickup.category,
                categoryDetail: pickup.detail,
                wasteImportId: importId,
                createdBy: userId,
                createdAt: now,
                updatedAt: now,
              },
            }));
            for (const part of chunks(entries)) {
              yield* database.use((db) => db.insert(calendarEntries).values(part.map((entry) => entry.row)));
            }
            // The assignees under the rule, the day index over every import of the household (P15), then the hand-set ones.
            yield* assignEntries(householdId, settings.assigneeMode, settings.assigneeIds, null, now, importId);
            for (const entry of entries) {
              const userId = carriedAssignees.get(`${entry.pickup.category}|${entry.pickup.date}`);
              if (userId === undefined) continue;
              yield* database.use((db) =>
                db
                  .delete(calendarEntryMembers)
                  .where(and(eq(calendarEntryMembers.entryId, entry.row.id), eq(calendarEntryMembers.role, "assignee"))),
              );
              yield* database.use((db) =>
                db.update(calendarEntries).set({ assigneeMode: "fixed" }).where(eq(calendarEntries.id, entry.row.id)),
              );
              yield* database.use((db) =>
                db.insert(calendarEntryMembers).values({ entryId: entry.row.id, userId, role: "assignee", position: 0 }),
              );
            }

            // 5. The carried states whose (category, date) still exists.
            const stateRows = entries.flatMap((entry) => {
              const state = carried.get(`${entry.pickup.category}|${entry.pickup.date}`);
              return state === undefined
                ? []
                : [{ entryId: entry.row.id, occurrenceDate: entry.pickup.date, ...state }];
            });
            for (const part of chunks(stateRows)) {
              yield* database.use((db) => db.insert(calendarOccurrenceStates).values(part));
            }

            return { import: importDto(importRow), entryCount: entries.length } satisfies CalendarWasteImportResponse;
          }),
        );
      });

      const removeImport = Effect.fn("CalendarWaste.removeImport")(function* (householdId: string, importId: string) {
        const [row] = yield* database.use((db) =>
          db
            .select({ id: calendarWasteImports.id })
            .from(calendarWasteImports)
            .where(and(eq(calendarWasteImports.id, importId), eq(calendarWasteImports.householdId, householdId)))
            .limit(1),
        );
        if (row === undefined) return yield* new NotFound();
        yield* database.use((db) => db.delete(calendarWasteImports).where(eq(calendarWasteImports.id, row.id)));
      });

      return CalendarWaste.of({ overview, putSettings, preview, importFlyer, removeImport });
    }),
  );
}
