/**
 * The ONE coupling seam to the app shell.
 *
 * The import feature only ever touches shell code through this file:
 *   - `@/components/ui`  -> Button, Input, Textarea, Select, Label, Card, Badge,
 *                           Spinner, EmptyState, ErrorState, ConfirmDialog, useToast
 *   - `@/lib/session`    -> useActiveHousehold(), useCanMutate()
 *
 * INTEGRATION NOTE: this module used to carry a full set of native fallback
 * primitives ("FallbackButton", "FallbackInput", …) in case the concurrently built
 * shell exported different names. The shell is real now, so the duplicates were
 * DELETED — `@/components/ui` is the single implementation of every primitive.
 *
 * What remains is only the *typing* seam: the import screens pass a wider prop
 * union (`onChange` with a native event, string `variant`s, `message` instead of
 * `description`) than the shell's exact prop types. Each re-export is therefore
 * cast once here instead of at ~200 call sites. Because the components are now
 * imported by name, deleting or renaming a shell export is a compile error.
 */
import {
  Badge as ShellBadge,
  Button as ShellButton,
  Card as ShellCard,
  ConfirmDialog as ShellConfirmDialog,
  EmptyState as ShellEmptyState,
  ErrorState as ShellErrorState,
  Input as ShellInput,
  Label as ShellLabel,
  Select as ShellSelect,
  Spinner as ShellSpinner,
  Textarea as ShellTextarea,
  useToast,
} from "@/components/ui";
import { useActiveHousehold, useCanMutate } from "@/lib/session";
import {
  useCallback,
  useMemo,
  type ChangeEvent,
  type ClipboardEvent,
  type ComponentType,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";

/* -------------------------------------------------------------------------- */
/* UI components                                                               */
/* -------------------------------------------------------------------------- */

export interface ButtonProps {
  children?: ReactNode;
  type?: "button" | "submit" | "reset";
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger" | "accent";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  fullWidth?: boolean;
  leftIcon?: ReactNode;
  className?: string;
  disabled?: boolean;
  title?: string;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  "aria-label"?: string;
  "aria-expanded"?: boolean;
}

export interface FieldProps {
  id?: string;
  name?: string;
  value?: string | number;
  defaultValue?: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  autoFocus?: boolean;
  type?: string;
  inputMode?: "text" | "numeric" | "decimal" | "url" | "email" | "search" | "tel";
  min?: number | string;
  max?: number | string;
  step?: number | string;
  rows?: number;
  list?: string;
  spellCheck?: boolean;
  autoComplete?: string;
  onChange?: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void;
  onBlur?: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
  onPaste?: (event: ClipboardEvent<HTMLElement>) => void;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  /** Wrapper class list (the shell fields render label + control in a flex column). */
  containerClassName?: string;
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
  autoGrow?: boolean;
  leftIcon?: ReactNode;
  children?: ReactNode;
  /** `Select` is data driven — it renders these, children are not supported. */
  options?: ReadonlyArray<{ value: string; label: string; disabled?: boolean }>;
}

export interface LabelProps {
  htmlFor?: string;
  className?: string;
  children?: ReactNode;
}

export interface CardProps {
  className?: string;
  children?: ReactNode;
}

export interface BadgeProps {
  className?: string;
  variant?: string;
  children?: ReactNode;
}

export interface SpinnerProps {
  className?: string;
  size?: string | number;
}

export interface StateProps {
  title?: string;
  description?: string;
  message?: string;
  icon?: ReactNode;
  className?: string;
  action?: ReactNode;
  children?: ReactNode;
  /** ErrorState variants in the wild use one of these names for the retry hook. */
  onRetry?: () => void;
  retry?: () => void;
  error?: unknown;
}

export interface ConfirmDialogProps {
  open?: boolean;
  title?: string;
  description?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  variant?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
  onClose?: () => void;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
}

export const Button = ShellButton as unknown as ComponentType<ButtonProps>;
export const Input = ShellInput as unknown as ComponentType<FieldProps>;
export const Textarea = ShellTextarea as unknown as ComponentType<FieldProps>;
export const Select = ShellSelect as unknown as ComponentType<FieldProps>;
export const Label = ShellLabel as unknown as ComponentType<LabelProps>;
export const Card = ShellCard as unknown as ComponentType<CardProps>;
export const Badge = ShellBadge as unknown as ComponentType<BadgeProps>;
export const Spinner = ShellSpinner as unknown as ComponentType<SpinnerProps>;
export const EmptyState = ShellEmptyState as unknown as ComponentType<StateProps>;
export const ErrorState = ShellErrorState as unknown as ComponentType<StateProps>;
export const ConfirmDialog = ShellConfirmDialog as unknown as ComponentType<ConfirmDialogProps>;

/**
 * Reads the new value from a change handler argument regardless of whether the
 * component hands over a DOM event or the plain value.
 */
export function readChangeValue(argument: unknown): string {
  if (typeof argument === "string") return argument;
  if (typeof argument === "number") return String(argument);
  if (typeof argument === "object" && argument !== null) {
    const target = (argument as { target?: { value?: unknown } }).target;
    if (target !== undefined && typeof target.value !== "undefined") return String(target.value);
    const value = (argument as { value?: unknown }).value;
    if (typeof value !== "undefined") return String(value);
  }
  return "";
}

export type ToastVariant = "success" | "error" | "info";

export interface ToastInput {
  title: string;
  description?: string;
  variant?: ToastVariant;
}

/** Thin adapter onto the shell's `useToast().toast({ title, description, variant })`. */
export function useShellToast(): (input: ToastInput) => void {
  const { toast } = useToast();
  return useCallback(
    (input: ToastInput) => {
      toast({
        title: input.title,
        description: input.description,
        variant: input.variant ?? "info",
      });
    },
    [toast],
  );
}

/* -------------------------------------------------------------------------- */
/* session / active household                                                      */
/* -------------------------------------------------------------------------- */

export interface HouseholdOption {
  id: string;
  name: string;
  role?: string;
}

export interface ActiveHouseholdState {
  householdId?: string;
  householdName?: string;
  households: HouseholdOption[];
  isLoading: boolean;
  switchHousehold: (householdId: string) => void;
}

/**
 * Whether importing is possible at all right now.
 *
 * NOTHING in the import flow works offline: every source posts to the server, and
 * OCR runs there. The offline PWA support is read-only by design (no mutation
 * outbox), so the screen disables its entry points and says why rather than letting
 * a 15 MB upload fail after the user picked a photo.
 */
export function useImportAvailability(): { enabled: boolean; reason: string | undefined } {
  const { canMutate, reason } = useCanMutate();
  return { enabled: canMutate, reason };
}

/** Normalised view of the shell's `useActiveHousehold()`. */
export function useActiveHouseholdState(): ActiveHouseholdState {
  const { householdId, household, households: shellHouseholds, setActiveHousehold } = useActiveHousehold();

  const households = useMemo<HouseholdOption[]>(
    () => shellHouseholds.map((entry) => ({ id: entry.id, name: entry.name, role: entry.role })),
    [shellHouseholds],
  );

  const switchHousehold = useCallback(
    (nextHouseholdId: string) => {
      setActiveHousehold(nextHouseholdId);
    },
    [setActiveHousehold],
  );

  return {
    householdId: householdId ?? households[0]?.id,
    householdName: household?.name ?? households.find((entry) => entry.id === householdId)?.name,
    // The shell resolves the session before rendering household-scoped routes
    // (<RequireAuth> + <RequireActiveHousehold>), so by this point it is never loading.
    isLoading: false,
    households,
    switchHousehold,
  };
}
