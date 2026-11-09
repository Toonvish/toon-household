import type { LocaleCatalog } from "@toon/shared";
import type { CalendarFeedCatalog } from "./feed.de.ts";

export const calendarFeedEn: LocaleCatalog<CalendarFeedCatalog> = {
  "calendar.feed.title": "Calendar feed",
  "calendar.feed.description": "The household's dates in your phone's calendar.",
  "calendar.feed.offline": "The calendar feed needs a connection.",

  "calendar.feed.agendaLink": "Calendar feed",
  "calendar.feed.agendaHint": "Dates in your phone's calendar",

  "calendar.feed.intro":
    "With a feed link, the calendar on your phone shows the household's events, tasks, car bookings and pickup days. It keeps itself up to date. You can't change anything there, only here in the app.",
  "calendar.feed.scope.label": "What should the feed show?",
  "calendar.feed.scope.all": "All of the household's dates",
  "calendar.feed.scope.allHint": "Everything in the calendar.",
  "calendar.feed.scope.mine": "Only my dates",
  "calendar.feed.scope.mineHint": "What concerns everybody, and everything you're down for.",
  "calendar.feed.create": "Create link",
  "calendar.feed.createdToast": "Your feed link is ready.",

  "calendar.feed.privacy.title": "Just for you",
  "calendar.feed.privacy.text":
    "The link is personal and works without a password: whoever has it sees your dates. Don't pass it on. If it got into the wrong hands, create a new one.",

  "calendar.feed.link.title": "Your feed link",
  "calendar.feed.link.label": "Feed link",
  "calendar.feed.link.once": "The link is shown only now. Set up the feed right away or copy it.",
  "calendar.feed.link.copy": "Copy",
  "calendar.feed.link.copied": "Link copied.",
  "calendar.feed.link.copyFailed": "Copying didn't work. Select the link and copy it by hand.",
  "calendar.feed.link.connect": "Connect to iPhone Calendar",

  "calendar.feed.setup.title": "How to set up the feed",
  "calendar.feed.setup.ios.title": "iPhone and iPad",
  "calendar.feed.setup.ios.button": "Tap “Connect to iPhone Calendar”, then “Subscribe”.",
  "calendar.feed.setup.ios.manual":
    "Or by hand: Settings > Calendar > Accounts > Add Account > Other > Add Subscribed Calendar. Paste the link there.",
  "calendar.feed.setup.ios.newer": "From iOS 18, Calendar is under “Apps” in Settings.",
  "calendar.feed.setup.android.title": "Android and Samsung",
  "calendar.feed.setup.android.app": "Install the free app ICSx⁵:",
  "calendar.feed.setup.android.playStore": "Play Store",
  "calendar.feed.setup.android.fdroid": "F-Droid",
  "calendar.feed.setup.android.add": "Open ICSx⁵, tap +, paste the link and choose how often the feed should refresh.",
  "calendar.feed.setup.android.show":
    "Samsung Calendar and Google Calendar then show the dates. If not, turn the calendar on among the calendars shown in the calendar app.",
  "calendar.feed.setup.google.title": "Google Calendar in the browser",
  "calendar.feed.setup.google.steps":
    "Open calendar.google.com, click + next to “Other calendars” on the left, then “From URL”. Paste the link.",
  "calendar.feed.setup.google.slow": "Google picks up changes only every few hours. On a phone, ICSx⁵ is faster.",
  "calendar.feed.setup.desktop.title": "Outlook and Mac",
  "calendar.feed.setup.desktop.steps":
    "Outlook: Add calendar > Subscribe from web. Mac: in the Calendar app, File > New Calendar Subscription. Paste the link in either.",

  "calendar.feed.manage.title": "Your feed",
  "calendar.feed.manage.created": "Created on {date}",
  "calendar.feed.manage.lastUsed": "Last fetched: {date}",
  "calendar.feed.manage.neverUsed": "Not fetched yet",
  "calendar.feed.manage.neverUsedHint": "As soon as your calendar loads the feed for the first time, you'll see when here.",
  "calendar.feed.manage.linkHidden":
    "The link is shown only when it is created. If you need it again, create a new one and set up the feed again with it.",
  "calendar.feed.manage.scopeSaved": "Saved. Your calendar picks it up on its next fetch.",

  "calendar.feed.rotate.action": "Create new link",
  "calendar.feed.rotate.title": "Create a new link?",
  "calendar.feed.rotate.description":
    "The old link stops working at once, on every device. Set up the feed there again with the new link.",
  "calendar.feed.rotate.done": "New link created.",
  "calendar.feed.end.action": "End feed",
  "calendar.feed.end.title": "End the feed?",
  "calendar.feed.end.description":
    "The link stops working at once. Your calendars get no new dates any more; you can delete the feed there.",
  "calendar.feed.end.done": "Feed ended.",
};
