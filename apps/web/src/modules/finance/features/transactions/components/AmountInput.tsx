/**
 * The amount field at the top of `/new` and the edit screen (docs/spec.md
 * §4.5) — right-aligned, huge, `tabular-nums`, always positive on screen. A
 * separate "Erstattung / Gutschrift" toggle flips the sign, so the user never
 * types a `-`: that keeps the numeric keypad purely numeric and matches how
 * the four kind tiles already read ("Ihr teilt 12,50 €", never "-12,50 €").
 *
 * Parsing goes through `parseGermanAmount` from `@toon/shared` — the same
 * function the CLI importer's tests exercise — so `"1.234,56"` / `"1234,56"`
 * / `"1234.56"` all resolve to the identical integer cents. Never
 * `parseFloat`.
 */
import { useId, useState } from "react";
import { parseGermanAmount } from "@toon/shared";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { Label } from "@/components/ui/Label";
import { Switch } from "@/components/ui/Switch";

export interface AmountInputProps {
  /** Signed cents, or `null` while the field is empty/unparsable. */
  valueCents: number | null;
  onChange: (cents: number | null) => void;
  error?: string | undefined;
  id?: string;
  autoFocus?: boolean;
}

/** `12345` -> `"123,45"` (no thousands separator, no currency sign — this is an EDIT buffer, not display text). */
function absoluteToEditText(cents: number): string {
  const sign = cents < 0 ? -1 : 1;
  const absolute = cents * sign;
  const euros = Math.floor(absolute / 100);
  const rest = String(absolute % 100).padStart(2, "0");
  return `${euros},${rest}`;
}

export function AmountInput({ valueCents, onChange, error, id: idProp, autoFocus }: AmountInputProps) {
  const t = useT();
  const generatedId = useId();
  const id = idProp ?? generatedId;
  const describedBy = error ? `${id}-error` : undefined;

  // The text buffer holds only the UNSIGNED amount as typed — the credit
  // toggle is the only thing that ever introduces a minus sign, so retyping
  // never has to fight a sign the user did not enter.
  const [text, setText] = useState(() => (valueCents !== null ? absoluteToEditText(valueCents) : ""));
  const isCredit = valueCents !== null && valueCents < 0;

  function commit(nextText: string, nextIsCredit: boolean) {
    setText(nextText);
    if (nextText.trim() === "") {
      onChange(null);
      return;
    }
    const parsed = parseGermanAmount(nextText);
    if (parsed === null) {
      onChange(null);
      return;
    }
    const absolute = Math.abs(parsed);
    onChange(nextIsCredit ? -absolute : absolute);
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id} required>
        {t("finance.transactions.form.amount")}
      </Label>
      <div className="relative">
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          autoFocus={autoFocus}
          placeholder={t("finance.transactions.form.amountPlaceholder")}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          value={text}
          onChange={(event) => commit(event.currentTarget.value, isCredit)}
          className={cn(
            "w-full min-w-0 rounded-xl border border-line bg-surface py-4 pl-4 pr-12 text-right font-display text-display-4xl font-medium",
            "text-fg tabular-nums shadow-soft transition-colors duration-150",
            "placeholder:text-fg-subtle",
            "focus:border-brand focus:outline-2 focus:outline-offset-0 focus:outline-brand/40",
            "aria-[invalid=true]:border-danger aria-[invalid=true]:focus:outline-danger/40",
          )}
        />
        {/* The glyph lives in the input's reserved right gutter (`pr-12` above), vertically centred by the
            flex box: an `absolute inset-y-0` span with `my-auto` has no height of its own, so it stuck to
            the top and overprinted the last digit of the right-aligned amount (M4 review). */}
        <span aria-hidden="true" data-amount-currency className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-display-lg text-fg-subtle">
          €
        </span>
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
      <Switch
        checked={isCredit}
        onChange={(checked) => commit(text, checked)}
        label={t("finance.transactions.form.credit")}
        description={t("finance.transactions.form.creditHint")}
      />
    </div>
  );
}
