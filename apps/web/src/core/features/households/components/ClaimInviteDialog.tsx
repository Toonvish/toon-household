/**
 * The claim-link dialog (`household.claim.title`): creates a CLAIM invite for a placeholder member and shows the
 * link (ADR 0006). Whoever opens it registers as that person; the placeholder's user id becomes
 * the new account's id, so everything assigned to the person stays with them. No address is
 * sent: the link is shared by hand, like any invite whose mail was not delivered.
 */
import { useState } from "react";
import { Copy, Share2 } from "lucide-react";
import type { HouseholdMember } from "@toon/shared";
import { Button, Dialog, useToast } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { copyToClipboard, shareOrCopy } from "@/lib/share";
import { useCreateInvite } from "../lib/queries";

export interface ClaimInviteDialogProps {
  householdId: string;
  householdName: string;
  /** The placeholder to create the link for; `null` keeps the dialog closed. */
  member: HouseholdMember | null;
  onClose: () => void;
}

export function ClaimInviteDialog({ householdId, householdName, member, onClose }: ClaimInviteDialogProps) {
  const t = useT();
  return (
    <Dialog
      open={member !== null}
      onClose={onClose}
      title={member ? t("household.claim.title", { name: member.user.name }) : undefined}
      description={member ? t("household.claim.hint") : undefined}
      size="sm"
    >
      {member ? (
        <ClaimBody
          key={member.userId}
          householdId={householdId}
          householdName={householdName}
          member={member}
          onClose={onClose}
        />
      ) : null}
    </Dialog>
  );
}

function ClaimBody({
  householdId,
  householdName,
  member,
  onClose,
}: {
  householdId: string;
  householdName: string;
  member: HouseholdMember;
  onClose: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const createInvite = useCreateInvite();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setError(null);
    try {
      const response = await createInvite.mutateAsync({
        householdId,
        role: "member",
        claimsUserId: member.userId,
      });
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
        <Button onClick={() => void create()} loading={createInvite.isPending} fullWidth>
          {t("household.claim.create")}
        </Button>
      ) : (
        <div className="flex flex-col gap-2">
          <code className="block overflow-x-auto rounded-lg bg-surface-2 p-2 text-xs text-fg">{url}</code>
          <p className="text-sm text-fg-muted">{t("household.claim.linkHint")}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Copy className="size-4" />}
              onClick={async () => {
                if (await copyToClipboard(url)) toast.success(t("household.invite.linkCopiedToast"));
                else toast.error(t("household.invite.copyFailedToast"));
              }}
            >
              {t("household.invite.copyButton")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<Share2 className="size-4" />}
              onClick={async () => {
                const result = await shareOrCopy({
                  title: t("household.invite.shareTitle", { name: householdName }),
                  url,
                });
                if (result === "copied") toast.success(t("household.invite.linkCopiedToast"));
              }}
            >
              {t("household.invite.shareButton")}
            </Button>
          </div>
        </div>
      )}

      <Button type="button" variant="secondary" onClick={onClose} fullWidth>
        {t("household.common.cancel")}
      </Button>
    </div>
  );
}
