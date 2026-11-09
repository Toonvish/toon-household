import type { CalendarFeed } from "@toon/shared";
import type { FeedPlatform } from "../lib/platforms";
import type { CalendarFeedScope } from "../lib/scopes";
import type { FeedViewState } from "../lib/state";
import { FeedLinkCard } from "./FeedLinkCard";
import { FeedManageCard } from "./FeedManageCard";
import { FeedPrivacyNote } from "./FeedPrivacyNote";
import { FeedSetupCard } from "./FeedSetupCard";
import { FeedSetupGuide } from "./FeedSetupGuide";

export interface FeedViewProps {
  state: FeedViewState;
  /** The setup sections, the device's own first (`feedPlatformOrder`). */
  order: ReadonlyArray<FeedPlatform>;
  canMutate: boolean;
  reason?: string | undefined;
  creating: boolean;
  savingScope: boolean;
  onCreate: (scope: CalendarFeedScope) => void;
  onCopy: (url: string) => void;
  onScopeChange: (scope: CalendarFeedScope) => void;
  onRotate: () => Promise<unknown>;
  onEnd: () => Promise<unknown>;
}

/**
 * The body of the subscription screen in its three states (plan m9 P16), below the page header. Presentational:
 * the page owns the query, the mutations and the toasts, so a test renders each state from props alone.
 *
 * From `lg` two thirds hold the main card(s) and the right third the side card(s), as on the cars and waste screens.
 */
export function FeedView(props: FeedViewProps) {
  const { state } = props;
  if (state.kind === "none") {
    return (
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <FeedSetupCard onCreate={props.onCreate} creating={props.creating} canMutate={props.canMutate} reason={props.reason} />
        </div>
        <FeedPrivacyNote />
      </div>
    );
  }
  if (state.kind === "created") {
    return (
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <FeedLinkCard url={state.url} onCopy={props.onCopy} />
          <FeedSetupGuide order={props.order} />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <FeedPrivacyNote />
          <Manage {...props} feed={state.feed} showLinkHint={false} />
        </div>
      </div>
    );
  }
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
        <Manage {...props} feed={state.feed} showLinkHint />
      </div>
      <FeedPrivacyNote />
    </div>
  );
}

function Manage(props: FeedViewProps & { feed: CalendarFeed; showLinkHint: boolean }) {
  return (
    <FeedManageCard
      feed={props.feed}
      showLinkHint={props.showLinkHint}
      canMutate={props.canMutate}
      reason={props.reason}
      savingScope={props.savingScope}
      onScopeChange={props.onScopeChange}
      onRotate={props.onRotate}
      onEnd={props.onEnd}
    />
  );
}
