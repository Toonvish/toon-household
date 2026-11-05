/**
 * The import client on the web runtime (docs/EFFECT.md E11, E12; plan docs/plans/e6-web-client.md P8, P12, P14):
 * its own request headers (`accept`, no `accept-language`), the failure mapping of `toImportApiError`
 * (a missing reason phrase is plan deviation D4), the schema pass-through, the abort mapping, the source scan's
 * blob type, the tagged `ImportApiError`, and the XHR upload wrapped in `Effect.callback` (driven by a fake).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ImportDraft } from "@toon/shared";
import {
  ImportApiError,
  type ImportErrorKind,
  type ImportErrorText,
  deleteDraft,
  fetchDraftSource,
  getDraft,
  importFromText,
  importFromUrl,
  importImage,
  importPdf,
  isImportApiError,
  listDrafts,
  toImportApiError,
} from "./importApi";

const realFetch = globalThis.fetch;
const realXhr = globalThis.XMLHttpRequest;
const realCreateObjectUrl = URL.createObjectURL;

interface Call {
  url: string;
  method: string;
  headers: Headers;
  body: unknown;
  credentials: RequestCredentials | undefined;
}

let calls: Call[] = [];
let answer: (call: Call) => Response | Promise<Response> = () => new Response(null, { status: 204 });

beforeEach(() => {
  calls = [];
  answer = () => new Response(null, { status: 204 });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: init?.body,
      credentials: init?.credentials,
    };
    calls.push(call);
    return answer(call);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  globalThis.XMLHttpRequest = realXhr;
  URL.createObjectURL = realCreateObjectUrl;
});

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const path = (call: Call | undefined) => {
  if (!call) throw new Error("no request recorded");
  return new URL(call.url).pathname;
};

const DRAFT = { id: "d1", status: "pending" } as unknown as ImportDraft;

describe("the JSON calls", () => {
  test("carry accept and credentials, never accept-language", async () => {
    answer = () => json(200, { draft: DRAFT });
    expect(await importFromUrl("h/1", "https://example.org/r")).toEqual(DRAFT);
    const call = calls[0]!;
    expect(path(call)).toBe("/api/households/h%2F1/recipe/imports/url");
    expect(call.method).toBe("POST");
    expect(call.headers.get("accept")).toBe("application/json");
    expect(call.headers.get("content-type")).toBe("application/json");
    expect(call.headers.has("accept-language")).toBe(false);
    expect(call.headers.has("b3")).toBe(false);
    expect(call.headers.has("traceparent")).toBe(false);
    expect(call.credentials).toBe("include");
    expect(call.body).toBe(JSON.stringify({ url: "https://example.org/r" }));
  });

  test("a GET has no content-type, a text import drops an empty title", async () => {
    answer = () => json(200, { draft: DRAFT });
    await getDraft("h", "d 1");
    expect(path(calls[0])).toBe("/api/households/h/recipe/imports/d%201");
    expect(calls[0]!.headers.has("content-type")).toBe(false);
    await importFromText("h", "raw", "");
    expect(calls[1]!.body).toBe(JSON.stringify({ rawText: "raw" }));
    await importFromText("h", "raw", "T");
    expect(calls[2]!.body).toBe(JSON.stringify({ rawText: "raw", title: "T" }));
  });

  test("the list query string keeps its order", async () => {
    answer = () => json(200, { items: [], total: 0 });
    await listDrafts("h", { status: "pending", limit: 5, offset: 10 });
    expect(new URL(calls[0]!.url).search).toBe("?status=pending&limit=5&offset=10");
  });

  test("a 204 delete resolves with nothing and sends accept", async () => {
    await expect(deleteDraft("h", "d")).resolves.toBeUndefined();
    expect(calls[0]!.method).toBe("DELETE");
    expect(calls[0]!.headers.get("accept")).toBe("application/json");
    expect(calls[0]!.headers.has("accept-language")).toBe(false);
  });

  test("a 4xx envelope becomes the same kind toImportApiError gives", async () => {
    const envelope = { error: { code: "validation_failed", message: "Titel fehlt" } };
    answer = () => json(422, envelope);
    const error = await getDraft("h", "d").catch((e: unknown) => e);
    expect(isImportApiError(error)).toBe(true);
    const expected = toImportApiError(422, envelope);
    const got = error as ImportApiError;
    expect(got.kind).toBe(expected.kind);
    expect(got.kind).toBe("validation");
    expect(got.title).toEqual({ text: "Titel fehlt" });
    expect(got.hint).toEqual(expected.hint);
    expect(got.status).toBe(422);
    expect(got.code).toBe("validation_failed");
  });

  test("the delete path maps its failure too", async () => {
    answer = () => json(404, { error: { code: "not_found" } });
    const error = (await deleteDraft("h", "d").catch((e: unknown) => e)) as ImportApiError;
    expect(error.kind).toBe("not_found");
  });

  test("an unmapped status without a message gives the unknown kind with the catalog headline (D4)", async () => {
    answer = () => new Response(null, { status: 418, statusText: "I'm a teapot" });
    const error = (await getDraft("h", "d").catch((e: unknown) => e)) as ImportApiError;
    expect(error.kind).toBe("unknown");
    expect(error.title).toEqual({ key: "recipe.import.error.unknown.title" });
    expect(error.hint).toEqual({ key: "recipe.import.error.unknown.hint" });
    expect(error.retryable).toBe(true);
  });

  test("an unparseable error body keeps the old internal_error envelope", async () => {
    answer = () => new Response("<html>boom</html>", { status: 502 });
    const error = (await getDraft("h", "d").catch((e: unknown) => e)) as ImportApiError;
    expect(error.kind).toBe("server");
    expect(error.code).toBe("internal_error");
  });

  test("a rejected fetch is the network kind", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const error = (await getDraft("h", "d").catch((e: unknown) => e)) as ImportApiError;
    expect(error.kind).toBe("network");
    expect(error.status).toBe(0);
    expect(error.retryable).toBe(true);
  });

  test("a schema mismatch returns the raw payload instead of failing", async () => {
    const odd = { unexpected: "shape" };
    answer = () => json(200, odd);
    expect(await getDraft("h", "d")).toBeUndefined();
    const raw = await listDrafts("h");
    expect(raw).toEqual(odd as never);
  });

  test("an aborted signal rejects with an AbortError", async () => {
    answer = () => new Promise<Response>(() => {});
    const controller = new AbortController();
    const pending = getDraft("h", "d", controller.signal).catch((e: unknown) => e);
    controller.abort();
    const error = await pending;
    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe("AbortError");
  });
});

describe("fetchDraftSource", () => {
  test("returns the object URL and the content-type as mimeType, with no accept header", async () => {
    URL.createObjectURL = ((blob: Blob) => `blob:test/${blob.type}`) as typeof URL.createObjectURL;
    answer = () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/PNG" } });
    const result = await fetchDraftSource("h", "d");
    expect(result).toEqual({ objectUrl: "blob:test/image/png", mimeType: "image/png" });
    expect(path(calls[0])).toBe("/api/households/h/recipe/imports/d/source");
    expect(calls[0]!.credentials).toBe("include");
    expect(calls[0]!.headers.has("accept-language")).toBe(false);
  });

  test("a failure maps like the JSON calls", async () => {
    answer = () => json(403, { error: { code: "forbidden" } });
    const error = (await fetchDraftSource("h", "d").catch((e: unknown) => e)) as ImportApiError;
    expect(error.kind).toBe("forbidden");
  });

  test("an aborted signal rejects with an AbortError", async () => {
    answer = () => new Promise<Response>(() => {});
    const controller = new AbortController();
    const pending = fetchDraftSource("h", "d", controller.signal).catch((e: unknown) => e);
    controller.abort();
    expect(((await pending) as DOMException).name).toBe("AbortError");
  });
});

describe("ImportApiError", () => {
  const init = {
    kind: "network" as const,
    code: "x",
    status: 0,
    title: { key: "recipe.import.error.network.title" as const },
    hint: { key: "recipe.import.error.network.hint" as const },
    retryable: true,
  };

  test("message is the title key, name and _tag are ImportApiError", () => {
    const error = new ImportApiError(init);
    expect(error.message).toBe("recipe.import.error.network.title");
    expect(error.name).toBe("ImportApiError");
    expect(error._tag).toBe("ImportApiError");
    expect(error).toBeInstanceOf(Error);
    expect(isImportApiError(error)).toBe(true);
    expect(isImportApiError(new Error("x"))).toBe(false);
    expect(error.details).toBeUndefined();
  });

  test("a pass-through title is the message", () => {
    expect(new ImportApiError({ ...init, title: { text: "Titel fehlt" } }).message).toBe("Titel fehlt");
  });
});

/** Every (status, code, message) branch of `toImportApiError` and the kind it must give. */
const TABLE: ReadonlyArray<{ status: number; code?: string; message?: string; kind: ImportErrorKind }> = [
  { status: 0, kind: "network" },
  { status: 401, kind: "unauthorized" },
  { status: 200, code: "unauthorized", kind: "unauthorized" },
  { status: 403, kind: "forbidden" },
  { status: 200, code: "forbidden", kind: "forbidden" },
  { status: 404, kind: "not_found" },
  { status: 200, code: "not_found", kind: "not_found" },
  { status: 413, kind: "too_large" },
  { status: 200, code: "payload_too_large", kind: "too_large" },
  { status: 415, kind: "unsupported_media_type" },
  { status: 200, code: "unsupported_media_type", kind: "unsupported_media_type" },
  { status: 200, code: "pdf_no_text_layer", kind: "pdf_no_text_layer" },
  { status: 200, code: "ocr_failed", kind: "ocr_failed" },
  { status: 200, code: "parse_failed", kind: "no_recipe_data" },
  { status: 200, code: "fetch_failed", kind: "fetch_failed" },
  { status: 504, kind: "ocr_timeout" },
  { status: 408, kind: "ocr_timeout" },
  { status: 200, code: "timeout", kind: "ocr_timeout" },
  { status: 429, kind: "rate_limited" },
  { status: 200, code: "rate_limited", kind: "rate_limited" },
  { status: 422, kind: "validation" },
  { status: 400, kind: "validation" },
  { status: 200, code: "validation_failed", message: "Titel fehlt", kind: "validation" },
  { status: 500, kind: "server" },
  { status: 503, kind: "server" },
  { status: 418, kind: "unknown" },
  { status: 418, message: "Teapot", kind: "unknown" },
];

describe("constructor table", () => {
  test("every branch of toImportApiError builds without throwing and gives its kind", () => {
    for (const row of TABLE) {
      const envelope =
        row.code === undefined && row.message === undefined
          ? undefined
          : { error: { ...(row.code === undefined ? {} : { code: row.code }), ...(row.message === undefined ? {} : { message: row.message }), details: { x: 1 } } };
      let error: ImportApiError | undefined;
      expect(() => {
        error = toImportApiError(row.status, envelope);
      }, `status=${row.status} code=${row.code ?? "-"}`).not.toThrow();
      expect(error?.kind, `status=${row.status} code=${row.code ?? "-"}`).toBe(row.kind);
      expect(error?._tag).toBe("ImportApiError");
      expect(error?.status).toBe(row.status);
      expect(typeof error?.message).toBe("string");
      expect(error?.message.length).toBeGreaterThan(0);
    }
  });

  test("the title text is carried, details optional", () => {
    const withText = toImportApiError(418, { error: { message: "Teapot" } });
    expect(withText.title).toEqual({ text: "Teapot" } satisfies ImportErrorText);
    expect(toImportApiError(500, undefined).details).toBeUndefined();
  });
});

/** A minimal XMLHttpRequest the test drives by hand. */
class FakeXhr {
  static last: FakeXhr | undefined;
  upload: { onprogress?: (e: unknown) => void; onload?: () => void } = {};
  onload?: () => void;
  onerror?: () => void;
  ontimeout?: () => void;
  onabort?: () => void;
  status = 0;
  statusText = "";
  responseText = "";
  headers: Record<string, string> = {};
  timeout = 0;
  withCredentials = false;
  responseType = "";
  method = "";
  url = "";
  sent = false;
  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name.toLowerCase()] = value;
  }
  send() {
    this.sent = true;
  }
  abort() {
    this.onabort?.();
  }
}

const FILE = new File([new Uint8Array([1])], "p.jpg", { type: "image/jpeg" });

describe("the XHR upload", () => {
  beforeEach(() => {
    FakeXhr.last = undefined;
    globalThis.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest;
  });

  test("resolves the draft, reports progress and keeps accept-language and the timeout", async () => {
    const progress: number[] = [];
    let uploaded = 0;
    const pending = importImage("h", FILE, { onProgress: (f) => progress.push(f), onUploadComplete: () => uploaded++ });
    const xhr = FakeXhr.last!;
    expect(xhr.sent).toBe(true);
    expect(xhr.method).toBe("POST");
    expect(new URL(xhr.url).pathname).toBe("/api/households/h/recipe/imports/image");
    expect(xhr.withCredentials).toBe(true);
    expect(xhr.timeout).toBe(240_000);
    expect(xhr.headers.accept).toBe("application/json");
    expect(xhr.headers["accept-language"]).toBeString();
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 4 });
    xhr.upload.onload?.();
    xhr.status = 200;
    xhr.responseText = JSON.stringify({ draft: DRAFT });
    xhr.onload?.();
    expect(await pending).toEqual(DRAFT);
    expect(progress).toEqual([0.25, 1]);
    expect(uploaded).toBe(1);
  });

  test("an error status keeps xhr.statusText as the unknown headline", async () => {
    const pending = importPdf("h", FILE).catch((e: unknown) => e);
    const xhr = FakeXhr.last!;
    xhr.status = 418;
    xhr.statusText = "I'm a teapot";
    xhr.onload?.();
    const error = (await pending) as ImportApiError;
    expect(error.kind).toBe("unknown");
    expect(error.title).toEqual({ text: "I'm a teapot" });
  });

  test("onerror is the network kind", async () => {
    const pending = importImage("h", FILE).catch((e: unknown) => e);
    FakeXhr.last!.onerror?.();
    expect(((await pending) as ImportApiError).kind).toBe("network");
  });

  test("ontimeout is the ocr_timeout kind with the client hint", async () => {
    const pending = importImage("h", FILE, { timeoutMs: 5 }).catch((e: unknown) => e);
    expect(FakeXhr.last!.timeout).toBe(5);
    FakeXhr.last!.ontimeout?.();
    const error = (await pending) as ImportApiError;
    expect(error.kind).toBe("ocr_timeout");
    expect(error.status).toBe(504);
    expect(error.hint).toEqual({ key: "recipe.import.error.ocrTimeoutClient.hint" });
  });

  test("the handle's signal aborts the XHR and rejects with an AbortError", async () => {
    const controller = new AbortController();
    const pending = importImage("h", FILE, { signal: controller.signal }).catch((e: unknown) => e);
    controller.abort();
    const error = await pending;
    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe("AbortError");
  });

  test("a schema mismatch resolves the raw payload", async () => {
    const pending = importImage("h", FILE);
    const xhr = FakeXhr.last!;
    xhr.status = 200;
    xhr.responseText = JSON.stringify({ unexpected: "shape" });
    xhr.onload?.();
    expect(await pending).toBeUndefined();
  });
});
