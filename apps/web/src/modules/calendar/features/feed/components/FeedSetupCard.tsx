import { CalendarSync } from "lucide-react";
import { useState } from "react";
import { Button, Card } from "@/components/ui";
import { useT } from "@/lib/i18n";
import type { CalendarFeedScope } from "../lib/scopes";
import { ScopeChoice } from "./ScopeChoice";

/** No link yet (plan m9 P16): one paragraph, the scope, "Link erstellen". */
export function FeedSetupCard({
  onCreate,
  creating,
  canMutate,
  reason,
}: {
  onCreate: (scope: CalendarFeedScope) => void;
  creating: boolean;
  canMutate: boolean;
  reason?: string | undefined;
}) {
  const t = useT();
  const [scope, setScope] = useState<CalendarFeedScope>("all");
  return (
    <Card as="section" aria-labelledby="calendar-feed-setup-card" className="flex min-w-0 flex-col gap-4">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-fg-muted">
          <CalendarSync className="size-5" />
        </span>
        <h2 id="calendar-feed-setup-card" className="font-display text-display-md font-medium text-fg">
          {t("calendar.feed.title")}
        </h2>
      </div>
      <p className="text-sm text-fg-muted">{t("calendar.feed.intro")}</p>
      <ScopeChoice name="calendar-feed-scope-new" value={scope} onChange={setScope} disabled={creating} />
      <Button className="self-start" loading={creating} disabled={!canMutate} title={reason} onClick={() => onCreate(scope)}>
        {t("calendar.feed.create")}
      </Button>
    </Card>
  );
}
