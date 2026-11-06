/**
 * The calendar module's shared surface (docs/modules/calendar.md §3, plan m8 section 5.1): the pure date and
 * recurrence logic, the waste provider registry, the person colours and the wire contract. Re-exported flat from
 * the package entry; every name that could collide carries a `Calendar` (or `Waste`) prefix. Nothing here imports
 * another module (module boundary, SPEC §2).
 */

// --- pure domain logic -------------------------------------------------------
export * from "./limits.ts";
export * from "./dates.ts";
export * from "./recurrence.ts";
export * from "./people.ts";
export * from "./waste.ts";

// --- contract: schemas + inferred types -------------------------------------
export * from "./schemas/common.ts";
export * from "./schemas/entries.ts";
export * from "./schemas/occurrences.ts";
export * from "./schemas/resources.ts";
export * from "./schemas/waste.ts";
