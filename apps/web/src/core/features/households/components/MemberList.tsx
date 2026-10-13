/**
 * Member list with role controls.
 *
 * Rules mirrored from docs/API.md (the API enforces them, this only hides the controls):
 *  - admins may change roles, but only an OWNER may grant `owner` (= ownership transfer,
 *    the previous owner becomes admin)
 *  - the last owner can neither be demoted nor removed (409 `last_owner`)
 *  - every member may remove themselves (the "leave household" action)
 */
import { useState } from "react";
import { LogOut, ShieldCheck, UserMinus } from "lucide-react";
import type { HouseholdMember, HouseholdRole } from "@toon/shared";
import { ActionMenu, Avatar, Badge, ConfirmDialog } from "@/components/ui";
import { useToast } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { hasAtLeast } from "@/lib/permissions";
import { ROLE_LABEL_KEYS } from "../lib/roleLabels";
import { useChangeMemberRole, useRemoveMember } from "../lib/queries";

export interface MemberListProps {
  householdId: string;
  members: readonly HouseholdMember[];
  /** Role of the CURRENT user in this household. */
  myRole: HouseholdRole | null;
  myUserId: string;
  /** Called after the current user left the household. */
  onLeft: () => void;
}

export function MemberList({ householdId, members, myRole, myUserId, onLeft }: MemberListProps) {
  const t = useT();
  const changeRole = useChangeMemberRole();
  const removeMember = useRemoveMember();
  const toast = useToast();
  const [pendingRemoval, setPendingRemoval] = useState<HouseholdMember | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);

  const isAdmin = hasAtLeast(myRole, "admin");
  const isOwner = myRole === "owner";
  const ownerCount = members.filter((member) => member.role === "owner").length;

  const roleOptions: ReadonlyArray<{ value: HouseholdRole; label: string }> = [
    { value: "member", label: t(ROLE_LABEL_KEYS.member) },
    { value: "admin", label: t(ROLE_LABEL_KEYS.admin) },
    { value: "owner", label: t(ROLE_LABEL_KEYS.owner) },
  ];

  async function setRole(member: HouseholdMember, role: HouseholdRole) {
    if (role === member.role) return;
    try {
      await changeRole.mutateAsync({ householdId, userId: member.userId, role });
      toast.success(
        role === "owner"
          ? t("household.members.ownershipTransferredToast")
          : t("household.members.roleChangedToast"),
        `${member.user.name}: ${t(ROLE_LABEL_KEYS[role])}`,
      );
    } catch (error) {
      toast.fromError(error, t("household.members.roleChangeFailedToast"));
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col divide-y divide-line">
        {members.map((member) => {
          const isMe = member.userId === myUserId;
          const isLastOwner = member.role === "owner" && ownerCount === 1;
          // Only an owner may hand out `owner`; nobody may demote the last owner.
          const canChangeRole = isAdmin && !isLastOwner;
          const canRemove = (isAdmin || isMe) && !isLastOwner;

          return (
            <li key={member.id} className="flex flex-wrap items-center gap-3 py-3">
              <Avatar name={member.user.name} src={member.user.avatarUrl} />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-medium text-fg">
                  <span className="truncate">{member.user.name}</span>
                  {isMe ? <Badge variant="brand">{t("household.members.you")}</Badge> : null}
                  {isLastOwner ? (
                    <Badge variant="neutral">{t("household.members.soleOwner")}</Badge>
                  ) : null}
                </p>
                <p className="truncate text-sm text-fg-muted">{member.user.email}</p>
              </div>

              <Badge variant={member.role === "owner" ? "brand" : "neutral"}>
                {t(ROLE_LABEL_KEYS[member.role])}
              </Badge>

              {/* One overflow trigger per row, not a row of icon buttons — the same
                  reasoning `RecipeDetailPage`'s header applies to a dense row of members.
                  Role changes and remove/leave both live here now; a plain `Badge` above
                  is all that shows when neither is available to the current user. */}
              <ActionMenu
                label={t("household.members.roleAriaLabel", { name: member.user.name })}
                title={member.user.name}
                triggerVariant="ghost"
                items={[
                  ...(canChangeRole
                    ? roleOptions
                        .filter((option) => option.value !== member.role)
                        .filter((option) => option.value !== "owner" || isOwner)
                        .map((option) => ({
                          label: t(ROLE_LABEL_KEYS[option.value]),
                          icon: <ShieldCheck className="size-4" />,
                          onSelect: () => void setRole(member, option.value),
                          disabled: changeRole.isPending,
                        }))
                    : []),
                  canRemove && {
                    label: isMe ? t("household.members.leave") : t("household.members.remove"),
                    icon: isMe ? <LogOut className="size-4" /> : <UserMinus className="size-4" />,
                    onSelect: () => (isMe ? setLeaveOpen(true) : setPendingRemoval(member)),
                    variant: "danger" as const,
                  },
                ]}
              />
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={pendingRemoval !== null}
        onClose={() => setPendingRemoval(null)}
        destructive
        title={t("household.members.removeConfirmTitle")}
        description={
          pendingRemoval
            ? t("household.members.removeConfirmDescription", { name: pendingRemoval.user.name })
            : undefined
        }
        confirmLabel={t("household.members.remove")}
        onConfirm={async () => {
          if (!pendingRemoval) return;
          try {
            await removeMember.mutateAsync({ householdId, userId: pendingRemoval.userId });
            toast.success(t("household.members.removedToast"), pendingRemoval.user.name);
          } catch (error) {
            toast.fromError(error, t("household.members.removeFailedToast"));
            throw error;
          }
        }}
      />

      <ConfirmDialog
        open={leaveOpen}
        onClose={() => setLeaveOpen(false)}
        destructive
        title={t("household.members.leaveConfirmTitle")}
        description={t("household.members.leaveConfirmDescription")}
        confirmLabel={t("household.members.leave")}
        onConfirm={async () => {
          try {
            await removeMember.mutateAsync({ householdId, userId: myUserId });
            toast.success(t("household.members.leftToast"));
            onLeft();
          } catch (error) {
            toast.fromError(error, t("household.members.leaveFailedToast"));
            throw error;
          }
        }}
      />
    </div>
  );
}
