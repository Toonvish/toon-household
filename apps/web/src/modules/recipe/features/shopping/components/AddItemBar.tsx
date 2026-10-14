/**
 * The add box. One text field that understands amounts: "500g Mehl", "2 Dosen Tomaten",
 * "Klopapier" all work, because the input is parsed with the app's German ingredient
 * parser before it is sent (see ../lib/parse.ts).
 *
 * It stays put at the bottom of the screen on phones — above the tab bar — so adding
 * three things in a row does not mean scrolling back up each time. The field keeps
 * focus after a submit for the same reason (`autoFocus` only acts on MOUNT, so it
 * cannot re-focus a field that is already on screen — this is why the ref is used
 * directly rather than an `autoFocus` toggle).
 *
 * A live preview of what the parser understood sits under the field. Without it,
 * "2 Dosen Tomaten" silently becoming `2 Dose Tomaten` is a small mystery; with it, the
 * unit normalisation is visible before anything is saved.
 *
 * `placement` picks the shape (artboard `1d` §8.1 vs `1h` §8.2): `"docked"` is the
 * phone's sticky bottom bar; `"inline"` is desktop's plain in-flow row at the TOP
 * of the screen — no sticky, no bleed, no negative margins. `ShoppingListDetailPage`
 * picks by `wide`, which it already computes.
 */
import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { formatQuantity, formatShoppingAmount } from "@toon/shared";
import { Button, Input } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { parseShoppingInput, parseShoppingInputBlock } from "../lib/parse";

export interface AddItemBarProps {
  onAdd: (items: ReturnType<typeof parseShoppingInputBlock>) => void;
  disabled?: boolean;
  placement?: "docked" | "inline";
}

export function AddItemBar({ onAdd, disabled = false, placement = "docked" }: AddItemBarProps) {
  const t = useT();
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const preview = parseShoppingInput(text);

  const submit = () => {
    // Split on newlines too, so a list pasted out of a chat message arrives as items.
    const items = parseShoppingInputBlock(text);
    if (items.length === 0) return;
    onAdd(items);
    setText("");
    inputRef.current?.focus();
  };

  const docked = placement === "docked";

  return (
    // `"docked"` is the 54px, rounded-2xl, `shadow-pop` bar artboard `1h` draws
    // INSIDE the phone's sticky bottom container — the sticky/bleed/gradient
    // wrapper (and the chip scroller stacked above this bar) is
    // `ShoppingListDetailPage`'s own job (see the sticky-bar gotcha there), so
    // this component owns only the bar itself, never a second nested sticky
    // element. `"inline"` (desktop, at the TOP of the screen) is a plain card in
    // flow with neither shadow nor rounding to match.
    <div
      className={
        docked
          ? "rounded-2xl border border-line-strong bg-surface px-3 py-2 shadow-pop"
          : "rounded-xl border border-line-strong bg-surface px-4 py-2"
      }
    >
      <form
        className="flex items-start gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="min-w-0 flex-1">
          <Input
            ref={inputRef}
            size="lg"
            leftIcon={<Plus aria-hidden="true" />}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={t("recipe.shopping.addItem.placeholderExamples")}
            aria-label={t("recipe.shopping.addItem.ariaLabel")}
            enterKeyHint="done"
            autoComplete="off"
            disabled={disabled}
          />
          {preview ? (
            <p className="mt-1.5 truncate text-xs text-fg-muted">
              {t("recipe.shopping.addItem.previewLabel")}{" "}
              <span className="font-medium text-fg">
                {[
                  formatShoppingAmount(
                    { quantity: preview.quantity ?? null, unit: preview.unit ?? null },
                    formatQuantity,
                  ),
                  preview.name,
                ]
                  .filter((part) => part.length > 0)
                  .join(" ")}
              </span>
              {preview.note ? ` (${preview.note})` : ""}
            </p>
          ) : null}
        </div>
        <Button
          type="submit"
          leftIcon={<Plus />}
          disabled={disabled || preview === null}
          className="shrink-0"
        >
          {/* Icon-only on the docked phone bar (no room for the label next to the
              full-width field); "inline" desktop always shows it. */}
          <span className={docked ? "sr-only" : undefined}>{t("recipe.shopping.action.add")}</span>
        </Button>
      </form>
    </div>
  );
}
