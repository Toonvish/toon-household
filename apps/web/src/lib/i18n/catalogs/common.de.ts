/**
 * German — namespace "common" (`apps/web/src/{components,lib}` outside `features/*`).
 * Seeded by the foundation with the keys IT needed itself: `lib/api.ts`'s HTTP
 * fallbacks and `lib/format.ts`'s small rendering strings. Agent 6 extends
 * this file with everything else in `components/`/`lib/` (except
 * `lib/i18n/**`, which stays foundation-owned) — see docs/i18n.md §9.
 */
import type { NamespaceCatalog } from "@toon/shared";

export const commonDe = {
  /* ------------------------------ lib/format.ts ---------------------------- */
  "common.time.justNow": "gerade eben",
  "common.common.dash": "–",
  "common.servings.defaultUnit": "Portionen",

  /* ------------------------------- lib/api.ts ------------------------------- */
  "common.error.unknown": "Unbekannter Fehler. Bitte versuche es noch einmal.",
  /**
   * `apiFieldErrors`' last resort for a thrown value that is not an `Error` at
   * all. Deliberately the SHORT sentence and NOT `ui.error.unknown`: it lands in
   * a form's `_form` slot next to "Etwas ist schiefgelaufen", where the second
   * half would read as a duplicate instruction. `lib/validation.test.ts` pins it.
   */
  "common.error.unknownValue": "Unbekannter Fehler.",
  "common.error.network": "Keine Verbindung zum Server. Bist du offline?",
  "common.error.unauthorized": "Bitte melde dich an.",
  "common.error.forbidden": "Dazu hast du keine Berechtigung.",
  "common.error.notFound": "Nicht gefunden.",
  "common.error.conflict": "Das steht im Konflikt mit vorhandenen Daten.",
  "common.error.payloadTooLarge": "Die Datei ist zu groß (max. 15 MB).",
  "common.error.unsupportedMediaType": "Dieser Dateityp wird nicht unterstützt.",
  "common.error.validationFailed": "Die Eingaben sind unvollständig oder ungültig.",
  "common.error.serverError": "Serverfehler. Bitte versuche es später noch einmal.",
  "common.error.requestFailed": "Anfrage fehlgeschlagen.",
  "common.upload.tooLarge": '"{filename}" ist {size} MB groß. Maximal 15 MB sind erlaubt.',

  /* -------------------------------- main.tsx -------------------------------- */
  "common.boot.missingRoot": "#root fehlt in index.html",

  /* --------------------------- nav-items.ts / nav --------------------------- */
  "common.nav.recipes": "Rezepte",
  "common.nav.shopping": "Einkauf",
  "common.nav.import": "Importieren",
  "common.nav.profile": "Profil",
  "common.nav.groups": "Gruppen",
  "common.nav.collections": "Sammlungen",
  "common.nav.tags": "Tags",
  "common.nav.mainNavLabel": "Hauptnavigation",
  // "Plan" is the same word in both locales — not a missing translation, it's
  // just the tab bar's name for the /plan screen and reads fine unchanged.
  "common.nav.plan": "Plan",
  "common.nav.planNewBadge": "Neu",
  // Used twice in SideNav.tsx: the visible eyebrow above the secondary nav
  // items AND that <nav>'s own aria-label. One key, two slots, one sentence.
  "common.nav.organiseLabel": "Organisieren",

  /* -------------------------------- SideNav.tsx ------------------------------ */
  "common.sidenav.newRecipe": "Neues Rezept",

  /* ----------------------------- OfflineBanner.tsx --------------------------- */
  "common.offlineBanner.message":
    "Offline – gespeicherte Rezepte sind sichtbar, Änderungen erst wieder online möglich.",

  /* ----------------------------- UpdateBanner.tsx ---------------------------- */
  "common.updateBanner.message": "Neue Version verfügbar. Deine Änderungen sind noch nicht gespeichert.",
  "common.updateBanner.reload": "Trotzdem neu laden",

  /* ----------------------------- InstallPrompt.tsx --------------------------- */
  "common.installPrompt.heading": "Rezepte auf dem Startbildschirm",
  "common.installPrompt.description":
    "Installiere die App, um sie wie eine normale App zu öffnen – mit eigenem Symbol und ohne Browserleiste. Bereits geöffnete Rezepte kannst du auch ohne Verbindung nachkochen, und die Einkaufsliste lässt sich offline abhaken; Rezepte bearbeiten und Importieren brauchen Internet.",
  "common.installPrompt.cta": "Zur Startseite hinzufügen",
  "common.installPrompt.iosHint.before": "Tippe auf",
  "common.installPrompt.iosHint.after": "und dann auf „Zum Home-Bildschirm“.",
  "common.installPrompt.shareIconLabel": "Teilen",
  "common.installPrompt.dismiss": "Hinweis ausblenden",

  /* ------------------------------ NotFoundPage.tsx --------------------------- */
  "common.notFound.title": "Diese Seite gibt es nicht",
  "common.notFound.description": "Der Link ist vielleicht veraltet oder das Rezept wurde gelöscht.",
  "common.notFound.cta": "Zu meinen Rezepten",

  /* ------------------------------ ErrorBoundary.tsx -------------------------- */
  "common.crash.title": "Da ist etwas schiefgelaufen",
  "common.crash.description":
    "Die App konnte diesen Bereich nicht anzeigen. Versuche es erneut – deine Rezepte sind sicher gespeichert.",
  "common.crash.retry": "Erneut versuchen",
  "common.crash.home": "Zur Startseite",

  /* -------------------------------- ActionMenu.tsx --------------------------- */
  "common.actionMenu.triggerLabel": "Weitere Aktionen",

  /* -------------------------------- ConfirmDialog.tsx ------------------------ */
  "common.confirmDialog.confirm": "Bestätigen",
  "common.confirmDialog.cancel": "Abbrechen",

  /* ----------------------------------- Dialog.tsx ---------------------------- */
  "common.dialog.close": "Schließen",

  /* ---------------------------------- ErrorState.tsx ------------------------- */
  "common.errorState.offlineTitle": "Keine Verbindung",
  "common.errorState.genericTitle": "Etwas ist schiefgelaufen",
  "common.errorState.retryInline": "Erneut",
  "common.errorState.retry": "Erneut versuchen",

  /* ------------------------------------ Toast.tsx ---------------------------- */
  "common.toast.dismissLabel": "Meldung schließen",
  "common.toast.defaultErrorTitle": "Das hat nicht funktioniert",

  /* ----------------------------------- Spinner.tsx --------------------------- */
  "common.spinner.loading": "Wird geladen",
  "common.spinner.loadingEllipsis": "Wird geladen …",

  /* ------------------------------------ Input.tsx ---------------------------- */
  "common.passwordInput.show": "Passwort anzeigen",
  "common.passwordInput.hide": "Passwort verbergen",

  /* ---------------------------------- Skeleton.tsx --------------------------- */
  "common.skeletonList.loadingRecipes": "Rezepte werden geladen",

  /* ----------------------------------- Label.tsx ----------------------------- */
  "common.label.optional": "(optional)",

  /* -------------------------------- lib/session.tsx --------------------------- */
  "common.session.offlineSaveBlocked": "Offline — Änderungen können nicht gespeichert werden.",
  "common.session.emailUnverifiedBlocked":
    "Bitte bestätige zuerst deine E-Mail-Adresse — bis dahin kannst du nur mitlesen.",
  "common.session.emailUnverifiedBannerTitle": "E-Mail-Adresse noch nicht bestätigt",
  "common.session.emailUnverifiedBannerBody":
    "Wir haben dir einen Bestätigungslink geschickt. Bis du darauf klickst, kannst du Rezepte und Einkaufslisten nur ansehen — Einladungen annehmen geht trotzdem.",
  "common.session.emailUnverifiedBannerAction": "Zu den Einstellungen",
  "common.session.checkingLogin": "Anmeldung wird geprüft …",
  "common.session.serverUnreachable": "Server nicht erreichbar",
  "common.session.redirectingToLogin": "Weiterleitung zur Anmeldung …",
  "common.session.noGroupTitle": "Noch keine Gruppe",
  "common.session.noGroupDescription":
    "Rezepte gehören immer zu einer Gruppe. Lege eine Gruppe an (z. B. „Familie“) oder nimm eine Einladung an.",
  "common.session.createGroup": "Gruppe anlegen",

  /* -------------------------------- SideNav.tsx ------------------------------ */
  // The footer user row's aria-label: the row's *visible* name is the user's
  // own name, which does not say where the link goes.
  "common.sidenav.accountAction": "Konto und Einstellungen",
} as const satisfies NamespaceCatalog<"common">;

export type CommonCatalog = typeof commonDe;
