/**
 * Plan feature barrel.
 *
 * THIS FILE IS T7.3'S AND STAYS T7.3'S. T7.4 (the `/plan` screen and its
 * components) and T8.3 (the library week strip) add components under
 * `features/plan/`, but each exports from its OWN module path and neither edits
 * this barrel — exactly as `features/recipes/index.ts` deliberately does not
 * re-export route screens. A genuinely wanted barrel entry later is one line,
 * and it belongs to this file's owner to add.
 */
export {
  usePlanWeek,
  usePlanEntryCreate,
  usePlanEntryUpdate,
  usePlanEntryDelete,
  usePlanEntryCooked,
  usePlanEntryCookedUndo,
} from "./lib/queries";
