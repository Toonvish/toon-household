/**
 * Source pin (toon-finance 1715207): a 401 from any endpoint purges the persisted cache the way
 * `useLogout` does. `SessionProvider` needs a router, so this reads the source: the unauthorized
 * handler must clear the cache user and purge IndexedDB before it navigates to the login screen.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./session.tsx", import.meta.url), "utf8");

function body(start: string, end: string): string {
  const from = source.indexOf(start);
  expect(from).toBeGreaterThan(-1);
  const to = source.indexOf(end, from);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
}

describe("session.tsx 401 handling", () => {
  test("the unauthorized handler clears the cache user and purges before navigating", () => {
    const handler = body("setUnauthorizedHandler((next) => {", "return () => setUnauthorizedHandler(null)");
    const setNull = handler.indexOf("setActiveCacheUser(null)");
    const purge = handler.indexOf("purgePersistedCache()");
    const navigate = handler.indexOf('navigate({ to: "/login"');
    expect(setNull).toBeGreaterThan(-1);
    expect(purge).toBeGreaterThan(setNull);
    expect(navigate).toBeGreaterThan(purge);
  });

  test("useLogout still does the same, and can stay on the page (claim invite)", () => {
    const logout = body("export function useLogout(", "/* guards");
    expect(logout).toContain("setActiveCacheUser(null)");
    expect(logout).toContain("await purgePersistedCache()");
    expect(logout).toContain("stayOnPage");
  });
});
