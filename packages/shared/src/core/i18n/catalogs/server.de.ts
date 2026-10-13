/**
 * German — namespace 7 (`apps/api` + `packages/shared`: errors, validation, mail).
 *
 * Seeded by the foundation with what it needed itself: the `ApiError` static
 * defaults, the Zod resolution table (`i18n/zod.ts`) and the `formatDuration`
 * rendering keys (`duration.ts`). `server.mail.*` is intentionally EMPTY here —
 * it is the namespace-7 port agent's job to add it to both this file and
 * `server.en.ts`; the type only requires the two files to agree with EACH
 * OTHER, so adding a new `server.mail.*` key to both later is a pure addition.
 *
 * Byte-identical to the German this codebase produced before the port, per
 * docs/i18n.md §11 — except where a comment below says NEW GERMAN, which is a
 * previously-English Zod default gaining a proper translation.
 */
import type { NamespaceCatalog } from "../types.ts";

export const serverDe = {
  /* -------------------------- ApiError defaults -------------------------- */
  "server.error.badRequest": "Ungültige Anfrage",
  "server.error.unauthorized": "Nicht angemeldet",
  "server.error.invalidCredentials": "E-Mail oder Passwort ist falsch",
  "server.error.forbidden": "Keine Berechtigung",
  "server.error.notFound": "Nicht gefunden",
  "server.error.conflict": "Konflikt",
  "server.error.payloadTooLarge": "Datei ist zu groß (max. 15 MB)",
  "server.error.unsupportedMediaType": "Dateityp wird nicht unterstützt",
  "server.error.validationFailed": "Eingabe ist ungültig",
  "server.error.internal": "Interner Serverfehler",
  /** `notFoundHandler` — {method} {path}. */
  "server.error.routeUnknown": "Route {method} {path} existiert nicht",
  /** `toApiError`'s `HTTPException` branch: the framework's own message is dropped (§4). */
  "server.error.requestFailed": "Anfrage fehlgeschlagen",
  "server.error.tooManyAttempts": "Zu viele Versuche. Bitte in {seconds} Sekunden erneut probieren.",

  /* ------------------------------ Zod: custom ----------------------------- */
  "server.validation.noChanges": "Keine Änderungen übergeben",
  "server.validation.httpUrlOnly": "Nur http(s)-Links sind erlaubt",

  /* ------------------------- Zod: field-specific -------------------------- */
  "server.zod.field.name.too_small.1": "Name fehlt",
  "server.zod.field.title.too_small.1": "Titel fehlt",
  "server.zod.field.password.too_small.8": "Passwort muss mindestens 8 Zeichen haben",
  "server.zod.field.password.too_big.200": "Passwort ist zu lang",
  "server.zod.field.email.invalid_format": "Bitte eine gültige E-Mail-Adresse angeben",
  "server.zod.field.url.invalid_format": "Bitte eine gültige URL angeben",
  "server.zod.field.color.invalid_format": "Farbe muss ein Hex-Wert wie #e11d48 sein",

  /* ------------------------- Zod: generic fallbacks ------------------------ */
  // NEW GERMAN below: Zod 4's built-in English defaults, replaced with a real
  // translation (§11) — not a parity break, a fix of an existing inconsistency.
  "server.zod.too_small.string": "Muss mindestens {bound} Zeichen lang sein",
  "server.zod.too_small.number": "Muss mindestens {bound} sein",
  "server.zod.too_small.array": "Es müssen mindestens {bound} Einträge angegeben werden",
  "server.zod.too_small": "Wert ist zu klein",
  "server.zod.too_big.string": "Darf höchstens {bound} Zeichen lang sein",
  "server.zod.too_big.number": "Darf höchstens {bound} sein",
  "server.zod.too_big.array": "Es dürfen höchstens {bound} Einträge angegeben werden",
  "server.zod.too_big": "Wert ist zu groß",
  "server.zod.invalid_format": "Ungültiges Format",
  "server.zod.invalid_type": "Ungültiger Wert",
  "server.zod.fallback": "Eingabe ist ungültig",

  /* ------------------------ duration rendering (§7) ------------------------ */
  "server.duration.zero": "0 Min.",
  "server.duration.days": { one: "{count} Tag", other: "{count} Tage" },
  "server.duration.hours": "{count} Std.",
  "server.duration.minutes": "{count} Min.",

  /* ---------------------------- groups + invites --------------------------- */
  "server.group.groupIdMissing": "Gruppen-ID fehlt in der Anfrage",
  "server.group.notFound": "Gruppe nicht gefunden",
  "server.group.noAccess": "Kein Zugriff auf diese Gruppe",
  "server.group.ownerOnly": "Nur die Besitzerin oder der Besitzer der Gruppe darf das",
  "server.group.adminOnly": "Dafür brauchst du Administratorrechte in dieser Gruppe",
  "server.group.alreadyMember": "Diese Person ist schon Mitglied der Gruppe",
  "server.group.memberNotFound": "Dieses Mitglied gehört nicht zur Gruppe",
  "server.group.nameTaken": "Du hast schon eine Gruppe mit diesem Namen",
  "server.group.lastOwner": "Die Gruppe braucht mindestens eine Besitzerin oder einen Besitzer",
  "server.group.transferOwnershipFirst": "Übertrage die Besitzerrolle, bevor du die Gruppe verlässt",
  "server.group.fieldNotAMember": "Keine Mitgliedschaft in dieser Gruppe",
  "server.group.notAMember": "Du bist kein Mitglied dieser Gruppe",

  "server.invite.notFound": "Einladung nicht gefunden",
  "server.invite.alreadyAccepted": "Diese Einladung wurde schon angenommen",
  "server.invite.invalid": "Diese Einladung ist ungültig",
  "server.invite.revoked": "Diese Einladung wurde zurückgezogen",
  "server.invite.expired": "Diese Einladung ist abgelaufen",
  "server.invite.alreadyUsed": "Diese Einladung wurde bereits verwendet",

  /* --------------------------------- auth ----------------------------------- */
  "server.auth.invalidJsonBody": "Der Anfrage-Body ist kein gültiges JSON",
  "server.auth.unknownOauthProvider": "Unbekannter OAuth-Anbieter",
  "server.auth.emailTaken": "Diese E-Mail-Adresse ist bereits registriert",
  "server.auth.noPasswordSet":
    "Für dieses Konto ist kein Passwort gesetzt. Bitte melde dich mit Google oder GitHub an.",
  "server.auth.currentPasswordRequired": "Bitte gib dein aktuelles Passwort ein",
  "server.auth.currentPasswordWrong": "Das aktuelle Passwort ist falsch",
  "server.auth.sessionNotFound": "Sitzung nicht gefunden",
  "server.auth.oauthProviderAborted": "Der Anbieter hat abgebrochen: {providerError}",
  "server.auth.oauthIncompleteResponse": "Unvollständige Antwort des Anbieters",
  "server.auth.oauthSessionExpired": "OAuth-Sitzung abgelaufen, bitte erneut anmelden",
  "server.auth.pleaseSignInAgain": "Bitte erneut anmelden und nochmal versuchen.",
  "server.auth.oauthEmailTaken":
    "Diese E-Mail-Adresse ist bereits registriert. Melde dich mit Passwort an und verknüpfe den Anbieter danach im Profil.",
  "server.auth.oauthLinkedElsewhere": "Dieses Anbieter-Konto ist bereits mit einem anderen Nutzer verknüpft.",
  "server.auth.oauthProviderAlreadyLinked": "Für diesen Anbieter ist schon ein Konto verknüpft. Trenne es zuerst.",
  "server.auth.oauthNothingLinked": "Für diesen Anbieter ist nichts verknüpft.",
  "server.auth.oauthLastLoginMethod": "Das ist deine einzige Anmeldemöglichkeit. Lege zuerst ein Passwort fest.",
  "server.auth.verificationLinkInvalid": "Dieser Bestätigungslink ist nicht mehr gültig. Bitte fordere einen neuen an.",
  "server.auth.emailAlreadyVerified": "Diese E-Mail-Adresse ist schon bestätigt",
  "server.auth.emailUnverified":
    "Bitte bestätige zuerst deine E-Mail-Adresse. Bis dahin kannst du nur mitlesen und Einladungen annehmen.",
  "server.auth.userNotFound": "Benutzer nicht gefunden",
  "server.auth.googleNotConfigured": "Google-Login ist auf diesem Server nicht konfiguriert",
  "server.auth.githubNotConfigured": "GitHub-Login ist auf diesem Server nicht konfiguriert",
  "server.auth.oauthLoginFailed": "Die Anmeldung beim Anbieter ist fehlgeschlagen",
  "server.auth.googleProfileUnavailable": "Google-Profil konnte nicht geladen werden",
  "server.auth.googleProfileIncomplete": "Google-Profil war unvollständig",
  "server.auth.githubProfileUnavailable": "GitHub-Profil konnte nicht geladen werden",
  "server.auth.githubProfileIncomplete": "GitHub-Profil war unvollständig",
  "server.auth.resetLinkInvalid": "Dieser Link ist nicht mehr gültig. Bitte fordere einen neuen an.",

  /* -------------------------------- import ----------------------------------- */
  "server.import.pastedTextEmpty": "Der eingefügte Text ist leer.",
  "server.import.invalidJsonBody": "Der Request-Body ist kein gültiges JSON.",
  "server.import.noSourceFile": "Zu diesem Entwurf gibt es keine Quelldatei.",
  "server.import.sourceFileDeleted": "Die Quelldatei wurde bereits gelöscht.",
  "server.import.draftAlreadyCommitted": "Dieser Entwurf wurde bereits als Rezept gespeichert.",
  "server.import.titleMissing": "Titel fehlt",
  "server.import.titleRequired": "Bitte einen Titel eingeben.",
  "server.import.noIngredientsOrSteps": "Weder Zutaten noch Zubereitung vorhanden",
  "server.import.recipeNeedsIngredientOrStep":
    "Das Rezept braucht mindestens eine Zutat oder einen Zubereitungsschritt.",
  "server.import.collectionNotInGroup": "Die gewählte Sammlung existiert nicht in dieser Gruppe.",
  "server.import.collectionsNotInGroup":
    "Mindestens eine der gewählten Sammlungen existiert nicht in dieser Gruppe.",
  "server.import.fileUnreadable": "Die Datei konnte nicht gelesen werden (multipart/form-data erwartet).",
  "server.import.noFileInField": 'Es wurde keine Datei im Feld "{fieldName}" gesendet.',
  "server.import.fileEmpty": "Die Datei ist leer.",
  "server.import.unsupportedFileType":
    "Dateityp wird nicht unterstützt. Bitte ein Foto (JPEG, PNG, WEBP, HEIC) oder ein PDF hochladen.",
  "server.import.expectedImageNotPdf": "Für diesen Endpunkt wird ein Bild erwartet, kein PDF.",
  "server.import.expectedPdfNotImage": "Für diesen Endpunkt wird ein PDF erwartet, kein Bild.",
  "server.import.unsupportedImageFormat": "Bildformat {mimeType} wird nicht unterstützt.",
  "server.import.invalidFilename": "Ungültiger Dateiname.",
  "server.import.draftNotFound": "Dieser Import-Entwurf existiert nicht (mehr).",
  "server.import.ocrDisabled":
    "Import per Foto oder PDF ist auf diesem Server nicht aktiviert. Rezepte lassen sich über eine Webadresse oder als eingefügter Text importieren.",
  "server.import.pdfDisabled":
    "PDF-Import ist auf diesem Server nicht aktiviert. Fotos, Webadressen und eingefügter Text funktionieren weiterhin.",
  "server.import.sessionMiddlewareUnavailable": "Die Authentifizierung ist nicht verfügbar (Session-Middleware fehlt).",
  "server.import.groupMiddlewareUnavailable": "Die Gruppenprüfung ist nicht verfügbar (Group-Middleware fehlt).",
  "server.import.urlInvalid": "Die URL ist ungültig.",
  "server.import.schemeNotAllowed": "Nur http- und https-Adressen können importiert werden ({protocol}).",
  "server.import.credentialsInUrl": "URLs mit Benutzername/Passwort werden nicht unterstützt.",
  "server.import.noHostname": "Die URL enthält keinen Hostnamen.",
  "server.import.blockedHost": "Adressen im lokalen Netzwerk können nicht importiert werden ({hostname}).",
  "server.import.privateIp": "Private IP-Adressen können nicht importiert werden ({hostname}).",
  "server.import.suspiciousHost": "Diese Adresse ist keine gültige öffentliche Domain ({hostname}).",
  "server.import.dnsFailed": "Der Hostname {hostname} konnte nicht aufgelöst werden.",
  "server.import.dnsPointsToPrivateIp":
    "{hostname} zeigt auf eine private IP-Adresse ({address}) und kann nicht importiert werden.",
  "server.import.noRecipeFound":
    "Auf dieser Seite wurde kein Rezept gefunden. Bitte den direkten Link zum Rezept verwenden oder ein Foto hochladen.",
  "server.import.pageTooLarge": "Die Seite ist zu groß zum Importieren (max. 5 MB).",
  "server.import.pageTimeout": "Die Seite hat nicht rechtzeitig geantwortet (Timeout 10 s).",
  "server.import.pageLoadFailed": "Die Seite konnte nicht geladen werden: {reason}",
  "server.import.redirectNoLocation": "Die Seite antwortete mit {status} ohne Zieladresse.",
  "server.import.tooManyRedirects": "Die Seite leitet zu oft weiter.",
  "server.import.pageHttpError": "Die Seite antwortete mit HTTP {status}. Bitte prüfe die Adresse.",
  "server.import.pageNotHtml": "Diese Adresse liefert kein HTML ({contentType}). Bitte den Link zur Rezeptseite verwenden.",

  /* ------------------------------- meal plan ------------------------------ */
  "server.plan.entryNotFound": "Eintrag im Wochenplan nicht gefunden",
  "server.plan.invalidDate": "Bitte ein Datum im Format JJJJ-MM-TT angeben",
  "server.plan.rangeInvalid": "Das Startdatum muss vor dem Enddatum liegen",
  // The number is inlined, not `{max}`: this fires from a bare `refineKey()`, which
  // has no `values` to substitute (see i18n/zod.ts). Keep it in sync with
  // `PLAN_LIMITS.rangeDays` in schemas/plan.ts if that ever changes.
  "server.plan.rangeTooLong": "Der Zeitraum darf höchstens 62 Tage umfassen",
  "server.plan.dayFull": "Für einen Tag sind nicht mehr als {max} Rezepte möglich",
  "server.plan.alreadyPlanned": "Dieses Rezept steht an diesem Tag schon auf dem Plan",

  /* -------------------------------- recipes ----------------------------------- */
  "server.recipes.collectionNotFound": "Sammlung nicht gefunden",
  "server.recipes.recipeNotFound": "Rezept nicht gefunden",
  "server.recipes.tagNotFound": "Tag nicht gefunden",
  "server.recipes.tagNameTaken": "Diesen Tag gibt es schon",
  "server.recipes.noFileInField": 'Es wurde keine Datei im Feld "{field}" gesendet',
  "server.recipes.unsupportedImageType": "Nur Bilder (JPEG, PNG, WebP, HEIC/HEIF, AVIF) werden unterstützt",
  "server.recipes.noServingsToScale": "Dieses Rezept hat keine Portionsangabe und kann nicht skaliert werden",
  "server.recipes.nothingToUndo": "Es gibt keinen Kochvorgang, der zurückgenommen werden kann",

  /* -------------------------------- shopping ----------------------------------- */
  "server.shopping.listFull": "Diese Einkaufsliste ist voll (max. {max} Positionen)",
  "server.shopping.itemNotFound": "Position nicht gefunden",
  "server.shopping.suggestionNotFound": "Vorschlag nicht gefunden",
  "server.shopping.listNotFound": "Einkaufsliste nicht gefunden",
  "server.shopping.listNameTaken": "Eine Einkaufsliste mit diesem Namen gibt es schon",
  "server.shopping.tooManyLists": "Mehr als {max} Einkaufslisten pro Gruppe sind nicht möglich",

  /* ------------------------------ saved cards ---------------------------- */
  "server.card.notFound": "Karte nicht gefunden",
  "server.card.tooManyCards": "Mehr als {max} Karten sind nicht möglich",
  "server.card.alreadySaved": "Diese Karte ist schon gespeichert",
  "server.card.valueEmpty": "Bitte die Nummer der Karte eingeben",
  "server.card.valueTooLong": "Die Nummer ist zu lang für diesen Codetyp",
  "server.card.valueDigitsOnly": "Dieser Codetyp besteht nur aus Ziffern",
  "server.card.valueWrongLength": "Dieser Codetyp braucht eine andere Anzahl Ziffern",
  "server.card.valueOddLength": "Dieser Codetyp braucht eine gerade Anzahl Ziffern",
  "server.card.valueCharset": "Die Nummer enthält Zeichen, die dieser Codetyp nicht kann",
  "server.card.valueCheckDigit": "Die Prüfziffer passt nicht — bitte die Nummer noch einmal vergleichen",
  "server.card.formatAndValue": "Codetyp und Nummer können nur zusammen geändert werden",

  /* ----------------------------------- ocr ------------------------------------ */
  "server.ocr.heicUnsupported":
    "HEIC-Bilder können auf diesem Server nicht gelesen werden. Bitte das Foto als JPEG oder PNG hochladen (iPhone: Einstellungen › Kamera › Formate › „Maximale Kompatibilität“).",
  "server.ocr.imageUnreadable": "Das Bild konnte nicht gelesen werden ({message}).",
  "server.ocr.imageProcessingUnavailable":
    "Die Bildverarbeitung ist auf diesem Server nicht verfügbar (sharp fehlt). Bitte den Administrator informieren.",
  "server.ocr.noTextDetected":
    "Auf dem Bild wurde kein Text erkannt. Bitte näher heranzoomen, für gutes Licht sorgen und das Blatt gerade fotografieren.",
  "server.ocr.pdfProcessingTimedOut":
    "Die Verarbeitung des PDFs hat zu lange gedauert. Bitte nur die Seiten mit dem Rezept hochladen.",
  "server.ocr.pdfNoTextLayer": "Das PDF enthält keinen Text — bitte ein Foto der Seite hochladen.",
  "server.ocr.recognitionUnavailable": "Die Texterkennung ist auf dem Server nicht verfügbar. Bitte den Betreiber informieren.",
  "server.ocr.languageDataMissing":
    "Die Sprachdaten für die Texterkennung fehlen auf dem Server. Bitte den Betreiber informieren.",
  "server.ocr.recognitionFailed": "Die Texterkennung ist fehlgeschlagen.",
  "server.ocr.recognitionTimedOut":
    "Die Texterkennung hat zu lange gedauert. Bitte ein kleineres oder schärferes Bild hochladen.",
  "server.ocr.tooManyConcurrentRecognitions":
    "Es laufen gerade zu viele Texterkennungen. Bitte in einem Moment erneut versuchen.",

  /* ---- modules ---- */
  "server.module.disabled": "Dieses Modul ist für diesen Haushalt nicht aktiviert.",

  /* ----------------------------------- mail ------------------------------------ */
  "server.mail.buttonFallback": "Falls der Button nicht funktioniert, kopiere diese Adresse in deinen Browser:",
  "server.mail.invite.heading": "{invitedByName} lädt dich zu „{groupName}“ ein",
  "server.mail.invite.body1": "{invitedByName} möchte die Rezepte der Gruppe „{groupName}“ mit dir teilen.",
  "server.mail.invite.body2":
    "Öffne den Link, um beizutreten. Du kannst dich dabei neu registrieren oder ein vorhandenes Konto verwenden.",
  "server.mail.invite.footer":
    "Der Link ist {days} Tage gültig. Wenn du diese Einladung nicht erwartet hast, kannst du diese E-Mail einfach ignorieren.",
  "server.mail.invite.subject": "Einladung zur Gruppe „{groupName}“",
  "server.mail.invite.actionLabel": "Einladung annehmen",
  "server.mail.passwordReset.heading": "Passwort zurücksetzen",
  "server.mail.passwordReset.body1": "Hallo {name}, für dein Konto wurde ein neues Passwort angefordert.",
  "server.mail.passwordReset.body2":
    "Öffne den Link und wähle ein neues Passwort. Danach wirst du auf allen Geräten abgemeldet und musst dich einmal neu anmelden.",
  "server.mail.passwordReset.footer":
    "Der Link gilt {minutes} Minuten und kann nur einmal verwendet werden. Wenn du das nicht warst, musst du nichts tun — dein aktuelles Passwort bleibt gültig.",
  "server.mail.passwordReset.subject": "Neues Passwort für dein Rezepte-Konto",
  "server.mail.passwordReset.actionLabel": "Neues Passwort setzen",
  "server.mail.verifyEmail.heading": "E-Mail-Adresse bestätigen",
  "server.mail.verifyEmail.body1": "Hallo {name}, bitte bestätige, dass diese Adresse dir gehört.",
  "server.mail.verifyEmail.body2": "Danach können wir dich bei einem vergessenen Passwort sicher wiedererkennen.",
  "server.mail.verifyEmail.footer":
    "Der Link gilt {hours} Stunden. Wenn du kein Konto bei Rezepte angelegt hast, ignoriere diese E-Mail.",
  "server.mail.verifyEmail.subject": "Bitte bestätige deine E-Mail-Adresse",
  "server.mail.verifyEmail.actionLabel": "E-Mail bestätigen",
} as const satisfies NamespaceCatalog<"server">;

export type ServerCatalog = typeof serverDe;
export type ServerKey = keyof ServerCatalog;
