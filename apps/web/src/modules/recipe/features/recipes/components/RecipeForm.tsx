/**
 * The one recipe form, used by RecipeNewPage and RecipeEditPage.
 *
 * - real `<form>` semantics, every control has a label
 * - client-side validation with the SAME zod schema the API uses
 *   (`CreateRecipeRequestSchema` via `validate` from @/lib/validation)
 * - server field errors are merged in, so a 422 lands on the right input
 * - submit is disabled while pending; navigating away while dirty asks for confirmation
 */
import { useEffect, useMemo, useState } from "react";
import { Save, WifiOff, X } from "lucide-react";
import {
  CreateRecipeRequestSchema,
  type CreateRecipeRequest,
  type Difficulty,
  type Tag,
} from "@toon/shared";
import type { Collection } from "@toon/shared";
import { Button, Card, ConfirmDialog, ErrorState, Input, Select, Textarea } from "@/components/ui";
import { DIFFICULTY_LABEL_KEYS } from "../lib/difficultyLabels";
import { useT } from "@/lib/i18n";
import { useCanMutate } from "@/lib/session";
import { apiFieldErrors, clearField, validate, type FieldErrors } from "@/lib/validation";
import { TagCombobox } from "@/modules/recipe/features/tags/components/TagCombobox";
import { useNavigationGuard } from "@/lib/nav";
import {
  derivedTotalMinutes,
  formToRequest,
  isSameForm,
  type RecipeFormValues,
} from "../lib/formState";
import { IngredientsEditor } from "./IngredientsEditor";
import { StepsEditor } from "./StepsEditor";
import { RecipeImagePicker } from "./RecipeImagePicker";

export interface RecipeFormSubmit {
  payload: CreateRecipeRequest;
  /** Picked but not yet uploaded photo — the page uploads it after create/update. */
  file: File | null;
}

export interface RecipeFormProps {
  initialValues: RecipeFormValues;
  /**
   * The recipe's current course tag NAME, or `null` for none — kept separate from
   * `RecipeFormValues` (which only knows FREE tags) because a course is a single
   * `kind:'course'` link, not a member of the `tags` array. `RecipeNewPage` always
   * passes `null`; `RecipeEditPage` finds it in the loaded recipe's tags.
   */
  initialCourse: string | null;
  availableTags: readonly Tag[];
  availableCollections: readonly Collection[];
  onSubmit: (input: RecipeFormSubmit) => Promise<void>;
  onCancel: () => void;
  submitLabel: string;
  pending: boolean;
  /** Error thrown by the mutation — field errors are extracted from it. */
  error?: unknown;
  imageHint?: string;
}

export function RecipeForm({
  initialValues,
  initialCourse,
  availableTags,
  availableCollections,
  onSubmit,
  onCancel,
  submitLabel,
  pending,
  error,
  imageHint,
}: RecipeFormProps) {
  const t = useT();
  const [values, setValues] = useState<RecipeFormValues>(initialValues);
  const [file, setFile] = useState<File | null>(null);
  const [course, setCourse] = useState<string | null>(initialCourse);
  const [errors, setErrors] = useState<FieldErrors>({});

  // Single-select over the household's `kind:'course'` tags plus "none" — this is where
  // the "one course per recipe" invariant actually lives, since no DB constraint
  // enforces it. Option VALUES are tag names (CONTENT), never through t().
  const courseOptions = [
    { value: "", label: t("recipe.recipes.form.course.none") },
    ...availableTags
      .filter((tag) => tag.kind === "course")
      .map((tag) => ({ value: tag.name, label: tag.name })),
  ];

  const difficultyOptions = [
    { value: "", label: t("recipe.recipes.form.difficulty.none") },
    { value: "einfach", label: t(DIFFICULTY_LABEL_KEYS.einfach) },
    { value: "mittel", label: t(DIFFICULTY_LABEL_KEYS.mittel) },
    { value: "schwer", label: t(DIFFICULTY_LABEL_KEYS.schwer) },
  ] as const;

  const ratingOptions = [
    { value: "", label: t("recipe.recipes.form.rating.none") },
    { value: "1", label: t("recipe.recipes.form.rating.stars", { count: 1 }) },
    { value: "2", label: t("recipe.recipes.form.rating.stars", { count: 2 }) },
    { value: "3", label: t("recipe.recipes.form.rating.stars", { count: 3 }) },
    { value: "4", label: t("recipe.recipes.form.rating.stars", { count: 4 }) },
    { value: "5", label: t("recipe.recipes.form.rating.stars", { count: 5 }) },
  ] as const;

  // Re-seed when the underlying recipe finished loading.
  useEffect(() => {
    setValues(initialValues);
  }, [initialValues]);

  useEffect(() => {
    setCourse(initialCourse);
  }, [initialCourse]);

  const dirty = useMemo(
    () => !isSameForm(values, initialValues) || file !== null || course !== initialCourse,
    [values, initialValues, file, course, initialCourse],
  );
  // Guards BOTH in-app navigation and the browser's unload prompt.
  const guard = useNavigationGuard(dirty && !pending);

  // `== null` on purpose: an idle TanStack mutation hands us `null`, not `undefined`
  // (see apiFieldErrors), and treating that as an error rendered a red panel above a
  // form nobody had submitted.
  const serverErrors = useMemo(() => (error == null ? {} : apiFieldErrors(error)), [error]);
  const { canMutate, reason: offlineReason } = useCanMutate();
  const allErrors: FieldErrors = { ...serverErrors, ...errors };

  function set<Key extends keyof RecipeFormValues>(key: Key, value: RecipeFormValues[Key]) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => clearField(current, String(key)));
  }

  const collectionOptions = availableCollections.map((collection) => ({
    value: collection.id,
    label: collection.name,
  }));

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    // Belt and braces: the button is disabled offline, but Enter in a text field
    // submits a form too.
    if (!canMutate) return;

    // `course` lives outside `RecipeFormValues` (see the prop doc comment above) and
    // is merged in here rather than in `formToRequest`, which only knows the form.
    const payload = { ...formToRequest(values), course };
    const result = validate(CreateRecipeRequestSchema, payload);
    if (!result.ok) {
      setErrors(result.errors);
      // Move focus to the first invalid control so screen readers announce it.
      const firstKey = Object.keys(result.errors)[0];
      if (firstKey) {
        document
          .querySelector<HTMLElement>(`[aria-invalid="true"], [data-field="${firstKey}"]`)
          ?.focus();
      }
      return;
    }

    setErrors({});
    await onSubmit({ payload: result.data, file });
  }

  const totalHint = (() => {
    const derived = derivedTotalMinutes(values);
    if (derived === undefined || values.totalMinutes.trim().length > 0) return undefined;
    return t("recipe.recipes.form.totalMinutes.hint", { minutes: derived });
  })();

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
      {allErrors._form ? <ErrorState inline error={error} description={allErrors._form} /> : null}

      <Card padding="md" className="flex flex-col gap-4">
        <Input
          label={t("recipe.recipes.form.title.label")}
          required
          value={values.title}
          onChange={(event) => set("title", event.target.value)}
          placeholder={t("recipe.recipes.form.title.placeholder")}
          error={allErrors.title}
          disabled={pending}
          autoComplete="off"
        />

        <Textarea
          label={t("recipe.recipes.form.description.label")}
          optional
          autoGrow
          rows={3}
          value={values.description}
          onChange={(event) => set("description", event.target.value)}
          placeholder={t("recipe.recipes.form.description.placeholder")}
          error={allErrors.description}
          disabled={pending}
        />

        <RecipeImagePicker
          url={values.imageUrl}
          onUrlChange={(url) => set("imageUrl", url)}
          file={file}
          onFileChange={setFile}
          disabled={pending}
          hint={imageHint}
        />
      </Card>

      <Card padding="md" className="flex flex-col gap-4">
        <h2 className="font-display text-display-md font-medium">{t("recipe.recipes.form.detailsHeading")}</h2>

        <div className="grid grid-cols-2 gap-3">
          <Input
            label={t("recipe.recipes.form.servingsAmount.label")}
            inputMode="decimal"
            value={values.servingsAmount}
            onChange={(event) => set("servingsAmount", event.target.value)}
            placeholder={t("recipe.recipes.form.servingsAmount.placeholder")}
            error={allErrors.servingsAmount}
            disabled={pending}
          />
          <Input
            label={t("recipe.recipes.form.servingsUnit.label")}
            value={values.servingsUnit}
            onChange={(event) => set("servingsUnit", event.target.value)}
            placeholder={t("common.servings.defaultUnit")}
            error={allErrors.servingsUnit}
            disabled={pending}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Input
            label={t("recipe.recipes.form.prepMinutes.label")}
            inputMode="numeric"
            value={values.prepMinutes}
            onChange={(event) => set("prepMinutes", event.target.value)}
            placeholder={t("recipe.recipes.form.prepMinutes.placeholder")}
            error={allErrors.prepMinutes}
            disabled={pending}
          />
          <Input
            label={t("recipe.recipes.form.cookMinutes.label")}
            inputMode="numeric"
            value={values.cookMinutes}
            onChange={(event) => set("cookMinutes", event.target.value)}
            placeholder={t("recipe.recipes.form.cookMinutes.placeholder")}
            error={allErrors.cookMinutes}
            disabled={pending}
          />
          <Input
            label={t("recipe.recipes.form.totalMinutes.label")}
            inputMode="numeric"
            value={values.totalMinutes}
            onChange={(event) => set("totalMinutes", event.target.value)}
            placeholder={t("recipe.recipes.form.totalMinutes.placeholder")}
            hint={totalHint}
            error={allErrors.totalMinutes}
            disabled={pending}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select
            label={t("recipe.recipes.form.difficulty.label")}
            options={difficultyOptions}
            value={values.difficulty}
            onChange={(event) => set("difficulty", event.target.value as Difficulty | "")}
            error={allErrors.difficulty}
            disabled={pending}
          />
          <Select
            label={t("recipe.recipes.form.rating.label")}
            options={ratingOptions}
            value={values.rating}
            onChange={(event) => set("rating", event.target.value)}
            error={allErrors.rating}
            disabled={pending}
          />
        </div>

        <Select
          label={t("recipe.recipes.form.course.label")}
          hint={t("recipe.recipes.form.course.hint")}
          options={courseOptions}
          value={course ?? ""}
          onChange={(event) => setCourse(event.target.value === "" ? null : event.target.value)}
          error={allErrors.course}
          disabled={pending}
        />

        <TagCombobox
          value={values.tags}
          onChange={(tags) => set("tags", tags)}
          available={availableTags}
          disabled={pending}
          error={allErrors.tags}
        />

        {collectionOptions.length > 0 ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-fg">{t("recipe.recipes.form.collectionsLegend")}</legend>
            <ul className="flex flex-col gap-1">
              {availableCollections.map((collection) => {
                const checked = values.collectionIds.includes(collection.id);
                return (
                  <li key={collection.id}>
                    <label className="flex min-h-11 items-center gap-2 text-sm text-fg">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={pending}
                        onChange={(event) =>
                          set(
                            "collectionIds",
                            event.target.checked
                              ? [...values.collectionIds, collection.id]
                              : values.collectionIds.filter((id) => id !== collection.id),
                          )
                        }
                        className="size-5 accent-[var(--brand)]"
                      />
                      {collection.name}
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        ) : null}
      </Card>

      <Card padding="md">
        <IngredientsEditor
          rows={values.ingredients}
          onChange={(rows) => set("ingredients", rows)}
          errors={allErrors}
          disabled={pending}
        />
      </Card>

      <Card padding="md">
        <StepsEditor
          rows={values.steps}
          onChange={(rows) => set("steps", rows)}
          errors={allErrors}
          disabled={pending}
        />
      </Card>

      <Card padding="md" className="flex flex-col gap-4">
        <Textarea
          label={t("recipe.recipes.form.notes.label")}
          optional
          autoGrow
          rows={3}
          value={values.notes}
          onChange={(event) => set("notes", event.target.value)}
          placeholder={t("recipe.recipes.form.notes.placeholder")}
          error={allErrors.notes}
          disabled={pending}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            label={t("recipe.recipes.form.sourceUrl.label")}
            type="url"
            inputMode="url"
            optional
            value={values.sourceUrl}
            onChange={(event) => set("sourceUrl", event.target.value)}
            placeholder="https://www.chefkoch.de/…"
            error={allErrors.sourceUrl}
            disabled={pending}
          />
          <Input
            label={t("recipe.recipes.form.sourceName.label")}
            optional
            value={values.sourceName}
            onChange={(event) => set("sourceName", event.target.value)}
            placeholder="Chefkoch"
            error={allErrors.sourceName}
            disabled={pending}
          />
        </div>
      </Card>

      {/*
        Sticky action bar so "Speichern" is always reachable with the thumb.
        `bottom-tabbar`, not `bottom-0`: the phone tab bar is fixed at `bottom-0` with a
        HIGHER z-index, so `bottom-0` parked this bar underneath it for the whole scroll
        and only let it emerge at the very end of the form. The `flex-1` spacer above it
        is what stops it floating mid-screen on a short form (a `sticky` bar can only be
        pushed UP, never down); `-mb-4` swallows the breathing room `pb-tabbar` already
        adds on `<main>`, or a strip of page background would show beneath the bar.
      */}
      <div className="flex-1" />
      <div className="sticky bottom-tabbar -mb-4 z-10 -mx-4 flex flex-col gap-2 border-t border-line bg-bg/95 px-4 py-3 backdrop-blur-sm lg:mx-0 lg:rounded-card lg:border">
        {/* Offline support is read-only (no mutation outbox, no conflict story for
            two members editing one recipe), so say so instead of letting the save
            fail after the user typed a whole recipe. */}
        {canMutate ? null : (
          <p role="status" className="flex items-center gap-2 text-sm text-warning-soft-fg">
            <WifiOff aria-hidden className="size-4 shrink-0" />
            {offlineReason}
          </p>
        )}
        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={onCancel}
            disabled={pending}
            fullWidth
            leftIcon={<X className="size-4" />}
          >
            {t("recipe.recipes.form.cancel")}
          </Button>
          <Button
            type="submit"
            loading={pending}
            disabled={!canMutate}
            title={offlineReason}
            fullWidth
            leftIcon={<Save className="size-4" />}
          >
            {submitLabel}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={guard.blocked}
        onClose={guard.reset}
        destructive
        title={t("recipe.recipes.form.unsavedConfirm.title")}
        description={t("recipe.recipes.form.unsavedConfirm.description")}
        confirmLabel={t("recipe.recipes.form.unsavedConfirm.confirm")}
        cancelLabel={t("recipe.recipes.form.unsavedConfirm.cancel")}
        onConfirm={guard.proceed}
      />
    </form>
  );
}
