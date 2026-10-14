/**
 * Editing one line: name, amount, unit, note.
 *
 * The amount and unit are separate controls here rather than one free-text field. On
 * the add path a single box is faster ("500g Mehl"), but when CORRECTING a line the
 * amount is usually the only thing that changes, and a numeric keypad beats retyping
 * the whole line on a phone.
 *
 * Renaming a line into one that already exists is allowed and merges the two — the API
 * does that deliberately, so the dialog warns instead of blocking.
 */
import { useEffect, useState } from "react";
import { nameKey, type ShoppingItem, type UpdateShoppingItemRequest } from "@toon/shared";
import { Button, Dialog, Input } from "@/components/ui";
import { useT } from "@/lib/i18n";

export interface EditItemDialogProps {
  item: ShoppingItem | null;
  /** Every other line, used to warn about a merge. */
  siblings: ShoppingItem[];
  onClose: () => void;
  onSave: (itemId: string, patch: UpdateShoppingItemRequest) => void;
}

export function EditItemDialog({ item, siblings, onClose, onSave }: EditItemDialogProps) {
  const t = useT();
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!item) return;
    setName(item.name);
    setQuantity(item.quantity === null ? "" : String(item.quantity).replace(".", ","));
    setUnit(item.unit ?? "");
    setNote(item.note ?? "");
  }, [item]);

  const trimmedName = name.trim();
  const parsedQuantity = parseAmount(quantity);
  const quantityInvalid = quantity.trim().length > 0 && parsedQuantity === null;

  const wouldMerge =
    item !== null &&
    trimmedName.length > 0 &&
    siblings.some(
      (sibling) => sibling.id !== item.id && nameKey(sibling.name) === nameKey(trimmedName),
    );

  const save = () => {
    if (!item || trimmedName.length === 0 || quantityInvalid) return;
    onSave(item.id, {
      name: trimmedName,
      quantity: quantity.trim().length === 0 ? null : parsedQuantity,
      unit: unit.trim().length === 0 ? null : unit.trim(),
      note: note.trim().length === 0 ? null : note.trim(),
    });
    onClose();
  };

  return (
    <Dialog
      open={item !== null}
      onClose={onClose}
      title={t("recipe.shopping.editItem.title")}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("recipe.shopping.action.cancel")}
          </Button>
          <Button onClick={save} disabled={trimmedName.length === 0 || quantityInvalid}>
            {t("recipe.shopping.action.save")}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <Input
          label={t("recipe.shopping.editItem.name.label")}
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="off"
        />
        {/* `containerClassName`, not `className` — `className` targets the `<input>`
            itself, which isn't the flex item here, so `flex-1` on it did nothing; the
            two fields kept their intrinsic content width instead of sharing the row. */}
        <div className="flex gap-3">
          <Input
            label={t("recipe.shopping.editItem.quantity.label")}
            containerClassName="min-w-0 flex-1"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            inputMode="decimal"
            placeholder={t("recipe.shopping.editItem.quantity.placeholder")}
            error={quantityInvalid ? t("recipe.shopping.editItem.quantity.error") : undefined}
          />
          <Input
            label={t("recipe.shopping.editItem.unit.label")}
            containerClassName="min-w-0 flex-1"
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
            placeholder={t("recipe.shopping.editItem.unit.placeholder")}
            autoComplete="off"
          />
        </div>
        <Input
          label={t("recipe.shopping.editItem.note.label")}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={t("recipe.shopping.editItem.note.placeholder")}
          autoComplete="off"
        />
        {wouldMerge ? (
          <p className="text-sm text-warning-soft-fg">
            {t("recipe.shopping.editItem.mergeWarning", { name: trimmedName })}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}

/** Accepts a German decimal comma as well as a dot. Returns null for anything else. */
function parseAmount(value: string): number | null {
  const trimmed = value.trim().replace(",", ".");
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
