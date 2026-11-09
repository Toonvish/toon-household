/**
 * The calendar module's member-removal hook (plan m8 P14): when a member leaves (or is removed), delete their
 * `calendar_entry_members` rows in the household's entries and their `calendar_waste_assignees` row, renumber the
 * remaining positions, and degrade a rotation left with one person to `fixed`, with none to `none` (a `fixed` task left
 * with nobody becomes `none`); entries and waste settings alike. No veto: a placeholder's appointments never block a
 * removal. Car bookings keep their row without a person; `done_by` keeps the user id (the web shows an unknown id as a
 * former member). The leaver's subscription link of this household (`calendar_feed_tokens`, M9 P14) is deleted first.
 *
 * An Effect over the CURRENT `Database` executor (the core's open transaction: `removeMember` runs every module's hook
 * inside it), with direct drizzle statements and no calendar service, so it also runs outside the runtime. Its
 * module scope reads nothing of the import cycle: `Database` is yielded when the hook runs.
 */
import { and, asc, eq } from "drizzle-orm";
import { Clock, Effect } from "effect";
import { Database } from "../../db/database.ts";
import {
  calendarEntries,
  calendarEntryMembers,
  calendarFeedTokens,
  calendarWasteAssignees,
  calendarWasteSettings,
} from "./schema.ts";

/** The mode a rule keeps with `count` people left (P14). */
function degradedMode(mode: string, count: number): string {
  if (count === 0) return "none";
  if (mode === "rotate" && count === 1) return "fixed";
  return mode;
}

export const calendarOnMemberRemoving = Effect.fn("calendar.onMemberRemoving")(function* (householdId: string, userId: string) {
  const database = yield* Database;
  const now = yield* Clock.currentTimeMillis;

  // --- the leaver's subscription link of this household (plan m9 P14): it stops resolving at once ----------------------
  yield* database.use((db) =>
    db
      .delete(calendarFeedTokens)
      .where(and(eq(calendarFeedTokens.householdId, householdId), eq(calendarFeedTokens.userId, userId))),
  );

  // --- entries: the leaving member's attendee and assignee rows -----------------------------------------------------
  const affected = yield* database.use((db) =>
    db
      .selectDistinct({ entryId: calendarEntryMembers.entryId })
      .from(calendarEntryMembers)
      .innerJoin(calendarEntries, eq(calendarEntries.id, calendarEntryMembers.entryId))
      .where(and(eq(calendarEntries.householdId, householdId), eq(calendarEntryMembers.userId, userId))),
  );
  for (const { entryId } of affected) {
    yield* database.use((db) =>
      db
        .delete(calendarEntryMembers)
        .where(and(eq(calendarEntryMembers.entryId, entryId), eq(calendarEntryMembers.userId, userId))),
    );
    const rest = yield* database.use((db) =>
      db
        .select()
        .from(calendarEntryMembers)
        .where(eq(calendarEntryMembers.entryId, entryId))
        .orderBy(asc(calendarEntryMembers.position), asc(calendarEntryMembers.userId)),
    );
    for (const role of ["attendee", "assignee"] as const) {
      const members = rest.filter((member) => member.role === role);
      for (const [position, member] of members.entries()) {
        if (member.position === position) continue;
        yield* database.use((db) =>
          db
            .update(calendarEntryMembers)
            .set({ position })
            .where(
              and(
                eq(calendarEntryMembers.entryId, entryId),
                eq(calendarEntryMembers.userId, member.userId),
                eq(calendarEntryMembers.role, role),
              ),
            ),
        );
      }
    }
    const entry = (yield* database.use((db) =>
      db.select({ assigneeMode: calendarEntries.assigneeMode }).from(calendarEntries).where(eq(calendarEntries.id, entryId)),
    ))[0];
    const assignees = rest.filter((member) => member.role === "assignee").length;
    const mode = entry === undefined ? "none" : degradedMode(entry.assigneeMode, assignees);
    yield* database.use((db) =>
      db
        .update(calendarEntries)
        .set(entry !== undefined && mode !== entry.assigneeMode ? { assigneeMode: mode, updatedAt: now } : { updatedAt: now })
        .where(eq(calendarEntries.id, entryId)),
    );
  }

  // --- waste settings: the rotation of the pickups --------------------------------------------------------------------
  const removed = yield* database.use((db) =>
    db
      .delete(calendarWasteAssignees)
      .where(and(eq(calendarWasteAssignees.householdId, householdId), eq(calendarWasteAssignees.userId, userId)))
      .returning({ userId: calendarWasteAssignees.userId }),
  );
  if (removed.length === 0) return;
  const rest = yield* database.use((db) =>
    db
      .select()
      .from(calendarWasteAssignees)
      .where(eq(calendarWasteAssignees.householdId, householdId))
      .orderBy(asc(calendarWasteAssignees.position), asc(calendarWasteAssignees.userId)),
  );
  for (const [position, member] of rest.entries()) {
    if (member.position === position) continue;
    yield* database.use((db) =>
      db
        .update(calendarWasteAssignees)
        .set({ position })
        .where(
          and(eq(calendarWasteAssignees.householdId, householdId), eq(calendarWasteAssignees.userId, member.userId)),
        ),
    );
  }
  const settings = (yield* database.use((db) =>
    db.select().from(calendarWasteSettings).where(eq(calendarWasteSettings.householdId, householdId)),
  ))[0];
  if (settings === undefined) return;
  const mode = degradedMode(settings.assigneeMode, rest.length);
  yield* database.use((db) =>
    db
      .update(calendarWasteSettings)
      .set({ assigneeMode: mode, updatedAt: now })
      .where(eq(calendarWasteSettings.householdId, householdId)),
  );
});
