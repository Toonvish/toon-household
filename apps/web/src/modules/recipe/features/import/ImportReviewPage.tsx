/**
 * /import/:draftId — the review screen.
 *
 * OCR is never perfect, so this is the screen that decides whether importing is
 * pleasant or painful:
 *   - source on the left / parsed fields on the right (tabs on mobile),
 *   - "bitte prüfen" flags from the per-field confidence,
 *   - bulk fixers that turn raw lines into ingredients or steps,
 *   - autosave (~1s debounced PATCH) so a phone interruption loses nothing,
 *   - explicit German handling for every API failure.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import clsx from "clsx";
import { ArrowLeft, Check, CircleAlert, FileText, LoaderCircle, PenLine, Save, Trash2, TriangleAlert, Users } from "lucide-react";
import type { ParsedRecipe } from "@toon/shared";
import { PhoneHeaderRow } from "@/components/layout/PhoneHeaderRow";
import { Tabs } from "@/components/ui";
import { useT } from "@/lib/i18n";
import {
  Button,
  ConfirmDialog,
  Label,
  Select,
  readChangeValue,
  useActiveHouseholdState,
  useImportAvailability,
  useShellToast,
} from "./lib/shell";
import { useDraftIdFromRoute, useImportNavigation } from "./lib/navigation";
import { useCommitDraft, useDeleteDraft, useDraft, useHouseholdTags } from "./lib/queries";
import { useDraftAutosave } from "./lib/useAutosave";
import { appendIngredientFromLine, appendStepFromLine, normalizeParsedRecipe, validateForCommit } from "./lib/draftEdit";
import { CONFIDENCE_WARN, countRowsNeedingCheck, formatConfidence } from "./lib/confidence";
import { resolveDescribedError } from "./lib/importErrorText";
import SourceViewer from "./components/SourceViewer";
import ParsedRecipeEditor from "./components/ParsedRecipeEditor";
import ImportErrorPanel from "./components/ImportErrorPanel";
import { describeDraftSource } from "./components/PendingDraftsList";

export interface ImportReviewPageProps {
  /** Optional override when the route param is named differently. */
  draftId?: string;
}

type MobileTab = "source" | "form";

export default function ImportReviewPage({ draftId: draftIdProp }: ImportReviewPageProps = {}) {
  const t = useT();
  const draftId = useDraftIdFromRoute(draftIdProp);
  const navigation = useImportNavigation();
  const toast = useShellToast();
  const offline = useImportAvailability();
  const { householdId: activeHouseholdId, households, switchHousehold } = useActiveHouseholdState();

  const candidateHouseholdIds = useMemo(() => {
    const ids: string[] = [];
    if (typeof activeHouseholdId === "string" && activeHouseholdId.length > 0) ids.push(activeHouseholdId);
    for (const household of households) if (!ids.includes(household.id)) ids.push(household.id);
    return ids;
  }, [activeHouseholdId, households]);

  const draftQuery = useDraft(draftId, candidateHouseholdIds);
  const draft = draftQuery.data?.draft;
  const draftHouseholdId = draftQuery.data?.householdId;

  const tagsQuery = useHouseholdTags(draftHouseholdId);
  const tagSuggestions = useMemo(() => (tagsQuery.data ?? []).map((tag) => tag.name), [tagsQuery.data]);

  const [parsed, setParsed] = useState<ParsedRecipe | undefined>(undefined);
  const [loadedDraftId, setLoadedDraftId] = useState<string | undefined>(undefined);
  const [mobileTab, setMobileTab] = useState<MobileTab>("form");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [commitError, setCommitError] = useState<unknown>(undefined);

  // Adopt the server payload exactly once per draft, so autosave never fights typing.
  useEffect(() => {
    if (draft === undefined) return;
    if (loadedDraftId === draft.id) return;
    setParsed(normalizeParsedRecipe(draft.parsed));
    setLoadedDraftId(draft.id);
  }, [draft, loadedDraftId]);

  const autosave = useDraftAutosave({
    householdId: draftHouseholdId,
    draftId: draft?.id,
    value: parsed,
    baseline: draft?.parsed,
    enabled: draft !== undefined && draft.status === "pending",
  });

  const commit = useCommitDraft();
  const remove = useDeleteDraft();

  const validation = useMemo(
    () => (parsed === undefined ? { ok: false, problems: [], warnings: [] } : validateForCommit(parsed)),
    [parsed],
  );
  const rowChecks = useMemo(
    () => (parsed === undefined ? { ingredients: 0, steps: 0 } : countRowsNeedingCheck(parsed)),
    [parsed],
  );

  const handleSave = useCallback(async () => {
    if (parsed === undefined || draft === undefined || draftHouseholdId === undefined) return;
    setCommitError(undefined);
    const normalized = normalizeParsedRecipe(parsed);
    const check = validateForCommit(normalized);
    if (!check.ok) {
      toast({ title: check.problems[0] ?? t("recipe.import.review.toast.saveFallback"), variant: "error" });
      setMobileTab("form");
      return;
    }
    try {
      await autosave.saveNow();
      const response = await commit.mutateAsync({
        householdId: draftHouseholdId,
        draftId: draft.id,
        parsed: normalized,
        tags: normalized.tags,
      });
      toast({ title: t("recipe.import.review.toast.saved.title"), description: response.recipe.title, variant: "success" });
      navigation.toRecipe(response.recipe.id, { replace: true });
    } catch (error) {
      setCommitError(error);
    }
  }, [autosave, commit, draft, draftHouseholdId, navigation, parsed, t, toast]);

  const handleDiscard = useCallback(() => {
    if (draft === undefined || draftHouseholdId === undefined) return;
    setConfirmOpen(false);
    remove.mutate(
      { householdId: draftHouseholdId, draftId: draft.id },
      {
        onSuccess: () => {
          toast({ title: t("recipe.import.review.toast.discarded.title"), variant: "info" });
          navigation.toImport({ replace: true });
        },
        onError: (error) => {
          const described = resolveDescribedError(t, error);
          toast({ title: described.title, description: described.hint, variant: "error" });
        },
      },
    );
  }, [draft, draftHouseholdId, navigation, remove, t, toast]);

  const addLineAsIngredient = useCallback((line: string) => {
    setParsed((current) => (current === undefined ? current : appendIngredientFromLine(current, line)));
  }, []);

  const addLineAsStep = useCallback((line: string) => {
    setParsed((current) => (current === undefined ? current : appendStepFromLine(current, line)));
  }, []);

  /* ------------------------------ load states ----------------------------- */

  if (draftId === undefined) {
    return (
      <PageShell onBack={() => navigation.toImport()}>
        <ImportErrorPanel
          error={new Error(t("recipe.import.review.noDraft"))}
          actions={
            <Button type="button" variant="secondary" onClick={() => navigation.toImport()}>
              {t("recipe.import.review.toImport")}
            </Button>
          }
        />
      </PageShell>
    );
  }

  if (draftQuery.isLoading) {
    return (
      <PageShell onBack={() => navigation.toImport()}>
        <div className="space-y-3" aria-busy="true">
          <div className="h-8 w-2/3 animate-pulse rounded bg-skeleton" />
          <div className="h-56 animate-pulse rounded-xl bg-surface-2" />
          <div className="h-72 animate-pulse rounded-xl bg-surface-2" />
        </div>
      </PageShell>
    );
  }

  if (draftQuery.isError || draft === undefined || draftHouseholdId === undefined || parsed === undefined) {
    return (
      <PageShell onBack={() => navigation.toImport()}>
        <ImportErrorPanel
          error={draftQuery.error ?? new Error(t("recipe.import.review.loadError"))}
          onRetry={() => void draftQuery.refetch()}
          actions={
            <Button type="button" variant="secondary" onClick={() => navigation.toImport()}>
              {t("recipe.import.review.toOverview")}
            </Button>
          }
        />
      </PageShell>
    );
  }

  const overall = draft.confidence ?? parsed.confidence.overall;
  const source = describeDraftSource(draft);
  const SourceIcon = source.icon;
  const groupMismatch = activeHouseholdId !== undefined && activeHouseholdId !== draftHouseholdId;
  const householdOfDraft = households.find((household) => household.id === draftHouseholdId);
  const committed = draft.status === "reviewed" && typeof draft.recipeId === "string";

  return (
    <PageShell onBack={() => navigation.toImport()}>
      {/* ------------------------------ header ------------------------------ */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <SourceIcon aria-hidden className="h-4 w-4 text-fg-subtle" />
          <span className="text-xs text-fg-muted">{source.label}</span>
          <span className="text-xs text-fg-subtle">·</span>
          <span className="text-xs text-fg-muted">{t("recipe.import.review.quality", { value: formatConfidence(overall) })}</span>
          <span className="ml-auto flex items-center gap-1.5 text-xs">
            {autosave.state === "saving" ? (
              <LoaderCircle aria-hidden className="h-3.5 w-3.5 animate-spin text-fg-subtle" />
            ) : autosave.state === "saved" ? (
              <Check aria-hidden className="h-3.5 w-3.5 text-brand" />
            ) : autosave.state === "error" ? (
              <CircleAlert aria-hidden className="h-3.5 w-3.5 text-danger" />
            ) : (
              <PenLine aria-hidden className="h-3.5 w-3.5 text-fg-subtle" />
            )}
            <span
              className={clsx(
                autosave.state === "error" ? "text-danger" : "text-fg-muted",
              )}
            >
              {autosave.label}
            </span>
          </span>
        </div>

        <h1 className="font-display text-display-xl font-medium text-fg text-balance">
          {(parsed.title ?? "").trim().length > 0 ? parsed.title : t("recipe.import.review.title.fallback")}
        </h1>
      </div>

      {autosave.state === "error" ? (
        <div className="rounded-xl border border-danger/40 bg-danger-soft p-3 text-xs">
          <p className="font-medium text-danger-soft-fg">{t("recipe.import.review.autosaveError.title")}</p>
          <p className="mt-1 text-danger-soft-fg">{autosave.errorHint}</p>
          <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={() => void autosave.saveNow()}>
            {t("recipe.import.review.autosaveError.retry")}
          </Button>
        </div>
      ) : null}

      {committed ? (
        <div className="rounded-xl border border-success/40 bg-brand-soft p-3 text-xs">
          <p className="font-medium text-success-soft-fg">{t("recipe.import.review.committed.title")}</p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mt-2"
            onClick={() => navigation.toRecipe(String(draft.recipeId))}
          >
            {t("recipe.import.review.committed.open")}
          </Button>
        </div>
      ) : null}

      {groupMismatch ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-warning/40 bg-warning-soft p-3 text-xs">
          <Users aria-hidden className="h-4 w-4 text-warning" />
          <span className="text-warning-soft-fg">
            {t("recipe.import.review.groupMismatch.text", {
              groupName: householdOfDraft?.name ?? t("recipe.import.review.groupMismatch.fallbackName"),
            })}
          </span>
          <Button type="button" variant="secondary" size="sm" onClick={() => switchHousehold(draftHouseholdId)}>
            {t("recipe.import.review.groupMismatch.switch")}
          </Button>
        </div>
      ) : null}

      {households.length > 1 && !groupMismatch ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
          <Label htmlFor="review-group" className="text-xs">
            {t("recipe.import.common.targetGroup")}
          </Label>
          <Select
            id="review-group"
            containerClassName="min-w-40"
            value={draftHouseholdId}
            options={households.map((household) => ({ value: household.id, label: household.name }))}
            onChange={(event) => {
              const next = readChangeValue(event);
              // The draft itself cannot be moved between households by the API, so we
              // only switch the app's active household and say so.
              switchHousehold(next);
              if (next !== draftHouseholdId) {
                toast({
                  title: t("recipe.import.review.groupStays.title"),
                  description: t("recipe.import.review.groupStays.description"),
                  variant: "info",
                });
              }
            }}
          />
        </div>
      ) : null}

      {overall < CONFIDENCE_WARN ? (
        <div className="flex gap-2 rounded-xl border border-warning/40 bg-warning-soft p-3">
          <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div className="text-xs leading-5 text-warning-soft-fg">
            <p className="font-medium">{t("recipe.import.review.lowConfidence.title")}</p>
            <p>
              {t("recipe.import.review.lowConfidence.hint")}
              {rowChecks.ingredients + rowChecks.steps > 0
                ? ` ${t("recipe.import.review.lowConfidence.countHint", {
                    ingredients: rowChecks.ingredients,
                    steps: rowChecks.steps,
                  })}`
                : ""}
            </p>
          </div>
        </div>
      ) : null}

      {/* ------------------------- mobile tab switch -----------------------
          `Tabs` (components/ui), not the hand-rolled `TabButton` this screen used
          to carry — same segmented control as every other tab strip in the app. */}
      <Tabs
        className="lg:hidden"
        aria-label={t("recipe.import.review.tabs.ariaLabel")}
        value={mobileTab}
        onChange={setMobileTab}
        items={[
          {
            value: "source",
            label: t("recipe.import.review.tabs.source"),
            icon: <FileText aria-hidden className="h-3.5 w-3.5" />,
          },
          {
            value: "form",
            label: t("recipe.import.review.tabs.form"),
            icon: <PenLine aria-hidden className="h-3.5 w-3.5" />,
            badge: rowChecks.ingredients + rowChecks.steps > 0 ? rowChecks.ingredients + rowChecks.steps : undefined,
          },
        ]}
      />

      {/* ------------------------------ panes ------------------------------ */}
      {/* `min-w-0` on both panes: a grid item's automatic minimum is its content's
          min-content width, so one wide child (a form row, a long raw-text line) would
          otherwise stretch the track past the viewport instead of wrapping. */}
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <div className={clsx("min-w-0 lg:sticky lg:top-4", mobileTab === "source" ? "block" : "hidden lg:block")}>
          <SourceViewer draft={draft} onLineToIngredient={addLineAsIngredient} onLineToStep={addLineAsStep} />
        </div>
        <div className={clsx("min-w-0", mobileTab === "form" ? "block" : "hidden lg:block")}>
          <ParsedRecipeEditor value={parsed} onChange={setParsed} tagSuggestions={tagSuggestions} />
        </div>
      </div>

      {commitError !== undefined ? (
        <ImportErrorPanel error={commitError} onRetry={() => void handleSave()} retryLabel={t("recipe.import.review.retrySave")} />
      ) : null}

      {validation.warnings.length > 0 ? (
        <p className="text-xs text-fg-muted">{validation.warnings.join(" ")}</p>
      ) : null}

      {/*
        ------------------------------ footer -----------------------------
        `sticky bottom-tabbar`, NOT `fixed bottom-0`: the phone tab bar is fixed at
        `bottom-0` with the same z-index and paints after this (AppShell renders it
        below <main>), so `bottom-0` put "Speichern" and "Verwerfen" completely
        underneath it — the import could not be committed on a phone at all. Sticky
        also keeps the bar in flow, so `pb-tabbar` on AppShell's <main> is all the
        clearance the content needs. Same pattern as the shopping list's AddItemBar.
      */}
      <div className="sticky bottom-tabbar z-20 -mx-4 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-surface/80 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0 lg:py-0">
        <div className="mx-auto flex max-w-content items-center gap-2 px-safe">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setConfirmOpen(true)}
            disabled={remove.isPending || commit.isPending}
          >
            <Trash2 aria-hidden className="mr-1.5 h-4 w-4" />
            {t("recipe.import.review.discard")}
          </Button>
          <span className="hidden flex-1 text-xs text-fg-muted sm:block">
            {offline.enabled
              ? validation.ok
                ? autosave.label
                : (validation.problems[0] ?? "")
              : offline.reason}
          </span>
          <Button
            type="button"
            className="ml-auto flex-1 sm:flex-none"
            onClick={() => void handleSave()}
            // Offline the commit would fail after the whole review was typed, and
            // the autosave PATCH cannot land either — the offline support here is
            // read-only on purpose (see lib/persist.ts).
            disabled={commit.isPending || !validation.ok || !offline.enabled}
            title={offline.reason}
          >
            {commit.isPending ? (
              <LoaderCircle aria-hidden className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save aria-hidden className="mr-2 h-4 w-4" />
            )}
            {commit.isPending ? t("recipe.import.review.saving") : t("recipe.import.review.save")}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={t("recipe.import.review.discardDialog.title")}
        description={t("recipe.import.review.discardDialog.description")}
        message={t("recipe.import.review.discardDialog.message")}
        confirmLabel={t("recipe.import.review.discardDialog.confirm")}
        cancelLabel={t("recipe.import.review.discardDialog.cancel")}
        destructive
        variant="danger"
        onConfirm={handleDiscard}
        onCancel={() => setConfirmOpen(false)}
        onClose={() => setConfirmOpen(false)}
        onOpenChange={(open) => {
          if (!open) setConfirmOpen(false);
        }}
      />
    </PageShell>
  );
}

/**
 * No `mx-auto max-w-content px-gutter pt-4 pb-tabbar` here: AppShell's `<main>` already
 * applies every one of those, so this screen is full-bleed within it rather than
 * re-narrowing to `max-w-3xl` the way `ImportPage`'s single-column forms do — the
 * two-pane source/parsed layout wants the shell's full width from `lg`. Repeating
 * the shell's classes cost a phone 32px of the 390 it has — the reason the
 * Grunddaten card did not fit — and doubled the bottom padding. The sticky
 * footer's own inner wrapper carries `max-w-content` again for the opposite
 * reason: `-mx-4` bleeds it past `<main>`'s own `px-gutter`, so it has no
 * ambient width constraint left to inherit and has to restate the shell's
 * measure itself — it used to say `max-w-5xl`, which quietly drifted from the
 * shell's `max-w-content` and went uncaught because both read as "wide enough"
 * until you diff the two values on a desktop screen.
 */
function PageShell({ children, onBack }: { children: ReactNode; onBack: () => void }) {
  const t = useT();
  return (
    <div className="space-y-4">
      <PhoneHeaderRow />
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg"
      >
        <ArrowLeft aria-hidden className="h-4 w-4" />
        {t("recipe.import.review.back")}
      </button>
      {children}
    </div>
  );
}
