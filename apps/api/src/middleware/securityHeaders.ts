/**
 * Browser hardening headers for every response the API emits: JSON, `/uploads`
 * and, in the single-origin container, the PWA it serves itself
 * (middleware/staticWeb.ts). toon-finance gotcha 67 (1715207), H-adapted per plan m3b
 * decision 16. Built on Hono's `secureHeaders`; the choices that differ from its
 * defaults, each for a reason:
 *
 *   - NO `Strict-Transport-Security`. TLS is terminated by the stack's own Caddy (docker/Caddyfile, SPEC D11), which
 *     owns HSTS (`TOON_HSTS_MAX_AGE`) and deliberately sets 0 for an internal
 *     hostname with a self-signed certificate. An HSTS header pinned from inside the app
 *     would lock such a local stack out.
 *   - `Content-Security-Policy` with `script-src 'self'` plus the SHA-256 of every
 *     inline `<script>` in the BUILT `index.html`, computed once at boot from the very
 *     file we serve. The theme pre-paint script in apps/web/index.html is inline on
 *     purpose (it must run before the first paint), so it is allow-listed by hash
 *     rather than by `'unsafe-inline'`. No nonce: `index.html` is a static file.
 *   - `'wasm-unsafe-eval'` in `script-src` (H, recipe module): the card scanner
 *     instantiates zxing-wasm (modules/recipe/features/cards/lib/scan.ts), which CSP
 *     blocks without it. It allows WebAssembly compilation only, not `eval`.
 *   - `img-src 'self' data: blob: https:` (H, recipe module): import previews are
 *     `blob:` / `data:` object URLs, and a recipe may keep an external `https:` hero
 *     image (toon-recipe stores the source site's image URL as is). `media-src 'self'
 *     blob:` for the same object URLs. `object-src blob:` (H, recipe module): the PDF
 *     import's desktop preview is an `<embed src="blob:…">` (SourceViewer.tsx), which
 *     `object-src` governs; a `blob:` URL can only be minted by a script already running
 *     on this origin, so nothing foreign can be embedded.
 *   - `style-src 'self'`, no `'unsafe-inline'`: the built app has ONE external
 *     stylesheet, zero `<style>` elements and zero `style=""` attributes. React's
 *     `style={{…}}` and the theme bootstrap write `element.style` through the CSSOM,
 *     which CSP does not block. `font-src 'self'`: the fonts are self-hosted (D5).
 *   - `connect-src 'self'` PRESUMES A BUILD WITH `PUBLIC_API_URL=""` (toon-finance gotcha
 *     50, plan m3b decision 16): `lib/api.ts` falls back to `http://localhost:3001` when
 *     the variable is unset at build time, and such a bundle served from any other origin
 *     has every API call and every `/uploads` image blocked by this very header (a run at
 *     `localhost:3001` hides it). CI and the image build set it empty; do not widen the
 *     CSP for an absolute API URL. Dev is unaffected: Vite serves `index.html` there.
 *   - `frame-ancestors 'none'` + `X-Frame-Options: DENY`: nothing here is meant to be
 *     embedded, and a framed ledger is a clickjacking target.
 *   - `Cross-Origin-Resource-Policy: same-site` instead of Hono's `same-origin` (H): the
 *     dev setup loads `<img src="http://localhost:3001/uploads/…">` from the Vite origin
 *     `:5173` (`PUBLIC_API_URL` in .env.example), a no-cors request that `same-origin`
 *     would block. Same-site still keeps every foreign site out, and uploads are signed
 *     capabilities anyway (lib/uploadUrls.ts).
 *   - `Referrer-Policy: strict-origin-when-cross-origin` (an invite or reset URL carries
 *     its token in the path; it never leaves the origin with this value).
 *   - No `Permissions-Policy`: the card scanner needs the camera.
 *
 * A factory plus a pure helper, nothing at module scope that calls into a core service
 * (CLAUDE.md "API import cycle").
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { MiddlewareHandler } from "hono";
import { secureHeaders } from "hono/secure-headers";

/** `'sha256-…'` sources for every inline `<script>` body found in `html`. */
export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(re)) {
    const body = match[1] ?? "";
    if (body.trim().length === 0) continue;
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(body);
    hashes.push(`'sha256-${hasher.digest("base64")}'`);
  }
  return hashes;
}

/** Reads the built index.html (if any) and returns its inline-script hashes. */
function scriptHashesFor(webDistDir: string | null): string[] {
  if (webDistDir === null) return [];
  const indexPath = join(webDistDir, "index.html");
  if (!existsSync(indexPath)) return [];
  return inlineScriptHashes(readFileSync(indexPath, "utf8"));
}

export function securityHeaders(webDistDir: string | null): MiddlewareHandler {
  const scriptSrc = ["'self'", "'wasm-unsafe-eval'", ...scriptHashesFor(webDistDir)];
  return secureHeaders({
    strictTransportSecurity: false,
    referrerPolicy: "strict-origin-when-cross-origin",
    xFrameOptions: "DENY",
    crossOriginResourcePolicy: "same-site",
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc,
      styleSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      mediaSrc: ["'self'", "blob:"],
      fontSrc: ["'self'"],
      // Presumes PUBLIC_API_URL="" at build time (relative API URLs); see the header comment.
      connectSrc: ["'self'"],
      manifestSrc: ["'self'"],
      workerSrc: ["'self'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      objectSrc: ["blob:"],
    },
  });
}
