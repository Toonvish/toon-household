/**
 * Photo input for mobile.
 *
 * `capture="environment"` makes a phone open the rear camera directly, which is
 * the fast path for "Kochbuch abfotografieren". The gallery input deliberately
 * omits `capture` so it opens the picker instead, and allows multiple files for
 * two-page recipes.
 */
import { useId, useRef, type ChangeEvent } from "react";
import clsx from "clsx";
import { Camera, Images } from "lucide-react";
import { useT } from "@/lib/i18n";
import { Button } from "../lib/shell";

export interface ImageCaptureButtonProps {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  /** Label of the primary (camera) button. */
  captureLabel?: string;
  galleryLabel?: string;
  /** Allow selecting several photos at once in the gallery picker. */
  multiple?: boolean;
  className?: string;
}

export function ImageCaptureButton({
  onFiles,
  disabled = false,
  captureLabel,
  galleryLabel,
  multiple = true,
  className,
}: ImageCaptureButtonProps) {
  const t = useT();
  const resolvedCaptureLabel = captureLabel ?? t("recipe.import.imageCapture.captureLabel");
  const resolvedGalleryLabel = galleryLabel ?? t("recipe.import.imageCapture.galleryLabel");
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const galleryRef = useRef<HTMLInputElement | null>(null);
  const cameraId = useId();
  const galleryId = useId();

  const handle = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    // Reset so picking the SAME file again still fires a change event.
    event.target.value = "";
    if (files.length > 0) onFiles(files);
  };

  return (
    <div className={clsx("space-y-2", className)}>
      <input
        ref={cameraRef}
        id={cameraId}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handle}
        tabIndex={-1}
      />
      <input
        ref={galleryRef}
        id={galleryId}
        type="file"
        accept="image/*"
        multiple={multiple}
        className="hidden"
        onChange={handle}
        tabIndex={-1}
      />

      <Button
        type="button"
        size="lg"
        fullWidth
        disabled={disabled}
        leftIcon={<Camera aria-hidden className="h-5 w-5" />}
        onClick={() => cameraRef.current?.click()}
      >
        {resolvedCaptureLabel}
      </Button>

      <Button
        type="button"
        variant="outline"
        fullWidth
        disabled={disabled}
        leftIcon={<Images aria-hidden className="h-4 w-4" />}
        onClick={() => galleryRef.current?.click()}
      >
        {resolvedGalleryLabel}
      </Button>
    </div>
  );
}

export default ImageCaptureButton;
