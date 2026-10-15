/**
 * Renames a placeholder member (a person added by name, without an account; ADR 0006).
 * Admin+ only; the API answers `409 member_has_account` for a member that has one. The name
 * is content (the person's own), so it never goes through `t()`.
 */
import { useState } from "react";
import { UpdatePlaceholderMemberRequestSchema, type HouseholdMember } from "@toon/shared";
import { Button, Dialog, Input } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { apiFieldErrors, validate, type FieldErrors } from "@/lib/validation";
import { useRenamePlaceholder } from "../lib/queries";

export interface PlaceholderRenameDialogProps {
  householdId: string;
  /** The placeholder to rename; `null` keeps the dialog closed. */
  member: HouseholdMember | null;
  onClose: () => void;
}

export function PlaceholderRenameDialog({ householdId, member, onClose }: PlaceholderRenameDialogProps) {
  // Remount per member, so the field always starts from that person's current name.
  return (
    <Dialog
      open={member !== null}
      onClose={onClose}
      title={member ? member.user.name : undefined}
      size="sm"
    >
      {member ? (
        <RenameForm key={member.userId} householdId={householdId} member={member} onClose={onClose} />
      ) : null}
    </Dialog>
  );
}

function RenameForm({
  householdId,
  member,
  onClose,
}: {
  householdId: string;
  member: HouseholdMember;
  onClose: () => void;
}) {
  const t = useT();
  const rename = useRenamePlaceholder();
  const [name, setName] = useState(member.user.name);
  const [errors, setErrors] = useState<FieldErrors>({});

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validate(UpdatePlaceholderMemberRequestSchema, { name });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    try {
      await rename.mutateAsync({ householdId, userId: member.userId, name: result.data.name });
      onClose();
    } catch (error) {
      setErrors(apiFieldErrors(error));
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      {errors._form ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {errors._form}
        </p>
      ) : null}
      <Input
        label={t("household.placeholder.nameLabel")}
        required
        value={name}
        onChange={(event) => setName(event.target.value)}
        error={errors.name}
        disabled={rename.isPending}
        autoFocus
      />
      <div className="mt-1 flex gap-2">
        <Button type="button" variant="secondary" onClick={onClose} fullWidth disabled={rename.isPending}>
          {t("household.common.cancel")}
        </Button>
        <Button type="submit" loading={rename.isPending} fullWidth>
          {t("household.common.save")}
        </Button>
      </div>
    </form>
  );
}
