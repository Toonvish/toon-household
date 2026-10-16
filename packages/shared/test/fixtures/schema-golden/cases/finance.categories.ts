import { gen, leaf, uniqueIds, type Case } from "./_lib.ts";
import { ID, rep } from "./_fixtures.ts";

const CATEGORY = { id: ID, slug: "groceries", label: "Lebensmittel", customLabel: "Essen", isSystem: true, isHidden: false, position: 3, usageCount: 12 };

export const cases: Case[] = uniqueIds([
  ...leaf("CategoryLabelSchema", ["Essen", "  Essen  ", " ", "", "a", rep("a", 79), rep("a", 80), rep("a", 81), `  ${rep("a", 80)}  `, `  ${rep("a", 81)}  `, "\u0000", "a\u0000b", "Café", "😀"]),
  ...gen("CategoryResponseSchema", CATEGORY, {
    allNull: { ...CATEGORY, customLabel: null },
    extra: {
      "position-negative": { ...CATEGORY, position: -1 },
      "position-fraction": { ...CATEGORY, position: 0.5 },
      "usage-negative": { ...CATEGORY, usageCount: -1 },
      "usage-fraction": { ...CATEGORY, usageCount: 0.5 },
      "custom-label-absent": Object.fromEntries(Object.entries(CATEGORY).filter(([key]) => key !== "customLabel")),
      "custom-label-undefined": { ...CATEGORY, customLabel: undefined },
    },
  }),
  ...gen("CategoryListResponseSchema", { items: [CATEGORY] }, { minimal: { items: [] }, extra: { "second-bad": { items: [CATEGORY, { id: "x" }] }, two: { items: [CATEGORY, { ...CATEGORY, id: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c" }] } } }),
  ...gen("CreateCategoryRequestSchema", { label: "Essen", position: 2 }, {
    mode: "full",
    minimal: { label: "Essen" },
    lens: { label: [79, 80, 81] },
    extra: {
      "label-padded": { label: "  Essen  " },
      "position-negative": { label: "x", position: -5 },
      "position-fraction": { label: "x", position: 1.5 },
      "position-max-safe": { label: "x", position: 9007199254740991 },
      "position-over-max-safe": { label: "x", position: 9007199254740992 },
      "position-null": { label: "x", position: null },
      "both-bad": { label: "", position: "x" },
    },
  }),
  ...gen("UpdateCategoryRequestSchema", { label: "Essen", isHidden: true, position: 2 }, {
    mode: "full",
    lens: { label: [79, 80, 81] },
    extra: {
      empty: {},
      "unknown-only": { foo: 1 },
      "label-padded": { label: "  Essen  " },
      "label-blank": { label: "   " },
      "hidden-false": { isHidden: false },
      "hidden-string": { isHidden: "true" },
      "hidden-null": { isHidden: null },
      "all-undefined": { label: undefined, isHidden: undefined, position: undefined },
      "position-fraction": { position: 1.5 },
      "all-bad": { label: "", isHidden: 1, position: "x" },
    },
  }),
]);
