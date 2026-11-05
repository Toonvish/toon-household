/**
 * The recipe module's composition, the URL import area (docs/EFFECT.md E7; plan `docs/plans/e3-recipe-services.md` P4).
 *
 * A stub until its owners fill it (E3-T03: `ImportHttp`; E3-T05: `HeroImages`, `RemoteImages`, `UrlImporter`): `Layer.empty`, and `UrlImportServices` is `never`. The owning task
 * replaces the body and widens the type in the same commit. Inside the area a service that needs a sibling goes in an
 * outer `Layer.provideMerge` step, never beside it in one `Layer.mergeAll`; requirements stay open and are satisfied
 * by `recipeLayer()` (`apps/api/src/modules/recipe/layer.ts`) and the core under it.
 *
 * Import cycle (CLAUDE.md "API import cycle"): a hoisted function only; nothing runs at import.
 */
import { Layer } from "effect";

/** Every service `urlImportLayer()` provides. */
export type UrlImportServices = never;

export function urlImportLayer(): Layer.Layer<UrlImportServices> {
  return Layer.empty;
}
