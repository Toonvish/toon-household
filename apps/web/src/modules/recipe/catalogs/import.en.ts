/**
 * English — namespace "import". See `import.de.ts` for who owns this file
 * and why it is an intentional skeleton.
 */
import type { LocaleCatalog } from "@toon/shared";
import type { ImportCatalog } from "./import.de.ts";

export const importEn: LocaleCatalog<ImportCatalog> = {
  /* ------------------------------- /import -------------------------------- */
  "recipe.import.page.title": "Import recipe",
  "recipe.import.page.subtitle.ocr":
    "From the web, a cookbook photo, or a PDF. You can check and correct everything before saving.",
  "recipe.import.page.subtitle.noOcr": "From the web or as pasted text. You can check and correct everything before saving.",
  "recipe.import.page.offline.ocr":
    "Offline — importing needs a connection because text recognition runs on the server. You can still view and cook saved recipes.",
  "recipe.import.page.offline.url":
    "Offline — importing needs a connection because the server has to fetch the page. You can still view and cook saved recipes.",
  "recipe.import.page.toast.noGroup.title": "No group selected",
  "recipe.import.page.toast.noGroup.description": "First choose the group to import the recipe into.",
  "recipe.import.common.targetGroup": "Target group",
  "recipe.import.page.savingToGroup": "Will be saved to {groupName}",

  "recipe.import.page.url.heading": "From a website",
  "recipe.import.page.url.subtitle": "Paste a link and we'll read the recipe out.",
  "recipe.import.page.url.placeholder": "https://www.chefkoch.de/rezepte/…",
  "recipe.import.page.url.ariaLabel": "Recipe URL",
  "recipe.import.page.url.pasteLabel": "Paste from clipboard",
  "recipe.import.page.url.invalid": "That doesn't look like a full address yet — it must start with http:// or https://.",
  "recipe.import.page.url.hint": "Tested with {first} and {second}. Other sites work too, as long as they ship recipe data in the standard format.",
  "recipe.import.page.url.submit": "Load recipe",
  "recipe.import.page.url.retryPhoto": "Import as a photo instead",
  "recipe.import.page.url.retryText": "Paste the text by hand",

  "recipe.import.page.photo.heading": "Photo of a recipe",
  "recipe.import.page.photo.subtitle": "Cookbook, magazine, note card – text recognition runs on the server.",
  "recipe.import.page.photo.tip":
    "Tip: shoot straight down, good light, no shadows. Images are automatically shrunk before upload.",
  "recipe.import.page.photo.count": { one: "{count} photo · {bytes}", other: "{count} photos · {bytes}" },
  "recipe.import.page.photo.merge": "will be stitched into one document",
  "recipe.import.page.photo.altSelected": "Selected photo {index}",
  "recipe.import.page.photo.remove": "Remove photo {index}",
  "recipe.import.page.photo.submit": { one: "Import photo", other: "Import {count} photos" },
  "recipe.import.page.photo.invalidFile": "„{filename}“ is not an image. Allowed are JPEG, PNG, WebP or HEIC.",
  "recipe.import.page.photo.subjectCount": "{count} photos",

  "recipe.import.page.document.heading": "PDF or image file",
  "recipe.import.page.document.subtitle": "For PDFs the text layer is read first – that's exact and fast.",
  "recipe.import.page.document.headingImageOnly": "Image file",
  "recipe.import.page.document.subtitleImageOnly": "PDF import is off on this server – image files are read.",
  "recipe.import.page.document.dragHint": "Drag a file here or",
  "recipe.import.page.document.pick": "Choose file",
  "recipe.import.page.document.formats": "PDF, JPEG, PNG, WebP or HEIC · max. {size}",
  "recipe.import.page.document.formatsImageOnly": "JPEG, PNG, WebP or HEIC · max. {size}",
  "recipe.import.page.document.remove": "Remove file",
  "recipe.import.page.document.submit": "Import file",
  "recipe.import.page.document.invalid": "Please choose a PDF file or an image.",
  "recipe.import.page.document.invalidImageOnly": "Please choose an image.",
  "recipe.import.page.document.pdfUnavailable": "PDF import is off on this server. A photo of the page works.",
  "recipe.import.page.document.retryPhoto": "Take a photo instead",

  "recipe.import.page.text.heading": "Paste text",
  "recipe.import.page.text.subtitle": "If you already have the recipe as text – e.g. from a message.",
  "recipe.import.page.text.toggleClose": "close",
  "recipe.import.page.text.toggleOpen": "open",
  "recipe.import.page.text.titlePlaceholder": "Title (optional)",
  "recipe.import.page.text.titleLabel": "Title",
  "recipe.import.page.text.bodyLabel": "Recipe text",
  "recipe.import.page.text.bodyPlaceholder":
    "Paste ingredients and instructions.\n\nIngredients\n250 g flour\n2 eggs\n\nInstructions\n1. Mix everything…",
  "recipe.import.page.text.submit": "Analyse text",
  "recipe.import.page.text.subject": "Pasted text",

  "recipe.import.page.drafts.heading": "Open drafts",
  "recipe.import.page.drafts.hint": "An interrupted import isn't lost – you can continue here.",
  "recipe.import.page.drafts.deleteError.title": "Draft could not be discarded",
  "recipe.import.page.drafts.deleteError.description": "Please try again.",

  "recipe.import.page.clipboard.unreadable.title": "Clipboard not readable",
  "recipe.import.page.clipboard.unreadable.description":
    "Your browser doesn't allow pasting automatically – please paste the URL by hand.",

  /* --------------------------- /import/:draftId ---------------------------- */
  "recipe.import.review.back": "Import",
  "recipe.import.review.noDraft": "No draft selected",
  "recipe.import.review.toImport": "To import",
  "recipe.import.review.loadError": "Draft could not be loaded",
  "recipe.import.review.toOverview": "To the import overview",
  "recipe.import.review.quality": "Recognition quality {value}",
  "recipe.import.review.title.fallback": "Check import",
  "recipe.import.review.autosaveError.title": "Autosave failed",
  "recipe.import.review.autosaveError.retry": "Save now",
  "recipe.import.review.committed.title": "This draft has already been saved as a recipe.",
  "recipe.import.review.committed.open": "Open recipe",
  "recipe.import.review.groupMismatch.text": "This draft belongs to the group {groupName}. It will be saved there.",
  "recipe.import.review.groupMismatch.fallbackName": "another group",
  "recipe.import.review.groupMismatch.switch": "Switch group",
  "recipe.import.review.groupStays.title": "Draft stays in its group",
  "recipe.import.review.groupStays.description":
    "An existing draft cannot be moved. Start the import again in the other group if the recipe should land there.",
  "recipe.import.review.lowConfidence.title": "Recognition was uncertain – please check thoroughly.",
  "recipe.import.review.lowConfidence.hint":
    "Compare the fields against the source. Lines marked „please check“ are the most likely mistakes.",
  "recipe.import.review.lowConfidence.countHint": "Currently flagged: {ingredients} ingredients, {steps} steps.",
  "recipe.import.review.tabs.ariaLabel": "View",
  "recipe.import.review.tabs.source": "Source",
  "recipe.import.review.tabs.form": "Recipe",
  "recipe.import.review.retrySave": "Save again",
  "recipe.import.review.discard": "Discard",
  "recipe.import.review.saving": "Saving…",
  "recipe.import.review.save": "Save",
  "recipe.import.review.discardDialog.title": "Discard draft?",
  "recipe.import.review.discardDialog.description":
    "The import draft will be deleted. The photo or recognised text will be gone – the recipe hasn't been saved yet.",
  "recipe.import.review.discardDialog.message": "The import draft will be deleted. The recipe hasn't been saved yet.",
  "recipe.import.review.discardDialog.confirm": "Discard",
  "recipe.import.review.discardDialog.cancel": "Keep editing",
  "recipe.import.review.toast.saved.title": "Recipe saved",
  "recipe.import.review.toast.discarded.title": "Draft discarded",
  "recipe.import.review.toast.saveFallback": "Please check your input",

  "recipe.import.autosave.saving": "Saving…",
  "recipe.import.autosave.dirty": "Changes not saved yet",
  "recipe.import.autosave.saved": "Saved",
  "recipe.import.autosave.savedAt": "Saved at {time}",
  "recipe.import.autosave.error": "Save failed",
  "recipe.import.autosave.idle": "Saved automatically",

  /* ------------------------------ confidence -------------------------------- */
  "recipe.import.confidence.good": "looks good",
  "recipe.import.confidence.needsCheck": "please check",
  "recipe.import.confidence.quality": "Recognition quality: {value}",
  "recipe.import.confidence.unknown": "unknown",
  "recipe.import.confidence.field.title": "Title",
  "recipe.import.confidence.field.description": "Description",
  "recipe.import.confidence.field.ingredients": "Ingredients",
  "recipe.import.confidence.field.steps": "Instructions",
  "recipe.import.confidence.field.servings": "Servings",
  "recipe.import.confidence.field.times": "Times",
  "recipe.import.confidence.field.image": "Image",
  "recipe.import.confidence.reason.noName": "No name recognised",
  "recipe.import.confidence.reason.shortName": "Very short name",
  "recipe.import.confidence.reason.noLetters": "Name contains no letters",
  "recipe.import.confidence.reason.strangeChars": "Unusual characters in the name",
  "recipe.import.confidence.reason.unknownUnit": "Unit „{unit}“ unknown",
  "recipe.import.confidence.reason.numberNoQuantity": "Number in the line, but no quantity recognised",
  "recipe.import.confidence.reason.largeQuantityNoUnit": "Very large quantity with no unit",
  "recipe.import.confidence.reason.mergedLine": "Line looks merged – maybe split it",
  "recipe.import.confidence.reason.quantityInName": "Quantity still stuck in the name",
  "recipe.import.confidence.reason.listUncertainIngredients": "Ingredient list recognised with low confidence",
  "recipe.import.confidence.reason.emptyStep": "Empty step",
  "recipe.import.confidence.reason.shortStep": "Very short step",
  "recipe.import.confidence.reason.strangeCharsStep": "Unusual characters in the text",
  "recipe.import.confidence.reason.longStep": "Very long step – maybe split it",
  "recipe.import.confidence.reason.listUncertainSteps": "Instructions recognised with low confidence",

  /* ---------------------------- image capture -------------------------------- */
  "recipe.import.imageCapture.captureLabel": "Take photo",
  "recipe.import.imageCapture.galleryLabel": "Choose from gallery",

  /* ----------------------------- error panel --------------------------------- */
  "recipe.import.errorPanel.retry": "Try again",

  /* --------------------------- OCR progress panel ----------------------------- */
  "recipe.import.ocrProgress.ocr.title": "Text recognition running…",
  "recipe.import.ocrProgress.ocr.body":
    "The server is reading the text from the image (German + English). Depending on the image size this can take up to a minute and cannot be cancelled. You can leave the window open – please don't close it.",
  "recipe.import.ocrProgress.text.title": "Reading PDF…",
  "recipe.import.ocrProgress.text.body":
    "The PDF's text layer is read first. If it's missing, the pages are converted into images and read with text recognition – that can then take up to a minute.",
  "recipe.import.ocrProgress.url.title": "Loading page…",
  "recipe.import.ocrProgress.url.body": "The page is fetched and searched for recipe data. This usually takes only a few seconds.",
  "recipe.import.ocrProgress.preparing": "Preparing photo…",
  "recipe.import.ocrProgress.uploading": "Uploading file…",
  "recipe.import.ocrProgress.longWait":
    "This is taking longer than usual. Please be a little more patient – cancelling would not speed up recognition.",

  /* --------------------------- pending drafts list ----------------------------- */
  "recipe.import.pendingDrafts.source.website": "Website",
  "recipe.import.pendingDrafts.source.pdfText": "PDF (text layer)",
  "recipe.import.pendingDrafts.source.pdfOcr": "PDF (text recognition)",
  "recipe.import.pendingDrafts.source.photoOcr": "Photo (text recognition)",
  "recipe.import.pendingDrafts.source.manualText": "Pasted text",
  "recipe.import.pendingDrafts.source.fallback": "Import",
  "recipe.import.pendingDrafts.openLabel": "Continue editing draft {title}",
  "recipe.import.pendingDrafts.untitled": "Untitled",
  "recipe.import.pendingDrafts.untitledLower": "untitled",
  "recipe.import.pendingDrafts.summary": "{source} · {ingredients} ingredients · {steps} steps · {date}",
  "recipe.import.pendingDrafts.loadError": "Open drafts could not be loaded: {title}",
  "recipe.import.pendingDrafts.deleteLabel": "Discard draft",

  /* ------------------------------ source viewer -------------------------------- */
  "recipe.import.source.tabsAriaLabel": "Source",
  "recipe.import.source.tab.image": "Image",
  "recipe.import.source.tab.text": "Raw text",
  "recipe.import.source.tab.link": "Source",
  "recipe.import.source.empty": "There's no source view for this draft. You can edit the fields on the right directly.",
  "recipe.import.source.imageFailed":
    "The source image could not be loaded. Maybe you're no longer a member of this group, or the file was deleted.",
  "recipe.import.source.zoom.out": "Zoom out",
  "recipe.import.source.zoom.in": "Zoom in",
  "recipe.import.source.zoom.rotate": "Rotate",
  "recipe.import.source.zoom.reset": "Reset",
  "recipe.import.source.zoom.openNewTab": "Open image in a new tab",
  "recipe.import.source.zoom.hint": "Two fingers to zoom, drag to pan. On desktop: Ctrl + mouse wheel.",
  "recipe.import.source.imageLoadFailed": "The source image could not be loaded.",
  "recipe.import.source.openDirect": "Open directly",
  "recipe.import.source.alt": "Recipe source image",
  "recipe.import.source.text.lineCount": { one: "{count} recognised line", other: "{count} recognised lines" },
  "recipe.import.source.text.copied": "Copied",
  "recipe.import.source.text.copyAll": "Copy all",
  "recipe.import.source.text.pdfLoading": "Loading PDF …",
  "recipe.import.source.text.pdfOpen": "Open PDF",
  "recipe.import.source.text.pdfPreviewOn": "PDF preview",
  "recipe.import.source.text.pdfPreviewOff": "Preview off",
  "recipe.import.source.text.empty": "No text was recognised.",
  "recipe.import.source.line.toIngredientTitle": "Turn line into ingredient",
  "recipe.import.source.line.toIngredientAria": "Turn line {index} into an ingredient",
  "recipe.import.source.line.toStepTitle": "Turn line into step",
  "recipe.import.source.line.toStepAria": "Turn line {index} into a step",
  "recipe.import.source.link.fallbackName": "Source",
  "recipe.import.source.link.openOriginal": "Open original page",
  "recipe.import.source.link.notHttp": "This source isn't an http(s) link and won't be linked.",
  "recipe.import.source.link.compareHint":
    "Compare the details on the right against the original page and fix anything the importer didn't recognise cleanly.",

  /* ------------------------------ upload progress -------------------------------- */
  "recipe.import.upload.defaultFileName": "File",
  "recipe.import.upload.ariaLabel": "Upload progress",

  /* -------------------------------- draft edit ------------------------------------ */
  "recipe.import.draftEdit.needTitle": "Please enter a title.",
  "recipe.import.draftEdit.noIngredients": "The recipe doesn't have any ingredients yet.",
  "recipe.import.draftEdit.noSteps": "The recipe doesn't have any instructions yet.",

  /* ---------------------------------- image --------------------------------------- */
  "recipe.import.image.tooLarge": "The file is {size}. The maximum allowed is {max}.",
  "recipe.import.image.empty": "The file is empty.",

  /* --------------------------------- queries --------------------------------------- */
  "recipe.import.queries.draftNotFound.message": "Draft not found",
  "recipe.import.queries.draftNotFound.hint": "This import draft doesn't exist in any of your groups.",

  /* ------------------------- review editor (ParsedRecipeEditor) --------------------
     "1 Std 15 Min" and "Für den Teig" stay GERMAN here deliberately: `parseDuration`
     and `INGREDIENT_HEADING_RE` only understand German, so an English sample would
     advertise input the parser drops. See import.de.ts. */
  "recipe.import.editor.basics.title": "Basics",
  "recipe.import.editor.title.label": "Title *",
  "recipe.import.editor.title.placeholder": "What's the recipe called?",
  "recipe.import.editor.description.label": "Short description",
  "recipe.import.editor.description.placeholder": "Optional – one sentence about the recipe",
  "recipe.import.editor.servings.label": "Servings",
  "recipe.import.editor.servings.ariaLabel": "Number of servings",
  "recipe.import.editor.servingsUnit.label": "Unit",
  "recipe.import.editor.times.label": "Times (minutes)",
  "recipe.import.editor.times.prep": "Prep",
  "recipe.import.editor.times.cook": "Cooking / baking",
  "recipe.import.editor.times.total": "Total",
  "recipe.import.editor.minutes.placeholder": "e.g. 30, or 1 Std 15 Min",
  "recipe.import.editor.difficulty.label": "Difficulty",
  "recipe.import.editor.difficulty.none": "– not specified –",
  "recipe.import.editor.difficulty.einfach": "easy",
  "recipe.import.editor.difficulty.mittel": "medium",
  "recipe.import.editor.difficulty.schwer": "hard",
  "recipe.import.editor.source.label": "Source",
  "recipe.import.editor.source.placeholder": "e.g. chefkoch.de or Grandma's cookbook",
  "recipe.import.editor.tags.label": "Tags",
  "recipe.import.editor.tags.placeholder": "Add a tag (Enter)",
  "recipe.import.editor.tags.remove": "Remove tag {tag}",

  "recipe.import.editor.ingredients.title": "Ingredients ({count})",
  "recipe.import.editor.flagged": "{count} to check",
  "recipe.import.editor.ingredients.reparseAll": "Re-parse all",
  "recipe.import.editor.pasteText": "Paste text",
  "recipe.import.editor.cancel": "Cancel",
  "recipe.import.editor.ingredients.addRow": "Row",
  "recipe.import.editor.ingredients.paste.placeholder":
    "Paste one ingredient per line.\nSection headings like „Für den Teig:“",
  "recipe.import.editor.ingredients.paste.submit": "Add lines",
  "recipe.import.editor.ingredients.empty":
    "No ingredients yet. Add a row, or take lines from the raw text on the left.",
  "recipe.import.editor.section.ariaLabel": "Section",
  "recipe.import.editor.ingredients.quantity.ariaLabel": "Amount, row {index}",
  "recipe.import.editor.ingredients.quantity.placeholder": "Amount",
  "recipe.import.editor.ingredients.unit.ariaLabel": "Unit, row {index}",
  "recipe.import.editor.ingredients.unit.placeholder": "Unit",
  "recipe.import.editor.ingredients.name.ariaLabel": "Ingredient, row {index}",
  "recipe.import.editor.ingredients.name.placeholder": "Ingredient",
  "recipe.import.editor.ingredients.quantityMax.ariaLabel": "Amount up to, row {index}",
  "recipe.import.editor.ingredients.quantityMax.placeholder": "up to (e.g. 3)",
  "recipe.import.editor.ingredients.note.ariaLabel": "Note, row {index}",
  "recipe.import.editor.ingredients.note.placeholder": "Note (e.g. finely chopped)",
  "recipe.import.editor.ingredients.section.ariaLabel": "Section, row {index}",
  "recipe.import.editor.ingredients.section.placeholder": "Section (e.g. Für den Teig)",
  "recipe.import.editor.ingredients.raw.label": "Raw line (from the source)",
  "recipe.import.editor.ingredients.raw.ariaLabel": "Raw line {index}",
  "recipe.import.editor.ingredients.raw.reparse": "Re-parse raw line",
  "recipe.import.editor.row.up": "Move up",
  "recipe.import.editor.row.down": "Move down",
  "recipe.import.editor.row.editDetails": "Edit details",
  "recipe.import.editor.row.delete": "Delete row",
  "recipe.import.editor.ingredients.row.reparse": "Re-parse row",
  "recipe.import.editor.ingredients.row.split": "Split a combined row",
  "recipe.import.editor.ingredients.row.toStep": "Move ingredient to the instructions",

  "recipe.import.editor.steps.title": "Instructions ({count})",
  "recipe.import.editor.steps.resplit": "Split again",
  "recipe.import.editor.steps.addStep": "Step",
  "recipe.import.editor.steps.paste.placeholder":
    "Paste the instructions – “1.”, “2.” or blank lines separate the steps.",
  "recipe.import.editor.steps.paste.submit": "Add steps",
  "recipe.import.editor.steps.empty":
    "No steps yet. Add a step, or take lines from the raw text on the left.",
  "recipe.import.editor.steps.text.ariaLabel": "Step {index}",
  "recipe.import.editor.steps.text.placeholder": "What needs doing?",
  "recipe.import.editor.steps.section.ariaLabel": "Section, step {index}",
  "recipe.import.editor.steps.section.placeholder": "Section (e.g. Make the dough)",
  "recipe.import.editor.steps.row.split": "Split step",
  "recipe.import.editor.steps.row.toIngredient": "Move step to the ingredients",
  "recipe.import.editor.steps.row.editSection": "Edit section",
  "recipe.import.editor.steps.row.delete": "Delete step",

  "recipe.import.editor.notes.title": "Notes",
  "recipe.import.editor.notes.hint": "Anything that doesn't belong in the steps – tips or variations, say.",
  "recipe.import.editor.notes.ariaLabel": "Notes",
  "recipe.import.editor.notes.placeholder": "Optional",

  /* ---------------------------------- errors --------------------------------------- */
  "recipe.import.error.network.title": "No connection to the server",
  "recipe.import.error.network.hint":
    "Check your internet connection. The import never started, so you can simply try again.",
  "recipe.import.error.unauthorized.title": "You're no longer signed in",
  "recipe.import.error.unauthorized.hint": "Your session has expired. Sign in again – your draft is safe.",
  "recipe.import.error.forbidden.title": "No access to this group",
  "recipe.import.error.forbidden.hint":
    "You aren't a member of the group you're importing into. Switch groups or ask for an invitation.",
  "recipe.import.error.notFound.title": "Draft not found",
  "recipe.import.error.notFound.hint":
    "This import draft no longer exists – it may already have been saved or discarded.",
  "recipe.import.error.tooLarge.title": "File too large",
  "recipe.import.error.tooLarge.hint":
    "The file is larger than 15 MB. Take a photo at a lower resolution, or shrink the PDF.",
  "recipe.import.error.unsupportedMediaType.title": "File type not supported",
  "recipe.import.error.unsupportedMediaType.hint": "Photos (JPEG, PNG, WebP, HEIC) and PDF files are allowed.",
  "recipe.import.error.pdfNoTextLayer.title": "PDF without a text layer",
  "recipe.import.error.pdfNoTextLayer.hint":
    "This PDF contains no readable text and couldn't be converted to images either. Please upload a photo of the page instead.",
  "recipe.import.error.ocrFailed.title": "Couldn't read any text",
  "recipe.import.error.ocrFailed.hint":
    "Text recognition found nothing in this image. Tips: shoot straight from above, good light, no shadows, whole page in frame.",
  "recipe.import.error.noRecipeData.title": "No recipe data found on this page",
  "recipe.import.error.noRecipeData.hint":
    "The page doesn't publish a machine-readable recipe. You can photograph it instead, or paste the text by hand.",
  "recipe.import.error.fetchFailed.title": "Couldn't load the page",
  "recipe.import.error.fetchFailed.hint":
    "The server couldn't fetch the URL (offline, sign-in required, or bot protection). Check the address, or import the page as a photo.",
  "recipe.import.error.ocrTimeout.title": "Text recognition took too long",
  "recipe.import.error.ocrTimeout.hint":
    "The server gave up. Try again with a smaller crop, or one photo per page.",
  "recipe.import.error.ocrTimeoutClient.hint":
    "The server didn't answer in time. Try again with one photo per page, or a smaller image.",
  "recipe.import.error.rateLimited.title": "Too many requests",
  "recipe.import.error.rateLimited.hint": "Please wait a moment, then try again.",
  "recipe.import.error.validation.title": "The data wasn't accepted",
  "recipe.import.error.validation.hint":
    "Please check the highlighted fields. A title is required, and amounts have to be numbers.",
  "recipe.import.error.server.title": "Server error",
  "recipe.import.error.server.hint": "Something went wrong on the server. Please try again in a moment.",
  "recipe.import.error.unknown.title": "Unexpected error",
  "recipe.import.error.unknown.hint": "Please try again. If it happens again, note down what you did.",
  "recipe.import.error.unexpected.hint": "Please try again.",
  "recipe.import.error.aborted.title": "Cancelled",
  "recipe.import.error.aborted.hint": "The operation was cancelled.",
  "recipe.import.error.noFiles.title": "No file selected",
  "recipe.import.error.noFiles.hint": "Please pick a photo or a file first.",
};
