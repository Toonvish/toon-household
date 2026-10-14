/**
 * Client-side image handling for photo imports — canvas only, no library.
 *
 * Why: phone cameras produce 4–12 MB, 4000 px wide JPEGs. The server OCRs at
 * ~2000 px anyway (sharp resize), so downscaling in the browser makes the upload
 * several times faster on mobile data and keeps us under the 15 MB limit.
 */
import { MAX_UPLOAD_BYTES } from "@toon/shared";
import { translate } from "@/lib/i18n";

export const MAX_EDGE = 2000;
export const JPEG_QUALITY = 0.85;
/** Files below this are uploaded untouched (re-encoding would only lose detail). */
const SKIP_DOWNSCALE_BELOW_BYTES = 400 * 1024;

export interface PreparedImage {
  file: File;
  width: number;
  height: number;
  originalBytes: number;
  bytes: number;
  /** False when decoding failed and we fall back to the original file. */
  processed: boolean;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "–";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif|avif|gif|bmp|tiff?)$/i.test(file.name);
}

/** Client-side mirror of the API's 15 MB guard. Returns a localised message or null. */
export function checkFileSize(file: File): string | null {
  if (file.size > MAX_UPLOAD_BYTES) {
    return translate("recipe.import.image.tooLarge", { size: formatBytes(file.size), max: formatBytes(MAX_UPLOAD_BYTES) });
  }
  if (file.size === 0) return translate("recipe.import.image.empty");
  return null;
}

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

async function decode(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      // HEIC/odd JPEGs: fall through to the <img> decoder.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("decode_failed"));
      element.src = url;
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function createCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("canvas_unavailable");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return { canvas, ctx };
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob === null ? reject(new Error("encode_failed")) : resolve(blob)),
      "image/jpeg",
      quality,
    );
  });
}

function jpegName(original: string, suffix = ""): string {
  const base = original.replace(/\.[^.]+$/, "").replace(/[^\p{L}\p{N}_-]+/gu, "-").slice(0, 60) || "foto";
  return `${base}${suffix}.jpg`;
}

/**
 * Downscales a photo to at most MAX_EDGE on its long side and re-encodes it as
 * JPEG. Never throws: if the browser cannot decode the file (e.g. exotic HEIC)
 * the original file is returned and the server does the work.
 */
export async function prepareImageForUpload(file: File): Promise<PreparedImage> {
  const fallback: PreparedImage = {
    file,
    width: 0,
    height: 0,
    originalBytes: file.size,
    bytes: file.size,
    processed: false,
  };
  if (isPdfFile(file)) return fallback;

  let decoded: DecodedImage | undefined;
  try {
    decoded = await decode(file);
    const longEdge = Math.max(decoded.width, decoded.height);
    const scale = longEdge > MAX_EDGE ? MAX_EDGE / longEdge : 1;
    if (scale === 1 && file.size < SKIP_DOWNSCALE_BELOW_BYTES && file.type === "image/jpeg") {
      return { ...fallback, width: decoded.width, height: decoded.height };
    }
    const width = Math.round(decoded.width * scale);
    const height = Math.round(decoded.height * scale);
    const { canvas, ctx } = createCanvas(width, height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(decoded.source, 0, 0, width, height);
    const blob = await toBlob(canvas, JPEG_QUALITY);
    canvas.width = 0;
    canvas.height = 0;
    // A re-encode that gained nothing is pointless.
    if (blob.size >= file.size && scale === 1) {
      return { ...fallback, width: decoded.width, height: decoded.height };
    }
    const out = new File([blob], jpegName(file.name), { type: "image/jpeg", lastModified: Date.now() });
    return { file: out, width, height, originalBytes: file.size, bytes: out.size, processed: true };
  } catch {
    return fallback;
  } finally {
    decoded?.release();
  }
}

/**
 * Multi-shot support: the API accepts exactly ONE `file` per import, so several
 * photos of the same recipe (page 1 / page 2) are stitched into a single tall
 * JPEG. That keeps everything in ONE draft instead of producing one draft per
 * photo — which is what the review screen needs.
 *
 * Falls back to the first prepared photo if stitching is impossible.
 */
export async function stitchImagesForUpload(files: readonly File[]): Promise<PreparedImage> {
  if (files.length === 0) throw new Error("no_files");
  const first = files[0]!;
  if (files.length === 1) return prepareImageForUpload(first);

  const decodedPages: DecodedImage[] = [];
  try {
    for (const file of files) decodedPages.push(await decode(file));
    const targetWidth = Math.min(MAX_EDGE, Math.max(...decodedPages.map((page) => page.width)));
    const gap = 24;
    const scaled = decodedPages.map((page) => {
      const scale = targetWidth / page.width;
      return { page, width: targetWidth, height: Math.round(page.height * scale) };
    });
    const totalHeight = scaled.reduce((sum, item) => sum + item.height, 0) + gap * (scaled.length - 1);
    // Guard against absurd canvases (mobile Safari caps around 16 MP).
    const heightScale = totalHeight > 12000 ? 12000 / totalHeight : 1;
    const { canvas, ctx } = createCanvas(targetWidth * heightScale, totalHeight * heightScale);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    let y = 0;
    for (const item of scaled) {
      ctx.drawImage(
        item.page.source,
        0,
        Math.round(y * heightScale),
        Math.round(item.width * heightScale),
        Math.round(item.height * heightScale),
      );
      y += item.height + gap;
    }
    const blob = await toBlob(canvas, JPEG_QUALITY);
    canvas.width = 0;
    canvas.height = 0;
    const out = new File([blob], jpegName(first.name, `-${files.length}-seiten`), {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
    const originalBytes = files.reduce((sum, file) => sum + file.size, 0);
    return {
      file: out,
      width: canvas.width,
      height: canvas.height,
      originalBytes,
      bytes: out.size,
      processed: true,
    };
  } catch {
    return prepareImageForUpload(first);
  } finally {
    for (const page of decodedPages) page.release();
  }
}

/** Object URL helper — callers must revoke. */
export function createPreviewUrl(file: File): string {
  return URL.createObjectURL(file);
}

export function revokePreviewUrl(url: string): void {
  URL.revokeObjectURL(url);
}
