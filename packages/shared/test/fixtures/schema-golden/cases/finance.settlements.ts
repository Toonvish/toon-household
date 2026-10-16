import { gen, singleKeys, uniqueIds, type Case } from "./_lib.ts";
import { BALANCE, ID, TS, TX, rep } from "./_fixtures.ts";

const REQUEST = { expectedBalanceCents: 625, amountCents: 300, note: "Bar bezahlt", bookedAt: TS, mutationId: ID };

export const cases: Case[] = uniqueIds([
  ...gen("CreateSettlementRequestSchema", REQUEST, {
    mode: "full",
    minimal: { expectedBalanceCents: 0 },
    lens: { note: [199, 200, 201] },
    extra: {
      "expected-negative": { expectedBalanceCents: -625 },
      "expected-fraction": { expectedBalanceCents: 0.5 },
      "expected-string": { expectedBalanceCents: "625" },
      "amount-zero": { expectedBalanceCents: 0, amountCents: 0 },
      "amount-negative": { expectedBalanceCents: 0, amountCents: -1 },
      "amount-fraction": { expectedBalanceCents: 0, amountCents: 1.5 },
      "amount-max-safe": { expectedBalanceCents: 0, amountCents: 9007199254740991 },
      "amount-over-max-safe": { expectedBalanceCents: 0, amountCents: 9007199254740992 },
      "amount-null": { expectedBalanceCents: 0, amountCents: null },
      "note-padded": { expectedBalanceCents: 0, note: "  hallo  " },
      "note-blank": { expectedBalanceCents: 0, note: "   " },
      "note-padded-long": { expectedBalanceCents: 0, note: `  ${rep("n", 200)}  ` },
      "note-null": { expectedBalanceCents: 0, note: null },
      "booked-at-offset": { expectedBalanceCents: 0, bookedAt: "2026-10-16T12:00:00+02:00" },
      "booked-at-no-offset": { expectedBalanceCents: 0, bookedAt: "2026-10-16T12:00:00" },
      "booked-at-date": { expectedBalanceCents: 0, bookedAt: "2026-10-16" },
      "booked-at-null": { expectedBalanceCents: 0, bookedAt: null },
      "mutation-bad": { expectedBalanceCents: 0, mutationId: "x" },
      "mutation-null": { expectedBalanceCents: 0, mutationId: null },
      "all-bad": { expectedBalanceCents: "x", amountCents: 0, note: rep("n", 201), bookedAt: "y", mutationId: "z" },
    },
  }),
  ...singleKeys("CreateSettlementRequestSchema", REQUEST),
  ...gen("SettlementResponseSchema", { transaction: TX, balance: BALANCE }, {
    depth: 0,
    extra: {
      "transaction-bad": { transaction: { id: "x" }, balance: BALANCE },
      "balance-bad": { transaction: TX, balance: { balanceCents: "x" } },
      "both-bad": { transaction: {}, balance: {} },
    },
  }),
]);
