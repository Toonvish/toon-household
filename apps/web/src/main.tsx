import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/app";
import { initLocale, translate } from "@/lib/i18n/store.ts";
import { resolveDeviceLocale } from "@/lib/i18n/locale.ts";
import { registerServiceWorker } from "@/lib/pwa";
import { applyTheme, readThemePreference } from "@/lib/theme";
import "@/styles/index.css";

// Apply the stored colour scheme before the first paint.
applyTheme(readThemePreference());
// Seeds the ambient locale store AND <html lang> before the first render —
// `initLocale` (not `applyDocumentLocale` alone), or the store would stay at
// its DEFAULT_LOCALE initialiser while the document read a different locale.
initLocale(resolveDeviceLocale());
// Offline app shell (production only — a SW in front of vite dev breaks HMR).
registerServiceWorker();

const container = document.getElementById("root");
if (!container) throw new Error(translate("common.boot.missingRoot"));

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
