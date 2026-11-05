/**
 * Path-segment encoding (toon-finance 1715207, security review): every value interpolated into a URL
 * path goes through `seg()`, so a `/`, `?` or `..%2F` in an id stays inside ONE segment instead
 * of re-targeting the request. The fetchers are driven against a stubbed `fetch`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { MAX_UPLOAD_BYTES } from "@toon/shared";
import { Effect, Exit } from "effect";
import {
  ApiError,
  assertUploadSize,
  createHousehold,
  createPlaceholderMember,
  fetchHousehold,
  fetchHouseholds,
  fetchMe,
  isApiError,
  updateProfile,
  uploadForm,
  fetchInvitePreview,
  removeHouseholdMember,
  renamePlaceholderMember,
  revokeHouseholdInvite,
  seg,
  setUnauthorizedHandler,
} from "./api";
import { translate } from "./i18n/store.ts";

const realFetch = globalThis.fetch;
let calls: Array<{ url: string; method: string; body: string | null }> = [];

beforeEach(() => {
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : null,
    });
    return new Response(null, { status: 204 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Path of the first recorded call, without the API origin. */
function pathOf(index = 0): string {
  const call = calls[index];
  if (!call) throw new Error("no request recorded");
  return new URL(call.url).pathname + new URL(call.url).search;
}

describe("seg", () => {
  test("encodes what would leave the segment", () => {
    expect(seg("a/b")).toBe("a%2Fb");
    expect(seg("..%2F")).toBe("..%252F");
    expect(seg("x?y#z")).toBe("x%3Fy%23z");
    expect(seg("plain-uuid-123")).toBe("plain-uuid-123");
  });
});

describe("fetchers keep an id inside one path segment", () => {
  test("household detail", async () => {
    await fetchHousehold("../../auth/me");
    expect(pathOf()).toBe("/api/households/..%2F..%2Fauth%2Fme");
  });

  test("member and invite routes", async () => {
    await removeHouseholdMember("h/1", "u?x");
    await revokeHouseholdInvite("h/1", "i/2");
    expect(pathOf(0)).toBe("/api/households/h%2F1/members/u%3Fx");
    expect(pathOf(1)).toBe("/api/households/h%2F1/invites/i%2F2");
  });

  test("the placeholder routes (ADR 0006)", async () => {
    await createPlaceholderMember("h/1", { displayName: "Anna" });
    await renamePlaceholderMember("h/1", "u/2", { name: "Anna B." });
    expect(calls[0]).toMatchObject({ method: "POST", body: JSON.stringify({ displayName: "Anna" }) });
    expect(pathOf(0)).toBe("/api/households/h%2F1/members");
    expect(calls[1]).toMatchObject({ method: "PATCH", body: JSON.stringify({ name: "Anna B." }) });
    expect(pathOf(1)).toBe("/api/households/h%2F1/members/u%2F2/placeholder");
  });

  test("the invite token of the public preview", async () => {
    await fetchInvitePreview("tok/en");
    expect(pathOf()).toBe("/api/households/invites/tok%2Fen");
  });
});

describe("API_BASE_URL fallback", () => {
  test("a production build without PUBLIC_API_URL is relative (toon-finance gotcha 50)", async () => {
    // Vite inlines `import.meta.env.PROD`, which drops the `http://localhost:3001` literal from the
    // bundle; the CSP's `connect-src 'self'` blocks an absolute base on any other origin.
    const source = await Bun.file(new URL("./api.ts", import.meta.url)).text();
    expect(source).toContain('import.meta.env.PROD ? "" : "http://localhost:3001"');
  });
});

/* -------------------------------------------------------------------------- */
/* E6-T01: the transport on the runtime (plan docs/plans/e6-web-client.md P14) */
/* -------------------------------------------------------------------------- */

/** Replaces the per-test 204 stub with one answer for every request. */
function answer(body: unknown, status = 200): void {
  globalThis.fetch = (async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

/** The rejection of a promise that must reject. */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

const household = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Familie",
  description: null,
  imageUrl: null,
  createdBy: "22222222-2222-4222-8222-222222222222",
  createdAt: "2026-10-16T08:00:00.000Z",
  updatedAt: "2026-10-16T08:00:00.000Z",
  role: "owner" as const,
  memberCount: 2,
  modules: ["recipe", "finance"],
};

describe("responses are decoded with the shared schema (P7, P7a)", () => {
  test("a READ whose body matches decodes to the wire value", async () => {
    answer({ items: [household] });
    expect(await fetchHouseholds()).toEqual({ items: [household] });
  });

  test("a READ whose body fails the decode is invalid_response with the 2xx status", async () => {
    answer({ items: [{ ...household, id: 42 }] });
    const error = await rejectionOf(fetchHouseholds());
    expect(isApiError(error)).toBe(true);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      _tag: "ApiError",
      name: "ApiError",
      code: "invalid_response",
      status: 200,
      message: translate("common.error.unknown"),
    });
    expect(typeof (error as ApiError).details).toBe("string");
  });

  test("a READ with an unknown literal is invalid_response too (structure and types are checked)", async () => {
    answer({ items: [{ ...household, role: "superuser" }] }, 203);
    expect(await rejectionOf(fetchHouseholds())).toMatchObject({ code: "invalid_response", status: 203 });
  });

  test("a READ that violates only the checks (UUID pattern, ranges) decodes (disableChecks)", async () => {
    // A legacy or placeholder row the server stored before a check tightened must still render.
    const legacy = { ...household, id: "legacy-17", createdBy: "not-a-uuid", createdAt: "gestern", memberCount: -1 };
    answer({ items: [legacy] });
    expect(await fetchHouseholds()).toEqual({ items: [legacy] });
  });

  test("a WRITE whose response fails the decode resolves the raw payload (the server applied it)", async () => {
    const payload = { household: { id: 7, surprise: true } };
    answer(payload, 201);
    expect(await createHousehold({ name: "Neu" })).toEqual(payload as never);
    answer({ unexpected: "shape" });
    expect(await updateProfile({ name: "Anna" })).toEqual({ unexpected: "shape" } as never);
  });

  test("a 204 resolves undefined without decoding", async () => {
    expect(await fetchHousehold("h1")).toBeUndefined();
  });
});

describe("the 401 hook (P10)", () => {
  const realWindow = (globalThis as { window?: unknown }).window;

  afterEach(() => {
    setUnauthorizedHandler(null);
    (globalThis as { window?: unknown }).window = realWindow;
  });

  test("a 401 on a guarded endpoint calls the handler once with the current path; fetchMe does not", async () => {
    const seen: string[] = [];
    setUnauthorizedHandler((next) => seen.push(next));
    (globalThis as { window?: unknown }).window = {
      location: { pathname: "/households", search: "?tab=members", hash: "#top", assign: () => {} },
    };
    answer({ error: { code: "unauthorized", message: "Bitte anmelden." } }, 401);

    const error = await rejectionOf(fetchMe());
    expect(error).toMatchObject({ code: "unauthorized", status: 401 });
    expect(seen).toEqual([]);

    const guarded = await rejectionOf(fetchHouseholds());
    expect(isApiError(guarded) && guarded.isUnauthorized).toBe(true);
    expect(seen).toEqual(["/households?tab=members#top"]);
  });
});

describe("network failures and aborts (P4, P6)", () => {
  test("a rejected fetch is network_error with status 0 and the cause as details", async () => {
    const cause = new TypeError("Failed to fetch");
    globalThis.fetch = (async () => {
      throw cause;
    }) as unknown as typeof fetch;
    const error = await rejectionOf(fetchHouseholds());
    expect(error).toMatchObject({
      _tag: "ApiError",
      code: "network_error",
      status: 0,
      message: translate("common.error.network"),
    });
    expect((error as ApiError).details).toBe(cause);
    expect((error as ApiError).isOffline).toBe(true);
  });

  test("an already aborted signal rejects with an AbortError", async () => {
    const controller = new AbortController();
    controller.abort();
    const error = await rejectionOf(fetchHouseholds({ signal: controller.signal }));
    expect((error as Error).name).toBe("AbortError");
    expect(isApiError(error)).toBe(false);
  });

  test("aborting in flight cancels the request and rejects with an AbortError", async () => {
    let requestSignal: AbortSignal | undefined;
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        requestSignal = init?.signal ?? undefined;
        requestSignal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      })) as unknown as typeof fetch;
    const controller = new AbortController();
    const pending = rejectionOf(fetchHouseholds({ signal: controller.signal }));
    await Bun.sleep(5);
    controller.abort();
    const error = await pending;
    expect((error as Error).name).toBe("AbortError");
    expect(requestSignal?.aborted).toBe(true);
  });
});

describe("what reaches fetch (P2, P3)", () => {
  test("headers, credentials and the JSON body; no trace headers", async () => {
    const seen: Array<{ headers: Headers; credentials: RequestCredentials | undefined; body: unknown }> = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ headers: new Headers(init?.headers), credentials: init?.credentials, body: init?.body });
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    await createPlaceholderMember("h1", { displayName: "Anna" });
    await fetchHousehold("h1");

    const [write, read] = seen;
    expect(write?.headers.get("accept")).toBe("application/json");
    expect(write?.headers.get("accept-language")).toBe("de");
    expect(write?.headers.get("content-type")).toBe("application/json");
    expect(write?.credentials).toBe("include");
    expect(write?.body).toBe(JSON.stringify({ displayName: "Anna" }));
    expect(read?.headers.get("content-type")).toBeNull();
    expect(read?.credentials).toBe("include");
    for (const call of seen) {
      expect(call.headers.get("b3")).toBeNull();
      expect(call.headers.get("traceparent")).toBeNull();
      expect([...call.headers.keys()].sort()).toEqual(
        call === write ? ["accept", "accept-language", "content-type"] : ["accept", "accept-language"],
      );
    }
  });
});

describe("the upload cap (P11)", () => {
  const big = new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], "gross.jpg", { type: "image/jpeg" });
  const small = new File([new Uint8Array(10)], "klein.jpg", { type: "image/jpeg" });

  test("assertUploadSize throws payload_too_large", () => {
    let thrown: unknown;
    try {
      assertUploadSize(big);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ _tag: "ApiError", code: "payload_too_large", status: 413 });
    expect((thrown as ApiError).message).toBe(
      translate("common.upload.tooLarge", { filename: "gross.jpg", size: ((MAX_UPLOAD_BYTES + 1) / (1024 * 1024)).toFixed(1) }),
    );
  });

  test("uploadForm fails inside the effect with the same error, and builds the form otherwise", async () => {
    const exit = await Effect.runPromiseExit(uploadForm(big));
    expect(Exit.isFailure(exit)).toBe(true);
    const error = await rejectionOf(Effect.runPromise(uploadForm(big)));
    expect(error).toMatchObject({ _tag: "ApiError", code: "payload_too_large", status: 413 });
    const form = await Effect.runPromise(uploadForm(small));
    expect((form.get("file") as File).name).toBe("klein.jpg");
  });
});

describe("error responses (P4)", () => {
  test("an error envelope gives its code, message and details", async () => {
    answer({ error: { code: "member_has_ledger", message: "Gebucht.", details: { slot: 2 } } }, 409);
    const error = await rejectionOf(fetchHouseholds());
    expect(error).toMatchObject({ code: "member_has_ledger", status: 409, message: "Gebucht.", details: { slot: 2 } });
    expect(isApiError(error) && error.isClientError).toBe(true);
  });

  test("a 500 without an envelope is internal_error with the server-error text", async () => {
    answer("<html>Bad Gateway</html>", 500);
    const error = await rejectionOf(fetchHouseholds());
    expect(error).toMatchObject({
      code: "internal_error",
      status: 500,
      message: translate("common.error.serverError"),
    });
    expect(isApiError(error) && error.isClientError).toBe(false);
  });

  test("a 4xx without an envelope keeps its fallbacks", async () => {
    answer("", 404);
    expect(await rejectionOf(fetchHouseholds())).toMatchObject({
      code: "not_found",
      status: 404,
      message: translate("common.error.notFound"),
    });
    answer("plain refusal", 400);
    expect(await rejectionOf(fetchHouseholds())).toMatchObject({ code: "bad_request", message: "plain refusal" });
  });
});

describe("the ApiError constructor never throws on a shape the code produces (P5)", () => {
  const shapes: Array<{ label: string; input: ConstructorParameters<typeof ApiError>[0] }> = [
    { label: "envelope", input: { code: "conflict", status: 409, message: "Konflikt", details: [{ path: ["a"] }] } },
    { label: "envelope without details", input: { code: "forbidden", status: 403, message: "Nein", details: undefined } },
    { label: "fallback 500", input: { code: "internal_error", status: 500, message: "Serverfehler" } },
    { label: "network_error with an Error", input: { code: "network_error", status: 0, message: "Offline", details: new Error("x") } },
    {
      label: "network_error with a TypeError",
      input: { code: "network_error", status: 0, message: "Offline", details: new TypeError("Failed to fetch") },
    },
    { label: "network_error with undefined", input: { code: "network_error", status: 0, message: "Offline", details: undefined } },
    { label: "payload_too_large", input: { code: "payload_too_large", status: 413, message: "Zu groß" } },
    { label: "invalid_response", input: { code: "invalid_response", status: 200, message: "Unbekannt", details: "Expected string" } },
    { label: "an empty message", input: { code: "client_error", status: 0, message: "" } },
  ];

  for (const { label, input } of shapes) {
    test(label, () => {
      const error = new ApiError(input);
      expect(error._tag).toBe("ApiError");
      expect(error.name).toBe("ApiError");
      expect(error.message).toBe(input.message);
      expect(error.status).toBe(input.status);
      expect(error.code).toBe(input.code);
      expect(error.details).toBe(input.details);
      expect(error).toBeInstanceOf(Error);
      expect(isApiError(error)).toBe(true);
    });
  }

  test("the getters keep their meaning", () => {
    const offline = new ApiError({ code: "network_error", status: 0, message: "" });
    expect([offline.isOffline, offline.isClientError]).toEqual([true, false]);
    const notFound = new ApiError({ code: "not_found", status: 404, message: "" });
    expect([notFound.isNotFound, notFound.isClientError, notFound.isForbidden, notFound.isUnauthorized]).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(new ApiError({ code: "forbidden", status: 403, message: "" }).isForbidden).toBe(true);
    expect(isApiError({ code: "x", status: 1, message: "" })).toBe(false);
  });
});
