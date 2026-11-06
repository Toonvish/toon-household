/**
 * The calendar module's TanStack Query keys (plan m8 P24, section 5.4), built on the core key factory in
 * `@/lib/queries`. Core keys come from the spread, never redefined.
 *
 * Key layout:
 *   ["toon","household",householdId,"calendar"]                                    <- every calendar query (a write invalidates it)
 *   [...all, "occurrences", from, to, filterKey(filters)]                          <- persisted
 *   [...all, "entries", filterKey(filters)]                                        <- persisted
 *   [...all, "entry", entryId]                                                     <- persisted
 *   [...all, "resources", { includeArchived }]                                     <- persisted
 *   [...all, "waste", from]                                                        <- persisted
 *
 * FOUNDATION SKELETON (M8-T03): the keys only; the lane web (M8-T13) adds the query options, the mutations, the
 * optimistic done toggle and the offline guard (writes are online only, P24).
 */
import { filterKey } from "@/lib/queries";

export * from "@/lib/queries";

const ROOT = "toon" as const;

export const calendarKeys = {
  all: (householdId: string) => [ROOT, "household", householdId, "calendar"] as const,
  occurrences: (householdId: string, from: string, to: string, filters?: Record<string, unknown>) =>
    [ROOT, "household", householdId, "calendar", "occurrences", from, to, filterKey(filters)] as const,
  entries: (householdId: string, filters?: Record<string, unknown>) =>
    [ROOT, "household", householdId, "calendar", "entries", filterKey(filters)] as const,
  entry: (householdId: string, entryId: string) => [ROOT, "household", householdId, "calendar", "entry", entryId] as const,
  resources: (householdId: string, includeArchived = false) =>
    [ROOT, "household", householdId, "calendar", "resources", { includeArchived }] as const,
  waste: (householdId: string, from: string) => [ROOT, "household", householdId, "calendar", "waste", from] as const,
};
