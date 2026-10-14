/**
 * Cook Mode: full-screen, large-type, one step at a time.
 *
 * - requests a Screen Wake Lock (feature-detected, silent when unsupported)
 * - swipe or arrow keys to move between steps
 * - the scaled ingredient list stays one tap away
 * - Escape closes it, focus is trapped to the overlay's own controls
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Eye, ListOrdered, X } from "lucide-react";
import type { RecipeIngredient, RecipeStepRecord } from "@toon/shared";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { formatAmountWithUnit } from "../lib/format";
import { useWakeLock, type CheckedSteps } from "../lib/hooks";

export interface CookModeProps {
  title: string;
  steps: readonly RecipeStepRecord[];
  /** Already scaled to the chosen servings. */
  ingredients: readonly RecipeIngredient[];
  checked: CheckedSteps;
  onClose: () => void;
}

export function CookMode({ title, steps, ingredients, checked, onClose }: CookModeProps) {
  const t = useT();
  const [index, setIndex] = useState(0);
  const [showIngredients, setShowIngredients] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const touchStartX = useRef<number | null>(null);
  const { supported, held } = useWakeLock(true);

  const last = Math.max(0, steps.length - 1);
  const step = steps[Math.min(index, last)];

  const go = useCallback(
    (delta: number) => {
      setIndex((current) => Math.min(last, Math.max(0, current + delta)));
    },
    [last],
  );

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  // Lock background scrolling while the overlay is open.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowRight" || event.key === "PageDown") {
        event.preventDefault();
        go(1);
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        go(-1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [go, onClose]);

  if (!step) {
    return null;
  }

  const done = checked.isDone(step.id);

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("recipe.recipes.cookMode.dialogLabel", { title })}
      tabIndex={-1}
      // `px-safe` alone, not `.px-gutter`: this overlay has no `<main>` gutter to
      // inherit, and a landscape notch is the only thing it needs to clear — the
      // header/step/footer rows keep their own fixed padding underneath it.
      className="fixed inset-0 z-50 flex flex-col bg-bg px-safe pt-safe pb-safe outline-none"
      onTouchStart={(event) => {
        touchStartX.current = event.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(event) => {
        const start = touchStartX.current;
        touchStartX.current = null;
        const end = event.changedTouches[0]?.clientX;
        if (start === null || end === undefined) return;
        const delta = end - start;
        if (Math.abs(delta) < 60) return;
        go(delta < 0 ? 1 : -1);
      }}
    >
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <h2 className="min-w-0 flex-1 truncate font-display text-display-md font-medium">{title}</h2>
        {supported ? (
          <span
            className={cn(
              "hidden items-center gap-1 rounded-full px-2 py-0.5 text-xs sm:inline-flex",
              held ? "bg-success-soft text-success-soft-fg" : "bg-surface-2 text-fg-subtle",
            )}
            title={
              held
                ? t("recipe.recipes.cookMode.wakeLock.active")
                : t("recipe.recipes.cookMode.wakeLock.inactiveTitle")
            }
          >
            <Eye aria-hidden="true" className="size-3.5" />
            {held
              ? t("recipe.recipes.cookMode.wakeLock.active")
              : t("recipe.recipes.cookMode.wakeLock.inactiveText")}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => setShowIngredients((value) => !value)}
          aria-expanded={showIngredients}
          className="tap inline-flex items-center gap-1 rounded-full px-3 text-sm text-fg-muted hover:text-fg"
        >
          <ListOrdered aria-hidden="true" className="size-5" />
          <span className="hidden sm:inline">{t("recipe.recipes.ingredients.heading")}</span>
        </button>
        <button
          type="button"
          onClick={onClose}
          className="tap inline-flex items-center justify-center rounded-full px-2 text-fg-muted hover:text-fg"
          aria-label={t("recipe.recipes.cookMode.closeAction")}
        >
          <X aria-hidden="true" className="size-6" />
        </button>
      </header>

      {showIngredients ? (
        <div className="max-h-[40vh] overflow-y-auto border-b border-line bg-surface px-4 py-3">
          <h3 className="eyebrow mb-2 text-fg-faint">
            {t("recipe.recipes.ingredients.heading")}
          </h3>
          <ul className="flex flex-col gap-1 text-lg">
            {ingredients.map((ingredient, position) => (
              <li key={`${ingredient.name}-${position}`} className="flex gap-3">
                <span className="min-w-24 shrink-0 text-right font-medium tabular-nums text-brand">
                  {formatAmountWithUnit(ingredient)}
                </span>
                <span>{ingredient.name}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-1 flex-col justify-center overflow-y-auto px-5 py-6">
        <p className="eyebrow mb-3 text-brand">
          {t("recipe.recipes.cookMode.stepOf", { current: index + 1, total: steps.length })}
        </p>
        <p aria-live="polite" className="text-base whitespace-pre-line text-fg-body">
          {step.text}
        </p>
        {step.section ? (
          <p className="mt-4 text-base text-fg-subtle">{step.section}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 border-t border-line px-3 py-3">
        <div
          className="flex h-1 overflow-hidden rounded-full bg-surface-2"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={steps.length}
          aria-valuenow={index + 1}
          aria-label={t("recipe.recipes.cookMode.progressAriaLabel")}
        >
          <div
            className="bg-brand transition-all"
            style={{ width: `${((index + 1) / steps.length) * 100}%` }}
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => go(-1)}
            disabled={index === 0}
            className="tap inline-flex flex-1 items-center justify-center gap-1 rounded-full border border-line bg-surface px-4 text-base font-medium text-fg disabled:opacity-40"
          >
            <ChevronLeft aria-hidden="true" className="size-5" />
            {t("recipe.recipes.cookMode.back")}
          </button>
          <button
            type="button"
            onClick={() => checked.toggle(step.id)}
            aria-pressed={done}
            className={cn(
              "tap inline-flex items-center justify-center gap-1 rounded-full px-4 text-base font-medium",
              done ? "bg-success text-white" : "border border-line bg-surface text-fg",
            )}
          >
            <Check aria-hidden="true" className="size-5" />
            <span className="hidden sm:inline">
              {done ? t("recipe.recipes.cookMode.doneLabel") : t("recipe.recipes.cookMode.finish")}
            </span>
          </button>
          {index < last ? (
            <button
              type="button"
              onClick={() => {
                if (!done) checked.toggle(step.id);
                go(1);
              }}
              className="tap inline-flex flex-1 items-center justify-center gap-1 rounded-full bg-brand px-4 text-base font-semibold text-brand-fg hover:bg-brand-hover"
            >
              {t("recipe.recipes.cookMode.next")}
              <ChevronRight aria-hidden="true" className="size-5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="tap inline-flex flex-1 items-center justify-center gap-1 rounded-full bg-brand px-4 text-base font-semibold text-brand-fg hover:bg-brand-hover"
            >
              {t("recipe.recipes.cookMode.finish")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
