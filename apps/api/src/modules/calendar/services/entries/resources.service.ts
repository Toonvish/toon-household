/**
 * `CalendarResources` (plan m8 P13, P6, P27): the household's cars.
 *
 * - `list(householdId, includeArchived)`: the cars by name (archived ones only when asked for).
 * - `create`, `update` (rename; `archived: true` stamps `archived_at` from the Clock, `false` clears it), `remove`
 *   (`409 calendar_resource_in_use` while any entry references the car: archive it instead).
 * - `assertBookable(householdId, resourceId)`: the entries' check of a booking's car: another household's id is
 *   `404 not_found` (D8, as finance's foreign `categoryId`), an archived own car `422 validation_failed` at `resourceId`
 *   with `server.calendar.resourceArchived`.
 *
 * A leaf over `Database` (the CURRENT executor and the Clock read on every call). Its static `layer` references only
 * `effect` exports and its own class (CLAUDE.md "One composition point").
 */
import {
  type CalendarResource,
  type CreateCalendarResourceRequest,
  DEFAULT_LOCALE,
  type UpdateCalendarResourceRequest,
  serverText,
} from "@toon/shared";
import { and, asc, eq, isNull } from "drizzle-orm";
import { Clock, Context, Effect, Layer } from "effect";
import { Database } from "../../../../db/database.ts";
import { ApiFailure, type DatabaseError, NotFound, ValidationFailed } from "../../../../lib/errors.ts";
import { toIso } from "../../../../lib/http.ts";
import { type CalendarResourceRow, calendarEntries, calendarResources } from "../../schema.ts";

function toResourceDto(row: CalendarResourceRow): CalendarResource {
  return {
    id: row.id,
    kind: "car",
    name: row.name,
    archived: row.archivedAt !== null,
    archivedAt: row.archivedAt === null ? null : toIso(row.archivedAt),
    createdAt: toIso(row.createdAt),
  };
}

export class CalendarResources extends Context.Service<
  CalendarResources,
  {
    readonly list: (householdId: string, includeArchived: boolean) => Effect.Effect<Array<CalendarResource>, DatabaseError>;
    readonly create: (
      householdId: string,
      input: CreateCalendarResourceRequest,
    ) => Effect.Effect<CalendarResource, DatabaseError>;
    readonly update: (
      householdId: string,
      resourceId: string,
      input: UpdateCalendarResourceRequest,
    ) => Effect.Effect<CalendarResource, NotFound | DatabaseError>;
    /** `409 calendar_resource_in_use` while any entry references the car. */
    readonly remove: (householdId: string, resourceId: string) => Effect.Effect<void, NotFound | ApiFailure | DatabaseError>;
    /** A booking's car: own (else 404) and not archived (else 422 at `resourceId`). */
    readonly assertBookable: (
      householdId: string,
      resourceId: string,
    ) => Effect.Effect<void, NotFound | ValidationFailed | DatabaseError>;
  }
>()("toon/api/modules/calendar/services/entries/resources.service/CalendarResources") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const database = yield* Database;

      const loadOr404 = Effect.fnUntraced(function* (householdId: string, resourceId: string) {
        const rows = yield* database.use((db) =>
          db
            .select()
            .from(calendarResources)
            .where(and(eq(calendarResources.id, resourceId), eq(calendarResources.householdId, householdId)))
            .limit(1),
        );
        const row = rows[0];
        if (row === undefined) return yield* new NotFound();
        return row;
      });

      const list = Effect.fn("CalendarResources.list")(function* (householdId: string, includeArchived: boolean) {
        const filter = includeArchived
          ? eq(calendarResources.householdId, householdId)
          : and(eq(calendarResources.householdId, householdId), isNull(calendarResources.archivedAt));
        const rows = yield* database.use((db) =>
          db
            .select()
            .from(calendarResources)
            .where(filter)
            .orderBy(asc(calendarResources.name), asc(calendarResources.createdAt), asc(calendarResources.id)),
        );
        return rows.map(toResourceDto);
      });

      const create = Effect.fn("CalendarResources.create")(function* (
        householdId: string,
        input: CreateCalendarResourceRequest,
      ) {
        const now = yield* Clock.currentTimeMillis;
        const row: CalendarResourceRow = {
          id: crypto.randomUUID(),
          householdId,
          kind: "car",
          name: input.name,
          archivedAt: null,
          createdAt: now,
        };
        yield* database.use((db) => db.insert(calendarResources).values(row));
        return toResourceDto(row);
      });

      const update = Effect.fn("CalendarResources.update")(function* (
        householdId: string,
        resourceId: string,
        input: UpdateCalendarResourceRequest,
      ) {
        const row = yield* loadOr404(householdId, resourceId);
        const patch: Partial<CalendarResourceRow> = {};
        if (input.name !== undefined) patch.name = input.name;
        if (input.archived === true && row.archivedAt === null) patch.archivedAt = yield* Clock.currentTimeMillis;
        if (input.archived === false) patch.archivedAt = null;
        if (Object.keys(patch).length === 0) return toResourceDto(row);
        yield* database.use((db) =>
          db
            .update(calendarResources)
            .set(patch)
            .where(and(eq(calendarResources.id, resourceId), eq(calendarResources.householdId, householdId))),
        );
        return toResourceDto({ ...row, ...patch });
      });

      const remove = Effect.fn("CalendarResources.remove")(function* (householdId: string, resourceId: string) {
        yield* loadOr404(householdId, resourceId);
        const bookings = yield* database.use((db) =>
          db.select({ id: calendarEntries.id }).from(calendarEntries).where(eq(calendarEntries.resourceId, resourceId)).limit(1),
        );
        if (bookings.length > 0) {
          return yield* new ApiFailure({ status: 409, code: "calendar_resource_in_use", text: "server.calendar.resourceInUse" });
        }
        yield* database.use((db) =>
          db
            .delete(calendarResources)
            .where(and(eq(calendarResources.id, resourceId), eq(calendarResources.householdId, householdId))),
        );
      });

      const assertBookable = Effect.fn("CalendarResources.assertBookable")(function* (
        householdId: string,
        resourceId: string,
      ) {
        const row = yield* loadOr404(householdId, resourceId);
        if (row.archivedAt !== null) {
          const key = "server.calendar.resourceArchived";
          return yield* new ValidationFailed({
            text: key,
            details: [{ path: "resourceId", code: "custom", message: serverText(DEFAULT_LOCALE, key), i18n: { key } }],
          });
        }
      });

      return CalendarResources.of({ list, create, update, remove, assertBookable });
    }),
  );
}
