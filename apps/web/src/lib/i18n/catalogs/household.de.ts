/**
 * German — namespace "household" (`core/features/households` + the HouseholdSwitcher):
 * toon-recipe's group strings, keys renamed, values byte-identical (SPEC D1, D10).
 */
import type { NamespaceCatalog } from "@toon/shared";

export const householdDe = {
  /* ------------------------------ shared/common ----------------------------- */
  "household.common.name": "Name",
  "household.common.description": "Beschreibung",
  "household.common.cancel": "Abbrechen",
  "household.common.save": "Speichern",
  "household.common.create": "Anlegen",
  "household.common.delete": "Löschen",
  "household.badge.active": "Aktiv",
  "household.count.members": { one: "{count} Mitglied", other: "{count} Mitglieder" },
  "household.role.owner": "Eigentümer:in",
  "household.role.admin": "Administrator:in",
  "household.role.member": "Mitglied",

  /* ------------------------------ GroupsPage.tsx ---------------------------- */
  "household.list.title": "Gruppen",
  "household.list.subtitle": "Rezepte, Tags und Sammlungen gehören immer zu einer Gruppe.",
  "household.list.create": "Gruppe anlegen",
  "household.list.emptyTitle": "Noch keine Gruppe",
  "household.list.emptyDescription":
    "Lege eine Gruppe an, z. B. „Familie“, und lade andere per E-Mail ein.",
  "household.list.activate": "Aktivieren",
  "household.list.manage": "Verwalten",
  "household.create.title": "Neue Gruppe",
  "household.create.description":
    "Du wirst automatisch Besitzer:in und kannst danach Mitglieder einladen.",
  "household.create.namePlaceholder": "Familie",
  "household.create.descriptionPlaceholder": "Unsere gesammelten Familienrezepte.",
  "household.create.successTitle": "Gruppe angelegt",

  /* ---------------------------- GroupDetailPage.tsx ------------------------- */
  "household.detail.loading": "Gruppe wird geladen …",
  "household.detail.backToList": "Zu den Gruppen",
  "household.detail.backLink": "← Alle Gruppen",
  "household.detail.tab.members": "Mitglieder",
  "household.detail.tab.invites": "Einladungen",
  "household.detail.tab.settings": "Einstellungen",
  "household.detail.tabsAriaLabel": "Gruppenbereiche",
  "household.detail.meta": "{members} · angelegt am {date}",
  "household.detail.activate": "Als aktive Gruppe setzen",
  "household.settings.heading": "Gruppendaten",
  "household.settings.readonlyHint":
    "Nur Administrator:innen und Besitzer:innen können diese Angaben ändern.",
  "household.settings.savedToast": "Gruppe gespeichert",
  "household.danger.heading": "Gruppe löschen",
  "household.danger.deleteButton": "Gruppe löschen",
  "household.danger.deletedToast": "Gruppe gelöscht",
  "household.danger.deleteFailedToast": "Löschen fehlgeschlagen",
  "household.danger.warning":
    "Alle Inhalte und Einladungen dieser Gruppe werden endgültig gelöscht. Das kann nicht rückgängig gemacht werden.",
  "household.danger.confirmTitle": "Gruppe endgültig löschen?",
  "household.danger.confirmDescription":
    "Tippe den Gruppennamen „{name}“ ein, um das Löschen zu bestätigen.",
  "household.danger.confirmButton": "Endgültig löschen",
  "household.danger.nameLabel": "Gruppenname",
  "household.danger.nameMismatch": "Der Name stimmt noch nicht überein.",

  /* ---------------------------- components/MemberList.tsx ------------------- */
  "household.members.roleAriaLabel": "Rolle von {name}",
  "household.members.you": "Du",
  "household.members.soleOwner": "Einzige:r Besitzer:in",
  "household.members.leave": "Verlassen",
  "household.members.remove": "Entfernen",
  "household.members.ownershipTransferredToast": "Besitz übertragen",
  "household.members.roleChangedToast": "Rolle geändert",
  "household.members.roleChangeFailedToast": "Rolle konnte nicht geändert werden",
  "household.members.removeConfirmTitle": "Mitglied entfernen?",
  "household.members.removeConfirmDescription":
    "{name} verliert den Zugriff auf alle Rezepte dieser Gruppe. Von {name} angelegte Rezepte bleiben erhalten.",
  "household.members.removedToast": "Mitglied entfernt",
  "household.members.removeFailedToast": "Entfernen fehlgeschlagen",
  "household.members.leaveConfirmTitle": "Gruppe verlassen?",
  "household.members.leaveConfirmDescription":
    "Du verlierst den Zugriff auf alle Rezepte, Tags und Sammlungen dieser Gruppe. Eine erneute Einladung ist jederzeit möglich.",
  "household.members.leftToast": "Gruppe verlassen",
  "household.members.leaveFailedToast": "Verlassen fehlgeschlagen",

  /* ---------------------------- components/InvitePanel.tsx ------------------- */
  "household.invite.disabledHint":
    "Einladungen können nur Administrator:innen und Besitzer:innen verwalten.",
  "household.invite.formHeading": "Person einladen",
  "household.invite.emailLabel": "E-Mail-Adresse",
  "household.invite.emailPlaceholder": "oma@example.com",
  "household.invite.roleLabel": "Rolle",
  "household.invite.submitButton": "Einladungslink erstellen",
  "household.invite.formHint":
    "Wir verschicken eine E-Mail mit dem Einladungslink und zeigen dir den Link zusätzlich an, damit du ihn auch selbst weitergeben kannst. Er ist 14 Tage gültig.",
  "household.invite.outcome.sent.title": "Einladung verschickt",
  "household.invite.outcome.notConfigured.title": "Neuer Einladungslink — keine E-Mail",
  "household.invite.outcome.notConfigured.hint":
    "Auf diesem Server ist kein Mailversand eingerichtet. Schicke den Link bitte selbst weiter.",
  "household.invite.outcome.failed.title": "E-Mail konnte nicht zugestellt werden",
  "household.invite.outcome.failed.hint":
    "Der Mailversand ist eingerichtet, hat die Nachricht aber abgelehnt — der Grund steht im Server-Log. Die Einladung selbst ist gültig: schicke den Link bitte selbst weiter.",
  "household.invite.outcome.unknown.title": "Neuer Einladungslink",
  "household.invite.outcome.unknown.hint":
    "Es wurde keine E-Mail verschickt. Schicke den Link bitte selbst weiter.",
  "household.invite.sentDescription": "Eine E-Mail ist an {email} unterwegs.",
  "household.invite.copiedHint": "Der Link ist in der Zwischenablage.",
  "household.invite.copyHint": "Kopiere den Link unten und schicke ihn weiter.",
  "household.invite.failedToastTitle": "E-Mail nicht zugestellt",
  "household.invite.createdNoMailToastTitle": "Einladung erstellt — keine E-Mail",
  "household.invite.failedToastDescription":
    "Die Einladung für {email} ist gültig, der Mailversand hat sie aber abgelehnt (Grund im Server-Log). {fallback}",
  "household.invite.alreadyMemberError": "Diese Person ist bereits Mitglied der Gruppe.",
  "household.invite.linkCopiedToast": "Link kopiert",
  "household.invite.copyFailedToast": "Kopieren nicht möglich",
  "household.invite.shareTitle": "Einladung zu {name}",
  "household.invite.shareText": "Du bist zu „{name}“ bei toon-recipe eingeladen:",
  "household.invite.copyButton": "Kopieren",
  "household.invite.shareButton": "Teilen",
  "household.invite.pendingHeading": "Offene Einladungen",
  "household.invite.pendingEmpty": "Keine offenen Einladungen.",
  "household.invite.pendingMeta": "{role} · gültig bis {date} · von {name}",
  "household.invite.linkButton": "Link",
  "household.invite.revokeButton": "Zurückziehen",
  "household.invite.revokedToast": "Einladung zurückgezogen",
  "household.invite.revokeFailedToast": "Zurückziehen fehlgeschlagen",
  "household.invite.pastHeading": "Frühere Einladungen ({count})",
  "household.inviteStatus.pending": "Offen",
  "household.inviteStatus.accepted": "Angenommen",
  "household.inviteStatus.revoked": "Zurückgezogen",
  "household.inviteStatus.expired": "Abgelaufen",

  /* ------------------------------ GroupSwitcher.tsx -------------------------- */
  "household.switcher.noGroup": "Keine Gruppe",
  "household.switcher.title": "Gruppe wechseln",
  "household.switcher.description": "Rezepte, Sammlungen und Tags gehören immer zu einer Gruppe.",
  "household.switcher.empty": "Du bist noch in keiner Gruppe.",
  "household.switcher.manageButton": "Gruppen verwalten",

  /* ------------- placeholder members and claim links (ADR 0006, plan m3b) ---- */
  "household.placeholder.badge": "ohne Konto",
  "household.placeholder.hint": "Kann sich noch nicht anmelden.",
  "household.placeholder.rename": "Umbenennen",
  "household.placeholder.remove": "Person entfernen",
  "household.placeholder.nameLabel": "Anzeigename",
  "household.placeholder.removeConfirm":
    '„{name}" wirklich entfernen? Die Person hat kein Konto und wird ganz gelöscht.',
  "household.claim.title": "Konto für {name} verknüpfen",
  "household.claim.create": "Link zum Verknüpfen erstellen",
  "household.claim.hint":
    "Der Link legt das Konto für diese Person an. Alles, was ihr in der Gruppe zugeordnet ist, bleibt ihr zugeordnet.",
  "household.claim.linkHint":
    "Der Link gilt 14 Tage. Wer ihn öffnet, erstellt damit das Konto für diese Person.",
} as const satisfies NamespaceCatalog<"household">;

export type HouseholdCatalog = typeof householdDe;
