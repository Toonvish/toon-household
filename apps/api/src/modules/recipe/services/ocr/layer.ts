/**
 * The recipe module's composition, the OCR and PDF area (docs/EFFECT.md E7; plan `docs/plans/e3-recipe-services.md` P4).
 *
 * E3-T02: `Ocr`, `PdfText`, `ImportFiles` and `OcrImporter`. Nested by dependency, innermost first: `Ocr` and
 * `ImportFiles` beside each other (neither needs the other), `PdfText` over them (it needs `Ocr`), `OcrImporter` over
 * all three. Inside the area a service that needs a sibling goes in an outer `Layer.provideMerge` step, never beside it
 * in one `Layer.mergeAll`; requirements stay open (`AppConfig`) and are satisfied by `recipeLayer()`
 * (`apps/api/src/modules/recipe/layer.ts`) and the core under it. The URL import area (`HeroImages` needs
 * `ImportFiles`) sits over this one.
 *
 * Import cycle (CLAUDE.md "API import cycle"): a hoisted function only; nothing runs at import, and the service
 * classes are read when the runtime builds the layer.
 */
import { Layer } from "effect";
import { ImportFiles } from "../import/files.ts";
import { OcrImporter } from "../import/ocr/index.ts";
import { Ocr } from "./index.ts";
import { PdfText } from "./pdf.ts";

/** Every service `ocrLayer()` provides. */
export type OcrServices = Ocr | PdfText | ImportFiles | OcrImporter;

export function ocrLayer() {
  return OcrImporter.layer.pipe(
    Layer.provideMerge(PdfText.layer),
    Layer.provideMerge(Layer.mergeAll(Ocr.layer, ImportFiles.layer)),
  );
}
