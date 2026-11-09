/**
 * Which of the three states the subscription screen shows (plan m9 P16), from the GET answer and the POST answer
 * the page holds in component state:
 * - `none`: no link yet;
 * - `created`: a link was created (or replaced) on this visit, so its URL is known and shown with the setup steps;
 * - `existing`: a link exists but its URL is not known (the server keeps only the token's hash).
 *
 * Until the refetch after a POST lands, the GET answer may still be the replaced link (or `null`): the link of the
 * POST answer wins then. Once the GET answer shows the same link (same `createdAt`), its values win, so a later
 * scope change or the first fetch by a phone shows up.
 */
import type { CalendarFeed, CalendarFeedCreatedResponse, CalendarFeedResponse } from "@toon/shared";

export type FeedViewState =
  | { readonly kind: "none" }
  | { readonly kind: "created"; readonly url: string; readonly feed: CalendarFeed }
  | { readonly kind: "existing"; readonly feed: CalendarFeed };

export function feedViewState(data: CalendarFeedResponse, created: CalendarFeedCreatedResponse | null): FeedViewState {
  if (created !== null) {
    const feed =
      data.feed !== null && data.feed.createdAt === created.createdAt
        ? data.feed
        : { scope: created.scope, createdAt: created.createdAt, lastUsedAt: created.lastUsedAt };
    return { kind: "created", url: created.url, feed };
  }
  return data.feed === null ? { kind: "none" } : { kind: "existing", feed: data.feed };
}
