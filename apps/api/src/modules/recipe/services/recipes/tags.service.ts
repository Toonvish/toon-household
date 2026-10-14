/**
 * Tags. Household-scoped, unique per household (case-insensitive, German folded) and
 * always get-or-create when a recipe references a tag NAME, so tagging can
 * never 404.
 */
import type { CreateTagRequest, Tag, TagKind, UpdateTagRequest } from "@toon/shared";
import { and, asc, count, eq, inArray, ne } from "drizzle-orm";
import { recipeTags, tags } from "../../../../db/schema.ts";
import type { TagRow } from "../../../../db/schema.ts";
import { ApiError } from "../../../../lib/errors.ts";
import { type DbLike, eqFolded, foldText, nowMs, unique } from "../../../../core/services/households/support.ts";
import { toTag } from "./mappers.ts";

/** All tags of a household with their usage count — ONE grouped query. */
export async function listTags(db: DbLike, householdId: string): Promise<Tag[]> {
  const rows = await db
    .select({ tag: tags, recipeCount: count(recipeTags.recipeId) })
    .from(tags)
    .leftJoin(recipeTags, eq(recipeTags.tagId, tags.id))
    .where(eq(tags.householdId, householdId))
    .groupBy(tags.id)
    .orderBy(asc(tags.name));
  return rows.map((row) => toTag(row.tag, Number(row.recipeCount)));
}

/** The raw tag row of a household or a 404 (never leaks tags of other households). */
export async function loadTagRow(db: DbLike, householdId: string, tagId: string): Promise<TagRow> {
  const [row] = await db
    .select()
    .from(tags)
    .where(and(eq(tags.id, tagId), eq(tags.householdId, householdId)))
    .limit(1);
  if (!row) throw ApiError.notFound("server.recipes.tagNotFound");
  return row;
}

/** Creates a tag; duplicate names collide with 409 `tag_name_taken`. */
export async function createTag(
  db: DbLike,
  householdId: string,
  input: CreateTagRequest,
): Promise<Tag> {
  const clash = await db
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.householdId, householdId), eqFolded(tags.name, input.name)))
    .limit(1);
  if (clash.length > 0) throw ApiError.conflict("tag_name_taken", "server.recipes.tagNameTaken");

  const row: TagRow = {
    id: crypto.randomUUID(),
    householdId,
    name: input.name,
    color: input.color ?? null,
    kind: input.kind ?? "free",
    createdAt: nowMs(),
  };
  await db.insert(tags).values(row);
  return toTag(row, 0);
}

/** Renames/recolors a tag. */
export async function updateTag(
  db: DbLike,
  householdId: string,
  tagId: string,
  input: UpdateTagRequest,
): Promise<Tag> {
  const row = await loadTagRow(db, householdId, tagId);

  if (input.name !== undefined && foldText(input.name) !== foldText(row.name)) {
    const clash = await db
      .select({ id: tags.id })
      .from(tags)
      .where(
        and(eq(tags.householdId, householdId), ne(tags.id, tagId), eqFolded(tags.name, input.name)),
      )
      .limit(1);
    if (clash.length > 0) throw ApiError.conflict("tag_name_taken", "server.recipes.tagNameTaken");
  }

  const patch: Partial<TagRow> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.color !== undefined) patch.color = input.color ?? null;
  if (input.kind !== undefined) patch.kind = input.kind;
  if (Object.keys(patch).length > 0) {
    await db.update(tags).set(patch).where(eq(tags.id, tagId));
  }

  const [usage] = await db
    .select({ value: count() })
    .from(recipeTags)
    .where(eq(recipeTags.tagId, tagId));

  return toTag({ ...row, ...patch }, Number(usage?.value ?? 0));
}

/** Deletes a tag; the recipe_tags links cascade. */
export async function deleteTag(db: DbLike, householdId: string, tagId: string): Promise<void> {
  await loadTagRow(db, householdId, tagId);
  await db.delete(tags).where(eq(tags.id, tagId));
}

/**
 * Maps tag NAMES to ids inside a household, creating the missing ones.
 * Two queries in total (one select, one bulk insert) — never one per name.
 *
 * `kind` is applied ONLY to tags this call CREATES. It must never update the kind
 * of a tag it FOUND — an old client that sends the course name inside `tags` (no
 * `course` field at all) links the existing course tag as-is, rather than
 * flipping it to `free` under it.
 */
export async function getOrCreateTagIds(
  db: DbLike,
  householdId: string,
  names: readonly string[],
  kind: TagKind = "free",
): Promise<string[]> {
  const wanted = new Map<string, string>();
  for (const name of names) {
    const trimmed = name.trim();
    if (trimmed.length === 0) continue;
    const key = foldText(trimmed);
    if (!wanted.has(key)) wanted.set(key, trimmed);
  }
  if (wanted.size === 0) return [];

  const existing = await db
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(eq(tags.householdId, householdId));

  const byKey = new Map<string, string>();
  for (const row of existing) byKey.set(foldText(row.name), row.id);

  const inserts: TagRow[] = [];
  for (const [key, name] of wanted) {
    if (byKey.has(key)) continue;
    const row: TagRow = {
      id: crypto.randomUUID(),
      householdId,
      name,
      color: null,
      kind,
      createdAt: nowMs(),
    };
    inserts.push(row);
    byKey.set(key, row.id);
  }
  if (inserts.length > 0) await db.insert(tags).values(inserts);

  return unique([...wanted.keys()].map((key) => byKey.get(key)).filter((id): id is string => !!id));
}

/** Tags of many recipes in ONE query, grouped by recipe id (no N+1). */
export async function tagsByRecipe(
  db: DbLike,
  recipeIds: readonly string[],
): Promise<Map<string, Tag[]>> {
  const result = new Map<string, Tag[]>();
  if (recipeIds.length === 0) return result;

  const rows = await db
    .select({ recipeId: recipeTags.recipeId, tag: tags })
    .from(recipeTags)
    .innerJoin(tags, eq(tags.id, recipeTags.tagId))
    .where(inArray(recipeTags.recipeId, [...recipeIds]))
    .orderBy(asc(tags.name));

  for (const row of rows) {
    const list = result.get(row.recipeId);
    const tag = toTag(row.tag);
    if (list) list.push(tag);
    else result.set(row.recipeId, [tag]);
  }
  return result;
}
