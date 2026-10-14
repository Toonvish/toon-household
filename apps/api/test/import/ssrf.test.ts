/**
 * SSRF guard + guarded fetcher.
 *
 * Offline by construction: private ranges are checked as literals (no DNS), and
 * the redirect cases use a scripted `fetch` plus a stub resolver. The only real
 * DNS lookup in this file is for "localhost", which resolves from /etc/hosts.
 */
import { describe, expect, test } from "bun:test";
import { ApiError } from "../../src/lib/errors.ts";
import { fetchHtml } from "../../src/modules/recipe/services/import/url/fetch.ts";
import {
  SsrfError,
  assertPublicUrl,
  isBlockedHostname,
  isPrivateAddress,
  isPrivateIpv4,
  isPrivateIpv6,
} from "../../src/modules/recipe/services/import/url/ssrf.ts";
import { createResolver, createScriptedFetch, expectApiError } from "./helpers.ts";

const publicResolver = createResolver();

async function reasonFor(url: string, resolve = publicResolver): Promise<string> {
  try {
    await assertPublicUrl(url, { resolve });
    return "ALLOWED";
  } catch (error) {
    return error instanceof SsrfError ? error.reason : `UNEXPECTED:${String(error)}`;
  }
}

describe("private IPv4 detection", () => {
  test.each([
    ["0.0.0.0", true],
    ["10.0.0.1", true],
    ["10.255.255.255", true],
    ["100.64.0.1", true],
    ["127.0.0.1", true],
    ["127.1.2.3", true],
    ["169.254.169.254", true],
    ["172.16.0.1", true],
    ["172.31.255.255", true],
    ["192.0.0.1", true],
    ["192.168.1.1", true],
    ["198.18.0.1", true],
    ["224.0.0.1", true],
    ["255.255.255.255", true],
    ["8.8.8.8", false],
    ["1.1.1.1", false],
    ["172.32.0.1", false],
    ["93.184.216.34", false],
    ["172.15.255.255", false],
  ])("%s -> private=%p", (host, expected) => {
    expect(isPrivateIpv4(host)).toBe(expected);
  });
});

describe("private IPv6 detection", () => {
  test.each([
    ["::1", true],
    ["::", true],
    ["fc00::1", true],
    ["fd12:3456:789a::1", true],
    ["fe80::1%eth0", true],
    ["ff02::1", true],
    ["::ffff:127.0.0.1", true],
    ["::ffff:10.0.0.1", true],
    ["64:ff9b::192.168.0.1", true],
    ["[::1]", true],
    ["2001:4860:4860::8888", false],
    ["::ffff:8.8.8.8", false],
  ])("%s -> private=%p", (host, expected) => {
    expect(isPrivateIpv6(host)).toBe(expected);
  });

  test("isPrivateAddress covers both families", () => {
    expect(isPrivateAddress("10.0.0.1")).toBe(true);
    expect(isPrivateAddress("fe80::1")).toBe(true);
    expect(isPrivateAddress("example.com")).toBe(false);
  });
});

describe("hostname deny-list", () => {
  test.each([
    ["localhost", true],
    ["LOCALHOST", true],
    ["myapp.localhost", true],
    ["printer.local", true],
    ["db.internal", true],
    ["metadata.google.internal", true],
    ["kubernetes.default.svc", true],
    ["api.svc.cluster.local", true],
    ["secret.onion", true],
    ["chefkoch.de", false],
    ["biancazapatka.com", false],
  ])("%s -> blocked=%p", (host, expected) => {
    expect(isBlockedHostname(host)).toBe(expected);
  });
});

describe("assertPublicUrl", () => {
  test("rejects non-http(s) schemes", async () => {
    expect(await reasonFor("file:///etc/passwd")).toBe("bad_scheme");
    expect(await reasonFor("ftp://example.com/x")).toBe("bad_scheme");
    expect(await reasonFor("gopher://example.com/")).toBe("bad_scheme");
    expect(await reasonFor("javascript:alert(1)")).toBe("bad_scheme");
  });

  test("rejects malformed URLs", async () => {
    expect(await reasonFor("not a url")).toBe("invalid_url");
  });

  test("rejects credentials in the URL", async () => {
    expect(await reasonFor("http://user:pass@example.com/")).toBe("credentials_in_url");
  });

  test("rejects localhost and loopback literals", async () => {
    expect(await reasonFor("http://localhost:3001/api/health")).toBe("blocked_host");
    expect(await reasonFor("http://127.0.0.1:8080/")).toBe("private_ip");
    expect(await reasonFor("http://[::1]/")).toBe("private_ip");
  });

  test("rejects the cloud metadata endpoint", async () => {
    expect(await reasonFor("http://169.254.169.254/latest/meta-data/")).toBe("private_ip");
    expect(await reasonFor("http://metadata.google.internal/computeMetadata/v1/")).toBe("blocked_host");
  });

  test("rejects every private IPv4 range", async () => {
    for (const host of ["10.1.2.3", "172.20.0.1", "192.168.0.5", "100.64.1.1"]) {
      expect(await reasonFor(`http://${host}/x`)).toBe("private_ip");
    }
  });

  test("rejects decimal/hex IP obfuscation", async () => {
    // WHATWG URL already normalises 2130706433 and 0x7f000001 to 127.0.0.1, so
    // the literal check catches them; the `suspicious_host` rule is the backstop
    // for forms the parser leaves alone.
    expect(await reasonFor("http://2130706433/")).toBe("private_ip");
    expect(await reasonFor("http://0x7f000001/")).toBe("private_ip");
    // Raw IP literals are refused even when public: a recipe URL is a domain.
    expect(await reasonFor("http://8.8.8.8/recipe")).toBe("suspicious_host");
  });

  test("rejects a public hostname that RESOLVES to a private address", async () => {
    const resolver = createResolver({ "rebind.example": "192.168.13.37" });
    expect(await reasonFor("https://rebind.example/recipe", resolver)).toBe("private_ip");
  });

  test("rejects a host that resolves to a private address on ANY record", async () => {
    const resolver = async (): Promise<Array<{ address: string; family: number }>> => [
      { address: "93.184.216.34", family: 4 },
      { address: "fd00::1", family: 6 },
    ];
    expect(await reasonFor("https://dual.example/x", resolver)).toBe("private_ip");
  });

  test("reports a DNS failure instead of fetching blindly", async () => {
    const resolver = async (): Promise<Array<{ address: string; family: number }>> => {
      throw new Error("ENOTFOUND");
    };
    expect(await reasonFor("https://nope.example/x", resolver)).toBe("dns_failed");
  });

  test("allows a normal public recipe URL", async () => {
    expect(await reasonFor("https://www.chefkoch.de/rezepte/1/x.html")).toBe("ALLOWED");
    expect(await reasonFor("https://biancazapatka.com/de/rezept/")).toBe("ALLOWED");
  });

  test("skipDns allows checking syntax only", async () => {
    const url = await assertPublicUrl("https://whatever.example/x", { skipDns: true });
    expect(url.hostname).toBe("whatever.example");
  });
});

describe("fetchHtml", () => {
  const page = "<html><head><title>OK</title></head><body>Hallo</body></html>";

  test("sends a desktop UA and de-DE Accept-Language", async () => {
    let seenHeaders: Headers | undefined;
    const impl = (async (input: string | URL | Request, init?: RequestInit) => {
      seenHeaders = new Headers(init?.headers);
      void input;
      return new Response(page, { headers: { "content-type": "text/html" } });
    }) as unknown as typeof fetch;

    await fetchHtml("https://ok.example/r", { fetchImpl: impl, resolve: publicResolver });
    expect(seenHeaders?.get("user-agent")).toContain("Mozilla/5.0");
    expect(seenHeaders?.get("accept-language")).toStartWith("de-DE");
  });

  test("returns the decoded HTML and the final URL", async () => {
    const scripted = createScriptedFetch({ "https://ok.example/r": { body: page } });
    const result = await fetchHtml("https://ok.example/r", {
      fetchImpl: scripted.fetch,
      resolve: publicResolver,
    });
    expect(result.html).toContain("Hallo");
    expect(result.url).toBe("https://ok.example/r");
    expect(result.hops).toEqual(["https://ok.example/r"]);
  });

  test("follows a redirect to another PUBLIC host", async () => {
    const scripted = createScriptedFetch({
      "https://old.example/r": { redirectTo: "https://new.example/r" },
      "https://new.example/r": { body: page },
    });
    const result = await fetchHtml("https://old.example/r", {
      fetchImpl: scripted.fetch,
      resolve: publicResolver,
    });
    expect(result.url).toBe("https://new.example/r");
    expect(result.hops).toEqual(["https://old.example/r", "https://new.example/r"]);
  });

  test("BLOCKS a redirect from a public host into the private network", async () => {
    const scripted = createScriptedFetch({
      "https://evil.example/start": { redirectTo: "http://169.254.169.254/latest/meta-data/" },
    });
    const error = await expectApiError(
      fetchHtml("https://evil.example/start", { fetchImpl: scripted.fetch, resolve: publicResolver }),
    );
    expect(error.status).toBe(400);
    expect(error.code).toBe("fetch_failed");
    // The private URL was never requested.
    expect(scripted.requests).toEqual(["https://evil.example/start"]);
  });

  test("BLOCKS a redirect to localhost", async () => {
    const scripted = createScriptedFetch({
      "https://evil.example/start": { redirectTo: "http://localhost:3001/api/auth/me" },
    });
    await expect(
      fetchHtml("https://evil.example/start", { fetchImpl: scripted.fetch, resolve: publicResolver }),
    ).rejects.toThrow(ApiError);
    expect(scripted.requests).toHaveLength(1);
  });

  test("BLOCKS a redirect to a host that resolves privately", async () => {
    const scripted = createScriptedFetch({
      "https://ok.example/start": { redirectTo: "https://inner.example/admin" },
    });
    const resolver = createResolver({ "inner.example": "10.0.0.9" });
    await expect(
      fetchHtml("https://ok.example/start", { fetchImpl: scripted.fetch, resolve: resolver }),
    ).rejects.toThrow(ApiError);
    expect(scripted.requests).toEqual(["https://ok.example/start"]);
  });

  test("resolves a RELATIVE Location against the current hop", async () => {
    const scripted = createScriptedFetch({
      "https://ok.example/a": { redirectTo: "/b" },
      "https://ok.example/b": { body: page },
    });
    const result = await fetchHtml("https://ok.example/a", {
      fetchImpl: scripted.fetch,
      resolve: publicResolver,
    });
    expect(result.url).toBe("https://ok.example/b");
  });

  test("gives up after too many redirects", async () => {
    const scripted = createScriptedFetch({
      "https://loop.example/x": { redirectTo: "https://loop.example/x" },
    });
    const error = await expectApiError(
      fetchHtml("https://loop.example/x", { fetchImpl: scripted.fetch, resolve: publicResolver, maxRedirects: 2 }),
    );
    expect(error.code).toBe("fetch_failed");
    expect(error.text).toBe("server.import.tooManyRedirects");
  });

  test("rejects a non-HTML content type", async () => {
    const scripted = createScriptedFetch({
      "https://ok.example/file.pdf": { body: "%PDF-1.4", headers: { "content-type": "application/pdf" } },
    });
    const error = await expectApiError(
      fetchHtml("https://ok.example/file.pdf", { fetchImpl: scripted.fetch, resolve: publicResolver }),
    );
    expect(error.code).toBe("fetch_failed");
    expect(error.text).toEqual({
      key: "server.import.pageNotHtml",
      values: { contentType: "application/pdf" },
    });
  });

  test("maps a non-2xx response to fetch_failed", async () => {
    const scripted = createScriptedFetch({ "https://ok.example/gone": { status: 404, body: "nope" } });
    const error = await expectApiError(
      fetchHtml("https://ok.example/gone", { fetchImpl: scripted.fetch, resolve: publicResolver }),
    );
    expect(error.status).toBe(400);
    expect(error.code).toBe("fetch_failed");
    expect(error.message).toContain("HTTP 404");
  });

  test("enforces the body size cap via Content-Length", async () => {
    const scripted = createScriptedFetch({
      "https://big.example/r": { body: "x".repeat(100), headers: { "content-length": "9999999" } },
    });
    const error = await expectApiError(
      fetchHtml("https://big.example/r", { fetchImpl: scripted.fetch, resolve: publicResolver, maxBytes: 1000 }),
    );
    expect(error.code).toBe("fetch_failed");
    expect(error.text).toBe("server.import.pageTooLarge");
  });

  test("enforces the body size cap while STREAMING (no Content-Length)", async () => {
    const impl = (async () =>
      new Response("y".repeat(5000), { headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
    const error = await expectApiError(
      fetchHtml("https://big.example/r", { fetchImpl: impl, resolve: publicResolver, maxBytes: 1000 }),
    );
    expect(error.code).toBe("fetch_failed");
    expect(error.text).toBe("server.import.pageTooLarge");
  });

  test("decodes ISO-8859-1 via the charset header", async () => {
    const bytes = new Uint8Array([0x42, 0x72, 0xf6, 0x74]); // "Bröt" in latin1
    const impl = (async () =>
      new Response(bytes, { headers: { "content-type": "text/html; charset=iso-8859-1" } })) as unknown as typeof fetch;
    const result = await fetchHtml("https://latin.example/r", { fetchImpl: impl, resolve: publicResolver });
    expect(result.html).toBe("Bröt");
  });

  test("an SSRF violation on the FIRST hop never issues a request", async () => {
    const scripted = createScriptedFetch({});
    await expect(
      fetchHtml("http://127.0.0.1:9999/secret", { fetchImpl: scripted.fetch, resolve: publicResolver }),
    ).rejects.toThrow(ApiError);
    expect(scripted.requests).toEqual([]);
  });

  test("a network error becomes fetch_failed, not a 500", async () => {
    const impl = (async () => {
      throw new TypeError("connection refused");
    }) as unknown as typeof fetch;
    const error = await expectApiError(fetchHtml("https://down.example/r", { fetchImpl: impl, resolve: publicResolver }));
    expect(error.status).toBe(400);
  });
});
