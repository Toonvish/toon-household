/**
 * "bitte prüfen" marker for low-confidence fields and rows.
 * Purely informational — it never blocks saving.
 *
 * Composes the restyled `Badge` (T1.9) rather than carrying its own pill markup —
 * `size="sm"` for the dense row context, `icon` for the confidence glyph. Imported
 * straight from `@/components/ui`, not through `../lib/shell`: the shell's
 * `BadgeProps` cast is a narrower typing seam (no `icon`/`title`) built for the
 * handful of plain-label badges the rest of the feature used before this one
 * existed, and widening it belongs to whoever next needs it there, not to a
 * restyle task that does not own `lib/shell.tsx`.
 */
import { CircleCheck, CircleQuestionMark, TriangleAlert } from "lucide-react";
import clsx from "clsx";
import { Badge, type BadgeVariant } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { confidenceLevel, formatConfidence, type ConfidenceLevel } from "../lib/confidence";

export interface ConfidenceBadgeProps {
  /** Raw confidence 0..1 from the draft (optional). */
  value?: number | null;
  /** Overrides the level derived from `value`. */
  level?: ConfidenceLevel;
  /** Why the row is flagged — rendered as a title tooltip and optional hint text. */
  reasons?: readonly string[];
  /** Custom label; defaults to "bitte prüfen". */
  label?: string;
  /** Render even when the value looks good (shows a green check). */
  showWhenGood?: boolean;
  className?: string;
}

/** `ConfidenceLevel` is a domain value; only its Badge tone is a styling choice. */
const VARIANTS: Record<ConfidenceLevel, BadgeVariant> = {
  low: "warning",
  medium: "warning",
  unknown: "neutral",
  high: "success",
};

export function ConfidenceBadge({
  value,
  level,
  reasons,
  label,
  showWhenGood = false,
  className,
}: ConfidenceBadgeProps) {
  const t = useT();
  const resolved: ConfidenceLevel = level ?? confidenceLevel(value ?? undefined);
  if (resolved === "high" && !showWhenGood) return null;

  const text = label ?? (resolved === "high" ? t("recipe.import.confidence.good") : t("recipe.import.confidence.needsCheck"));
  const tooltipParts = [
    ...(reasons ?? []),
    typeof value === "number" ? t("recipe.import.confidence.quality", { value: formatConfidence(value) }) : undefined,
  ].filter((part): part is string => typeof part === "string" && part.length > 0);

  const Icon = resolved === "high" ? CircleCheck : resolved === "unknown" ? CircleQuestionMark : TriangleAlert;

  return (
    <Badge
      variant={VARIANTS[resolved]}
      size="sm"
      icon={<Icon aria-hidden className="h-3 w-3" />}
      className={clsx("shrink-0", className)}
      title={tooltipParts.length > 0 ? tooltipParts.join(" · ") : undefined}
    >
      {text}
    </Badge>
  );
}

/** Multi-line reason list under a flagged row. */
export function ConfidenceReasons({ reasons, className }: { reasons: readonly string[]; className?: string }) {
  if (reasons.length === 0) return null;
  return (
    <p className={clsx("text-[11px] leading-4 text-warning", className)}>
      {reasons.join(" · ")}
    </p>
  );
}

export default ConfidenceBadge;
