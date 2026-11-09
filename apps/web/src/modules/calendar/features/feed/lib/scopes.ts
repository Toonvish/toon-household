/**
 * The feed scopes in screen order (plan m9 P9): `all` (every entry of the household) first, `mine` second. The
 * values are the shared contract's; this list only fixes the order the screen offers them in.
 */
import type { CalendarFeedScope } from "@toon/shared";

export type { CalendarFeedScope };

export const CALENDAR_FEED_SCOPES = ["all", "mine"] as const satisfies ReadonlyArray<CalendarFeedScope>;
