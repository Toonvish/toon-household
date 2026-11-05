/**
 * Tags. Household-scoped, unique per household (case-insensitive, German folded) and
 * always get-or-create when a recipe references a tag NAME, so tagging can
 * never 404.
 *
 * AS A SERVICE (docs/EFFECT.md E7, E12; plan `docs/plans/e3-recipe-services.md` P2, P8, P9). `RecipeTags` reads the
 * current executor of `Database` on every call (inside `Database.transaction` that is the open transaction, so
 * `recipes.service.ts` tags a recipe on its own `tx`), takes `createdAt` from the `Clock`, and refuses with the tagged
 * family.
 */
import type { CreateTagRequest, Tag, TagKind, UpdateTagRequest } from "@toon/shared";
import { and, asc, count, eq, inArray, ne } from "drizzle-orm";
import { Clock, Context, Effect, Layer } from "effect";
import { Database } from "../../../../db/database.ts";
import { recipeTags, tags } from "../../../../db/schema.ts";
import type { TagRow } from "../../../../db/schema.ts";
import { Conflict, NotFound } from "../../../../lib/errors.ts";
import type { DatabaseError } from "../../../../lib/errors.ts";
import { eqFolded, foldText, unique } from "../../../../core/services/households/support.ts";
import { toTag } from "./mappers.ts";

/** Tags of a household: CRUD, the get-or-create by name and the per-recipe lookup. */
export class RecipeTags extends Context.Service<
  RecipeTags,
  {
    /** All tags of a household with their usage count — ONE grouped query. */
    readonly listTags: (householdId: string) => Effect.Effect<Tag[], DatabaseError>;
    /** The raw tag row of a household or a 404 (never leaks tags of other households). */
    readonly loadTagRow: (householdId: string, tagId: string) => Effect.Effect<TagRow, NotFound | DatabaseError>;
    /** Creates a tag; duplicate names collide with 409 `tag_name_taken`. */
    readonly createTag: (householdId: string, input: CreateTagRequest) => Effect.Effect<Tag, Conflict | DatabaseError>;
    /** Renames/recolors a tag. */
    readonly updateTag: (
      householdId: string,
      tagId: string,
      input: UpdateTagRequest,
    ) => Effect.Effect<Tag, NotFound | Conflict | DatabaseError>;
    /** Deletes a tag; the recipe_tags links cascade. */
    readonly deleteTag: (householdId: string, tagId: string) => Effect.Effect<void, NotFound | DatabaseError>;
    /**
     * Maps tag NAMES to ids inside a household, creating the missing ones.
     * Two queries in total (one select, one bulk insert) — never one per name.
     *
     * `kind` is applied ONLY to tags this call CREATES. It must never update the kind
     * of a tag it FOUND — an old client that sends the course name inside `tags` (no
     * `course` field at all) links the existing course tag as-is, rather than
     * flipping it to `free` under it.
     */
    readonly getOrCreateTagIds: (
      householdId: string,
      names: readonly string[],
      kind?: TagKind,
    ) => Effect.Effect<string[], DatabaseError>;
    /** Tags of many recipes in ONE query, grouped by recipe id (no N+1). */
    readonly tagsByRecipe: (recipeIds: readonly string[]) => Effect.Effect<Map<string, Tag[]>, DatabaseError>;
  }
>()("toon/api/modules/recipe/services/recipes/tags.service/RecipeTags") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const database = yield* Database;

      const listTags = Effect.fn("RecipeTags.listTags")(function* (householdId: string) {
        const rows = yield* database.use((db) =>
          db
            .select({ tag: tags, recipeCount: count(recipeTags.recipeId) })
            .from(tags)
            .leftJoin(recipeTags, eq(recipeTags.tagId, tags.id))
            .where(eq(tags.householdId, householdId))
            .groupBy(tags.id)
            .orderBy(asc(tags.name)),
        );
        return rows.map((row) => toTag(row.tag, Number(row.recipeCount)));
      });

      const loadTagRow = Effect.fn("RecipeTags.loadTagRow")(function* (householdId: string, tagId: string) {
        const [row] = yield* database.use((db) =>
          db
            .select()
            .from(tags)
            .where(and(eq(tags.id, tagId), eq(tags.householdId, householdId)))
            .limit(1),
        );
        if (!row) return yield* new NotFound({ text: "server.recipes.tagNotFound" });
        return row;
      });

      const createTag = Effect.fn("RecipeTags.createTag")(function* (householdId: string, input: CreateTagRequest) {
        const clash = yield* database.use((db) =>
          db
            .select({ id: tags.id })
            .from(tags)
            .where(and(eq(tags.householdId, householdId), eqFolded(tags.name, input.name)))
            .limit(1),
        );
        if (clash.length > 0) {
          return yield* new Conflict({ code: "tag_name_taken", text: "server.recipes.tagNameTaken" });
        }

        const row: TagRow = {
          id: crypto.randomUUID(),
          householdId,
          name: input.name,
          color: input.color ?? null,
          kind: input.kind ?? "free",
          createdAt: yield* Clock.currentTimeMillis,
        };
        yield* database.use((db) => db.insert(tags).values(row));
        return toTag(row, 0);
      });

      const updateTag = Effect.fn("RecipeTags.updateTag")(function* (
        householdId: string,
        tagId: string,
        input: UpdateTagRequest,
      ) {
        const row = yield* loadTagRow(householdId, tagId);

        if (input.name !== undefined && foldText(input.name) !== foldText(row.name)) {
          const name = input.name;
          const clash = yield* database.use((db) =>
            db
              .select({ id: tags.id })
              .from(tags)
              .where(and(eq(tags.householdId, householdId), ne(tags.id, tagId), eqFolded(tags.name, name)))
              .limit(1),
          );
          if (clash.length > 0) {
            return yield* new Conflict({ code: "tag_name_taken", text: "server.recipes.tagNameTaken" });
          }
        }

        const patch: Partial<TagRow> = {};
        if (input.name !== undefined) patch.name = input.name;
        if (input.color !== undefined) patch.color = input.color ?? null;
        if (input.kind !== undefined) patch.kind = input.kind;
        if (Object.keys(patch).length > 0) {
          yield* database.use((db) => db.update(tags).set(patch).where(eq(tags.id, tagId)));
        }

        const [usage] = yield* database.use((db) =>
          db.select({ value: count() }).from(recipeTags).where(eq(recipeTags.tagId, tagId)),
        );

        return toTag({ ...row, ...patch }, Number(usage?.value ?? 0));
      });

      const deleteTag = Effect.fn("RecipeTags.deleteTag")(function* (householdId: string, tagId: string) {
        yield* loadTagRow(householdId, tagId);
        yield* database.use((db) => db.delete(tags).where(eq(tags.id, tagId)));
      });

      const getOrCreateTagIds = Effect.fn("RecipeTags.getOrCreateTagIds")(function* (
        householdId: string,
        names: readonly string[],
        kind: TagKind = "free",
      ) {
        const wanted = new Map<string, string>();
        for (const name of names) {
          const trimmed = name.trim();
          if (trimmed.length === 0) continue;
          const key = foldText(trimmed);
          if (!wanted.has(key)) wanted.set(key, trimmed);
        }
        if (wanted.size === 0) return [];

        const existing = yield* database.use((db) =>
          db.select({ id: tags.id, name: tags.name }).from(tags).where(eq(tags.householdId, householdId)),
        );

        const byKey = new Map<string, string>();
        for (const row of existing) byKey.set(foldText(row.name), row.id);

        const createdAt = yield* Clock.currentTimeMillis;
        const inserts: TagRow[] = [];
        for (const [key, name] of wanted) {
          if (byKey.has(key)) continue;
          const row: TagRow = {
            id: crypto.randomUUID(),
            householdId,
            name,
            color: null,
            kind,
            createdAt,
          };
          inserts.push(row);
          byKey.set(key, row.id);
        }
        if (inserts.length > 0) yield* database.use((db) => db.insert(tags).values(inserts));

        return unique([...wanted.keys()].map((key) => byKey.get(key)).filter((id): id is string => !!id));
      });

      const tagsByRecipe = Effect.fn("RecipeTags.tagsByRecipe")(function* (recipeIds: readonly string[]) {
        const result = new Map<string, Tag[]>();
        if (recipeIds.length === 0) return result;

        const rows = yield* database.use((db) =>
          db
            .select({ recipeId: recipeTags.recipeId, tag: tags })
            .from(recipeTags)
            .innerJoin(tags, eq(tags.id, recipeTags.tagId))
            .where(inArray(recipeTags.recipeId, [...recipeIds]))
            .orderBy(asc(tags.name)),
        );

        for (const row of rows) {
          const list = result.get(row.recipeId);
          const tag = toTag(row.tag);
          if (list) list.push(tag);
          else result.set(row.recipeId, [tag]);
        }
        return result;
      });

      return RecipeTags.of({ listTags, loadTagRow, createTag, updateTag, deleteTag, getOrCreateTagIds, tagsByRecipe });
    }),
  );
}
