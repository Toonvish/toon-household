import { gen, leaf, uniqueIds, type Case } from "./_lib.ts";
import { ID, ID2, ID3, TS, rep } from "./_fixtures.ts";

const PARTICIPANT = { userId: ID, memberSlot: 1, displayName: "Anna", name: "Anna Muster", email: "anna@example.de", hasAccount: true, joinedAt: TS };
const SEATS = [
  { userId: ID, memberSlot: 1 },
  { userId: ID2, memberSlot: 2 },
];
const NAMES = ["Anna", "  Anna  ", "A", "", " ", "\t", "a\u0000b", "a\nb", "a\u007fb", rep("a", 80), rep("a", 81), `  ${rep("a", 80)}  `, `${rep("a", 81)}\u0000`, "Çelik", "😀"];

export const cases: Case[] = uniqueIds([
  ...leaf("FinanceDisplayNameSchema", NAMES),
  ...gen("FinanceParticipantResponseSchema", PARTICIPANT, {
    allNull: { ...PARTICIPANT, email: null },
    extra: { "slot-0": { ...PARTICIPANT, memberSlot: 0 }, "slot-3": { ...PARTICIPANT, memberSlot: 3 }, "slot-string": { ...PARTICIPANT, memberSlot: "1" }, "slot-2": { ...PARTICIPANT, memberSlot: 2 } },
  }),
  ...gen("FinanceParticipantListResponseSchema", { items: [PARTICIPANT], viewerSlot: 1 }, {
    minimal: { items: [], viewerSlot: null },
    extra: {
      "viewer-2": { items: [PARTICIPANT], viewerSlot: 2 },
      "viewer-3": { items: [PARTICIPANT], viewerSlot: 3 },
      "viewer-undefined": { items: [PARTICIPANT], viewerSlot: undefined },
      "viewer-absent": { items: [PARTICIPANT] },
      "second-bad": { items: [PARTICIPANT, { userId: "x" }], viewerSlot: null },
    },
  }),
  ...gen("FinanceParticipantAssignmentSchema", SEATS, {
    mode: "full",
    extra: {
      "slots-swapped": [{ userId: ID, memberSlot: 2 }, { userId: ID2, memberSlot: 1 }],
      "same-slot": [{ userId: ID, memberSlot: 1 }, { userId: ID2, memberSlot: 1 }],
      "same-user": [{ userId: ID, memberSlot: 1 }, { userId: ID, memberSlot: 2 }],
      empty: [],
      one: [SEATS[0]],
      three: [...SEATS, { userId: ID3, memberSlot: 1 }],
      four: [...SEATS, ...SEATS],
      "first-bad": [{ userId: "x", memberSlot: 1 }, SEATS[1]],
      "both-bad": [{ userId: "x", memberSlot: 3 }, { userId: 1, memberSlot: "2" }],
      "one-bad": [{ userId: "x", memberSlot: 3 }],
      "three-bad": [{ userId: "x", memberSlot: 3 }, SEATS[1], SEATS[0]],
      "elements-null": [null, null],
      "elements-empty": [{}, {}],
      "extra-key": [{ ...SEATS[0], extra: 1 }, SEATS[1]],
      "object-not-array": { 0: SEATS[0], 1: SEATS[1], length: 2 },
    },
  }),
  ...gen("UpdateFinanceParticipantsRequestSchema", { participants: SEATS }, {
    mode: "full",
    extra: {
      empty: { participants: [] },
      one: { participants: [SEATS[0]] },
      three: { participants: [...SEATS, SEATS[0]] },
      "bad-and-length": { participants: [{ userId: "x", memberSlot: 3 }] },
      "participants-null": { participants: null },
    },
  }),
  ...gen("FinanceEnableSettingsSchema", { participants: SEATS }, {
    mode: "full",
    extra: { empty: { participants: [] }, one: { participants: [SEATS[0]] }, "bad-slot": { participants: [{ userId: ID, memberSlot: 0 }, SEATS[1]] } },
  }),
  ...gen("UpdateFinanceDisplayNameRequestSchema", { displayName: "Anna" }, {
    mode: "full",
    lens: { displayName: [80, 81] },
    extra: { padded: { displayName: "  Anna  " }, control: { displayName: "a\u0000b" }, "name-instead": { name: "Anna" } },
  }),
]);
