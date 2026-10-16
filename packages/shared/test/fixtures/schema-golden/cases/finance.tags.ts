import { COERCE_STRINGS, gen, leaf, uniqueIds, type Case } from "./_lib.ts";
import { ID, rep } from "./_fixtures.ts";

export const cases: Case[] = uniqueIds([
  ...leaf("TagNameSchema", ["bio", "  bio  ", "", " ", "a", rep("t", 39), rep("t", 40), rep("t", 41), `  ${rep("t", 40)}  `, `  ${rep("t", 41)}  `, "ä", "Bio Markt", "a\u0000b", "😀"]),
  ...gen("FinanceTagResponseSchema", { id: ID, name: "bio", usageCount: 4 }, {
    extra: { "usage-negative": { id: ID, name: "bio", usageCount: -1 }, "usage-fraction": { id: ID, name: "bio", usageCount: 0.5 } },
  }),
  ...gen("FinanceTagListResponseSchema", { items: [{ id: ID, name: "bio", usageCount: 4 }] }, {
    minimal: { items: [] },
    extra: { "second-bad": { items: [{ id: ID, name: "bio", usageCount: 4 }, { id: "x" }] } },
  }),
  ...gen("FinanceUpdateTagRequestSchema", { name: "bio" }, {
    mode: "full",
    lens: { name: [39, 40, 41] },
    extra: { padded: { name: "  bio  " }, blank: { name: "   " }, "padded-long": { name: `  ${rep("t", 41)}  ` } },
  }),
  ...gen("TagQuerySchema", { q: "bi", limit: "20" }, {
    mode: "full",
    minimal: {},
    lens: { q: [99, 100, 101] },
    extra: Object.fromEntries([
      ...COERCE_STRINGS.map((value, index) => [`limit-${index}`, { limit: value }] as const),
      ["limit-100", { limit: "100" }],
      ["limit-101", { limit: "101" }],
      ["limit-1", { limit: "1" }],
      ["limit-0", { limit: "0" }],
      ["q-empty", { q: "" }],
      ["q-number", { q: 5 }],
      ["q-array", { q: ["a", "b"] }],
      ["both-bad", { q: rep("q", 101), limit: "0" }],
    ]),
  }),
]);
