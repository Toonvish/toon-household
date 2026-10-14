/**
 * Public surface of the import feature.
 *
 * Routes (mounted in router.tsx):
 *   /import            -> ImportPage
 *   /import/$draftId   -> ImportReviewPage
 *
 * The two screens are NOT re-exported here. `router.tsx` loads them with
 * `lazyRouteComponent(() => import(...))`; a static re-export that anything imports
 * would pull them into the main chunk and break the code splitting.
 */
export type { ImportReviewPageProps } from "./ImportReviewPage";

export { default as SourceViewer } from "./components/SourceViewer";
export { default as ParsedRecipeEditor } from "./components/ParsedRecipeEditor";
export { default as ConfidenceBadge } from "./components/ConfidenceBadge";
export { default as ImageCaptureButton } from "./components/ImageCaptureButton";
export { default as UploadProgress } from "./components/UploadProgress";
export { default as OcrProgressPanel } from "./components/OcrProgressPanel";
export { default as PendingDraftsList } from "./components/PendingDraftsList";
export { default as ImportErrorPanel } from "./components/ImportErrorPanel";

export { importKeys, useDraft, useDraftList, useHouseholdTags } from "./lib/queries";
