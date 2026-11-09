/**
 * The subscription screen (`/calendar/feed`, plan m9 P16, P17; ADR 0017): the member's OWN link for the phone
 * calendar. Three states (`feedViewState`): no link, a link created on this visit (its URL, the webcal button and the
 * setup per platform), an existing link (scope, created, last fetch, a new link, end). Sidebar-only; the phone
 * reaches it from the overview. No header action.
 *
 * THE URL CARRIES THE TOKEN: it arrives only in the POST answer and lives in this component's state, never in the
 * query cache (the GET answer has no URL). Leaving the screen forgets it; a new link is the way to see one again.
 */
import { useQuery } from "@tanstack/react-query";
import type { CalendarFeedCreatedResponse } from "@toon/shared";
import { useMemo, useState } from "react";
import { ErrorState, Skeleton, useToast } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { useCanMutate } from "@/lib/session";
import { copyToClipboard } from "@/lib/share";
import { CalendarPageHeader } from "@/modules/calendar/components/CalendarPageHeader";
import { useCalendarContext } from "@/modules/calendar/lib/hooks";
import { feedQuery, useCreateFeed, useDeleteFeed, useOfflineGuard, useUpdateFeed } from "@/modules/calendar/lib/queries";
import { FeedView } from "./components/FeedView";
import { feedPlatformOrder } from "./lib/platforms";
import type { CalendarFeedScope } from "./lib/scopes";
import { feedViewState, withChosenScope } from "./lib/state";

/** Rejects a confirm dialog's action without a toast of its own: the offline guard already showed one. */
class OfflineRefusal {
  readonly reason = "offline";
}

export function FeedPage() {
  const t = useT();
  const toast = useToast();
  const { householdId } = useCalendarContext();
  const { canMutate, reason } = useCanMutate();
  const guard = useOfflineGuard();
  const query = useQuery(feedQuery(householdId));
  const create = useCreateFeed(householdId);
  const update = useUpdateFeed(householdId);
  const remove = useDeleteFeed(householdId);
  const [created, setCreated] = useState<CalendarFeedCreatedResponse | null>(null);
  // The scope just chosen, shown until its PATCH and the refetch after it settle (`withChosenScope`).
  const [chosenScope, setChosenScope] = useState<CalendarFeedScope | null>(null);
  const order = useMemo(() => feedPlatformOrder(typeof navigator === "undefined" ? "" : navigator.userAgent), []);

  function onCreate(scope: CalendarFeedScope) {
    create.mutate(
      { scope },
      {
        onSuccess: (answer) => {
          setCreated(answer);
          toast.success(t("calendar.feed.createdToast"));
        },
        onError: (error) => toast.fromError(error),
      },
    );
  }

  function onCopy(url: string) {
    void copyToClipboard(url).then((ok) =>
      ok ? toast.success(t("calendar.feed.link.copied")) : toast.error(t("calendar.feed.link.copyFailed")),
    );
  }

  function onScopeChange(scope: CalendarFeedScope) {
    if (!guard()) return;
    setChosenScope(scope);
    update.mutate(
      { scope },
      {
        onSuccess: () => toast.success(t("calendar.feed.manage.scopeSaved")),
        onError: (error) => toast.fromError(error),
        // Runs after the mutation's own onSettled, which awaits the refetch: the GET answer shows the scope by then.
        onSettled: () => setChosenScope(null),
      },
    );
  }

  async function confirmed<T>(run: () => Promise<T>, done: (value: T) => void): Promise<T> {
    if (!guard()) throw new OfflineRefusal();
    try {
      const value = await run();
      done(value);
      return value;
    } catch (error) {
      toast.fromError(error);
      throw error;
    }
  }

  const onRotate = (scope: CalendarFeedScope) => () =>
    confirmed(
      () => create.mutateAsync({ scope }),
      (answer) => {
        setCreated(answer);
        toast.success(t("calendar.feed.rotate.done"));
      },
    );

  const onEnd = () =>
    confirmed(
      () => remove.mutateAsync(),
      () => {
        setCreated(null);
        toast.success(t("calendar.feed.end.done"));
      },
    );

  const header = <CalendarPageHeader title={t("calendar.feed.title")} description={t("calendar.feed.description")} />;

  if (query.isPending) {
    return (
      <div className="flex flex-col">
        {header}
        {query.fetchStatus === "paused" ? (
          <p className="text-sm text-fg-muted">{t("calendar.feed.offline")}</p>
        ) : (
          <Skeleton lines={5} />
        )}
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="flex flex-col">
        {header}
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </div>
    );
  }

  const state = feedViewState(query.data, created);
  const feed = state.kind === "none" ? null : state.feed;
  // While a scope change is on its way, the radios show the chosen scope (the refetch confirms it).
  const shown = withChosenScope(state, chosenScope);

  return (
    <div className="flex flex-col">
      {header}
      <FeedView
        state={shown}
        order={order}
        canMutate={canMutate}
        reason={reason}
        creating={create.isPending}
        savingScope={update.isPending}
        onCreate={onCreate}
        onCopy={onCopy}
        onScopeChange={onScopeChange}
        onRotate={onRotate(feed?.scope ?? "all")}
        onEnd={onEnd}
      />
    </div>
  );
}
