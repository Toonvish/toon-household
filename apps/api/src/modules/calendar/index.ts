/**
 * The calendar module's API manifest (docs/modules/calendar.md, ADR 0016, plan m8 P27): the household's shared
 * calendar — events for everybody or for named members, car bookings with a conflict check, chores with a rotating
 * assignee, and the import of the city's waste collection flyer — on the `calendar_` tables of `./schema.ts`. The
 * core reaches it only through `modules/index.ts`.
 *
 * `ApiModule<CalendarServices>`: `layer` is `Layer.suspend(calendarLayer)` (`./layer.ts`, a hoisted function, so
 * reading it here at module scope is TDZ-safe), merged by the runtime into the one `AppLayer` over the core.
 *
 * `householdApi`: the APIs and handlers of `./routes/index.ts`, read lazily (a getter over the hoisted
 * `calendarHouseholdApis()`, `Layer.suspend` over the hoisted `calendarHouseholdHandlers()`): this manifest is
 * evaluated inside the API's import cycle, where those route files may not be.
 *
 * Hooks (P14), Effects over `Database` only: `onMemberRemoving` (`./hooks.ts`, no veto) and `seedDemo` (`./seed.ts`).
 * No `onHouseholdCreated` / `onEnable` (the module needs no setup; `DEFAULT_ENABLED_MODULES` stays `["recipe"]`), no
 * `start` / `shutdown`, no `uploadReferences`.
 */
import { Layer } from "effect";
import type { ApiModule } from "../types.ts";
import { calendarOnMemberRemoving } from "./hooks.ts";
import { type CalendarServices, calendarLayer } from "./layer.ts";
import { calendarHouseholdApis, calendarHouseholdHandlers } from "./routes/index.ts";
import { calendarTables } from "./schema.ts";
import { seedCalendarDemo } from "./seed.ts";

export const calendarModule: ApiModule<CalendarServices> = {
  id: "calendar",
  householdApi: {
    get apis() {
      return calendarHouseholdApis();
    },
    handlers: Layer.suspend(() => calendarHouseholdHandlers()),
  },
  schema: calendarTables,
  layer: Layer.suspend(calendarLayer),
  onMemberRemoving: (householdId, userId) => calendarOnMemberRemoving(householdId, userId),
  seedDemo: (context) => seedCalendarDemo(context),
};
