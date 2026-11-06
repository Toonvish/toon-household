/**
 * `WasteFlyerFetch` (plan m8 P17, M8-T11) over a RECORDING `HttpClient.make` client: no test reaches the network.
 *
 * The client answers per URL from a table of `Response` factories and records every request it was asked to send (its
 * URL, headers and the `redirect` fetch option of the call), so a refused redirect is proven NOT requested. The slow
 * body runs under `TestClock`. The production layer under `bun test` answers `502 … network` without a request, the
 * seam `setWasteFlyerFetchForTests` routes the runtime's service through `makeTestWasteFlyerFetch`.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { CALENDAR_LIMITS, WASTE_PROVIDERS } from "@toon/shared";
import { Context, Effect, Fiber, Layer } from "effect";
import { FetchHttpClient, HttpClient, HttpClientError, HttpClientResponse } from "effect/http";
import { TestClock } from "effect/testing";
import {
  WasteFlyerFetch,
  checkWasteSourceUrl,
  makeTestWasteFlyerFetch,
  setWasteFlyerFetchForTests,
} from "../src/modules/calendar/services/waste/fetch.ts";
import { runTest } from "./support/effect.ts";

const FLYER_URL = WASTE_PROVIDERS.hattingen.defaultUrl;
const PDF = new TextEncoder().encode("%PDF-1.7\n% a tiny stand-in for the flyer\n");

interface Recorded {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly redirect: string | undefined;
}

type Answer = () => Response | "networkError";

/** A client that answers from `answers` (exact URL keys; anything else is a 404) and records each request. */
function recordingClient(answers: Record<string, Answer>) {
  const requests: Recorded[] = [];
  const client = HttpClient.make((request, url, _signal, fiber) => {
    requests.push({
      url: url.href,
      headers: { ...request.headers },
      redirect: Context.getOrUndefined(fiber.context, FetchHttpClient.RequestInit)?.redirect,
    });
    const answer = answers[url.href];
    const response = answer === undefined ? new Response("not found", { status: 404 }) : answer();
    if (response === "networkError") {
      return Effect.fail(
        new HttpClientError.HttpClientError({
          reason: new HttpClientError.TransportError({ request, cause: new Error("connection refused") }),
        }),
      );
    }
    return Effect.succeed(HttpClientResponse.fromWeb(request, response));
  });
  const layer = WasteFlyerFetch.layerFromClient.pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, client)));
  return { requests, layer };
}

const fetchWith = (layer: Layer.Layer<WasteFlyerFetch>, url: string) =>
  WasteFlyerFetch.use((service) => service.fetch("hattingen", url)).pipe(Effect.provide(layer));

const ok = (layer: Layer.Layer<WasteFlyerFetch>, url: string = FLYER_URL) => Effect.runPromise(fetchWith(layer, url));
const failure = (layer: Layer.Layer<WasteFlyerFetch>, url: string = FLYER_URL) =>
  Effect.runPromise(Effect.flip(fetchWith(layer, url)));

const redirectTo = (location: string): Answer => () => new Response(null, { status: 302, headers: { location } });
const pdf: Answer = () => new Response(PDF, { status: 200, headers: { "content-type": "application/pdf" } });

afterEach(() => setWasteFlyerFetchForTests(null));

describe("checkWasteSourceUrl (pure)", () => {
  test("https on an exact provider host passes", () => {
    expect(checkWasteSourceUrl("hattingen", FLYER_URL)?.hostname).toBe("www.hattingen.de");
    expect(checkWasteSourceUrl("hattingen", "https://hattingen.de/x.pdf")?.href).toBe("https://hattingen.de/x.pdf");
  });

  test("http, other schemes, foreign and look-alike hosts, credentials, ports and garbage are refused", () => {
    for (const url of [
      "http://www.hattingen.de/x.pdf",
      "ftp://www.hattingen.de/x.pdf",
      "https://evil-hattingen.de/x.pdf",
      "https://www.hattingen.de.example.com/x.pdf",
      "https://sub.www.hattingen.de/x.pdf",
      "https://user:pw@www.hattingen.de/x.pdf",
      "https://www.hattingen.de:8443/x.pdf",
      "https://169.254.169.254/latest/meta-data",
      "not a url",
    ]) {
      expect(checkWasteSourceUrl("hattingen", url)).toBeUndefined();
    }
  });
});

describe("WasteFlyerFetch over HttpClient (P17)", () => {
  test("a 200 answers the bytes; one GET with redirect manual and no trace headers", async () => {
    const { requests, layer } = recordingClient({ [FLYER_URL]: pdf });
    const result = await ok(layer);
    expect(result.bytes).toEqual(PDF);
    expect(result.url).toBe(FLYER_URL);
    expect(requests.length).toBe(1);
    expect(requests[0]!.redirect).toBe("manual");
    expect(Object.keys(requests[0]!.headers).sort()).toEqual(["accept", "user-agent"]);
    expect(requests[0]!.headers).not.toHaveProperty("traceparent");
    expect(requests[0]!.headers).not.toHaveProperty("b3");
  });

  test("an http URL is 400 calendar_waste_source_refused and nothing is requested", async () => {
    const { requests, layer } = recordingClient({});
    const error = await failure(layer, FLYER_URL.replace("https:", "http:"));
    expect(error).toMatchObject({ status: 400, code: "calendar_waste_source_refused" });
    expect(requests).toEqual([]);
  });

  test("a foreign host is refused before any request", async () => {
    const { requests, layer } = recordingClient({});
    expect(await failure(layer, "https://example.com/flyer.pdf")).toMatchObject({ status: 400, code: "calendar_waste_source_refused" });
    expect(requests).toEqual([]);
  });

  test("a redirect to the other provider host (relative and absolute) is followed, every hop checked", async () => {
    const second = "https://hattingen.de/files/flyer.pdf";
    const { requests, layer } = recordingClient({
      [FLYER_URL]: redirectTo("/files/moved.pdf"),
      "https://www.hattingen.de/files/moved.pdf": redirectTo(second),
      [second]: pdf,
    });
    const result = await ok(layer);
    expect(result.url).toBe(second);
    expect(requests.map((request) => request.url)).toEqual([FLYER_URL, "https://www.hattingen.de/files/moved.pdf", second]);
    expect(requests.every((request) => request.redirect === "manual")).toBe(true);
  });

  test("a redirect to a foreign host is refused BEFORE it is requested", async () => {
    const { requests, layer } = recordingClient({
      [FLYER_URL]: redirectTo("https://evil.example/flyer.pdf"),
      "https://evil.example/flyer.pdf": pdf,
    });
    expect(await failure(layer)).toMatchObject({ status: 400, code: "calendar_waste_source_refused" });
    expect(requests.map((request) => request.url)).toEqual([FLYER_URL]);
  });

  test("a redirect to http on the same host is refused before it is requested", async () => {
    const { requests, layer } = recordingClient({ [FLYER_URL]: redirectTo("http://www.hattingen.de/x.pdf") });
    expect(await failure(layer)).toMatchObject({ code: "calendar_waste_source_refused" });
    expect(requests.length).toBe(1);
  });

  test("five redirects are followed, a sixth is 502 redirects", async () => {
    const hop = (n: number) => `https://www.hattingen.de/hop/${n}.pdf`;
    const five: Record<string, Answer> = { [FLYER_URL]: redirectTo(hop(1)) };
    for (let n = 1; n < 5; n += 1) five[hop(n)] = redirectTo(hop(n + 1));
    five[hop(5)] = pdf;
    const followed = recordingClient(five);
    expect((await ok(followed.layer)).url).toBe(hop(5));
    expect(followed.requests.length).toBe(1 + CALENDAR_LIMITS.wasteRedirectsMax);

    const six = { ...five, [hop(5)]: redirectTo(hop(6)), [hop(6)]: pdf };
    const refused = recordingClient(six);
    const error = await failure(refused.layer);
    expect(error).toMatchObject({ status: 502, code: "calendar_waste_fetch_failed", details: [{ reason: "redirects" }] });
    expect(refused.requests.length).toBe(6);
  });

  test("a redirect without Location is 502 status", async () => {
    const { layer } = recordingClient({ [FLYER_URL]: () => new Response(null, { status: 302 }) });
    expect(await failure(layer)).toMatchObject({ status: 502, details: [{ reason: "status" }] });
  });

  test("a 404 is 502 status", async () => {
    const { layer } = recordingClient({});
    expect(await failure(layer)).toMatchObject({ status: 502, code: "calendar_waste_fetch_failed", details: [{ reason: "status" }] });
  });

  test("a transport error is 502 network", async () => {
    const { layer } = recordingClient({ [FLYER_URL]: () => "networkError" });
    expect(await failure(layer)).toMatchObject({ status: 502, details: [{ reason: "network" }] });
  });

  test("a Content-Length above 10 MiB is 502 tooLarge (the body is not read)", async () => {
    const { layer } = recordingClient({
      [FLYER_URL]: () =>
        new Response(PDF, { status: 200, headers: { "content-length": String(CALENDAR_LIMITS.wastePdfMaxBytes + 1) } }),
    });
    expect(await failure(layer)).toMatchObject({ status: 502, details: [{ reason: "tooLarge" }] });
  });

  test("a streamed body above 10 MiB without Content-Length is 502 tooLarge (counted while streaming)", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const { layer } = recordingClient({
      [FLYER_URL]: () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              sent += 1;
              if (sent > 64) controller.close();
              else controller.enqueue(chunk);
            },
          }),
          { status: 200 },
        ),
    });
    expect(await failure(layer)).toMatchObject({ status: 502, details: [{ reason: "tooLarge" }] });
    // Cancelled soon after the cap, never read to the end.
    expect(sent).toBeLessThan(20);
  });

  test("exactly 10 MiB is accepted", async () => {
    const body = new Uint8Array(CALENDAR_LIMITS.wastePdfMaxBytes);
    body.set(PDF);
    const { layer } = recordingClient({ [FLYER_URL]: () => new Response(body, { status: 200 }) });
    expect((await ok(layer)).bytes.byteLength).toBe(CALENDAR_LIMITS.wastePdfMaxBytes);
  });

  test("a body that never ends is 502 timeout after 20 s (TestClock)", async () => {
    const { layer } = recordingClient({
      [FLYER_URL]: () => new Response(new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => undefined) }), { status: 200 }),
    });
    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(Effect.flip(fetchWith(layer, FLYER_URL)));
        // Let the request start and its body read begin before the clock moves.
        for (let i = 0; i < 20; i += 1) yield* Effect.yieldNow;
        yield* TestClock.adjust(CALENDAR_LIMITS.wasteTimeoutMs - 1);
        expect(fiber.pollUnsafe()).toBeUndefined();
        yield* TestClock.adjust(2);
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestClock.layer())),
    );
    expect(error).toMatchObject({ status: 502, code: "calendar_waste_fetch_failed", details: [{ reason: "timeout" }] });
  });
});

describe("the production layer under bun test and the seam", () => {
  test("without the seam the runtime's fetch answers 502 network and sends nothing (no test reaches the network)", async () => {
    const error = await runTest(Effect.flip(WasteFlyerFetch.use((service) => service.fetch("hattingen", FLYER_URL))));
    expect(error).toMatchObject({ status: 502, details: [{ reason: "network" }] });
    const refused = await runTest(Effect.flip(WasteFlyerFetch.use((service) => service.fetch("hattingen", "http://x.de/a.pdf"))));
    expect(refused).toMatchObject({ status: 400, code: "calendar_waste_source_refused" });
  });

  test("the seam routes the runtime's fetch through the test fetch, which still checks the URL", async () => {
    setWasteFlyerFetchForTests(makeTestWasteFlyerFetch(new Map([[FLYER_URL, PDF]])));
    const result = await runTest(WasteFlyerFetch.use((service) => service.fetch("hattingen", FLYER_URL)));
    expect(result.bytes).toEqual(PDF);
    const missing = await runTest(Effect.flip(WasteFlyerFetch.use((service) => service.fetch("hattingen", `${FLYER_URL}?v=2`))));
    expect(missing).toMatchObject({ status: 502, details: [{ reason: "status" }] });
    const foreign = await runTest(Effect.flip(WasteFlyerFetch.use((service) => service.fetch("hattingen", "https://example.com/a.pdf"))));
    expect(foreign).toMatchObject({ status: 400 });
  });

  test("layerTest serves the same table as a layer", async () => {
    const result = await ok(WasteFlyerFetch.layerTest(new Map([[FLYER_URL, PDF]])));
    expect(result.bytes).toEqual(PDF);
  });
});
