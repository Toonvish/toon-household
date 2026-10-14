/**
 * WeekStrip — the library's "Diese Woche" strip (A04 §3.2/§4, reconstructed, no
 * artboard — SPEC.md §1/D10). Always shows the week CONTAINING today
 * (`startOfPlanWeek`, i.e. its Monday), never a week the URL chose: unlike `/plan`
 * itself this is a preview, not a navigation surface, so it holds no `?week=` state
 * and its only navigation is the `recipe.plan.strip.link` beside the heading.
 *
 * Reuses `PlanDayCard` (T7.4) for all three drawn states (`planned`/`empty`/
 * `today`) rather than reimplementing them — the card, its `ActionMenu`s and its
 * dialogs are unchanged here; this component only decides WHICH days to show and
 * hands each one its slice of the week's entries, exactly like `PlanPage` does.
 *
 * Desktop renders all 7 days as an equal `grid-cols-7`. **A phone SCROLLS all 7
 * horizontally, starting on today**, which is A04 §4's own "try next" note rather
 * than the artboard's four-up crop — and it is a correction of two measured faults
 * in that crop, not a preference. (1) The crop was a literal `week.slice(3, 7)`,
 * i.e. Thu..Sun whatever day it was, so from Monday to Wednesday the phone strip
 * left TODAY out altogether — the one day a week preview exists to show. (2) Four
 * cards across 390px is 80px each, 58px of it text, and a German recipe title
 * broke mid-word inside it ("Schnelle r Schokok uchen"); a recipe title carries no
 * clamp and no truncation anywhere in this app, so the only honest fix is to give
 * it a card it fits in. `w-daycard` is that card, `scrollLeft` starts the
 * scroller on today, and the week is still one fetch and one component.
 *
 * `maxEntries={1}` caps a busy day to its first entry plus a `+N` link to `/plan`
 * (R36) — this strip has no room for a second entry the way `/plan`'s own column
 * does — and `compact` drops the per-entry `ActionMenu` and thumbnail for the same
 * reason of width (see `PlanDayCard`).
 */
import { useLayoutEffect, useRef } from "react";
import { ArrowRight } from "lucide-react";
import { planWeek, startOfPlanWeek, todayPlanDate, type MealPlanEntry, type PlanDate } from "@toon/shared";
import { SkeletonList } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { useCanMutate, useEmailVerificationBlock, useSession } from "@/lib/session";
import { useMediaQuery } from "@/lib/viewport";
import { AppLink } from "@/lib/nav";
import { usePlanWeek } from "../lib/queries";
import { PlanDayCard } from "./PlanDayCard";

/** Matches `PlanDayCard`'s own local constant — Tailwind's `lg`, 1024px. */
const LG_QUERY = "(min-width: 64rem)";

/** A day holds several entries at most `(household_id, planned_on, recipe_id)`-unique. */
function groupByDay(items: readonly MealPlanEntry[]): Map<PlanDate, MealPlanEntry[]> {
  const byDay = new Map<PlanDate, MealPlanEntry[]>();
  for (const item of items) {
    const bucket = byDay.get(item.plannedOn);
    if (bucket) bucket.push(item);
    else byDay.set(item.plannedOn, [item]);
  }
  return byDay;
}

export interface WeekStripProps {
  householdId: string;
}

export function WeekStrip({ householdId }: WeekStripProps) {
  const t = useT();
  const { isOnline } = useSession();
  const unverified = useEmailVerificationBlock();
  const { canMutate } = useCanMutate();
  const isWide = useMediaQuery(LG_QUERY);

  const today = todayPlanDate();
  const week = planWeek(startOfPlanWeek(today));
  const todayIndex = Math.max(week.indexOf(today), 0);

  // `offlineFirst` (see `planQuery`), so a cold offline start still has the
  // persisted "plan" segment to render from — the strip's own gotcha.
  const query = usePlanWeek(householdId, week[0]!);

  /*
    Today is the day this strip is about, and a horizontal scroller opens at
    `scrollLeft: 0` — Monday. So the position is set once, imperatively, rather
    than by reordering the days: Mon..Sun in the DOM is what a week IS, and it is
    also the reading and tab order. `scrollLeft` (not `scrollIntoView`, which
    would also scroll the PAGE to the strip on every load) and no `behavior:
    "smooth"`, so it is the initial position rather than a visible animation.
    A LAYOUT effect, because `useEffect` runs after paint and the strip flashed
    at Monday before jumping to today. The offset is measured from today's own
    `<li>` rather than computed from a card width, so the CSS is the only place
    the width lives. Runs when the data lands too — the pending branch renders a
    skeleton instead of this element, so the ref is null on the first pass.
  */
  const scroller = useRef<HTMLOListElement>(null);
  useLayoutEffect(() => {
    const element = scroller.current;
    const card = element?.children[todayIndex];
    if (element == null || card === undefined || isWide) return;
    element.scrollLeft = card.getBoundingClientRect().left - element.getBoundingClientRect().left + element.scrollLeft;
  }, [isWide, todayIndex, query.isPending]);

  // Same offline-hint composition as `/plan` itself (`recipe.plan.offlineHint` on top of
  // the shared unverified-address reason) — this is a read-only surface: the
  // day cards' own `disabled` state already covers "no offline write path to
  // gate", so no separate branch is needed here.
  const reason = unverified ?? (isOnline ? undefined : t("recipe.plan.offlineHint"));

  if (query.isPending) {
    return (
      <section className="flex flex-col gap-2.5">
        <Header t={t} />
        <SkeletonList variant="daycards" />
      </section>
    );
  }

  // A failed fetch never blocks the library from rendering — swallow into "no
  // plan yet" (empty drawn day cards) rather than an `ErrorState` (A04 §3.2).
  const byDay = groupByDay(query.data?.items ?? []);

  return (
    <section className="flex flex-col gap-2.5">
      <Header t={t} />
      {/*
        Deliberately NOT bled out to the screen edges with `.bleed-gutter-inset`:
        that utility is hand-written in `styles/index.css`, so it is emitted after
        everything Tailwind generates and a `lg:mx-0` on the same element could not
        override it — the same cascade trap as `px-4 px-safe`. The scroller stays
        inside the gutter, which keeps this one element purely Tailwind and lets the
        `lg:` grid switch happen in CSS instead of in JS.
      */}
      <ol
        ref={scroller}
        className="no-scrollbar flex snap-x snap-mandatory gap-2 overflow-x-auto lg:grid lg:snap-none lg:grid-cols-7 lg:overflow-x-visible"
      >
        {week.map((day) => (
          <li key={day} className="w-daycard shrink-0 snap-start lg:w-auto lg:min-w-0">
            <PlanDayCard
              householdId={householdId}
              date={day}
              entries={byDay.get(day) ?? []}
              maxEntries={1}
              compact
              isToday={day === today}
              canMutate={canMutate}
              reason={reason}
            />
          </li>
        ))}
      </ol>
    </section>
  );
}

function Header({ t }: { t: ReturnType<typeof useT> }) {
  return (
    <header className="flex items-baseline gap-2.5">
      <h2 className="font-display text-xl font-medium">{t("recipe.plan.strip.heading")}</h2>
      <AppLink
        to="/recipe/plan"
        className="ml-auto inline-flex items-center gap-1 text-[12.5px] font-semibold text-brand-hover"
      >
        {t("recipe.plan.strip.link")}
        <ArrowRight aria-hidden="true" className="size-3.5" />
      </AppLink>
    </header>
  );
}
