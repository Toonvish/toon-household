/**
 * "Konto für {name} verknüpfen" (F's `linkAccount`, finance wording: the seat and its bookings):
 * creates the CLAIM invite of a placeholder seat through the core's `POST …/invites` (admin+,
 * ADR 0006) and shows the link to copy. Whoever opens it registers as that person; the
 * placeholder's user id becomes the new account's id, so every booking stays with them. No
 * address is sent, the link is shared by hand. Module-local on purpose: the core's own claim
 * dialog lives under `@/core/features`, which a static manifest import must not reach.
 *
 * Static manifest graph: no module registry, no layout components, no `@/core/features`.
 */
import { useState } from "react";
import { Copy } from "lucide-react";
import type { FinanceParticipantResponse } from "@toon/shared";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { errorMessage } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { copyToClipboard } from "@/lib/share";
import { useCreateClaimLink } from "./lib/queries";

export interface ClaimLinkDialogProps {
  householdId: string;
  /** The placeholder seat to create the link for; `null` keeps the dialog closed. */
  participant: FinanceParticipantResponse | null;
  onClose: () => void;
}

export function ClaimLinkDialog({ householdId, participant, onClose }: ClaimLinkDialogProps) {
  const t = useT();
  return (
    <Dialog
      open={participant !== null}
      onClose={onClose}
      title={participant ? t("finance.settings.household.linkAccount", { name: participant.displayName }) : undefined}
      description={participant ? t("finance.settings.household.linkAccountHint") : undefined}
      size="sm"
    >
      {participant ? (
        <ClaimBody key={participant.userId} householdId={householdId} participant={participant} onClose={onClose} />
      ) : null}
    </Dialog>
  );
}

function ClaimBody({
  householdId,
  participant,
  onClose,
}: {
  householdId: string;
  participant: FinanceParticipantResponse;
  onClose: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const create = useCreateClaimLink(householdId);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function copy(link: string) {
    if (await copyToClipboard(link)) toast.success(t("household.invite.linkCopiedToast"));
    else toast.error(t("household.invite.copyFailedToast"));
  }

  async function createLink() {
    setError(null);
    try {
      const response = await create.mutateAsync({ claimsUserId: participant.userId });
      setUrl(response.inviteUrl);
      if (await copyToClipboard(response.inviteUrl)) toast.success(t("household.invite.linkCopiedToast"));
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
      {url === null ? (
        <Button onClick={() => void createLink()} loading={create.isPending} fullWidth>
          {t("finance.settings.household.linkAccountCreate")}
        </Button>
      ) : (
        <div className="flex flex-col gap-2">
          <code className="block overflow-x-auto rounded-lg bg-surface-2 p-2 text-xs text-fg">{url}</code>
          <p className="text-sm text-fg-muted">{t("finance.settings.household.linkAccountLinkHint")}</p>
          <div>
            <Button variant="secondary" size="sm" leftIcon={<Copy className="size-4" />} onClick={() => void copy(url)}>
              {t("finance.common.copy")}
            </Button>
          </div>
        </div>
      )}
      <Button type="button" variant="secondary" onClick={onClose} fullWidth>
        {t("finance.common.cancel")}
      </Button>
    </div>
  );
}

export default ClaimLinkDialog;
