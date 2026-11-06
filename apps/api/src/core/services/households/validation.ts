/**
 * Helpers shared by the household-scoped routes' validation.
 */
import { Predicate } from "effect";

/**
 * CONTRACT WORKAROUND (frozen @toon/shared schemas, cannot be changed here):
 * `UpdateRecipeRequestSchema` / `UpdateCollectionRequestSchema` are
 * `CreateXRequestSchema.partial()`, and the shared schema keeps the `.default([])` of the
 * replace-all child arrays. `PATCH { title: "neu" }` therefore parses to
 * `{ title, ingredients: [], steps: [], tags: [], collectionIds: [] }`, which
 * would wipe every child row — while docs/API.md says absent means untouched.
 *
 * So we drop the listed keys again unless they really were in the JSON body.
 * The pre-E7 Hono app cached the parsed body, so reading it after the validator was free.
 */
export function keepOnlySentKeys<T extends object>(
  validated: T,
  rawBody: unknown,
  keys: readonly (keyof T & string)[],
): T {
  const sent =
    Predicate.isObjectOrArray(rawBody) ? (rawBody as Record<string, unknown>) : {};
  const result = { ...validated };
  for (const key of keys) {
    if (!Object.hasOwn(sent, key)) delete result[key];
  }
  return result;
}
