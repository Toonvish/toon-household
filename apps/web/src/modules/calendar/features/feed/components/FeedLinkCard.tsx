import { CalendarPlus, Copy } from "lucide-react";
import { Button, Card, Input, buttonClasses } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { webcalUrl } from "../lib/webcal";

/**
 * The link just created (plan m9 P16): the URL read-only with its copy button, and the prominent `webcal:` link
 * that opens the subscribe dialog of the iPhone's Calendar app. The URL comes from the POST answer the page holds
 * in component state; it is never in the query cache, and this card is the only place it is shown.
 */
export function FeedLinkCard({ url, onCopy }: { url: string; onCopy: (url: string) => void }) {
  const t = useT();
  return (
    <Card as="section" aria-labelledby="calendar-feed-link" className="flex min-w-0 flex-col gap-3">
      <h2 id="calendar-feed-link" className="font-display text-display-md font-medium text-fg">
        {t("calendar.feed.link.title")}
      </h2>
      <p className="text-sm text-fg-muted">{t("calendar.feed.link.once")}</p>
      <div className="flex min-w-0 items-end gap-2">
        <Input
          label={t("calendar.feed.link.label")}
          value={url}
          readOnly
          spellCheck={false}
          autoComplete="off"
          onFocus={(event) => event.currentTarget.select()}
          containerClassName="min-w-0 flex-1"
          data-feed-url
        />
        <Button variant="secondary" leftIcon={<Copy className="size-4" />} onClick={() => onCopy(url)} className="shrink-0">
          {t("calendar.feed.link.copy")}
        </Button>
      </div>
      <a href={webcalUrl(url)} className={buttonClasses({ variant: "primary", size: "lg", fullWidth: true })}>
        <CalendarPlus aria-hidden="true" className="size-5" />
        {t("calendar.feed.link.connect")}
      </a>
    </Card>
  );
}
