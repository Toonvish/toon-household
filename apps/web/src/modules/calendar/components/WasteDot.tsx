import type { CalendarWasteCategory } from "@toon/shared";
import { cn } from "@/lib/cn";
import { wasteColorClass } from "@/modules/calendar/lib/people";

/** A waste type's 8 px dot in the flyer's colour (design §4.6). Decorative: the label is always written. */
export function WasteDot({ category, className }: { category: CalendarWasteCategory; className?: string }) {
  return <span aria-hidden="true" className={cn("inline-block size-2 shrink-0 rounded-full", wasteColorClass(category), className)} />;
}
