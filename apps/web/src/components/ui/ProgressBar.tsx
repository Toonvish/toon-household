import { cn } from "@/lib/cn";

export type ProgressBarTone = "brand" | "success" | "accent";
export type ProgressBarSize = "sm" | "md";

const tones: Record<ProgressBarTone, string> = {
  brand: "bg-brand",
  success: "bg-success",
  accent: "bg-accent",
};

const sizes: Record<ProgressBarSize, string> = {
  sm: "h-1.5",
  md: "h-2",
};

export interface ProgressBarProps {
  value: number;
  max?: number;
  /** Required: this is the only accessible name the bar has. */
  label: string;
  tone?: ProgressBarTone;
  size?: ProgressBarSize;
  className?: string;
}

/**
 * A bare percentage bar. It does no arithmetic of its own — a caller with a "bought /
 * (toBuy + bought)" style ratio computes that in `packages/shared` (pure logic, unit
 * tested there) and hands this component the resulting number. Replaces the private
 * copy that used to live in `UploadProgress` and the one the shopping screens would
 * otherwise have grown as `ShoppingProgressBar` (CLAUDE.md/R7: there is only one).
 */
export function ProgressBar({ value, max = 100, label, tone = "success", size = "md", className }: ProgressBarProps) {
  const clamped = Math.min(max, Math.max(0, value));
  const percent = max > 0 ? (clamped / max) * 100 : 0;

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.round(clamped)}
      className={cn("w-full overflow-hidden rounded-full bg-surface-2", sizes[size], className)}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-200 ease-out", tones[tone])}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
