import { CalendarSync, ChevronRight } from "lucide-react";
import { useT } from "@/lib/i18n";
import { AppLink } from "@/lib/nav";

/**
 * The way to the subscription screen from the overview (plan m9 P16): the screen is sidebar-only, so the phone
 * reaches it here, below the Today card; from `lg` this row closes the rail.
 */
export function FeedLink() {
  const t = useT();
  return (
    <AppLink
      to="/calendar/feed"
      className="flex min-h-11 min-w-0 items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 text-fg transition-colors duration-150 hover:border-line-strong"
    >
      <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-fg-muted">
        <CalendarSync className="size-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-control font-semibold">{t("calendar.feed.agendaLink")}</span>
        <span className="text-sm text-fg-muted">{t("calendar.feed.agendaHint")}</span>
      </span>
      <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-fg-faint" />
    </AppLink>
  );
}
