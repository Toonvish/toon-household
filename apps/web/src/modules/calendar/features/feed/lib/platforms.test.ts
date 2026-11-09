/** The setup sections follow the device (plan m9 P16): iOS first on iPhone/iPad, Android first on Android. */
import { describe, expect, test } from "bun:test";
import { FEED_PLATFORMS, feedPlatformOrder } from "./platforms";

const UA = {
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  ipad: "Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1",
  androidPhone:
    "Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  androidTablet:
    "Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  samsungBrowser:
    "Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  macos:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  linux: "Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0",
} as const;

describe("feedPlatformOrder", () => {
  test.each([
    ["iphone", UA.iphone, "ios"],
    ["ipad", UA.ipad, "ios"],
    ["android phone", UA.androidPhone, "android"],
    ["android tablet", UA.androidTablet, "android"],
    ["samsung internet", UA.samsungBrowser, "android"],
    ["windows", UA.windows, "ios"],
    ["macos (also an iPad in desktop mode)", UA.macos, "ios"],
    ["linux", UA.linux, "ios"],
    ["empty", "", "ios"],
  ] as const)("%s puts %s… first", (_name, userAgent, first) => {
    expect(feedPlatformOrder(userAgent)[0]).toBe(first);
  });

  test("Android: ICSx5, then Google Calendar on the web", () => {
    expect(feedPlatformOrder(UA.androidPhone)).toEqual(["android", "google", "ios", "desktop"]);
  });

  test("iOS and the desktop keep the natural order", () => {
    expect(feedPlatformOrder(UA.iphone)).toEqual(["ios", "android", "google", "desktop"]);
    expect(feedPlatformOrder(UA.windows)).toEqual(["ios", "android", "google", "desktop"]);
  });

  test("every order lists every platform exactly once", () => {
    for (const userAgent of Object.values(UA)) {
      const order = feedPlatformOrder(userAgent);
      expect([...order].sort()).toEqual([...FEED_PLATFORMS].sort());
    }
  });

  test("a Linux desktop is not Android", () => {
    expect(feedPlatformOrder(UA.linux)[0]).not.toBe("android");
  });
});
