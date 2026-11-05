/**
 * Tiny response helpers so every route answers with the same shapes/statuses.
 *
 * The wire formats (`toIso`, `toIsoOrNull`, `parseCsvParam`) are shared by every route. The response helpers of the
 * Effect HTTP layer are `json`, `created`, `noContent`, `redirect`, `fromWeb` of `apps/api/src/http/response.ts` (plan
 * `docs/plans/e7-http-api.md` P10); the Hono ones below stay until E7-T12 deletes the section.
 */

/** Unix ms -> ISO string, the wire format for every timestamp. */
export function toIso(value: number | Date): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

/** Unix ms -> ISO string, preserving null/undefined. */
export function toIsoOrNull(value: number | null | undefined): string | null {
  return value === null || value === undefined ? null : new Date(value).toISOString();
}

/** Splits a "a,b,c" query param into a trimmed, de-duplicated list. */
export function parseCsvParam(value: string | undefined): string[] {
  if (!value) return [];
  return [...new Set(value.split(",").map((part) => part.trim()).filter((part) => part.length > 0))];
}
