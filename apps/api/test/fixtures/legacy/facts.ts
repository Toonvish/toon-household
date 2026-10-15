/**
 * The single facts file of the legacy fixtures (M5-T01, plan m5-migration.md §3 Table F).
 *
 * Every id, e-mail, plain password (with its PRECOMPUTED argon2id hash: Bun's hash is salted, so
 * the builder never hashes) and every expected count lives here. `build.ts` reads it to write the
 * two databases and `uploads/`; the M5 tests read it to assert what a migration must produce.
 * Nothing in this file is real: names, e-mails and amounts are invented.
 *
 * THE TRAPS (each one is asserted in `apps/api/test/legacy-fixtures.test.ts`):
 * - gina's toon-finance id equals cleo's toon-recipe id (a naive "keep the legacy id" copy would
 *   collide in `users`);
 * - FH3's id equals G2's id (the same collision between two household ids);
 * - FH4's only member sits in slot 2, its creator and plan payer is fritz, who is NOT a member
 *   (toon-finance's `removeMember` lets a member who never paid leave), and one of its incomes
 *   names fritz too;
 * - FH5 has no members;
 * - FH6's slot 2 is a placeholder (pia: no e-mail, no password; toon-finance `b1b517d`) with a
 *   pending claim invite; one FH6 booking is paid by her. Household matching ignores her (account
 *   members only: anna), so FH6 merges into G2 once FH1 holds G1, and pia joins G2 as `member`
 *   (plan m3b decision 13, ADR 0006).
 */

/** Namespaces of the fixed UUID-shaped ids. */
export const NS = {
  recipeUser: 1,
  group: 2,
  recipe: 3,
  recipeMisc: 4,
  financeHousehold: 5,
  financeUser: 6,
  financeMisc: 7,
  category: 8,
  upload: 9,
} as const;

/** A fixed UUID-shaped id: `<ns hex8>-0000-4000-8000-<n hex12>`. Deterministic, never random. */
export function fixtureId(ns: number, n: number): string {
  return `${ns.toString(16).padStart(8, "0")}-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

export type FixtureUser = {
  id: string;
  /** As stored (toon-finance keeps the typed spelling in `email`); null only for a placeholder. */
  email: string | null;
  /** `email.trim().toLowerCase()`: the union key; null only for a placeholder. */
  emailNormalized: string | null;
  name: string;
  /** null = no password (OAuth-only in toon-recipe; a placeholder in toon-finance). */
  password: string | null;
  /** Precomputed argon2id of `password` (null when there is none). */
  hash: string | null;
};

/* ------------------------------ toon-recipe users ------------------------------ */

export const RECIPE_USERS = {
  anna: {
    id: fixtureId(NS.recipeUser, 1),
    email: "anna@example.test",
    emailNormalized: "anna@example.test",
    name: "Anna Beispiel",
    password: "recipe-pass-anna",
    hash: "$argon2id$v=19$m=65536,t=2,p=1$Ga0LtVV9npvCi6lI8Sbd6I9mGHfIxRmJwQYgL5fH6oc$P6OejZgabTd9wvNEWMmke4xjp3G2nlnMVmhcakIyRSw",
  },
  ben: {
    id: fixtureId(NS.recipeUser, 2),
    email: "ben@example.test",
    emailNormalized: "ben@example.test",
    name: "Ben Muster",
    password: null,
    hash: null,
  },
  cleo: {
    id: fixtureId(NS.recipeUser, 3),
    email: "cleo@example.test",
    emailNormalized: "cleo@example.test",
    name: "Cleo Probe",
    password: "recipe-pass-cleo",
    hash: "$argon2id$v=19$m=65536,t=2,p=1$g7gw/IJGs1/wwsy45Vg+GZQMwrCBM/3mX+YHuJaaZz8$NOg3hI2jB8YgIN7w7yws8DZo57Ge1mvw1I4bnF+chFc",
  },
  dana: {
    id: fixtureId(NS.recipeUser, 4),
    email: "dana@example.test",
    emailNormalized: "dana@example.test",
    name: "Dana Test",
    password: "recipe-pass-dana",
    hash: "$argon2id$v=19$m=65536,t=2,p=1$x76xLKcaSqMGkQwwcGQhDLYSItP3nRf3e2q0PZJqzsM$zjaf+DO382vFRbgQnetVNlcGM/PctFP/Z2tE+06jSRc",
  },
} as const satisfies Record<string, FixtureUser>;

/* ------------------------------ toon-finance users ----------------------------- */

export const FINANCE_USERS = {
  anna: {
    id: fixtureId(NS.financeUser, 1),
    email: "Anna@Example.test",
    emailNormalized: "anna@example.test",
    name: "Anna Beispiel",
    password: "finance-pass-anna",
    hash: "$argon2id$v=19$m=65536,t=2,p=1$D3TrFApZi99ZplNV5INgfSaj0iWMBkCDy0bgnNQYAvQ$3/cNm1PRq+9ZXTmv4bSwohZK0/b60WquMU03JNm0KII",
  },
  ben: {
    id: fixtureId(NS.financeUser, 2),
    email: "ben@example.test",
    emailNormalized: "ben@example.test",
    name: "Ben Muster",
    password: "finance-pass-ben",
    hash: "$argon2id$v=19$m=65536,t=2,p=1$6pCkteqdi4ogrlBDVqzQWF8h0J4Ds++p2hWk5/2x5D4$CBW7/xqeKRiCE7qWilKcPioMa/Trdn/vIGGOJ79XUzk",
  },
  cleo: {
    id: fixtureId(NS.financeUser, 3),
    email: "cleo@example.test",
    emailNormalized: "cleo@example.test",
    name: "Cleo Probe",
    password: "finance-pass-cleo",
    hash: "$argon2id$v=19$m=65536,t=2,p=1$Z6nfteuT+wb97GITv1F1q+QLo4nN38zN5Jew58gZDUE$yQZ9qh+zEebx1v7gyxqYt2mYPiyp3RMfNvilui/SEmY",
  },
  dana: {
    id: fixtureId(NS.financeUser, 4),
    email: "dana@example.test",
    emailNormalized: "dana@example.test",
    name: "Dana Test",
    password: "finance-pass-dana",
    hash: "$argon2id$v=19$m=65536,t=2,p=1$PSHrQtjdldiNEH+q47IfPQmAmeBjiAs/UzuCvlHelow$3utT6CgfmGWb5Qg2Hd72EKvVUmLBv2UU0+r5UgbFKEU",
  },
  emil: {
    id: fixtureId(NS.financeUser, 5),
    email: "emil@example.test",
    emailNormalized: "emil@example.test",
    name: "Emil Nur-Geld",
    password: "finance-pass-emil",
    hash: "$argon2id$v=19$m=65536,t=2,p=1$4Iah+kp1miybdKZBKZhZlT4a5eZKby4Dvdqtwjw1DiM$0KydOi6+euCk+ZyAUZ8/9qnf1jZRj0E4dI9PjrIdT2A",
  },
  fritz: {
    id: fixtureId(NS.financeUser, 6),
    email: "fritz@example.test",
    emailNormalized: "fritz@example.test",
    name: "Fritz Gegangen",
    password: "finance-pass-fritz",
    hash: "$argon2id$v=19$m=65536,t=2,p=1$6IkG/NMU1ii5u4Qcf/HbH5UM3LJOcwQ/qgP1F0qVM74$KwfV3/WuxUDAkkC2sFNyoKpRzt4tBCPZmCZNUw7Zw7g",
  },
  gina: {
    // THE TRAP: gina's toon-finance id IS cleo's toon-recipe id.
    id: RECIPE_USERS.cleo.id,
    email: "gina@example.test",
    emailNormalized: "gina@example.test",
    name: "Gina Allein",
    password: "finance-pass-gina",
    hash: "$argon2id$v=19$m=65536,t=2,p=1$7XnqE9FeqhSJlnaL9ep5JB4MUDSjKs3cAaJs6ob+KJA$qTIlinldPer8R4QmyxupaI2Fu0s5sUdZYSgwInkDcdE",
  },
  pia: {
    // A PLACEHOLDER (toon-finance `b1b517d`, F `0002_placeholder_members`): seated in FH6's slot 2
    // by anna, no e-mail, no password; F's predicate is `password_hash IS NULL`.
    id: fixtureId(NS.financeUser, 8),
    email: null,
    emailNormalized: null,
    name: "Pia Platzhalter",
    password: null,
    hash: null,
  },
} as const satisfies Record<string, FixtureUser>;

/** The four people who exist in both apps (the e-mail union): the collisions. */
export const COLLISION_USERS = ["anna", "ben", "cleo", "dana"] as const;
/** People who exist only in toon-finance (pia, the placeholder, included). */
export const FINANCE_ONLY_USERS = ["emil", "fritz", "gina", "pia"] as const;
/** toon-finance placeholders: migrated with a NULL e-mail and hash, never matched by e-mail. */
export const PLACEHOLDER_USERS = ["pia"] as const;

/* ------------------------------- recipe groups -------------------------------- */

export const GROUPS = {
  G1: { id: fixtureId(NS.group, 1), name: "Familie Beispiel", owner: "anna", recipes: 3 },
  G2: { id: fixtureId(NS.group, 2), name: "Freundeskreis", owner: "anna", recipes: 1 },
  G3: { id: fixtureId(NS.group, 3), name: "WG Gartenstraße", owner: "cleo", recipes: 2 },
} as const;

export const GROUP_MEMBERS = {
  G1: [
    { user: "anna", role: "owner" },
    { user: "ben", role: "admin" },
    { user: "cleo", role: "member" },
  ],
  G2: [
    { user: "anna", role: "owner" },
    { user: "ben", role: "member" },
    { user: "dana", role: "member" },
  ],
  G3: [
    { user: "cleo", role: "owner" },
    { user: "dana", role: "member" },
  ],
} as const;

export const RECIPES = {
  apfelkuchen: { id: fixtureId(NS.recipe, 1), group: "G1", title: "Apfelkuchen" },
  gemuesepfanne: { id: fixtureId(NS.recipe, 2), group: "G1", title: "Gemüsepfanne" },
  kaesespaetzle: { id: fixtureId(NS.recipe, 3), group: "G1", title: "Käsespätzle" },
  pfannkuchen: { id: fixtureId(NS.recipe, 4), group: "G2", title: "Pfannkuchen" },
  linsensuppe: { id: fixtureId(NS.recipe, 5), group: "G3", title: "Linsensuppe" },
  gruenkohl: { id: fixtureId(NS.recipe, 6), group: "G3", title: "Grünkohl mit Pinkel" },
} as const;

/* ---------------------------------- uploads ----------------------------------- */

/**
 * Files in `uploads/`. `size` is the byte length the builder writes (distinct per file, so a
 * size-based "already present" check can tell them apart). `orphan` is referenced by no row but
 * is still copied; `missing` is referenced by a row and absent on disk (a warning).
 */
export const UPLOADS = {
  avatar: { name: `${fixtureId(NS.upload, 1)}.png`, size: 71 },
  group: { name: `${fixtureId(NS.upload, 2)}.png`, size: 83 },
  cover: { name: `${fixtureId(NS.upload, 3)}.png`, size: 97 },
  hero: { name: `${fixtureId(NS.upload, 4)}.jpg`, size: 131 },
  heroThumb: { name: `${fixtureId(NS.upload, 4)}.jpg.thumb.webp`, size: 59 },
  scan: { name: `${fixtureId(NS.upload, 5)}.jpg`, size: 149 },
  orphan: { name: "orphan.png", size: 47 },
} as const;
/** Referenced by recipe `Käsespätzle`, absent from `uploads/`. */
export const MISSING_UPLOAD = `${fixtureId(NS.upload, 6)}.jpg`;
/** The external hero image of `Gemüsepfanne`: never touched. */
export const EXTERNAL_IMAGE_URL = "https://example.test/bild.jpg";

/* ------------------------------ finance households ----------------------------- */

export type FinanceDecision = {
  action: "merge" | "new" | "skip";
  reason: "only-group" | "most-recipes" | "no-group" | "no-members";
  /** For `merge`: the group the ledger lands in. */
  group?: keyof typeof GROUPS;
};

export const FINANCE_HOUSEHOLDS = {
  FH1: {
    id: fixtureId(NS.financeHousehold, 1),
    name: "Kasse Anna & Ben",
    creator: "anna",
    members: [
      { user: "anna", slot: 1, displayName: "Anna" },
      { user: "ben", slot: 2, displayName: "Ben" },
    ],
    planPayer: "anna",
    decision: { action: "merge", reason: "most-recipes", group: "G1" },
  },
  FH2: {
    id: fixtureId(NS.financeHousehold, 2),
    name: "Kasse Cleo & Dana",
    creator: "cleo",
    members: [
      { user: "cleo", slot: 1, displayName: "Cleo" },
      { user: "dana", slot: 2, displayName: "Dana" },
    ],
    planPayer: "cleo",
    decision: { action: "merge", reason: "only-group", group: "G3" },
  },
  FH3: {
    // THE TRAP: FH3's id IS G2's id.
    id: GROUPS.G2.id,
    name: "Emil & Fritz",
    creator: "emil",
    members: [
      { user: "emil", slot: 1, displayName: "Emil" },
      { user: "fritz", slot: 2, displayName: "Fritz" },
    ],
    planPayer: "emil",
    decision: { action: "new", reason: "no-group" },
  },
  FH4: {
    id: fixtureId(NS.financeHousehold, 4),
    name: "Gina allein",
    // THE TRAP: the creator and the plan payer left (never paid, so F let him go).
    creator: "fritz",
    members: [{ user: "gina", slot: 2, displayName: "Gina" }],
    planPayer: "fritz",
    decision: { action: "new", reason: "no-group" },
  },
  FH5: {
    id: fixtureId(NS.financeHousehold, 5),
    name: "Leer",
    creator: "gina",
    members: [],
    planPayer: "gina",
    decision: { action: "skip", reason: "no-members" },
  },
  FH6: {
    id: fixtureId(NS.financeHousehold, 6),
    name: "Kasse Anna & Pia",
    creator: "anna",
    // pia is a placeholder: the candidate groups are those holding anna (G1, G2); FH1 (older)
    // takes G1, so G2 is the only group left.
    members: [
      { user: "anna", slot: 1, displayName: "Anna" },
      { user: "pia", slot: 2, displayName: "Pia" },
    ],
    planPayer: "anna",
    decision: { action: "merge", reason: "only-group", group: "G2" },
  },
} as const satisfies Record<string, unknown>;

/** `fixed_cost_plans` per finance household (F schema): enabled flag, start and last booked. */
export const FINANCE_PLANS = {
  FH1: { enabled: true, startPeriod: "2026-07", lastBookedPeriod: "2026-08" },
  FH2: { enabled: true, startPeriod: "2026-08", lastBookedPeriod: null },
  FH3: { enabled: false, startPeriod: "2026-08", lastBookedPeriod: null },
  FH4: { enabled: false, startPeriod: "2026-08", lastBookedPeriod: null },
  FH5: { enabled: false, startPeriod: "2026-08", lastBookedPeriod: null },
  FH6: { enabled: false, startPeriod: "2026-08", lastBookedPeriod: null },
} as const;

/** The incomes of FH4: one gina's, ONE NAMING FRITZ (a non-participant). */
export const FH4_INCOMES = [
  { user: "gina", amountCents: 250000 },
  { user: "fritz", amountCents: 180000 },
] as const;

/**
 * FH6's pending CLAIM invite for pia (F `invites.claims_user_id`, `b1b517d`): no e-mail, invited by
 * anna, far in the future, a fixed 43-character token (F mints 32 random bytes as base64url).
 * M3b-T08 still counts it under "not migrated by design"; M3b-T09 reuses it as pia's claim invite.
 */
export const FH6_CLAIM_INVITE = {
  id: fixtureId(NS.financeMisc, 0x100),
  household: "FH6",
  claims: "pia",
  invitedBy: "anna",
  token: "PiaClaimFixtureToken0123456789abcdefghijklm",
  email: null,
  status: "pending",
  createdAt: Date.UTC(2026, 8, 1, 12, 0),
  expiresAt: Date.UTC(2099, 0, 1, 0, 0),
} as const;

/* --------------------------------- expectations ------------------------------- */

/**
 * What one `migrate:legacy --apply` must produce from these fixtures, and the legacy row count per
 * table (the committed databases hold exactly this). `legacy-fixtures.test.ts` asserts `legacyRows`, `financeLedgers`
 * and `migrations` against the committed databases.
 */
export const EXPECTED = {
  users: 8,
  usersFromRecipe: 4,
  usersFinanceOnly: 4,
  /** toon-finance placeholders (pia): a target row with a NULL e-mail and hash each. */
  placeholders: 1,
  collisions: 4,
  /** ben is OAuth-only in toon-recipe: his finance password is NOT carried. */
  collisionsWithoutPassword: ["ben"],
  households: 5,
  householdModules: 8,
  householdModulesRecipe: 3,
  householdModulesFinance: 5,
  financeParticipants: 9,
  financeSettings: 5,
  financeIncomes: 4,
  uploads: { sourceFiles: 7, copied: 7, missingReferenced: 1 },
  balances: { rows: 5, ok: 5 },
  errors: 0,
  /** Warning kinds the first apply must contain (descriptive: T05 to T08 assert the exact report text). */
  warningKinds: [
    "fresh id for gina",
    "FH4 solo participant",
    "FH4 plan payer re-point",
    "FH4 income naming fritz",
    "missing upload",
  ],
  legacyRows: {
    recipe: {
      cards: 2, collection_recipes: 2, collections: 1, email_verification_tokens: 1, group_invites: 1,
      group_members: 8, groups: 3, import_drafts: 1, meal_plan_entries: 2, oauth_accounts: 1,
      password_reset_tokens: 1, recipe_cook_log: 1, recipe_ingredients: 10, recipe_steps: 12,
      recipe_tags: 7, recipes: 6, sessions: 1, shopping_bought_items: 2, shopping_list_catalog: 2,
      shopping_list_items: 2, shopping_list_recipes: 1, shopping_lists: 1, shopping_mutations: 1,
      tags: 5, users: 4,
    },
    finance: {
      accrual_runs: 1, categories: 106, fixed_cost_items: 2, fixed_cost_plans: 6, household_members: 9,
      households: 6, incomes: 4, invites: 2, mutation_claims: 2, password_reset_tokens: 1, sessions: 1,
      tags: 2, transaction_tags: 3, transactions: 28, users: 8,
    },
  } as Record<"recipe" | "finance", Record<string, number>>,
  /** Per finance household: transaction count and sum of `amount_cents`, as built. */
  financeLedgers: {
    FH1: { transactions: 13, sumCents: 166995, categories: 22 },
    FH2: { transactions: 6, sumCents: 14651, categories: 21 },
    FH3: { transactions: 4, sumCents: 9998, categories: 21 },
    FH4: { transactions: 2, sumCents: 3500, categories: 21 },
    FH5: { transactions: 0, sumCents: 0, categories: 0 },
    FH6: { transactions: 3, sumCents: 6900, categories: 21 },
  } as Record<string, { transactions: number; sumCents: number; categories: number }>,
  /** Journal entries of each source's `__drizzle_migrations` (plan §1.2). */
  migrations: {
    recipe: { count: 9, lastWhen: 1788859780811 },
    finance: { count: 3, lastWhen: 1789194481486 },
  },
};
