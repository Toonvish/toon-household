import { cn } from "@/lib/cn";
import { formatDayHeading } from "@/modules/calendar/lib/format";

/** A day's eyebrow: `HEUTE · MITTWOCH, 11. NOVEMBER`, `MORGEN · DO 12.11.`, `FR 13.11.` (design §4.2). */
export function DayHeading({ date, today, id, className }: { date: string; today: string; id?: string; className?: string }) {
  return (
    <h3 id={id} className={cn("eyebrow", date === today ? "text-brand" : "text-fg-faint", className)}>
      {formatDayHeading(date, today)}
    </h3>
  );
}
