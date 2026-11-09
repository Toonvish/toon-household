/**
 * The subscription screen's three states (plan m9 P16), rendered to static markup from props alone (no DOM in
 * `bun test`; the closed confirm dialogs render nothing): no link, a link just created (the URL, the webcal link,
 * the setup per platform in the given order) and an existing link (never the URL; the last fetch or none yet).
 * `feedViewState` decides the state from the GET answer and the POST answer.
 */
import { describe, expect, test } from "bun:test";
import type { CalendarFeed, CalendarFeedCreatedResponse } from "@toon/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { formatDateTime } from "@/lib/format";
import { translate } from "@/lib/i18n";
import { FeedView, type FeedViewProps } from "./components/FeedView";
import { ICSX5_FDROID_URL, ICSX5_PLAY_STORE_URL } from "./components/FeedSetupGuide";
import { feedPlatformOrder } from "./lib/platforms";
import { feedViewState, withChosenScope, type FeedViewState } from "./lib/state";

const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE";
const URL_ = `https://haushalt.example.de/api/calendar/feed/${TOKEN}.ics`;
const CREATED_AT = "2026-11-09T10:15:00.000Z";
const created: CalendarFeedCreatedResponse = { url: URL_, scope: "all", createdAt: CREATED_AT, lastUsedAt: null };
const feed = (overrides: Partial<CalendarFeed> = {}): CalendarFeed => ({
  scope: "mine",
  createdAt: CREATED_AT,
  lastUsedAt: null,
  ...overrides,
});

const noop = () => undefined;
const resolved = () => Promise.resolve();

function render(state: FeedViewState, overrides: Partial<FeedViewProps> = {}): string {
  return renderToStaticMarkup(
    <FeedView
      state={state}
      order={feedPlatformOrder("")}
      canMutate
      creating={false}
      savingScope={false}
      onCreate={noop}
      onCopy={noop}
      onScopeChange={noop}
      onRotate={resolved}
      onEnd={resolved}
      {...overrides}
    />,
  );
}

/** The static markup escapes quotes and ampersands; compare against the same escaping. */
function html(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The value of the checked radio (attribute order is React's, so read the tag). */
function checkedScope(markup: string): string | undefined {
  const tag = [...markup.matchAll(/<input type="radio"[^>]*>/g)].map((m) => m[0]).find((t) => t.includes('checked=""'));
  return tag?.match(/value="([a-z]+)"/)?.[1];
}

const has = (markup: string, text: string) => expect(markup).toContain(html(text));
const lacks = (markup: string, text: string) => expect(markup).not.toContain(html(text));

describe("no link", () => {
  const markup = render({ kind: "none" });

  test("the explanation, both scopes with `all` preselected, and the create button", () => {
    has(markup, translate("calendar.feed.intro"));
    has(markup, translate("calendar.feed.scope.all"));
    has(markup, translate("calendar.feed.scope.mine"));
    expect(markup.match(/type="radio"/g)).toHaveLength(2);
    expect(checkedScope(markup)).toBe("all");
    has(markup, translate("calendar.feed.create"));
  });

  test("the privacy note, and no URL, setup steps or management", () => {
    has(markup, translate("calendar.feed.privacy.text"));
    expect(markup).not.toContain("data-feed-url");
    expect(markup).not.toContain("webcal://");
    lacks(markup, translate("calendar.feed.setup.title"));
    lacks(markup, translate("calendar.feed.rotate.action"));
  });

  test("without the right to write the create button is disabled with its reason", () => {
    const blocked = render({ kind: "none" }, { canMutate: false, reason: "Bitte bestätige zuerst deine E-Mail-Adresse." });
    expect(blocked).toMatch(/<button[^>]*disabled=""[^>]*title="Bitte bestätige zuerst deine E-Mail-Adresse\."/);
  });
});

describe("just created", () => {
  const markup = render({ kind: "created", url: URL_, feed: feed({ scope: "all" }) });

  test("the URL read-only with the copy button, and the webcal link", () => {
    expect(markup).toMatch(new RegExp(`<input[^>]*value="${URL_.replace(/[.?]/g, "\\$&")}"[^>]*readOnly=""|<input[^>]*readOnly=""[^>]*value="${URL_.replace(/[.?]/g, "\\$&")}"`));
    has(markup, translate("calendar.feed.link.copy"));
    expect(markup).toContain(`href="webcal://haushalt.example.de/api/calendar/feed/${TOKEN}.ics"`);
    has(markup, translate("calendar.feed.link.connect"));
    has(markup, translate("calendar.feed.privacy.text"));
  });

  test("the setup per platform in the order passed, with both ICSx5 stores", () => {
    const sections = [...markup.matchAll(/data-platform="([a-z]+)"/g)].map((m) => m[1]);
    expect(sections).toEqual(["ios", "android", "google", "desktop"]);
    expect(markup).toContain(`href="${html(ICSX5_PLAY_STORE_URL)}"`);
    expect(markup).toContain(`href="${ICSX5_FDROID_URL}"`);
    has(markup, translate("calendar.feed.setup.google.slow"));

    const android = render(
      { kind: "created", url: URL_, feed: feed() },
      { order: feedPlatformOrder("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile") },
    );
    expect([...android.matchAll(/data-platform="([a-z]+)"/g)].map((m) => m[1])[0]).toBe("android");
  });

  test("the management sits beside it, without the hidden-link hint", () => {
    has(markup, translate("calendar.feed.rotate.action"));
    has(markup, translate("calendar.feed.end.action"));
    has(markup, translate("calendar.feed.manage.neverUsed"));
    lacks(markup, translate("calendar.feed.manage.linkHidden"));
  });
});

describe("existing link", () => {
  test("never the URL; the scope checked, created, and not fetched yet", () => {
    const markup = render({ kind: "existing", feed: feed() });
    expect(markup).not.toContain("data-feed-url");
    expect(markup).not.toContain("webcal://");
    expect(markup).not.toContain("/api/calendar/feed/");
    expect(checkedScope(markup)).toBe("mine");
    has(markup, translate("calendar.feed.manage.created", { date: formatDateTime(CREATED_AT) }));
    has(markup, translate("calendar.feed.manage.neverUsed"));
    has(markup, translate("calendar.feed.manage.linkHidden"));
    has(markup, translate("calendar.feed.rotate.action"));
    has(markup, translate("calendar.feed.end.action"));
  });

  test("with a last fetch: when, and no not-yet line", () => {
    const lastUsedAt = "2026-11-09T12:00:00.000Z";
    const markup = render({ kind: "existing", feed: feed({ lastUsedAt }) });
    has(markup, translate("calendar.feed.manage.lastUsed", { date: formatDateTime(lastUsedAt) }));
    lacks(markup, translate("calendar.feed.manage.neverUsed"));
  });
});

describe("feedViewState", () => {
  test("no link, no POST answer: none", () => {
    expect(feedViewState({ feed: null }, null)).toEqual({ kind: "none" });
  });

  test("a link, no POST answer: existing", () => {
    expect(feedViewState({ feed: feed() }, null)).toEqual({ kind: "existing", feed: feed() });
  });

  test("a POST answer before the refetch (no link yet, or the replaced one): the POST's link with its URL", () => {
    const expected: FeedViewState = { kind: "created", url: URL_, feed: { scope: "all", createdAt: CREATED_AT, lastUsedAt: null } };
    expect(feedViewState({ feed: null }, created)).toEqual(expected);
    expect(feedViewState({ feed: feed({ createdAt: "2026-01-01T00:00:00.000Z", lastUsedAt: "2026-02-01T00:00:00.000Z" }) }, created)).toEqual(expected);
  });

  test("after the refetch the GET answer's values win (a scope change, the first fetch)", () => {
    const live = feed({ scope: "mine", lastUsedAt: "2026-11-09T11:00:00.000Z" });
    expect(feedViewState({ feed: live }, created)).toEqual({ kind: "created", url: URL_, feed: live });
  });
});

describe("withChosenScope", () => {
  test("nothing chosen: the state unchanged", () => {
    const state = feedViewState({ feed: feed({ scope: "mine" }) }, null);
    expect(withChosenScope(state, null)).toBe(state);
  });

  test("a chosen scope overrides the link's scope in both link states, nothing else", () => {
    expect(withChosenScope({ kind: "existing", feed: feed({ scope: "mine" }) }, "all")).toEqual({
      kind: "existing",
      feed: feed({ scope: "all" }),
    });
    expect(withChosenScope({ kind: "created", url: URL_, feed: feed({ scope: "all" }) }, "mine")).toEqual({
      kind: "created",
      url: URL_,
      feed: feed({ scope: "mine" }),
    });
  });

  test("no link: nothing to override", () => {
    expect(withChosenScope({ kind: "none" }, "mine")).toEqual({ kind: "none" });
  });
});
