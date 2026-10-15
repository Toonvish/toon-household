/**
 * The module-provided "Aktivieren" dialog (M3 decision 4; the core opens it when the manifest
 * declares `enableDialog`): lists the household's members, preselects the viewer as slot 1,
 * asks for slot 2 and enables finance with both as the module settings. "Ohne Konto hinzufügen"
 * (ADR 0006, F's placeholder) is always offered: it adds a person by name and preselects them for
 * slot 2 (a placeholder may only hold slot 2, so the slot-1 select never lists one). A household
 * with fewer than two members gets `needsTwoMembers` AND that block instead of a dead end, and
 * no submit until a second person exists.
 *
 * Static manifest graph: imports neither the module registry, nor the layout components, nor the module page header.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { useT } from "@/lib/i18n";
import { householdMembersQuery } from "@/lib/queries";
import { useActiveHousehold, useCanMutate, useCurrentUser } from "@/lib/session";
import {
  assignmentBody,
  assignmentError,
  assignmentOptions,
  initialAssignment,
  toAssignable,
  withBadge,
  type Assignment,
} from "./lib/assignment";
import { useEnableFinance } from "./lib/queries";
import { PlaceholderForm } from "./PlaceholderForm";

export interface EnableFinanceDialogProps {
  open: boolean;
  onClose: () => void;
}

/** Mounts the body only while open, so every opening starts from a fresh preselection. */
export function EnableFinanceDialog({ open, onClose }: EnableFinanceDialogProps) {
  const { householdId } = useActiveHousehold();
  if (!open || householdId === null) return null;
  return <EnableFinanceDialogBody householdId={householdId} onClose={onClose} />;
}

function EnableFinanceDialogBody({ householdId, onClose }: { householdId: string; onClose: () => void }) {
  const t = useT();
  const user = useCurrentUser();
  const { canMutate, reason } = useCanMutate();
  const members = useQuery(householdMembersQuery(householdId));
  const enable = useEnableFinance(householdId);
  const [override, setOverride] = useState<Partial<Assignment>>({});

  const assignable = toAssignable(members.data?.items ?? []);
  const needsTwo = members.data !== undefined && assignable.length < 2;
  const assignment: Assignment = { ...initialAssignment(assignable, user.id), ...override };
  const badge = t("finance.settings.household.placeholderBadge");
  const slot1Options = withBadge(assignmentOptions(assignable, null, 1), badge);
  const slot2Options = withBadge(assignmentOptions(assignable, null, 2), badge);
  const errorKey = assignmentError(assignment);
  const body = assignmentBody(assignment, assignable);

  const footer = (
    <>
      <Button variant="secondary" onClick={onClose}>
        {t("finance.common.cancel")}
      </Button>
      {needsTwo ? null : (
        <Button
          type="submit"
          form="enable-finance-form"
          loading={enable.isPending}
          disabled={!canMutate || body === null}
          title={reason}
        >
          {t("home.modules.enable")}
        </Button>
      )}
    </>
  );

  return (
    <Dialog
      open
      onClose={onClose}
      title={t("finance.participants.enableTitle")}
      description={t("finance.participants.description")}
      footer={footer}
    >
      {members.isPending ? (
        <Skeleton lines={3} />
      ) : (
        <div className="flex flex-col gap-4">
          {needsTwo ? <p className="text-sm text-fg">{t("finance.participants.needsTwoMembers")}</p> : null}
          {needsTwo ? null : (
            <form
              id="enable-finance-form"
              className="flex flex-col gap-3 py-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (body) enable.mutate(body, { onSuccess: onClose });
              }}
            >
              <Select
                label={t("finance.participants.slot1")}
                value={assignment.slot1}
                options={slot1Options}
                placeholder={t("finance.common.select")}
                onChange={(event) => setOverride({ ...override, slot1: event.target.value })}
              />
              <Select
                label={t("finance.participants.slot2")}
                value={assignment.slot2}
                options={slot2Options}
                placeholder={t("finance.common.select")}
                error={errorKey ? t(errorKey) : undefined}
                onChange={(event) => setOverride({ ...override, slot2: event.target.value })}
              />
            </form>
          )}
          <PlaceholderForm
            householdId={householdId}
            className="flex flex-col gap-3 border-t border-border pt-4"
            onCreated={(member) => setOverride((previous) => ({ ...previous, slot2: member.userId }))}
          />
        </div>
      )}
    </Dialog>
  );
}

export default EnableFinanceDialog;
