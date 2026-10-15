/**
 * The fields shared by `/finance/new`, the finance quick-add sheet and `/finance/transactions/$id/edit`
 * (docs/spec.md §4.5, toon-finance 1715207): amount, kind, description, date and category, ALL of
 * them visible at once.
 *
 * There is no "Mehr Details" section any more, and it must not come back. Collapsing category and
 * date behind a disclosure made the two fields that decide whether a booking is findable later the
 * two fields nobody filled in; a chip row costs one line of height and gets tapped. Anything that
 * genuinely does not fit, the full category list, stays behind a dashed chip that opens
 * `CategorySheet`, which is a shortcut, not a hiding place.
 *
 * The screens differ only in what wraps this (the submit label, the sheet footer versus the sticky
 * bar, whether the form clears or navigates back afterwards), never in the fields themselves, so
 * that behaviour never has to fork through a boolean prop here.
 */
import { useId, useMemo, useState } from "react";
import { projectKind, type CategoryResponse, type TransactionResponse, type TxKindValue } from "@toon/shared";
import { useT } from "@/lib/i18n";
import type { FieldErrors } from "@/lib/validation";
import { AmountInput } from "./AmountInput";
import { CategorySheet } from "./CategorySheet";
import { KindPicker } from "./KindPicker";
import { TagInput } from "./TagInput";
import { Chip } from "@/components/ui/Chip";
import { Input } from "@/components/ui/Input";
import { DEFAULT_TX_KIND } from "../lib/kinds";
import { useCategoriesForPicker } from "../lib/queries";

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

/** `true` while the user has typed something a reload would throw away — feeds `useUnsavedWork` in both capture frames. */
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

/**
 * How many categories get a chip before the rest move behind "Alle N". Six fills two rows on a
 * 390px phone without pushing the description field off the sheet, and the API already returns the
 * household's categories in its own stable order: the shortlist is the head of that list, not a
 * popularity guess this component is in no position to make.
 */
const CATEGORY_CHIP_COUNT = 6;

/**
 * Group caption, the same weight as `Label` and `FieldShell` give the other groups of this form
 * (Betrag, Beschreibung), so Art, Datum and Kategorie read as one family.
 */
const GROUP_CAPTION = "text-control font-medium text-fg";

export function TransactionFormFields({ householdId, otherName, value, onChange, errors }: TransactionFormFieldsProps) {
  const t = useT();
  const descriptionId = useId();
  const [categorySheetOpen, setCategorySheetOpen] = useState(false);
  const categories = useCategoriesForPicker(householdId);

  // The shortlist always CONTAINS the current selection, even when it lives far down the list: a
  // chip row that silently drops the chosen category reads as "nothing selected" and invites a
  // second, wrong tap.
  const chipCategories = useMemo(() => {
    const items = categories.data?.items ?? [];
    const head = items.slice(0, CATEGORY_CHIP_COUNT);
    const selected = value.category;
    if (selected && !head.some((item) => item.id === selected.id)) {
      return [selected, ...head.slice(0, CATEGORY_CHIP_COUNT - 1)];
    }
    return head;
  }, [categories.data, value.category]);

  const totalCategories = categories.data?.items.length ?? 0;

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

      <div role="group" aria-label={t("finance.transactions.form.date")} className="flex flex-col gap-2">
        <span aria-hidden="true" className={GROUP_CAPTION}>
          {t("finance.transactions.form.date")}
        </span>
        <div className="flex flex-wrap gap-2">
          <Chip
            label={t("finance.common.today")}
            selected={value.dateMode === "today"}
            onSelect={() => onChange({ dateMode: "today" })}
            className="pl-3.5"
          />
          <Chip
            label={t("finance.common.yesterday")}
            selected={value.dateMode === "yesterday"}
            onSelect={() => onChange({ dateMode: "yesterday" })}
            className="pl-3.5"
          />
          <Chip
            label={t("finance.common.pickDate")}
            selected={value.dateMode === "custom"}
            onSelect={() => onChange({ dateMode: "custom" })}
            className="pl-3.5"
          />
        </div>
        {value.dateMode === "custom" ? (
          <input
            type="date"
            aria-label={t("finance.transactions.form.date")}
            value={value.customDate}
            max={todayDateInputValue()}
            onChange={(event) => onChange({ customDate: event.currentTarget.value })}
            className="w-full min-w-0 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-fg shadow-soft focus:border-brand focus:outline-2 focus:outline-offset-0 focus:outline-brand/40"
          />
        ) : null}
      </div>

      <div role="group" aria-label={t("finance.transactions.form.category")} className="flex flex-col gap-2">
        <span aria-hidden="true" className={GROUP_CAPTION}>
          {t("finance.transactions.form.category")}
        </span>
        <div className="flex flex-wrap gap-2">
          <Chip
            label={t("finance.transactions.form.categoryNone")}
            selected={value.category === null}
            onSelect={() => onChange({ category: null })}
            className="pl-3.5"
          />
          {chipCategories.map((category) => (
            <Chip
              key={category.id}
              label={category.label}
              selected={value.category?.id === category.id}
              onSelect={() => onChange({ category })}
              className="pl-3.5"
            />
          ))}
          {totalCategories > chipCategories.length ? (
            // A plain button, not a `Chip`: it opens the full list and never holds a value, so the
            // chip's `aria-pressed` would announce a state it does not have.
            <button
              type="button"
              onClick={() => setCategorySheetOpen(true)}
              className="inline-flex min-h-9 shrink-0 items-center rounded-full border border-dashed border-line-strong px-3.5 text-control font-semibold text-brand transition-colors duration-150 hover:border-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {t("finance.transactions.form.categoryAll", { count: totalCategories })}
            </button>
          ) : null}
        </div>
      </div>

      <TagInput householdId={householdId} value={value.tags} onChange={(tags) => onChange({ tags })} />

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
