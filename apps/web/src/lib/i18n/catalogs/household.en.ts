/**
 * English — namespace "household". See `household.de.ts` for who owns this file
 * and what it covers.
 */
import type { LocaleCatalog } from "@toon/shared";
import type { HouseholdCatalog } from "./household.de.ts";

export const householdEn: LocaleCatalog<HouseholdCatalog> = {
  /* ------------------------------ shared/common ----------------------------- */
  "household.common.name": "Name",
  "household.common.description": "Description",
  "household.common.cancel": "Cancel",
  "household.common.save": "Save",
  "household.common.create": "Create",
  "household.common.delete": "Delete",
  "household.badge.active": "Active",
  "household.count.members": { one: "{count} member", other: "{count} members" },
  "household.role.owner": "Owner",
  "household.role.admin": "Admin",
  "household.role.member": "Member",

  /* ------------------------------ GroupsPage.tsx ---------------------------- */
  "household.list.title": "Groups",
  "household.list.subtitle": "Recipes, tags and collections always belong to a group.",
  "household.list.create": "Create group",
  "household.list.emptyTitle": "No group yet",
  "household.list.emptyDescription":
    "Create a group, e.g. “Family”, and invite others by e-mail.",
  "household.list.activate": "Activate",
  "household.list.manage": "Manage",
  "household.create.title": "New group",
  "household.create.description":
    "You'll automatically become the owner and can invite members afterwards.",
  "household.create.namePlaceholder": "Family",
  "household.create.descriptionPlaceholder": "Our collected family recipes.",
  "household.create.successTitle": "Group created",

  /* ---------------------------- GroupDetailPage.tsx ------------------------- */
  "household.detail.loading": "Loading group …",
  "household.detail.backToList": "Back to groups",
  "household.detail.backLink": "← All groups",
  "household.detail.tab.members": "Members",
  "household.detail.tab.invites": "Invites",
  "household.detail.tab.settings": "Settings",
  "household.detail.tabsAriaLabel": "Group sections",
  "household.detail.meta": "{members} · created on {date}",
  "household.detail.activate": "Set as active group",
  "household.settings.heading": "Group details",
  "household.settings.readonlyHint": "Only admins and owners can change these details.",
  "household.settings.savedToast": "Group saved",
  "household.danger.heading": "Delete group",
  "household.danger.deleteButton": "Delete group",
  "household.danger.deletedToast": "Group deleted",
  "household.danger.deleteFailedToast": "Delete failed",
  "household.danger.warning":
    "All content and invites in this group will be permanently deleted. This cannot be undone.",
  "household.danger.confirmTitle": "Permanently delete group?",
  "household.danger.confirmDescription":
    "Type the group name “{name}” to confirm the deletion.",
  "household.danger.confirmButton": "Delete permanently",
  "household.danger.nameLabel": "Group name",
  "household.danger.nameMismatch": "The name doesn't match yet.",

  /* ---------------------------- components/MemberList.tsx ------------------- */
  "household.members.roleAriaLabel": "Role of {name}",
  "household.members.you": "You",
  "household.members.soleOwner": "Sole owner",
  "household.members.leave": "Leave",
  "household.members.remove": "Remove",
  "household.members.ownershipTransferredToast": "Ownership transferred",
  "household.members.roleChangedToast": "Role changed",
  "household.members.roleChangeFailedToast": "Could not change role",
  "household.members.removeConfirmTitle": "Remove member?",
  "household.members.removeConfirmDescription":
    "{name} will lose access to all recipes in this group. Recipes {name} created will be kept.",
  "household.members.removedToast": "Member removed",
  "household.members.removeFailedToast": "Remove failed",
  "household.members.leaveConfirmTitle": "Leave group?",
  "household.members.leaveConfirmDescription":
    "You'll lose access to all recipes, tags and collections in this group. You can be invited again at any time.",
  "household.members.leftToast": "Left group",
  "household.members.leaveFailedToast": "Leave failed",

  /* ---------------------------- components/InvitePanel.tsx ------------------- */
  "household.invite.disabledHint": "Only admins and owners can manage invites.",
  "household.invite.formHeading": "Invite someone",
  "household.invite.emailLabel": "E-mail address",
  "household.invite.emailPlaceholder": "grandma@example.com",
  "household.invite.roleLabel": "Role",
  "household.invite.submitButton": "Create invite link",
  "household.invite.formHint":
    "We send an e-mail with the invite link and also show it to you here, so you can share it yourself. It's valid for 14 days.",
  "household.invite.outcome.sent.title": "Invite sent",
  "household.invite.outcome.notConfigured.title": "New invite link — no e-mail",
  "household.invite.outcome.notConfigured.hint":
    "No mail delivery is set up on this server. Please forward the link yourself.",
  "household.invite.outcome.failed.title": "E-mail could not be delivered",
  "household.invite.outcome.failed.hint":
    "Mail delivery is set up, but the message was rejected — the reason is in the server log. The invite itself is valid: please forward the link yourself.",
  "household.invite.outcome.unknown.title": "New invite link",
  "household.invite.outcome.unknown.hint":
    "No e-mail was sent. Please forward the link yourself.",
  "household.invite.sentDescription": "An e-mail is on its way to {email}.",
  "household.invite.copiedHint": "The link is on your clipboard.",
  "household.invite.copyHint": "Copy the link below and share it.",
  "household.invite.failedToastTitle": "E-mail not delivered",
  "household.invite.createdNoMailToastTitle": "Invite created — no e-mail",
  "household.invite.failedToastDescription":
    "The invite for {email} is valid, but mail delivery rejected it (reason in the server log). {fallback}",
  "household.invite.alreadyMemberError": "This person is already a member of the group.",
  "household.invite.linkCopiedToast": "Link copied",
  "household.invite.copyFailedToast": "Could not copy",
  "household.invite.shareTitle": "Invite to {name}",
  "household.invite.shareText": "You're invited to “{name}” on toon-recipe:",
  "household.invite.copyButton": "Copy",
  "household.invite.shareButton": "Share",
  "household.invite.pendingHeading": "Pending invites",
  "household.invite.pendingEmpty": "No pending invites.",
  "household.invite.pendingMeta": "{role} · valid until {date} · from {name}",
  "household.invite.linkButton": "Link",
  "household.invite.revokeButton": "Revoke",
  "household.invite.revokedToast": "Invite revoked",
  "household.invite.revokeFailedToast": "Revoke failed",
  "household.invite.pastHeading": "Past invites ({count})",
  "household.inviteStatus.pending": "Pending",
  "household.inviteStatus.accepted": "Accepted",
  "household.inviteStatus.revoked": "Revoked",
  "household.inviteStatus.expired": "Expired",

  /* ------------------------------ GroupSwitcher.tsx -------------------------- */
  "household.switcher.noGroup": "No group",
  "household.switcher.title": "Switch group",
  "household.switcher.description": "Recipes, collections and tags always belong to a group.",
  "household.switcher.empty": "You're not in any group yet.",
  "household.switcher.manageButton": "Manage groups",
};
