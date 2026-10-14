/**
 * The fields shared by `/new` and `/transactions/$id/edit` (docs/spec.md
 * §4.5): amount, kind, description, and a collapsed-by-default "Mehr
 * Details" section (category, tags, date). The two screens differ only in
 * what wraps this — the submit label, the sticky bar, and whether the form
 * clears or navigates back afterwards — never in the fields themselves, so
 * that behaviour never has to fork through a boolean prop here.
 */
import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { projectKind, type CategoryResponse, type TransactionResponse, type TxKindValue } from "@toon/shared";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import type { FieldErrors } from "@/lib/validation";
import { AmountInput } from "./AmountInput";
import { CategorySheet } from "./CategorySheet";
import { KindPicker } from "./KindPicker";
import { TagInput } from "./TagInput";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { DEFAULT_TX_KIND } from "../lib/kinds";

/** Everything the form needs, independent of create-vs-edit. */
export interface TransactionFormState {
  kind: TxKindValue;
  amountCents: number | null;
  description: string;
  category: CategoryResponse | null;
  tags: string[];
  dateMode: "today" | "yesterday" | "custom";
  /** `YYYY-MM-DD`, only meaningful (and shown) while `dateMode === "custom"`. */
  customDate: string;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function toDateInputValue(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function todayDateInputValue(): string {
  return toDateInputValue(new Date());
}

function yesterdayDateInputValue(): string {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return toDateInputValue(date);
}

export function createEmptyFormState(defaultKind: TxKindValue = DEFAULT_TX_KIND): TransactionFormState {
  return {
    kind: defaultKind,
    amountCents: null,
    description: "",
    category: null,
    tags: [],
    dateMode: "today",
    customDate: todayDateInputValue(),
  };
}

/** `true` while the user has typed something a reload would throw away — feeds `useUnsavedWork` on `/new`. */
export function isFormDirty(state: TransactionFormState): boolean {
  return state.amountCents !== null || state.description.trim().length > 0;
}

/** The effective booked date as local midnight, ISO — the wire's `bookedAt`. */
export function resolvedBookedAtIso(state: TransactionFormState): string {
  const dateValue =
    state.dateMode === "today"
      ? todayDateInputValue()
      : state.dateMode === "yesterday"
        ? yesterdayDateInputValue()
        : state.customDate;
  const parts = dateValue.split("-").map(Number);
  const year = parts[0] ?? new Date().getFullYear();
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;
  return new Date(year, month - 1, day, 0, 0, 0, 0).toISOString();
}

/** Which `dateMode` a stored ISO date corresponds to — used to prefill the edit screen. */
export function dateModeForIso(iso: string): { dateMode: TransactionFormState["dateMode"]; customDate: string } {
  const value = toDateInputValue(new Date(iso));
  if (value === todayDateInputValue()) return { dateMode: "today", customDate: value };
  if (value === yesterdayDateInputValue()) return { dateMode: "yesterday", customDate: value };
  return { dateMode: "custom", customDate: value };
}

/**
 * Prefills the edit screen from a fetched row. `projectKind` only ever
 * returns `null` for the two storage shapes no UI button creates
 * (docs/ledger-spec.md §2.2) — imported history, never a `manual` row, and
 * `PATCH` is 409 on anything but `manual` anyway, so the fallback below is
 * unreachable in practice, not a silent misrepresentation.
 */
export function formStateFromTransaction(
  transaction: TransactionResponse,
  viewerId: string,
  category: CategoryResponse | null,
): TransactionFormState {
  const kind =
    projectKind({ payerId: transaction.payerId, splitMode: transaction.splitMode }, viewerId) ?? DEFAULT_TX_KIND;
  const { dateMode, customDate } = dateModeForIso(transaction.bookedAt);
  return {
    kind,
    amountCents: transaction.amountCents,
    description: transaction.description,
    category,
    tags: transaction.tags.map((tag) => tag.name),
    dateMode,
    customDate,
  };
}

export interface TransactionFormFieldsProps {
  householdId: string;
  /** `null` while the other member is still loading — `KindPicker` shows a placeholder in that case. */
  otherName: string | null;
  value: TransactionFormState;
  onChange: (patch: Partial<TransactionFormState>) => void;
  errors: FieldErrors;
}

export function TransactionFormFields({ householdId, otherName, value, onChange, errors }: TransactionFormFieldsProps) {
  const t = useT();
  const descriptionId = useId();
  const [detailsOpen, setDetailsOpen] = useState(
    () => value.category !== null || value.tags.length > 0 || value.dateMode !== "today",
  );
  const [categorySheetOpen, setCategorySheetOpen] = useState(false);

  return (
    <div className="flex flex-col gap-5">
      <AmountInput
        valueCents={value.amountCents}
        onChange={(cents) => onChange({ amountCents: cents })}
        error={errors.amountCents}
        autoFocus
      />

      <KindPicker
        value={value.kind}
        onChange={(kind) => onChange({ kind })}
        amountCents={value.amountCents}
        otherName={otherName}
      />

      <Input
        id={descriptionId}
        label={t("finance.transactions.form.description")}
        placeholder={t("finance.transactions.form.descriptionPlaceholder")}
        value={value.description}
        error={errors.description}
        onChange={(event) => onChange({ description: event.currentTarget.value })}
        required
      />

      <div className="flex flex-col gap-3 border-t border-line pt-4">
        <button
          type="button"
          onClick={() => setDetailsOpen((open) => !open)}
          aria-expanded={detailsOpen}
          className="flex min-h-11 items-center justify-between text-left text-sm font-semibold text-fg"
        >
          {t("finance.transactions.form.moreDetails")}
          <ChevronDown aria-hidden="true" className={cn("size-5 transition-transform duration-150", detailsOpen && "rotate-180")} />
        </button>

        {detailsOpen ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-fg">{t("finance.transactions.form.category")}</span>
              <button
                type="button"
                onClick={() => setCategorySheetOpen(true)}
                className="flex min-h-11 items-center justify-between rounded-xl border border-line bg-surface px-3.5 py-2.5 text-left text-fg shadow-soft transition-colors duration-150 hover:border-line-strong"
              >
                <span className="truncate">{value.category?.label ?? t("finance.transactions.form.categoryNone")}</span>
                <ChevronDown aria-hidden="true" className="size-4 shrink-0 -rotate-90 text-fg-subtle" />
              </button>
            </div>

            <TagInput householdId={householdId} value={value.tags} onChange={(tags) => onChange({ tags })} />

            <Select
              label={t("finance.transactions.form.date")}
              value={value.dateMode}
              onChange={(event) => onChange({ dateMode: event.currentTarget.value as TransactionFormState["dateMode"] })}
              options={[
                { value: "today", label: t("finance.common.today") },
                { value: "yesterday", label: t("finance.common.yesterday") },
                { value: "custom", label: t("finance.common.pickDate") },
              ]}
            />
            {value.dateMode === "custom" ? (
              <input
                type="date"
                value={value.customDate}
                max={todayDateInputValue()}
                onChange={(event) => onChange({ customDate: event.currentTarget.value })}
                className="w-full min-w-0 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-fg shadow-soft focus:border-brand focus:outline-2 focus:outline-offset-0 focus:outline-brand/40"
              />
            ) : null}
          </div>
        ) : null}
      </div>

      <CategorySheet
        open={categorySheetOpen}
        onClose={() => setCategorySheetOpen(false)}
        householdId={householdId}
        value={value.category?.id ?? null}
        onSelect={(category) => onChange({ category })}
      />
    </div>
  );
}
