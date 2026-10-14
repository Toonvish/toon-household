/**
 * The SOURCE pane of the review screen.
 *
 * Photo/scan  -> the uploaded image, zoomable (buttons, wheel, two-finger pinch)
 *                and rotatable, pannable when zoomed in.
 * PDF         -> the extracted raw text (plus a link to the original file, and a
 *                native <embed> preview on desktop — no PDF library shipped).
 * URL         -> the source link, host and the parsed hero image.
 *
 * Every raw text line can be pushed straight into the parsed recipe, which is
 * the fastest way to repair OCR mistakes.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from "react";
import clsx from "clsx";
import {
  Check,
  Clipboard,
  ExternalLink,
  FileText,
  Globe,
  Image as ImageIcon,
  ListPlus,
  RotateCw,
  ScanText,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { ImportDraft } from "@toon/shared";
import { safeHttpUrl } from "@/modules/recipe/lib/format";
import { useT } from "@/lib/i18n";
import { fetchDraftSource } from "../lib/importApi";

export interface SourceViewerProps {
  draft: ImportDraft;
  /** "Zeile in Zutat umwandeln" for a single raw text line. */
  onLineToIngredient?: (line: string) => void;
  /** "Zeile in Schritt umwandeln". */
  onLineToStep?: (line: string) => void;
  className?: string;
}

type SourceTab = "image" | "text" | "link";

const MIN_SCALE = 0.5;
const MAX_SCALE = 6;

function isPdfSource(draft: ImportDraft): boolean {
  const meta = draft.sourceMeta;
  if (meta == null) return false;
  if (meta.method === "pdf-text") return true;
  if (typeof meta.mimeType === "string" && meta.mimeType.includes("pdf")) return true;
  return typeof meta.filename === "string" && /\.pdf$/i.test(meta.filename);
}

/** True when this draft has an uploaded scan/PDF behind the checked endpoint. */
function hasStoredSource(draft: ImportDraft): boolean {
  const stored = draft.sourceMeta?.storedPath;
  return typeof stored === "string" && stored.length > 0;
}

/**
 * A hero image that is safe to put in a plain `<img src>`: the parsed image from a
 * URL import. The API signs its own `/uploads/…` values, so both an external
 * `https://…` and a signed upload URL work here.
 */
function parsedImageUrl(draft: ImportDraft): string | undefined {
  const parsedImage = draft.parsed.imageUrl;
  if (typeof parsedImage !== "string" || parsedImage.length === 0) return undefined;
  if (/^https?:\/\//i.test(parsedImage)) return parsedImage;
  if (parsedImage.startsWith("/uploads/") && parsedImage.includes("sig=")) return parsedImage;
  return undefined;
}

/**
 * Loads the uploaded source scan through the MEMBERSHIP-CHECKED endpoint and hands
 * back an object URL.
 *
 * Why not just an `<img src="/uploads/…">`: the scan is the private half of
 * UPLOAD_DIR (it can be a photo of a private page), the API mints no signature for
 * it, and a cross-origin `<img>` could not send the session cookie anyway. So the
 * bytes are fetched with credentials and wrapped in a blob URL.
 *
 * The object URL is revoked on unmount and whenever the draft changes — a leaked one
 * keeps the whole image in memory for the lifetime of the document.
 */
function useDraftSourceObjectUrl(draft: ImportDraft): {
  url: string | undefined;
  mimeType: string | undefined;
  loading: boolean;
  failed: boolean;
} {
  const [state, setState] = useState<{
    url?: string;
    mimeType?: string;
    loading: boolean;
    failed: boolean;
  }>({ loading: false, failed: false });

  const available = hasStoredSource(draft);

  useEffect(() => {
    if (!available) {
      setState({ loading: false, failed: false });
      return;
    }

    const controller = new AbortController();
    let objectUrl: string | undefined;
    setState({ loading: true, failed: false });

    fetchDraftSource(draft.householdId, draft.id, controller.signal)
      .then((result) => {
        objectUrl = result.objectUrl;
        setState({ url: result.objectUrl, mimeType: result.mimeType, loading: false, failed: false });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ loading: false, failed: true });
      });

    return () => {
      controller.abort();
      if (objectUrl !== undefined) URL.revokeObjectURL(objectUrl);
    };
  }, [available, draft.householdId, draft.id]);

  return { url: state.url, mimeType: state.mimeType, loading: state.loading, failed: state.failed };
}

export function SourceViewer({ draft, onLineToIngredient, onLineToStep, className }: SourceViewerProps) {
  const t = useT();
  const pdf = isPdfSource(draft);
  const source = useDraftSourceObjectUrl(draft);
  // Photo/scan -> the fetched blob; URL import -> the parsed hero image.
  const imageUrl = pdf ? undefined : source.url ?? parsedImageUrl(draft);
  const fileUrl = source.url;
  const rawText = typeof draft.rawText === "string" ? draft.rawText.trim() : "";
  const sourceUrl = typeof draft.sourceUrl === "string" && draft.sourceUrl.length > 0 ? draft.sourceUrl : undefined;

  // `source.loading` keeps the Bild tab on screen while the blob is being fetched —
  // otherwise the tab would vanish and re-appear a moment later, moving the
  // selection out from under the user's finger.
  const hasImageTab = imageUrl !== undefined || (!pdf && source.loading);
  const availableTabs = useMemo<SourceTab[]>(() => {
    const tabs: SourceTab[] = [];
    if (hasImageTab) tabs.push("image");
    if (rawText.length > 0) tabs.push("text");
    if (sourceUrl !== undefined) tabs.push("link");
    return tabs;
  }, [hasImageTab, rawText.length, sourceUrl]);

  const [tab, setTab] = useState<SourceTab>(() => availableTabs[0] ?? "text");
  useEffect(() => {
    if (availableTabs.length > 0 && !availableTabs.includes(tab)) setTab(availableTabs[0]!);
  }, [availableTabs, tab]);

  if (availableTabs.length === 0) {
    return (
      <div
        className={clsx(
          "rounded-xl border border-dashed border-line-strong p-6 text-center text-sm text-fg-muted",
          className,
        )}
      >
        <ScanText aria-hidden className="mx-auto mb-2 h-6 w-6" />
        {t("recipe.import.source.empty")}
      </div>
    );
  }

  return (
    <div className={clsx("flex min-h-0 flex-col gap-3", className)}>
      {availableTabs.length > 1 ? (
        <div className="flex gap-1 rounded-lg bg-surface-2 p-1" role="tablist" aria-label={t("recipe.import.source.tabsAriaLabel")}>
          {availableTabs.map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={clsx(
                "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition",
                tab === value
                  ? "bg-surface text-fg shadow-sm"
                  : "text-fg-muted hover:text-fg",
              )}
            >
              {value === "image" ? <ImageIcon aria-hidden className="h-3.5 w-3.5" /> : null}
              {value === "text" ? <FileText aria-hidden className="h-3.5 w-3.5" /> : null}
              {value === "link" ? <Globe aria-hidden className="h-3.5 w-3.5" /> : null}
              {value === "image"
                ? t("recipe.import.source.tab.image")
                : value === "text"
                  ? t("recipe.import.source.tab.text")
                  : t("recipe.import.source.tab.link")}
            </button>
          ))}
        </div>
      ) : null}

      {tab === "image" ? (
        imageUrl !== undefined ? (
          <ZoomableImage src={imageUrl} />
        ) : source.failed ? (
          <p className="rounded-xl border border-dashed border-line-strong p-4 text-sm text-fg-muted">
            {t("recipe.import.source.imageFailed")}
          </p>
        ) : (
          <div
            aria-busy="true"
            className="h-[45vh] min-h-56 animate-pulse rounded-xl border border-line bg-surface-2"
          />
        )
      ) : null}

      {tab === "text" ? (
        <RawTextPane
          text={rawText}
          pdf={pdf}
          fileUrl={pdf ? fileUrl : undefined}
          fileLoading={pdf && source.loading}
          onLineToIngredient={onLineToIngredient}
          onLineToStep={onLineToStep}
        />
      ) : null}

      {tab === "link" && sourceUrl !== undefined ? (
        <SourceLinkPane url={sourceUrl} name={draft.parsed.sourceName ?? draft.sourceMeta?.host ?? undefined} />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* zoomable image                                                              */
/* -------------------------------------------------------------------------- */

function ZoomableImage({ src }: { src: string }) {
  const t = useT();
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [failed, setFailed] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ distance: number; scale: number } | undefined>(undefined);
  const panStart = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | undefined>(undefined);

  const reset = useCallback(() => {
    setScale(1);
    setRotation(0);
    setOffset({ x: 0, y: 0 });
  }, []);

  const zoomBy = useCallback((factor: number) => {
    setScale((current) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, current * factor)));
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
    if (pointers.current.size === 1) {
      panStart.current = { x: event.clientX, y: event.clientY, offsetX: offset.x, offsetY: offset.y };
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      if (a !== undefined && b !== undefined) {
        pinchStart.current = { distance: Math.hypot(a.x - b.x, a.y - b.y) || 1, scale };
      }
      panStart.current = undefined;
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.current.size >= 2 && pinchStart.current !== undefined) {
      const [a, b] = [...pointers.current.values()];
      if (a === undefined || b === undefined) return;
      const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const next = (pinchStart.current.scale * distance) / pinchStart.current.distance;
      setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, next)));
      return;
    }
    if (panStart.current !== undefined && scale > 1) {
      setOffset({
        x: panStart.current.offsetX + (event.clientX - panStart.current.x),
        y: panStart.current.offsetY + (event.clientY - panStart.current.y),
      });
    }
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinchStart.current = undefined;
    if (pointers.current.size === 0) panStart.current = undefined;
  };

  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey && scale === 1) return; // let the page scroll
    event.preventDefault();
    zoomBy(event.deltaY < 0 ? 1.12 : 1 / 1.12);
  };

  if (failed) {
    return (
      <div className="rounded-xl border border-dashed border-line-strong p-6 text-center text-sm text-fg-muted">
        {t("recipe.import.source.imageLoadFailed")}{" "}
        <a className="underline" href={src} target="_blank" rel="noreferrer">
          {t("recipe.import.source.openDirect")}
        </a>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-1">
        <IconAction label={t("recipe.import.source.zoom.out")} onClick={() => zoomBy(1 / 1.25)}>
          <ZoomOut aria-hidden className="h-4 w-4" />
        </IconAction>
        <IconAction label={t("recipe.import.source.zoom.in")} onClick={() => zoomBy(1.25)}>
          <ZoomIn aria-hidden className="h-4 w-4" />
        </IconAction>
        <IconAction label={t("recipe.import.source.zoom.rotate")} onClick={() => setRotation((value) => (value + 90) % 360)}>
          <RotateCw aria-hidden className="h-4 w-4" />
        </IconAction>
        <button
          type="button"
          onClick={reset}
          className="rounded-md px-2 py-1 text-xs font-medium text-fg-muted hover:bg-surface-2"
        >
          {t("recipe.import.source.zoom.reset")}
        </button>
        <span className="ml-auto tabular-nums text-xs text-fg-muted">{Math.round(scale * 100)} %</span>
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          className="rounded-md p-1.5 text-fg-muted hover:bg-surface-2"
          aria-label={t("recipe.import.source.zoom.openNewTab")}
          title={t("recipe.import.source.zoom.openNewTab")}
        >
          <ExternalLink aria-hidden className="h-4 w-4" />
        </a>
      </div>

      <div
        className="relative h-[45vh] min-h-56 flex-1 overflow-hidden rounded-xl border border-line bg-surface-2 lg:h-auto"
        style={{ touchAction: scale > 1 ? "none" : "pan-y", cursor: scale > 1 ? "grab" : "default" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onDoubleClick={() => (scale === 1 ? setScale(2) : reset())}
      >
        <img
          src={src}
          alt={t("recipe.import.source.alt")}
          draggable={false}
          onError={() => setFailed(true)}
          className="absolute inset-0 m-auto max-h-full max-w-full select-none object-contain"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale}) rotate(${rotation}deg)`,
            transformOrigin: "center center",
            transition: pinchStart.current === undefined && panStart.current === undefined ? "transform 120ms ease-out" : "none",
          }}
        />
      </div>
      <p className="text-[11px] text-fg-muted">{t("recipe.import.source.zoom.hint")}</p>
    </div>
  );
}

function IconAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="rounded-md p-1.5 text-fg-muted hover:bg-surface-2"
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* raw text                                                                    */
/* -------------------------------------------------------------------------- */

function RawTextPane({
  text,
  pdf,
  fileUrl,
  fileLoading = false,
  onLineToIngredient,
  onLineToStep,
}: {
  text: string;
  pdf: boolean;
  /** Object URL of the original PDF, fetched through the checked endpoint. */
  fileUrl?: string;
  fileLoading?: boolean;
  onLineToIngredient?: (line: string) => void;
  onLineToStep?: (line: string) => void;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [showPdf, setShowPdf] = useState(false);
  const lines = useMemo(
    () =>
      text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    [text],
  );

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  if (lines.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line-strong p-4 text-sm text-fg-muted">
        {t("recipe.import.source.text.empty")}
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-fg-muted">{t("recipe.import.source.text.lineCount", { count: lines.length })}</span>
        <button
          type="button"
          onClick={() => void copyAll()}
          className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-fg-muted hover:bg-surface-2"
        >
          {copied ? <Check aria-hidden className="h-3.5 w-3.5" /> : <Clipboard aria-hidden className="h-3.5 w-3.5" />}
          {copied ? t("recipe.import.source.text.copied") : t("recipe.import.source.text.copyAll")}
        </button>
        {pdf && fileLoading ? (
          <span className="text-xs text-fg-subtle">{t("recipe.import.source.text.pdfLoading")}</span>
        ) : null}
        {pdf && fileUrl !== undefined ? (
          <>
            <a
              href={fileUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-fg-muted hover:bg-surface-2"
            >
              <ExternalLink aria-hidden className="h-3.5 w-3.5" />
              {t("recipe.import.source.text.pdfOpen")}
            </a>
            <button
              type="button"
              onClick={() => setShowPdf((value) => !value)}
              aria-expanded={showPdf}
              className="hidden items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-fg-muted hover:bg-surface-2 lg:inline-flex"
            >
              <FileText aria-hidden className="h-3.5 w-3.5" />
              {showPdf ? t("recipe.import.source.text.pdfPreviewOff") : t("recipe.import.source.text.pdfPreviewOn")}
            </button>
          </>
        ) : null}
      </div>

      {showPdf && fileUrl !== undefined ? (
        <embed
          src={fileUrl}
          type="application/pdf"
          className="hidden h-[60vh] w-full rounded-xl border border-line lg:block"
        />
      ) : null}

      <ol className="min-h-0 flex-1 divide-y divide-line overflow-y-auto rounded-xl border border-line bg-surface text-sm">
        {lines.map((line, index) => (
          <li key={`${index}-${line.slice(0, 12)}`} className="group flex items-start gap-2 px-3 py-2">
            <span className="w-6 shrink-0 pt-0.5 text-right text-[11px] tabular-nums text-fg-subtle">{index + 1}</span>
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-[13px] leading-5 text-fg">
              {line}
            </span>
            <span className="flex shrink-0 gap-1">
              {onLineToIngredient !== undefined ? (
                <button
                  type="button"
                  onClick={() => onLineToIngredient(line)}
                  title={t("recipe.import.source.line.toIngredientTitle")}
                  aria-label={t("recipe.import.source.line.toIngredientAria", { index: index + 1 })}
                  className="rounded-md p-1 text-brand-soft-fg hover:bg-brand-soft"
                >
                  <ListPlus aria-hidden className="h-4 w-4" />
                </button>
              ) : null}
              {onLineToStep !== undefined ? (
                <button
                  type="button"
                  onClick={() => onLineToStep(line)}
                  title={t("recipe.import.source.line.toStepTitle")}
                  aria-label={t("recipe.import.source.line.toStepAria", { index: index + 1 })}
                  className="rounded-md p-1 text-[11px] font-semibold text-fg-muted hover:bg-surface-2"
                >
                  1.
                </button>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* url source                                                                  */
/* -------------------------------------------------------------------------- */

function SourceLinkPane({ url, name }: { url: string; name?: string }) {
  const t = useT();
  let host = name;
  try {
    host = name ?? new URL(url).hostname.replace(/^www\./, "");
  } catch {
    // keep the provided name
  }
  // `draft.parsed.sourceUrl` is client-writable through PATCH /imports/:draftId,
  // so it must never reach an href unchecked (javascript: would run on our origin).
  const href = safeHttpUrl(url);
  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center gap-2">
        <Globe aria-hidden className="h-4 w-4 text-fg-muted" />
        <span className="text-sm font-medium text-fg">{host ?? t("recipe.import.source.link.fallbackName")}</span>
      </div>
      <p className="break-all text-xs text-fg-muted">{url}</p>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-2 text-sm font-medium text-fg hover:bg-surface-2"
        >
          <ExternalLink aria-hidden className="h-4 w-4" />
          {t("recipe.import.source.link.openOriginal")}
        </a>
      ) : (
        <p className="text-xs text-warning-soft-fg">{t("recipe.import.source.link.notHttp")}</p>
      )}
      <p className="text-[11px] text-fg-muted">{t("recipe.import.source.link.compareHint")}</p>
    </div>
  );
}

export default SourceViewer;
