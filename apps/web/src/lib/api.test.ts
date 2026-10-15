/**
 * Path-segment encoding (toon-finance 1715207, gotcha 70): every value interpolated into a URL
 * path goes through `seg()`, so a `/`, `?` or `..%2F` in an id stays inside ONE segment instead
 * of re-targeting the request. The fetchers are driven against a stubbed `fetch`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  createPlaceholderMember,
  fetchHousehold,
  fetchInvitePreview,
  removeHouseholdMember,
  renamePlaceholderMember,
  revokeHouseholdInvite,
  seg,
} from "./api";

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
