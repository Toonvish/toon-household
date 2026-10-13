/**
 * Colour scheme handling. Default is "system" (prefers-color-scheme); an explicit
 * choice is stored in localStorage and applied as `data-theme` on <html>, which the
 * CSS variables in styles/theme.css react to.
 */
import { useCallback, useEffect, useState } from "react";
import { readStorage, storageKeys, writeStorage } from "./storage";

export type ThemePreference = "system" | "light" | "dark";

export function readThemePreference(): ThemePreference {
  const stored = readStorage(storageKeys.theme);
  return stored === "light" || stored === "dark" ? stored : "system";
}

/** Applies the preference to the document. Safe to call before React mounts. */
export function applyTheme(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", preference);

  // Keep the browser UI colour in sync with the rendered background.
  const dark =
    preference === "dark" ||
    (preference === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = dark ? "#17120f" : "#faf5ee";
}

export function useTheme(): {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
  resolved: "light" | "dark";
} {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => readThemePreference());
  const [systemDark, setSystemDark] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches,
  );

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);

  useEffect(() => {
    applyTheme(preference);
  }, [preference, systemDark]);

  const setPreference = useCallback((next: ThemePreference) => {
    writeStorage(storageKeys.theme, next === "system" ? null : next);
    setPreferenceState(next);
  }, []);

  return {
    preference,
    setPreference,
    resolved: preference === "system" ? (systemDark ? "dark" : "light") : preference,
  };
}
