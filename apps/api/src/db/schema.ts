/**
 * The ONE Drizzle schema of toon-household (SPEC D7): one libSQL file, one schema,
 * one migration journal. It is split per owner and re-exported from here, so
 * `db/client.ts`, `drizzle.config.ts` and every service import this file only.
 *
 * - `schema/core.ts` — users/auth, households, members, invites, household_modules,
 *   legacy_ids (unprefixed core tables).
 * - `modules/recipe/schema.ts` — the 17 `recipe_` tables (M2). Its TS identifiers
 *   (`recipes`, `tags`, `cards`, …) are re-exported flat, so finance's schema (M3)
 *   must give its own identifiers a `finance` prefix (`financeTags`, …).
 *
 * This re-export is the one place outside `modules/index.ts` where the core names a
 * module path: drizzle needs every table in one schema object.
 */
export * from "./schema/core.ts";
export * from "../modules/recipe/schema.ts";
