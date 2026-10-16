import { enumLeaf, gen, singleKeys, uniqueIds, type Case } from "./_lib.ts";
import { HOUSEHOLD, HOUSEHOLD_WITH_ROLE, ID, ID2, ID3, MEMBER, PUBLIC_USER, TS, rep } from "./_fixtures.ts";

const INVITE = {
  id: ID,
  householdId: ID2,
  email: "gast@example.de",
  role: "member",
  token: rep("k", 32),
  status: "pending",
  invitedBy: ID3,
  invitedByName: "Anna",
  expiresAt: TS,
  createdAt: TS,
  acceptedAt: TS,
  claimsUserId: ID,
};
const INVITE_MINIMAL = { ...INVITE, email: null, claimsUserId: null };
delete (INVITE_MINIMAL as Record<string, unknown>).acceptedAt;

const PREVIEW = { householdName: "Familie", invitedByName: "Anna", email: "gast@example.de", role: "member", status: "pending", expiresAt: TS, claimsDisplayName: "Robin" };

export const cases: Case[] = uniqueIds([
  ...enumLeaf("HouseholdRoleSchema", ["owner", "admin", "member"]),
  ...enumLeaf("InvitableRoleSchema", ["admin", "member"], ["owner"]),
  ...enumLeaf("InviteStatusSchema", ["pending", "accepted", "revoked", "expired"]),

  ...gen("HouseholdSchema", HOUSEHOLD, {
    minimal: { id: ID2, name: "F", createdBy: ID, createdAt: TS, updatedAt: TS },
    allNull: { ...HOUSEHOLD, description: null, imageUrl: null },
  }),
  ...gen("HouseholdWithRoleSchema", HOUSEHOLD_WITH_ROLE, {
    minimal: { id: ID2, name: "F", createdBy: ID, createdAt: TS, updatedAt: TS, role: "member", memberCount: 0, modules: [] },
    allNull: { ...HOUSEHOLD_WITH_ROLE, description: null, imageUrl: null },
    extra: {
      "member-count-negative": { ...HOUSEHOLD_WITH_ROLE, memberCount: -1 },
      "member-count-fraction": { ...HOUSEHOLD_WITH_ROLE, memberCount: 1.5 },
      "role-bad": { ...HOUSEHOLD_WITH_ROLE, role: "root" },
      "modules-unknown-id": { ...HOUSEHOLD_WITH_ROLE, modules: ["recipe", "unknown"] },
      "two-bad": { ...HOUSEHOLD_WITH_ROLE, id: "x", role: "y", memberCount: -1 },
    },
  }),
  ...gen("HouseholdMemberSchema", MEMBER, {
    extra: { "role-bad": { ...MEMBER, role: "root" }, "user-bad": { ...MEMBER, user: { id: "x" } }, "user-null": { ...MEMBER, user: null } },
  }),
  ...gen("HouseholdInviteSchema", INVITE, {
    minimal: INVITE_MINIMAL,
    allNull: { ...INVITE, email: null, claimsUserId: null, acceptedAt: null },
    extra: { "role-owner": { ...INVITE, role: "owner" }, "status-bad": { ...INVITE, status: "open" } },
  }),

  ...gen("CreateHouseholdRequestSchema", { name: "Familie", description: "Zuhause" }, {
    mode: "full",
    minimal: { name: "Familie" },
    lens: { name: [79, 80, 81], description: [499, 500, 501] },
    extra: {
      "name-padded": { name: "  Familie  " },
      "name-control": { name: "a\u0000b" },
      "name-newline": { name: "a\nb" },
      "description-padded": { name: "F", description: "  d  " },
      "description-blank": { name: "F", description: "   " },
      "description-padded-long": { name: "F", description: `  ${rep("d", 500)}  ` },
      "description-null": { name: "F", description: null },
      "description-control": { name: "F", description: "a\u0000b" },
      "both-bad": { name: "", description: rep("d", 501) },
      "name-long-and-control": { name: `${rep("a", 81)}\u0000` },
    },
  }),
  ...gen("UpdateHouseholdRequestSchema", { name: "Familie", description: "Zuhause", imageUrl: "/uploads/h.png" }, {
    mode: "full",
    lens: { name: [80, 81], description: [500, 501], imageUrl: [1000, 1001] },
    extra: {
      empty: {},
      "unknown-only": { foo: 1 },
      "all-undefined": { name: undefined, description: undefined, imageUrl: undefined },
      "all-null": { description: null, imageUrl: null },
      "name-null": { name: null },
      "name-bad-and-unknown": { name: "", foo: 1 },
      "two-bad": { name: "", imageUrl: rep("i", 1001) },
      "description-padded": { description: "  d  " },
    },
  }),
  ...singleKeys("UpdateHouseholdRequestSchema", { name: "Familie", description: "Zuhause", imageUrl: "/uploads/h.png" }),
  ...gen("CreateInviteRequestSchema", { email: "gast@example.de", role: "admin", claimsUserId: ID }, {
    mode: "full",
    minimal: { email: "gast@example.de" },
    extra: {
      "role-default": { email: "gast@example.de" },
      "role-owner": { email: "gast@example.de", role: "owner" },
      "role-undefined": { email: "gast@example.de", role: undefined },
      "role-null": { email: "gast@example.de", role: null },
      "claim-only": { claimsUserId: ID },
      "claim-only-role": { claimsUserId: ID, role: "member" },
      "email-only-undefined": { email: undefined, claimsUserId: undefined },
      empty: {},
      "role-only": { role: "member" },
      "claim-null": { claimsUserId: null },
      "claim-null-with-email": { email: "gast@example.de", claimsUserId: null },
      "email-null": { email: null },
      "email-bad": { email: "x" },
      "email-bad-and-claim": { email: "x", claimsUserId: ID },
      "email-case": { email: "  GAST@Example.DE " },
      "claim-bad": { claimsUserId: "x" },
      "claim-bad-with-email": { email: "gast@example.de", claimsUserId: "x" },
      "role-bad-no-email": { role: "root" },
      "unknown-only": { foo: 1 },
    },
  }),
  ...singleKeys("CreateInviteRequestSchema", { email: "gast@example.de", role: "admin", claimsUserId: ID }),
  ...gen("CreatePlaceholderMemberRequestSchema", { displayName: "Robin" }, {
    mode: "full",
    lens: { displayName: [80, 81] },
    extra: { padded: { displayName: "  Robin  " }, control: { displayName: "a\u0000b" }, blank: { displayName: "   " } },
  }),
  ...gen("UpdatePlaceholderMemberRequestSchema", { name: "Robin" }, {
    mode: "full",
    lens: { name: [80, 81] },
    extra: { padded: { name: "  Robin  " }, control: { name: "a\u0000b" }, "display-name-instead": { displayName: "Robin" } },
  }),
  ...gen("UpdateMemberRoleRequestSchema", { role: "admin" }, {
    mode: "full",
    extra: { owner: { role: "owner" }, member: { role: "member" }, bad: { role: "root" }, upper: { role: "ADMIN" } },
  }),
  ...gen("AcceptInviteRequestSchema", { token: rep("k", 32) }, {
    mode: "full",
    lens: { token: [9, 10, 200, 201] },
    extra: { padded: { token: `  ${rep("k", 10)}  ` } },
  }),
  ...gen("EnableModuleRequestSchema", { settings: { participants: [{ userId: ID, memberSlot: 1 }], flag: true, n: 1, nested: { a: [1, 2] } } }, {
    mode: "full",
    minimal: {},
    extra: {
      "settings-empty": { settings: {} },
      "settings-null": { settings: null },
      "settings-array": { settings: [] },
      "settings-array-filled": { settings: [1] },
      "settings-string": { settings: "x" },
      "settings-number": { settings: 1 },
      "settings-undefined": { settings: undefined },
      "settings-nan-value": { settings: { n: Number.NaN } },
      "settings-undefined-value": { settings: { n: undefined } },
      "settings-null-value": { settings: { n: null } },
      "unknown-key": { settings: {}, extra: 1 },
    },
  }),

  ...gen("HouseholdResponseSchema", { household: HOUSEHOLD_WITH_ROLE }, { depth: 0 }),
  ...gen("HouseholdListResponseSchema", { items: [HOUSEHOLD_WITH_ROLE] }, { depth: 0, minimal: { items: [] } }),
  ...gen("HouseholdDetailResponseSchema", { household: HOUSEHOLD_WITH_ROLE, members: [MEMBER] }, { depth: 0, minimal: { household: HOUSEHOLD_WITH_ROLE, members: [] } }),
  ...gen("HouseholdMemberResponseSchema", { member: MEMBER }, { depth: 0 }),
  ...gen("HouseholdMemberListResponseSchema", { items: [MEMBER] }, { depth: 0, minimal: { items: [] } }),
  ...gen("HouseholdInviteResponseSchema", { invite: INVITE, inviteUrl: "https://app/invite/x", emailSent: true, mailDelivery: "sent" }, {
    depth: 0,
    minimal: { invite: INVITE, inviteUrl: "u" },
    extra: { "mail-bad": { invite: INVITE, inviteUrl: "u", mailDelivery: "queued" }, "mail-null": { invite: INVITE, inviteUrl: "u", mailDelivery: null }, "mail-states": { invite: INVITE, inviteUrl: "u", mailDelivery: "not_configured" } },
  }),
  ...gen("HouseholdInviteListResponseSchema", { items: [INVITE], total: 1, limit: 24, offset: 0 }, {
    depth: 0,
    minimal: { items: [], total: 0, limit: 1, offset: 0 },
    extra: {
      "limit-zero": { items: [], total: 0, limit: 0, offset: 0 },
      "total-negative": { items: [], total: -1, limit: 1, offset: 0 },
      "offset-negative": { items: [], total: 0, limit: 1, offset: -1 },
      "total-fraction": { items: [], total: 0.5, limit: 1, offset: 0 },
      "item-bad": { items: [{ id: "x" }], total: 1, limit: 1, offset: 0 },
    },
  }),
  ...gen("InvitePreviewResponseSchema", PREVIEW, {
    allNull: { ...PREVIEW, email: null, claimsDisplayName: null },
    extra: { "role-owner": { ...PREVIEW, role: "owner" }, "status-bad": { ...PREVIEW, status: "open" } },
  }),
  ...gen("AcceptInviteResponseSchema", { household: HOUSEHOLD_WITH_ROLE, member: { ...MEMBER, user: PUBLIC_USER } }, { depth: 0 }),
]);
