/**
 * `WastePdfText` (plan m8 P18, design §5.2): the text items of a waste flyer PDF, with the marked-content SECTION each
 * item belongs to, for the pure parser (`./hattingen.ts`).
 *
 * - `unpdf` (pdf.js, pure JS: it works in the published image without poppler) is imported DYNAMICALLY inside the method,
 *   so pdf.js stays out of the API's boot graph.
 * - One extraction at a time: a one-permit `Semaphore` made in the layer (pdf.js holds a whole parsed document in
 *   memory; the deployment has a few hundred megabytes). The 20 s budget (`CALENDAR_LIMITS.wasteTimeoutMs`) starts once
 *   the permit is held, so queueing never eats it; on the timeout the run is interrupted, which aborts it (the document is
 *   destroyed and no further page is read).
 * - Per page `getTextContent({ includeMarkedContent: true })`; `section` counts the TOP-LEVEL marked-content blocks of
 *   the whole document (`beginMarkedContent` / `beginMarkedContentProps` at depth 0 opens the next one, depth-tracked so a
 *   nested `Span` stays in its `PlacedPDF`); an item outside every block has section 0. The flyer's grids are placed PDFs
 *   carrying hidden copies of each grid, one copy per section (design §5.3): the parser never mixes sections.
 * - Each item is `{ str, x, y, width, page, section }` with `str` trimmed (blank items dropped), the coordinates and the
 *   width rounded to 0.1 pt, sorted by page, section, y descending, x, str: a deterministic list, which is what the
 *   recorded fixture `apps/api/test/fixtures/calendar/hattingen-2027.items.json` holds.
 *
 * Refusals, all `422 calendar_waste_unparseable` (`./errors.ts`): `notPdf` (no `%PDF-` header, or pdf.js cannot read the
 * file), `encrypted` (a non-empty user password: pdf.js asks for one), `pages` (more than
 * `CALENDAR_LIMITS.wastePdfMaxPages`), `timeout`. Any failure of pdf.js counts (catch-all, CLAUDE.md "Catch-all stays
 * catch-all"): a rejection is a typed failure through `Effect.tryPromise`, never a defect.
 *
 * Its static `layer` references only `effect` exports and its own class (CLAUDE.md "One composition point").
 */
import { CALENDAR_LIMITS } from "@toon/shared";
import { Context, Effect, Layer, Predicate, Semaphore } from "effect";
import type { ApiFailure } from "../../../../lib/errors.ts";
import { wasteUnparseable } from "./errors.ts";

/** One text item of the flyer (design §5.2). */
export interface WasteTextItem {
  readonly str: string;
  /** `transform[4]`, PDF user space (origin bottom left), rounded to 0.1 pt. */
  readonly x: number;
  /** `transform[5]`, rounded to 0.1 pt. */
  readonly y: number;
  readonly width: number;
  /** 1-based. */
  readonly page: number;
  /** The top-level marked-content block (1-based over the document), 0 outside every block. */
  readonly section: number;
}

/** The options of `WastePdfText.layerWith` (tests shorten the budget). */
export interface WastePdfTextOptions {
  readonly timeoutMs?: number | undefined;
  readonly maxPages?: number | undefined;
}

/** What the extraction itself reports besides the items (mapped to the refusals by the service). */
type ExtractOutcome =
  | { readonly ok: true; readonly items: ReadonlyArray<WasteTextItem> }
  | { readonly ok: false; readonly check: "pages" };

/** pdf.js's text content item: a text run, or a marked-content marker when `includeMarkedContent` is set. */
interface PdfJsTextItem {
  readonly str?: string;
  readonly transform?: ReadonlyArray<number>;
  readonly width?: number;
  readonly type?: string;
}

/** Rounds to 0.1 pt; `+ 0` turns a `-0` into `0`, so the recorded JSON and a fresh run compare equal. */
const round = (value: number): number => Math.round(value * 10) / 10 + 0;

/** True when the bytes start with the PDF header (no leading junk is accepted for a waste flyer). */
export function hasPdfHeader(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
}

/** The deterministic order of the items (page, section, top to bottom, left to right, text). */
export function compareWasteItems(a: WasteTextItem, b: WasteTextItem): number {
  return (
    a.page - b.page ||
    a.section - b.section ||
    b.y - a.y ||
    a.x - b.x ||
    (a.str < b.str ? -1 : a.str > b.str ? 1 : 0) ||
    a.width - b.width
  );
}

/**
 * Hands the event loop one turn. pdf.js (its in-process "fake worker") resolves through microtasks only, so without a
 * macrotask between the pages no timer could fire before the whole document is read and the budget would never bite.
 */
const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** The pdf.js run: open, check the page count, read every page's text with its section. */
async function extractItems(bytes: Uint8Array, maxPages: number, signal: AbortSignal): Promise<ExtractOutcome> {
  const { getDocumentProxy } = await import("unpdf");
  // A fresh copy: pdf.js transfers (detaches) the buffer it is handed. No `isEvalSupported: false` (design §5.2): the
  // pdf.js unpdf 1.8 bundles has dropped that option along with every `eval` (it is not in its `DocumentInitParameters`).
  // `verbosity: 0` keeps pdf.js's own console warnings about broken files out of the server log.
  const pdf = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 });
  // Destroying the loading task frees the document (and stops a run the timeout interrupted).
  const destroy = (): void => {
    pdf.loadingTask.destroy().catch(() => undefined);
  };
  signal.addEventListener("abort", destroy, { once: true });
  try {
    if (pdf.numPages > maxPages) return { ok: false, check: "pages" };
    const items: WasteTextItem[] = [];
    let section = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      await yieldToEventLoop();
      if (signal.aborted) break;
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent({ includeMarkedContent: true });
      let depth = 0;
      for (const raw of content.items as ReadonlyArray<PdfJsTextItem>) {
        if (raw.type === "beginMarkedContent" || raw.type === "beginMarkedContentProps") {
          if (depth === 0) section += 1;
          depth += 1;
          continue;
        }
        if (raw.type === "endMarkedContent") {
          depth = Math.max(0, depth - 1);
          continue;
        }
        const str = (raw.str ?? "").trim();
        const transform = raw.transform;
        if (str === "" || transform === undefined) continue;
        items.push({
          str,
          x: round(transform[4] ?? 0),
          y: round(transform[5] ?? 0),
          width: round(raw.width ?? 0),
          page: pageNumber,
          section: depth > 0 ? section : 0,
        });
      }
      page.cleanup();
    }
    return { ok: true, items: items.sort(compareWasteItems) };
  } finally {
    signal.removeEventListener("abort", destroy);
    destroy();
  }
}

/** pdf.js names its refusals: a password it does not have, or a file it cannot read. */
function failureOf(cause: unknown): ApiFailure {
  if (Predicate.isError(cause) && cause.name === "PasswordException") return wasteUnparseable("encrypted");
  return wasteUnparseable("notPdf");
}

/** The PDF text service of the waste import. */
export class WastePdfText extends Context.Service<
  WastePdfText,
  {
    /** The flyer's text items (P18); `422 calendar_waste_unparseable` with check `notPdf`, `encrypted`, `pages` or `timeout`. */
    readonly extract: (bytes: Uint8Array) => Effect.Effect<ReadonlyArray<WasteTextItem>, ApiFailure>;
  }
>()("toon/api/modules/calendar/services/waste/pdf-text/WastePdfText") {
  /** The service with chosen limits (the defaults are `CALENDAR_LIMITS`). */
  static layerWith(options: WastePdfTextOptions = {}): Layer.Layer<WastePdfText> {
    return Layer.effect(
      WastePdfText,
      Effect.gen(function* () {
        const permit = yield* Semaphore.make(1);
        const timeoutMs = options.timeoutMs ?? CALENDAR_LIMITS.wasteTimeoutMs;
        const maxPages = options.maxPages ?? CALENDAR_LIMITS.wastePdfMaxPages;

        const extract = Effect.fn("WastePdfText.extract")(function* (bytes: Uint8Array) {
          if (!hasPdfHeader(bytes)) return yield* wasteUnparseable("notPdf");
          const outcome = yield* permit.withPermit(
            Effect.tryPromise({ try: (signal) => extractItems(bytes, maxPages, signal), catch: failureOf }).pipe(
              Effect.timeoutOrElse({
                duration: timeoutMs,
                orElse: () => Effect.fail(wasteUnparseable("timeout")),
              }),
            ),
          );
          if (!outcome.ok) return yield* wasteUnparseable(outcome.check);
          return outcome.items;
        });

        return WastePdfText.of({ extract });
      }),
    );
  }

  static readonly layer: Layer.Layer<WastePdfText> = WastePdfText.layerWith();
}
