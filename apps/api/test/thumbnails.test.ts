/**
 * Generated list thumbnails — `<name>.thumb.webp` next to the original.
 *
 * The three properties that make the scheme safe to rely on:
 *
 *  1. the derivative is BUILT ON DEMAND, because the URL is minted from the row and
 *     every recipe stored before this feature existed must still get one,
 *  2. it is signed and verified exactly like any other upload — no signature, no file,
 *  3. a conversion that FAILS serves the original instead of 404, so an image sharp
 *     cannot decode (HEIC without the HEIF plugin) is a big image, not a broken one.
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import { Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import { AppConfig } from "../src/config.ts";
import { env } from "../src/env.ts";
import { app } from "../src/index.ts";
import { currentExpiry, signUploadUrl, uploadSignature } from "../src/lib/uploadUrls.ts";
import {
  THUMBNAIL_SUFFIX,
  THUMBNAIL_WIDTH,
  isThumbnailName,
  originalOfThumbnail,
  Thumbnails,
  listImageUrlFor,
  thumbnailUrlFor,
} from "../src/core/services/media/thumbnails.ts";
import { runTest } from "./support/effect.ts";
import { removeUpload } from "./support/files.ts";

const written: string[] = [];

/**
 * Every test below that runs sharp (the route tests, and `storePng` inside them) gets this
 * budget instead of bun's 5 s default. The conversions take milliseconds on an idle machine,
 * but the full suite also runs under a loaded host (a gate run measured 354 s against the
 * usual 25 s, with `GET /uploads/<name>.thumb.webp` among the failures); a wall-clock limit
 * is the one assertion here that says nothing about the thumbnail logic.
 */
const SHARP_TEST_TIMEOUT_MS = 60_000;

afterAll(async () => {
  for (const filename of written) await removeUpload(filename);
});

/** Writes a real PNG of the given size into UPLOAD_DIR and returns its filename. */
async function storePng(width: number, height: number): Promise<string> {
  const sharp = (await import("sharp")).default;
  const bytes = await sharp({
    create: { width, height, channels: 3, background: "#c0553a" },
  })
    .png()
    .toBuffer();
  return await storeBytes(bytes, "png");
}

async function storeBytes(bytes: Uint8Array | Buffer, extension: string): Promise<string> {
  const filename = `${crypto.randomUUID()}.${extension}`;
  await mkdir(env.uploadDir, { recursive: true });
  await writeFile(join(env.uploadDir, filename), bytes);
  written.push(filename);
  return filename;
}

/** Path + query of a signed URL, ready for app.request(). */
function signedPath(filename: string): string {
  const signed = signUploadUrl(`/uploads/${filename}`);
  const url = new URL(signed, "http://test.local");
  return `${url.pathname}${url.search}`;
}

/* -------------------------------------------------------------------------- */
/* naming                                                                     */
/* -------------------------------------------------------------------------- */

describe("thumbnail naming", () => {
  test("derives the URL from a stored value, in any of its forms", () => {
    expect(thumbnailUrlFor("/uploads/a.jpg")).toBe(`/uploads/a.jpg${THUMBNAIL_SUFFIX}`);
    expect(thumbnailUrlFor("https://api.test/uploads/a.jpg")).toBe(
      `/uploads/a.jpg${THUMBNAIL_SUFFIX}`,
    );
    expect(thumbnailUrlFor(signUploadUrl("/uploads/a.jpg"))).toBe(
      `/uploads/a.jpg${THUMBNAIL_SUFFIX}`,
    );
  });

  test("listImageUrlFor: the derivative for a hosted upload, the ORIGINAL for an external image", () => {
    // The slim DTOs (PlanRecipe, ShoppingListRecipe) carry no `imageUrl`, so the
    // external case must not be null here — that was an empty square on /plan.
    expect(listImageUrlFor("/uploads/a.jpg")).toBe(`/uploads/a.jpg${THUMBNAIL_SUFFIX}`);
    expect(listImageUrlFor("https://chefkoch.de/bilder/rezept.jpg")).toBe(
      "https://chefkoch.de/bilder/rezept.jpg",
    );
    expect(listImageUrlFor(null)).toBeNull();
    expect(listImageUrlFor("")).toBeNull();
  });

  test("null for anything we do not host — there is nothing to downscale", () => {
    expect(thumbnailUrlFor(null)).toBeNull();
    expect(thumbnailUrlFor(undefined)).toBeNull();
    expect(thumbnailUrlFor("")).toBeNull();
    expect(thumbnailUrlFor("https://chefkoch.de/bilder/rezept.jpg")).toBeNull();
    expect(thumbnailUrlFor("data:image/png;base64,AAAA")).toBeNull();
    expect(thumbnailUrlFor("/uploads/nested/file.jpg")).toBeNull();
  });

  test("never a thumbnail of a thumbnail", () => {
    const once = thumbnailUrlFor("/uploads/a.jpg");
    expect(thumbnailUrlFor(once)).toBe(once);
  });

  test("the original is recoverable by name, extension included", () => {
    expect(originalOfThumbnail(`a.jpg${THUMBNAIL_SUFFIX}`)).toBe("a.jpg");
    expect(isThumbnailName("a.jpg")).toBe(false);
    expect(originalOfThumbnail("a.jpg")).toBeUndefined();
    // A bare suffix has no original, and neither has a nested or dot-prefixed name.
    expect(originalOfThumbnail(THUMBNAIL_SUFFIX)).toBeUndefined();
    expect(originalOfThumbnail(`x/a.jpg${THUMBNAIL_SUFFIX}`)).toBeUndefined();
    expect(originalOfThumbnail(`.a.jpg${THUMBNAIL_SUFFIX}`)).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* the route                                                                  */
/* -------------------------------------------------------------------------- */

describe("GET /uploads/<name>.thumb.webp", () => {
  test("builds a downscaled WebP on first request and caches it on disk", async () => {
    const original = await storePng(1600, 1200);
    const thumbnail = `${original}${THUMBNAIL_SUFFIX}`;
    written.push(thumbnail);
    expect(existsSync(join(env.uploadDir, thumbnail))).toBe(false);

    const response = await app.request(signedPath(thumbnail));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/webp");
    expect(response.headers.get("cache-control")).toContain("immutable");

    const bytes = new Uint8Array(await response.arrayBuffer());
    const sharp = (await import("sharp")).default;
    const meta = await sharp(bytes).metadata();
    expect(meta.width).toBe(THUMBNAIL_WIDTH);
    expect(meta.format).toBe("webp");

    // Cached: the file is on disk now, and a second request is served from it.
    expect(existsSync(join(env.uploadDir, thumbnail))).toBe(true);
    const again = await app.request(signedPath(thumbnail));
    expect(again.status).toBe(200);
    expect(new Uint8Array(await again.arrayBuffer()).byteLength).toBe(bytes.byteLength);
  }, SHARP_TEST_TIMEOUT_MS);

  test("never enlarges: a small original comes back at its own size", async () => {
    const original = await storePng(120, 90);
    const thumbnail = `${original}${THUMBNAIL_SUFFIX}`;
    written.push(thumbnail);

    const response = await app.request(signedPath(thumbnail));
    expect(response.status).toBe(200);
    const sharp = (await import("sharp")).default;
    const meta = await sharp(new Uint8Array(await response.arrayBuffer())).metadata();
    expect(meta.width).toBe(120);
  }, SHARP_TEST_TIMEOUT_MS);

  test("serves the ORIGINAL when the conversion fails, not a 404", async () => {
    // Not an image at all — the same outcome as a HEIC on a server whose libvips
    // has no HEIF plugin, which is the realistic case this protects.
    const original = await storeBytes(Buffer.from("nicht wirklich ein Bild"), "jpg");
    const thumbnail = `${original}${THUMBNAIL_SUFFIX}`;

    const response = await app.request(signedPath(thumbnail));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("nicht wirklich ein Bild");
    // Deliberately NOT immutable: this is the wrong answer and has to heal.
    expect(response.headers.get("cache-control")).not.toContain("immutable");
    expect(existsSync(join(env.uploadDir, thumbnail))).toBe(false);
  }, SHARP_TEST_TIMEOUT_MS);

  test("404 without a valid signature, exactly like any other upload", async () => {
    const original = await storePng(800, 600);
    const thumbnail = `${original}${THUMBNAIL_SUFFIX}`;

    expect((await app.request(`/uploads/${thumbnail}`)).status).toBe(404);

    const forged = await app.request(
      `/uploads/${thumbnail}?exp=${currentExpiry()}&sig=${"0".repeat(32)}`,
    );
    expect(forged.status).toBe(404);
    // Nothing was built for the rejected requests.
    expect(existsSync(join(env.uploadDir, thumbnail))).toBe(false);
  }, SHARP_TEST_TIMEOUT_MS);

  test("404 when the original is gone — a signature does not conjure one", async () => {
    const thumbnail = `${crypto.randomUUID()}.jpg${THUMBNAIL_SUFFIX}`;
    const exp = currentExpiry();
    const response = await app.request(
      `/uploads/${thumbnail}?exp=${exp}&sig=${uploadSignature(thumbnail, exp)}`,
    );
    expect(response.status).toBe(404);
  }, SHARP_TEST_TIMEOUT_MS);

  test("concurrent first requests converge on one file", async () => {
    const original = await storePng(1000, 800);
    const thumbnail = `${original}${THUMBNAIL_SUFFIX}`;
    written.push(thumbnail);

    const responses = await Promise.all(
      Array.from({ length: 4 }, () => app.request(signedPath(thumbnail))),
    );
    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("image/webp");
    }
    // A half-written temp file would have been left behind by a lost race.
    const sharp = (await import("sharp")).default;
    const onDisk = await sharp(join(env.uploadDir, thumbnail)).metadata();
    expect(onDisk.width).toBe(THUMBNAIL_WIDTH);
  }, SHARP_TEST_TIMEOUT_MS);
});

/* -------------------------------------------------------------------------- */
/* the service                                                                */
/* -------------------------------------------------------------------------- */

const resolve = (filename: string) => Thumbnails.use((thumbnails) => thumbnails.resolveThumbnail(filename));

describe("Thumbnails service", () => {
  test("builds the derivative and reports it as not a fallback", async () => {
    const original = await storePng(1600, 1200);
    const thumbnail = `${original}${THUMBNAIL_SUFFIX}`;
    written.push(thumbnail);

    const resolved = await runTest(resolve(thumbnail));
    expect(resolved).toEqual({ path: join(env.uploadDir, thumbnail), fallback: false });
    expect(existsSync(join(env.uploadDir, thumbnail))).toBe(true);
  }, SHARP_TEST_TIMEOUT_MS);

  test("undefined for a name that is no derivative and for a vanished original", async () => {
    expect(await runTest(resolve("a.jpg"))).toBeUndefined();
    expect(await runTest(resolve(`${crypto.randomUUID()}.jpg${THUMBNAIL_SUFFIX}`))).toBeUndefined();
  });

  test("concurrent requests share one conversion", async () => {
    const original = await storePng(1000, 800);
    const thumbnail = `${original}${THUMBNAIL_SUFFIX}`;
    written.push(thumbnail);

    const all = await runTest(Effect.all(Array.from({ length: 4 }, () => resolve(thumbnail)), { concurrency: "unbounded" }));
    expect(all.map((resolved) => resolved?.fallback)).toEqual([false, false, false, false]);
  }, SHARP_TEST_TIMEOUT_MS);

  test("ANY failure is remembered for ten minutes of Clock time, then the build is attempted again", async () => {
    const original = await storeBytes(Buffer.from("nicht wirklich ein Bild"), "png");
    const thumbnail = `${original}${THUMBNAIL_SUFFIX}`;
    written.push(thumbnail);
    const sharp = (await import("sharp")).default;
    const real = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#c0553a" } })
      .png()
      .toBuffer();

    const outcome = await runTest(
      Effect.gen(function* () {
        const failed = yield* resolve(thumbnail);
        // The file is a real image now, but the failure is cached: no second attempt inside the TTL.
        yield* Effect.promise(() => writeFile(join(env.uploadDir, original), real));
        yield* TestClock.adjust("9 minutes");
        const cached = yield* resolve(thumbnail);
        yield* TestClock.adjust("2 minutes");
        const healed = yield* resolve(thumbnail);
        return { failed, cached, healed };
      }),
      { clock: "test" },
    );

    expect(outcome.failed).toEqual({ path: join(env.uploadDir, original), fallback: true });
    expect(outcome.cached?.fallback).toBe(true);
    expect(outcome.healed).toEqual({ path: join(env.uploadDir, thumbnail), fallback: false });
  }, SHARP_TEST_TIMEOUT_MS);

  test("warm is a no-op under the test env and a detached fork of it returns a fiber at once", async () => {
    // The convention that replaced the sync bridge (plan e3 P20): a detached fork starts the warm and returns at once.
    const joined = await runTest(
      Thumbnails.use((thumbnails) =>
        Effect.gen(function* () {
          const fiber = yield* Effect.forkDetach(thumbnails.warm("missing.png"));
          return yield* Fiber.join(fiber);
        }),
      ),
    );
    expect(joined).toBeUndefined();
    await runTest(Thumbnails.use((thumbnails) => thumbnails.warm("missing.png")));
  });

  test("warm builds the derivative where the config is not the test env", async () => {
    const original = await storePng(900, 600);
    const thumbnail = `${original}${THUMBNAIL_SUFFIX}`;
    written.push(thumbnail);
    const layer = Thumbnails.layer.pipe(
      Layer.provide(
        AppConfig.layerFrom({
          NODE_ENV: "development",
          DATABASE_URL: "file:./data/x.db",
          SESSION_SECRET: "0123456789abcdef0123456789abcdef",
          UPLOAD_DIR: env.uploadDir,
        }),
      ),
    );
    await Effect.runPromise(
      Thumbnails.use((thumbnails) => thumbnails.warm(original)).pipe(Effect.provide(layer)),
    );
    expect(existsSync(join(env.uploadDir, thumbnail))).toBe(true);
  }, SHARP_TEST_TIMEOUT_MS);
});
