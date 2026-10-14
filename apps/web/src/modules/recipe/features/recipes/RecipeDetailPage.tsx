/**
 * RecipeDetailPage.
 *
 * Two markup branches on `useIsWideViewport()` (A04 §5 desktop / §6 mobile) —
 * never both at once, per the viewport-switch gotcha. Everything the two branches
 * share — data, mutations, derived values — is computed once above the branch;
 * only the JSX forks.
 *
 * Key interactions:
 *  - SERVINGS SCALER: rescales every quantity live with `scaleIngredients` from
 *    @toon/shared (the exact function the API's /scale endpoint uses) and renders nice
 *    fractions via `formatQuantity`.
 *  - COOK MODE: full-screen, large-type step-by-step view with a screen wake lock.
 *  - Actions live in ONE overflow `ActionMenu` — edit, share (navigator.share +
 *    clipboard fallback), copy, print (print.css), duplicate, delete (ConfirmDialog).
 *  - "Gekocht" (R18): POSTs the cook log, then becomes "Rückgängig" for
 *    `COOK_UNDO_WINDOW_MS` — both the button AND the success toast's action slot
 *    call the same undo, so the affordance survives the toast timing out.
 *  - Both detail panels (Ingredients/Method) stay mounted on the phone branch and
 *    are toggled with the `hidden` attribute under the segmented `Tabs` control,
 *    never a conditional render — printing from a phone must still print both.
 */
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  ChefHat,
  Check,
  Copy,
  ExternalLink,
  Pencil,
  Play,
  Printer,
  RotateCcw,
  Share2,
  ShoppingBasket,
  Star,
  Trash2,
  UtensilsCrossed,
} from "lucide-react";
import {
  addPlanDays,
  isPlanDate,
  planWeek,
  scaleIngredients,
  startOfPlanWeek,
  todayPlanDate,
  type RecipeDetail,
} from "@toon/shared";
import {
  ActionMenu,
  type ActionMenuItem,
  Badge,
  Button,
  Card,
  Chip,
  ConfirmDialog,
  Dialog,
  ErrorState,
  Input,
  LoadingBlock,
  Tabs,
  buttonClasses,
  useToast,
} from "@/components/ui";
import { markRecipeCooked, mediaUrl } from "@/modules/recipe/lib/api";
import { invalidate } from "@/modules/recipe/lib/queries";
import {
  formatDayOfMonth,
  formatPlanDateNear,
  formatRelative,
  formatWeekdayShort,
  hostFromUrl,
  safeHttpUrl,
} from "@/modules/recipe/lib/format";
import { storageKeys, writeStorage } from "@/lib/storage";
import { DIFFICULTY_LABEL_KEYS } from "./lib/difficultyLabels";
import { useT } from "@/lib/i18n";
import {
  useActiveHousehold,
  useCanMutate,
  useCurrentUser,
  useEmailVerificationBlock,
  useSession,
} from "@/lib/session";
import { useIsWideViewport } from "@/lib/viewport";
import "./print.css";
import { AppLink, useAppNavigate, useRouteParam } from "@/lib/nav";
import { canModifyOwn } from "./lib/permissions";
import { useCheckedSteps } from "./lib/hooks";
import { copyToClipboard, shareOrCopy } from "@/lib/share";
import { recipeToPlainText } from "./lib/format";
import {
  duplicatePayload,
  useCreateRecipe,
  useDeleteRecipe,
  useRecipe,
} from "./lib/queries";
import { IngredientList } from "./components/IngredientList";
import { StepList } from "./components/StepList";
import { ServingsScaler } from "./components/ServingsScaler";
import { CookMode } from "./components/CookMode";
import { CourseEyebrow } from "./components/CourseEyebrow";
import { RecipeStatRow } from "./components/RecipeStatRow";
import { RecipeHeroMobile } from "./components/RecipeHeroMobile";
import { RecipeDetailBottomBar } from "./components/RecipeDetailBottomBar";
import { AddRecipeToListDialog } from "@/modules/recipe/features/shopping/components/AddRecipeToListDialog";
import {
  useAddRecipeToShoppingList,
  useCreateShoppingList,
  useShoppingLists,
} from "@/modules/recipe/features/shopping/lib/queries";
import { useLastPlanned, usePlanEntryCreate, usePlanEntryCookedUndo } from "@/modules/recipe/features/plan/lib/queries";

/**
 * Mirrors the server's `COOK_UNDO_WINDOW_MS` (`apps/api/src/services/recipes/cookLog.ts`,
 * same duplication as `PlanDayCard.tsx` — there is no shared constant to import). Only
 * the CALLER's own most recent tap, tracked locally: the server enforces "own row"
 * independently, this just decides when the button/toast offer the undo at all.
 */
const COOK_UNDO_WINDOW_MS = 10 * 60 * 1000;

export default function RecipeDetailPage() {
  const t = useT();
  const recipeId = useRouteParam("recipeId");
  // The two mutation hooks below have to be called unconditionally (rules of
  // hooks), i.e. above the loading/error early-returns, before `recipe.id` (the
  // narrowed, guaranteed-present value) exists — this is the same route param,
  // just with the fallback the API calls already need at that point.
  const safeRecipeId = recipeId ?? "";
  const { householdId, role } = useActiveHousehold();
  const { isOnline } = useSession();
  const unverified = useEmailVerificationBlock();
  const { canMutate, reason: mutateReason } = useCanMutate();
  const user = useCurrentUser();
  const navigate = useAppNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const wide = useIsWideViewport();

  const query = useRecipe(householdId, recipeId);
  const loaded = query.data;

  const deleteRecipe = useDeleteRecipe(householdId);
  const createRecipe = useCreateRecipe(householdId);
  const undoCooked = usePlanEntryCookedUndo(householdId ?? "");
  // "Zuletzt geplant", counting today: `before` is exclusive, so ask for tomorrow.
  const today = todayPlanDate();
  const lastPlannedOn = useLastPlanned(householdId ?? null, addPlanDays(today, 1)).data?.get(safeRecipeId);
  const lastPlannedLine = lastPlannedOn ? (
    <p className="text-xs text-fg-subtle">
      {t("recipe.plan.lastPlanned", { date: formatPlanDateNear(lastPlannedOn, today) })}
    </p>
  ) : null;

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [cookMode, setCookMode] = useState(false);
  const [servingsOverride, setServingsOverride] = useState<number | null>(null);
  const [shoppingOpen, setShoppingOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"ingredients" | "steps">("ingredients");
  // Own-tap undo window (R18): only this session's own successful "Gekocht" tap
  // offers the undo affordance — the server enforces "own row" separately.
  const [cookedJustNowAt, setCookedJustNowAt] = useState<number | null>(null);

  // "Zur Einkaufsliste" always goes through `AddRecipeToListDialog` — never a one-tap
  // add to a remembered list — so the cook can untick the salt and the olive oil
  // before anything lands on the list. Loaded up front so the dialog opens with
  // its list picker already filled.
  const shoppingLists = useShoppingLists(householdId);
  const addToShoppingList = useAddRecipeToShoppingList();
  // A household with no list at all would make "Zur Einkaufsliste" a dead end, so the
  // dialog can create the first one.
  const createShoppingList = useCreateShoppingList(householdId);

  const checked = useCheckedSteps(recipeId);

  const baseServings =
    typeof loaded?.servingsAmount === "number" && loaded.servingsAmount > 0
      ? loaded.servingsAmount
      : null;
  const servings = servingsOverride ?? baseServings ?? 1;
  const factor = baseServings ? servings / baseServings : 1;

  /**
   * Local scaling: `scaleIngredients` throws RangeError for factor <= 0, which the
   * stepper can never produce (it clamps at 0.5), but guard anyway.
   */
  const scaledIngredients = useMemo(() => {
    if (!loaded) return [];
    if (!baseServings || Math.abs(factor - 1) < 0.0001) return loaded.ingredients;
    try {
      return scaleIngredients(loaded.ingredients, factor, { keepNonScalingUnits: true });
    } catch {
      return loaded.ingredients;
    }
  }, [loaded, baseServings, factor]);

  function runUndoCooked() {
    undoCooked.mutate(
      { recipeId: safeRecipeId },
      {
        onSuccess: async () => {
          setCookedJustNowAt(null);
          await invalidate.recipe(qc, householdId ?? "", safeRecipeId);
          toast.success(t("recipe.recipes.detail.cookedUndoneToast"));
        },
      },
    );
  }

  const markCooked = useMutation({
    mutationFn: () => markRecipeCooked(householdId ?? "", safeRecipeId, {}),
    onSuccess: async () => {
      setCookedJustNowAt(Date.now());
      await invalidate.recipe(qc, householdId ?? "", safeRecipeId);
      toast.toast({
        title: t("recipe.recipes.detail.cookedToast"),
        variant: "success",
        action: { label: t("recipe.recipes.detail.cookedUndo"), onClick: runUndoCooked },
      });
    },
    onError: (error) => toast.fromError(error, t("recipe.recipes.detail.cookedFailedToast")),
  });

  const cookedRecently =
    cookedJustNowAt != null && Date.now() - cookedJustNowAt < COOK_UNDO_WINDOW_MS;

  if (query.isPending) return <LoadingBlock label={t("recipe.recipes.detail.loading")} />;

  if (query.isError || !loaded) {
    return (
      <ErrorState
        error={query.error}
        onRetry={() => void query.refetch()}
        action={
          <AppLink to="/recipe" className={buttonClasses({ variant: "secondary" })}>
            {t("recipe.recipes.action.backToList")}
          </AppLink>
        }
      />
    );
  }

  // Non-optional alias so the async callbacks below close over a narrowed value.
  const recipe: RecipeDetail = loaded;

  // Role AND a confirmed e-mail address: an unconfirmed one makes the whole
  // account read-only (lib/session.tsx), so Bearbeiten/Duplizieren/Löschen go
  // with it — offering them would only produce a 403 after the confirm dialog.
  // Deliberately NOT `useCanMutate()`, which also reports false offline: this
  // screen has always kept its edit entry point visible without a signal, and the
  // form itself is what refuses to save there.
  const canEdit = canModifyOwn(role, user.id, recipe.createdBy) && unverified === undefined;
  const image = mediaUrl(recipe.imageUrl);
  const host = hostFromUrl(recipe.sourceUrl);
  // Never render a server-supplied link straight into an href — see safeHttpUrl.
  const sourceHref = safeHttpUrl(recipe.sourceUrl);
  const scaled = Math.abs(factor - 1) > 0.0001;
  // The quiet tag line under the desktop h1 (A04 §5 item 1) shows the ordinary
  // tags, not the course one CourseEyebrow already draws above the title.
  const freeTags = recipe.tags.filter((tag) => tag.kind === "free");

  const plainText = () =>
    recipeToPlainText({
      title: recipe.title,
      description: recipe.description,
      servingsAmount: servings,
      servingsUnit: recipe.servingsUnit,
      totalMinutes: recipe.totalMinutes,
      ingredients: scaledIngredients,
      steps: recipe.steps,
      notes: recipe.notes,
      sourceUrl: recipe.sourceUrl,
    });

  async function share() {
    const result = await shareOrCopy({
      title: recipe.title,
      text: plainText(),
      url: window.location.href,
    });
    if (result === "copied") toast.success(t("recipe.recipes.detail.shareCopiedToast"));
    else if (result === "unavailable") toast.error(t("recipe.recipes.detail.shareUnavailableToast"));
  }

  async function copyIngredients() {
    const lines = plainText();
    const ok = await copyToClipboard(lines);
    if (ok) {
      toast.success(
        t("recipe.recipes.detail.copiedToast"),
        scaled ? t("recipe.recipes.detail.copiedScaledDetail", { servings }) : undefined,
      );
    } else toast.error(t("recipe.recipes.detail.copyUnavailableToast"));
  }

  async function duplicate() {
    try {
      const copy = await createRecipe.mutateAsync(duplicatePayload(recipe));
      toast.success(t("recipe.recipes.detail.duplicatedToast"), copy.title);
      navigate({ to: "/recipe/recipes/$recipeId", params: { recipeId: copy.id } });
    } catch (error) {
      toast.fromError(error, t("recipe.recipes.detail.duplicateFailedToast"));
    }
  }

  const actionMenuItems: Array<ActionMenuItem | null | false | undefined> = [
    canEdit && {
      label: t("recipe.recipes.detail.actions.edit"),
      icon: <Pencil />,
      onSelect: () => {
        void navigate({ to: "/recipe/recipes/$recipeId/edit", params: { recipeId: recipe.id } });
      },
    },
    // The phone has no header rail, so the plan action lives in its menu — the
    // desktop shows the header button instead. Same `useCanMutate()` gate as that
    // button (online-only write, see the two-gates note in CLAUDE.md).
    !wide && {
      label: t("recipe.recipes.detail.planDayAction"),
      description: canMutate ? undefined : mutateReason,
      icon: <CalendarDays />,
      disabled: !canMutate,
      onSelect: () => setPlanOpen(true),
    },
    {
      label: t("recipe.recipes.detail.actions.share"),
      icon: <Share2 />,
      onSelect: () => void share(),
    },
    {
      label: t("recipe.recipes.detail.actions.copyText"),
      icon: <Copy />,
      onSelect: () => void copyIngredients(),
    },
    {
      label: t("recipe.recipes.detail.actions.print"),
      icon: <Printer />,
      onSelect: () => window.print(),
    },
    {
      label: t("recipe.recipes.detail.actions.duplicate"),
      // The menu closes on select, so `isPending` is no longer visible —
      // disabling is what keeps a second tap from creating a second copy.
      description: createRecipe.isPending ? t("recipe.recipes.detail.actions.duplicating") : undefined,
      icon: <ChefHat />,
      disabled: createRecipe.isPending,
      onSelect: () => void duplicate(),
    },
    canEdit && {
      label: t("recipe.recipes.detail.actions.delete"),
      icon: <Trash2 />,
      variant: "danger" as const,
      onSelect: () => setConfirmDelete(true),
    },
  ];

  const ratingDifficultyBadges =
    recipe.difficulty || (typeof recipe.rating === "number" && recipe.rating > 0) ? (
      <ul className="flex flex-wrap items-center gap-1.5">
        {recipe.difficulty ? (
          <li>
            <Badge variant="accent">{t(DIFFICULTY_LABEL_KEYS[recipe.difficulty])}</Badge>
          </li>
        ) : null}
        {typeof recipe.rating === "number" && recipe.rating > 0 ? (
          <li>
            <Badge variant="warning" icon={<Star className="fill-current" />}>
              {recipe.rating} / 5
            </Badge>
          </li>
        ) : null}
      </ul>
    ) : null;

  const notesCard = recipe.notes ? (
    <Card padding="md" className="rounded-2xl">
      <h2 className="mb-2 font-display text-lg font-medium">{t("recipe.recipes.detail.notesHeading")}</h2>
      <p className="leading-relaxed whitespace-pre-line text-fg-muted">{recipe.notes}</p>
    </Card>
  ) : null;

  // A licence-adjacent obligation on an imported recipe — must survive on every
  // breakpoint, and still only ever an href that passed safeHttpUrl().
  const sourceCard =
    sourceHref || recipe.sourceName ? (
      <Card padding="md" className="rounded-2xl">
        <h2 className="mb-1 text-sm font-semibold tracking-wide text-fg-muted uppercase">
          {t("recipe.recipes.detail.sourceHeading")}
        </h2>
        {sourceHref ? (
          <a
            href={sourceHref}
            target="_blank"
            rel="noreferrer noopener"
            data-print-url=""
            className="inline-flex items-center gap-1.5 font-medium text-brand hover:text-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {recipe.sourceName ?? host ?? sourceHref}
            <ExternalLink aria-hidden="true" className="size-4" />
          </a>
        ) : (
          <p className="text-fg">{recipe.sourceName}</p>
        )}
      </Card>
    ) : null;

  const cookedButtonProps = {
    disabled: !canMutate || markCooked.isPending || undoCooked.isPending,
    title: mutateReason,
    onClick: cookedRecently ? runUndoCooked : () => markCooked.mutate(),
  };

  return (
    <article className="recipe-print flex flex-1 flex-col gap-4">
      {wide ? (
        <>
          {/* HEADER RAIL — bleeds to <main>'s edges, sits flush under the shell. The
              negative top margin has to MATCH <main>'s own top padding, which is
              `pt-4 lg:pt-8`: this branch flips at `sm` (640px), so a flat `-mt-8`
              would overshoot by 1rem for every viewport between 640 and 1024. */}
          <div className="bleed-gutter-inset -mt-4 flex items-center gap-2.5 border-b border-surface-2 py-3.5 lg:-mt-8">
            <nav aria-label={t("recipe.recipes.list.title")} className="flex min-w-0 items-baseline gap-2 text-[13px] text-fg-subtle">
              <AppLink to="/recipe" className="hover:text-fg">
                {t("recipe.recipes.list.title")}
              </AppLink>
              <span aria-hidden="true">/</span>
              <span className="min-w-0 truncate text-fg-muted">{recipe.title}</span>
            </nav>
            <div data-print="hide" className="ml-auto flex shrink-0 gap-2">
              <Button
                variant="outline"
                size="sm"
                className="min-h-[38px]"
                leftIcon={<CalendarDays className="size-4" />}
                disabled={!canMutate}
                title={mutateReason}
                onClick={() => setPlanOpen(true)}
              >
                {t("recipe.recipes.detail.planDayAction")}
              </Button>
              <Button
                variant="success"
                size="sm"
                leftIcon={
                  cookedRecently ? (
                    <RotateCcw className="size-4" />
                  ) : (
                    <Check className="size-4" />
                  )
                }
                {...cookedButtonProps}
              >
                {cookedRecently ? t("recipe.recipes.detail.cookedUndo") : t("recipe.recipes.detail.cookedAction")}
              </Button>
              <ActionMenu
                label={t("recipe.recipes.detail.actionsMenuLabel")}
                title={recipe.title}
                items={actionMenuItems}
              />
            </div>
          </div>

          {/* HERO ROW */}
          <div className="grid grid-cols-[minmax(0,1fr)_420px] items-start gap-9">
            <div className="flex min-w-0 flex-col gap-3.5">
              <CourseEyebrow tags={recipe.tags} className="text-accent" />
              <h1 className="font-display text-display-4xl font-medium text-balance">
                {recipe.title}
              </h1>
              {recipe.description ? (
                <p className="max-w-[640px] text-base leading-[1.55] text-fg-muted text-pretty">
                  {recipe.description}
                </p>
              ) : null}
              <RecipeStatRow recipe={recipe} layout="desktop" />
              {lastPlannedLine}
              {ratingDifficultyBadges}
              {/*
                A04 §5 item 1: the quiet tag line, then the byline in the fainter
                `text-fg-faint` tier (R11). The tag NAMES are CONTENT, joined with
                "·"; only the "by {name}, {relative}" frame is a key.
              */}
              <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-xs text-fg-subtle">
                {freeTags.map((tag) => (
                  <span key={tag.id}>{tag.name} ·</span>
                ))}
                <span className="text-fg-faint">
                  {t("recipe.recipes.detail.byline", {
                    author: recipe.author.name,
                    date: formatRelative(recipe.createdAt),
                  })}
                </span>
              </p>
            </div>
            {image ? (
              <img
                src={image}
                alt={t("recipe.recipes.detail.imageAlt", { title: recipe.title })}
                className="aspect-4/3 w-full rounded-2xl bg-surface-2 object-cover"
              />
            ) : (
              <div
                data-print="hide"
                className="flex aspect-4/3 w-full items-center justify-center rounded-2xl bg-surface-2 text-fg-subtle"
              >
                <UtensilsCrossed aria-hidden="true" className="size-12" />
              </div>
            )}
          </div>

          {/* BODY */}
          <div className="grid grid-cols-[400px_minmax(0,1fr)] items-start gap-10">
            <Card padding="none" className="flex flex-col gap-3.5 rounded-2xl p-5 lg:sticky lg:top-8">
              <div className="flex items-center gap-3">
                <h2 className="font-display text-2xl font-medium">
                  {t("recipe.recipes.ingredients.heading")}
                </h2>
                {recipe.ingredients.length > 0 ? (
                  <span className="text-[13px] text-fg-subtle">
                    {t("recipe.recipes.ingredients.count", { count: recipe.ingredients.length })}
                  </span>
                ) : null}
                {baseServings ? (
                  <div data-print="hide" className="ml-auto">
                    <ServingsScaler
                      value={servings}
                      baseValue={baseServings}
                      unit={recipe.servingsUnit}
                      onChange={(value) => setServingsOverride(value)}
                      size="sm"
                    />
                  </div>
                ) : null}
              </div>

              {scaled ? (
                <p role="status" className="text-sm text-brand">
                  {t("recipe.recipes.detail.scaledNote", { factor: Math.round(factor * 100) / 100 })}
                </p>
              ) : null}

              <IngredientList ingredients={scaledIngredients} scaled={scaled} />

              {recipe.ingredients.length > 0 ? (
                <Button
                  data-print="hide"
                  variant="outline"
                  fullWidth
                  className="min-h-[42px] bg-surface-inset"
                  leftIcon={<ShoppingBasket className="size-4" />}
                  disabled={unverified !== undefined}
                  title={unverified}
                  onClick={() => setShoppingOpen(true)}
                >
                  {t("recipe.recipes.detail.addToShoppingList")}
                </Button>
              ) : null}
            </Card>

            <div className="flex min-w-0 flex-col gap-4.5">
              <div className="flex items-center gap-3">
                <h2 className="font-display text-2xl font-medium">{t("recipe.recipes.steps.heading")}</h2>
                {recipe.steps.length > 0 ? (
                  <span className="text-[13px] text-fg-subtle">
                    {t("recipe.recipes.detail.stepCount", { count: recipe.steps.length })}
                  </span>
                ) : null}
                {checked.doneCount > 0 ? (
                  <Button
                    data-print="hide"
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={checked.reset}
                    leftIcon={<RotateCcw className="size-4" />}
                  >
                    {t("recipe.recipes.detail.resetChecked", { count: checked.doneCount })}
                  </Button>
                ) : null}
                {recipe.steps.length > 0 ? (
                  <Button
                    data-print="hide"
                    type="button"
                    onClick={() => setCookMode(true)}
                    leftIcon={<Play className="size-4" />}
                    className="ml-auto font-bold"
                  >
                    {t("recipe.recipes.detail.cookModeAction")}
                  </Button>
                ) : null}
              </div>

              <StepList steps={recipe.steps} checked={checked} />

              {notesCard}
              {sourceCard}
            </div>
          </div>
        </>
      ) : (
        <>
          <RecipeHeroMobile
            title={recipe.title}
            image={image}
            imageAlt={t("recipe.recipes.detail.imageAlt", { title: recipe.title })}
            tags={recipe.tags}
            onBack={() => void navigate({ to: "/recipe" })}
            actionMenuItems={actionMenuItems}
            actionMenuTitle={recipe.title}
          />

          <RecipeStatRow recipe={recipe} layout="mobile" />
          {lastPlannedLine}

          {recipe.description ? (
            <p className="text-sm leading-relaxed text-fg-muted text-pretty">{recipe.description}</p>
          ) : null}

          <div data-print="hide">
            <Tabs
              variant="segmented"
              aria-label={recipe.title}
              value={activeTab}
              onChange={setActiveTab}
              items={[
                {
                  value: "ingredients",
                  label: t("recipe.recipes.detail.tabs.ingredients", { count: recipe.ingredients.length }),
                },
                {
                  value: "steps",
                  label: t("recipe.recipes.detail.tabs.steps", { count: recipe.steps.length }),
                },
              ]}
            />
          </div>

          <div hidden={activeTab !== "ingredients"} className="flex flex-col gap-3.5">
            <div className="flex items-center gap-2.5">
              {baseServings ? (
                <ServingsScaler
                  value={servings}
                  baseValue={baseServings}
                  unit={recipe.servingsUnit}
                  onChange={(value) => setServingsOverride(value)}
                  size="md"
                />
              ) : null}
              {recipe.ingredients.length > 0 ? (
                <button
                  type="button"
                  disabled={unverified !== undefined}
                  title={unverified}
                  onClick={() => setShoppingOpen(true)}
                  className="ml-auto text-[13px] font-semibold text-brand-hover disabled:pointer-events-none disabled:opacity-55"
                >
                  {t("recipe.recipes.detail.addToShoppingList")}
                </button>
              ) : null}
            </div>

            <IngredientList ingredients={scaledIngredients} scaled={scaled} />

            {scaled ? (
              <p role="status" className="text-sm text-brand">
                {t("recipe.recipes.detail.scaledNote", { factor: Math.round(factor * 100) / 100 })}
              </p>
            ) : null}

            {/*
              Everything `1f` does not draw is placed, not dropped (A04 §5 item 3):
              rating, difficulty, notes and the source attribution live at the foot
              of this panel rather than vanishing on a phone.
            */}
            {ratingDifficultyBadges}
            {notesCard}
            {sourceCard}
          </div>

          <div hidden={activeTab !== "steps"} className="flex flex-col gap-4">
            <div className="flex items-center gap-2.5">
              {checked.doneCount > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={checked.reset}
                  leftIcon={<RotateCcw className="size-4" />}
                >
                  {t("recipe.recipes.detail.resetChecked", { count: checked.doneCount })}
                </Button>
              ) : null}
            </div>
            <StepList steps={recipe.steps} checked={checked} />
          </div>

          <div className="flex-1" />

          <RecipeDetailBottomBar
            onCookMode={() => setCookMode(true)}
            cookModeDisabled={recipe.steps.length === 0}
            cookedRecently={cookedRecently}
            onMarkCooked={() => markCooked.mutate()}
            onUndoCooked={runUndoCooked}
            canMutateCooked={canMutate}
            cookedReason={mutateReason}
            cookedPending={markCooked.isPending || undoCooked.isPending}
          />
        </>
      )}

      {cookMode ? (
        <CookMode
          title={recipe.title}
          steps={recipe.steps}
          ingredients={scaledIngredients}
          checked={checked}
          onClose={() => setCookMode(false)}
        />
      ) : null}

      <AddRecipeToListDialog
        open={shoppingOpen}
        onClose={() => setShoppingOpen(false)}
        recipe={recipe}
        initialServings={servings}
        lists={shoppingLists.data ?? []}
        listsLoading={shoppingLists.isPending}
        submitting={addToShoppingList.isPending}
        // Creating a list is online-only (see lib/persist.ts: only ITEM mutations are
        // queued offline), so the offer is hidden rather than shown and then failing.
        canCreateList={isOnline}
        creatingList={createShoppingList.isPending}
        onCreateList={(name) => createShoppingList.mutateAsync({ name })}
        onSubmit={async ({ listId, servings: targetServings, ingredientIds }) => {
          try {
            const result = await addToShoppingList.addRecipe({
              householdId: householdId ?? "",
              listId,
              recipeId: recipe.id,
              servings: targetServings,
              ingredientIds,
            });
            writeStorage(storageKeys.lastShoppingListId, `${householdId}:${listId}`);
            setShoppingOpen(false);
            toast.success(
              t("recipe.recipes.detail.addedToListToast"),
              t("recipe.recipes.detail.addedToListDetail", {
                listName: result.list.name,
                count: result.items.length,
              }),
            );
          } catch (error) {
            toast.fromError(error, t("recipe.recipes.detail.addToListFailedToast"));
          }
        }}
      />

      <PlanForDayDialog
        open={planOpen}
        onClose={() => setPlanOpen(false)}
        householdId={householdId ?? ""}
        recipeId={recipe.id}
        title={recipe.title}
      />

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        destructive
        title={t("recipe.recipes.detail.deleteConfirm.title")}
        description={t("recipe.recipes.detail.deleteConfirm.description", { title: recipe.title })}
        confirmLabel={t("recipe.recipes.detail.deleteConfirm.confirm")}
        onConfirm={async () => {
          try {
            await deleteRecipe.mutateAsync(recipe.id);
            toast.success(t("recipe.recipes.detail.deletedToast"));
            navigate({ to: "/recipe", replace: true });
          } catch (error) {
            toast.fromError(error, t("recipe.recipes.detail.deleteFailedToast"));
            throw error;
          }
        }}
      />
    </article>
  );
}

/**
 * "Für einen Tag planen" (A04 §5 header rail). No artboard covers this dialog and
 * no task in the plan owns a standalone file for it — `recipe.recipes.detail.planDialogTitle`
 * is the only key reserved for it, so the rest of its copy reuses existing `recipe.plan.*`
 * keys the same way this screen already reuses `recipe.shopping.*` ones for the list
 * target picker. The week containing today is offered as chips (the common case is
 * "some evening this week"), and the date input underneath keeps any other date one
 * tap away; both write the same `date`, so a chip lights up whenever the input lands
 * inside the week. `usePlanEntryCreate` (T7.3) is idempotent server-side (201 new /
 * 200 already planned).
 */
function PlanForDayDialog({
  open,
  onClose,
  householdId,
  recipeId,
  title,
}: {
  open: boolean;
  onClose: () => void;
  householdId: string;
  recipeId: string;
  title: string;
}) {
  const t = useT();
  const toast = useToast();
  const create = usePlanEntryCreate(householdId);
  const [date, setDate] = useState(() => todayPlanDate());
  const today = todayPlanDate();
  const week = planWeek(startOfPlanWeek(today));
  // Same rule as `/plan`'s picker: the latest day strictly before the chosen one.
  const validDate = isPlanDate(date) ? date : today;
  const lastPlanned = useLastPlanned(open ? householdId : null, validDate).data?.get(recipeId);

  // The dialog stays mounted between openings, so last time's pick would otherwise
  // be pre-selected the next time — today is the honest default every time. Reset
  // during render (React's adjust-state-on-prop-change pattern), not in an effect,
  // so the stale date is never committed to the DOM for a frame.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setDate(today);
  }

  function submit() {
    create.mutate(
      { recipeId, plannedOn: date },
      {
        onSuccess: () => {
          toast.success(t("recipe.plan.toast.planned"));
          onClose();
        },
        onError: (error) => toast.fromError(error, t("recipe.plan.toast.failed")),
      },
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("recipe.recipes.detail.planDialogTitle", { title })}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={create.isPending} fullWidth>
            {t("recipe.plan.action.cancel")}
          </Button>
          <Button onClick={submit} loading={create.isPending} fullWidth>
            {t("common.confirmDialog.confirm")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <fieldset className="min-w-0">
          <legend className="mb-1.5 text-sm font-medium text-fg">{t("recipe.plan.strip.heading")}</legend>
          <div className="flex flex-wrap gap-1.5">
            {week.map((day) => (
              <Chip
                key={day}
                label={t("recipe.plan.day.eyebrow", {
                  weekday: formatWeekdayShort(day),
                  day: formatDayOfMonth(day),
                })}
                selected={day === date}
                onSelect={() => setDate(day)}
              />
            ))}
          </div>
        </fieldset>
        <Input
          type="date"
          label={t("recipe.recipes.detail.planDialog.dateLabel")}
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
        {lastPlanned ? (
          <p className="text-sm text-fg-muted">
            {t("recipe.plan.lastPlanned", { date: formatPlanDateNear(lastPlanned, validDate) })}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

/** Named export as well, for the feature barrel; the router imports the default. */
export { RecipeDetailPage };
