/**
 * The finance module's shared surface (SPEC §2, D10): F's pure ledger logic
 * (money, ledger, period, plan, categories, tags) and F's wire contract for the
 * ledger routes, plus the participants contract (M3 decision 4). Re-exported
 * flat from the package entry; names that would collide with recipe or the core
 * are renamed with a `Finance` prefix (M3 decision 8).
 */

// --- pure domain logic -------------------------------------------------------
export * from "./money.ts";
export * from "./ledger.ts";
export * from "./period.ts";
export * from "./plan.ts";
export * from "./categories.ts";
export * from "./tags.ts";

// --- contract: schemas + inferred types -------------------------------------
export * from "./schemas/common.ts";
export * from "./schemas/transactions.ts";
export * from "./schemas/categories.ts";
export * from "./schemas/tags.ts";
export * from "./schemas/plan.ts";
export * from "./schemas/balance.ts";
export * from "./schemas/settlements.ts";
export * from "./schemas/participants.ts";
