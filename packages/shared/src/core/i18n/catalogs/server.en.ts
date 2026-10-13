/**
 * English — namespace 7. See `server.de.ts` for what seeded this file and why
 * `server.mail.*` is not here yet.
 */
import type { LocaleCatalog } from "../types.ts";
import type { ServerCatalog } from "./server.de.ts";

export const serverEn: LocaleCatalog<ServerCatalog> = {
  /* -------------------------- ApiError defaults -------------------------- */
  "server.error.badRequest": "Invalid request",
  "server.error.unauthorized": "Not signed in",
  "server.error.invalidCredentials": "Email or password is incorrect",
  "server.error.forbidden": "Not permitted",
  "server.error.notFound": "Not found",
  "server.error.conflict": "Conflict",
  "server.error.payloadTooLarge": "File is too large (max. 15 MB)",
  "server.error.unsupportedMediaType": "File type is not supported",
  "server.error.validationFailed": "Input is invalid",
  "server.error.internal": "Internal server error",
  "server.error.routeUnknown": "Route {method} {path} does not exist",
  "server.error.requestFailed": "Request failed",
  "server.error.tooManyAttempts": "Too many attempts. Please try again in {seconds} seconds.",

  /* ------------------------------ Zod: custom ----------------------------- */
  "server.validation.noChanges": "No changes were submitted",
  "server.validation.httpUrlOnly": "Only http(s) links are allowed",

  /* ------------------------- Zod: field-specific -------------------------- */
  "server.zod.field.name.too_small.1": "Name is required",
  "server.zod.field.title.too_small.1": "Title is required",
  "server.zod.field.password.too_small.8": "Password must be at least 8 characters",
  "server.zod.field.password.too_big.200": "Password is too long",
  "server.zod.field.email.invalid_format": "Please enter a valid email address",
  "server.zod.field.url.invalid_format": "Please enter a valid URL",
  "server.zod.field.color.invalid_format": "Colour must be a hex value like #e11d48",

  /* ------------------------- Zod: generic fallbacks ------------------------ */
  "server.zod.too_small.string": "Must be at least {bound} characters long",
  "server.zod.too_small.number": "Must be at least {bound}",
  "server.zod.too_small.array": "At least {bound} entries are required",
  "server.zod.too_small": "Value is too small",
  "server.zod.too_big.string": "Must be at most {bound} characters long",
  "server.zod.too_big.number": "Must be at most {bound}",
  "server.zod.too_big.array": "At most {bound} entries are allowed",
  "server.zod.too_big": "Value is too big",
  "server.zod.invalid_format": "Invalid format",
  "server.zod.invalid_type": "Invalid value",
  "server.zod.fallback": "Input is invalid",

  /* ------------------------ duration rendering (§7) ------------------------ */
  "server.duration.zero": "0 min",
  "server.duration.days": { one: "{count} day", other: "{count} days" },
  "server.duration.hours": "{count} hr",
  "server.duration.minutes": "{count} min",

  /* ---------------------------- groups + invites --------------------------- */
  "server.group.groupIdMissing": "Group id is missing from the request",
  "server.group.notFound": "Group not found",
  "server.group.noAccess": "No access to this group",
  "server.group.ownerOnly": "Only the group's owner may do that",
  "server.group.adminOnly": "You need admin rights in this group",
  "server.group.alreadyMember": "This person is already a member of the group",
  "server.group.memberNotFound": "This member does not belong to the group",
  "server.group.nameTaken": "You already have a group with this name",
  "server.group.lastOwner": "The group needs at least one owner",
  "server.group.transferOwnershipFirst": "Transfer ownership before leaving the group",
  "server.group.fieldNotAMember": "Not a member of this group",
  "server.group.notAMember": "You are not a member of this group",

  "server.invite.notFound": "Invite not found",
  "server.invite.alreadyAccepted": "This invite has already been accepted",
  "server.invite.invalid": "This invite is invalid",
  "server.invite.revoked": "This invite has been revoked",
  "server.invite.expired": "This invite has expired",
  "server.invite.alreadyUsed": "This invite has already been used",

  /* --------------------------------- auth ----------------------------------- */
  "server.auth.invalidJsonBody": "The request body is not valid JSON",
  "server.auth.unknownOauthProvider": "Unknown OAuth provider",
  "server.auth.emailTaken": "This email address is already registered",
  "server.auth.noPasswordSet": "No password is set for this account. Please sign in with Google or GitHub.",
  "server.auth.currentPasswordRequired": "Please enter your current password",
  "server.auth.currentPasswordWrong": "The current password is incorrect",
  "server.auth.sessionNotFound": "Session not found",
  "server.auth.oauthProviderAborted": "The provider cancelled: {providerError}",
  "server.auth.oauthIncompleteResponse": "Incomplete response from the provider",
  "server.auth.oauthSessionExpired": "OAuth session expired, please sign in again",
  "server.auth.pleaseSignInAgain": "Please sign in again and try once more.",
  "server.auth.oauthEmailTaken":
    "This email address is already registered. Sign in with your password and link the provider afterwards in your profile.",
  "server.auth.oauthLinkedElsewhere": "This provider account is already linked to a different user.",
  "server.auth.oauthProviderAlreadyLinked": "An account for this provider is already linked. Unlink it first.",
  "server.auth.oauthNothingLinked": "Nothing is linked for this provider.",
  "server.auth.oauthLastLoginMethod": "This is your only way to sign in. Set a password first.",
  "server.auth.verificationLinkInvalid": "This confirmation link is no longer valid. Please request a new one.",
  "server.auth.emailAlreadyVerified": "This email address is already confirmed",
  "server.auth.userNotFound": "User not found",
  "server.auth.googleNotConfigured": "Google sign-in is not configured on this server",
  "server.auth.githubNotConfigured": "GitHub sign-in is not configured on this server",
  "server.auth.oauthLoginFailed": "Signing in with the provider failed",
  "server.auth.googleProfileUnavailable": "The Google profile could not be loaded",
  "server.auth.googleProfileIncomplete": "The Google profile was incomplete",
  "server.auth.githubProfileUnavailable": "The GitHub profile could not be loaded",
  "server.auth.githubProfileIncomplete": "The GitHub profile was incomplete",
  "server.auth.resetLinkInvalid": "This link is no longer valid. Please request a new one.",
  "server.auth.emailUnverified":
    "Please confirm your e-mail address first. Until then you can only read along and accept invitations.",

  /* -------------------------------- import ----------------------------------- */
  "server.import.pastedTextEmpty": "The pasted text is empty.",
  "server.import.invalidJsonBody": "The request body is not valid JSON.",
  "server.import.noSourceFile": "This draft has no source file.",
  "server.import.sourceFileDeleted": "The source file has already been deleted.",
  "server.import.draftAlreadyCommitted": "This draft has already been saved as a recipe.",
  "server.import.titleMissing": "Title is missing",
  "server.import.titleRequired": "Please enter a title.",
  "server.import.noIngredientsOrSteps": "Neither ingredients nor steps are present",
  "server.import.recipeNeedsIngredientOrStep": "The recipe needs at least one ingredient or one step.",
  "server.import.collectionNotInGroup": "The selected collection does not exist in this group.",
  "server.import.collectionsNotInGroup":
    "At least one of the selected collections does not exist in this group.",
  "server.import.fileUnreadable": "The file could not be read (multipart/form-data expected).",
  "server.import.noFileInField": 'No file was sent in the "{fieldName}" field.',
  "server.import.fileEmpty": "The file is empty.",
  "server.import.unsupportedFileType":
    "This file type is not supported. Please upload a photo (JPEG, PNG, WEBP, HEIC) or a PDF.",
  "server.import.expectedImageNotPdf": "This endpoint expects an image, not a PDF.",
  "server.import.expectedPdfNotImage": "This endpoint expects a PDF, not an image.",
  "server.import.unsupportedImageFormat": "Image format {mimeType} is not supported.",
  "server.import.invalidFilename": "Invalid filename.",
  "server.import.draftNotFound": "This import draft no longer exists.",
  "server.import.ocrDisabled":
    "Import by photo or PDF is not enabled on this server. Recipes can be imported from a web address or as pasted text.",
  "server.import.pdfDisabled":
    "PDF import is not enabled on this server. Photos, web addresses and pasted text still work.",
  "server.import.sessionMiddlewareUnavailable": "Authentication is not available (session middleware is missing).",
  "server.import.groupMiddlewareUnavailable": "The group check is not available (group middleware is missing).",
  "server.import.urlInvalid": "The URL is invalid.",
  "server.import.schemeNotAllowed": "Only http and https addresses can be imported ({protocol}).",
  "server.import.credentialsInUrl": "URLs with a username/password are not supported.",
  "server.import.noHostname": "The URL contains no hostname.",
  "server.import.blockedHost": "Addresses on the local network cannot be imported ({hostname}).",
  "server.import.privateIp": "Private IP addresses cannot be imported ({hostname}).",
  "server.import.suspiciousHost": "This address is not a valid public domain ({hostname}).",
  "server.import.dnsFailed": "The hostname {hostname} could not be resolved.",
  "server.import.dnsPointsToPrivateIp":
    "{hostname} points to a private IP address ({address}) and cannot be imported.",
  "server.import.noRecipeFound":
    "No recipe was found on this page. Please use the direct link to the recipe, or upload a photo.",
  "server.import.pageTooLarge": "The page is too large to import (max. 5 MB).",
  "server.import.pageTimeout": "The page did not respond in time (10 s timeout).",
  "server.import.pageLoadFailed": "The page could not be loaded: {reason}",
  "server.import.redirectNoLocation": "The page responded with {status} but no target address.",
  "server.import.tooManyRedirects": "The page redirects too many times.",
  "server.import.pageHttpError": "The page responded with HTTP {status}. Please check the address.",
  "server.import.pageNotHtml": "This address does not return HTML ({contentType}). Please use the link to the recipe page.",

  /* ------------------------------- meal plan ------------------------------ */
  "server.plan.entryNotFound": "Meal plan entry not found",
  "server.plan.invalidDate": "Please provide a date in the format YYYY-MM-DD",
  "server.plan.rangeInvalid": "The start date must be before the end date",
  "server.plan.rangeTooLong": "The range may cover at most 62 days",
  "server.plan.dayFull": "No more than {max} recipes can be planned for one day",
  "server.plan.alreadyPlanned": "This recipe is already planned for that day",

  /* -------------------------------- recipes ----------------------------------- */
  "server.recipes.collectionNotFound": "Collection not found",
  "server.recipes.recipeNotFound": "Recipe not found",
  "server.recipes.tagNotFound": "Tag not found",
  "server.recipes.tagNameTaken": "This tag already exists",
  "server.recipes.noFileInField": 'No file was sent in the "{field}" field',
  "server.recipes.unsupportedImageType": "Only images (JPEG, PNG, WebP, HEIC/HEIF, AVIF) are supported",
  "server.recipes.noServingsToScale": "This recipe has no servings amount, so it cannot be scaled",
  "server.recipes.nothingToUndo": "There is no cook entry that can be undone",

  /* -------------------------------- shopping ----------------------------------- */
  "server.shopping.listFull": "This shopping list is full (max. {max} items)",
  "server.shopping.itemNotFound": "Item not found",
  "server.shopping.suggestionNotFound": "Suggestion not found",
  "server.shopping.listNotFound": "Shopping list not found",
  "server.shopping.listNameTaken": "A shopping list with this name already exists",
  "server.shopping.tooManyLists": "More than {max} shopping lists per group is not possible",

  /* ------------------------------ saved cards ---------------------------- */
  "server.card.notFound": "Card not found",
  "server.card.tooManyCards": "More than {max} cards is not possible",
  "server.card.alreadySaved": "This card is already saved",
  "server.card.valueEmpty": "Please enter the card's number",
  "server.card.valueTooLong": "The number is too long for this code type",
  "server.card.valueDigitsOnly": "This code type consists of digits only",
  "server.card.valueWrongLength": "This code type needs a different number of digits",
  "server.card.valueOddLength": "This code type needs an even number of digits",
  "server.card.valueCharset": "The number contains characters this code type cannot carry",
  "server.card.valueCheckDigit": "The check digit does not match — please compare the number again",
  "server.card.formatAndValue": "Code type and number can only be changed together",

  /* ----------------------------------- ocr ------------------------------------ */
  "server.ocr.heicUnsupported":
    "HEIC images cannot be read on this server. Please upload the photo as JPEG or PNG (iPhone: Settings › Camera › Formats › “Most Compatible”).",
  "server.ocr.imageUnreadable": "The image could not be read ({message}).",
  "server.ocr.imageProcessingUnavailable":
    "Image processing is not available on this server (sharp is missing). Please inform the administrator.",
  "server.ocr.noTextDetected":
    "No text was detected in the image. Try zooming in closer, using good light, and photographing the sheet flat.",
  "server.ocr.pdfProcessingTimedOut": "Processing the PDF took too long. Please upload only the pages with the recipe.",
  "server.ocr.pdfNoTextLayer": "This PDF contains no text — please upload a photo of the page instead.",
  "server.ocr.recognitionUnavailable": "Text recognition is not available on this server. Please inform the operator.",
  "server.ocr.languageDataMissing":
    "The language data for text recognition is missing on this server. Please inform the operator.",
  "server.ocr.recognitionFailed": "Text recognition failed.",
  "server.ocr.recognitionTimedOut": "Text recognition took too long. Please upload a smaller or sharper image.",
  "server.ocr.tooManyConcurrentRecognitions":
    "Too many text recognitions are running right now. Please try again in a moment.",

  /* ---- modules ---- */
  "server.module.disabled": "This module is not enabled for this household.",

  /* ----------------------------------- mail ------------------------------------ */
  "server.mail.buttonFallback": "If the button does not work, copy this address into your browser:",
  "server.mail.invite.heading": "{invitedByName} invites you to “{groupName}”",
  "server.mail.invite.body1": "{invitedByName} wants to share the recipes of “{groupName}” with you.",
  "server.mail.invite.body2":
    "Open the link to join. You can register as a new user or use an existing account.",
  "server.mail.invite.footer":
    "The link is valid for {days} days. If you were not expecting this invitation, you can simply ignore this email.",
  "server.mail.invite.subject": "Invitation to the group “{groupName}”",
  "server.mail.invite.actionLabel": "Accept invitation",
  "server.mail.passwordReset.heading": "Reset password",
  "server.mail.passwordReset.body1": "Hi {name}, a new password was requested for your account.",
  "server.mail.passwordReset.body2":
    "Open the link and choose a new password. You will then be signed out on every device and need to sign in again once.",
  "server.mail.passwordReset.footer":
    "The link is valid for {minutes} minutes and can only be used once. If this was not you, there is nothing to do — your current password stays valid.",
  "server.mail.passwordReset.subject": "New password for your Rezepte account",
  "server.mail.passwordReset.actionLabel": "Set new password",
  "server.mail.verifyEmail.heading": "Confirm email address",
  "server.mail.verifyEmail.body1": "Hi {name}, please confirm that this address belongs to you.",
  "server.mail.verifyEmail.body2": "That way we can safely recognise you if you ever forget your password.",
  "server.mail.verifyEmail.footer":
    "The link is valid for {hours} hours. If you did not create an account with Rezepte, ignore this email.",
  "server.mail.verifyEmail.subject": "Please confirm your email address",
  "server.mail.verifyEmail.actionLabel": "Confirm email",
};
