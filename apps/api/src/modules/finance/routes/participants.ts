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
import { zValidator } from "@hono/zod-validator";
import {
  type FinanceParticipantListResponse,
  UpdateFinanceDisplayNameRequestSchema,
  UpdateFinanceParticipantsRequestSchema,
} from "@toon/shared";
import { Hono } from "hono";
import { db } from "../../../db/client.ts";
import { json } from "../../../lib/http.ts";
import type { AppContext, AppEnv } from "../../../lib/types.ts";
import { requireMembership, requireUser } from "../../../lib/types.ts";
import { requireHouseholdRole } from "../../../middleware/household.ts";
import { requireVerifiedEmail } from "../../../middleware/verifiedEmail.ts";
import { onValidationError } from "../../../core/services/households/validation.ts";
import { requireFinanceParticipant, requireFinanceParticipantContext } from "../middleware.ts";
import {
  listParticipants,
  renamePlaceholderParticipant,
  saveParticipants,
  updateParticipantDisplayName,
} from "../services/participants/participants.service.ts";

export const participantRoutes = new Hono<AppEnv>();

async function participantList(c: AppContext, householdId: string): Promise<FinanceParticipantListResponse> {
  const viewerId = requireUser(c).id;
  const items = await listParticipants(db, householdId);
  const viewer = items.find((item) => item.userId === viewerId);
  return { items, viewerSlot: viewer?.memberSlot ?? null };
}

/** GET /api/households/:householdId/finance/participants */
participantRoutes.get("/", async (c) => {
  const membership = requireMembership(c);
  return json(c, await participantList(c, membership.householdId));
});

/** PUT /api/households/:householdId/finance/participants — owner/admin seats the two. */
participantRoutes.put(
  "/",
  requireVerifiedEmail(),
  requireHouseholdRole("admin"),
  zValidator("json", UpdateFinanceParticipantsRequestSchema, onValidationError),
  async (c) => {
    const membership = requireMembership(c);
    await saveParticipants(db, membership.householdId, c.req.valid("json").participants);
    return json(c, await participantList(c, membership.householdId));
  },
);

/** PATCH /api/households/:householdId/finance/participants/me — rename the caller's own display name. */
participantRoutes.patch(
  "/me",
  requireVerifiedEmail(),
  requireFinanceParticipant(),
  zValidator("json", UpdateFinanceDisplayNameRequestSchema, onValidationError),
  async (c) => {
    const participant = requireFinanceParticipantContext(c);
    const updated = await updateParticipantDisplayName(
      db,
      participant.householdId,
      participant.userId,
      c.req.valid("json").displayName,
    );
    return json(c, updated);
  },
);

/** PATCH /api/households/:householdId/finance/participants/:userId — rename a placeholder seat (404 / 403 in the service). */
participantRoutes.patch(
  "/:userId",
  requireVerifiedEmail(),
  requireFinanceParticipant(),
  zValidator("json", UpdateFinanceDisplayNameRequestSchema, onValidationError),
  async (c) => {
    const participant = requireFinanceParticipantContext(c);
    const updated = await renamePlaceholderParticipant(
      db,
      participant.householdId,
      c.req.param("userId"),
      c.req.valid("json").displayName,
    );
    return json(c, updated);
  },
);
