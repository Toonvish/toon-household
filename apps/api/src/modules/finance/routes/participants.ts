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
import { Effect } from "effect";
import { runtime } from "../../../runtime.ts";
import {
  type FinanceParticipantListResponse,
  UpdateFinanceDisplayNameRequestSchema,
  UpdateFinanceParticipantsRequestSchema,
} from "@toon/shared";
import { Hono } from "hono";
import { json } from "../../../lib/http.ts";
import type { AppContext, AppEnv } from "../../../lib/types.ts";
import { currentMembership, currentUser } from "../../../lib/types.ts";
import { requireHouseholdRole } from "../../../middleware/household.ts";
import { requireVerifiedEmail } from "../../../middleware/verifiedEmail.ts";
import { validate } from "../../../lib/validate.ts";
import { requireFinanceParticipant, currentFinanceParticipant } from "../middleware.ts";
import { FinanceParticipants } from "../services/participants/participants.service.ts";

export const participantRoutes = new Hono<AppEnv>();

const participantList = Effect.fnUntraced(function* (c: AppContext, householdId: string) {
  const participantsService = yield* FinanceParticipants;
  const viewerId = (yield* currentUser(c)).id;
  const items = yield* participantsService.listParticipants(householdId);
  const viewer = items.find((item) => item.userId === viewerId);
  const payload: FinanceParticipantListResponse = { items, viewerSlot: viewer?.memberSlot ?? null };
  return payload;
});

/** GET /api/households/:householdId/finance/participants */
participantRoutes.get("/", (c) =>
runtime.runPromise(
Effect.gen(function* () {
  const membership = yield* currentMembership(c);
  return json(c, yield* participantList(c, membership.householdId));
}),
),
);

/** PUT /api/households/:householdId/finance/participants — owner/admin seats the two. */
participantRoutes.put(
  "/",
  requireVerifiedEmail(),
  requireHouseholdRole("admin"),
  validate("json", UpdateFinanceParticipantsRequestSchema),
  (c) =>
    runtime.runPromise(
      Effect.gen(function* () {
        const participantsService = yield* FinanceParticipants;
        const membership = yield* currentMembership(c);
        yield* participantsService.saveParticipants(membership.householdId, c.req.valid("json").participants);
        return json(c, yield* participantList(c, membership.householdId));
      }),
    ),
);

/** PATCH /api/households/:householdId/finance/participants/me — rename the caller's own display name. */
participantRoutes.patch(
  "/me",
  requireVerifiedEmail(),
  requireFinanceParticipant(),
  validate("json", UpdateFinanceDisplayNameRequestSchema),
  (c) =>
    runtime.runPromise(
      Effect.gen(function* () {
        const participantsService = yield* FinanceParticipants;
        const participant = yield* currentFinanceParticipant(c);
        const updated = yield* participantsService.updateParticipantDisplayName(
          participant.householdId,
          participant.userId,
          c.req.valid("json").displayName,
        );
        return json(c, updated);
      }),
    ),
);

/** PATCH /api/households/:householdId/finance/participants/:userId — rename a placeholder seat (404 / 403 in the service). */
participantRoutes.patch(
  "/:userId",
  requireVerifiedEmail(),
  requireFinanceParticipant(),
  validate("json", UpdateFinanceDisplayNameRequestSchema),
  (c) =>
    runtime.runPromise(
      Effect.gen(function* () {
        const participantsService = yield* FinanceParticipants;
        const participant = yield* currentFinanceParticipant(c);
        const updated = yield* participantsService.renamePlaceholderParticipant(
          participant.householdId,
          c.req.param("userId"),
          c.req.valid("json").displayName,
        );
        return json(c, updated);
      }),
    ),
);
