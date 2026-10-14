/**
 * Recipe image field: camera/gallery capture OR a pasted URL, with a live preview.
 *
 * The upload endpoint needs an existing recipe id
 * (`POST /api/households/:householdId/recipe/recipes/:recipeId/image`), so on the NEW screen the picked
 * file is held here and uploaded by the form right after the recipe was created.
 * A local `blob:` preview is shown in the meantime and revoked on unmount.
 */
import { useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, Link2, Trash2 } from "lucide-react";
import { MAX_UPLOAD_BYTES } from "@toon/shared";
import { mediaUrl } from "@/modules/recipe/lib/api";
import { formatBytes } from "@/modules/recipe/lib/format";
import { useT } from "@/lib/i18n";
import { Button, Input, Label } from "@/components/ui";

export interface RecipeImagePickerProps {
  /** Stored image URL (may be an API-relative /uploads/... path). */
  url: string;
  onUrlChange: (url: string) => void;
  /** File chosen but not uploaded yet. */
  file: File | null;
  onFileChange: (file: File | null) => void;
  disabled?: boolean;
  /** Rendered below the preview, e.g. "Uploaded after saving." */
  hint?: string;
}

export function RecipeImagePicker({
  url,
  onUrlChange,
  file,
  onFileChange,
  disabled = false,
  hint,
}: RecipeImagePickerProps) {
  const t = useT();
  const [showUrlField, setShowUrlField] = useState(false);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const galleryRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!file) {
      setLocalPreview(null);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setLocalPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  const preview = localPreview ?? mediaUrl(url);

  function pick(input: HTMLInputElement | null) {
    setError(null);
    input?.click();
  }

  function onPicked(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0] ?? null;
    // Reset so picking the same file twice still fires a change event.
    event.target.value = "";
    if (!picked) return;
    if (picked.size > MAX_UPLOAD_BYTES) {
      setError(t("recipe.recipes.imagePicker.tooLarge", { size: formatBytes(picked.size) }));
      return;
    }
    if (!picked.type.startsWith("image/")) {
      setError(t("recipe.recipes.imagePicker.invalidType"));
      return;
    }
    setError(null);
    onFileChange(picked);
  }

  return (
    <div className="flex flex-col gap-2">
      <Label optional>{t("recipe.recipes.imagePicker.label")}</Label>

      <div className="overflow-hidden rounded-card border border-line bg-surface-2">
        {preview ? (
          <img
            src={preview}
            alt={t("recipe.recipes.imagePicker.previewAlt")}
            className="aspect-4/3 w-full object-cover"
          />
        ) : (
          <div className="flex aspect-4/3 w-full flex-col items-center justify-center gap-2 text-fg-subtle">
            <ImagePlus aria-hidden="true" className="size-10" />
            <span className="text-sm">{t("recipe.recipes.imagePicker.empty")}</span>
          </div>
        )}
      </div>

      {/* Two inputs: `capture` opens the camera directly, the other the gallery. */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onPicked}
        tabIndex={-1}
        aria-hidden="true"
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onPicked}
        tabIndex={-1}
        aria-hidden="true"
      />

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => pick(cameraRef.current)}
          disabled={disabled}
          leftIcon={<Camera className="size-4" />}
          className="sm:hidden"
        >
          {t("recipe.recipes.imagePicker.takePhoto")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => pick(galleryRef.current)}
          disabled={disabled}
          leftIcon={<ImagePlus className="size-4" />}
        >
          {t("recipe.recipes.imagePicker.choosePhoto")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setShowUrlField((value) => !value)}
          disabled={disabled}
          aria-expanded={showUrlField}
          leftIcon={<Link2 className="size-4" />}
        >
          {t("recipe.recipes.imagePicker.urlToggle")}
        </Button>
        {preview ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onFileChange(null);
              onUrlChange("");
              setError(null);
            }}
            disabled={disabled}
            leftIcon={<Trash2 className="size-4" />}
          >
            {t("recipe.recipes.imagePicker.remove")}
          </Button>
        ) : null}
      </div>

      {showUrlField ? (
        <Input
          label={t("recipe.recipes.imagePicker.urlToggle")}
          type="url"
          inputMode="url"
          value={url}
          onChange={(event) => onUrlChange(event.target.value)}
          placeholder="https://…/bild.jpg"
          disabled={disabled}
        />
      ) : null}

      {error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : file ? (
        <p className="text-sm text-fg-muted">
          {file.name} · {formatBytes(file.size)}
          {hint ? ` · ${hint}` : ""}
        </p>
      ) : hint ? (
        <p className="text-sm text-fg-muted">{hint}</p>
      ) : null}
    </div>
  );
}
