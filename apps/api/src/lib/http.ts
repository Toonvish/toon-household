/**
 * Tiny response helpers so every route answers with the same shapes/statuses.
 */
import type { Context } from "hono";

/** 200 + JSON. */
export function json<T>(c: Context, data: T): Response {
  return c.json(data as never, 200);
}

/** 201 + JSON (optionally with a Location header). */
export function created<T>(c: Context, data: T, location?: string): Response {
  if (location) c.header("Location", location);
  return c.json(data as never, 201);
}

/** 204, no body. */
export function noContent(c: Context): Response {
  return c.body(null, 204);
}

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
