// Ported from toon-recipe packages/shared/test/schemas.test.ts (the recipe cases; the core cases live in core.test.ts).
import { describe, expect, test } from "bun:test";
import {
  CreateRecipeRequestSchema,
  ImportDraftSchema,
  MarkCookedRequestSchema,
  MealPlanRangeQuerySchema,
  ParsedRecipeSchema,
  PlanDateSchema,
  RecipeListQuerySchema,
  ShoppingListDetailResponseSchema,
  emptyParsedRecipe,
  isHttpUrl,
  roleAtLeast,
} from "../src/index.ts";

describe("CreateRecipeRequestSchema", () => {
  test("defaults child arrays", () => {
    const parsed = CreateRecipeRequestSchema.parse({ title: "Pfannkuchen" });
    expect(parsed.ingredients).toEqual([]);
    expect(parsed.steps).toEqual([]);
    expect(parsed.tags).toEqual([]);
    expect(parsed.collectionIds).toEqual([]);
  });

  test("accepts ingredient input without position/raw", () => {
    const parsed = CreateRecipeRequestSchema.parse({
      title: "Pfannkuchen",
      ingredients: [{ name: "Mehl", quantity: 250, unit: "g" }],
      steps: [{ text: "Alles verrühren." }],
    });
    expect(parsed.ingredients[0]?.name).toBe("Mehl");
    expect(parsed.steps[0]?.text).toBe("Alles verrühren.");
  });

  test("rejects an empty title", () => {
    expect(CreateRecipeRequestSchema.safeParse({ title: "  " }).success).toBe(false);
  });
});

describe("RecipeListQuerySchema", () => {
  test("coerces query strings and applies defaults", () => {
    const parsed = RecipeListQuerySchema.parse({ limit: "10", offset: "20" });
    expect(parsed).toMatchObject({ limit: 10, offset: 20, sort: "newest" });
  });

  test("clamps invalid limits", () => {
    expect(RecipeListQuerySchema.safeParse({ limit: "1000" }).success).toBe(false);
  });
});

describe("ParsedRecipeSchema", () => {
  test("emptyParsedRecipe is valid", () => {
    expect(ParsedRecipeSchema.safeParse(emptyParsedRecipe()).success).toBe(true);
  });

  test("carries per-field confidence", () => {
    const parsed = ParsedRecipeSchema.parse({
      title: "Chefkoch Lasagne",
      ingredients: [{ position: 0, name: "Mehl", quantity: 250, unit: "g", raw: "250 g Mehl" }],
      steps: [{ position: 0, text: "Backofen vorheizen." }],
      confidence: { overall: 0.9, title: 1, ingredients: 0.8 },
    });
    expect(parsed.confidence.ingredients).toBe(0.8);
    expect(parsed.tags).toEqual([]);
  });

  test("rejects confidence out of range", () => {
    expect(ParsedRecipeSchema.safeParse({ confidence: { overall: 2 } }).success).toBe(false);
  });
});

describe("ImportDraftSchema", () => {
  test("round-trips a full draft", () => {
    const now = new Date().toISOString();
    const draft = {
      id: crypto.randomUUID(),
      householdId: crypto.randomUUID(),
      createdBy: crypto.randomUUID(),
      status: "pending",
      sourceType: "url",
      sourceUrl: "https://www.chefkoch.de/rezepte/123/Lasagne.html",
      rawText: null,
      parsed: emptyParsedRecipe({ title: "Lasagne" }),
      confidence: 0.7,
      sourceMeta: { method: "json-ld", host: "www.chefkoch.de" },
      recipeId: null,
      createdAt: now,
      updatedAt: now,
    };
    const result = ImportDraftSchema.safeParse(draft);
    expect(result.success).toBe(true);
  });
});

describe("roleAtLeast", () => {
  test("owner satisfies everything", () => {
    expect(roleAtLeast("owner", "admin")).toBe(true);
    expect(roleAtLeast("admin", "owner")).toBe(false);
    expect(roleAtLeast("member", "member")).toBe(true);
    expect(roleAtLeast("member", "admin")).toBe(false);
  });
});

/**
 * STORED-XSS REGRESSION. `sourceUrl` is rendered into an <a href> on the recipe
 * page and the import review screen, so a `javascript:` value stored by any household
 * member would run on the app origin with the victim's session.
 */
describe("sourceUrl accepts only http(s)", () => {
  const evil = [
    "javascript:alert(1)",
    "JavaScript:fetch('/api/auth/me')",
    "data:text/html,<script>1</script>",
    "vbscript:msgbox",
    "/relative/path",
    "not a url",
  ];

  test.each(evil)("CreateRecipeRequest rejects %p", (sourceUrl) => {
    const result = CreateRecipeRequestSchema.safeParse({ title: "Test", sourceUrl });
    expect(result.success).toBe(false);
  });

  test.each(evil)("ParsedRecipe rejects %p", (sourceUrl) => {
    const result = ParsedRecipeSchema.safeParse({ sourceUrl, confidence: { overall: 0.5 } });
    expect(result.success).toBe(false);
  });

  test.each(["https://www.chefkoch.de/rezepte/1", "http://localhost:8080/fixture.html"])(
    "accepts %p",
    (sourceUrl) => {
      expect(CreateRecipeRequestSchema.safeParse({ title: "Test", sourceUrl }).success).toBe(true);
    },
  );

  test("null/undefined stay allowed (no source)", () => {
    expect(CreateRecipeRequestSchema.safeParse({ title: "Test" }).success).toBe(true);
    expect(CreateRecipeRequestSchema.safeParse({ title: "Test", sourceUrl: null }).success).toBe(true);
  });

  test("isHttpUrl matches the schema", () => {
    expect(isHttpUrl("https://a.example")).toBe(true);
    expect(isHttpUrl("javascript:1")).toBe(false);
  });
});

describe("ShoppingListDetailResponseSchema", () => {
  const list = {
    id: "11111111-1111-4111-8111-111111111111",
    householdId: "22222222-2222-4222-8222-222222222222",
    name: "Rewe",
    createdBy: "33333333-3333-4333-8333-333333333333",
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
  };
  // `bought`/`recipes` REQUIRED (no `?`) is what forces `PERSIST_BUSTER`: a v2 blob
  // restored under the old cache key must fail to parse rather than hydrate
  // `undefined` into a component that indexes it.
  const withBoughtAndRecipes = { list, items: [], catalog: [], bought: [], recipes: [] };

  test("accepts a full detail response", () => {
    expect(ShoppingListDetailResponseSchema.safeParse(withBoughtAndRecipes).success).toBe(true);
  });

  test("rejects a response missing `bought` (the pre-redesign v2 shape)", () => {
    const { bought: _bought, ...withoutBought } = withBoughtAndRecipes;
    expect(ShoppingListDetailResponseSchema.safeParse(withoutBought).success).toBe(false);
  });

  test("rejects a response missing `recipes`", () => {
    const { recipes: _recipes, ...withoutRecipes } = withBoughtAndRecipes;
    expect(ShoppingListDetailResponseSchema.safeParse(withoutRecipes).success).toBe(false);
  });
});

describe("PlanDateSchema", () => {
  test.each(["2026-09-08", "2024-02-29", "2026-01-01"])("accepts %p", (value) => {
    expect(PlanDateSchema.safeParse(value).success).toBe(true);
  });

  test.each(["2026-02-31", "2026-13-01", "not-a-date", "2026-9-8", ""])("rejects %p", (value) => {
    expect(PlanDateSchema.safeParse(value).success).toBe(false);
  });
});

describe("MealPlanRangeQuerySchema", () => {
  test("rejects to < from", () => {
    expect(MealPlanRangeQuerySchema.safeParse({ from: "2026-09-10", to: "2026-09-01" }).success).toBe(
      false,
    );
  });

  test("accepts a range right at the boundary (rangeDays - 1)", () => {
    // planDaysBetween < rangeDays (62), so 61 days between the bounds is the widest
    // range that still passes — a range of EXACTLY rangeDays is rejected below.
    expect(
      MealPlanRangeQuerySchema.safeParse({ from: "2026-01-01", to: "2026-03-03" }).success,
    ).toBe(true);
  });

  test("rejects a range of exactly rangeDays (62) days", () => {
    // 2026-01-01 -> 2026-03-04 is 62 days apart, which is the first value the
    // `< PLAN_LIMITS.rangeDays` refinement rejects.
    expect(
      MealPlanRangeQuerySchema.safeParse({ from: "2026-01-01", to: "2026-03-04" }).success,
    ).toBe(false);
  });
});

describe("MarkCookedRequestSchema", () => {
  test("a bare {} succeeds — everything is optional", () => {
    expect(MarkCookedRequestSchema.safeParse({}).success).toBe(true);
  });

  test("accepts plannedOn and mealPlanEntryId together", () => {
    expect(
      MarkCookedRequestSchema.safeParse({
        plannedOn: "2026-09-08",
        mealPlanEntryId: "11111111-1111-4111-8111-111111111111",
      }).success,
    ).toBe(true);
  });
});
