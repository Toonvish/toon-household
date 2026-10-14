/**
 * @toon/shared — the single source of truth for the toon-household API contract.
 *
 * Contains ONLY pure code: Zod schemas, inferred types and parsers.
 * Never import node/bun APIs here — the web bundle imports this module too.
 * Module code lives in `modules/<id>/` and is re-exported here when the
 * module lands.
 */

export * from "./core/index.ts";
export * from "./modules/registry.ts";
export * from "./modules/recipe/index.ts";
