/**
 * The recipe module's composition, the URL import area (docs/EFFECT.md E7; plan `docs/plans/e3-recipe-services.md` P4).
 *
 * `ImportHttp` since E3-T03 (`FetchHttpClient.layer` provided inside it); E3-T05 adds `HeroImages` (over `ImportHttp`,
 * `ImportFiles` and `Thumbnails`), then `RemoteImages` and `UrlImporter` (both over `HeroImages`, `UrlImporter` also over
 * `ImportHttp`). Inside the area a service that needs a sibling goes in an outer `Layer.provideMerge` step, never beside
 * it in one `Layer.mergeAll`; requirements stay open (`ImportFiles` comes from the OCR area under this one, `Thumbnails`
 * and `AppConfig` from the core) and are satisfied by `recipeLayer()` (`apps/api/src/modules/recipe/layer.ts`).
 *
 * Import cycle (CLAUDE.md "API import cycle"): a hoisted function only; nothing runs at import.
 */
import { Layer } from "effect";
import type { AppConfig } from "../../../../../config.ts";
import type { Thumbnails } from "../../../../../core/services/media/thumbnails.ts";
import { RemoteImages } from "../../recipes/remoteImage.ts";
import type { ImportFiles } from "../files.ts";
import { ImportHttp } from "./fetch.ts";
import { HeroImages } from "./image.ts";
import { UrlImporter } from "./index.ts";

/** Every service `urlImportLayer()` provides. */
export type UrlImportServices = ImportHttp | HeroImages | RemoteImages | UrlImporter;

export function urlImportLayer(): Layer.Layer<UrlImportServices, never, AppConfig | ImportFiles | Thumbnails> {
  return Layer.mergeAll(RemoteImages.layer, UrlImporter.layer).pipe(
    Layer.provideMerge(HeroImages.layer),
    Layer.provideMerge(ImportHttp.layer),
  );
}
