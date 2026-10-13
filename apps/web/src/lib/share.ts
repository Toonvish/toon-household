/**
 * Share sheet with clipboard fallback — core (R's features/recipes/lib/hooks.ts share block;
 * SPEC §3). Never throws.
 */

export type ShareResult = "shared" | "copied" | "unavailable";

interface ShareLike {
  share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
}

/** navigator.share with a clipboard fallback. Never throws. */
export async function shareOrCopy(data: {
  title?: string;
  text?: string;
  url?: string;
}): Promise<ShareResult> {
  const nav = navigator as unknown as ShareLike;
  if (typeof nav.share === "function") {
    try {
      await nav.share(data);
      return "shared";
    } catch (error) {
      // AbortError = the user dismissed the sheet; do not fall back in that case.
      if (error instanceof DOMException && error.name === "AbortError") return "shared";
    }
  }
  return (await copyToClipboard([data.text, data.url].filter(Boolean).join("\n\n")))
    ? "copied"
    : "unavailable";
}

/** Clipboard write with a legacy `execCommand` fallback. Returns success. */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (text.length === 0) return false;
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the textarea trick */
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "true");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
