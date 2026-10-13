import { Share2, Smartphone, X } from "lucide-react";
import { useT } from "@/lib/i18n";
import { useInstallPrompt } from "@/lib/pwa";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";

/**
 * "Zur Startseite hinzufügen" banner.
 * Chromium/Android: triggers the native install prompt.
 * iOS Safari (no prompt event): explains the Teilen -> Zum Home-Bildschirm route.
 * Dismissal is remembered for 14 days.
 *
 * THE COPY MUST NOT OVERPROMISE — OR UNDERPROMISE. It used to say "Rezepte brauchen
 * weiterhin eine Verbindung", which was true while `runtimeCaching` was empty. Then
 * read-only offline support shipped (lib/persist.ts + the workbox rules in
 * vite.config.ts) and it was changed to promise *already opened* recipes and no
 * editing. The shopping list has since become editable offline
 * (features/shopping/lib/offline.ts), so the text now names that exception too:
 * claiming "Bearbeiten braucht Internet" would send someone to a supermarket without
 * the one feature built for it. If any of those halves changes, change this text in the
 * same commit.
 */
export function InstallPrompt() {
  const install = useInstallPrompt();
  const t = useT();

  if (!install.shouldShow) return null;

  return (
    <div className="mb-4 flex items-start gap-3 rounded-card border border-brand/30 bg-brand-soft p-3 text-brand-soft-fg">
      <span aria-hidden="true" className="mt-0.5 shrink-0">
        <Smartphone className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{t("common.installPrompt.heading")}</p>
        {install.canPrompt ? (
          <>
            <p className="mt-0.5 text-sm opacity-90">{t("common.installPrompt.description")}</p>
            <Button
              size="sm"
              className="mt-2"
              onClick={() => {
                void install.promptInstall();
              }}
            >
              {t("common.installPrompt.cta")}
            </Button>
          </>
        ) : (
          <p className="mt-0.5 flex flex-wrap items-center gap-1 text-sm opacity-90">
            {t("common.installPrompt.iosHint.before")}
            <Share2 className="inline size-4" aria-label={t("common.installPrompt.shareIconLabel")} />
            {t("common.installPrompt.iosHint.after")}
          </p>
        )}
      </div>
      <IconButton
        label={t("common.installPrompt.dismiss")}
        icon={<X />}
        size="sm"
        onClick={install.dismiss}
        className="-mt-1 -mr-1"
      />
    </div>
  );
}
