import { CALENDAR_WEEKDAYS, type CalendarRepeatFreq, type CalendarWeekday } from "@toon/shared";
import { Chip, Input, Select } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { formatShortDate, weekdayShortName } from "@/modules/calendar/lib/format";
import { nextDates } from "@/modules/calendar/lib/rhythm";
import { draftSeries, errorAt, previewFrom, type EntryFormState } from "../lib/form";

const FREQS = ["none", "daily", "weekly", "monthly", "yearly"] as const satisfies ReadonlyArray<CalendarRepeatFreq>;

/**
 * Wiederholen (design §4.5): Nie · Täglich · Wöchentlich (weekday chips) · Monatlich · Jährlich, "alle [n]",
 * "bis [Datum]", and the live preview "Nächste: Fr 13.11., Mo 16.11., Do 19.11." from the shared recurrence.
 */
export function RepeatFields({
  state,
  today,
  errors,
  disabled,
  onChange,
}: {
  state: EntryFormState;
  today: string;
  errors: Readonly<Record<string, string>>;
  disabled?: boolean;
  onChange: (next: Partial<EntryFormState>) => void;
}) {
  const t = useT();
  const series = draftSeries(state);
  const preview = series === null ? [] : nextDates(series, previewFrom(state, today), 3);

  function toggleWeekday(code: CalendarWeekday) {
    const next = state.weekdays.includes(code) ? state.weekdays.filter((day) => day !== code) : [...state.weekdays, code];
    onChange({ weekdays: CALENDAR_WEEKDAYS.filter((day) => next.includes(day)) });
  }

  return (
    <fieldset className="flex min-w-0 flex-col gap-3" disabled={disabled}>
      <Select
        label={t("calendar.entries.repeat.label")}
        value={state.freq}
        onChange={(event) => onChange({ freq: event.target.value as CalendarRepeatFreq })}
        options={FREQS.map((freq) => ({ value: freq, label: t(`calendar.entries.repeat.${freq}`) }))}
        error={errorAt(errors, "repeat.freq")}
      />
      {state.freq === "none" ? null : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label={`${t("calendar.entries.repeat.every")} … ${t(`calendar.entries.repeat.unit.${state.freq}`)}`}
              type="number"
              inputMode="numeric"
              min={1}
              max={99}
              value={state.interval}
              onChange={(event) => onChange({ interval: event.target.value })}
              error={errorAt(errors, "repeat.interval")}
            />
            <Input
              label={t("calendar.entries.repeat.until")}
              type="date"
              optional
              value={state.until}
              min={state.startDate}
              onChange={(event) => onChange({ until: event.target.value })}
              error={errorAt(errors, "repeat.until")}
            />
          </div>
          {state.freq === "weekly" ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-sm font-semibold text-fg">{t("calendar.entries.repeat.weekdays")}</p>
              <div className="flex flex-wrap gap-2">
                {CALENDAR_WEEKDAYS.map((code) => (
                  <Chip
                    key={code}
                    label={weekdayShortName(code)}
                    selected={state.weekdays.includes(code)}
                    onSelect={() => toggleWeekday(code)}
                    disabled={disabled}
                  />
                ))}
              </div>
              {errorAt(errors, "repeat.weekdays") ? (
                <p className="text-sm text-danger">{errorAt(errors, "repeat.weekdays")}</p>
              ) : null}
            </div>
          ) : null}
          <p className="text-sm text-fg-muted" aria-live="polite">
            {series === null
              ? null
              : preview.length === 0
                ? t("calendar.entries.repeat.previewNone")
                : t("calendar.entries.repeat.preview", { dates: preview.map((date) => formatShortDate(date, today)).join(", ") })}
          </p>
        </>
      )}
    </fieldset>
  );
}
