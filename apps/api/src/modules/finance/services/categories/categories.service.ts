/**
 * Categories: CRUD, the fully-rendered `label` (docs/spec.md §3.10 — `customLabel
 * ?? t(categories.name.<slug>)` in the NEGOTIATED request locale, never
 * `households.defaultLocale`: a default label is read-time UI copy, not a
 * stored fact, until the household renames the row), and delete-with-reassign.
 *
 * AS A SERVICE (docs/EFFECT.md E5, E6, E7, E12; plan `docs/plans/e4-finance-services.md` P2, P6, P7, P10). `FinanceCategories`
 * reaches the database through `Database.use` / `Database.transaction` (the CURRENT executor, read on every call), stamps
 * rows with the module clock `financeTimeMillis` and refuses with the tagged family. Every by-id read keeps its
 * `householdId` filter (D8). The legacy bridges at the end keep the Promise functions the routes, the transactions service,
 * the settlements, the accrual, the seed and the xlsx script still call.
 */
import type { CategoryResponse, Locale, ServerKey } from "@toon/shared";
import { serverText } from "@toon/shared";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { isUniqueViolation } from "../../../../core/services/auth/users.ts";
import type { DrizzleDatabase } from "../../../../db/client.ts";
import { Database } from "../../../../db/database.ts";
import { BadRequest, Conflict, NotFound } from "../../../../lib/errors.ts";
import type { DatabaseError } from "../../../../lib/errors.ts";
import { runFinanceBridge } from "../../bridge.ts";
import { financeTimeMillis } from "../../lib/clock.ts";
import { type FinanceCategoryRow as CategoryRow, financeCategories as categories, financeTransactions as transactions } from "../../schema.ts";
import type { DbLike } from "../support.ts";

/** `categories.name.<slug>`'s mirror in the server catalog (packages/shared/src/i18n/catalogs/server.de.ts). */
function categoryNameKey(slug: string): ServerKey {
  return `server.category.name.${slug}` as ServerKey;
}

function toCategoryResponse(row: CategoryRow, locale: Locale, usageCount: number): CategoryResponse {
  // customLabel is always set for a household-created category (never one of
  // the 21 default slugs), so this never falls through to an unknown key.
  const label = row.customLabel ?? serverText(locale, categoryNameKey(row.slug));
  return {
    id: row.id,
    slug: row.slug,
    label,
    customLabel: row.customLabel,
    isSystem: row.isSystem,
    isHidden: row.isHidden,
    position: row.position,
    usageCount,
  };
}

export interface CreateCategoryInput {
  label: string;
  position?: number;
}

export interface UpdateCategoryInput {
  label?: string;
  isHidden?: boolean;
  position?: number;
}

/** The household's categories: the list with usage counts, CRUD, delete-with-reassign and the slug lookups. */
export class FinanceCategories extends Context.Service<
  FinanceCategories,
  {
    readonly listCategories: (
      householdId: string,
      locale: Locale,
      includeHidden: boolean,
    ) => Effect.Effect<CategoryResponse[], DatabaseError>;
    /**
     * `slug = "custom-" + id.slice(0, 8)` keeps the default-slug namespace clean
     * (docs/spec.md §3.10). The unique index on `(household_id, slug)` is the
     * real guarantee; `category_slug_taken` only fires on the astronomically
     * unlikely uuid-prefix collision, caught here rather than left as a raw
     * constraint violation.
     */
    readonly createCategory: (
      householdId: string,
      locale: Locale,
      input: CreateCategoryInput,
    ) => Effect.Effect<CategoryResponse, Conflict | NotFound | DatabaseError>;
    /** `409 category_system` when `label` is set on the system (`fixkosten`) category — everything else on it may still change. */
    readonly updateCategory: (
      householdId: string,
      locale: Locale,
      categoryId: string,
      input: UpdateCategoryInput,
    ) => Effect.Effect<CategoryResponse, Conflict | NotFound | DatabaseError>;
    /**
     * Deletes a category. `409 category_system` for `fixkosten` (the plan writes
     * into it). With transactions still attached: `409 category_in_use` unless
     * `reassignTo` names another category of the SAME household, in which case
     * every attached transaction is re-pointed and the category removed in one
     * transaction (docs/spec.md §3.10) — the honest alternative to silently
     * setting `category_id` to `NULL`.
     */
    readonly deleteCategory: (
      householdId: string,
      categoryId: string,
      reassignTo?: string,
    ) => Effect.Effect<void, BadRequest | Conflict | NotFound | DatabaseError>;
    /** The `fixkosten` category's id for this household — the plan books into it. Never null: seeded at household creation. */
    readonly systemCategoryId: (householdId: string) => Effect.Effect<string | null, DatabaseError>;
    /** Looks up a category by its stable slug (e.g. `"ausgleich"` for a settlement's default category). Null if renamed away or never seeded. */
    readonly categoryIdBySlug: (householdId: string, slug: string) => Effect.Effect<string | null, DatabaseError>;
    /** The category's `slug`, or null if it has none / does not exist — for `TransactionResponse.categorySlug`. */
    readonly categorySlugOf: (categoryId: string | null) => Effect.Effect<string | null, DatabaseError>;
    /**
     * `categorySlugOf` for a whole page of transactions in ONE query.
     * `listTransactions` serves up to `limit=200` rows and every row needs its
     * slug, so resolving them one at a time is 200 extra round trips on the most
     * frequently refetched endpoint in the app.
     */
    readonly categorySlugsByIds: (categoryIds: readonly string[]) => Effect.Effect<Map<string, string>, DatabaseError>;
  }
>()("toon/api/modules/finance/services/categories/categories.service/FinanceCategories") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const database = yield* Database;

      const usageCountOf = Effect.fnUntraced(function* (householdId: string, categoryId: string) {
        const rows = yield* database.use((db) =>
          db
            .select({ value: count() })
            .from(transactions)
            .where(and(eq(transactions.householdId, householdId), eq(transactions.categoryId, categoryId))),
        );
        return Number(rows[0]?.value ?? 0);
      });

      const loadCategoryOr404 = Effect.fnUntraced(function* (householdId: string, categoryId: string) {
        const rows = yield* database.use((db) =>
          db
            .select()
            .from(categories)
            .where(and(eq(categories.id, categoryId), eq(categories.householdId, householdId)))
            .limit(1),
        );
        const row = rows[0];
        if (!row) return yield* new NotFound();
        return row;
      });

      const toResponse = Effect.fnUntraced(function* (householdId: string, row: CategoryRow, locale: Locale) {
        return toCategoryResponse(row, locale, yield* usageCountOf(householdId, row.id));
      });

      const nextPosition = Effect.fnUntraced(function* (householdId: string) {
        const rows = yield* database.use((db) =>
          db
            .select({ position: categories.position })
            .from(categories)
            .where(eq(categories.householdId, householdId))
            .orderBy(asc(categories.position)),
        );
        const last = rows.at(-1)?.position;
        return last === undefined ? 0 : last + 1;
      });

      const listCategories = Effect.fn("FinanceCategories.listCategories")(function* (
        householdId: string,
        locale: Locale,
        includeHidden: boolean,
      ) {
        const conditions = [eq(categories.householdId, householdId)];
        if (!includeHidden) conditions.push(eq(categories.isHidden, false));
        const rows = yield* database.use((db) =>
          db
            .select()
            .from(categories)
            .where(and(...conditions))
            .orderBy(asc(categories.position)),
        );
        return yield* Effect.forEach(rows, (row) => toResponse(householdId, row, locale));
      });

      const createCategory = Effect.fn("FinanceCategories.createCategory")(function* (
        householdId: string,
        locale: Locale,
        input: CreateCategoryInput,
      ) {
        const id = crypto.randomUUID();
        const slug = `custom-${id.slice(0, 8)}`;
        const timestamp = yield* financeTimeMillis;
        const position = input.position ?? (yield* nextPosition(householdId));

        yield* database
          .use((db) =>
            db.insert(categories).values({
              id,
              householdId,
              slug,
              customLabel: input.label,
              isSystem: false,
              isHidden: false,
              position,
              createdAt: timestamp,
              updatedAt: timestamp,
            }),
          )
          .pipe(
            Effect.catchTag("DatabaseError", (error) =>
              Effect.gen(function* () {
                if (!isUniqueViolation(error.cause)) return yield* error;
                return yield* new Conflict({ code: "category_slug_taken", text: "server.category.slugTaken" });
              }),
            ),
          );

        return yield* toResponse(householdId, yield* loadCategoryOr404(householdId, id), locale);
      });

      const updateCategory = Effect.fn("FinanceCategories.updateCategory")(function* (
        householdId: string,
        locale: Locale,
        categoryId: string,
        input: UpdateCategoryInput,
      ) {
        const row = yield* loadCategoryOr404(householdId, categoryId);
        if (row.isSystem && input.label !== undefined) {
          return yield* new Conflict({ code: "category_system", text: "server.category.system" });
        }

        const patch: Partial<typeof categories.$inferInsert> = { updatedAt: yield* financeTimeMillis };
        if (input.label !== undefined) patch.customLabel = input.label;
        if (input.isHidden !== undefined) patch.isHidden = input.isHidden;
        if (input.position !== undefined) patch.position = input.position;

        yield* database.use((db) => db.update(categories).set(patch).where(eq(categories.id, categoryId)));
        return yield* toResponse(householdId, yield* loadCategoryOr404(householdId, categoryId), locale);
      });

      const deleteCategory = Effect.fn("FinanceCategories.deleteCategory")(function* (
        householdId: string,
        categoryId: string,
        reassignTo?: string,
      ) {
        const row = yield* loadCategoryOr404(householdId, categoryId);
        if (row.isSystem) return yield* new Conflict({ code: "category_system", text: "server.category.system" });

        const usage = yield* usageCountOf(householdId, categoryId);
        if (usage > 0) {
          if (!reassignTo) {
            return yield* new Conflict({
              code: "category_in_use",
              text: { key: "server.category.inUse", values: { count: usage } },
            });
          }
          if (reassignTo === categoryId) return yield* new BadRequest();
          yield* loadCategoryOr404(householdId, reassignTo);
        }

        yield* database.transaction(
          Effect.gen(function* () {
            if (usage > 0 && reassignTo) {
              const updatedAt = yield* financeTimeMillis;
              yield* database.use((db) =>
                db
                  .update(transactions)
                  .set({ categoryId: reassignTo, updatedAt })
                  .where(and(eq(transactions.householdId, householdId), eq(transactions.categoryId, categoryId))),
              );
            }
            yield* database.use((db) => db.delete(categories).where(eq(categories.id, categoryId)));
          }),
        );
      });

      const systemCategoryId = Effect.fn("FinanceCategories.systemCategoryId")(function* (householdId: string) {
        const rows = yield* database.use((db) =>
          db
            .select({ id: categories.id })
            .from(categories)
            .where(and(eq(categories.householdId, householdId), eq(categories.isSystem, true)))
            .limit(1),
        );
        return rows[0]?.id ?? null;
      });

      const categoryIdBySlug = Effect.fn("FinanceCategories.categoryIdBySlug")(function* (
        householdId: string,
        slug: string,
      ) {
        const rows = yield* database.use((db) =>
          db
            .select({ id: categories.id })
            .from(categories)
            .where(and(eq(categories.householdId, householdId), eq(categories.slug, slug)))
            .limit(1),
        );
        return rows[0]?.id ?? null;
      });

      const categorySlugOf = Effect.fn("FinanceCategories.categorySlugOf")(function* (categoryId: string | null) {
        if (!categoryId) return null;
        const rows = yield* database.use((db) =>
          db.select({ slug: categories.slug }).from(categories).where(eq(categories.id, categoryId)).limit(1),
        );
        return rows[0]?.slug ?? null;
      });

      const categorySlugsByIds = Effect.fn("FinanceCategories.categorySlugsByIds")(function* (
        categoryIds: readonly string[],
      ) {
        const slugs = new Map<string, string>();
        if (categoryIds.length === 0) return slugs; // `inArray` with an empty list is not valid SQL
        const rows = yield* database.use((db) =>
          db
            .select({ id: categories.id, slug: categories.slug })
            .from(categories)
            .where(inArray(categories.id, [...categoryIds])),
        );
        for (const row of rows) slugs.set(row.id, row.slug);
        return slugs;
      });

      return FinanceCategories.of({
        listCategories,
        createCategory,
        updateCategory,
        deleteCategory,
        systemCategoryId,
        categoryIdBySlug,
        categorySlugOf,
        categorySlugsByIds,
      });
    }),
  );
}

/* legacy bridges: callers listed; E3 (recipe), E4 (finance), E5 (scripts) remove them */

/** Callers: `routes/categories.ts` (E4-T08 deletes it). */
export function listCategories(
  db: DrizzleDatabase,
  householdId: string,
  locale: Locale,
  includeHidden: boolean,
): Promise<CategoryResponse[]> {
  return runFinanceBridge(FinanceCategories.use((service) => service.listCategories(householdId, locale, includeHidden)), db);
}

/** Callers: `routes/categories.ts` (E4-T08 deletes it). */
export function createCategory(
  db: DrizzleDatabase,
  householdId: string,
  locale: Locale,
  input: CreateCategoryInput,
): Promise<CategoryResponse> {
  return runFinanceBridge(FinanceCategories.use((service) => service.createCategory(householdId, locale, input)), db);
}

/** Callers: `routes/categories.ts` (E4-T08 deletes it). */
export function updateCategory(
  db: DrizzleDatabase,
  householdId: string,
  locale: Locale,
  categoryId: string,
  input: UpdateCategoryInput,
): Promise<CategoryResponse> {
  return runFinanceBridge(
    FinanceCategories.use((service) => service.updateCategory(householdId, locale, categoryId, input)),
    db,
  );
}

/** Callers: `routes/categories.ts` (E4-T08 deletes it). */
export function deleteCategory(db: DrizzleDatabase, householdId: string, categoryId: string, reassignTo?: string): Promise<void> {
  return runFinanceBridge(FinanceCategories.use((service) => service.deleteCategory(householdId, categoryId, reassignTo)), db);
}

/** Callers: `settlements.service.ts` (E4-T04), `accrual.service.ts` (E4-T06), `seed.ts` (E4-T07), `apps/api/scripts/finance-import-xlsx.ts` (E5, survivor). */
export function categoryIdBySlug(db: DbLike, householdId: string, slug: string): Promise<string | null> {
  return runFinanceBridge(FinanceCategories.use((service) => service.categoryIdBySlug(householdId, slug)), db);
}

/** Callers: `transactions.service.ts` (E4-T04). */
export function categorySlugOf(db: DbLike, categoryId: string | null): Promise<string | null> {
  return runFinanceBridge(FinanceCategories.use((service) => service.categorySlugOf(categoryId)), db);
}

/** Callers: `transactions.service.ts` (E4-T04). */
export function categorySlugsByIds(db: DbLike, categoryIds: readonly string[]): Promise<Map<string, string>> {
  return runFinanceBridge(FinanceCategories.use((service) => service.categorySlugsByIds(categoryIds)), db);
}
