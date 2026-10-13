/**
 * One shared `zValidator` hook for both routers.
 *
 * @hono/zod-validator answers 400 with a raw ZodError by default; the contract
 * wants 422 `validation_failed` with a compact `details` array, so every
 * validator in core/routes/ and in the module routers passes this hook.
 */
import { ApiError } from "../../../lib/errors.ts";

interface ValidationIssue {
  path: string;
  code: string;
  message: string;
}

interface ZodLikeError {
  issues?: ReadonlyArray<{ path: ReadonlyArray<string | number | symbol>; code: string; message: string }>;
}

function toIssues(error: unknown): ValidationIssue[] | undefined {
  const issues = (error as ZodLikeError | undefined)?.issues;
  if (!issues) return undefined;
  return issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    code: issue.code,
    message: issue.message,
  }));
}

/**
 * Throws 422 `validation_failed`; the global onError builds the envelope.
 *
 * A non-Zod error yields NO `details` rather than a fallback sentence. That
 * sentence used to be a German literal in the `details` SLOT — not the message
 * slot — so it went out on the wire untranslated whatever the request asked for,
 * and it said nothing `validationFailed`'s own default message does not already
 * say (`server.error.validationFailed`, rendered in the negotiated locale).
 */
export function onValidationError(result: { success: boolean; error?: unknown }): void {
  if (result.success) return;
  throw ApiError.validationFailed(toIssues(result.error));
}

/**
 * CONTRACT WORKAROUND (frozen @toon/shared schemas, cannot be changed here):
 * `UpdateRecipeRequestSchema` / `UpdateCollectionRequestSchema` are
 * `CreateXRequestSchema.partial()`, and zod KEEPS the `.default([])` of the
 * replace-all child arrays. `PATCH { title: "neu" }` therefore parses to
 * `{ title, ingredients: [], steps: [], tags: [], collectionIds: [] }`, which
 * would wipe every child row — while docs/API.md says absent means untouched.
 *
 * So we drop the listed keys again unless they really were in the JSON body.
 * Hono caches the parsed body, so reading it after the validator is free.
 */
export function keepOnlySentKeys<T extends object>(
  validated: T,
  rawBody: unknown,
  keys: readonly (keyof T & string)[],
): T {
  const sent =
    rawBody !== null && typeof rawBody === "object" ? (rawBody as Record<string, unknown>) : {};
  const result = { ...validated };
  for (const key of keys) {
    if (!Object.hasOwn(sent, key)) delete result[key];
  }
  return result;
}
