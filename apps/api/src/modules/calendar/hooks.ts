/**
 * The calendar module's member-removal hook (plan m8 P14): when a member leaves (or is removed), delete their
 * `calendar_entry_members` rows in the household's entries and their `calendar_waste_assignees` row, renumber the
 * remaining rotation positions, and degrade a rotation left with one person to `fixed`, with none to `none` (entries
 * and waste settings alike). No veto: a placeholder's appointments never block a removal. Car bookings keep their row
 * without a person; `done_by` keeps the user id.
 *
 * An Effect over the CURRENT `Database` executor (the core's open transaction), with direct drizzle statements, so it
 * also runs outside the runtime.
 *
 * FOUNDATION STUB (M8-T02): the lane api-core (M8-T07) replaces the body.
 */
import { Effect } from "effect";
import type { Database } from "../../db/database.ts";
import type { HookError } from "../types.ts";

export function calendarOnMemberRemoving(_householdId: string, _userId: string): Effect.Effect<void, HookError, Database> {
  return Effect.void;
}
