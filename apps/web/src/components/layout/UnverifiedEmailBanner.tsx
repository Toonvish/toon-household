import { MailWarning } from "lucide-react";
import { useT } from "@/lib/i18n";
import { useEmailVerificationBlock } from "@/lib/session";
import { AppLink } from "@/lib/nav";

/**
 * Always-visible explanation while this account is held read-only for an
 * unconfirmed e-mail address (lib/session.tsx's `useEmailVerificationBlock`).
 *
 * WHY A BANNER AND NOT JUST DISABLED BUTTONS. Every write in the app already
 * disables itself with a `title`, but a disabled button on a touch screen has no
 * hover and therefore no tooltip — on a phone the entire app would simply be
 * inert with no explanation anywhere. So the reason is stated once, at the top of
 * every screen, next to the only thing that fixes it.
 *
 * TALLER THAN `OfflineBanner` on purpose: that one describes a state the user can
 * neither cause nor fix and which usually ends by itself, this one is an
 * instruction. It links to /settings rather than resending inline, because the
 * resend button, its rate limit and its three-state delivery report already live
 * on `EmailVerificationCard` and a second copy would drift.
 */
export function UnverifiedEmailBanner() {
  const t = useT();
  const blocked = useEmailVerificationBlock();
  if (blocked === undefined) return null;

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 bg-warning-soft px-3 py-2 text-center text-xs text-warning-soft-fg"
    >
      <span className="flex items-center gap-2 font-medium">
        <MailWarning className="size-4 shrink-0" aria-hidden="true" />
        {t("common.session.emailUnverifiedBannerTitle")}
      </span>
      <span>{t("common.session.emailUnverifiedBannerBody")}</span>
      <AppLink to="/settings" className="font-medium underline underline-offset-2">
        {t("common.session.emailUnverifiedBannerAction")}
      </AppLink>
    </div>
  );
}
