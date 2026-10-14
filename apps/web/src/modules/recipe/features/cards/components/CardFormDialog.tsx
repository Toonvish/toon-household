/**
 * Add / edit a card.
 *
 * Three things here are worth knowing before changing them.
 *
 * **The preview is the validation.** Under the fields sits the actual symbol the
 * card will produce, drawn by the same encoder the till screen uses. That is a
 * stronger guarantee than any message: if the preview appears, the card WILL render
 * later; if it does not, something about the number is wrong and the field says
 * what. It also catches the case no validator can — a number typed correctly for
 * the wrong symbology.
 *
 * **Normalisation happens on blur, visibly.** `normalizeBarcodeValue` strips
 * separators, upper-cases Code 39 and completes a missing EAN/UPC check digit, and
 * the field shows the RESULT rather than quietly sending something else to the
 * server. A user who typed twelve digits and sees thirteen has learned what the app
 * did; one whose value silently changed on the server has not.
 *
 * **Scanning fills both fields at once.** A scan knows the symbology, so it sets
 * `format` too — that is the whole reason the format picker's hint says "if unsure,
 * just scan it".
 */
import { useEffect, useRef, useState } from "react";
import { ScanLine } from "lucide-react";
import {
  CARD_LIMITS,
  CreateCardRequestSchema,
  UpdateCardRequestSchema,
  cardValueIssueKey,
  normalizeBarcodeValue,
  resolveWireKey,
  type BarcodeFormat,
  type Card,
} from "@toon/shared";
import { Button, Dialog, Input, Select, useToast } from "@/components/ui";
import { useT, useLocale } from "@/lib/i18n";
import { apiFieldErrors, validate, type FieldErrors } from "@/lib/validation";
import { BarcodeImage, canRenderBarcode } from "./BarcodeImage";
import { ScannerDialog } from "./ScannerDialog";
import { CARD_FORMAT_LABEL_KEYS, CARD_FORMAT_ORDER } from "../lib/formats";
import { useCreateCard, useUpdateCard } from "../lib/queries";
import type { ScanResult } from "../lib/scan";

export interface CardFormDialogProps {
  open: boolean;
  onClose: () => void;
  /** The card being edited, or null to add a new one. */
  card: Card | null;
}

interface FormState {
  label: string;
  format: BarcodeFormat;
  value: string;
  note: string;
}

const EMPTY: FormState = { label: "", format: "ean13", value: "", note: "" };

function stateOf(card: Card | null): FormState {
  if (card === null) return EMPTY;
  return { label: card.label, format: card.format, value: card.value, note: card.note ?? "" };
}

export function CardFormDialog({ open, onClose, card }: CardFormDialogProps) {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const create = useCreateCard();
  const update = useUpdateCard();

  const [form, setForm] = useState<FormState>(() => stateOf(card));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [scanning, setScanning] = useState(false);
  /**
   * One-shot request to focus the number field, set by the scanner's "type the
   * number instead". It CANNOT be an `autoFocus` prop: the input is already
   * mounted by then, and `autoFocus` only acts on mount — measured in a real
   * browser, where the focus stayed on a button and the promise the scanner's copy
   * makes ("tippe die Nummer ein") silently went unkept.
   */
  const [focusValue, setFocusValue] = useState(false);
  const valueRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!focusValue) return;
    valueRef.current?.focus();
    setFocusValue(false);
  }, [focusValue]);

  // Re-seeded whenever the dialog opens, or opens on a different card. Editing a
  // second card without this would show the first one's number.
  const cardId = card?.id ?? null;
  useEffect(() => {
    if (!open) return;
    setForm(stateOf(card));
    setErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reseed per opening
  }, [open, cardId]);

  const pending = create.isPending || update.isPending;
  const normalizedValue = normalizeBarcodeValue(form.format, form.value);
  const previewable = normalizedValue.length > 0 && canRenderBarcode(form.format, normalizedValue);

  /** The catalog message for the value's own problem, checked as the user types. */
  const liveValueError = ((): string | undefined => {
    if (form.value.trim().length === 0) return undefined;
    const key = cardValueIssueKey(form.format, normalizedValue);
    if (key === null) return undefined;
    // The value issues live in the SERVER catalog (both sides run the schema), so
    // they resolve through `resolveWireKey` rather than the UI catalog's `t()`.
    return resolveWireKey(locale, key) ?? key;
  })();

  const set = (patch: Partial<FormState>): void => {
    setForm((current) => ({ ...current, ...patch }));
    setErrors({});
  };

  const submit = (): void => {
    const payload = {
      label: form.label,
      format: form.format,
      value: form.value,
      note: form.note.trim().length === 0 ? null : form.note,
    };

    if (card === null) {
      const result = validate(CreateCardRequestSchema, payload);
      if (!result.ok) {
        setErrors(result.errors);
        return;
      }
      create.mutate(result.data, {
        onSuccess: (saved) => {
          toast.success(t("recipe.cards.form.saved", { label: saved.label }));
          onClose();
        },
        onError: (error) => setErrors(apiFieldErrors(error)),
      });
      return;
    }

    const result = validate(UpdateCardRequestSchema, payload);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    update.mutate(
      { cardId: card.id, patch: result.data },
      {
        onSuccess: (saved) => {
          toast.success(t("recipe.cards.form.updated", { label: saved.label }));
          onClose();
        },
        onError: (error) => setErrors(apiFieldErrors(error)),
      },
    );
  };

  const onDetected = (result: ScanResult): void => {
    setScanning(false);
    set({
      format: result.format,
      value: normalizeBarcodeValue(result.format, result.value),
      // A scanned card has no name yet; keep whatever was typed.
    });
    toast.success(t("recipe.cards.scan.success", { format: t(CARD_FORMAT_LABEL_KEYS[result.format]) }));
  };

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        title={card === null ? t("recipe.cards.form.addTitle") : t("recipe.cards.form.editTitle")}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              {t("recipe.cards.action.cancel")}
            </Button>
            <Button onClick={submit} loading={pending}>
              {card === null ? t("recipe.cards.action.add") : t("recipe.cards.action.save")}
            </Button>
          </>
        }
      >
        <form
          className="flex flex-col gap-4 pb-2"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {errors._form ? <p className="text-sm text-danger">{errors._form}</p> : null}

          <Input
            label={t("recipe.cards.form.label.label")}
            value={form.label}
            onChange={(event) => set({ label: event.target.value })}
            placeholder={t("recipe.cards.form.label.placeholder")}
            maxLength={CARD_LIMITS.labelMax}
            error={errors.label}
            autoFocus
          />

          {/*
            SCANNING IS THE PRIMARY PATH, so its button sits above the two fields it
            fills rather than beside the number. It was next to the input at first
            and that measured wrong in a real 390px browser: the field's hint wraps
            to four lines there, and an `items-end` row then floats the button
            halfway up the hint text. Full width, on its own line, is also a bigger
            touch target for the thing most people will reach for first.
          */}
          <Button
            type="button"
            variant="secondary"
            fullWidth
            leftIcon={<ScanLine className="size-4" />}
            onClick={() => {
              setFocusValue(false);
              setScanning(true);
            }}
          >
            {t("recipe.cards.form.scan")}
          </Button>

          <Select
            label={t("recipe.cards.form.format.label")}
            hint={t("recipe.cards.form.format.hint")}
            value={form.format}
            onChange={(event) => set({ format: event.target.value as BarcodeFormat })}
            error={errors.format}
            options={CARD_FORMAT_ORDER.map((format) => ({
              value: format,
              label: t(CARD_FORMAT_LABEL_KEYS[format]),
            }))}
          />

          <Input
            label={t("recipe.cards.form.value.label")}
            hint={t("recipe.cards.form.value.hint")}
            value={form.value}
            onChange={(event) => set({ value: event.target.value })}
            // Normalising on blur is what makes the completion visible.
            onBlur={() => set({ value: normalizeBarcodeValue(form.format, form.value) })}
            placeholder={t("recipe.cards.form.value.placeholder")}
            inputMode={form.format === "qr" || form.format === "code128" ? "text" : "numeric"}
            autoComplete="off"
            maxLength={CARD_LIMITS.valueMax}
            error={errors.value ?? liveValueError}
            ref={valueRef}
          />

          <Input
            label={t("recipe.cards.form.note.label")}
            value={form.note}
            onChange={(event) => set({ note: event.target.value })}
            placeholder={t("recipe.cards.form.note.placeholder")}
            maxLength={CARD_LIMITS.noteMax}
            error={errors.note}
            optional
          />

          {/* The preview: proof that this card will render at a till. */}
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-fg">{t("recipe.cards.form.preview")}</p>
            {previewable ? (
              <div className="flex justify-center rounded-card bg-white p-3 shadow-card">
                <div className={form.format === "qr" ? "aspect-square w-40" : "h-20 w-full"}>
                  <BarcodeImage
                    format={form.format}
                    value={normalizedValue}
                    label={form.label.length > 0 ? form.label : t("recipe.cards.form.preview")}
                  />
                </div>
              </div>
            ) : (
              <p className="rounded-card border border-dashed border-line px-3 py-6 text-center text-sm text-fg-muted">
                {t("recipe.cards.form.previewPending")}
              </p>
            )}
          </div>
        </form>
      </Dialog>

      <ScannerDialog
        open={scanning}
        onClose={() => setScanning(false)}
        onDetected={onDetected}
        onManualEntry={() => {
          setScanning(false);
          setFocusValue(true);
        }}
      />
    </>
  );
}
