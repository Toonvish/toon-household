/**
 * Finance participants (plan M3 decisions 3 and 4, SPEC D3), mounted at
 * /api/households/:householdId/finance/participants.
 *
 *   GET    /     any household member: the two participants by slot + the viewer's own slot
 *                (null for a member without a seat; the only finance route they reach)
 *   PUT    /     owner/admin: seat two members in slots 1 and 2 (rules in the service)
 *   PATCH  /me   a participant: rename their own display name in the budget
 *   PATCH  /:userId  a participant: rename the OTHER seat when it is a placeholder (no account)
 *
 * Auth: the module chain (modules/mount.ts) already ran the session, household-member and
 * module-enabled checks, in that order. This router adds the per-route
 * gates itself: GET must stay open to a non-participant, so nothing is mounted with use("*").
 */
import {
  type FinanceParticipantListResponse,
  UpdateFinanceDisplayNameRequestSchema,
  UpdateFinanceParticipantsRequestSchema,
} from "@toon/shared";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { CurrentMembership, CurrentUser } from "../../../http/context.ts";
import { UNINTERRUPTIBLE } from "../../../http/middleware.ts";
import { jsonBody } from "../../../http/request.ts";
import { json } from "../../../http/response.ts";
import { CurrentFinanceParticipant } from "../http.ts";
import { FinanceParticipants } from "../services/participants/participants.service.ts";
import { FinanceParticipantsApi } from "./participants.api.ts";

const participantList = Effect.fnUntraced(function* (householdId: string) {
  const participantsService = yield* FinanceParticipants;
  const viewerId = (yield* CurrentUser).id;
  const items = yield* participantsService.listParticipants(householdId);
  const viewer = items.find((item) => item.userId === viewerId);
  const payload: FinanceParticipantListResponse = { items, viewerSlot: viewer?.memberSlot ?? null };
  return payload;
});

export const participantsHandlers = HttpApiBuilder.group(FinanceParticipantsApi, "finance.participants", (handlers) =>
  handlers
    /** GET /api/households/:householdId/finance/participants */
    .handle(
      "get",
      Effect.fn("finance.participants.get")(function* () {
        const membership = yield* CurrentMembership;
        return json(yield* participantList(membership.householdId));
      }),
      UNINTERRUPTIBLE,
    )
    /** PUT /api/households/:householdId/finance/participants — owner/admin seats the two. */
    .handle(
      "put",
      Effect.fn("finance.participants.put")(function* () {
        const body = yield* jsonBody(UpdateFinanceParticipantsRequestSchema);
        const participantsService = yield* FinanceParticipants;
        const membership = yield* CurrentMembership;
        yield* participantsService.saveParticipants(membership.householdId, body.participants);
        return json(yield* participantList(membership.householdId));
      }),
      UNINTERRUPTIBLE,
    )
    /** PATCH /api/households/:householdId/finance/participants/me — rename the caller's own display name. */
    .handle(
      "patchMe",
      Effect.fn("finance.participants.patchMe")(function* () {
        const body = yield* jsonBody(UpdateFinanceDisplayNameRequestSchema);
        const participantsService = yield* FinanceParticipants;
        const participant = yield* CurrentFinanceParticipant;
        const updated = yield* participantsService.updateParticipantDisplayName(
          participant.householdId,
          participant.userId,
          body.displayName,
        );
        return json(updated);
      }),
      UNINTERRUPTIBLE,
    )
    /** PATCH /api/households/:householdId/finance/participants/:userId — rename a placeholder seat (404 / 403 in the service). */
    .handle(
      "patchByUserId",
      Effect.fn("finance.participants.patchByUserId")(function* ({ params }) {
        const body = yield* jsonBody(UpdateFinanceDisplayNameRequestSchema);
        const participantsService = yield* FinanceParticipants;
        const participant = yield* CurrentFinanceParticipant;
        const updated = yield* participantsService.renamePlaceholderParticipant(
          participant.householdId,
          params.userId,
          body.displayName,
        );
        return json(updated);
      }),
      UNINTERRUPTIBLE,
    ),
);
