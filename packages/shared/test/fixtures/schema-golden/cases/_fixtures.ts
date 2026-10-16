/** Valid building blocks shared by the case files (plain data, no zod). */

export const ID = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
export const ID2 = "6f1d3f2e-4b5a-4c6d-9e8f-123456789abc";
export const ID3 = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
export const TS = "2026-10-16T12:00:00.000Z";
export const TS2 = "2026-10-17T08:30:00+02:00";

export const PUBLIC_USER = { id: ID, name: "Anna", email: "anna@example.de", avatarUrl: "/uploads/a.png" };

export const USER = {
  id: ID,
  email: "anna@example.de",
  name: "Anna",
  avatarUrl: "/uploads/a.png",
  emailVerified: true,
  emailVerifiedAt: TS,
  hasPassword: true,
  activeHouseholdId: ID2,
  locale: "de",
  createdAt: TS,
  updatedAt: TS,
};

export const HOUSEHOLD = {
  id: ID2,
  name: "Familie",
  description: "Zuhause",
  imageUrl: "/uploads/h.png",
  createdBy: ID,
  createdAt: TS,
  updatedAt: TS,
};

export const HOUSEHOLD_WITH_ROLE = { ...HOUSEHOLD, role: "owner", memberCount: 2, modules: ["recipe", "finance"] };

export const MEMBER = {
  id: ID3,
  householdId: ID2,
  userId: ID,
  role: "admin",
  createdAt: TS,
  user: PUBLIC_USER,
  hasAccount: true,
};

export const TAG = { id: ID, householdId: ID2, name: "Suppe", kind: "course", color: "#aabbcc", createdAt: TS, recipeCount: 3 };

export const RECIPE = {
  id: ID,
  householdId: ID2,
  title: "Linsensuppe",
  description: "Warm",
  imageUrl: "/uploads/r.png",
  thumbnailUrl: "/uploads/r.thumb.webp",
  sourceUrl: "https://example.de/r",
  sourceName: "Example",
  servingsAmount: 4,
  servingsUnit: "Portionen",
  prepMinutes: 10,
  cookMinutes: 30,
  totalMinutes: 40,
  difficulty: "einfach",
  rating: 4,
  notes: "mehr Salz",
  language: "de",
  lastCookedAt: TS,
  createdBy: ID,
  createdAt: TS,
  updatedAt: TS,
};

export const INGREDIENT = {
  position: 0,
  section: "Suppe",
  quantity: 200,
  quantityMax: 250,
  unit: "g",
  name: "Linsen",
  note: "rot",
  raw: "200 g Linsen",
};

export const STEP = { position: 0, section: "Suppe", text: "Kochen." };

export const TX = {
  id: ID,
  householdId: ID2,
  payerId: ID,
  splitMode: "SPLIT_EQUAL",
  amountCents: 1250,
  description: "Einkauf",
  categoryId: ID2,
  categorySlug: "groceries",
  tags: [{ id: ID3, name: "bio" }],
  bookedAt: TS,
  dateSource: "exact",
  origin: "manual",
  planPeriod: "2026-10",
  createdBy: ID,
  createdAt: TS,
  updatedAt: TS,
  otherShareCents: 625,
  payerShareCents: 625,
  balanceDeltaCents: 625,
  isExpense: true,
};

export const BALANCE = {
  balanceCents: 625,
  perspectiveUserId: ID,
  viewerUserId: ID,
  viewerBalanceCents: 625,
  asOf: TS,
  breakdown: { splitOtherCents: 625, forOtherCents: 0, settledCents: 0, transactionCount: 1 },
};

export const SHOPPING_LIST = {
  id: ID,
  householdId: ID2,
  name: "Wocheneinkauf",
  createdBy: ID,
  createdAt: TS,
  updatedAt: TS,
  itemCount: 3,
  boughtCount: 1,
  boughtClearedAt: TS,
  previewItems: [{ name: "Milch", quantity: 1, unit: "l" }],
};

/** `n` copies of a character, for length boundaries. */
export const rep = (char: string, n: number): string => char.repeat(n);
