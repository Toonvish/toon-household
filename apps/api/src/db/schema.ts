/**
 * The ONE Drizzle schema of toon-household (SPEC D7): one libSQL file, one schema,
 * one migration journal. It is split per owner and re-exported from here, so
 * `db/client.ts`, `drizzle.config.ts` and every service import this file only.
 *
 * - `schema/core.ts` — users/auth, households, members, invites, household_modules,
 *   legacy_ids (unprefixed core tables).
 * - Module schemas (`modules/<id>/schema.ts`, tables prefixed `<id>_`) are re-exported
 *   here when their module lands: recipe in M2, finance in M3.
 */
export * from "./schema/core.ts";
