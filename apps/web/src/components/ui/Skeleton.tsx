import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";

export interface SkeletonProps {
  className?: string;
  /** Renders `lines` stacked bars with a shorter last line. */
  lines?: number;
  rounded?: "sm" | "md" | "full" | "card";
}

const radii = { sm: "rounded", md: "rounded-lg", full: "rounded-full", card: "rounded-card" } as const;

export function Skeleton({ className, lines, rounded = "md" }: SkeletonProps) {
  if (lines && lines > 1) {
    return (
      <div className="flex flex-col gap-2" aria-hidden="true">
        {Array.from({ length: lines }, (_, index) => (
          <div
            key={index}
            className={cn(
              "h-4 animate-skeleton bg-skeleton",
              radii[rounded],
              index === lines - 1 && "w-2/3",
              className,
            )}
          />
        ))}
      </div>
    );
  }
  return (
    <div
      aria-hidden="true"
      className={cn("h-4 animate-skeleton bg-skeleton", radii[rounded], className)}
    />
  );
}

/**
 * Placeholder for a list. `variant` must match the layout that will replace it
 * or the content visibly jumps when the data arrives — see the conflict note in
 * A01 §7.
 */
export function SkeletonList({
  count = 6,
  variant = "editorial",
}: {
  count?: number;
  variant?: "editorial" | "tiles" | "daycards" | "planweek";
}) {
  const t = useT();
  const common = { "aria-busy": true as const, "aria-label": t("common.skeletonList.loadingRecipes") };

  if (variant === "editorial") {
    // The artboard's editorial row: an 84px square plus three bars (eyebrow /
    // title / meta), borderless — `grid-template-columns:84px 1fr`, no card frame.
    return (
      <div className="flex flex-col gap-2" {...common}>
        {Array.from({ length: count }, (_, index) => (
          <div key={index} className="grid grid-cols-[5.25rem_1fr] items-center gap-3 p-2">
            <Skeleton className="size-21" rounded="md" />
            <div className="flex min-w-0 flex-col gap-2">
              <Skeleton className="h-3 w-1/4" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (variant === "tiles") {
    return (
      <div className="grid grid-cols-2 gap-3" {...common}>
        {Array.from({ length: count }, (_, index) => (
          <div key={index} className="overflow-hidden rounded-card border border-line bg-surface">
            <Skeleton className="h-28 w-full" rounded="sm" />
            <div className="flex flex-col gap-2 p-3">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (variant === "planweek") {
    // Matches `/plan`'s own grid — one full-width card per day on a phone, an
    // equal 7-up grid from `lg`.
    return (
      <div
        className="grid grid-cols-1 gap-3 lg:grid-cols-[repeat(7,minmax(0,1fr))] lg:gap-2"
        {...common}
      >
        {Array.from({ length: 7 }, (_, index) => (
          <DayCardSkeleton key={index} className="min-w-0" />
        ))}
      </div>
    );
  }

  // Matches `WeekStrip`'s own shape — an equal 7-up grid from `lg`, a horizontal
  // scroller of `w-daycard` cards below it — so the strip does not pop in narrower
  // or wider than the data it replaces.
  return (
    <div
      className="flex gap-2 overflow-x-hidden lg:grid lg:grid-cols-7 lg:overflow-x-visible"
      {...common}
    >
      {Array.from({ length: 7 }, (_, index) => (
        <DayCardSkeleton key={index} className="w-daycard shrink-0 lg:w-auto lg:min-w-0" />
      ))}
    </div>
  );
}

function DayCardSkeleton({ className }: { className: string }) {
  return (
    <div
      className={cn("flex flex-col gap-2 rounded-card border border-line bg-surface p-3", className)}
    >
      <Skeleton className="h-3 w-1/2" />
      <Skeleton className="h-6 w-2/3" />
    </div>
  );
}
