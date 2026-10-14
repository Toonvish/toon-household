/**
 * Open import drafts. An interrupted import (phone call during OCR, closed
 * tab) is never lost: the draft already exists server-side, so it can be resumed
 * from here.
 */
import clsx from "clsx";
import { Camera, FileText, Globe, PenLine, Trash2 } from "lucide-react";
import type { ImportDraft } from "@toon/shared";
import { formatRelative } from "@/modules/recipe/lib/format";
import { translate, useT } from "@/lib/i18n";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { resolveDescribedError } from "../lib/importErrorText";

export interface PendingDraftsListProps {
  drafts: readonly ImportDraft[];
  isLoading?: boolean;
  error?: unknown;
  onOpen: (draftId: string) => void;
  onDelete: (draftId: string) => void;
  deletingDraftId?: string;
  className?: string;
}

/**
 * A plain function, called from render (not a hook), so it resolves copy via
 * the ambient `translate()` rather than `useT()` — same convention as
 * `lib/confidence.ts` (docs/i18n.md §7/§10 rule 6: the accepted limitation is
 * that it renders the locale current at CALL time, picked up on the caller's
 * next re-render after a switch).
 */
export function describeDraftSource(draft: ImportDraft): { label: string; icon: typeof Camera } {
  const method = draft.sourceMeta?.method;
  if (draft.sourceType === "url") return { label: draft.sourceMeta?.host ?? translate("recipe.import.pendingDrafts.source.website"), icon: Globe };
  if (method === "pdf-text") return { label: translate("recipe.import.pendingDrafts.source.pdfText"), icon: FileText };
  if (method === "ocr") {
    const isPdf = typeof draft.sourceMeta?.mimeType === "string" && draft.sourceMeta.mimeType.includes("pdf");
    return {
      label: isPdf ? translate("recipe.import.pendingDrafts.source.pdfOcr") : translate("recipe.import.pendingDrafts.source.photoOcr"),
      icon: isPdf ? FileText : Camera,
    };
  }
  if (draft.sourceType === "manual") return { label: translate("recipe.import.pendingDrafts.source.manualText"), icon: PenLine };
  return { label: translate("recipe.import.pendingDrafts.source.fallback"), icon: FileText };
}

export function PendingDraftsList({
  drafts,
  isLoading = false,
  error,
  onOpen,
  onDelete,
  deletingDraftId,
  className,
}: PendingDraftsListProps) {
  const t = useT();
  if (isLoading) {
    return (
      <ul className={clsx("space-y-2", className)} aria-busy="true">
        {[0, 1].map((key) => (
          <li key={key} className="h-16 animate-pulse rounded-card bg-surface-2" />
        ))}
      </ul>
    );
  }

  if (error !== undefined && error !== null) {
    const described = resolveDescribedError(t, error);
    return (
      <div
        className={clsx(
          "rounded-xl border border-warning/40 bg-warning-soft p-3 text-sm",
          className,
        )}
      >
        <p className="font-medium text-warning-soft-fg">
          {t("recipe.import.pendingDrafts.loadError", { title: described.title })}
        </p>
        <p className="mt-1 text-xs text-warning-soft-fg">{described.hint}</p>
      </div>
    );
  }

  if (drafts.length === 0) return null;

  return (
    <ul className={clsx("space-y-2", className)}>
      {drafts.map((draft) => {
        const source = describeDraftSource(draft);
        const Icon = source.icon;
        const title = (draft.parsed.title ?? "").trim();
        const isDeleting = deletingDraftId === draft.id;
        return (
          <li
            key={draft.id}
            className="flex items-center gap-3 rounded-card border border-line bg-surface p-3"
          >
            <Icon aria-hidden className="h-5 w-5 shrink-0 text-fg-subtle" />
            <button
              type="button"
              onClick={() => onOpen(draft.id)}
              className="min-w-0 flex-1 text-left"
              aria-label={t("recipe.import.pendingDrafts.openLabel", {
                title: title.length > 0 ? title : t("recipe.import.pendingDrafts.untitledLower"),
              })}
            >
              <span className="flex flex-wrap items-center gap-2">
                <span className="truncate font-display text-display-sm font-medium text-fg">
                  {title.length > 0 ? title : t("recipe.import.pendingDrafts.untitled")}
                </span>
                <ConfidenceBadge value={draft.confidence ?? draft.parsed.confidence.overall} />
              </span>
              <span className="mt-0.5 block truncate text-xs text-fg-muted">
                {t("recipe.import.pendingDrafts.summary", {
                  source: source.label,
                  ingredients: draft.parsed.ingredients.length,
                  steps: draft.parsed.steps.length,
                  date: formatRelative(draft.updatedAt),
                })}
              </span>
            </button>
            <button
              type="button"
              onClick={() => onDelete(draft.id)}
              disabled={isDeleting}
              aria-label={t("recipe.import.pendingDrafts.deleteLabel")}
              title={t("recipe.import.pendingDrafts.deleteLabel")}
              className="shrink-0 rounded-md p-2 text-fg-subtle transition hover:bg-danger-soft hover:text-danger disabled:opacity-40"
            >
              <Trash2 aria-hidden className="h-4 w-4" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export default PendingDraftsList;
