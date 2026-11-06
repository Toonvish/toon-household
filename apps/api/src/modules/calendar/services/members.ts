/**
 * `CalendarMembers` (plan m8 P9a, P6, P27): the household's members as the calendar sees them, and the check that
 * every member id of a request belongs to THIS household.
 *
 * - `list(householdId)`: every member (placeholders included, ADR 0006), sorted by join time
 *   (`household_members.created_at`, then `user_id`), each with `colorIndex` (`calendarPersonColors`: position mod 6,
 *   plus 1) and `hasAccount` (false for a placeholder). The occurrence list sends it as `members`, so a persisted list
 *   renders names and colours offline.
 * - `assertMembers(householdId, ids, path)`: `422 validation_failed` naming every id that is not a member, each at
 *   `<path>.<index>` (`attendeeIds.1`) with `server.calendar.memberNotInHousehold`; nothing when all are members.
 *
 * A leaf over `Database` (the CURRENT executor, read on every call, so a transaction reaches it). Its static `layer`
 * references only `effect` exports and its own class (CLAUDE.md "One composition point").
 */
import { type CalendarMember, DEFAULT_LOCALE, calendarPersonColors, serverText } from "@toon/shared";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { Database } from "../../../db/database.ts";
import { householdMembers, users } from "../../../db/schema.ts";
import { isPlaceholderUser } from "../../../core/services/auth/users.ts";
import { type DatabaseError, ValidationFailed } from "../../../lib/errors.ts";

export class CalendarMembers extends Context.Service<
  CalendarMembers,
  {
    /** The household's members in join order, with their colour (P9a). */
    readonly list: (householdId: string) => Effect.Effect<Array<CalendarMember>, DatabaseError>;
    /** Fails with `422 validation_failed` when an id of `ids` is not a member of the household (P6). */
    readonly assertMembers: (
      householdId: string,
      ids: ReadonlyArray<string>,
      path: string,
    ) => Effect.Effect<void, ValidationFailed | DatabaseError>;
  }
>()("toon/api/modules/calendar/services/members/CalendarMembers") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const database = yield* Database;

      const list = Effect.fn("CalendarMembers.list")(function* (householdId: string) {
        const rows = yield* database.use((db) =>
          db
            .select({
              userId: householdMembers.userId,
              name: users.name,
              email: users.email,
              passwordHash: users.passwordHash,
            })
            .from(householdMembers)
            .innerJoin(users, eq(users.id, householdMembers.userId))
            .where(eq(householdMembers.householdId, householdId))
            .orderBy(asc(householdMembers.createdAt), asc(householdMembers.userId)),
        );
        const colors = calendarPersonColors(rows);
        return rows.map(
          (row): CalendarMember => ({
            userId: row.userId,
            name: row.name,
            colorIndex: colors.get(row.userId) ?? 1,
            hasAccount: !isPlaceholderUser(row),
          }),
        );
      });

      const assertMembers = Effect.fn("CalendarMembers.assertMembers")(function* (
        householdId: string,
        ids: ReadonlyArray<string>,
        path: string,
      ) {
        if (ids.length === 0) return;
        const unique = [...new Set(ids)];
        const rows = yield* database.use((db) =>
          db
            .select({ userId: householdMembers.userId })
            .from(householdMembers)
            .where(and(eq(householdMembers.householdId, householdId), inArray(householdMembers.userId, unique))),
        );
        const members = new Set(rows.map((row) => row.userId));
        const details = ids.flatMap((id, index) =>
          members.has(id)
            ? []
            : [
                {
                  path: `${path}.${index}`,
                  code: "custom",
                  message: serverText(DEFAULT_LOCALE, "server.calendar.memberNotInHousehold"),
                  i18n: { key: "server.calendar.memberNotInHousehold" },
                },
              ],
        );
        if (details.length > 0) {
          return yield* new ValidationFailed({ details, text: "server.calendar.memberNotInHousehold" });
        }
      });

      return CalendarMembers.of({ list, assertMembers });
    }),
  );
}
