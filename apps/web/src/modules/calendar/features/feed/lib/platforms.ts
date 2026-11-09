/**
 * The order of the setup sections on the subscription screen (plan m9 P16): the device the screen is open on comes
 * first. Pure: the caller passes `navigator.userAgent` (no `navigator` read here, so tests need no DOM).
 *
 * An iPad in its default desktop mode reports a Mac user agent and gets the desktop order; that order starts with
 * iPhone/iPad anyway, so the iOS steps stay on top (plan m9 section 6, "iPad user agent").
 */

/** The setup sections: iPhone/iPad, Android (ICSx5), Google Calendar on the web, Outlook and the Mac. */
export const FEED_PLATFORMS = ["ios", "android", "google", "desktop"] as const;
export type FeedPlatform = (typeof FEED_PLATFORMS)[number];

const IOS_ORDER: ReadonlyArray<FeedPlatform> = ["ios", "android", "google", "desktop"];
/** On Android Google Calendar is the likely calendar app, so its web steps follow ICSx5. */
const ANDROID_ORDER: ReadonlyArray<FeedPlatform> = ["android", "google", "ios", "desktop"];
const DESKTOP_ORDER: ReadonlyArray<FeedPlatform> = ["ios", "android", "google", "desktop"];

/** Whether the user agent is an iPhone, iPad or iPod touch that says so. */
export function isIosUserAgent(userAgent: string): boolean {
  return /\b(iPhone|iPad|iPod)\b/.test(userAgent);
}

/** Whether the user agent is an Android phone or tablet. */
export function isAndroidUserAgent(userAgent: string): boolean {
  return /\bAndroid\b/i.test(userAgent);
}

/** Every platform exactly once, the device's own first. */
export function feedPlatformOrder(userAgent: string): ReadonlyArray<FeedPlatform> {
  if (isIosUserAgent(userAgent)) return IOS_ORDER;
  if (isAndroidUserAgent(userAgent)) return ANDROID_ORDER;
  return DESKTOP_ORDER;
}
