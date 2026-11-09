import { CALENDAR_FEED_SCOPES, type CalendarFeedScope } from "../lib/scopes";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";

/**
 * The feed's scope (plan m9 P9, P16) as two native radio rows with a one-line hint each: the labels are too long
 * for a segmented control at 390 px, and native radios give the arrow keys and the group semantics for free.
 */
export function ScopeChoice({
  name,
  value,
  onChange,
  disabled = false,
}: {
  /** The radio group's `name` (unique per screen). */
  name: string;
  value: CalendarFeedScope;
  onChange: (scope: CalendarFeedScope) => void;
  disabled?: boolean;
}) {
  const t = useT();
  return (
    <fieldset className="flex min-w-0 flex-col gap-2" disabled={disabled}>
      <legend className="pb-1.5 text-sm font-semibold text-fg">{t("calendar.feed.scope.label")}</legend>
      {CALENDAR_FEED_SCOPES.map((scope) => {
        const checked = scope === value;
        return (
          <label
            key={scope}
            className={cn(
              "flex min-h-11 min-w-0 cursor-pointer items-start gap-3 rounded-control border px-3 py-2.5 transition-colors duration-150",
              "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
              checked ? "border-brand bg-brand-soft text-brand-soft-fg" : "border-line bg-surface text-fg hover:border-line-strong",
              disabled && "cursor-not-allowed opacity-60",
            )}
          >
            <input
              type="radio"
              name={name}
              value={scope}
              checked={checked}
              onChange={() => onChange(scope)}
              className="mt-0.5 size-4 shrink-0 accent-brand"
            />
            <span className="flex min-w-0 flex-col">
              <span className="text-control font-semibold">{t(`calendar.feed.scope.${scope}`)}</span>
              <span className="text-sm text-fg-muted">{t(`calendar.feed.scope.${scope}Hint`)}</span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
