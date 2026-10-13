/**
 * Test-only file helpers.
 *
 * UPLOAD_DIR is the developer's real `data/uploads` under `bun test` too, so the
 * convention here is that a test removes whatever it wrote. Use this instead of a
 * bare `unlink`: storing an image also produces the generated list thumbnail
 * (`<name>.thumb.webp`, services/media/thumbnails.ts), and unlinking only the
 * original leaves that derivative behind on every run.
 */
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { env } from "../../src/env.ts";
import { THUMBNAIL_SUFFIX } from "../../src/core/services/media/thumbnails.ts";

/** Deletes a stored upload and its thumbnail; missing files are fine. */
export async function removeUpload(filename: string): Promise<void> {
  for (const name of [filename, `${filename}${THUMBNAIL_SUFFIX}`]) {
    await unlink(join(env.uploadDir, name)).catch(() => undefined);
  }
}
