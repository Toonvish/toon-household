/**
 * Ingredients editor.
 *
 * - one row per ingredient: amount / unit / ingredient / note
 * - section headings (e.g. "Für den Teig") per row, with a datalist of existing sections
 * - reordering via ALWAYS-VISIBLE up/down buttons (drag & drop is unusable on a phone)
 * - a "paste ingredients" dialog: paste a whole block, every line goes through
 *   `parseIngredientBlock` / `parseIngredientLine` from @toon/shared
 */
import { useId, useState } from "react";
import { ArrowDown, ArrowUp, ClipboardPaste, Plus, Trash2, WandSparkles } from "lucide-react";
import { parseIngredientLine } from "@toon/shared";
import { Button, Dialog, IconButton, Input, Textarea } from "@/components/ui";
import { useT } from "@/lib/i18n";
import type { FieldErrors } from "@/lib/validation";
import { moveItem, moveTargetIndex, patchRow, removeRow } from "../lib/hooks";
import { sectionNames } from "../lib/format";
import {
  emptyIngredientRow,
  ingredientToRow,
  rowsFromPastedIngredients,
  type IngredientRow,
} from "../lib/formState";

export interface IngredientsEditorProps {
  rows: IngredientRow[];
  onChange: (rows: IngredientRow[]) => void;
  /** Server-side field errors keyed "ingredients.<index>.<field>". */
  errors?: FieldErrors;
  disabled?: boolean;
}

export function IngredientsEditor({
  rows,
  onChange,
  errors = {},
  disabled = false,
}: IngredientsEditorProps) {
  const t = useT();
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [status, setStatus] = useState("");
  const sectionListId = useId();
  const sections = sectionNames(rows);

  function patch(index: number, changes: Partial<IngredientRow>) {
    onChange(patchRow(rows, index, changes));
  }

  function move(index: number, delta: number) {
    const target = moveTargetIndex(rows.length, index, delta);
    if (target === undefined) return;
    onChange(moveItem(rows, index, target));
    setStatus(t("recipe.recipes.ingredientsEditor.status.moved", { position: target + 1 }));
  }

  function remove(index: number) {
    onChange(removeRow(rows, index, emptyIngredientRow));
    setStatus(t("recipe.recipes.ingredientsEditor.status.removed"));
  }

  function add(section = "") {
    onChange([...rows, emptyIngredientRow(section)]);
    setStatus(t("recipe.recipes.ingredientsEditor.status.added"));
  }

  /**
   * Re-parses one line in place. Handy after pasting a single messy line into the
   * name field ("250g Mehl, gesiebt" -> Menge 250, Einheit g, Zutat Mehl, Notiz gesiebt).
   */
  function reparse(index: number) {
    const row = rows[index];
    if (!row) return;
    const source = [row.quantity, row.unit, row.name].filter((part) => part.trim().length > 0).join(" ");
    if (source.trim().length === 0) return;
    const parsed = parseIngredientLine(source, index);
    patch(index, {
      ...ingredientToRow(parsed),
      key: row.key,
      section: row.section,
      note: [row.note, parsed.note].filter((part) => part && part.trim().length > 0).join(", "),
      raw: row.raw,
    });
    setStatus(t("recipe.recipes.ingredientsEditor.status.reparsed"));
  }

  function applyPaste() {
    const parsed = rowsFromPastedIngredients(pasteText);
    if (parsed.length === 0) {
      setStatus(t("recipe.recipes.ingredientsEditor.status.pasteEmpty"));
      return;
    }
    // Drop a single empty starter row so pasting into a fresh form looks right.
    const keep = rows.filter((row) => row.name.trim().length > 0 || row.quantity.trim().length > 0);
    onChange([...keep, ...parsed]);
    setPasteText("");
    setPasteOpen(false);
    setStatus(t("recipe.recipes.ingredientsEditor.status.pasted", { count: parsed.length }));
  }

  return (
    <div className="flex flex-col gap-3">
      <datalist id={sectionListId}>
        {sections.map((section) => (
          <option key={section} value={section} />
        ))}
      </datalist>

      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-display-md font-medium">{t("recipe.recipes.ingredients.heading")}</h2>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setPasteOpen(true)}
          disabled={disabled}
          leftIcon={<ClipboardPaste className="size-4" />}
        >
          {t("recipe.recipes.ingredientsEditor.insertAction")}
        </Button>
      </div>

      <p aria-live="polite" className="sr-only">
        {status}
      </p>

      <ol className="flex flex-col gap-3">
        {rows.map((row, index) => {
          const prefix = `ingredients.${index}`;
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
                  placeholder={t("recipe.recipes.ingredientsEditor.section.placeholder")}
                  disabled={disabled}
                  error={errors[`${prefix}.section`]}
                  containerClassName="mb-1"
                />
              ) : null}

              {/* Arbitrary-value grid columns bypass Tailwind's own `grid-cols-N` safety
                  (which already expands to `repeat(N, minmax(0,1fr))`), so the trailing
                  track needs `minmax(0,1fr)` spelled out — a bare `1fr` cannot shrink
                  below the name Input's intrinsic content width on a narrow phone. */}
              <div className="grid grid-cols-[5.5rem_5.5rem_minmax(0,1fr)] gap-2">
                <Input
                  label={t("recipe.recipes.ingredientsEditor.quantity.label")}
                  inputMode="decimal"
                  value={row.quantity}
                  onChange={(event) => patch(index, { quantity: event.target.value })}
                  placeholder="250"
                  disabled={disabled}
                  error={errors[`${prefix}.quantity`]}
                />
                <Input
                  label={t("recipe.recipes.ingredientsEditor.unit.label")}
                  value={row.unit}
                  onChange={(event) => patch(index, { unit: event.target.value })}
                  placeholder="g"
                  disabled={disabled}
                  error={errors[`${prefix}.unit`]}
                />
                <Input
                  label={t("recipe.recipes.ingredientsEditor.name.label")}
                  required
                  value={row.name}
                  onChange={(event) => patch(index, { name: event.target.value })}
                  placeholder={t("recipe.recipes.ingredientsEditor.name.placeholder")}
                  disabled={disabled}
                  error={errors[`${prefix}.name`]}
                />
              </div>

              <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
                <Input
                  label={t("recipe.recipes.ingredientsEditor.quantityMax.label")}
                  optional
                  inputMode="decimal"
                  value={row.quantityMax}
                  onChange={(event) => patch(index, { quantityMax: event.target.value })}
                  placeholder="3"
                  disabled={disabled}
                  error={errors[`${prefix}.quantityMax`]}
                />
                <Input
                  label={t("recipe.recipes.ingredientsEditor.note.label")}
                  optional
                  value={row.note}
                  onChange={(event) => patch(index, { note: event.target.value })}
                  placeholder={t("recipe.recipes.ingredientsEditor.note.placeholder")}
                  disabled={disabled}
                  error={errors[`${prefix}.note`]}
                />
              </div>

              <div className="flex items-center justify-between gap-1">
                <span className="text-xs text-fg-subtle tabular-nums">
                  {t("recipe.recipes.editor.positionOf", { index: index + 1, total: rows.length })}
                </span>
                <div className="flex items-center gap-1">
                  <IconButton
                    label={t("recipe.recipes.ingredientsEditor.reparseAction", { index: index + 1 })}
                    icon={<WandSparkles />}
                    size="sm"
                    onClick={() => reparse(index)}
                    disabled={disabled}
                  />
                  <IconButton
                    label={t("recipe.recipes.ingredientsEditor.moveUpAction", { index: index + 1 })}
                    icon={<ArrowUp />}
                    size="sm"
                    onClick={() => move(index, -1)}
                    disabled={disabled || index === 0}
                  />
                  <IconButton
                    label={t("recipe.recipes.ingredientsEditor.moveDownAction", { index: index + 1 })}
                    icon={<ArrowDown />}
                    size="sm"
                    onClick={() => move(index, 1)}
                    disabled={disabled || index === rows.length - 1}
                  />
                  <IconButton
                    label={t("recipe.recipes.ingredientsEditor.removeAction", { index: index + 1 })}
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
          onClick={() => add()}
          disabled={disabled}
          leftIcon={<Plus className="size-4" />}
        >
          {t("recipe.recipes.ingredientsEditor.addAction")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => add(rows[rows.length - 1]?.section ?? "")}
          disabled={disabled}
        >
          {t("recipe.recipes.ingredientsEditor.addSameSectionAction")}
        </Button>
      </div>

      <Dialog
        open={pasteOpen}
        onClose={() => setPasteOpen(false)}
        title={t("recipe.recipes.ingredientsEditor.insertAction")}
        description={t("recipe.recipes.ingredientsEditor.dialog.description")}
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
          label={t("recipe.recipes.ingredientsEditor.dialog.textareaLabel")}
          rows={10}
          value={pasteText}
          onChange={(event) => setPasteText(event.target.value)}
          // German unit vocabulary example (g/Pck./TL) — content language, left
          // untouched even in the English UI. See notesForVerifier.
          placeholder={"Für den Teig:\n250 g Mehl\n1 Pck. Backpulver\n2-3 Eier\n½ TL Salz"}
        />
      </Dialog>
    </div>
  );
}
