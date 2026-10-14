/**
 * @toon/shared — the single source of truth for the toon-household API contract.
 *
 * Contains ONLY pure code: Zod schemas, inferred types and parsers.
 * Never import node/bun APIs here — the web bundle imports this module too.
 * Module code lives in `modules/<id>/` and is re-exported here when the
 * module lands. The finance module (M3) is re-exported flat as well: its
 * pure ledger logic and wire contract, with names renamed where recipe or
 * the core already use them (`modules/finance/index.ts`, M3 decision 8).
 */

export * from "./core/index.ts";
export * from "./modules/registry.ts";
export * from "./modules/recipe/index.ts";
export * from "./modules/finance/index.ts";
