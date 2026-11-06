import { cn } from "@/lib/cn";
import { personColorClass } from "@/modules/calendar/lib/people";

/** A person's 8 px colour dot (design §4.6). Decorative: the name is always written beside it. */
export function PersonDot({ colorIndex, className }: { colorIndex: number; className?: string }) {
  return <span aria-hidden="true" className={cn("inline-block size-2 shrink-0 rounded-full", personColorClass(colorIndex), className)} />;
}
