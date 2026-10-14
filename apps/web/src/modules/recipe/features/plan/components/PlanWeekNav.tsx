/**
 * `/plan`'s header: the heading, the "{start} – {end}" range and the week-shift
 * controls. Extrapolated (A05 has no artboard for `/plan` itself) — kept as its
 * own component only because `PlanPage` already has enough state without also
 * owning the "is this the current week" question.
 *
 * `formatDate()` takes an ISO INSTANT and does `new Date(iso)` itself; feeding it
 * a bare `PlanDate` ("YYYY-MM-DD") would parse as UTC midnight and, in a
 * negative-UTC-offset timezone, can render as the day before once `Intl` applies
 * the device's local zone — the exact trap `calendar.ts` documents.
 * `planDateToDate()` (UTC noon) has no timezone within +/-12h that crosses to
 * another date, so converting through it first is what keeps the displayed range
 * honest everywhere.
 */
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  addPlanDays,
  planDateToDate,
  shiftPlanWeek,
  startOfPlanWeek,
  todayPlanDate,
  type PlanDate,
} from "@toon/shared";
import { Button, IconButton } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { formatDate } from "@/modules/recipe/lib/format";

export interface PlanWeekNavProps {
  /** The Monday of the week on screen. */
  weekStart: PlanDate;
  onNavigate: (weekStart: PlanDate) => void;
}

function isoNoon(date: PlanDate): string {
  return planDateToDate(date).toISOString();
}

export function PlanWeekNav({ weekStart, onNavigate }: PlanWeekNavProps) {
  const t = useT();
  const currentWeek = startOfPlanWeek(todayPlanDate());
  const isCurrentWeek = weekStart === currentWeek;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-medium text-fg">{t("recipe.plan.title")}</h1>
        <p className="text-sm text-fg-muted">
          {t("recipe.plan.weekRange", {
            start: formatDate(isoNoon(weekStart)),
            end: formatDate(isoNoon(addPlanDays(weekStart, 6))),
          })}
        </p>
      </div>
      <div className="flex items-center gap-1">
        {isCurrentWeek ? null : (
          <Button variant="secondary" size="sm" onClick={() => onNavigate(currentWeek)}>
            {t("recipe.plan.thisWeek")}
          </Button>
        )}
        <IconButton
          label={t("recipe.plan.prevWeek")}
          icon={<ChevronLeft />}
          variant="ghost"
          onClick={() => onNavigate(shiftPlanWeek(weekStart, -1))}
        />
        <IconButton
          label={t("recipe.plan.nextWeek")}
          icon={<ChevronRight />}
          variant="ghost"
          onClick={() => onNavigate(shiftPlanWeek(weekStart, 1))}
        />
      </div>
    </div>
  );
}
