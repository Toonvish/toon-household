import type { CalendarFeed } from "@toon/shared";
import { RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button, Card, ConfirmDialog } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { useT } from "@/lib/i18n";
import type { CalendarFeedScope } from "../lib/scopes";
import { ScopeChoice } from "./ScopeChoice";

/**
 * An existing link (plan m9 P16): the scope (a change is saved at once, the token stays), when it was created, the
 * last fetch by a subscribed calendar (the proof that a phone subscribed), and the two confirmed actions: a new
 * link (the old one stops on every device) and ending the feed.
 */
export function FeedManageCard({
  feed,
  showLinkHint,
  canMutate,
  reason,
  savingScope,
  onScopeChange,
  onRotate,
  onEnd,
}: {
  feed: CalendarFeed;
  /** The "the link is shown only once" hint, when the page shows no URL above. */
  showLinkHint: boolean;
  canMutate: boolean;
  reason?: string | undefined;
  savingScope: boolean;
  onScopeChange: (scope: CalendarFeedScope) => void;
  /** Resolve when done, reject to keep the dialog open (`ConfirmDialog`). */
  onRotate: () => Promise<unknown>;
  onEnd: () => Promise<unknown>;
}) {
  const t = useT();
  const [confirm, setConfirm] = useState<"rotate" | "end" | null>(null);
  return (
    <Card as="section" aria-labelledby="calendar-feed-manage" className="flex h-fit min-w-0 flex-col gap-4">
      <h2 id="calendar-feed-manage" className="font-display text-display-md font-medium text-fg">
        {t("calendar.feed.manage.title")}
      </h2>
      <div className="flex flex-col gap-1 text-sm">
        <p className="font-semibold text-fg" data-feed-last-used>
          {feed.lastUsedAt === null
            ? t("calendar.feed.manage.neverUsed")
            : t("calendar.feed.manage.lastUsed", { date: formatDateTime(feed.lastUsedAt) })}
        </p>
        {feed.lastUsedAt === null ? <p className="text-fg-muted">{t("calendar.feed.manage.neverUsedHint")}</p> : null}
        <p className="text-fg-muted" data-feed-created>
          {t("calendar.feed.manage.created", { date: formatDateTime(feed.createdAt) })}
        </p>
      </div>
      <ScopeChoice
        name="calendar-feed-scope"
        value={feed.scope}
        onChange={onScopeChange}
        disabled={!canMutate || savingScope}
      />
      {showLinkHint ? <p className="text-sm text-fg-muted">{t("calendar.feed.manage.linkHidden")}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          leftIcon={<RefreshCw className="size-4" />}
          disabled={!canMutate}
          title={reason}
          onClick={() => setConfirm("rotate")}
        >
          {t("calendar.feed.rotate.action")}
        </Button>
        <Button
          variant="ghost"
          leftIcon={<Trash2 className="size-4" />}
          disabled={!canMutate}
          title={reason}
          onClick={() => setConfirm("end")}
        >
          {t("calendar.feed.end.action")}
        </Button>
      </div>
      <ConfirmDialog
        open={confirm === "rotate"}
        onClose={() => setConfirm(null)}
        onConfirm={onRotate}
        title={t("calendar.feed.rotate.title")}
        description={t("calendar.feed.rotate.description")}
        confirmLabel={t("calendar.feed.rotate.action")}
        cancelLabel={t("calendar.common.cancel")}
      />
      <ConfirmDialog
        open={confirm === "end"}
        onClose={() => setConfirm(null)}
        onConfirm={onEnd}
        title={t("calendar.feed.end.title")}
        description={t("calendar.feed.end.description")}
        confirmLabel={t("calendar.feed.end.action")}
        cancelLabel={t("calendar.common.cancel")}
        destructive
      />
    </Card>
  );
}
