/**
 * `importFromUrl` end to end and the hero-image downloader — fully offline via a
 * scripted `fetch` and a stub DNS resolver. Stored images are cleaned up.
 */
import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import { env } from "../../src/env.ts";
import { downloadHeroImage } from "../../src/modules/recipe/services/import/url/image.ts";
import { importFromUrl } from "../../src/modules/recipe/services/import/url/index.ts";
import { createResolver, createScriptedFetch, expectApiError, fixture, makeTestPng } from "./helpers.ts";

const resolve = createResolver();
const CHEFKOCH_URL = "https://www.chefkoch.de/rezepte/1234567890/Klassische-Pfannkuchen.html";

/** Filenames written into UPLOAD_DIR by these tests. */
const stored = new Set<string>();

afterAll(() => {
  for (const filename of stored) rmSync(join(env.uploadDir, filename), { force: true });
});

describe("importFromUrl", () => {
  test("fetches, parses and returns everything the draft row needs", async () => {
    const scripted = createScriptedFetch({ [CHEFKOCH_URL]: { body: fixture("chefkoch-jsonld.html") } });
    const result = await importFromUrl(CHEFKOCH_URL, {
      fetchImpl: scripted.fetch,
      resolve,
      downloadImage: false,
    });

    expect(result.sourceUrl).toBe(CHEFKOCH_URL);
    expect(result.parsed.title).toBe("Klassische Pfannkuchen");
    expect(result.parsed.ingredients).toHaveLength(8);
    expect(result.parsed.steps).toHaveLength(4);
    expect(result.rawText).toContain("Zutaten:");
    expect(result.sourceMeta.method).toBe("json-ld");
    expect(result.sourceMeta.host).toBe("chefkoch.de");
    expect(result.sourceMeta.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.confidence.overall).toBe(result.parsed.confidence.overall);
    expect(scripted.requests).toEqual([CHEFKOCH_URL]);
  });

  test("follows a redirect and reports the FINAL url as the source", async () => {
    const scripted = createScriptedFetch({
      "https://chefkoch.de/r/1": { redirectTo: CHEFKOCH_URL },
      [CHEFKOCH_URL]: { body: fixture("chefkoch-jsonld.html") },
    });
    const result = await importFromUrl("https://chefkoch.de/r/1", {
      fetchImpl: scripted.fetch,
      resolve,
      downloadImage: false,
    });
    expect(result.sourceUrl).toBe(CHEFKOCH_URL);
    expect(result.parsed.sourceUrl).toBe(CHEFKOCH_URL);
  });

  test("422 parse_failed when the page holds no recipe at all", async () => {
    const url = "https://example.com/impressum";
    const scripted = createScriptedFetch({
      [url]: { body: "<html><body><h1>Impressum</h1><p>Angaben gemäß § 5 TMG.</p></body></html>" },
    });
    const error = await expectApiError(
      importFromUrl(url, { fetchImpl: scripted.fetch, resolve, downloadImage: false }),
    );
    expect(error.status).toBe(422);
    expect(error.code).toBe("parse_failed");
  });

  test("400 fetch_failed for a private target, without issuing a request", async () => {
    const scripted = createScriptedFetch({});
    const error = await expectApiError(
      importFromUrl("http://10.0.0.5/recipe", { fetchImpl: scripted.fetch, resolve }),
    );
    expect(error.status).toBe(400);
    expect(error.code).toBe("fetch_failed");
    expect(scripted.requests).toEqual([]);
  });

  test("downloads the hero image and rewrites imageUrl to the local upload", async () => {
    const png = await makeTestPng(200, 120);
    const heroUrl = "https://img.chefkoch-cdn.de/rezepte/1234567890/bilder/1148929/crop-960x540/pfannkuchen.jpg";
    const scripted = createScriptedFetch({
      [CHEFKOCH_URL]: { body: fixture("chefkoch-jsonld.html") },
      [heroUrl]: { body: "", headers: { "content-type": "image/png" } },
    });
    // The scripted fetch returns a string body; serve real PNG bytes instead.
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === heroUrl) return new Response(png, { headers: { "content-type": "image/png" } });
      return await scripted.fetch(url, init);
    }) as unknown as typeof fetch;

    const result = await importFromUrl(CHEFKOCH_URL, { fetchImpl, resolve });
    expect(result.parsed.imageUrl).toMatch(/^\/uploads\/[0-9a-f-]{36}\.png$/);
    const filename = result.parsed.imageUrl?.replace("/uploads/", "");
    if (filename) stored.add(filename);
    expect(await Bun.file(join(env.uploadDir, filename as string)).exists()).toBe(true);
  });

  test("keeps the remote imageUrl when every candidate fails to download", async () => {
    const heroUrl = "https://img.chefkoch-cdn.de/rezepte/1234567890/bilder/1148929/crop-960x540/pfannkuchen.jpg";
    const ogUrl = "https://img.chefkoch-cdn.de/rezepte/1234567890/bilder/pfannkuchen.jpg";
    const scripted = createScriptedFetch({
      [CHEFKOCH_URL]: { body: fixture("chefkoch-jsonld.html") },
      [heroUrl]: { status: 404, body: "gone" },
      [ogUrl]: { status: 404, body: "gone" },
    });
    const result = await importFromUrl(CHEFKOCH_URL, { fetchImpl: scripted.fetch, resolve });
    expect(result.parsed.imageUrl).toBe(heroUrl);
  });

  test("falls through to the og:image when the JSON-LD image 404s", async () => {
    const png = await makeTestPng(160, 90);
    const heroUrl = "https://img.chefkoch-cdn.de/rezepte/1234567890/bilder/1148929/crop-960x540/pfannkuchen.jpg";
    const ogUrl = "https://img.chefkoch-cdn.de/rezepte/1234567890/bilder/pfannkuchen.jpg";
    const scripted = createScriptedFetch({
      [CHEFKOCH_URL]: { body: fixture("chefkoch-jsonld.html") },
      [heroUrl]: { status: 404, body: "gone" },
    });
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === ogUrl) return new Response(png, { headers: { "content-type": "image/png" } });
      return await scripted.fetch(url, init);
    }) as unknown as typeof fetch;

    const result = await importFromUrl(CHEFKOCH_URL, { fetchImpl, resolve });
    expect(result.parsed.imageUrl).toMatch(/^\/uploads\/[0-9a-f-]{36}\.png$/);
    const filename = result.parsed.imageUrl?.replace("/uploads/", "");
    if (filename) stored.add(filename);
    // Both candidates were attempted, in rank order.
    expect(scripted.requests).toContain(heroUrl);
  });

  test("stores the referenced ImageObject on a @graph page (chefkoch today)", async () => {
    const png = await makeTestPng(96, 54);
    const graphUrl = "https://www.chefkoch.de/rezepte/2133611343071438/Rote-Linsen-Curry-mit-Spaghetti.html";
    const heroUrl =
      "https://img.chefkoch-cdn.de/rezepte/2133611343071438/bilder/1383229/crop-960x540/rote-linsen-curry.jpg";
    const scripted = createScriptedFetch({ [graphUrl]: { body: fixture("chefkoch-graph.html") } });
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === heroUrl) return new Response(png, { headers: { "content-type": "image/png" } });
      return await scripted.fetch(url, init);
    }) as unknown as typeof fetch;

    const result = await importFromUrl(graphUrl, { fetchImpl, resolve });
    expect(result.parsed.imageUrl).toMatch(/^\/uploads\/[0-9a-f-]{36}\.png$/);
    const filename = result.parsed.imageUrl?.replace("/uploads/", "");
    if (filename) stored.add(filename);
    expect(result.parsed.sourceName).toBe("Chefkoch");
  });
});

describe("downloadHeroImage", () => {
  test("stores a real image and reports its local url", async () => {
    const png = await makeTestPng(120, 80);
    const url = "https://cdn.example/bild.png";
    const fetchImpl = (async () =>
      new Response(png, { headers: { "content-type": "image/png" } })) as unknown as typeof fetch;

    const result = await downloadHeroImage(url, { fetchImpl, resolve });
    expect(result).toBeDefined();
    stored.add(result?.filename as string);
    expect(result?.mimeType).toBe("image/png");
    expect(result?.url).toBe(`/uploads/${result?.filename}`);
    expect(result?.size).toBe(png.byteLength);
  });

  test("refuses an HTML error page disguised as an image", async () => {
    const fetchImpl = (async () =>
      new Response("<html>404</html>", { headers: { "content-type": "image/png" } })) as unknown as typeof fetch;
    expect(await downloadHeroImage("https://cdn.example/x.png", { fetchImpl, resolve })).toBeUndefined();
  });

  test("refuses an image from a private host", async () => {
    const fetchImpl = (async () => {
      throw new Error("should never be called");
    }) as unknown as typeof fetch;
    expect(await downloadHeroImage("http://192.168.0.4/logo.png", { fetchImpl, resolve })).toBeUndefined();
  });

  test("refuses an oversized image", async () => {
    const png = await makeTestPng(64, 64);
    const fetchImpl = (async () =>
      new Response(png, {
        headers: { "content-type": "image/png", "content-length": "99999999" },
      })) as unknown as typeof fetch;
    expect(await downloadHeroImage("https://cdn.example/big.png", { fetchImpl, resolve })).toBeUndefined();
  });

  test("never throws on a network error", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("connection reset");
    }) as unknown as typeof fetch;
    expect(await downloadHeroImage("https://cdn.example/x.png", { fetchImpl, resolve })).toBeUndefined();
  });

  test("stores an inline data: image", async () => {
    const png = await makeTestPng(32, 32);
    const dataUrl = `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
    const result = await downloadHeroImage(dataUrl, { resolve });
    expect(result).toBeDefined();
    stored.add(result?.filename as string);
    expect(result?.mimeType).toBe("image/png");
  });
});
