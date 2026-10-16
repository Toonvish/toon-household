import { gen, uniqueIds, type Case } from "./_lib.ts";
import { HOUSEHOLD_WITH_ROLE, ID, ID2, USER } from "./_fixtures.ts";

const SESSION_RESPONSE = { user: USER, households: [HOUSEHOLD_WITH_ROLE], activeHouseholdId: ID2 };

export const cases: Case[] = uniqueIds([
  ...gen("AuthSessionResponseSchema", SESSION_RESPONSE, {
    depth: 0,
    minimal: { user: USER, households: [] },
    allNull: { ...SESSION_RESPONSE, activeHouseholdId: null },
    extra: {
      "household-bad": { ...SESSION_RESPONSE, households: [{ id: "x" }] },
      "second-household-bad": { ...SESSION_RESPONSE, households: [HOUSEHOLD_WITH_ROLE, 1] },
      "active-bad": { ...SESSION_RESPONSE, activeHouseholdId: "x" },
      "user-and-active-bad": { user: { id: 1 }, households: "x", activeHouseholdId: 1 },
      "user-id-only": { user: { id: ID }, households: [] },
    },
  }),
  ...gen("MeResponseSchema", SESSION_RESPONSE, {
    depth: 0,
    minimal: { user: USER, households: [] },
    allNull: { ...SESSION_RESPONSE, activeHouseholdId: null },
    extra: { "household-bad": { ...SESSION_RESPONSE, households: [{ id: "x" }] } },
  }),
  ...gen("EmailVerificationRequestResponseSchema", { mailDelivery: "sent" }, {
    mode: "full",
    extra: { "not-configured": { mailDelivery: "not_configured" }, failed: { mailDelivery: "failed" }, bad: { mailDelivery: "queued" }, upper: { mailDelivery: "SENT" } },
  }),
]);
