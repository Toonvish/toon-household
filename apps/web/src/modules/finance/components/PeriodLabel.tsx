import { formatPeriod } from "@/modules/finance/lib/format";

/** `'YYYY-MM'` -> `"August 2026"` — thin wrapper so screens never format a period by hand. */
export function PeriodLabel({ period, className }: { period: string; className?: string }) {
  return <span className={className}>{formatPeriod(period)}</span>;
}
