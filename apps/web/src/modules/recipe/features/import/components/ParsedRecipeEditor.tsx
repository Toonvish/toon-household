/**
 * The PARSED pane: the same fields as a normal recipe form, plus the bulk fixers
 * that make correcting OCR fast.
 *
 * Everything goes through the pure helpers in ../lib/draftEdit, so positions stay
 * consistent and the result is always PATCH-safe.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import clsx from "clsx";
import {
  ArrowRightLeft,
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  ListPlus,
  Pencil,
  Plus,
  RefreshCw,
  Split,
  Trash2,
  X,
} from "lucide-react";
import {
  formatQuantity,
  parseDuration,
  parseNumberToken,
  type Difficulty,
  type ParsedRecipe,
} from "@toon/shared";
import { formatMinutes } from "@/modules/recipe/lib/format";
import { useT, type MessageKey } from "@/lib/i18n";
import { Button, Input, Label, Select, Textarea, readChangeValue } from "../lib/shell";
import { ConfidenceBadge, ConfidenceReasons } from "./ConfidenceBadge";
import { fieldNeedsCheck, ingredientCheck, stepCheck } from "../lib/confidence";
import {
  addIngredient,
  addStep,
  addTag,
  appendIngredientBlock,
  appendStepBlock,
  canSplitIngredient,
  canSplitStep,
  ingredientToLine,
  ingredientToStep,
  moveIngredient,
  moveStep,
  removeIngredient,
  removeStep,
  removeTag,
  renameIngredientSection,
  renameStepSection,
  reparseAllIngredients,
  reparseAllSteps,
  reparseIngredient,
  splitIngredient,
  splitStep,
  stepToIngredient,
  updateIngredient,
  updateStep,
} from "../lib/draftEdit";

export interface ParsedRecipeEditorProps {
  value: ParsedRecipe;
  onChange: (next: ParsedRecipe) => void;
  /** Existing tag names of the household, offered as a datalist. */
  tagSuggestions?: readonly string[];
  className?: string;
}

/**
 * The `value`s are DOMAIN values stored on the recipe and are locked; only the
 * label moves into the catalog (docs/i18n.md §10 rule 8). Resolved at render
 * time, never frozen into a module constant — that would pin the locale to
 * whenever this module happened to be imported.
 */
const DIFFICULTY_OPTIONS: ReadonlyArray<{ value: string; labelKey: MessageKey }> = [
  { value: "", labelKey: "recipe.import.editor.difficulty.none" },
  { value: "einfach", labelKey: "recipe.import.editor.difficulty.einfach" },
  { value: "mittel", labelKey: "recipe.import.editor.difficulty.mittel" },
  { value: "schwer", labelKey: "recipe.import.editor.difficulty.schwer" },
];

/** A short list of the most useful German units for the unit datalist. */
const UNIT_SUGGESTIONS = ["g", "kg", "ml", "l", "EL", "TL", "Prise", "Bund", "Pck.", "Stück", "Dose", "Msp.", "Tasse"];

export function ParsedRecipeEditor({ value, onChange, tagSuggestions = [], className }: ParsedRecipeEditorProps) {
  const ingredientConfidence = value.confidence.ingredients;
  const stepConfidence = value.confidence.steps;

  return (
    <div className={clsx("space-y-6", className)}>
      <BasicsSection value={value} onChange={onChange} tagSuggestions={tagSuggestions} />
      <IngredientsSection value={value} onChange={onChange} listConfidence={ingredientConfidence} />
      <StepsSection value={value} onChange={onChange} listConfidence={stepConfidence} />
      <NotesSection value={value} onChange={onChange} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* small field helpers                                                         */
/* -------------------------------------------------------------------------- */

/**
 * `Card` (padding="md" -> `rounded-card border border-line bg-surface p-4`) shaped
 * by hand rather than composed from `components/ui/CardHeader`: that primitive
 * takes one title and one action, and every section here needs a title PLUS a
 * confidence badge PLUS a row of ghost-button actions all sharing the header line.
 * The heading itself still takes `CardHeader`'s own step — `font-display
 * text-display-sm font-medium` — so the four panes read as one family with every
 * other card heading in the app.
 */
function SectionCard({
  title,
  hint,
  badge,
  actions,
  children,
}: {
  title: string;
  hint?: string;
  badge?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-card border border-line bg-surface p-4">
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="font-display text-display-sm font-medium text-fg">{title}</h3>
        {badge}
        {actions !== undefined ? <div className="ml-auto flex flex-wrap gap-1">{actions}</div> : null}
      </header>
      {hint !== undefined ? <p className="mb-3 text-xs text-fg-muted">{hint}</p> : null}
      {children}
    </section>
  );
}

/** Tiny ghost button used for the many row actions. */
function RowAction({
  label,
  onClick,
  disabled = false,
  danger = false,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={clsx(
        "rounded-md p-1.5 transition disabled:cursor-not-allowed disabled:opacity-30",
        danger
          ? "text-danger hover:bg-danger-soft"
          : "text-fg-muted hover:bg-surface-2 hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Quantity input that understands what German recipes actually contain:
 * "1,5", "1 1/2", "½". Keeps a text buffer so typing is never fought by
 * re-formatting.
 */
function QuantityField({
  value,
  onCommit,
  ariaLabel,
  placeholder,
}: {
  value: number | null | undefined;
  onCommit: (next: number | undefined) => void;
  ariaLabel: string;
  placeholder?: string;
}) {
  const [text, setText] = useState(() => (value === null || value === undefined ? "" : formatQuantity(value)));

  useEffect(() => {
    const fromText = text.trim().length === 0 ? undefined : parseNumberToken(text.trim());
    const current = value ?? undefined;
    if (fromText !== current) setText(current === undefined ? "" : formatQuantity(current));
    // Only react to external changes.
  }, [value]);

  return (
    <Input
      value={text}
      inputMode="decimal"
      aria-label={ariaLabel}
      placeholder={placeholder}
      className="w-full"
      onChange={(event) => {
        const next = readChangeValue(event);
        setText(next);
        const trimmed = next.trim();
        onCommit(trimmed.length === 0 ? undefined : parseNumberToken(trimmed));
      }}
    />
  );
}

/**
 * Minutes input that also accepts free German text ("1 Std 15 Min", "PT30M")
 * via parseDuration — a big time saver when copying from a photo.
 */
function MinutesField({
  id,
  value,
  onCommit,
  label,
}: {
  id: string;
  value: number | null | undefined;
  onCommit: (next: number | undefined) => void;
  label: string;
}) {
  const t = useT();
  const [text, setText] = useState(() => (value === null || value === undefined ? "" : String(value)));

  useEffect(() => {
    const fromText = text.trim().length === 0 ? undefined : parseDuration(text.trim());
    const current = value ?? undefined;
    if (fromText !== current) setText(current === undefined ? "" : String(current));
  }, [value]);

  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs font-medium text-fg-muted">
        {label}
      </Label>
      <Input
        id={id}
        value={text}
        inputMode="text"
        placeholder={t("recipe.import.editor.minutes.placeholder")}
        onChange={(event) => {
          const next = readChangeValue(event);
          setText(next);
          const trimmed = next.trim();
          onCommit(trimmed.length === 0 ? undefined : parseDuration(trimmed));
        }}
      />
      {typeof value === "number" && value > 0 ? (
        <p className="text-[11px] text-fg-muted">{formatMinutes(value)}</p>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* basics                                                                      */
/* -------------------------------------------------------------------------- */

function BasicsSection({
  value,
  onChange,
  tagSuggestions,
}: {
  value: ParsedRecipe;
  onChange: (next: ParsedRecipe) => void;
  tagSuggestions: readonly string[];
}) {
  const t = useT();
  const [tagDraft, setTagDraft] = useState("");
  const titleNeedsCheck = fieldNeedsCheck(value, "title");
  const servingsNeedsCheck = fieldNeedsCheck(value, "servings");
  const timesNeedCheck = fieldNeedsCheck(value, "times");

  const commitTag = () => {
    const next = addTag(value, tagDraft);
    if (next !== value) onChange(next);
    setTagDraft("");
  };

  return (
    <SectionCard title={t("recipe.import.editor.basics.title")}>
      <div className="space-y-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Label htmlFor="import-title" className="text-xs font-medium text-fg-muted">
              {t("recipe.import.editor.title.label")}
            </Label>
            {titleNeedsCheck ? <ConfidenceBadge value={value.confidence.title} /> : null}
          </div>
          <Input
            id="import-title"
            value={value.title ?? ""}
            placeholder={t("recipe.import.editor.title.placeholder")}
            aria-invalid={(value.title ?? "").trim().length === 0}
            onChange={(event) => onChange({ ...value, title: readChangeValue(event) })}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="import-description" className="text-xs font-medium text-fg-muted">
            {t("recipe.import.editor.description.label")}
          </Label>
          <Textarea
            id="import-description"
            rows={2}
            value={value.description ?? ""}
            placeholder={t("recipe.import.editor.description.placeholder")}
            onChange={(event) => onChange({ ...value, description: readChangeValue(event) })}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Label htmlFor="import-servings" className="text-xs font-medium text-fg-muted">
                {t("recipe.import.editor.servings.label")}
              </Label>
              {servingsNeedsCheck ? <ConfidenceBadge value={value.confidence.servings} /> : null}
            </div>
            <QuantityField
              ariaLabel={t("recipe.import.editor.servings.ariaLabel")}
              placeholder="4"
              value={value.servings?.amount}
              onCommit={(amount) =>
                onChange({
                  ...value,
                  servings:
                    amount === undefined || amount <= 0
                      ? undefined
                      // Same key `formState.ts` and `draftEdit.ts` already write into
                      // data for a missing servings unit — one decision, one place.
                      : { amount, unit: value.servings?.unit ?? t("common.servings.defaultUnit") },
                })
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="import-servings-unit" className="text-xs font-medium text-fg-muted">
              {t("recipe.import.editor.servingsUnit.label")}
            </Label>
            <Input
              id="import-servings-unit"
              value={value.servings?.unit ?? ""}
              placeholder={t("common.servings.defaultUnit")}
              onChange={(event) => {
                const unit = readChangeValue(event);
                onChange({
                  ...value,
                  servings:
                    value.servings === undefined
                      ? unit.trim().length === 0
                        ? undefined
                        : { amount: 4, unit }
                      : { ...value.servings, unit },
                });
              }}
            />
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center gap-2">
            <span className="text-xs font-medium text-fg-muted">{t("recipe.import.editor.times.label")}</span>
            {timesNeedCheck ? <ConfidenceBadge value={value.confidence.times} /> : null}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <MinutesField
              id="import-prep"
              label={t("recipe.import.editor.times.prep")}
              value={value.prepMinutes}
              onCommit={(next) => onChange({ ...value, prepMinutes: next })}
            />
            <MinutesField
              id="import-cook"
              label={t("recipe.import.editor.times.cook")}
              value={value.cookMinutes}
              onCommit={(next) => onChange({ ...value, cookMinutes: next })}
            />
            <MinutesField
              id="import-total"
              label={t("recipe.import.editor.times.total")}
              value={value.totalMinutes}
              onCommit={(next) => onChange({ ...value, totalMinutes: next })}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="import-difficulty" className="text-xs font-medium text-fg-muted">
              {t("recipe.import.editor.difficulty.label")}
            </Label>
            <Select
              id="import-difficulty"
              value={value.difficulty ?? ""}
              options={DIFFICULTY_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }))}
              onChange={(event) => {
                const next = readChangeValue(event);
                onChange({ ...value, difficulty: next.length === 0 ? undefined : (next as Difficulty) });
              }}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="import-source" className="text-xs font-medium text-fg-muted">
              {t("recipe.import.editor.source.label")}
            </Label>
            <Input
              id="import-source"
              value={value.sourceName ?? ""}
              placeholder={t("recipe.import.editor.source.placeholder")}
              onChange={(event) => onChange({ ...value, sourceName: readChangeValue(event) })}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="import-tags" className="text-xs font-medium text-fg-muted">
            {t("recipe.import.editor.tags.label")}
          </Label>
          {value.tags.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {value.tags.map((tag) => (
                <li key={tag}>
                  <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 py-1 pl-2.5 pr-1 text-xs text-fg">
                    {tag}
                    <button
                      type="button"
                      onClick={() => onChange(removeTag(value, tag))}
                      aria-label={t("recipe.import.editor.tags.remove", { tag })}
                      className="rounded-full p-0.5 hover:bg-surface-2"
                    >
                      <X aria-hidden className="h-3 w-3" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex gap-2">
            <Input
              id="import-tags"
              containerClassName="flex-1"
              value={tagDraft}
              list="import-tag-suggestions"
              placeholder={t("recipe.import.editor.tags.placeholder")}
              onChange={(event) => setTagDraft(readChangeValue(event))}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === ",") {
                  event.preventDefault();
                  commitTag();
                }
              }}
            />
            <Button type="button" variant="secondary" onClick={commitTag} disabled={tagDraft.trim().length === 0}>
              <Plus aria-hidden className="h-4 w-4" />
            </Button>
          </div>
          <datalist id="import-tag-suggestions">
            {tagSuggestions.map((tag) => (
              <option key={tag} value={tag} />
            ))}
          </datalist>
        </div>
      </div>
    </SectionCard>
  );
}

/* -------------------------------------------------------------------------- */
/* ingredients                                                                 */
/* -------------------------------------------------------------------------- */

function IngredientsSection({
  value,
  onChange,
  listConfidence,
}: {
  value: ParsedRecipe;
  onChange: (next: ParsedRecipe) => void;
  listConfidence?: number;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");

  const flagged = useMemo(
    () => value.ingredients.filter((item) => ingredientCheck(item, listConfidence).needsCheck).length,
    [value.ingredients, listConfidence],
  );

  const toggleExpanded = (index: number) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  return (
    <SectionCard
      title={t("recipe.import.editor.ingredients.title", { count: value.ingredients.length })}
      badge={
        flagged > 0 ? <ConfidenceBadge level="low" label={t("recipe.import.editor.flagged", { count: flagged })} /> : null
      }
      actions={
        <>
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(reparseAllIngredients(value))}>
            <RefreshCw aria-hidden className="mr-1 h-3.5 w-3.5" />
            {t("recipe.import.editor.ingredients.reparseAll")}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setPasteOpen((open) => !open)}>
            <ClipboardPaste aria-hidden className="mr-1 h-3.5 w-3.5" />
            {t("recipe.import.editor.pasteText")}
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => onChange(addIngredient(value))}>
            <Plus aria-hidden className="mr-1 h-3.5 w-3.5" />
            {t("recipe.import.editor.ingredients.addRow")}
          </Button>
        </>
      }
    >
      {pasteOpen ? (
        <div className="mb-4 space-y-2 rounded-lg bg-surface-2 p-3">
          <Textarea
            rows={5}
            value={pasteText}
            placeholder={t("recipe.import.editor.ingredients.paste.placeholder")}
            onChange={(event) => setPasteText(readChangeValue(event))}
          />
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={() => {
                onChange(appendIngredientBlock(value, pasteText));
                setPasteText("");
                setPasteOpen(false);
              }}
              disabled={pasteText.trim().length === 0}
            >
              {t("recipe.import.editor.ingredients.paste.submit")}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setPasteOpen(false)}>
              {t("recipe.import.editor.cancel")}
            </Button>
          </div>
        </div>
      ) : null}

      {value.ingredients.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line-strong p-4 text-center text-sm text-fg-muted">
          {t("recipe.import.editor.ingredients.empty")}
        </p>
      ) : (
        <ul className="space-y-3">
          {value.ingredients.map((ingredient, index) => {
            const previousSection = index === 0 ? undefined : (value.ingredients[index - 1]?.section ?? undefined);
            const showHeading = (ingredient.section ?? undefined) !== previousSection;
            const check = ingredientCheck(ingredient, listConfidence);
            const isExpanded = expanded.has(index);
            return (
              <li key={index}>
                {showHeading && (ingredient.section ?? "").length > 0 ? (
                  <Input
                    value={ingredient.section ?? ""}
                    aria-label={t("recipe.import.editor.section.ariaLabel")}
                    className="mb-2 font-semibold"
                    onChange={(event) => onChange(renameIngredientSection(value, index, readChangeValue(event)))}
                  />
                ) : null}
                <div
                  className={clsx(
                    "rounded-lg border p-2",
                    check.needsCheck
                      ? "border-warning/40 bg-warning-soft/60"
                      : "border-line",
                  )}
                >
                  {/* minmax(0,1fr), not 1fr: a plain `1fr` track keeps its automatic
                      minimum, so the name field's intrinsic width would widen the row
                      past the viewport on a phone. */}
                  <div className="grid grid-cols-[4rem_4.5rem_minmax(0,1fr)] gap-2">
                    <QuantityField
                      ariaLabel={t("recipe.import.editor.ingredients.quantity.ariaLabel", { index: index + 1 })}
                      placeholder={t("recipe.import.editor.ingredients.quantity.placeholder")}
                      value={ingredient.quantity}
                      onCommit={(quantity) => onChange(updateIngredient(value, index, { quantity }))}
                    />
                    <Input
                      value={ingredient.unit ?? ""}
                      list="import-unit-suggestions"
                      aria-label={t("recipe.import.editor.ingredients.unit.ariaLabel", { index: index + 1 })}
                      placeholder={t("recipe.import.editor.ingredients.unit.placeholder")}
                      onChange={(event) => onChange(updateIngredient(value, index, { unit: readChangeValue(event) }))}
                    />
                    <Input
                      value={ingredient.name}
                      aria-label={t("recipe.import.editor.ingredients.name.ariaLabel", { index: index + 1 })}
                      placeholder={t("recipe.import.editor.ingredients.name.placeholder")}
                      onChange={(event) => onChange(updateIngredient(value, index, { name: readChangeValue(event) }))}
                    />
                  </div>

                  {isExpanded ? (
                    <div className="mt-2 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <QuantityField
                          ariaLabel={t("recipe.import.editor.ingredients.quantityMax.ariaLabel", { index: index + 1 })}
                          placeholder={t("recipe.import.editor.ingredients.quantityMax.placeholder")}
                          value={ingredient.quantityMax}
                          onCommit={(quantityMax) => onChange(updateIngredient(value, index, { quantityMax }))}
                        />
                        <Input
                          value={ingredient.note ?? ""}
                          aria-label={t("recipe.import.editor.ingredients.note.ariaLabel", { index: index + 1 })}
                          placeholder={t("recipe.import.editor.ingredients.note.placeholder")}
                          onChange={(event) => onChange(updateIngredient(value, index, { note: readChangeValue(event) }))}
                        />
                      </div>
                      <Input
                        value={ingredient.section ?? ""}
                        aria-label={t("recipe.import.editor.ingredients.section.ariaLabel", { index: index + 1 })}
                        placeholder={t("recipe.import.editor.ingredients.section.placeholder")}
                        onChange={(event) => onChange(updateIngredient(value, index, { section: readChangeValue(event) }))}
                      />
                      <div className="space-y-1">
                        <Label className="text-[11px] font-medium text-fg-muted">
                          {t("recipe.import.editor.ingredients.raw.label")}
                        </Label>
                        <div className="flex gap-2">
                          <Input
                            value={ingredient.raw ?? ""}
                            containerClassName="flex-1"
                            aria-label={t("recipe.import.editor.ingredients.raw.ariaLabel", { index: index + 1 })}
                            className="font-mono text-[13px]"
                            onChange={(event) => onChange(updateIngredient(value, index, { raw: readChangeValue(event) }))}
                          />
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => onChange(reparseIngredient(value, index))}
                            title={t("recipe.import.editor.ingredients.raw.reparse")}
                          >
                            <RefreshCw aria-hidden className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-1.5 flex items-center gap-0.5">
                    <RowAction
                      label={t("recipe.import.editor.row.up")}
                      onClick={() => onChange(moveIngredient(value, index, index - 1))}
                      disabled={index === 0}
                    >
                      <ChevronUp aria-hidden className="h-4 w-4" />
                    </RowAction>
                    <RowAction
                      label={t("recipe.import.editor.row.down")}
                      onClick={() => onChange(moveIngredient(value, index, index + 1))}
                      disabled={index === value.ingredients.length - 1}
                    >
                      <ChevronDown aria-hidden className="h-4 w-4" />
                    </RowAction>
                    <RowAction
                      label={t("recipe.import.editor.ingredients.row.reparse")}
                      onClick={() => onChange(reparseIngredient(value, index))}
                    >
                      <RefreshCw aria-hidden className="h-4 w-4" />
                    </RowAction>
                    <RowAction
                      label={t("recipe.import.editor.ingredients.row.split")}
                      onClick={() => onChange(splitIngredient(value, index))}
                      disabled={!canSplitIngredient(ingredient)}
                    >
                      <Split aria-hidden className="h-4 w-4" />
                    </RowAction>
                    <RowAction
                      label={t("recipe.import.editor.ingredients.row.toStep")}
                      onClick={() => onChange(ingredientToStep(value, index))}
                    >
                      <ArrowRightLeft aria-hidden className="h-4 w-4" />
                    </RowAction>
                    <RowAction label={t("recipe.import.editor.row.editDetails")} onClick={() => toggleExpanded(index)}>
                      <Pencil aria-hidden className="h-4 w-4" />
                    </RowAction>
                    <RowAction
                      label={t("recipe.import.editor.row.delete")}
                      danger
                      onClick={() => onChange(removeIngredient(value, index))}
                    >
                      <Trash2 aria-hidden className="h-4 w-4" />
                    </RowAction>
                    {!isExpanded && (ingredient.note ?? "").length > 0 ? (
                      <span className="ml-1 truncate text-[11px] text-fg-muted">
                        {ingredient.note}
                      </span>
                    ) : null}
                  </div>

                  {check.needsCheck ? <ConfidenceReasons reasons={check.reasons} className="mt-1" /> : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <datalist id="import-unit-suggestions">
        {UNIT_SUGGESTIONS.map((unit) => (
          <option key={unit} value={unit} />
        ))}
      </datalist>
    </SectionCard>
  );
}

/* -------------------------------------------------------------------------- */
/* steps                                                                       */
/* -------------------------------------------------------------------------- */

function StepsSection({
  value,
  onChange,
  listConfidence,
}: {
  value: ParsedRecipe;
  onChange: (next: ParsedRecipe) => void;
  listConfidence?: number;
}) {
  const t = useT();
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [sectionOpen, setSectionOpen] = useState<Set<number>>(() => new Set());

  const flagged = useMemo(
    () => value.steps.filter((item) => stepCheck(item, listConfidence).needsCheck).length,
    [value.steps, listConfidence],
  );

  return (
    <SectionCard
      title={t("recipe.import.editor.steps.title", { count: value.steps.length })}
      badge={
        flagged > 0 ? <ConfidenceBadge level="low" label={t("recipe.import.editor.flagged", { count: flagged })} /> : null
      }
      actions={
        <>
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(reparseAllSteps(value))}>
            <RefreshCw aria-hidden className="mr-1 h-3.5 w-3.5" />
            {t("recipe.import.editor.steps.resplit")}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setPasteOpen((open) => !open)}>
            <ClipboardPaste aria-hidden className="mr-1 h-3.5 w-3.5" />
            {t("recipe.import.editor.pasteText")}
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => onChange(addStep(value))}>
            <Plus aria-hidden className="mr-1 h-3.5 w-3.5" />
            {t("recipe.import.editor.steps.addStep")}
          </Button>
        </>
      }
    >
      {pasteOpen ? (
        <div className="mb-4 space-y-2 rounded-lg bg-surface-2 p-3">
          <Textarea
            rows={6}
            value={pasteText}
            placeholder={t("recipe.import.editor.steps.paste.placeholder")}
            onChange={(event) => setPasteText(readChangeValue(event))}
          />
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={() => {
                onChange(appendStepBlock(value, pasteText));
                setPasteText("");
                setPasteOpen(false);
              }}
              disabled={pasteText.trim().length === 0}
            >
              {t("recipe.import.editor.steps.paste.submit")}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setPasteOpen(false)}>
              {t("recipe.import.editor.cancel")}
            </Button>
          </div>
        </div>
      ) : null}

      {value.steps.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line-strong p-4 text-center text-sm text-fg-muted">
          {t("recipe.import.editor.steps.empty")}
        </p>
      ) : (
        <ol className="space-y-3">
          {value.steps.map((step, index) => {
            const previousSection = index === 0 ? undefined : (value.steps[index - 1]?.section ?? undefined);
            const showHeading = (step.section ?? undefined) !== previousSection && (step.section ?? "").length > 0;
            const check = stepCheck(step, listConfidence);
            const isSectionOpen = sectionOpen.has(index);
            return (
              <li key={index}>
                {showHeading ? (
                  <Input
                    value={step.section ?? ""}
                    aria-label={t("recipe.import.editor.section.ariaLabel")}
                    className="mb-2 font-semibold"
                    onChange={(event) => onChange(renameStepSection(value, index, readChangeValue(event)))}
                  />
                ) : null}
                <div
                  className={clsx(
                    "rounded-lg border p-2",
                    check.needsCheck
                      ? "border-warning/40 bg-warning-soft/60"
                      : "border-line",
                  )}
                >
                  <div className="flex gap-2">
                    <span className="mt-2 w-5 shrink-0 text-right text-xs font-semibold tabular-nums text-fg-subtle">
                      {index + 1}.
                    </span>
                    <div className="min-w-0 flex-1">
                      <Textarea
                        rows={Math.min(8, Math.max(2, Math.ceil(step.text.length / 60)))}
                        value={step.text}
                        aria-label={t("recipe.import.editor.steps.text.ariaLabel", { index: index + 1 })}
                        placeholder={t("recipe.import.editor.steps.text.placeholder")}
                        onChange={(event) => onChange(updateStep(value, index, { text: readChangeValue(event) }))}
                      />
                      {isSectionOpen ? (
                        <Input
                          value={step.section ?? ""}
                          aria-label={t("recipe.import.editor.steps.section.ariaLabel", { index: index + 1 })}
                          placeholder={t("recipe.import.editor.steps.section.placeholder")}
                          className="mt-2"
                          onChange={(event) => onChange(updateStep(value, index, { section: readChangeValue(event) }))}
                        />
                      ) : null}
                      <div className="mt-1.5 flex items-center gap-0.5">
                        <RowAction
                          label={t("recipe.import.editor.row.up")}
                          onClick={() => onChange(moveStep(value, index, index - 1))}
                          disabled={index === 0}
                        >
                          <ChevronUp aria-hidden className="h-4 w-4" />
                        </RowAction>
                        <RowAction
                          label={t("recipe.import.editor.row.down")}
                          onClick={() => onChange(moveStep(value, index, index + 1))}
                          disabled={index === value.steps.length - 1}
                        >
                          <ChevronDown aria-hidden className="h-4 w-4" />
                        </RowAction>
                        <RowAction
                          label={t("recipe.import.editor.steps.row.split")}
                          onClick={() => onChange(splitStep(value, index))}
                          disabled={!canSplitStep(step)}
                        >
                          <Split aria-hidden className="h-4 w-4" />
                        </RowAction>
                        <RowAction
                          label={t("recipe.import.editor.steps.row.toIngredient")}
                          onClick={() => onChange(stepToIngredient(value, index))}
                        >
                          <ListPlus aria-hidden className="h-4 w-4" />
                        </RowAction>
                        <RowAction
                          label={t("recipe.import.editor.steps.row.editSection")}
                          onClick={() =>
                            setSectionOpen((current) => {
                              const next = new Set(current);
                              if (next.has(index)) next.delete(index);
                              else next.add(index);
                              return next;
                            })
                          }
                        >
                          <Pencil aria-hidden className="h-4 w-4" />
                        </RowAction>
                        <RowAction
                          label={t("recipe.import.editor.steps.row.delete")}
                          danger
                          onClick={() => onChange(removeStep(value, index))}
                        >
                          <Trash2 aria-hidden className="h-4 w-4" />
                        </RowAction>
                      </div>
                      {check.needsCheck ? <ConfidenceReasons reasons={check.reasons} className="mt-1" /> : null}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </SectionCard>
  );
}

/* -------------------------------------------------------------------------- */
/* notes                                                                       */
/* -------------------------------------------------------------------------- */

function NotesSection({ value, onChange }: { value: ParsedRecipe; onChange: (next: ParsedRecipe) => void }) {
  const t = useT();
  return (
    <SectionCard title={t("recipe.import.editor.notes.title")} hint={t("recipe.import.editor.notes.hint")}>
      <Textarea
        rows={3}
        value={value.notes ?? ""}
        aria-label={t("recipe.import.editor.notes.ariaLabel")}
        placeholder={t("recipe.import.editor.notes.placeholder")}
        onChange={(event) => onChange({ ...value, notes: readChangeValue(event) })}
      />
    </SectionCard>
  );
}

export default ParsedRecipeEditor;
