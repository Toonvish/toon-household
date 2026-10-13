/**
 * `/uploads/:filename` authorisation, and the split that makes it possible.
 *
 * Two halves of UPLOAD_DIR, two rules:
 *
 *  - hero images / avatars / covers are reachable at `/uploads/<uuid>` but ONLY
 *    with a valid `?exp&sig` minted by the API (lib/uploadUrls.ts),
 *  - import SOURCE scans get no signature anywhere, so the public route can never
 *    serve one; they are reachable only through the membership-checked
 *    `GET /api/households/:householdId/recipe/imports/:draftId/source` (M2).
 *
 * The regression this pins down: before, ANY of these files could be fetched
 * forever by anyone who had ever seen the URL — including a removed member.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { storeUploadedImage } from "../src/core/services/media/uploads.ts";
import { ApiError } from "../src/lib/errors.ts";
import { app } from "../src/index.ts";
import { env } from "../src/env.ts";
import {
  SIGNED_URL_WINDOW_MS,
  currentExpiry,
  normalizeStoredUploadUrl,
  signUploadUrl,
  uploadSignature,
  verifyUploadSignature,
} from "../src/lib/uploadUrls.ts";
import { removeUpload } from "./support/files.ts";

/** Smallest valid PNG, so the sniffer accepts it. */
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/gEBjT4uAAAAAElFTkSuQmCC"),
  (char) => char.charCodeAt(0),
);

beforeAll(async () => {
  await runMigrations(db);
});

/* -------------------------------- helpers -------------------------------- */

/** Stores a 1x1 PNG through the core media service, like a module route would. */
async function storeImage(): Promise<{ filename: string; signedUrl: string }> {
  const form = new FormData();
  form.append("file", new File([PNG], "foto.png", { type: "image/png" }));
  const { filename, url } = await storeUploadedImage(form);
  return { filename, signedUrl: url };
}

/** Path + query of a possibly absolute URL, ready for app.request(). */
function pathOf(url: string): string {
  const parsed = new URL(url, "http://test.local");
  return `${parsed.pathname}${parsed.search}`;
}

/* -------------------------------------------------------------------------- */
/* the signing primitives                                                     */
/* -------------------------------------------------------------------------- */

describe("signUploadUrl", () => {
  test("appends exp + sig to a relative upload path", () => {
    const signed = signUploadUrl("/uploads/abc.jpg");
    const url = new URL(signed, "http://test.local");
    expect(url.pathname).toBe("/uploads/abc.jpg");
    expect(url.searchParams.get("sig")).toMatch(/^[0-9a-f]{32}$/);
    expect(Number(url.searchParams.get("exp"))).toBeGreaterThan(Date.now());
  });

  test("keeps an absolute origin intact", () => {
    const signed = signUploadUrl("https://api.example.test/uploads/abc.jpg");
    expect(signed.startsWith("https://api.example.test/uploads/abc.jpg?")).toBe(true);
  });

  test("passes through everything that is not one of our uploads", () => {
    for (const value of [
      null,
      undefined,
      "",
      "https://chefkoch.de/bilder/rezept.jpg",
      "data:image/png;base64,AAAA",
      "/api/groups/x/recipes",
      "javascript:alert(1)",
    ]) {
      expect(signUploadUrl(value as string)).toBe(value as string);
    }
  });

  test("is idempotent: re-signing replaces the signature, never stacks it", () => {
    const once = signUploadUrl("/uploads/abc.jpg");
    const twice = signUploadUrl(once);
    expect(twice).toBe(once);
    expect(twice.split("?")).toHaveLength(2);
  });

  test("is STABLE inside one window, so caches actually hit", () => {
    // Windows are aligned to absolute multiples of SIGNED_URL_WINDOW_MS, so start
    // the clock on a boundary — that is the property being pinned down.
    const base = Math.floor(1_700_000_000_000 / SIGNED_URL_WINDOW_MS) * SIGNED_URL_WINDOW_MS;
    const start = signUploadUrl("/uploads/abc.jpg", base);
    expect(signUploadUrl("/uploads/abc.jpg", base + 1)).toBe(start);
    expect(signUploadUrl("/uploads/abc.jpg", base + SIGNED_URL_WINDOW_MS - 1)).toBe(start);

    // A new window mints a new URL (which is what eventually kills a kept link).
    expect(signUploadUrl("/uploads/abc.jpg", base + SIGNED_URL_WINDOW_MS)).not.toBe(start);
  });

  test("a signature outlives its window by at least one more", () => {
    const now = 1_700_000_000_000;
    expect(currentExpiry(now) - now).toBeGreaterThanOrEqual(SIGNED_URL_WINDOW_MS);
    expect(currentExpiry(now) - now).toBeLessThanOrEqual(2 * SIGNED_URL_WINDOW_MS);
  });

  test("refuses to sign anything with a path in it", () => {
    expect(signUploadUrl("/uploads/../../etc/passwd")).toBe("/uploads/../../etc/passwd");
    expect(signUploadUrl("/uploads/nested/file.jpg")).toBe("/uploads/nested/file.jpg");
  });
});

describe("normalizeStoredUploadUrl", () => {
  test("reduces every form to the bare storage path", () => {
    // Typed as plain `string` so the generic does not narrow to the literal input.
    const relative: string = "/uploads/a.jpg?exp=1&sig=2";
    const absolute: string = "https://api.test/uploads/a.jpg?exp=1&sig=2";
    expect(normalizeStoredUploadUrl(relative)).toBe("/uploads/a.jpg");
    expect(normalizeStoredUploadUrl(absolute)).toBe("/uploads/a.jpg");
    expect(normalizeStoredUploadUrl(signUploadUrl("/uploads/a.jpg") as string)).toBe(
      "/uploads/a.jpg",
    );
  });

  test("leaves external URLs and nullish values alone", () => {
    expect(normalizeStoredUploadUrl("https://chefkoch.de/x.jpg")).toBe("https://chefkoch.de/x.jpg");
    expect(normalizeStoredUploadUrl(null)).toBeNull();
    expect(normalizeStoredUploadUrl(undefined)).toBeUndefined();
  });
});

describe("verifyUploadSignature", () => {
  const filename = "abc.jpg";

  test("accepts a freshly minted signature", () => {
    const exp = currentExpiry();
    expect(verifyUploadSignature(filename, String(exp), uploadSignature(filename, exp))).toBe("ok");
  });

  test("reports a missing signature", () => {
    expect(verifyUploadSignature(filename, undefined, undefined)).toBe("missing");
    expect(verifyUploadSignature(filename, "123", undefined)).toBe("missing");
  });

  test("rejects a tampered signature", () => {
    const exp = currentExpiry();
    const signature = uploadSignature(filename, exp);
    const flipped = `${signature.slice(0, -1)}${signature.endsWith("0") ? "1" : "0"}`;
    expect(verifyUploadSignature(filename, String(exp), flipped)).toBe("invalid");
  });

  test("rejects a signature minted for a DIFFERENT file", () => {
    const exp = currentExpiry();
    expect(verifyUploadSignature(filename, String(exp), uploadSignature("other.jpg", exp))).toBe(
      "invalid",
    );
  });

  test("exp is part of the signed payload, so it cannot be extended", () => {
    const exp = currentExpiry();
    const signature = uploadSignature(filename, exp);
    expect(verifyUploadSignature(filename, String(exp + SIGNED_URL_WINDOW_MS), signature)).toBe(
      "invalid",
    );
  });

  test("reports an expired but authentic signature", () => {
    const past = Date.now() - 1000;
    expect(verifyUploadSignature(filename, String(past), uploadSignature(filename, past))).toBe(
      "expired",
    );
  });

  test("rejects a non-numeric or padded exp", () => {
    expect(verifyUploadSignature(filename, "abc", "x".repeat(32))).toBe("invalid");
    expect(verifyUploadSignature(filename, "0123", "x".repeat(32))).toBe("invalid");
  });
});

/* -------------------------------------------------------------------------- */
/* GET /uploads/:filename                                                     */
/* -------------------------------------------------------------------------- */

describe("GET /uploads/:filename", () => {
  test("serves a hero image with the signature the API handed out", async () => {
    const { filename, signedUrl } = await storeImage();

    const response = await app.request(pathOf(signedUrl));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/png");
    // `private`, because the URL is a capability now — a shared cache must not
    // hand one client's signed response to somebody else.
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toBe("private, max-age=21600, immutable");

    await removeUpload(filename);
  });

  test("404 WITHOUT a signature — this is the closed hole", async () => {
    const { filename } = await storeImage();

    const response = await app.request(`/uploads/${filename}`);
    expect(response.status).toBe(404);

    await removeUpload(filename);
  });

  test("404 for a tampered or expired signature", async () => {
    const { filename } = await storeImage();

    const forged = await app.request(`/uploads/${filename}?exp=${currentExpiry()}&sig=${"0".repeat(32)}`);
    expect(forged.status).toBe(404);

    const past = Date.now() - 1000;
    const stale = await app.request(
      `/uploads/${filename}?exp=${past}&sig=${uploadSignature(filename, past)}`,
    );
    expect(stale.status).toBe(404);

    await removeUpload(filename);
  });

  test("a signature for one file does not open another", async () => {
    const first = await storeImage();
    const second = await storeImage();

    const search = new URL(first.signedUrl, "http://test.local").search;
    const response = await app.request(`/uploads/${second.filename}${search}`);
    expect(response.status).toBe(404);

    await removeUpload(first.filename);
    await removeUpload(second.filename);
  });

  test("404 for an unknown file even when the signature is valid", async () => {
    const filename = `${crypto.randomUUID()}.jpg`;
    const exp = currentExpiry();
    const response = await app.request(
      `/uploads/${filename}?exp=${exp}&sig=${uploadSignature(filename, exp)}`,
    );
    expect(response.status).toBe(404);
  });

  test("path traversal stays blocked", async () => {
    for (const attempt of ["..%2F..%2Fetc%2Fpasswd", "%2Fetc%2Fpasswd"]) {
      const exp = currentExpiry();
      const response = await app.request(
        `/uploads/${attempt}?exp=${exp}&sig=${uploadSignature(decodeURIComponent(attempt), exp)}`,
      );
      expect(response.status).toBe(404);
    }
  });
});

// M2: "the stored column never holds a signature" and "import source scans" return with the recipe routes (toon-recipe test/uploads.test.ts).

/* -------------------------------------------------------------------------- */
/* storeUploadedImage                                                         */
/* -------------------------------------------------------------------------- */

describe("storeUploadedImage", () => {
  function formWith(file: File): FormData {
    const form = new FormData();
    form.append("file", file);
    return form;
  }

  test("stores a PNG as <uuid>.png with a signed url", async () => {
    const stored = await storeImage();
    expect(stored.filename).toMatch(/^[0-9a-f-]{36}\.png$/);
    const url = new URL(stored.signedUrl, "http://test.local");
    expect(url.pathname).toBe(`/uploads/${stored.filename}`);
    expect(url.searchParams.get("sig")).toMatch(/^[0-9a-f]{32}$/);
    expect(url.searchParams.get("exp")).not.toBeNull();

    await removeUpload(stored.filename);
  });

  test("an empty file answers 400", async () => {
    const error = await storeUploadedImage(
      formWith(new File([], "leer.png", { type: "image/png" })),
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
  });

  test("a text file answers 415", async () => {
    const error = await storeUploadedImage(
      formWith(new File(["kein Bild"], "notiz.txt", { type: "text/plain" })),
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(415);
  });
});
