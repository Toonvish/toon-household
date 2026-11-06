/**
 * The calendar's waste routes (plan m8 section 5.2, P15-P17, P20), mounted at
 * /api/households/:householdId/calendar/waste behind the module chain (session -> member -> module) and the group's
 * `RequireVerifiedEmail` (writes only). The household comes from `CurrentMembership` (`:householdId`, D8); every
 * handler hands the work to `CalendarWaste` (`../services/waste/waste.service.ts`). The preview and import bodies are
 * read by `readWasteSource` (`../services/waste/upload.ts`): a JSON link or a multipart upload.
 *
 * Contract: docs/API.md "Calendar module", "Waste".
 */
import { CalendarWasteOverviewQuerySchema, PutCalendarWasteSettingsRequestSchema } from "@toon/shared";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { CurrentMembership, CurrentUser } from "../../../http/context.ts";
import { UNINTERRUPTIBLE } from "../../../http/middleware.ts";
import { jsonBody, queryParams } from "../../../http/request.ts";
import { created, json, noContent } from "../../../http/response.ts";
import { readWasteSource } from "../services/waste/upload.ts";
import { CalendarWaste } from "../services/waste/waste.service.ts";
import { CalendarWasteApi } from "./waste.api.ts";

export const calendarWasteHandlersLayer = HttpApiBuilder.group(CalendarWasteApi, "calendar.waste", (handlers) =>
  handlers
    /** GET / — `?from=` is the client's today (P16). */
    .handle(
      "overview",
      Effect.fn("calendar.waste.overview")(function* () {
        const query = yield* queryParams(CalendarWasteOverviewQuerySchema);
        const waste = yield* CalendarWaste;
        const { householdId } = yield* CurrentMembership;
        return json(yield* waste.overview(householdId, query.from));
      }),
      UNINTERRUPTIBLE,
    )
    /** PUT /settings (P15). */
    .handle(
      "putSettings",
      Effect.fn("calendar.waste.putSettings")(function* () {
        const body = yield* jsonBody(PutCalendarWasteSettingsRequestSchema);
        const waste = yield* CalendarWaste;
        const { householdId } = yield* CurrentMembership;
        return json(yield* waste.putSettings(householdId, body));
      }),
      UNINTERRUPTIBLE,
    )
    /** POST /preview — nothing is written. */
    .handle(
      "preview",
      Effect.fn("calendar.waste.preview")(function* () {
        const waste = yield* CalendarWaste;
        const user = yield* CurrentUser;
        const { householdId } = yield* CurrentMembership;
        const source = yield* readWasteSource;
        return json(yield* waste.preview(householdId, user.id, source));
      }),
      UNINTERRUPTIBLE,
    )
    /** POST /import (P20) — 201. */
    .handle(
      "import",
      Effect.fn("calendar.waste.import")(function* () {
        const waste = yield* CalendarWaste;
        const user = yield* CurrentUser;
        const { householdId } = yield* CurrentMembership;
        const source = yield* readWasteSource;
        return created(yield* waste.importFlyer(householdId, user.id, source));
      }),
      UNINTERRUPTIBLE,
    )
    /** DELETE /imports/:importId — 204; another household's import is 404. */
    .handle(
      "removeImport",
      Effect.fn("calendar.waste.removeImport")(function* ({ params }) {
        const waste = yield* CalendarWaste;
        const { householdId } = yield* CurrentMembership;
        yield* waste.removeImport(householdId, params.importId);
        return noContent();
      }),
      UNINTERRUPTIBLE,
    ),
);
