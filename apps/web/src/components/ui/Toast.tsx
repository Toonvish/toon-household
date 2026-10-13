import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Check, CircleAlert, Info, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { errorMessage } from "@/lib/api";
import { Button } from "./Button";

export type ToastVariant = "info" | "success" | "warning" | "error";

export interface ToastAction {
  /** Ready-to-render label — the caller has already run it through `t()`. */
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** Milliseconds until auto-dismiss; 0 keeps it until the user closes it. */
  duration?: number;
  /**
   * One tap instead of a second confirm dialog — the cooked/bought undo (T8.4, T8.6)
   * are the reason this exists. Takes no `t()` of its own; the caller supplies an
   * already-localized label.
   */
  action?: ToastAction;
}

interface ToastEntry extends Required<Omit<ToastOptions, "description" | "action">> {
  id: number;
  description?: string;
  action?: ToastAction;
}

export interface ToastApi {
  /** `toast({ title: "Saved" })` */
  toast: (options: ToastOptions) => number;
  success: (title: string, description?: string) => number;
  error: (title: string, description?: string) => number;
  /** Shows the localized message of any thrown value (ApiError aware). */
  fromError: (error: unknown, title?: string) => number;
  dismiss: (id: number) => void;
  dismissAll: () => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const variantStyles: Record<ToastVariant, { wrapper: string; icon: ReactNode }> = {
  info: { wrapper: "border-line bg-surface text-fg", icon: <Info className="text-brand" /> },
  success: {
    wrapper: "border-success/40 bg-success-soft text-success-soft-fg",
    icon: <Check className="text-success" />,
  },
  warning: {
    wrapper: "border-warning/40 bg-warning-soft text-warning-soft-fg",
    icon: <TriangleAlert className="text-warning" />,
  },
  error: {
    wrapper: "border-danger/40 bg-danger-soft text-danger-soft-fg",
    icon: <CircleAlert className="text-danger" />,
  },
};

/** Wrap the app once; then use {@link useToast} anywhere below it. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [entries, setEntries] = useState<ToastEntry[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setEntries((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const toast = useCallback(
    (options: ToastOptions) => {
      const id = nextId.current++;
      const entry: ToastEntry = {
        id,
        title: options.title,
        variant: options.variant ?? "info",
        duration: options.duration ?? (options.variant === "error" ? 7000 : 4000),
        ...(options.description !== undefined ? { description: options.description } : {}),
        ...(options.action !== undefined ? { action: options.action } : {}),
      };
      setEntries((current) => [...current.slice(-2), entry]);
      if (entry.duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), entry.duration),
        );
      }
      return id;
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      toast,
      success: (title, description) =>
        toast({ title, variant: "success", ...(description ? { description } : {}) }),
      error: (title, description) =>
        toast({ title, variant: "error", ...(description ? { description } : {}) }),
      fromError: (error, title = t("common.toast.defaultErrorTitle")) =>
        toast({ title, description: errorMessage(error), variant: "error" }),
      dismiss,
      dismissAll: () => {
        for (const timer of timers.current.values()) clearTimeout(timer);
        timers.current.clear();
        setEntries([]);
      },
    }),
    [toast, dismiss, t],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {typeof document !== "undefined"
        ? createPortal(<ToastViewport entries={entries} onDismiss={dismiss} />, document.body)
        : null}
    </ToastContext.Provider>
  );
}

function ToastViewport({
  entries,
  onDismiss,
}: {
  entries: readonly ToastEntry[];
  onDismiss: (id: number) => void;
}) {
  const t = useT();
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))]"
    >
      {entries.map((entry) => {
        const styles = variantStyles[entry.variant];
        return (
          <div
            key={entry.id}
            role={entry.variant === "error" ? "alert" : "status"}
            className={cn(
              "pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border p-3 shadow-pop animate-slide-down",
              styles.wrapper,
            )}
          >
            <span aria-hidden="true" className="mt-0.5 [&_svg]:size-5">
              {styles.icon}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{entry.title}</p>
              {entry.description ? (
                <p className="mt-0.5 text-sm break-words opacity-90">{entry.description}</p>
              ) : null}
              {entry.action ? (
                <div className="mt-1.5">
                  {/*
                   * The design calls this a "quiet" button (see Button.tsx's own
                   * comment: filled variants are 700 weight, quiet ones stay 600) —
                   * there is no literal `variant="quiet"` on `Button`, and `ghost` is
                   * its unfilled 600-weight variant, so it is the one that reads as
                   * quiet sitting on a tinted toast surface.
                   */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      entry.action?.onClick();
                      onDismiss(entry.id);
                    }}
                  >
                    {entry.action.label}
                  </Button>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => onDismiss(entry.id)}
              aria-label={t("common.toast.dismissLabel")}
              className="-m-1 flex size-9 shrink-0 items-center justify-center rounded-lg opacity-70 hover:opacity-100 focus-visible:outline-2 focus-visible:outline-ring"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** Throws when used outside <ToastProvider> — that is a wiring bug, not a runtime state. */
export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside <ToastProvider>.");
  return context;
}
