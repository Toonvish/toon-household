/**
 * German — namespace "auth" (see docs/i18n.md §9 for the file's owner).
 * Covers login, register, password reset, e-mail verification, OAuth link
 * flows and the account settings screen (`features/auth/**` plus the
 * auth-facing copy in `lib/session.tsx`).
 */
import type { NamespaceCatalog } from "@toon/shared";

export const authDe = {
  /* ------------------------------ shared/common ----------------------------- */
  "auth.common.loginLink": "Zur Anmeldung",
  "auth.common.backToLoginLink": "Zurück zur Anmeldung",
  "auth.common.signIn": "Anmelden",
  "auth.common.signOut": "Abmelden",
  "auth.common.somethingWentWrong": "Das hat nicht funktioniert",
  "auth.common.linkExpiredTitle": "Link nicht mehr gültig",
  "auth.common.emailOnTheWay": "E-Mail unterwegs",
  "auth.field.email.label": "E-Mail",
  "auth.field.email.placeholder": "du@beispiel.de",
  "auth.field.name.label": "Name",
  "auth.field.password.label": "Passwort",
  "auth.field.password.placeholder": "••••••••",
  "auth.password.minLengthHint": "Mindestens 8 Zeichen.",
  "auth.password.new.label": "Neues Passwort",

  /* ------------------------------- LoginPage.tsx ----------------------------- */
  "auth.login.title": "Willkommen zurück",
  "auth.login.description": "Melde dich an, um auf die Rezepte deiner Gruppen zuzugreifen.",
  "auth.login.noAccount": "Noch kein Konto?",
  "auth.login.registerLink": "Jetzt registrieren",
  "auth.login.error.title": "Anmeldung fehlgeschlagen",
  "auth.login.resetSuccess":
    "Dein Passwort wurde geändert. Melde dich einmal mit dem neuen Passwort an.",
  "auth.login.forgotPasswordLink": "Passwort vergessen?",
  "auth.login.submit": "Anmelden",
  "auth.login.error.notConfigured": "Dieser Anbieter ist auf dem Server nicht konfiguriert.",
  "auth.login.error.cancelled":
    "Der Anbieter hat die Anmeldung abgebrochen. Bitte versuche es erneut.",
  "auth.login.error.sessionExpired": "Deine Sitzung ist abgelaufen. Bitte melde dich neu an.",
  "auth.login.error.generic": "Bitte versuche es erneut.",

  /* ---------------------------- OAuthButtons.tsx ----------------------------- */
  "auth.oauth.signIn": "Mit {provider} anmelden",
  "auth.oauth.signUp": "Mit {provider} registrieren",
  "auth.oauth.or": "oder",
  "auth.oauth.orWithEmail": "oder mit E-Mail",

  /* --------------------------- ForgotPasswordPage.tsx ------------------------ */
  "auth.forgotPassword.sent.title": "E-Mail unterwegs",
  "auth.forgotPassword.sent.description": "Prüfe dein Postfach.",
  "auth.forgotPassword.sent.lead":
    "Wenn es ein Konto mit der Adresse {email} gibt, haben wir einen Link zum Zurücksetzen verschickt.",
  "auth.forgotPassword.sent.hint":
    "Der Link gilt eine Stunde und kann nur einmal verwendet werden. Schau notfalls auch im Spam-Ordner nach.",
  "auth.forgotPassword.sent.useOther": "Andere Adresse verwenden",
  "auth.forgotPassword.title": "Passwort vergessen",
  "auth.forgotPassword.description":
    "Wir schicken dir einen Link, mit dem du ein neues Passwort setzen kannst.",
  "auth.forgotPassword.rememberedPrompt": "Passwort wieder eingefallen?",
  "auth.forgotPassword.submit": "Link anfordern",
  "auth.forgotPassword.oauthHint":
    "Melde dich mit Google oder GitHub an, falls du dein Konto so angelegt hast — dann brauchst du kein Passwort.",

  /* ------------------------------- InvitePage.tsx ---------------------------- */
  "auth.invite.title": "Einladung",
  "auth.invite.missingToken.title": "Ungültiger Link",
  "auth.invite.missingToken.description": "In diesem Link fehlt der Einladungscode.",
  "auth.invite.checking": "Einladung wird geprüft …",
  "auth.invite.invalid.title": "Einladung nicht gültig",
  "auth.invite.invalid.description":
    "Der Link ist abgelaufen oder wurde zurückgezogen. Bitte lass dir eine neue Einladung schicken.",
  "auth.invite.readyTitle": "Du wurdest eingeladen",
  "auth.invite.invitedBy": "{name} lädt dich zu „{groupName}“ ein.",
  "auth.invite.roleAndEmail": "Rolle: {role} · Einladung für {email}",
  "auth.invite.validUntil": "Gültig bis {date}",
  "auth.invite.status.accepted": "Diese Einladung wurde bereits angenommen.",
  "auth.invite.status.expired": "Diese Einladung ist abgelaufen.",
  "auth.invite.status.revoked": "Diese Einladung wurde zurückgezogen.",
  "auth.invite.join": "Gruppe beitreten",
  "auth.invite.registerAndJoin": "Konto anlegen und beitreten",
  "auth.invite.haveAccount": "Ich habe schon ein Konto",
  "auth.invite.joined.title": "Willkommen!",
  "auth.invite.joined.description": "Du bist jetzt Mitglied von „{groupName}“.",
  "auth.invite.joinFailed": "Beitreten fehlgeschlagen",

  /* --------------------------- OAuthCallbackPage.tsx ------------------------- */
  "auth.oauthCallback.cancelledTitle": "Anmeldung abgebrochen",
  "auth.oauthCallback.notConfigured":
    "Dieser Anmelde-Anbieter ist auf dem Server nicht konfiguriert.",
  "auth.oauthCallback.incomplete":
    "Der Anbieter hat die Anmeldung nicht abgeschlossen. Bitte versuche es noch einmal.",
  "auth.oauthCallback.slowTitle": "Anmeldung dauert länger",
  "auth.oauthCallback.noSession.title": "Keine Sitzung gefunden",
  "auth.oauthCallback.noSession.description":
    "Möglicherweise wurden Cookies blockiert. Bitte melde dich erneut an.",
  "auth.oauthCallback.inProgress.title": "Anmeldung läuft",
  "auth.oauthCallback.inProgress.description": "Einen Moment, wir richten alles ein …",
  "auth.oauthCallback.checkingSession": "Sitzung wird geprüft …",

  /* ------------------------------ RegisterPage.tsx --------------------------- */
  "auth.register.title": "Konto anlegen",
  "auth.register.descriptionInvite": "Registriere dich, um der Gruppe beizutreten.",
  "auth.register.description":
    "Sammle eure Rezepte an einem Ort – gemeinsam mit Familie und Freunden.",
  "auth.register.haveAccount": "Schon ein Konto?",
  "auth.register.invitedBy": "{name} hat dich zur Gruppe {groupName} eingeladen.",
  "auth.register.inviteInvalid.title": "Einladung ungültig",
  "auth.register.inviteInvalid.description":
    "Du kannst dich trotzdem registrieren und später beitreten.",
  "auth.register.name.placeholder": "Wie sollen dich andere sehen?",
  "auth.register.householdName.label": "Name deiner ersten Gruppe",
  "auth.register.householdName.placeholder": "Familie",
  "auth.register.householdName.hint": "Leer lassen für „Meine Rezepte“.",
  "auth.register.submit": "Konto anlegen",

  /* --------------------------- ResetPasswordPage.tsx ------------------------- */
  "auth.resetPassword.passwordInvalid": "Passwort ungültig",
  "auth.resetPassword.passwordMismatch": "Die Passwörter stimmen nicht überein",
  "auth.resetPassword.expired.description": "Dieser Link wurde schon benutzt oder ist abgelaufen.",
  "auth.resetPassword.requestNew.action": "Neuen Link anfordern",
  "auth.resetPassword.requestNew.description":
    "Reset-Links gelten eine Stunde und lassen sich nur einmal verwenden. Fordere einfach einen neuen an.",
  "auth.resetPassword.title": "Neues Passwort",
  "auth.resetPassword.description": "Wähle ein neues Passwort für dein Konto.",
  "auth.resetPassword.repeat.label": "Passwort wiederholen",
  "auth.resetPassword.submit": "Passwort speichern",
  "auth.resetPassword.securityNote":
    "Aus Sicherheitsgründen wirst du danach auf allen Geräten abgemeldet und musst dich einmal neu anmelden.",

  /* ---------------------------- VerifyEmailPage.tsx -------------------------- */
  "auth.verifyEmail.checking": "E-Mail-Adresse wird bestätigt …",
  "auth.verifyEmail.failedTitle": "Bestätigung fehlgeschlagen",
  "auth.verifyEmail.expired.description":
    "Bestätigungslinks gelten 24 Stunden und lassen sich nur einmal verwenden. Fordere in den Einstellungen einen neuen an.",
  "auth.verifyEmail.tryLater": "Bitte versuche es später noch einmal.",
  "auth.verifyEmail.toSettings": "Zu den Einstellungen",
  "auth.verifyEmail.success.title": "E-Mail bestätigt",
  "auth.verifyEmail.success.description": "Danke — die Adresse gehört jetzt dir.",
  "auth.verifyEmail.success.hint":
    "Du kannst dein Passwort jetzt jederzeit über „Passwort vergessen“ zurücksetzen.",
  "auth.verifyEmail.toRecipes": "Zu den Rezepten",

  /* -------------------------- AccountSettingsPage.tsx ------------------------ */
  "auth.settings.title": "Profil",
  "auth.settings.description": "Konto, Gruppen, Aussehen und angemeldete Geräte.",
  "auth.settings.save": "Speichern",
  "auth.settings.account.title": "Dein Konto",
  "auth.settings.account.saved": "Profil gespeichert",
  "auth.settings.account.nameInvalid": "Name ungültig",

  "auth.settings.households.title": "Gruppen",
  "auth.settings.households.none": "Du bist noch in keiner Gruppe.",
  "auth.settings.households.count": { one: "{count} Gruppe", other: "{count} Gruppen" },
  "auth.settings.households.countWithActive": {
    one: "{count} Gruppe · aktiv: {groupName}",
    other: "{count} Gruppen · aktiv: {groupName}",
  },
  "auth.settings.households.manage": "Gruppen verwalten",
  "auth.settings.households.manageHint": "Mitglieder, Einladungen und Rollen",

  "auth.settings.email.title": "E-Mail-Adresse",
  "auth.settings.email.readOnlyUntilConfirmed":
    "Bis zur Bestätigung kannst du nur mitlesen: Rezepte anlegen, importieren und Einkaufslisten ändern ist gesperrt. Einladungen annehmen geht weiterhin.",
  "auth.settings.email.confirmedAt": "Bestätigt am {date}.",
  "auth.settings.email.confirmTitle": "E-Mail-Adresse bestätigen",
  "auth.settings.email.notConfirmed": "Noch nicht bestätigt.",
  "auth.settings.email.confirmHint":
    "Bestätige {email}, damit du dein Passwort per E-Mail zurücksetzen kannst.",
  "auth.settings.email.resend": "Erneut senden",
  "auth.settings.email.sendLink": "Bestätigungslink senden",
  "auth.settings.email.sentToast.description": "Wir haben einen Bestätigungslink an {email} geschickt.",
  "auth.settings.email.notSentToast.title": "Keine E-Mail verschickt",
  "auth.settings.email.notConfigured":
    "Auf diesem Server ist kein Mailversand eingerichtet. Der Bestätigungslink steht im Server-Log.",
  "auth.settings.email.deliveryFailed":
    "Die Zustellung ist fehlgeschlagen. Bitte später erneut versuchen — Details stehen im Server-Log.",
  "auth.settings.email.sendFailedTitle": "Konnte nicht verschickt werden",
  "auth.settings.email.sendFailedFallback": "Bitte später erneut versuchen.",

  "auth.settings.theme.system": "System",
  "auth.settings.theme.light": "Hell",
  "auth.settings.theme.dark": "Dunkel",
  "auth.settings.appearance.title": "Aussehen",
  "auth.settings.appearance.description": "Folgt standardmäßig deinem Systemdesign.",

  /*
    The two language names are AUTONYMS and are therefore identical in both
    catalogs: a language picker lists every language in its own language, so
    somebody who has accidentally switched to a language they cannot read can
    still find their way back. Do not "translate" them.
  */
  "auth.settings.language.title": "Sprache",
  "auth.settings.language.description":
    "Betrifft nur die Oberfläche. Rezepte behalten die Sprache, in der sie gespeichert sind.",
  "auth.settings.language.system": "System",
  "auth.settings.language.systemHint": "Folgt deinem Browser ({locale}).",
  "auth.settings.language.de": "Deutsch",
  "auth.settings.language.en": "English",

  "auth.settings.password.changeTitle": "Passwort ändern",
  "auth.settings.password.setTitle": "Passwort festlegen",
  "auth.settings.password.oauthOnlyHint":
    "Dein Konto nutzt bisher nur die Anmeldung über Google/GitHub.",
  "auth.settings.password.checkInputs": "Eingaben prüfen",
  "auth.settings.password.updated": "Passwort aktualisiert",
  "auth.settings.password.current.label": "Aktuelles Passwort",

  "auth.settings.oauth.linkedToast": "{provider} verknüpft",
  "auth.settings.oauth.error.alreadyLinked":
    "Dieses Anbieter-Konto ist bereits mit einem anderen Nutzer verknüpft.",
  "auth.settings.oauth.error.notConfigured": "Dieser Anbieter ist auf dem Server nicht konfiguriert.",
  "auth.settings.oauth.error.generic": "Die Verknüpfung ist fehlgeschlagen. Bitte erneut versuchen.",
  "auth.settings.oauth.unlinked": "Verknüpfung getrennt",
  "auth.settings.oauth.unlinkFailed": "Trennen fehlgeschlagen",
  "auth.settings.oauth.title": "Verknüpfte Konten",
  "auth.settings.oauth.noneConfigured":
    "Auf diesem Server ist keine Anmeldung über Google oder GitHub konfiguriert.",
  "auth.settings.oauth.description": "Verknüpfe einen Anbieter, um dich künftig auch damit anzumelden.",
  "auth.settings.oauth.linkedFallback": "verknüpft",
  "auth.settings.oauth.notLinked": "nicht verknüpft",
  "auth.settings.oauth.setPasswordFirst": "Lege zuerst ein Passwort fest.",
  "auth.settings.oauth.unlink": "Trennen",
  "auth.settings.oauth.link": "Verknüpfen",
  "auth.settings.oauth.unlinkConfirm.title": "Verknüpfung trennen?",
  "auth.settings.oauth.unlinkConfirm.description":
    "Du kannst dich danach nicht mehr über diesen Anbieter anmelden.",

  "auth.settings.sessions.title": "Angemeldete Geräte",
  "auth.settings.sessions.description": "Sitzungen laufen nach 30 Tagen Inaktivität automatisch ab.",
  "auth.settings.sessions.unknownDevice": "Unbekanntes Gerät",
  "auth.settings.sessions.thisDevice": "Dieses Gerät",
  "auth.settings.sessions.lastActive": "Zuletzt aktiv {relative} · angemeldet am {date}",
  "auth.settings.sessions.revoked": "Gerät abgemeldet",
  "auth.settings.sessions.revokeFailed": "Abmelden fehlgeschlagen",
  "auth.settings.sessions.revokeConfirm.title": "Gerät abmelden?",
  "auth.settings.sessions.revokeConfirm.description": "Die Sitzung wird sofort beendet.",

  "auth.settings.logout.description": "Beendet die Sitzung auf diesem Gerät.",
} as const satisfies NamespaceCatalog<"auth">;

export type AuthCatalog = typeof authDe;
