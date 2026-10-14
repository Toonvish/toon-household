/**
 * Camera scanner: point it at the card, get `{ format, value }` back.
 *
 * The whole dialog is written around one fact — **scanning is the optional half of
 * this feature**. It needs a camera, a permission, and (once) a connection for the
 * ~1.1 MB decoder, and any of the three can be missing. So every failure path ends
 * in the same place: "type the number instead", as a real button that closes this
 * dialog and puts the cursor in the form's field. Nothing here is ever a dead end.
 *
 * Lifecycle: the camera is opened when the dialog opens and stopped in the effect's
 * cleanup. Leaving a stream running after close keeps the recording indicator lit,
 * which reads as a bug and is a genuine privacy problem — so `stop()` is called on
 * unmount, on success, and on failure.
 */
import { useEffect, useRef, useState } from "react";
import { Camera, Keyboard } from "lucide-react";
import { Button, Dialog, Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { ScanError, isCameraAvailable, scanFromCamera, type ScanResult } from "../lib/scan";

export interface ScannerDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called with the first supported code; the dialog closes itself after. */
  onDetected: (result: ScanResult) => void;
  /** "Type the number instead" — closes this dialog and focuses the field. */
  onManualEntry: () => void;
}

type Phase =
  | { state: "starting" }
  | { state: "scanning" }
  | { state: "failed"; failure: ScanError["failure"] };

export function ScannerDialog({ open, onClose, onDetected, onManualEntry }: ScannerDialogProps) {
  const t = useT();
  const { isOnline } = useSession();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [phase, setPhase] = useState<Phase>({ state: "starting" });
  /** Bumped by "try again", which is what re-runs the effect below. */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open) return;
    if (!isCameraAvailable()) {
      setPhase({ state: "failed", failure: "unavailable" });
      return;
    }

    let cancelled = false;
    let stop: (() => void) | null = null;
    setPhase({ state: "starting" });

    void (async () => {
      try {
        const element = videoRef.current;
        if (element === null) return;
        // The VISIBLE element is what gets decoded — see `scanFromCamera`'s note on
        // why a detached one silently never scans in Safari.
        const scan = await scanFromCamera(element);
        stop = scan.stop;
        if (cancelled) {
          scan.stop();
          return;
        }
        setPhase({ state: "scanning" });

        const result = await scan.result;
        if (!cancelled) onDetected(result);
      } catch (error) {
        if (cancelled) return;
        setPhase({
          state: "failed",
          failure: error instanceof ScanError ? error.failure : "load",
        });
      }
    })();

    return () => {
      cancelled = true;
      stop?.();
      if (videoRef.current !== null) videoRef.current.srcObject = null;
    };
    // `onDetected` is called at most once per stream and re-subscribing on a new
    // identity would restart the camera on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, attempt]);

  const failureMessage = (failure: ScanError["failure"]): string => {
    switch (failure) {
      case "permission":
        return t("recipe.cards.scan.error.permission");
      case "unavailable":
        return t("recipe.cards.scan.error.unavailable");
      case "unsupported":
        return t("recipe.cards.scan.error.unsupported");
      case "load":
        // Offline is by far the likeliest reason the decoder did not arrive, and
        // saying so is more useful than "could not be loaded".
        return isOnline ? t("recipe.cards.scan.error.load") : t("recipe.cards.scan.offline");
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("recipe.cards.scan.title")}
      description={phase.state === "failed" ? undefined : t("recipe.cards.scan.hint")}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("recipe.cards.action.cancel")}
          </Button>
          <Button
            variant="secondary"
            leftIcon={<Keyboard className="size-4" />}
            onClick={onManualEntry}
          >
            {t("recipe.cards.scan.manual")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 pb-2">
        {/*
          THE VIEWFINDER STAYS MOUNTED IN EVERY PHASE, only hidden while failed, and
          that is load-bearing rather than tidy: the effect above reads `videoRef`
          SYNCHRONOUSLY before its first await, so if the failure branch replaced
          this element, pressing "Nochmal versuchen" would find a null ref, return
          without starting anything, and leave the dialog on "Kamera wird
          gestartet …" forever.

          The frame overlay is a hint only — the decoder reads the WHOLE frame, so a
          code slightly outside the guides still scans, which is far more forgiving
          than refusing it.
        */}
        <div
          className={cn(
            "relative aspect-[4/3] w-full overflow-hidden rounded-card bg-black",
            phase.state === "failed" && "hidden",
          )}
        >
          <video
            ref={videoRef}
            muted
            playsInline
            className="size-full object-cover"
            aria-label={t("recipe.cards.scan.title")}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-6 top-1/2 h-24 -translate-y-1/2 rounded-lg border-2 border-white/80"
          />
        </div>

        {phase.state === "failed" ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-fg">{failureMessage(phase.failure)}</p>
            {/* No retry for "there is no camera" — trying again cannot grow one. */}
            {phase.failure === "unavailable" ? null : (
              <Button
                variant="secondary"
                leftIcon={<Camera className="size-4" />}
                onClick={() => setAttempt((value) => value + 1)}
              >
                {t("recipe.cards.scan.retry")}
              </Button>
            )}
          </div>
        ) : phase.state === "starting" ? (
          /* Only while there is nothing to look at yet — a spinner over a live
             viewfinder would suggest the app is busy rather than watching. */
          <p className="flex items-center gap-2 text-sm text-fg-muted">
            <Spinner size="sm" />
            <span>{t("recipe.cards.scan.starting")}</span>
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
