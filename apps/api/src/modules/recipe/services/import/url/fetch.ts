/**
 * Guarded HTML fetcher for the URL importer.
 *
 * Redirects are followed MANUALLY (`redirect: "manual"`) so that every hop can
 * be re-validated by the SSRF guard — `redirect: "follow"` would let a public
 * host bounce us into the private network.
 *
 * Also enforced: desktop User-Agent (recipe sites serve stripped markup or 403
 * to unknown agents), `Accept-Language: de-DE`, a 10 s overall timeout, a 5 MB
 * body cap (streamed, so a huge body is aborted instead of buffered), and an
 * HTML-ish content type.
 */
import { ApiError } from "../../../../../lib/errors.ts";
import { SsrfError, assertPublicUrl, type AssertPublicUrlOptions } from "./ssrf.ts";

/** A real, current desktop Chrome UA — anything exotic gets 403 on chefkoch. */
export const IMPORT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
export const MAX_HTML_BYTES = 5 * 1024 * 1024;
export const MAX_REDIRECTS = 5;

const HTML_CONTENT_TYPE_RE = /^(?:text\/html|application\/xhtml\+xml|text\/plain|application\/xml|text\/xml)\b/i;

export interface FetchHtmlOptions extends AssertPublicUrlOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** Injectable fetch, used by the tests to stay offline. */
  fetchImpl?: typeof fetch;
}

export interface FetchedHtml {
  /** The final URL after all redirects. */
  url: string;
  status: number;
  contentType: string;
  html: string;
  /** Every URL visited, first entry = the requested one. */
  hops: string[];
}

/** Decodes a body honouring a charset from the header or a `<meta charset>`. */
function decodeBody(bytes: Uint8Array, contentType: string): string {
  const headerCharset = /charset\s*=\s*"?([\w-]+)"?/i.exec(contentType)?.[1];
  const sniff = (charset: string): string | undefined => {
    try {
      // The label is data-driven (from a header/meta tag), so the narrow
      // Encoding union in @types/node cannot apply here.
      const decoder = new TextDecoder(charset as ConstructorParameters<typeof TextDecoder>[0], { fatal: false });
      return decoder.decode(bytes);
    } catch {
      return undefined;
    }
  };

  if (headerCharset && !/^utf-?8$/i.test(headerCharset)) {
    const decoded = sniff(headerCharset);
    if (decoded !== undefined) return decoded;
  }

  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (headerCharset) return utf8;

  // No charset header: trust an early <meta charset="...">.
  const metaCharset =
    /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(utf8.slice(0, 4096))?.[1] ??
    /<\?xml[^>]+encoding\s*=\s*["']([\w-]+)/i.exec(utf8.slice(0, 512))?.[1];
  if (metaCharset && !/^utf-?8$/i.test(metaCharset)) {
    const decoded = sniff(metaCharset);
    if (decoded !== undefined) return decoded;
  }
  return utf8;
}

/** Reads at most `maxBytes` from a response body, aborting anything larger. */
async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ApiError(400, "fetch_failed", "server.import.pageTooLarge");
  }
  const body = response.body;
  if (!body) return new Uint8Array(0);

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ApiError(400, "fetch_failed", "server.import.pageTooLarge");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Fetches a public web page as HTML.
 *
 * @throws ApiError 400 `fetch_failed` for SSRF violations, network errors,
 *   timeouts, non-2xx responses, redirect loops and non-HTML content types.
 */
export async function fetchHtml(rawUrl: string, options: FetchHtmlOptions = {}): Promise<FetchedHtml> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MAX_HTML_BYTES;
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  const doFetch = options.fetchImpl ?? fetch;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const hops: string[] = [];
  try {
    let target = await guard(rawUrl, options);
    for (let redirect = 0; ; redirect += 1) {
      hops.push(target.href);

      let response: Response;
      try {
        response = await doFetch(target.href, {
          method: "GET",
          redirect: "manual",
          signal: controller.signal,
          headers: {
            "User-Agent": IMPORT_USER_AGENT,
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "de-DE,de;q=0.9,en;q=0.6",
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
          },
        });
      } catch (error) {
        if (controller.signal.aborted) {
          throw new ApiError(400, "fetch_failed", "server.import.pageTimeout");
        }
        throw new ApiError(400, "fetch_failed", {
          key: "server.import.pageLoadFailed",
          values: { reason: error instanceof Error ? error.message : "network error" },
        });
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          throw new ApiError(400, "fetch_failed", {
            key: "server.import.redirectNoLocation",
            values: { status: response.status },
          });
        }
        if (redirect >= maxRedirects) {
          throw new ApiError(400, "fetch_failed", "server.import.tooManyRedirects");
        }
        await response.body?.cancel().catch(() => undefined);
        // Resolve relative Locations against the current hop, then re-validate.
        const next = new URL(location, target.href).href;
        target = await guard(next, options);
        continue;
      }

      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new ApiError(400, "fetch_failed", {
          key: "server.import.pageHttpError",
          values: { status: response.status },
        });
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.length > 0 && !HTML_CONTENT_TYPE_RE.test(contentType)) {
        await response.body?.cancel().catch(() => undefined);
        throw new ApiError(400, "fetch_failed", {
          key: "server.import.pageNotHtml",
          values: { contentType: contentType.split(";")[0] ?? contentType },
        });
      }

      const bytes = await readCapped(response, maxBytes);
      return {
        url: target.href,
        status: response.status,
        contentType,
        html: decodeBody(bytes, contentType),
        hops,
      };
    }
  } finally {
    clearTimeout(timer);
  }
}

async function guard(url: string, options: AssertPublicUrlOptions): Promise<URL> {
  try {
    return await assertPublicUrl(url, options);
  } catch (error) {
    if (error instanceof SsrfError) throw error.toApiError();
    throw error;
  }
}
