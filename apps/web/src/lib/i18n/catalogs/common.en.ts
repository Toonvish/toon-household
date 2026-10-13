/**
 * English — namespace "common". See `common.de.ts` for who owns this file and what
 * seeded it.
 */
import type { LocaleCatalog } from "@toon/shared";
import type { CommonCatalog } from "./common.de.ts";

export const commonEn: LocaleCatalog<CommonCatalog> = {
  "common.time.justNow": "just now",
  "common.common.dash": "–",
  "common.servings.defaultUnit": "servings",

  "common.error.unknown": "Unknown error. Please try again.",
  "common.error.unknownValue": "Unknown error.",
  "common.error.network": "No connection to the server. Are you offline?",
  "common.error.unauthorized": "Please sign in.",
  "common.error.forbidden": "You do not have permission for that.",
  "common.error.notFound": "Not found.",
  "common.error.conflict": "That conflicts with existing data.",
  "common.error.payloadTooLarge": "The file is too large (max. 15 MB).",
  "common.error.unsupportedMediaType": "This file type is not supported.",
  "common.error.validationFailed": "The input is incomplete or invalid.",
  "common.error.serverError": "Server error. Please try again later.",
  "common.error.requestFailed": "Request failed.",
  "common.upload.tooLarge": '"{filename}" is {size} MB. The maximum is 15 MB.',

  "common.boot.missingRoot": "#root is missing from index.html",

  "common.nav.recipes": "Recipes",
  "common.nav.shopping": "Shopping",
  "common.nav.import": "Import",
  "common.nav.profile": "Profile",
  "common.nav.groups": "Groups",
  "common.nav.collections": "Collections",
  "common.nav.tags": "Tags",
  "common.nav.mainNavLabel": "Main navigation",
  // "Plan" is the same word in both locales — not a missing translation, see
  // common.de.ts.
  "common.nav.plan": "Plan",
  "common.nav.planNewBadge": "New",
  "common.nav.organiseLabel": "Organise",

  "common.sidenav.newRecipe": "New recipe",

  "common.offlineBanner.message":
    "Offline – saved recipes are visible, changes can only be saved again once you are back online.",

  "common.updateBanner.message": "New version available. Your changes have not been saved yet.",
  "common.updateBanner.reload": "Reload anyway",

  "common.installPrompt.heading": "Recipes on your home screen",
  "common.installPrompt.description":
    "Install the app to open it like a normal app – with its own icon and no browser bar. You can cook from recipes you have already opened even without a connection, and the shopping list can be ticked off offline; editing recipes and importing need an internet connection.",
  "common.installPrompt.cta": "Add to home screen",
  "common.installPrompt.iosHint.before": "Tap",
  "common.installPrompt.iosHint.after": 'and then “Add to Home Screen”.',
  "common.installPrompt.shareIconLabel": "Share",
  "common.installPrompt.dismiss": "Dismiss hint",

  "common.notFound.title": "This page does not exist",
  "common.notFound.description": "The link may be outdated, or the recipe was deleted.",
  "common.notFound.cta": "Go to my recipes",

  "common.crash.title": "Something went wrong",
  "common.crash.description":
    "The app could not display this area. Try again – your recipes are safely stored.",
  "common.crash.retry": "Try again",
  "common.crash.home": "Go to home",

  "common.actionMenu.triggerLabel": "More actions",

  "common.confirmDialog.confirm": "Confirm",
  "common.confirmDialog.cancel": "Cancel",

  "common.dialog.close": "Close",

  "common.errorState.offlineTitle": "No connection",
  "common.errorState.genericTitle": "Something went wrong",
  "common.errorState.retryInline": "Retry",
  "common.errorState.retry": "Try again",

  "common.toast.dismissLabel": "Dismiss message",
  "common.toast.defaultErrorTitle": "That did not work",

  "common.spinner.loading": "Loading",
  "common.spinner.loadingEllipsis": "Loading …",

  "common.passwordInput.show": "Show password",
  "common.passwordInput.hide": "Hide password",

  "common.skeletonList.loadingRecipes": "Loading recipes",

  "common.label.optional": "(optional)",

  "common.session.offlineSaveBlocked": "Offline — changes cannot be saved right now.",
  "common.session.emailUnverifiedBlocked":
    "Please confirm your e-mail address first — until then you can only read along.",
  "common.session.emailUnverifiedBannerTitle": "E-mail address not confirmed yet",
  "common.session.emailUnverifiedBannerBody":
    "We sent you a confirmation link. Until you click it you can only view recipes and shopping lists — accepting invitations still works.",
  "common.session.emailUnverifiedBannerAction": "Go to settings",
  "common.session.checkingLogin": "Checking sign-in …",
  "common.session.serverUnreachable": "Server unreachable",
  "common.session.redirectingToLogin": "Redirecting to sign-in …",
  "common.session.noGroupTitle": "No group yet",
  "common.session.noGroupDescription":
    "Recipes always belong to a group. Create a group (e.g. “Family”) or accept an invite.",
  "common.session.createGroup": "Create group",

  /* -------------------------------- SideNav.tsx ------------------------------ */
  "common.sidenav.accountAction": "Account and settings",
};
