/**
 * Draws a card's code as an SVG — the thing a scanner actually reads.
 *
 * Two rules govern everything here.
 *
 * **1. Black on white, never themed.** A supermarket scanner reads contrast, and a
 * dark-mode barcode (light bars on a dark ground) is unreadable to a good half of
 * the hand scanners in use. So the symbol is always `#000` on `#fff`, whatever the
 * app's theme is, and the surface around it is white too (see CardDisplayDialog).
 * This is the one place in the app that ignores the colour tokens on purpose.
 *
 * **2. Whole modules only.** A barcode is a run of equal-width modules; if a module
 * boundary lands on a fractional device pixel the browser anti-aliases the edge, and
 * a cheap scanner then reads a wrong digit — or nothing. So the `viewBox` is in
 * MODULE units with an integer width, `shapeRendering="crispEdges"` turns smoothing
 * off, and the SVG scales as a whole instead of each bar rounding on its own.
 *
 * SVG rather than a `<canvas>`: it scales to any box without a redraw, it survives a
 * device-pixel-ratio change (an iPhone pinch-zoomed), and it needs no imperative
 * code that could run before layout.
 */
import { useMemo } from "react";
import { encodeBarcode, encodeQr, isMatrixBarcode, type BarcodeFormat } from "@toon/shared";
import { cn } from "@/lib/cn";

export interface BarcodeImageProps {
  format: BarcodeFormat;
  /** A NORMALISED value — see `normalizeBarcodeValue` in @toon/shared. */
  value: string;
  /**
   * What a screen reader announces. The bars carry nothing a blind user could act
   * on, so this names the CARD, not the number.
   */
  label: string;
  className?: string;
}

/** Quiet zone around a QR matrix, in modules. Four is the spec's minimum. */
const QR_QUIET_ZONE = 4;

/** One dark rectangle: a run of adjacent dark modules in row `y`. */
interface Run {
  x: number;
  y: number;
  width: number;
}

/** Merges adjacent dark modules so a QR matrix is a few hundred nodes, not 5000. */
function runsInRow(row: readonly boolean[], y: number, offset: number): Run[] {
  const runs: Run[] = [];
  let start: number | null = null;
  // Deliberately one past the end, so a run that reaches the edge is flushed.
  for (let x = 0; x <= row.length; x += 1) {
    const dark = row[x] === true;
    if (dark && start === null) start = x;
    if (!dark && start !== null) {
      runs.push({ x: start + offset, y: y + offset, width: x - start });
      start = null;
    }
  }
  return runs;
}

interface Symbol_ {
  kind: "linear" | "matrix";
  width: number;
  height: number;
  runs: Run[];
}

function encodeSymbol(format: BarcodeFormat, value: string): Symbol_ | null {
  try {
    if (isMatrixBarcode(format)) {
      const matrix = encodeQr(value);
      const side = matrix.size + QR_QUIET_ZONE * 2;
      return {
        kind: "matrix",
        width: side,
        height: side,
        runs: matrix.modules.flatMap((row, y) => runsInRow(row, y, QR_QUIET_ZONE)),
      };
    }
    const linear = encodeBarcode(format, value);
    return {
      kind: "linear",
      width: linear.modules.length + linear.quietZone * 2,
      height: 1,
      runs: runsInRow(linear.modules, 0, 0).map((run) => ({
        ...run,
        x: run.x + linear.quietZone,
      })),
    };
  } catch {
    // A stored row CAN be unencodable: it was written by an older client, or a
    // validation rule tightened since. Failing soft keeps one bad card from
    // taking the whole wallet screen into the ErrorBoundary — the caller shows
    // the number as text next to this, which is what a cashier can type in.
    return null;
  }
}

/** Renders the symbol, or nothing at all when the value cannot be encoded. */
export function BarcodeImage({ format, value, label, className }: BarcodeImageProps) {
  const symbol = useMemo(() => encodeSymbol(format, value), [format, value]);
  if (symbol === null) return null;

  return (
    <svg
      viewBox={`0 0 ${symbol.width} ${symbol.height}`}
      // `none` for a linear code on purpose: bar WIDTHS carry the data and the
      // height is decoration, so stretching vertically into whatever box the
      // layout gives is correct. A QR matrix has to stay square.
      preserveAspectRatio={symbol.kind === "linear" ? "none" : "xMidYMid meet"}
      shapeRendering="crispEdges"
      role="img"
      aria-label={label}
      className={cn("h-full w-full", className)}
    >
      <rect x={0} y={0} width={symbol.width} height={symbol.height} fill="#fff" />
      <g fill="#000">
        {symbol.runs.map((run) => (
          <rect key={`${run.y}-${run.x}`} x={run.x} y={run.y} width={run.width} height={1} />
        ))}
      </g>
    </svg>
  );
}

/** True when this value can be drawn at all — used to gate the form's preview. */
export function canRenderBarcode(format: BarcodeFormat, value: string): boolean {
  return encodeSymbol(format, value) !== null;
}
