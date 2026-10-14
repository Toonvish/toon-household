/**
 * PlanPage — `/plan`, the meal planner. EXTRAPOLATED (no artboard): A05 draws only
 * the library's four-day week strip, so every token here is that strip's own
 * `planned`/`empty`/`today` palette (A05 §10.7), reused for a full seven-day week.
 *
 * The week is REAL URL STATE (`?week=`), normalised to its Monday by
 * `router.tsx`'s `validateSearch` before this component ever sees it — the second
 * `startOfPlanWeek()`/`todayPlanDate()` fallback below is defence in depth for a
 * hand-edited or half-migrated URL, not the primary guard.
 *
 * Entries arrive as a FLAT, `(plannedOn, position)`-sorted list (never grouped by
 * day server-side, see `MealPlanRangeResponseSchema`), so grouping into the
 * week's seven slots is this component's job, not the API's. `/plan` hands each
 * `PlanDayCard` its day's WHOLE entry list (no `maxEntries` cap) — PLAN.md §4
 * R36 reserves the first-plus-`+N` fold for the library's week strip only.
 */
import { useEffect } from "react";
import { CalendarDays, MailWarning } from "lucide-react";
import { isPlanDate, planWeek, startOfPlanWeek, todayPlanDate, type MealPlanEntry, type PlanDate } from "@toon/shared";
import { PhoneHeaderRow } from "@/components/layout/PhoneHeaderRow";
import { EmptyState, ErrorState, SkeletonList } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { useSearchParams } from "@/lib/navigation";
import { writeStorage } from "@/lib/storage";
import { useCanMutate, useEmailVerificationBlock, useRequiredHouseholdId, useSession } from "@/lib/session";
import { useAppNavigate } from "@/lib/nav";
import { usePlanWeek } from "./lib/queries";
import { PlanDayCard } from "./components/PlanDayCard";
import { PlanWeekNav } from "./components/PlanWeekNav";

/**
 * `storageKeys` (`lib/storage.ts`) has no `planVisited` entry yet — adding one is
 * the sidebar task's edit (`docs/redesign/specs/05-frontend-shell.md` §3.4, "New"
 * pill retirement), a file this task does not own. This literal is the exact
 * value that key resolves to (`${PREFIX}planVisited`, `PREFIX` = `"toon."`), so
 * the pill retires the moment that task lands, with nothing to reconcile.
 */
const PLAN_VISITED_KEY = "toon.planVisited";

function groupByDay(items: readonly MealPlanEntry[]): Map<PlanDate, MealPlanEntry[]> {
  const byDay = new Map<PlanDate, MealPlanEntry[]>();
  for (const item of items) {
    const bucket = byDay.get(item.plannedOn);
    if (bucket) bucket.push(item);
    else byDay.set(item.plannedOn, [item]);
  }
  return byDay;
}

export default function PlanPage() {
  const t = useT();
  const householdId = useRequiredHouseholdId();
  const { isOnline } = useSession();
  const unverified = useEmailVerificationBlock();
  const navigate = useAppNavigate();
  const search = useSearchParams();

  useEffect(() => {
    writeStorage(PLAN_VISITED_KEY, "1");
  }, []);

  const week = startOfPlanWeek(
    search.week !== undefined && isPlanDate(search.week) ? search.week : todayPlanDate(),
  );
  const days = planWeek(week);
  const today = todayPlanDate();

  const query = usePlanWeek(householdId, week);
  const items = query.data?.items ?? [];
  const byDay = groupByDay(items);

  // `useCanMutate()` supplies the boolean (online + confirmed address, same gate
  // every other write-gated screen uses); its OWN offline reason is generic
  // ("Offline — Änderungen können nicht gespeichert werden."), so the `title` on
  // a disabled write here is composed separately with `recipe.plan.offlineHint` —
  // the unconfirmed-address reason is unchanged, since that copy is already
  // screen-agnostic ("Bestätige deine E-Mail-Adresse …").
  const { canMutate } = useCanMutate();
  const reason = unverified ?? (isOnline ? undefined : t("recipe.plan.offlineHint"));

  function goToWeek(next: PlanDate) {
    navigate({ to: "/recipe/plan", search: { week: next } });
  }

  return (
    <div className="flex flex-col gap-4">
      <PhoneHeaderRow />
      <PlanWeekNav weekStart={week} onNavigate={goToWeek} />

      {/*
        The shell's `UnverifiedEmailBanner` already explains the account-wide
        state at the top of every screen, but it is generic — it does not say
        that THIS screen's entire interaction just went away (R44). A screen
        where every affordance is gone needs to say so itself, once, rather
        than leaving seven cards that are simply inert with no explanation a
        touch screen can ever reveal (a disabled button has no hover).
      */}
      {unverified !== undefined ? (
        <div
          role="status"
          className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning-soft p-3 text-sm text-warning-soft-fg"
        >
          <MailWarning aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <p>{unverified}</p>
        </div>
      ) : null}

      {query.isPending ? (
        <SkeletonList variant="planweek" />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          {/*
            Seven `Planen` cards with no explanation is the day-one experience of
            every install — this renders ABOVE the grid, never instead of it: the
            grid's own empty day cards are what you plan FROM.
          */}
          {items.length === 0 ? (
            <EmptyState
              icon={<CalendarDays />}
              title={t("recipe.plan.empty.title")}
              description={t("recipe.plan.empty.description")}
            />
          ) : null}

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[repeat(7,minmax(0,1fr))] lg:gap-2">
            {days.map((day) => {
              const dayEntries = byDay.get(day) ?? [];
              return (
                <PlanDayCard
                  key={day}
                  householdId={householdId}
                  date={day}
                  entries={dayEntries}
                  isToday={day === today}
                  canMutate={canMutate}
                  reason={reason}
                />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
