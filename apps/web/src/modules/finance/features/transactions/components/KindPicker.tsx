/**
 * The 2x2 grid of transaction kinds — the single most important control in
 * the app (docs/spec.md §4.5). Each tile carries THREE independent signals
 * (icon, title, one-line hint) so the four kinds are distinguishable without
 * relying on colour alone, and the selected tile adds a border + checkmark
 * rather than a colour swap for the same reason. Below the grid, one live
 * line restates what the selection means for the balance in plain German,
 * recomputed from `@toon/shared`'s `halfForOther` on every keystroke.
 */
import { Check } from "lucide-react";
import type { TxKindValue } from "@toon/shared";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { kindEffectText, TX_KIND_HINT_KEYS, TX_KIND_ICONS, TX_KIND_LABEL_KEYS, TX_KINDS, translateKind } from "../lib/kinds";

export interface KindPickerProps {
  value: TxKindValue;
  onChange: (kind: TxKindValue) => void;
  /** For the live explain line; `null` shows no line yet (amount not entered). */
  amountCents: number | null;
  /** Display name of the other household member; `null` while it is still loading. */
  otherName: string | null;
}

export function KindPicker({ value, onChange, amountCents, otherName }: KindPickerProps) {
  const t = useT();

  function move(direction: 1 | -1) {
    const index = TX_KINDS.indexOf(value);
    const next = TX_KINDS[(index + direction + TX_KINDS.length) % TX_KINDS.length];
    if (next) onChange(next);
  }

  const name = otherName ?? "…";

  return (
    <div className="flex flex-col gap-2">
      <span className="block text-control font-medium text-fg">{t("finance.transactions.form.kind")}</span>
      <div
        role="radiogroup"
        aria-label={t("finance.transactions.form.kind")}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight" || event.key === "ArrowDown") {
            event.preventDefault();
            move(1);
          } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
            event.preventDefault();
            move(-1);
          }
        }}
        className="grid grid-cols-2 gap-2 lg:grid-cols-4"
      >
        {TX_KINDS.map((kind) => {
          const Icon = TX_KIND_ICONS[kind];
          const active = kind === value;
          const label = translateKind(t, TX_KIND_LABEL_KEYS[kind], { name });
          const hint = translateKind(t, TX_KIND_HINT_KEYS[kind], { name });
          return (
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(kind)}
              className={cn(
                "relative flex min-h-[5.25rem] flex-col items-start gap-1 rounded-control border p-2.5 text-left transition-colors duration-150",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                active
                  ? "border-[1.5px] border-brand bg-brand-soft text-brand-soft-fg"
                  : "border-line bg-surface text-fg hover:border-line-strong",
              )}
            >
              <span className="flex w-full items-center justify-between">
                <Icon aria-hidden="true" className={cn("size-5", active ? "text-brand" : "text-fg-muted")} />
                {active ? <Check aria-hidden="true" className="size-4 text-brand" /> : null}
              </span>
              <span className="text-control font-semibold">{label}</span>
              <span className="text-xs leading-snug text-fg-muted">{hint}</span>
            </button>
          );
        })}
      </div>
      {amountCents !== null && amountCents !== 0 && otherName !== null ? (
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-fg-muted" aria-live="polite">
          {kindEffectText(t, value, amountCents, otherName)}
        </p>
      ) : null}
    </div>
  );
}
