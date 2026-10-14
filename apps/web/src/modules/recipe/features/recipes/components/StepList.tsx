/**
 * Step list with a tappable "erledigt" state. The state lives in sessionStorage
 * (see useCheckedSteps) so it survives navigating away and back.
 *
 * A04 §5.3: no card, no border, no background — a plain numbered list,
 * `gap-[22px]` between steps, the numeral in `font-display` brand serif. The
 * design draws no done state; keeping it is a deliberate extrapolation (dropping
 * `useCheckedSteps` would be a functional regression), so it stays expressed the
 * same way it always was — numeral `text-success`, text struck through — just
 * without the card chrome the redesign drops.
 */
import { Check } from "lucide-react";
import type { RecipeStepRecord } from "@toon/shared";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { groupBySection } from "../lib/format";
import type { CheckedSteps } from "../lib/hooks";

export interface StepListProps {
  steps: readonly RecipeStepRecord[];
  checked: CheckedSteps;
  className?: string;
}

export function StepList({ steps, checked, className }: StepListProps) {
  const t = useT();
  if (steps.length === 0) {
    return <p className="text-sm text-fg-muted">{t("recipe.recipes.steps.empty")}</p>;
  }

  const groups = groupBySection(steps);
  let number = 0;

  return (
    <div className={cn("flex flex-col gap-5", className)}>
      {groups.map((group, groupIndex) => (
        <section key={group.section ?? `group-${groupIndex}`} className="flex flex-col gap-3">
          {group.section ? (
            <h3 className="text-sm font-semibold tracking-wide text-fg-muted uppercase">
              {group.section}
            </h3>
          ) : null}
          <ol className="flex flex-col gap-[22px]">
            {group.items.map((step) => {
              number += 1;
              const done = checked.isDone(step.id);
              return (
                <li key={step.id}>
                  <button
                    type="button"
                    aria-pressed={done}
                    onClick={() => checked.toggle(step.id)}
                    className="grid w-full grid-cols-[44px_minmax(0,1fr)] gap-4 text-left"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "pt-0.5 font-display text-[30px] leading-none font-medium",
                        done ? "text-success" : "text-brand",
                      )}
                    >
                      {done ? <Check className="size-6" /> : number}
                    </span>
                    <span
                      className={cn(
                        "text-[16.5px] leading-[1.6] text-pretty",
                        done ? "text-fg-subtle line-through decoration-1" : "text-fg-body",
                      )}
                    >
                      {step.text}
                    </span>
                    <span className="sr-only">
                      {done ? t("recipe.recipes.steps.doneSr") : t("recipe.recipes.steps.markDoneSr")}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
