import { useState, type ReactNode } from "react";
import { useT } from "@/lib/i18n";
import { Button } from "./Button";
import { Dialog } from "./Dialog";

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  /** Awaited — the confirm button shows a spinner until it resolves. */
  onConfirm: () => void | Promise<unknown>;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button for deletions. */
  destructive?: boolean;
  children?: ReactNode;
}

/**
 * "Wirklich löschen?" confirmation. Closes itself when `onConfirm` resolves and
 * keeps the dialog open (with the error visible via a toast) when it rejects.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive = false,
  children,
}: ConfirmDialogProps) {
  const t = useT();
  const [pending, setPending] = useState(false);
  const resolvedConfirmLabel = confirmLabel ?? t("common.confirmDialog.confirm");
  const resolvedCancelLabel = cancelLabel ?? t("common.confirmDialog.cancel");

  async function confirm() {
    setPending(true);
    try {
      await onConfirm();
      onClose();
    } catch {
      // The caller reports the failure (usually via useToast); keep the dialog open.
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      dismissable={!pending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending} fullWidth>
            {resolvedCancelLabel}
          </Button>
          <Button
            variant={destructive ? "danger" : "primary"}
            onClick={confirm}
            loading={pending}
            fullWidth
            data-autofocus
          >
            {resolvedConfirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
