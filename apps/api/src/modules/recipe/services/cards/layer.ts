/**
 * The recipe module's composition, the saved cards area (docs/EFFECT.md E7; plan `docs/plans/e3-recipe-services.md` P4).
 *
 * E3-T04: `Cards` (over `Database`). Inside the area a service that needs a sibling goes in an
 * outer `Layer.provideMerge` step, never beside it in one `Layer.mergeAll`; requirements stay open and are satisfied
 * by `recipeLayer()` (`apps/api/src/modules/recipe/layer.ts`) and the core under it.
 *
 * Import cycle (CLAUDE.md "API import cycle"): a hoisted function only; nothing runs at import.
 */
import { Cards } from "./cards.service.ts";

/** Every service `cardsLayer()` provides. */
export type CardsServices = Cards;

export function cardsLayer() {
  return Cards.layer;
}
