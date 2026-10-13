import { useCallback } from "react";
import { useRouter, useSearch } from "@tanstack/react-router";

/**
 * Validates a `?next=` redirect target: only same-origin absolute paths are allowed,
 * so an attacker cannot use the login screen as an open redirect.
 *
 * The leading-slash test alone is not enough — the URL parser treats a backslash
 * like a slash for http(s), so `/\evil.com` resolves to `http://evil.com/`, and it
 * strips control characters and spaces, which makes `/%09/evil.com` equivalent.
 * Keep this in sync with `safeNextPath` in apps/api/src/lib/oauth.ts.
 */
export function safeNextPath(value: unknown, fallback = "/"): string {
  if (typeof value !== "string" || value.length === 0) return fallback;
  if (value.length > 200) return fallback;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting them is the point
  if (/[\\\u0000-\u0020\u007f]/.test(value)) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  if (value.startsWith("/login") || value.startsWith("/register")) return fallback;
  return value;
}

/** Loosely-typed access to the current query string (route-independent). */
export function useSearchParams(): Record<string, string | undefined> {
  return useSearch({ strict: false }) as Record<string, string | undefined>;
}

/**
 * Client-side navigation to a runtime string path (e.g. the sanitised `next`
 * parameter), which the typed `navigate({ to })` API cannot express.
 */
export function useGoTo(): (path: string, options?: { replace?: boolean }) => void {
  const router = useRouter();
  return useCallback(
    (path: string, options?: { replace?: boolean }) => {
      if (options?.replace) router.history.replace(path);
      else router.history.push(path);
    },
    [router],
  );
}
