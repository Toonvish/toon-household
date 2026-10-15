/**
 * Deterministic builder of the legacy fixture databases (M5-T01, plan m5-migration.md §1.5
 * decision 17, §3 Table F).
 *
 *   bun run apps/api/test/fixtures/legacy/build.ts            rebuild the committed files
 *   bun run apps/api/test/fixtures/legacy/build.ts --check    rebuild into a temp dir and compare
 *
 * `migrations/recipe/` and `migrations/finance/` are VERBATIM copies of toon-recipe's and
 * toon-finance's drizzle folders (no snapshots). Each database is made exactly the way the source
 * apps make theirs: a plain `createClient` (never H's `createDatabase`, which would switch the file
 * to WAL) and drizzle's libSQL migrator, which writes `__drizzle_migrations`. The anonymised rows
 * of Table F follow as plain parametrised INSERTs (libSQL enforces foreign keys, so the order is
 * the FK order), then `VACUUM`. The journal mode stays `delete`: no `-wal` / `-shm` file exists.
 *
 * Everything is fixed: ids come from `facts.ts` (`fixtureId`), timestamps from `ms()`, password
 * hashes are precomputed constants. Two builds are byte-for-byte the same logical dump.
 */
import { createClient, type Client, type InStatement, type InValue } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CATEGORY_SLUGS, SAMMELBUCHUNG_TAG, SYSTEM_CATEGORY_SLUG, foldText } from "@toon/shared";
import {
  EXTERNAL_IMAGE_URL,
  FH4_INCOMES,
  FH6_CLAIM_INVITE,
  FINANCE_HOUSEHOLDS,
  FINANCE_PLANS,
  FINANCE_USERS,
  GROUPS,
  GROUP_MEMBERS,
  MISSING_UPLOAD,
  NS,
  RECIPES,
  RECIPE_USERS,
  UPLOADS,
  fixtureId,
} from "./facts.ts";

export const LEGACY_DIR = dirname(fileURLToPath(import.meta.url));

export interface BuiltFixtures {
  recipeDb: string;
  financeDb: string;
  uploadsDir: string;
}

/* ---------------------------------- helpers ---------------------------------- */

type Row = Record<string, InValue>;

/** Fixed timestamp: unix ms of a UTC calendar moment. */
function ms(year: number, month: number, day: number, hour = 12, minute = 0): number {
  return Date.UTC(year, month - 1, day, hour, minute);
}

/** A sequential id generator in one namespace: the n-th call always returns the same id. */
function sequence(ns: number): () => string {
  let n = 0;
  return () => fixtureId(ns, ++n);
}

function insert(table: string, row: Row): InStatement {
  const columns = Object.keys(row);
  return {
    sql: `INSERT INTO \`${table}\` (${columns.map((c) => `\`${c}\``).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
    args: columns.map((c) => row[c] as InValue),
  };
}

function bool(value: boolean): 0 | 1 {
  return value ? 1 : 0;
}

/** Deterministic filler bytes (a small LCG), prefixed with a file-type magic. */
function fixedBytes(seed: number, size: number, magic: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(size);
  let state = seed >>> 0;
  for (let i = 0; i < size; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    bytes[i] = i < magic.length ? magic[i]! : state >>> 24;
  }
  return bytes;
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const JPG_MAGIC = [0xff, 0xd8, 0xff, 0xe0] as const;
const WEBP_MAGIC = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50] as const;

async function freshClient(path: string): Promise<Client> {
  await rm(path, { force: true });
  await rm(`${path}-journal`, { force: true });
  await rm(`${path}-wal`, { force: true });
  await rm(`${path}-shm`, { force: true });
  const client = createClient({ url: `file:${path}` });
  // Small pages keep the committed files small (a populated schema is mostly one page per index);
  // the page size is set before the first table exists and survives VACUUM.
  await client.execute("PRAGMA page_size = 1024");
  return client;
}

async function migrateAndFill(path: string, migrationsFolder: string, statements: InStatement[]): Promise<void> {
  const client = await freshClient(path);
  try {
    await migrate(drizzle(client), { migrationsFolder });
    await client.batch(statements, "write");
    await client.execute("VACUUM");
    const mode = await client.execute("PRAGMA journal_mode");
    if (String(mode.rows[0]?.[0]).toLowerCase() !== "delete") {
      throw new Error(`fixture database ${path} is not in rollback-journal mode`);
    }
  } finally {
    client.close();
  }
}

/* ------------------------------ toon-recipe rows ------------------------------ */

const R = RECIPE_USERS;
const G = GROUPS;
const upload = (name: string): string => `/uploads/${name}`;

function recipeStatements(): InStatement[] {
  const s: InStatement[] = [];
  const mid = sequence(NS.recipeMisc);
  const created = ms(2026, 8, 1);
  const stamp = (day: number, hour = 10): number => ms(2026, 8, day, hour);

  // users (active_group_id has no FK; the groups come after).
  const user = (key: keyof typeof R, extra: Row): void => {
    const u = R[key];
    s.push(
      insert("users", {
        id: u.id,
        email: u.email,
        name: u.name,
        avatar_url: null,
        email_verified: 1,
        password_hash: u.hash,
        active_group_id: null,
        created_at: created,
        updated_at: created,
        email_verified_at: created,
        locale: null,
        ...extra,
      }),
    );
  };
  user("anna", {
    // A SIGNED avatar url: the migration must store the bare path (SPEC §4).
    avatar_url: `${upload(UPLOADS.avatar.name)}?exp=1790000000000&sig=0123456789abcdef0123456789abcdef`,
    active_group_id: G.G1.id,
    locale: "de",
  });
  user("ben", { active_group_id: G.G1.id, locale: "en" });
  user("cleo", { email_verified: 0, email_verified_at: null, active_group_id: G.G3.id, locale: "de" });
  user("dana", { active_group_id: G.G2.id, locale: null });

  // groups
  s.push(
    insert("groups", {
      id: G.G1.id,
      name: G.G1.name,
      description: "Rezepte der Familie",
      image_url: upload(UPLOADS.group.name),
      created_by: R.anna.id,
      created_at: stamp(1),
      updated_at: stamp(1),
    }),
    insert("groups", {
      id: G.G2.id,
      name: G.G2.name,
      description: null,
      image_url: null,
      created_by: R.anna.id,
      created_at: stamp(2),
      updated_at: stamp(2),
    }),
    insert("groups", {
      id: G.G3.id,
      name: G.G3.name,
      description: null,
      image_url: null,
      created_by: R.cleo.id,
      created_at: stamp(3),
      updated_at: stamp(3),
    }),
  );
  for (const key of ["G1", "G2", "G3"] as const) {
    for (const member of GROUP_MEMBERS[key]) {
      s.push(
        insert("group_members", {
          id: mid(),
          group_id: G[key].id,
          user_id: R[member.user].id,
          role: member.role,
          created_at: stamp(4),
        }),
      );
    }
  }
  s.push(
    insert("oauth_accounts", {
      id: mid(),
      user_id: R.ben.id,
      provider: "google",
      provider_user_id: "google-ben-0001",
      provider_email: R.ben.email,
      created_at: created,
    }),
    insert("group_invites", {
      id: mid(),
      group_id: G.G1.id,
      email: "emil@example.test",
      role: "member",
      token: "invite-token-g1-emil",
      status: "pending",
      invited_by: R.anna.id,
      accepted_by: null,
      expires_at: ms(2026, 12, 31),
      accepted_at: null,
      created_at: stamp(5),
    }),
    insert("password_reset_tokens", {
      id: mid(),
      user_id: R.cleo.id,
      token_hash: "reset-hash-cleo",
      expires_at: ms(2026, 12, 31),
      used_at: null,
      requested_ip: "203.0.113.7",
      created_at: stamp(6),
    }),
    insert("email_verification_tokens", {
      id: mid(),
      user_id: R.cleo.id,
      token_hash: "verify-hash-cleo",
      email: R.cleo.email,
      expires_at: ms(2026, 12, 31),
      used_at: null,
      requested_ip: "203.0.113.7",
      created_at: stamp(6),
    }),
    insert("sessions", {
      id: "session-anna-0001",
      user_id: R.anna.id,
      expires_at: ms(2026, 12, 31),
      created_at: stamp(7),
      last_used_at: stamp(7),
      ip_address: "203.0.113.8",
      user_agent: "fixture-agent",
    }),
  );

  // tags (kind: one `course`, the rest `free`)
  const tag = {
    dessert: mid(),
    vegetarisch: mid(),
    schnell: mid(),
    kuchen: mid(),
    suppe: mid(),
  };
  s.push(
    insert("tags", { id: tag.dessert, group_id: G.G1.id, name: "Dessert", color: "#c2410c", created_at: stamp(8), kind: "course" }),
    insert("tags", { id: tag.vegetarisch, group_id: G.G1.id, name: "Vegetarisch", color: "#15803d", created_at: stamp(8), kind: "free" }),
    insert("tags", { id: tag.schnell, group_id: G.G1.id, name: "Schnell", color: null, created_at: stamp(8), kind: "free" }),
    insert("tags", { id: tag.kuchen, group_id: G.G2.id, name: "Kuchen", color: null, created_at: stamp(8), kind: "free" }),
    insert("tags", { id: tag.suppe, group_id: G.G3.id, name: "Suppe", color: null, created_at: stamp(8), kind: "free" }),
  );

  // recipes
  type RecipeSpec = {
    key: keyof typeof RECIPES;
    owner: keyof typeof R;
    description: string | null;
    imageUrl: string | null;
    servings: number | null;
    prep: number | null;
    cook: number | null;
    day: number;
    ingredients: Array<{ section?: string; quantity?: number; unit?: string; name: string; note?: string; raw: string }>;
    steps: string[];
  };
  const specs: RecipeSpec[] = [
    {
      key: "apfelkuchen",
      owner: "anna",
      description: "Saftiger Kuchen mit Äpfeln und Zimt",
      imageUrl: upload(UPLOADS.hero.name),
      servings: 12,
      prep: 20,
      cook: 45,
      day: 10,
      ingredients: [
        { quantity: 4, unit: "Stück", name: "Äpfel", raw: "4 Äpfel" },
        { quantity: 250, unit: "g", name: "Mehl", raw: "250 g Mehl" },
        { quantity: 150, unit: "g", name: "Zucker", note: "braun", raw: "150 g Zucker, braun" },
      ],
      steps: ["Äpfel schälen und in Spalten schneiden.", "Teig rühren und die Äpfel unterheben.", "Bei 180 Grad 45 Minuten backen."],
    },
    {
      key: "gemuesepfanne",
      owner: "ben",
      description: null,
      imageUrl: EXTERNAL_IMAGE_URL,
      servings: 2,
      prep: 10,
      cook: 15,
      day: 11,
      ingredients: [
        { quantity: 1, unit: "Stück", name: "Zucchini", raw: "1 Zucchini" },
        { quantity: 2, unit: "Stück", name: "Paprika", raw: "2 Paprika" },
      ],
      steps: ["Gemüse würfeln.", "In der Pfanne anbraten."],
    },
    {
      key: "kaesespaetzle",
      owner: "anna",
      description: "Mit viel Käse und Röstzwiebeln",
      imageUrl: upload(MISSING_UPLOAD),
      servings: 4,
      prep: 30,
      cook: 20,
      day: 12,
      ingredients: [
        { quantity: 400, unit: "g", name: "Spätzle", raw: "400 g Spätzle" },
        { quantity: 200, unit: "g", name: "Bergkäse", raw: "200 g Bergkäse" },
      ],
      steps: ["Spätzle kochen.", "Mit dem Käse schichten und überbacken."],
    },
    {
      key: "pfannkuchen",
      owner: "anna",
      description: null,
      imageUrl: null,
      servings: 4,
      prep: 5,
      cook: 20,
      day: 13,
      ingredients: [{ quantity: 300, unit: "g", name: "Mehl", raw: "300 g Mehl" }],
      steps: ["Teig anrühren und quellen lassen.", "Portionsweise ausbacken."],
    },
    {
      key: "linsensuppe",
      owner: "cleo",
      description: "Deftig und günstig",
      imageUrl: null,
      servings: 6,
      prep: 15,
      cook: 40,
      day: 14,
      ingredients: [{ quantity: 300, unit: "g", name: "Linsen", raw: "300 g Linsen" }],
      steps: ["Linsen waschen.", "Mit Gemüse weich kochen."],
    },
    {
      key: "gruenkohl",
      owner: "dana",
      description: null,
      imageUrl: null,
      servings: null,
      prep: null,
      cook: null,
      day: 15,
      ingredients: [{ name: "Grünkohl", raw: "Grünkohl nach Belieben" }],
      steps: ["Grünkohl putzen und kochen."],
    },
  ];
  for (const spec of specs) {
    const recipe = RECIPES[spec.key];
    const at = stamp(spec.day);
    s.push(
      insert("recipes", {
        id: recipe.id,
        group_id: G[recipe.group].id,
        title: recipe.title,
        description: spec.description,
        image_url: spec.imageUrl,
        source_url: null,
        source_name: null,
        servings_amount: spec.servings,
        servings_unit: spec.servings === null ? null : "Portionen",
        prep_minutes: spec.prep,
        cook_minutes: spec.cook,
        total_minutes: spec.prep === null || spec.cook === null ? null : spec.prep + spec.cook,
        difficulty: null,
        rating: null,
        notes: null,
        language: "de",
        created_by: R[spec.owner].id,
        created_at: at,
        updated_at: at,
        title_fold: foldText(recipe.title),
        description_fold: foldText(spec.description ?? ""),
        // Only the cooked recipe carries a watermark (set below with the cook log).
        last_cooked_at: spec.key === "apfelkuchen" ? ms(2026, 9, 14, 19) : null,
      }),
    );
    spec.ingredients.forEach((ing, position) => {
      s.push(
        insert("recipe_ingredients", {
          id: mid(),
          recipe_id: recipe.id,
          position,
          section: ing.section ?? null,
          quantity: ing.quantity ?? null,
          quantity_max: null,
          unit: ing.unit ?? null,
          name: ing.name,
          note: ing.note ?? null,
          raw: ing.raw,
          name_fold: foldText(ing.name),
        }),
      );
    });
    spec.steps.forEach((text, position) => {
      s.push(insert("recipe_steps", { id: mid(), recipe_id: recipe.id, position, section: null, text }));
    });
  }
  const recipeTag = (recipeKey: keyof typeof RECIPES, tagId: string): void => {
    s.push(insert("recipe_tags", { recipe_id: RECIPES[recipeKey].id, tag_id: tagId }));
  };
  recipeTag("apfelkuchen", tag.dessert);
  recipeTag("apfelkuchen", tag.vegetarisch);
  recipeTag("gemuesepfanne", tag.vegetarisch);
  recipeTag("gemuesepfanne", tag.schnell);
  recipeTag("kaesespaetzle", tag.vegetarisch);
  recipeTag("pfannkuchen", tag.kuchen);
  recipeTag("linsensuppe", tag.suppe);

  // collection with a cover and two recipes
  const collection = mid();
  s.push(
    insert("collections", {
      id: collection,
      group_id: G.G1.id,
      name: "Sonntagsessen",
      description: null,
      cover_image_url: upload(UPLOADS.cover.name),
      created_by: R.anna.id,
      created_at: stamp(16),
      updated_at: stamp(16),
    }),
    insert("collection_recipes", { collection_id: collection, recipe_id: RECIPES.apfelkuchen.id, position: 0, added_at: stamp(16) }),
    insert("collection_recipes", { collection_id: collection, recipe_id: RECIPES.kaesespaetzle.id, position: 1, added_at: stamp(16) }),
  );

  // meal plan + cook log (the cook log row points at its plan entry)
  const entryCooked = mid();
  const entryPlanned = mid();
  s.push(
    insert("meal_plan_entries", {
      id: entryCooked,
      group_id: G.G1.id,
      recipe_id: RECIPES.apfelkuchen.id,
      planned_on: "2026-09-14",
      position: 0,
      servings: 4,
      cooked_at: ms(2026, 9, 14, 19),
      created_by: R.anna.id,
      created_at: stamp(17),
      updated_at: ms(2026, 9, 14, 19),
    }),
    insert("meal_plan_entries", {
      id: entryPlanned,
      group_id: G.G1.id,
      recipe_id: RECIPES.gemuesepfanne.id,
      planned_on: "2026-09-15",
      position: 0,
      servings: null,
      cooked_at: null,
      created_by: R.ben.id,
      created_at: stamp(17),
      updated_at: stamp(17),
    }),
    insert("recipe_cook_log", {
      id: mid(),
      recipe_id: RECIPES.apfelkuchen.id,
      group_id: G.G1.id,
      cooked_by: R.anna.id,
      cooked_at: ms(2026, 9, 14, 19),
      meal_plan_entry_id: entryCooked,
    }),
  );

  // import draft: the scan file is referenced by source_meta.storedPath, the hero by parsed.imageUrl
  s.push(
    insert("import_drafts", {
      id: mid(),
      group_id: G.G1.id,
      created_by: R.anna.id,
      status: "pending",
      source_type: "ocr",
      source_url: null,
      raw_text: "Rührkuchen\n250 g Mehl\n150 g Zucker",
      parsed: JSON.stringify({
        title: "Rührkuchen",
        imageUrl: upload(UPLOADS.hero.name),
        ingredients: [
          { position: 0, quantity: 250, unit: "g", name: "Mehl", raw: "250 g Mehl" },
          { position: 1, quantity: 150, unit: "g", name: "Zucker", raw: "150 g Zucker" },
        ],
        steps: [{ position: 0, text: "Alles verrühren." }],
        tags: [],
        confidence: { overall: 0.7 },
      }),
      confidence: 0.7,
      source_meta: JSON.stringify({ method: "ocr", filename: "scan.jpg", mimeType: "image/jpeg", storedPath: UPLOADS.scan.name }),
      recipe_id: null,
      created_at: stamp(18),
      updated_at: stamp(18),
    }),
  );

  // shopping: list, items, catalog, bought history (one buyer NULL), list recipes, mutation
  const list = mid();
  s.push(
    insert("shopping_lists", {
      id: list,
      group_id: G.G1.id,
      name: "Rewe",
      created_by: R.anna.id,
      created_at: stamp(19),
      updated_at: stamp(19),
      bought_cleared_at: null,
    }),
    insert("shopping_list_items", {
      id: mid(),
      list_id: list,
      name: "Äpfel",
      merge_key: "apfel|stück",
      quantity: 4,
      unit: "Stück",
      note: null,
      position: 0,
      source_recipe_ids: JSON.stringify([RECIPES.apfelkuchen.id]),
      created_at: stamp(19),
      updated_at: stamp(19),
    }),
    insert("shopping_list_items", {
      id: mid(),
      list_id: list,
      name: "Milch",
      merge_key: "milch|",
      quantity: null,
      unit: null,
      note: "laktosefrei",
      position: 1,
      source_recipe_ids: null,
      created_at: stamp(19),
      updated_at: stamp(19),
    }),
    insert("shopping_list_catalog", { id: mid(), list_id: list, name: "Milch", name_key: "milch", unit: null, use_count: 3, last_used_at: stamp(19), hidden_at: null }),
    insert("shopping_list_catalog", { id: mid(), list_id: list, name: "Äpfel", name_key: "apfel", unit: "Stück", use_count: 1, last_used_at: stamp(19), hidden_at: stamp(20) }),
    insert("shopping_bought_items", {
      id: mid(),
      list_id: list,
      name: "Butter",
      quantity: 1,
      unit: "Stück",
      note: null,
      bought_by: R.anna.id,
      bought_at: stamp(20),
      source_recipe_ids: null,
    }),
    insert("shopping_bought_items", {
      id: mid(),
      list_id: list,
      name: "Eier",
      quantity: 10,
      unit: "Stück",
      note: null,
      bought_by: null,
      bought_at: stamp(21),
      source_recipe_ids: null,
    }),
    insert("shopping_list_recipes", {
      id: mid(),
      list_id: list,
      recipe_id: RECIPES.apfelkuchen.id,
      servings: 4,
      added_by: R.anna.id,
      added_at: stamp(19),
      updated_at: stamp(19),
    }),
    insert("shopping_mutations", { id: mid(), list_id: list, applied_at: stamp(19) }),
  );

  // cards of anna and ben
  s.push(
    insert("cards", {
      id: mid(),
      user_id: R.anna.id,
      label: "Rewe Bonus",
      format: "ean13",
      value: "4006381333931",
      note: null,
      last_used_at: stamp(22),
      created_at: stamp(22),
      updated_at: stamp(22),
    }),
    insert("cards", {
      id: mid(),
      user_id: R.ben.id,
      label: "Bahnticket",
      format: "qr",
      value: "https://example.test/ticket/ben",
      note: "Monatskarte",
      last_used_at: null,
      created_at: stamp(22),
      updated_at: stamp(22),
    }),
  );
  return s;
}

/* ------------------------------ toon-finance rows ----------------------------- */

const F = FINANCE_USERS;
type HouseholdKey = keyof typeof FINANCE_HOUSEHOLDS;
type FinanceUserKey = keyof typeof F;
const HOUSEHOLD_KEYS = ["FH1", "FH2", "FH3", "FH4", "FH5", "FH6"] as const satisfies readonly HouseholdKey[];

/** Category id by household and slug (positions are the default order). */
function categoryId(household: HouseholdKey, slug: string): string {
  const position = (DEFAULT_CATEGORY_SLUGS as readonly string[]).indexOf(slug);
  if (position < 0) throw new Error(`unknown category slug ${slug}`);
  return fixtureId(NS.category, HOUSEHOLD_KEYS.indexOf(household) * 100 + position + 1);
}

function financeStatements(): InStatement[] {
  const s: InStatement[] = [];
  const mid = sequence(NS.financeMisc);
  const created = ms(2026, 6, 1);

  // users (pia is a placeholder: e-mail, normalised e-mail and hash are all NULL, F 0002)
  for (const key of Object.keys(F) as FinanceUserKey[]) {
    const u = F[key];
    s.push(
      insert("users", {
        id: u.id,
        email: u.email,
        email_normalized: u.emailNormalized,
        name: u.name,
        password_hash: u.hash,
        locale: key === "ben" ? "en" : "de",
        created_at: created,
        updated_at: created,
      }),
    );
  }

  // households and their members (FH5 has none; FH6's slot 2 is the placeholder pia)
  HOUSEHOLD_KEYS.forEach((key, index) => {
    const h = FINANCE_HOUSEHOLDS[key];
    s.push(
      insert("households", {
        id: h.id,
        name: h.name,
        default_locale: key === "FH2" ? "en" : "de",
        created_by: F[h.creator].id,
        created_at: ms(2026, 6, 2 + index),
        updated_at: ms(2026, 6, 2 + index),
      }),
    );
  });
  HOUSEHOLD_KEYS.forEach((key, index) => {
    for (const member of FINANCE_HOUSEHOLDS[key].members) {
      s.push(
        insert("household_members", {
          household_id: FINANCE_HOUSEHOLDS[key].id,
          user_id: F[member.user].id,
          member_slot: member.slot,
          display_name: member.displayName,
          joined_at: ms(2026, 6, 2 + index, 13),
        }),
      );
    }
  });

  // categories: the 21 defaults per household; FH1 renames one, hides one and adds a custom one
  for (const key of ["FH1", "FH2", "FH3", "FH4", "FH6"] as const) {
    DEFAULT_CATEGORY_SLUGS.forEach((slug, position) => {
      s.push(
        insert("categories", {
          id: categoryId(key, slug),
          household_id: FINANCE_HOUSEHOLDS[key].id,
          slug,
          custom_label: key === "FH1" && slug === "tiere" ? "Fellnasen" : null,
          is_system: bool(slug === SYSTEM_CATEGORY_SLUG),
          is_hidden: bool(key === "FH1" && slug === "steuern_abgaben"),
          position,
          created_at: created,
          updated_at: created,
        }),
      );
    });
  }
  const customCategory = fixtureId(NS.category, 90);
  s.push(
    insert("categories", {
      id: customCategory,
      household_id: FINANCE_HOUSEHOLDS.FH1.id,
      slug: `custom-${customCategory.slice(0, 8)}`,
      custom_label: "Urlaubskasse",
      is_system: 0,
      is_hidden: 0,
      position: DEFAULT_CATEGORY_SLUGS.length,
      created_at: ms(2026, 7, 2),
      updated_at: ms(2026, 7, 2),
    }),
  );

  // plans (the payer may be a non-participant: FH4's fritz)
  for (const key of HOUSEHOLD_KEYS) {
    const plan = FINANCE_PLANS[key];
    s.push(
      insert("fixed_cost_plans", {
        household_id: FINANCE_HOUSEHOLDS[key].id,
        enabled: bool(plan.enabled),
        payer_id: F[FINANCE_HOUSEHOLDS[key].planPayer].id,
        start_period: plan.startPeriod,
        last_booked_period: plan.lastBookedPeriod,
        created_at: created,
        updated_at: created,
      }),
    );
  }

  // transactions
  type TxSpec = {
    household: HouseholdKey;
    payer: FinanceUserKey;
    mode: "SPLIT_EQUAL" | "OTHER_ONLY" | "SETTLEMENT";
    cents: number;
    description: string;
    category: string | null;
    at: number;
    dateSource?: "exact" | "day" | "month" | "estimated";
    origin?: "manual" | "fixed_plan" | "fixed_plan_adjustment" | "import";
    planPeriod?: string;
    categorySource?: "manual" | "heuristic" | "system";
    importSeq?: number;
    externalKey?: string;
    createdBy?: FinanceUserKey | null;
  };
  const tx = (spec: TxSpec): string => {
    const id = mid();
    const createdBy = spec.createdBy === undefined ? spec.payer : spec.createdBy;
    s.push(
      insert("transactions", {
        id,
        household_id: FINANCE_HOUSEHOLDS[spec.household].id,
        payer_id: F[spec.payer].id,
        split_mode: spec.mode,
        amount_cents: spec.cents,
        description: spec.description,
        category_id: spec.category === null ? null : categoryId(spec.household, spec.category),
        booked_at: spec.at,
        date_source: spec.dateSource ?? "exact",
        origin: spec.origin ?? "manual",
        plan_period: spec.planPeriod ?? null,
        category_source: spec.categorySource ?? "manual",
        import_seq: spec.importSeq ?? null,
        external_key: spec.externalKey ?? null,
        created_by: createdBy === null ? null : F[createdBy].id,
        created_at: spec.at,
        updated_at: spec.at,
      }),
    );
    return id;
  };

  const fh1 = FINANCE_HOUSEHOLDS.FH1.id;
  const t1 = tx({ household: "FH1", payer: "anna", mode: "SPLIT_EQUAL", cents: 4590, description: "Wocheneinkauf Rewe", category: "lebensmittel", at: ms(2026, 7, 4) });
  tx({ household: "FH1", payer: "ben", mode: "SPLIT_EQUAL", cents: 1999, description: "Drogerie", category: "drogerie", at: ms(2026, 7, 9) });
  // A refund: halfForOther(-101) is -50, never -51 (F gotchas 31-33).
  tx({ household: "FH1", payer: "anna", mode: "SPLIT_EQUAL", cents: -101, description: "Pfand Rückerstattung", category: "lebensmittel", at: ms(2026, 7, 11) });
  tx({ household: "FH1", payer: "ben", mode: "SPLIT_EQUAL", cents: 7777, description: "Baumarkt Schrauben", category: "baumarkt", at: ms(2026, 7, 15) });
  tx({ household: "FH1", payer: "anna", mode: "OTHER_ONLY", cents: 2500, description: "Geschenk für Ben", category: "geschenke", at: ms(2026, 7, 20) });
  tx({ household: "FH1", payer: "ben", mode: "OTHER_ONLY", cents: 1200, description: "Kino für Anna", category: "freizeit", at: ms(2026, 8, 2) });
  tx({ household: "FH1", payer: "anna", mode: "SETTLEMENT", cents: 5000, description: "Ausgleich", category: "ausgleich", at: ms(2026, 8, 5), categorySource: "system" });
  for (const period of ["2026-07", "2026-08"]) {
    // The plan books ben's income-proportional share (128500 * 200000 / 500000) as OTHER_ONLY by the payer.
    const [year, month] = period.split("-").map(Number) as [number, number];
    tx({
      household: "FH1",
      payer: "anna",
      mode: "OTHER_ONLY",
      cents: 51400,
      description: `Fixkosten ${String(month).padStart(2, "0")}/${year}`,
      category: SYSTEM_CATEGORY_SLUG,
      at: ms(year, month, 1, 0),
      origin: "fixed_plan",
      planPeriod: period,
      categorySource: "system",
      externalKey: `fixedplan:${fh1}:${period}`,
      createdBy: null,
    });
  }
  tx({
    household: "FH1",
    payer: "anna",
    mode: "SPLIT_EQUAL",
    cents: 2310,
    description: "Haushaltswaren (Import)",
    category: "haushalt_kueche",
    at: ms(2026, 6, 1, 0),
    dateSource: "month",
    origin: "import",
    categorySource: "heuristic",
    importSeq: 3,
    externalKey: "xlsx:B:3",
    createdBy: null,
  });
  tx({
    household: "FH1",
    payer: "ben",
    mode: "SPLIT_EQUAL",
    cents: 1587,
    description: "Bäcker (Import)",
    category: "lebensmittel",
    at: ms(2026, 6, 20, 0),
    dateSource: "day",
    origin: "import",
    categorySource: "heuristic",
    importSeq: 4,
    externalKey: "xlsx:E:4",
    createdBy: null,
  });
  const tCollective = tx({ household: "FH1", payer: "anna", mode: "SPLIT_EQUAL", cents: 33333, description: "Sammelbuchung Urlaub", category: "reisen", at: ms(2026, 8, 20) });
  const tSouvenirs = tx({ household: "FH1", payer: "ben", mode: "OTHER_ONLY", cents: 4000, description: "Souvenirs", category: "geschenke", at: ms(2026, 8, 22) });

  // FH2: cleo and dana
  tx({ household: "FH2", payer: "cleo", mode: "SPLIT_EQUAL", cents: 3200, description: "Einkauf", category: "lebensmittel", at: ms(2026, 8, 3) });
  tx({ household: "FH2", payer: "dana", mode: "SPLIT_EQUAL", cents: 1450, description: "Drogerie", category: "drogerie", at: ms(2026, 8, 6) });
  tx({ household: "FH2", payer: "cleo", mode: "OTHER_ONLY", cents: 900, description: "Eis für Dana", category: "freizeit", at: ms(2026, 8, 9) });
  tx({ household: "FH2", payer: "dana", mode: "OTHER_ONLY", cents: 2100, description: "Buch für Cleo", category: "geschenke", at: ms(2026, 8, 12) });
  tx({ household: "FH2", payer: "cleo", mode: "SPLIT_EQUAL", cents: 6001, description: "Küchenregal", category: "haushalt_kueche", at: ms(2026, 8, 15) });
  tx({ household: "FH2", payer: "dana", mode: "SETTLEMENT", cents: 1000, description: "Ausgleich", category: "ausgleich", at: ms(2026, 8, 30), categorySource: "system" });

  // FH3: emil and fritz (one OTHER_ONLY by fritz)
  tx({ household: "FH3", payer: "emil", mode: "SPLIT_EQUAL", cents: 5000, description: "Getränke", category: "lebensmittel", at: ms(2026, 8, 4) });
  tx({ household: "FH3", payer: "fritz", mode: "OTHER_ONLY", cents: 1800, description: "Pizza für Emil", category: "lebensmittel", at: ms(2026, 8, 8) });
  tx({ household: "FH3", payer: "emil", mode: "SPLIT_EQUAL", cents: 2799, description: "Streaming", category: "spiele_medien", at: ms(2026, 8, 14) });
  tx({ household: "FH3", payer: "fritz", mode: "SPLIT_EQUAL", cents: 399, description: "Batterien", category: "elektronik", at: ms(2026, 8, 21) });

  // FH4: gina alone (slot 2); fritz paid nothing
  tx({ household: "FH4", payer: "gina", mode: "SPLIT_EQUAL", cents: 2000, description: "Einkauf", category: "lebensmittel", at: ms(2026, 8, 7) });
  tx({ household: "FH4", payer: "gina", mode: "OTHER_ONLY", cents: 1500, description: "Kino", category: "freizeit", at: ms(2026, 8, 16) });

  // tags and their usage (names are content: German, never through t())
  const tagSammel = mid();
  const tagUrlaub = mid();
  s.push(
    insert("tags", { id: tagSammel, household_id: fh1, name: SAMMELBUCHUNG_TAG, name_key: SAMMELBUCHUNG_TAG, usage_count: 1, created_at: ms(2026, 8, 20) }),
    insert("tags", { id: tagUrlaub, household_id: fh1, name: "Urlaub", name_key: "urlaub", usage_count: 2, created_at: ms(2026, 8, 20) }),
    insert("transaction_tags", { transaction_id: tCollective, tag_id: tagSammel }),
    insert("transaction_tags", { transaction_id: tCollective, tag_id: tagUrlaub }),
    insert("transaction_tags", { transaction_id: tSouvenirs, tag_id: tagUrlaub }),
  );

  // FH1: fixed-cost items, one income per member, one accrual run, two mutation claims
  s.push(
    insert("fixed_cost_items", { id: mid(), household_id: fh1, label: "Miete", amount_cents: 120000, active_from: "2026-07", active_to: null, position: 0, created_at: ms(2026, 7, 1), updated_at: ms(2026, 7, 1) }),
    insert("fixed_cost_items", { id: mid(), household_id: fh1, label: "Strom", amount_cents: 8500, active_from: "2026-07", active_to: null, position: 1, created_at: ms(2026, 7, 1), updated_at: ms(2026, 7, 1) }),
    insert("incomes", { id: mid(), household_id: fh1, person_id: F.anna.id, amount_cents: 300000, valid_from: "2026-07", valid_to: null, created_at: ms(2026, 7, 1), updated_at: ms(2026, 7, 1) }),
    insert("incomes", { id: mid(), household_id: fh1, person_id: F.ben.id, amount_cents: 200000, valid_from: "2026-07", valid_to: null, created_at: ms(2026, 7, 1), updated_at: ms(2026, 7, 1) }),
    insert("accrual_runs", {
      id: mid(),
      household_id: fh1,
      trigger: "boot",
      from_period: "2026-07",
      to_period: "2026-08",
      periods_booked: 2,
      periods_skipped: 0,
      booked_cents: 102800,
      error: null,
      started_at: ms(2026, 8, 1, 6),
      finished_at: ms(2026, 8, 1, 6, 1),
    }),
    insert("mutation_claims", { id: mid(), household_id: fh1, transaction_id: t1, applied_at: ms(2026, 7, 4) }),
    insert("mutation_claims", { id: mid(), household_id: fh1, transaction_id: null, applied_at: ms(2026, 7, 5) }),
  );

  // FH4: the incomes, one of them naming fritz (a non-participant)
  for (const income of FH4_INCOMES) {
    s.push(
      insert("incomes", {
        id: mid(),
        household_id: FINANCE_HOUSEHOLDS.FH4.id,
        person_id: F[income.user].id,
        amount_cents: income.amountCents,
        valid_from: "2026-08",
        valid_to: null,
        created_at: ms(2026, 8, 2),
        updated_at: ms(2026, 8, 2),
      }),
    );
  }

  // not migrated by design: one session, one invite, one reset token
  s.push(
    insert("sessions", {
      id: "session-fin-anna-0001",
      user_id: F.anna.id,
      expires_at: ms(2026, 12, 31),
      created_at: ms(2026, 8, 1),
      last_used_at: ms(2026, 8, 1),
      ip_address: "203.0.113.9",
      user_agent: "fixture-agent",
    }),
    insert("invites", {
      id: mid(),
      household_id: fh1,
      token: "fin-invite-token-0001",
      email: "ben@example.test",
      invited_by: F.anna.id,
      status: "pending",
      expires_at: ms(2026, 12, 31),
      created_at: ms(2026, 6, 3),
      accepted_at: null,
      accepted_by: null,
      mail_delivery: "not_configured",
    }),
    insert("password_reset_tokens", {
      id: mid(),
      user_id: F.ben.id,
      token_hash: "fin-reset-hash-ben",
      expires_at: ms(2026, 12, 31),
      used_at: null,
      created_at: ms(2026, 8, 3),
    }),
  );

  // FH6: anna and the placeholder pia (appended last so the ids above keep their sequence).
  // A placeholder never signs in, so anna books pia's payment (`created_by` anna).
  tx({ household: "FH6", payer: "anna", mode: "SPLIT_EQUAL", cents: 4200, description: "Wocheneinkauf", category: "lebensmittel", at: ms(2026, 8, 10) });
  tx({ household: "FH6", payer: "pia", mode: "SPLIT_EQUAL", cents: 1800, description: "Drogerie", category: "drogerie", at: ms(2026, 8, 12), createdBy: "anna" });
  tx({ household: "FH6", payer: "anna", mode: "OTHER_ONLY", cents: 900, description: "Kino für Pia", category: "freizeit", at: ms(2026, 8, 18) });

  // FH6's pending claim invite for pia (F `invites.claims_user_id`): no e-mail, never mailed.
  const claim = FH6_CLAIM_INVITE;
  s.push(
    insert("invites", {
      id: claim.id,
      household_id: FINANCE_HOUSEHOLDS[claim.household].id,
      token: claim.token,
      email: claim.email,
      invited_by: F[claim.invitedBy].id,
      status: claim.status,
      expires_at: claim.expiresAt,
      created_at: claim.createdAt,
      accepted_at: null,
      accepted_by: null,
      mail_delivery: "not_configured",
      claims_user_id: F[claim.claims].id,
    }),
  );
  return s;
}

/* ---------------------------------- uploads ----------------------------------- */

async function writeUploads(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const files: Array<[string, number, readonly number[]]> = [
    [UPLOADS.avatar.name, UPLOADS.avatar.size, PNG_MAGIC],
    [UPLOADS.group.name, UPLOADS.group.size, PNG_MAGIC],
    [UPLOADS.cover.name, UPLOADS.cover.size, PNG_MAGIC],
    [UPLOADS.hero.name, UPLOADS.hero.size, JPG_MAGIC],
    [UPLOADS.heroThumb.name, UPLOADS.heroThumb.size, WEBP_MAGIC],
    [UPLOADS.scan.name, UPLOADS.scan.size, JPG_MAGIC],
    [UPLOADS.orphan.name, UPLOADS.orphan.size, PNG_MAGIC],
  ];
  await Promise.all(files.map(([name, size, magic], index) => writeFile(join(dir, name), fixedBytes(index + 1, size, magic))));
}

/* ----------------------------------- build ------------------------------------ */

/** Builds `recipe.db`, `finance.db` and `uploads/` into `outDir`. */
export async function buildLegacyFixtures(outDir: string): Promise<BuiltFixtures> {
  await mkdir(outDir, { recursive: true });
  const recipeDb = join(outDir, "recipe.db");
  const financeDb = join(outDir, "finance.db");
  const uploadsDir = join(outDir, "uploads");
  await migrateAndFill(recipeDb, join(LEGACY_DIR, "migrations", "recipe"), recipeStatements());
  await migrateAndFill(financeDb, join(LEGACY_DIR, "migrations", "finance"), financeStatements());
  await writeUploads(uploadsDir);
  return { recipeDb, financeDb, uploadsDir };
}

/* ----------------------------------- dumps ------------------------------------ */

interface Dump {
  schema: Array<{ type: string; name: string; sql: string | null }>;
  tables: Record<string, Array<Record<string, unknown>>>;
}

/**
 * A logical dump: the SQL of every schema object plus every table's rows ordered by rowid, as JSON.
 * Two databases with the same dump are the same database as far as any migration can tell.
 */
export async function dumpDatabase(path: string): Promise<string> {
  const client = createClient({ url: `file:${path}` });
  try {
    await client.execute("PRAGMA query_only = 1");
    const master = await client.execute(
      "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
    );
    const dump: Dump = { schema: [], tables: {} };
    for (const row of master.rows) {
      const type = String(row.type);
      const name = String(row.name);
      dump.schema.push({ type, name, sql: row.sql === null ? null : String(row.sql) });
      if (type !== "table") continue;
      const rows = await client.execute(`SELECT * FROM \`${name}\` ORDER BY rowid`);
      dump.tables[name] = rows.rows.map((r) => {
        const out: Record<string, unknown> = {};
        for (const column of rows.columns) {
          const value = r[column];
          out[column] = value instanceof ArrayBuffer ? Buffer.from(value).toString("hex") : value;
        }
        return out;
      });
    }
    return JSON.stringify(dump, null, 1);
  } finally {
    client.close();
  }
}

/** The first difference between two dumps as a sentence, or null when they are equal. */
export function firstDumpDifference(expected: string, actual: string): string | null {
  if (expected === actual) return null;
  const a = JSON.parse(expected) as Dump;
  const b = JSON.parse(actual) as Dump;
  const schemaA = JSON.stringify(a.schema);
  if (schemaA !== JSON.stringify(b.schema)) return "schema differs (sqlite_master)";
  for (const table of Object.keys(a.tables)) {
    const rowsA = a.tables[table]!;
    const rowsB = b.tables[table] ?? [];
    if (rowsA.length !== rowsB.length) return `table ${table}: ${rowsA.length} rows vs ${rowsB.length} rows`;
    for (let i = 0; i < rowsA.length; i++) {
      if (JSON.stringify(rowsA[i]) !== JSON.stringify(rowsB[i])) {
        return `table ${table}, row ${i + 1}: ${JSON.stringify(rowsA[i])} vs ${JSON.stringify(rowsB[i])}`;
      }
    }
  }
  return "dumps differ";
}

/** Compares a fresh build with the files under `committedDir`; returns the first difference or null. */
export async function compareWithCommitted(freshDir: string, committedDir: string): Promise<string | null> {
  for (const name of ["recipe.db", "finance.db"]) {
    const difference = firstDumpDifference(
      await dumpDatabase(join(committedDir, name)),
      await dumpDatabase(join(freshDir, name)),
    );
    if (difference !== null) return `${name}: ${difference}`;
  }
  const freshFiles = (await readdir(join(freshDir, "uploads"))).sort();
  const committedFiles = (await readdir(join(committedDir, "uploads"))).sort();
  if (JSON.stringify(freshFiles) !== JSON.stringify(committedFiles)) {
    return `uploads/: file lists differ (${committedFiles.join(", ")} vs ${freshFiles.join(", ")})`;
  }
  for (const name of freshFiles) {
    const a = await readFile(join(freshDir, "uploads", name));
    const b = await readFile(join(committedDir, "uploads", name));
    if (!a.equals(b)) return `uploads/${name}: bytes differ`;
  }
  return null;
}

async function main(): Promise<void> {
  if (process.argv.includes("--check")) {
    const tmp = await mkdtemp(join(tmpdir(), "legacy-fixtures-"));
    try {
      await buildLegacyFixtures(tmp);
      const difference = await compareWithCommitted(tmp, LEGACY_DIR);
      if (difference !== null) {
        console.error(`[legacy-fixtures] committed fixtures differ from a fresh build: ${difference}`);
        process.exit(1);
      }
      console.log("[legacy-fixtures] committed fixtures match a fresh build.");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
    return;
  }
  const built = await buildLegacyFixtures(LEGACY_DIR);
  console.log(`[legacy-fixtures] wrote ${resolve(built.recipeDb)}, ${resolve(built.financeDb)} and ${resolve(built.uploadsDir)}`);
}

if (import.meta.main) await main();
