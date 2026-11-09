import { ExternalLink } from "lucide-react";
import { Card } from "@/components/ui";
import { useT } from "@/lib/i18n";
import type { FeedPlatform } from "../lib/platforms";

/** ICSx5 in the two stores (plan m9 P16). */
export const ICSX5_PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=at.bitfire.icsdroid";
export const ICSX5_FDROID_URL = "https://f-droid.org/packages/at.bitfire.icsdroid/";

/**
 * How to subscribe, one section per platform in the order the page passes (`feedPlatformOrder` of the user agent,
 * plan m9 P16): iPhone/iPad, Android with ICSx5, Google Calendar on the web (with its slow refresh), Outlook and the
 * Mac in one line.
 */
export function FeedSetupGuide({ order }: { order: ReadonlyArray<FeedPlatform> }) {
  const t = useT();
  return (
    <Card as="section" aria-labelledby="calendar-feed-setup" className="flex min-w-0 flex-col gap-4">
      <h2 id="calendar-feed-setup" className="font-display text-display-md font-medium text-fg">
        {t("calendar.feed.setup.title")}
      </h2>
      {order.map((platform) => (
        <section key={platform} data-platform={platform} aria-labelledby={`calendar-feed-setup-${platform}`} className="flex min-w-0 flex-col gap-1.5">
          <h3 id={`calendar-feed-setup-${platform}`} className="text-item font-semibold text-fg">
            {t(`calendar.feed.setup.${platform}.title`)}
          </h3>
          <PlatformSteps platform={platform} />
        </section>
      ))}
    </Card>
  );
}

function PlatformSteps({ platform }: { platform: FeedPlatform }) {
  const t = useT();
  const text = "text-sm text-fg-muted";
  const link = "inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand hover:underline";
  switch (platform) {
    case "ios":
      return (
        <>
          <p className={text}>{t("calendar.feed.setup.ios.button")}</p>
          <p className={text}>{t("calendar.feed.setup.ios.manual")}</p>
          <p className={text}>{t("calendar.feed.setup.ios.newer")}</p>
        </>
      );
    case "android":
      return (
        <>
          <p className={text}>{t("calendar.feed.setup.android.app")}</p>
          <div className="flex flex-wrap gap-x-5">
            <a href={ICSX5_PLAY_STORE_URL} target="_blank" rel="noopener noreferrer" className={link}>
              {t("calendar.feed.setup.android.playStore")}
              <ExternalLink aria-hidden="true" className="size-3.5" />
            </a>
            <a href={ICSX5_FDROID_URL} target="_blank" rel="noopener noreferrer" className={link}>
              {t("calendar.feed.setup.android.fdroid")}
              <ExternalLink aria-hidden="true" className="size-3.5" />
            </a>
          </div>
          <p className={text}>{t("calendar.feed.setup.android.add")}</p>
          <p className={text}>{t("calendar.feed.setup.android.show")}</p>
        </>
      );
    case "google":
      return (
        <>
          <p className={text}>{t("calendar.feed.setup.google.steps")}</p>
          <p className={text}>{t("calendar.feed.setup.google.slow")}</p>
        </>
      );
    case "desktop":
      return <p className={text}>{t("calendar.feed.setup.desktop.steps")}</p>;
  }
}
