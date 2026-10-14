/**
 * Steps editor: autosizing textareas, section headings, touch-friendly reordering with
 * always-visible up/down buttons, and a paste-a-block field that runs `parseStepBlock`
 * from @toon/shared (recognises "1." / "1)" / "Schritt 1" numbering and paragraphs).
 */
import { useId, useState } from "react";
import { ArrowDown, ArrowUp, ClipboardPaste, Plus, Trash2 } from "lucide-react";
import { Button, Dialog, IconButton, Input, Textarea } from "@/components/ui";
import { useT } from "@/lib/i18n";
import type { FieldErrors } from "@/lib/validation";
import { moveItem, moveTargetIndex, patchRow, removeRow } from "../lib/hooks";
import { sectionNames } from "../lib/format";
import { emptyStepRow, rowsFromPastedSteps, type StepRow } from "../lib/formState";

export interface StepsEditorProps {
  rows: StepRow[];
  onChange: (rows: StepRow[]) => void;
  /** Server-side field errors keyed "steps.<index>.<field>". */
  errors?: FieldErrors;
  disabled?: boolean;
}

export function StepsEditor({ rows, onChange, errors = {}, disabled = false }: StepsEditorProps) {
  const t = useT();
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [status, setStatus] = useState("");
  const sectionListId = useId();
  const sections = sectionNames(rows);

  function patch(index: number, changes: Partial<StepRow>) {
    onChange(patchRow(rows, index, changes));
  }

  function move(index: number, delta: number) {
    const target = moveTargetIndex(rows.length, index, delta);
    if (target === undefined) return;
    onChange(moveItem(rows, index, target));
    setStatus(t("recipe.recipes.stepsEditor.status.moved", { position: target + 1 }));
  }

  function remove(index: number) {
    onChange(removeRow(rows, index, emptyStepRow));
    setStatus(t("recipe.recipes.stepsEditor.status.removed"));
  }

  function applyPaste() {
    const parsed = rowsFromPastedSteps(pasteText);
    if (parsed.length === 0) {
      setStatus(t("recipe.recipes.stepsEditor.status.pasteEmpty"));
      return;
    }
    const keep = rows.filter((row) => row.text.trim().length > 0);
    onChange([...keep, ...parsed]);
    setPasteText("");
    setPasteOpen(false);
    setStatus(t("recipe.recipes.stepsEditor.status.pasted", { count: parsed.length }));
  }

  return (
    <div className="flex flex-col gap-3">
      <datalist id={sectionListId}>
        {sections.map((section) => (
          <option key={section} value={section} />
        ))}
      </datalist>

      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-display-md font-medium">{t("recipe.recipes.steps.heading")}</h2>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setPasteOpen(true)}
          disabled={disabled}
          leftIcon={<ClipboardPaste className="size-4" />}
        >
          {t("recipe.recipes.stepsEditor.insertAction")}
        </Button>
      </div>

      <p aria-live="polite" className="sr-only">
        {status}
      </p>

      <ol className="flex flex-col gap-3">
        {rows.map((row, index) => {
          const prefix = `steps.${index}`;
          const isFirstOfSection = index === 0 || rows[index - 1]?.section !== row.section;
          return (
            <li
              key={row.key}
              className="flex flex-col gap-2 rounded-card border border-line bg-surface p-3"
            >
              {isFirstOfSection || row.section.length > 0 ? (
                <Input
                  label={t("recipe.recipes.ingredientsEditor.section.label")}
                  optional
                  list={sectionListId}
                  value={row.section}
                  onChange={(event) => patch(index, { section: event.target.value })}
                  placeholder={t("recipe.recipes.stepsEditor.section.placeholder")}
                  disabled={disabled}
                  error={errors[`${prefix}.section`]}
                />
              ) : null}

              <Textarea
                label={t("recipe.recipes.stepsEditor.text.label", { index: index + 1 })}
                required
                autoGrow
                rows={3}
                value={row.text}
                onChange={(event) => patch(index, { text: event.target.value })}
                placeholder={t("recipe.recipes.stepsEditor.text.placeholder")}
                disabled={disabled}
                error={errors[`${prefix}.text`]}
              />

              <div className="flex items-center justify-between gap-1">
                <span className="text-xs text-fg-subtle tabular-nums">
                  {t("recipe.recipes.editor.positionOf", { index: index + 1, total: rows.length })}
                </span>
                <div className="flex items-center gap-1">
                  <IconButton
                    label={t("recipe.recipes.stepsEditor.moveUpAction", { index: index + 1 })}
                    icon={<ArrowUp />}
                    size="sm"
                    onClick={() => move(index, -1)}
                    disabled={disabled || index === 0}
                  />
                  <IconButton
                    label={t("recipe.recipes.stepsEditor.moveDownAction", { index: index + 1 })}
                    icon={<ArrowDown />}
                    size="sm"
                    onClick={() => move(index, 1)}
                    disabled={disabled || index === rows.length - 1}
                  />
                  <IconButton
                    label={t("recipe.recipes.stepsEditor.removeAction", { index: index + 1 })}
                    icon={<Trash2 />}
                    size="sm"
                    variant="danger"
                    onClick={() => remove(index)}
                    disabled={disabled}
                  />
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            onChange([...rows, emptyStepRow()]);
            setStatus(t("recipe.recipes.stepsEditor.status.added"));
          }}
          disabled={disabled}
          leftIcon={<Plus className="size-4" />}
        >
          {t("recipe.recipes.stepsEditor.addAction")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            onChange([...rows, emptyStepRow(rows[rows.length - 1]?.section ?? "")]);
            setStatus(t("recipe.recipes.stepsEditor.status.added"));
          }}
          disabled={disabled}
        >
          {t("recipe.recipes.stepsEditor.addSameSectionAction")}
        </Button>
      </div>

      <Dialog
        open={pasteOpen}
        onClose={() => setPasteOpen(false)}
        title={t("recipe.recipes.stepsEditor.dialog.title")}
        description={t("recipe.recipes.stepsEditor.dialog.description")}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPasteOpen(false)} fullWidth>
              {t("recipe.recipes.editor.cancel")}
            </Button>
            <Button onClick={applyPaste} disabled={pasteText.trim().length === 0} fullWidth>
              {t("recipe.recipes.editor.apply")}
            </Button>
          </>
        }
      >
        <Textarea
          label={t("recipe.recipes.stepsEditor.dialog.textareaLabel")}
          rows={12}
          value={pasteText}
          onChange={(event) => setPasteText(event.target.value)}
          placeholder={t("recipe.recipes.stepsEditor.dialog.placeholder")}
        />
      </Dialog>
    </div>
  );
}
