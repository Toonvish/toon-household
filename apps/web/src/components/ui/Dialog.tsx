import { useCallback, useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { IconButton } from "./IconButton";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  /** Footer actions — stacked on mobile, right-aligned from `sm` up. */
  footer?: ReactNode;
  /** `sheet` (default) = bottom sheet on phones + centred modal on desktop. */
  variant?: "sheet" | "modal";
  size?: "sm" | "md" | "lg";
  /** Set to false for destructive flows that must not close by accident. */
  dismissable?: boolean;
  className?: string;
  children?: ReactNode;
}

const sizes = { sm: "sm:max-w-sm", md: "sm:max-w-lg", lg: "sm:max-w-2xl" } as const;

/** Counts open dialogs so nested dialogs don't unlock body scroll too early. */
let openDialogs = 0;

export function Dialog({
  open,
  onClose,
  title,
  description,
  footer,
  variant = "sheet",
  size = "md",
  dismissable = true,
  className,
  children,
}: DialogProps) {
  const t = useT();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  const requestClose = useCallback(() => {
    if (dismissable) onClose();
  }, [dismissable, onClose]);

  // Body scroll lock + restoring focus to whatever opened the dialog.
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    openDialogs += 1;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      openDialogs = Math.max(0, openDialogs - 1);
      if (openDialogs === 0) document.body.style.overflow = previousOverflow;
      previouslyFocused.current?.focus({ preventScroll: true });
    };
  }, [open]);

  /*
   * Initial focus (toon-finance gotchas 58 and 63 at 1715207). Deliberately runs after EVERY
   * render while open, not just on `open`, because the panel's content can arrive later than the
   * panel: the finance quick-add sheet renders a `LoadingBlock` until the other participant is
   * loaded, so a one-shot pass found no `[data-autofocus]`, settled for the panel and never moved
   * to the amount field when the form finally mounted. The two refs make it act at most twice,
   * once on the fallback and once when the requested target appears, so it can never steal focus
   * back from a user who has already started typing.
   *
   * `[data-autofocus]` is asked for FIRST, in its own query. Folded into one comma-separated
   * selector it never won: `querySelector` returns the first element in DOCUMENT order matching
   * ANY branch, and the close button in the header precedes everything in the body, so the sheet
   * opened with the "X" focused instead of the amount.
   */
  const autofocusDone = useRef(false);
  const fallbackDone = useRef(false);
  useEffect(() => {
    if (!open) {
      autofocusDone.current = false;
      fallbackDone.current = false;
      return;
    }
    if (autofocusDone.current) return;
    const panel = panelRef.current;
    if (!panel) return;

    const requested = panel.querySelector<HTMLElement>("[data-autofocus]");
    if (requested) {
      autofocusDone.current = true;
      fallbackDone.current = true;
      requested.focus({ preventScroll: true });
      return;
    }
    if (fallbackDone.current) return;
    fallbackDone.current = true;
    const fallback =
      panel.querySelector<HTMLElement>(
        "input:not([type=hidden]), textarea, select, button, [href], [tabindex]:not([tabindex='-1'])",
      ) ?? panel;
    fallback.focus({ preventScroll: true });
  });

  // Escape + a minimal focus trap (Tab cycles inside the panel).
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        requestClose();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          "a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), [tabindex]:not([tabindex='-1'])",
        ),
      ).filter((element) => element.offsetParent !== null || element === document.activeElement);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, requestClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex" role="presentation">
      <div
        className="absolute inset-0 bg-overlay animate-fade-in"
        onClick={requestClose}
        aria-hidden="true"
      />
      <div
        className={cn(
          "relative z-10 flex w-full flex-col bg-surface text-fg shadow-pop",
          variant === "sheet"
            ? "mt-auto max-h-[92dvh] rounded-t-sheet animate-slide-up sm:m-auto sm:max-h-[85dvh] sm:rounded-sheet"
            : "m-auto max-h-[90dvh] w-[calc(100%-1.5rem)] rounded-sheet animate-fade-in",
          sizes[size],
          className,
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        ref={panelRef}
      >
        {variant === "sheet" ? (
          <div aria-hidden="true" className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-line sm:hidden" />
        ) : null}

        {title || dismissable ? (
          <div className="flex items-start gap-3 px-5 pt-4 pb-2">
            <div className="min-w-0 flex-1">
              {title ? (
                <h2 id={titleId} className="font-display text-display-md font-medium">
                  {title}
                </h2>
              ) : null}
              {description ? (
                <p id={descriptionId} className="mt-1 text-sm text-fg-muted">
                  {description}
                </p>
              ) : null}
            </div>
            {dismissable ? (
              <IconButton
                label={t("common.dialog.close")}
                icon={<X />}
                onClick={onClose}
                className="-mt-1 -mr-2"
              />
            ) : null}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2">{children}</div>

        {footer ? (
          <div className="flex flex-col-reverse gap-2 border-t border-line px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end sm:pb-4">
            {footer}
          </div>
        ) : (
          <div className="pb-[max(0.75rem,env(safe-area-inset-bottom))]" />
        )}
      </div>
    </div>,
    document.body,
  );
}
