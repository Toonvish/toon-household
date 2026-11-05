/**
 * The recipe module's composition, the import area (docs/EFFECT.md E7; plan `docs/plans/e3-recipe-services.md` P4).
 *
 * E3-T01: `ImportCapabilities` (over `AppConfig`); E3-T04 adds `ImportDrafts`, E3-T07 `ImportCommit` (which needs
 * `RemoteImages` from the URL import area, nested under this one by `recipeLayer()`). Inside the area a service that
 * needs a sibling goes in an outer `Layer.provideMerge` step, never beside it in one `Layer.mergeAll`; requirements stay
 * open and are satisfied by `recipeLayer()` (`apps/api/src/modules/recipe/layer.ts`) and the core under it.
 *
 * Import cycle (CLAUDE.md "API import cycle"): a hoisted function only; nothing runs at import, and the service
 * classes are read when the runtime builds the layer.
 */
import { ImportCapabilities } from "./capabilities.ts";

/** Every service `importLayer()` provides. */
export type ImportServices = ImportCapabilities;

export function importLayer() {
  return ImportCapabilities.layer;
}
