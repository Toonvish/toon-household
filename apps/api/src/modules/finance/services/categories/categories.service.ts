/**
 * Categories: CRUD, the fully-rendered `label` (docs/spec.md §3.10 — `customLabel
 * ?? t(categories.name.<slug>)` in the NEGOTIATED request locale, never
 * `households.defaultLocale`: a default label is read-time UI copy, not a
 * stored fact, until the household renames the row), and delete-with-reassign.
 */
import type { CategoryResponse, Locale, ServerKey } from "@toon/shared";
import { serverText } from "@toon/shared";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { type FinanceCategoryRow as CategoryRow, financeCategories as categories, financeTransactions as transactions } from "../../schema.ts";
import { ApiError } from "../../../../lib/errors.ts";
import { nowMs } from "../../lib/clock.ts";
import { isUniqueViolation } from "../../../../core/services/auth/users.ts";
import type { DbLike } from "../support.ts";
import { withTransaction } from "../support.ts";
import type { Database } from "../../../../db/client.ts";

/** `categories.name.<slug>`'s mirror in the server catalog (packages/shared/src/i18n/catalogs/server.de.ts). */
function categoryNameKey(slug: string): ServerKey {
  return `server.category.name.${slug}` as ServerKey;
}

async function usageCountOf(db: DbLike, householdId: string, categoryId: string): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(transactions)
    .where(and(eq(transactions.householdId, householdId), eq(transactions.categoryId, categoryId)));
  return Number(rows[0]?.value ?? 0);
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

async function loadCategoryOr404(db: DbLike, householdId: string, categoryId: string): Promise<CategoryRow> {
  const rows = await db
    .select()
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.householdId, householdId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw ApiError.notFound();
  return row;
}

async function toResponse(db: DbLike, householdId: string, row: CategoryRow, locale: Locale): Promise<CategoryResponse> {
  return toCategoryResponse(row, locale, await usageCountOf(db, householdId, row.id));
}

export async function listCategories(
  db: Database,
  householdId: string,
  locale: Locale,
  includeHidden: boolean,
): Promise<CategoryResponse[]> {
  const conditions = [eq(categories.householdId, householdId)];
  if (!includeHidden) conditions.push(eq(categories.isHidden, false));
  const rows = await db
    .select()
    .from(categories)
    .where(and(...conditions))
    .orderBy(asc(categories.position));
  return Promise.all(rows.map((row) => toResponse(db, householdId, row, locale)));
}

async function nextPosition(db: DbLike, householdId: string): Promise<number> {
  const rows = await db
    .select({ position: categories.position })
    .from(categories)
    .where(eq(categories.householdId, householdId))
    .orderBy(asc(categories.position));
  const last = rows.at(-1)?.position;
  return last === undefined ? 0 : last + 1;
}

export interface CreateCategoryInput {
  label: string;
  position?: number;
}

/**
 * `slug = "custom-" + id.slice(0, 8)` keeps the default-slug namespace clean
 * (docs/spec.md §3.10). The unique index on `(household_id, slug)` is the
 * real guarantee; `category_slug_taken` only fires on the astronomically
 * unlikely uuid-prefix collision, caught here rather than left as a raw
 * constraint violation.
 */
export async function createCategory(db: Database, householdId: string, locale: Locale, input: CreateCategoryInput): Promise<CategoryResponse> {
  const id = crypto.randomUUID();
  const slug = `custom-${id.slice(0, 8)}`;
  const timestamp = nowMs();
  const position = input.position ?? (await nextPosition(db, householdId));

  try {
    await db.insert(categories).values({
      id,
      householdId,
      slug,
      customLabel: input.label,
      isSystem: false,
      isHidden: false,
      position,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw ApiError.conflict("category_slug_taken", "server.category.slugTaken");
    throw error;
  }

  return toResponse(db, householdId, await loadCategoryOr404(db, householdId, id), locale);
}

export interface UpdateCategoryInput {
  label?: string;
  isHidden?: boolean;
  position?: number;
}

/** `409 category_system` when `label` is set on the system (`fixkosten`) category — everything else on it may still change. */
export async function updateCategory(
  db: Database,
  householdId: string,
  locale: Locale,
  categoryId: string,
  input: UpdateCategoryInput,
): Promise<CategoryResponse> {
  const row = await loadCategoryOr404(db, householdId, categoryId);
  if (row.isSystem && input.label !== undefined) {
    throw ApiError.conflict("category_system", "server.category.system");
  }

  const patch: Partial<typeof categories.$inferInsert> = { updatedAt: nowMs() };
  if (input.label !== undefined) patch.customLabel = input.label;
  if (input.isHidden !== undefined) patch.isHidden = input.isHidden;
  if (input.position !== undefined) patch.position = input.position;

  await db.update(categories).set(patch).where(eq(categories.id, categoryId));
  return toResponse(db, householdId, await loadCategoryOr404(db, householdId, categoryId), locale);
}

/**
 * Deletes a category. `409 category_system` for `fixkosten` (the plan writes
 * into it). With transactions still attached: `409 category_in_use` unless
 * `reassignTo` names another category of the SAME household, in which case
 * every attached transaction is re-pointed and the category removed in one
 * transaction (docs/spec.md §3.10) — the honest alternative to silently
 * setting `category_id` to `NULL`.
 */
export async function deleteCategory(db: Database, householdId: string, categoryId: string, reassignTo?: string): Promise<void> {
  const row = await loadCategoryOr404(db, householdId, categoryId);
  if (row.isSystem) throw ApiError.conflict("category_system", "server.category.system");

  const usage = await usageCountOf(db, householdId, categoryId);
  if (usage > 0) {
    if (!reassignTo) throw ApiError.conflict("category_in_use", { key: "server.category.inUse", values: { count: usage } });
    if (reassignTo === categoryId) throw ApiError.badRequest();
    await loadCategoryOr404(db, householdId, reassignTo);
  }

  await withTransaction(db, async (tx) => {
    if (usage > 0 && reassignTo) {
      await tx
        .update(transactions)
        .set({ categoryId: reassignTo, updatedAt: nowMs() })
        .where(and(eq(transactions.householdId, householdId), eq(transactions.categoryId, categoryId)));
    }
    await tx.delete(categories).where(eq(categories.id, categoryId));
  });
}

/** The `fixkosten` category's id for this household — the plan books into it. Never null: seeded at household creation. */
export async function systemCategoryId(db: DbLike, householdId: string): Promise<string | null> {
  const rows = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.householdId, householdId), eq(categories.isSystem, true)))
    .limit(1);
  return rows[0]?.id ?? null;
}

/** Looks up a category by its stable slug (e.g. `"ausgleich"` for a settlement's default category). Null if renamed away or never seeded. */
export async function categoryIdBySlug(db: DbLike, householdId: string, slug: string): Promise<string | null> {
  const rows = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.householdId, householdId), eq(categories.slug, slug)))
    .limit(1);
  return rows[0]?.id ?? null;
}

/** The category's `slug`, or null if it has none / does not exist — for `TransactionResponse.categorySlug`. */
export async function categorySlugOf(db: DbLike, categoryId: string | null): Promise<string | null> {
  if (!categoryId) return null;
  const rows = await db.select({ slug: categories.slug }).from(categories).where(eq(categories.id, categoryId)).limit(1);
  return rows[0]?.slug ?? null;
}

/**
 * {@link categorySlugOf} for a whole page of transactions in ONE query.
 * `listTransactions` serves up to `limit=200` rows and every row needs its
 * slug, so resolving them one at a time is 200 extra round trips on the most
 * frequently refetched endpoint in the app.
 */
export async function categorySlugsByIds(db: DbLike, categoryIds: readonly string[]): Promise<Map<string, string>> {
  const slugs = new Map<string, string>();
  if (categoryIds.length === 0) return slugs; // `inArray` with an empty list is not valid SQL
  const rows = await db.select({ id: categories.id, slug: categories.slug }).from(categories).where(inArray(categories.id, [...categoryIds]));
  for (const row of rows) slugs.set(row.id, row.slug);
  return slugs;
}
