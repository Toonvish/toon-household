/**
 * Served at /api/households/:householdId/calendar/resources (see ./core.index.ts; plan m8 section 5.2, P13): the
 * household's cars. The household comes from `:householdId` only (D8).
 */
import {
  type CalendarResourceListResponse,
  CalendarResourceListQuerySchema,
  CreateCalendarResourceRequestSchema,
  UpdateCalendarResourceRequestSchema,
} from "@toon/shared";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { CurrentMembership } from "../../../http/context.ts";
import { UNINTERRUPTIBLE } from "../../../http/middleware.ts";
import { jsonBody, queryParams } from "../../../http/request.ts";
import { created, json, noContent } from "../../../http/response.ts";
import { CalendarResources } from "../services/entries/resources.service.ts";
import { CalendarResourcesApi } from "./resources.api.ts";

export const calendarResourcesHandlers = HttpApiBuilder.group(CalendarResourcesApi, "calendar.resources", (handlers) =>
  handlers
    /** GET / — the cars by name; archived ones only with `includeArchived=true`. */
    .handle(
      "list",
      Effect.fn("calendar.resources.list")(function* () {
        const query = yield* queryParams(CalendarResourceListQuerySchema);
        const resources = yield* CalendarResources;
        const membership = yield* CurrentMembership;
        const payload: CalendarResourceListResponse = {
          items: yield* resources.list(membership.householdId, query.includeArchived === "true"),
        };
        return json(payload);
      }),
      UNINTERRUPTIBLE,
    )
    /** POST / — `{ name }`, 201. */
    .handle(
      "create",
      Effect.fn("calendar.resources.create")(function* () {
        const body = yield* jsonBody(CreateCalendarResourceRequestSchema);
        const resources = yield* CalendarResources;
        const membership = yield* CurrentMembership;
        const resource = yield* resources.create(membership.householdId, body);
        return created(resource, `/api/households/${membership.householdId}/calendar/resources/${resource.id}`);
      }),
      UNINTERRUPTIBLE,
    )
    /** PATCH /:resourceId — rename, archive or restore. */
    .handle(
      "update",
      Effect.fn("calendar.resources.update")(function* ({ params }) {
        const body = yield* jsonBody(UpdateCalendarResourceRequestSchema);
        const resources = yield* CalendarResources;
        const membership = yield* CurrentMembership;
        return json(yield* resources.update(membership.householdId, params.resourceId, body));
      }),
      UNINTERRUPTIBLE,
    )
    /** DELETE /:resourceId — 204; `409 calendar_resource_in_use` while bookings reference it. */
    .handle(
      "remove",
      Effect.fn("calendar.resources.remove")(function* ({ params }) {
        const resources = yield* CalendarResources;
        const membership = yield* CurrentMembership;
        yield* resources.remove(membership.householdId, params.resourceId);
        return noContent();
      }),
      UNINTERRUPTIBLE,
    ),
);
