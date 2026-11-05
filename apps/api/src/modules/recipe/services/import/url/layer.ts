/**
 * The recipe module's composition, the URL import area (docs/EFFECT.md E7; plan `docs/plans/e3-recipe-services.md` P4).
 *
 * `ImportHttp` since E3-T03 (`FetchHttpClient.layer` provided inside it); E3-T05 adds `HeroImages`, `RemoteImages` and
 * `UrlImporter` here and widens the type in the same commit. Inside the area a service that needs a sibling goes in an
 * outer `Layer.provideMerge` step, never beside it in one `Layer.mergeAll`; requirements stay open and are satisfied
 * by `recipeLayer()` (`apps/api/src/modules/recipe/layer.ts`) and the core under it.
 *
 * Import cycle (CLAUDE.md "API import cycle"): a hoisted function only; nothing runs at import.
 */
import type { Layer } from "effect";
import type { AppConfig } from "../../../../../config.ts";
import { ImportHttp } from "./fetch.ts";

/** Every service `urlImportLayer()` provides. */
export type UrlImportServices = ImportHttp;

export function urlImportLayer(): Layer.Layer<UrlImportServices, never, AppConfig> {
  return ImportHttp.layer;
}
