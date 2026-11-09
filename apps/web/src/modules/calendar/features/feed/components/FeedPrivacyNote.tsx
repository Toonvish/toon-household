import { ShieldAlert } from "lucide-react";
import { Card } from "@/components/ui";
import { useT } from "@/lib/i18n";

/** The link is personal and works without a password (plan m9 P16, section 6 "A leaked link"). */
export function FeedPrivacyNote() {
  const t = useT();
  return (
    <Card as="section" aria-labelledby="calendar-feed-privacy" className="flex h-fit min-w-0 flex-col gap-2">
      <div className="flex items-center gap-2.5">
        <ShieldAlert aria-hidden="true" className="size-5 shrink-0 text-fg-muted" />
        <h2 id="calendar-feed-privacy" className="font-display text-display-sm font-medium text-fg">
          {t("calendar.feed.privacy.title")}
        </h2>
      </div>
      <p className="text-sm text-fg-muted">{t("calendar.feed.privacy.text")}</p>
    </Card>
  );
}
