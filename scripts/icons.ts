/**
 * Generates the PWA icon PNGs in apps/web/public/icons from the house mark
 * (apps/web/public/favicon.svg). Run: `bun run icons`, then commit the PNGs.
 *
 * sharp is an apps/api dependency; it is resolved from there so the root adds none (bun.lock
 * stays unchanged). The maskable variants are square (no rounded corners, the OS masks them)
 * with the glyph scaled down to sit inside the 80% safe circle.
 */
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";

const require = createRequire(new URL("../apps/api/package.json", import.meta.url));
const sharp = require("sharp") as typeof import("sharp");

const PATHS = `<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
<path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />`;

const maskableSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
<rect width="48" height="48" fill="#c2532c" />
<g transform="translate(9.6 9.6) scale(1.2)" fill="none" stroke="#faf5ee" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
${PATHS}
</g>
</svg>`;

const outDir = new URL("../apps/web/public/icons/", import.meta.url);
mkdirSync(outDir, { recursive: true });
const source = await Bun.file(new URL("../apps/web/public/favicon.svg", import.meta.url)).text();

const targets: { file: string; svg: string; size: number }[] = [
  { file: "icon-192.png", svg: source, size: 192 },
  { file: "icon-512.png", svg: source, size: 512 },
  { file: "apple-touch-icon.png", svg: source, size: 180 },
  { file: "favicon-32.png", svg: source, size: 32 },
  { file: "maskable-192.png", svg: maskableSvg, size: 192 },
  { file: "maskable-512.png", svg: maskableSvg, size: 512 },
];

for (const { file, svg, size } of targets) {
  // density keeps the 48-unit SVG crisp when rasterised at 512 px
  const density = Math.ceil((72 * size) / 48) * 2;
  await sharp(Buffer.from(svg), { density })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(new URL(file, outDir).pathname);
  console.log(`wrote ${file} (${size}x${size})`);
}
