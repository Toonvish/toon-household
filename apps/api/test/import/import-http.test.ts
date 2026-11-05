/**
 * `ImportHttp`: the guarded `HttpClient` of the URL importer (docs/EFFECT.md E7; plan
 * `docs/plans/e3-recipe-services.md` P10, E3-T03).
 *
 * Offline: `FetchHttpClient.Fetch` is provided as a scripted fetch around every run (no `fetch` is mocked), and the
 * DNS resolver comes in through the `setImportGuardForTests` seam, which is handed back with `null` after every test.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { FetchHttpClient } from "effect/http";
import { isApiError } from "../../src/lib/errors.ts";
import {
  ImportHttp,
  type FetchImageOptions,
  type FetchLimits,
  fetchHtml,
  setImportGuardForTests,
} from "../../src/modules/recipe/services/import/url/fetch.ts";
import { runTest } from "../support/effect.ts";
import { createResolver, createScriptedFetch } from "./helpers.ts";

const page = "<html><head><title>OK</title></head><body>Hallo</body></html>";
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

afterEach(() => setImportGuardForTests(null));

/** Runs `ImportHttp.fetchHtml` on the app runtime with `fetchImpl` as the transport; resolves with the Exit's failure flipped. */
function pageOf(fetchImpl: typeof fetch, url: string, limits?: FetchLimits) {
  return ImportHttp.use((http) => http.fetchHtml(url, limits)).pipe(
    Effect.provideService(FetchHttpClient.Fetch, fetchImpl),
  );
}

function pageFailure(fetchImpl: typeof fetch, url: string, limits?: FetchLimits) {
  return runTest(Effect.flip(pageOf(fetchImpl, url, limits)));
}

function imageOf(fetchImpl: typeof fetch, url: string, options?: FetchImageOptions) {
  return runTest(
    ImportHttp.use((http) => http.fetchImage(url, options)).pipe(Effect.provideService(FetchHttpClient.Fetch, fetchImpl)),
  );
}

interface Seen {
  url: string;
  headers: Headers;
  redirect: string | undefined;
}

/** A fetch that records what the client handed it (URL, headers, `redirect`) and answers with `respond`. */
function recordingFetch(respond: (url: string) => Response): { fetch: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    seen.push({ url, headers: new Headers(init?.headers), redirect: init?.redirect });
    return respond(url);
  }) as unknown as typeof fetch;
  return { fetch: impl, seen };
}

describe("ImportHttp.fetchHtml", () => {
  test("sends exactly the five request headers and no trace headers, with redirect manual", async () => {
    setImportGuardForTests({ resolve: createResolver() });
    const recorder = recordingFetch(() => new Response(page, { headers: { "content-type": "text/html" } }));
    const result = await runTest(pageOf(recorder.fetch, "https://ok.example/r"));
    expect(result.html).toContain("Hallo");

    expect(recorder.seen).toHaveLength(1);
    const [request] = recorder.seen;
    expect(request?.redirect).toBe("manual");
    expect(request?.headers.get("user-agent")).toContain("Chrome/131");
    expect(request?.headers.get("accept")).toBe("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
    expect(request?.headers.get("accept-language")).toBe("de-DE,de;q=0.9,en;q=0.6");
    expect(request?.headers.get("cache-control")).toBe("no-cache");
    expect(request?.headers.get("pragma")).toBe("no-cache");
    expect([...(request?.headers.keys() ?? [])].sort()).toEqual(
      ["accept", "accept-language", "cache-control", "pragma", "user-agent"],
    );
    expect(request?.headers.has("traceparent")).toBe(false);
    expect(request?.headers.has("b3")).toBe(false);
  });

  test("follows a redirect to another PUBLIC host and reports every hop", async () => {
    setImportGuardForTests({ resolve: createResolver() });
    const scripted = createScriptedFetch({
      "https://old.example/r": { redirectTo: "https://new.example/r" },
      "https://new.example/r": { body: page },
    });
    const result = await runTest(pageOf(scripted.fetch, "https://old.example/r"));
    expect(result.url).toBe("https://new.example/r");
    expect(result.hops).toEqual(["https://old.example/r", "https://new.example/r"]);
    expect(scripted.requests).toEqual(["https://old.example/r", "https://new.example/r"]);
  });

  test("refuses a redirect into the metadata address without a second request", async () => {
    setImportGuardForTests({ resolve: createResolver() });
    const scripted = createScriptedFetch({
      "https://evil.example/start": { redirectTo: "http://169.254.169.254/latest/meta-data/" },
    });
    const failure = await pageFailure(scripted.fetch, "https://evil.example/start");
    expect(isApiError(failure)).toBe(true);
    expect(failure).toMatchObject({
      status: 400,
      code: "fetch_failed",
      details: { reason: "private_ip" },
    });
    expect(scripted.requests).toEqual(["https://evil.example/start"]);
  });

  test("a failed transport is pageLoadFailed with the reason, never a defect", async () => {
    setImportGuardForTests({ resolve: createResolver() });
    const impl = (async () => {
      throw new TypeError("connection refused");
    }) as unknown as typeof fetch;
    const failure = await pageFailure(impl, "https://down.example/r");
    expect(failure).toMatchObject({
      status: 400,
      code: "fetch_failed",
      text: { key: "server.import.pageLoadFailed", values: { reason: "connection refused" } },
    });
  });

  test("the overall budget is pageTimeout and aborts the request", async () => {
    setImportGuardForTests({ resolve: createResolver() });
    let aborted = false;
    const impl = ((_input: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("aborted", "AbortError"));
        });
      })) as unknown as typeof fetch;
    const failure = await pageFailure(impl, "https://slow.example/r", { timeoutMs: 50 });
    expect(failure).toMatchObject({ status: 400, code: "fetch_failed", text: "server.import.pageTimeout" });
    expect(aborted).toBe(true);
  });

  test("stops reading and cancels the body once the cap is passed", async () => {
    setImportGuardForTests({ resolve: createResolver() });
    let pulled = 0;
    let cancelled = false;
    const impl = (async () =>
      new Response(
        new ReadableStream<Uint8Array>(
          {
            pull(controller) {
              pulled += 1;
              controller.enqueue(new Uint8Array(400));
            },
            cancel() {
              cancelled = true;
            },
          },
          { highWaterMark: 0 },
        ),
        { headers: { "content-type": "text/html" } },
      )) as unknown as typeof fetch;
    const failure = await pageFailure(impl, "https://big.example/r", { maxBytes: 1000 });
    expect(failure).toMatchObject({ code: "fetch_failed", text: "server.import.pageTooLarge" });
    expect(pulled).toBeLessThan(6);
    expect(cancelled).toBe(true);
  });

  test("a refused response has its body cancelled", async () => {
    setImportGuardForTests({ resolve: createResolver() });
    let cancelled = false;
    const impl = (async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(10));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { status: 500 },
      )) as unknown as typeof fetch;
    const failure = await pageFailure(impl, "https://err.example/r");
    expect(failure).toMatchObject({ text: { key: "server.import.pageHttpError", values: { status: 500 } } });
    expect(cancelled).toBe(true);
  });
});

describe("ImportHttp.fetchImage", () => {
  test("returns the bytes, with the image headers, the referer and redirect follow", async () => {
    setImportGuardForTests({ resolve: createResolver() });
    const recorder = recordingFetch(() => new Response(png, { headers: { "content-type": "image/png" } }));
    const bytes = await imageOf(recorder.fetch, "https://cdn.example/x.png", { refererUrl: "https://ok.example/r" });
    expect(bytes).toEqual(png);
    const [request] = recorder.seen;
    expect(request?.redirect).toBe("follow");
    expect(request?.headers.get("accept")).toBe("image/avif,image/webp,image/jpeg,image/png,*/*;q=0.8");
    expect(request?.headers.get("accept-language")).toBe("de-DE,de;q=0.9");
    expect(request?.headers.get("referer")).toBe("https://ok.example/r");
    expect(request?.headers.has("traceparent")).toBe(false);
    expect(request?.headers.has("b3")).toBe(false);
  });

  test("answers undefined for a 404", async () => {
    setImportGuardForTests({ resolve: createResolver() });
    const scripted = createScriptedFetch({ "https://cdn.example/x.png": { status: 404, body: "nope" } });
    expect(await imageOf(scripted.fetch, "https://cdn.example/x.png")).toBeUndefined();
    expect(scripted.requests).toHaveLength(1);
  });

  test("answers undefined for a page labelled as HTML", async () => {
    setImportGuardForTests({ resolve: createResolver() });
    const scripted = createScriptedFetch({ "https://cdn.example/x.png": { body: "<html>error</html>" } });
    expect(await imageOf(scripted.fetch, "https://cdn.example/x.png")).toBeUndefined();
  });

  test("answers undefined for a guard refusal and never requests it", async () => {
    setImportGuardForTests({ resolve: createResolver() });
    const scripted = createScriptedFetch({});
    expect(await imageOf(scripted.fetch, "http://192.168.0.4/logo.png")).toBeUndefined();
    expect(await imageOf(scripted.fetch, "http://169.254.169.254/latest/meta-data/")).toBeUndefined();
    expect(scripted.requests).toEqual([]);
  });

  test("answers undefined for a thrown fetch", async () => {
    setImportGuardForTests({ resolve: createResolver() });
    const impl = (async () => {
      throw new TypeError("connection refused");
    }) as unknown as typeof fetch;
    expect(await imageOf(impl, "https://cdn.example/x.png")).toBeUndefined();
  });

  test("answers undefined for an empty body and for one over the cap", async () => {
    setImportGuardForTests({ resolve: createResolver() });
    const empty = createScriptedFetch({ "https://cdn.example/e.png": { body: "", headers: { "content-type": "image/png" } } });
    expect(await imageOf(empty.fetch, "https://cdn.example/e.png")).toBeUndefined();
    const big = createScriptedFetch({
      "https://cdn.example/b.png": { body: "x".repeat(2000), headers: { "content-type": "image/png" } },
    });
    expect(await imageOf(big.fetch, "https://cdn.example/b.png", { maxBytes: 1000 })).toBeUndefined();
  });
});

describe("setImportGuardForTests: the exact-host allow list", () => {
  test("lets an allowed host through, refuses every other private one, and never requests a refused URL", async () => {
    setImportGuardForTests({ allowHosts: ["127.0.0.1"], resolve: createResolver() });
    const scripted = createScriptedFetch({ "http://127.0.0.1:8080/r": { body: page } });

    const result = await runTest(pageOf(scripted.fetch, "http://127.0.0.1:8080/r"));
    expect(result.html).toContain("Hallo");
    expect(scripted.requests).toEqual(["http://127.0.0.1:8080/r"]);

    const neighbour = await pageFailure(scripted.fetch, "http://127.0.0.2/r");
    expect(neighbour).toMatchObject({ status: 400, code: "fetch_failed", details: { reason: "private_ip" } });
    const localhost = await pageFailure(scripted.fetch, "http://localhost:8080/r");
    expect(localhost).toMatchObject({ details: { reason: "blocked_host" } });
    expect(scripted.requests).toEqual(["http://127.0.0.1:8080/r"]);
  });

  test("a redirect from the allowed host into 169.254.169.254 is still refused, unrequested", async () => {
    setImportGuardForTests({ allowHosts: ["127.0.0.1"], resolve: createResolver() });
    const scripted = createScriptedFetch({
      "http://127.0.0.1:8080/start": { redirectTo: "http://169.254.169.254/latest/meta-data/" },
    });
    const failure = await pageFailure(scripted.fetch, "http://127.0.0.1:8080/start");
    expect(failure).toMatchObject({ code: "fetch_failed", details: { reason: "private_ip" } });
    expect(scripted.requests).toEqual(["http://127.0.0.1:8080/start"]);
  });

  test("the image fetch honours the list too, and an unlisted private host still answers undefined", async () => {
    setImportGuardForTests({ allowHosts: ["127.0.0.1"], resolve: createResolver() });
    const scripted = createScriptedFetch({
      "http://127.0.0.1:8080/x.png": { body: "", headers: { "content-type": "image/png" } },
    });
    const ok = createScriptedFetch({
      "http://127.0.0.1:8080/x.png": { body: "PNG", headers: { "content-type": "image/png" } },
    });
    expect(await imageOf(ok.fetch, "http://127.0.0.1:8080/x.png")).toEqual(new TextEncoder().encode("PNG"));
    expect(await imageOf(scripted.fetch, "http://127.0.0.2/x.png")).toBeUndefined();
    expect(scripted.requests).toEqual([]);
  });

  test("the Promise entry point reads the seam, and null puts the real guard back", async () => {
    const scripted = createScriptedFetch({ "http://127.0.0.1:8080/r": { body: page } });
    setImportGuardForTests({ allowHosts: ["127.0.0.1"] });
    expect((await fetchHtml("http://127.0.0.1:8080/r", { fetchImpl: scripted.fetch })).html).toContain("Hallo");
    setImportGuardForTests(null);
    await expect(fetchHtml("http://127.0.0.1:8080/r", { fetchImpl: scripted.fetch })).rejects.toMatchObject({
      code: "fetch_failed",
      details: { reason: "private_ip" },
    });
    expect(scripted.requests).toEqual(["http://127.0.0.1:8080/r"]);
  });
});
