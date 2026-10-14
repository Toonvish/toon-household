/**
 * The compact, read-only week strip on the recipe Home card (SPEC §5, D5; plan
 * m4-design-pass §1 decision 8, M4-T04): this week as seven day cells (today, planned,
 * empty after R redesign SPEC §4.1) plus the next planned titles.
 *
 * It is NOT `WeekStrip`: that one carries `PlanDayCard`, its `ActionMenu`s and dialogs and
 * would pull the planner into the manifest's static import graph. Imports only the design
 * primitives, `@/lib/*`, the module's `lib/*` and the shared package; never `@/modules`
 * and never `@/components/layout`.
 *
 * Recipe titles are CONTENT: never `t()`, never truncated or clamped (R "A RECIPE TITLE
 * NEVER TRUNCATES AT ALL"), `text-pretty` only. Cells carry `min-w-0` so seven of them fit
 * 390 px.
 */
import { useQuery } from "@tanstack/react-query";
import { planWeek, startOfPlanWeek, todayPlanDate } from "@toon/shared";
import { ArrowRight } from "lucide-react";
import type { ReactElement } from "react";
import { Skeleton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatDayOfMonth, formatWeekdayShort } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { AppLink } from "@/lib/nav";
import { planQuery } from "@/modules/recipe/lib/queries";
import { homeWeekDays, upcomingEntries, type HomeDayState } from "../lib/home-week";

/** One dot per planned entry, at most this many. */
const MAX_DOTS = 3;

const CELL_STATE: Record<HomeDayState, string> = {
  today: "bg-brand-soft text-brand-soft-fg ring-1 ring-brand",
  planned: "bg-surface-2 text-fg",
  empty: "text-fg-faint",
};

export function HomeWeekStrip({ householdId }: { householdId: string }): ReactElement {
  const t = useT();
  const enabled = householdId !== "";
  const today = todayPlanDate();
  const week = planWeek(startOfPlanWeek(today));
  const plan = useQuery({ ...planQuery(householdId, { from: week[0]!, to: week[6]! }), enabled });

  const entries = plan.data?.items ?? [];
  const days = homeWeekDays(entries, week, today);
  const upcoming = upcomingEntries(entries, today);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className="eyebrow text-fg-faint">{t("recipe.plan.strip.heading")}</p>
        <AppLink to="/recipe/plan" className="inline-flex items-center gap-1 text-sm text-brand hover:underline">
          <span>{t("recipe.plan.strip.link")}</span>
          <ArrowRight aria-hidden="true" className="size-4" />
        </AppLink>
      </div>

      {plan.isPending && enabled ? (
        <Skeleton lines={3} />
      ) : (
        <>
          <div className="grid grid-cols-7 gap-1">
            {days.map((day) => (
              <AppLink
                key={day.date}
                to="/recipe/plan"
                className={cn(
                  "flex min-w-0 flex-col items-center gap-0.5 rounded-control px-0.5 py-1.5",
                  CELL_STATE[day.state],
                )}
              >
                <span className="eyebrow">{formatWeekdayShort(day.date)}</span>
                <span className="text-control tabular-nums">{formatDayOfMonth(day.date)}</span>
                <span aria-hidden="true" className="flex h-1.5 items-center gap-0.5">
                  {Array.from({ length: Math.min(day.count, MAX_DOTS) }, (_, i) => (
                    <span key={i} className="size-1.5 rounded-full bg-brand" />
                  ))}
                </span>
              </AppLink>
            ))}
          </div>

          {upcoming.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {upcoming.map((entry) => (
                <li key={entry.id} className="min-w-0 text-sm text-fg text-pretty">
                  <AppLink
                    to="/recipe/recipes/$recipeId"
                    params={{ recipeId: entry.recipeId }}
                    className="hover:underline"
                  >
                    {`${formatWeekdayShort(entry.plannedOn)} · ${entry.recipe.title}`}
                  </AppLink>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </div>
  );
}
