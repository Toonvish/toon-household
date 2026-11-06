/**
 * The calendar module's demo content for `bun run seed` (design §6, plan m8 P25): idempotent by its marker (the
 * household's car named in the design), dates relative to the Clock's date in Europe/Berlin, a synthetic waste
 * schedule (never data copied from the flyer). An Effect over the CURRENT `Database` executor only.
 *
 * FOUNDATION STUB (M8-T02): the lane api-core (M8-T07) replaces the body.
 */
import { Effect } from "effect";
import type { Database } from "../../db/database.ts";
import type { HookError, SeedDemoContext } from "../types.ts";

export function seedCalendarDemo(_context: SeedDemoContext): Effect.Effect<void, HookError, Database> {
  return Effect.void;
}
