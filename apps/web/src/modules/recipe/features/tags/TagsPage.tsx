/**
 * TagsPage — manage the tags of the active household: create, rename, recolour, delete.
 * Deleting is admin-only (docs/API.md); the button is hidden otherwise and a 403 that
 * slips through is shown as a toast.
 */
import { useState } from "react";
import { Check, Pencil, Plus, Tags, Trash2, X } from "lucide-react";
import { CreateTagRequestSchema, type Tag, type TagKind } from "@toon/shared";
import {
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  SectionHeader,
  Skeleton,
} from "@/components/ui";
import { PhoneHeaderRow } from "@/components/layout/PhoneHeaderRow";
import { useToast } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { apiFieldErrors, validate, type FieldErrors } from "@/lib/validation";
import { useActiveHousehold } from "@/lib/session";
import { isApiError } from "@/modules/recipe/lib/api";
import { hasAtLeast } from "@/lib/permissions";
import { AppLink } from "@/lib/nav";
import { TagChip } from "./components/TagChip";
import { useCreateTag, useDeleteTag, useTags, useUpdateTag } from "./lib/queries";

/** A small, food-appropriate default palette; users can type any hex value. */
const PRESET_COLORS = [
  "#c2532c",
  "#d99a24",
  "#5b8040",
  "#2f6f7d",
  "#6b4f9e",
  "#c0392b",
  "#8d7c67",
  "#3f6212",
] as const;

export default function TagsPage() {
  const t = useT();
  const { householdId, role } = useActiveHousehold();
  const tags = useTags(householdId);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Tag | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Tag | null>(null);

  const deleteTag = useDeleteTag(householdId);
  const updateKind = useUpdateTag(householdId);
  const toast = useToast();
  const canDelete = hasAtLeast(role, "admin");

  async function changeKind(tag: Tag, kind: TagKind) {
    if (tag.kind === kind) return;
    try {
      await updateKind.mutateAsync({ tagId: tag.id, kind });
      toast.success(t("recipe.tags.kindChangedToast"), tag.name);
    } catch (error) {
      toast.fromError(error, t("recipe.tags.kindChangeFailedToast"));
    }
  }

  function renderTagRow(tag: Tag) {
    return (
      <li key={tag.id} className="flex flex-wrap items-center gap-3 p-3">
        <TagChip tag={tag} kind={tag.kind} />
        <span className="min-w-0 flex-1 truncate text-sm text-fg-muted">
          {t("recipe.count.recipes", { count: tag.recipeCount ?? 0 })}
        </span>
        <span className="hidden shrink-0 text-xs text-fg-subtle sm:inline">
          {t("recipe.tags.kindLegend")}
        </span>
        <KindToggle tag={tag} onChange={(kind) => void changeKind(tag, kind)} />
        <IconButton
          label={t("recipe.tags.editLabel", { name: tag.name })}
          icon={<Pencil />}
          size="sm"
          onClick={() => setEditing(tag)}
        />
        {canDelete ? (
          <IconButton
            label={t("recipe.tags.deleteLabel", { name: tag.name })}
            icon={<Trash2 />}
            size="sm"
            variant="danger"
            onClick={() => setPendingDelete(tag)}
          />
        ) : null}
      </li>
    );
  }

  const allTags = tags.data ?? [];
  // R41: `kind` has no name-matching backfill, so an existing library starts with
  // every tag `'free'`. Only render the course/free split once somebody has actually
  // used the toggle below — an empty "Gänge" section over a full "Tags" section would
  // look broken on every pre-redesign install, not just a new one.
  const courseTags = allTags.filter((tag) => tag.kind === "course");
  const freeTags = allTags.filter((tag) => tag.kind !== "course");
  const showSplit = courseTags.length > 0;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <PhoneHeaderRow />
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-display-2xl leading-[1.05] font-medium text-fg">
            {t("recipe.tags.title")}
          </h1>
          <p className="text-sm text-fg-muted">{t("recipe.tags.subtitle")}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} leftIcon={<Plus className="size-4" />}>
          {t("recipe.tags.create")}
        </Button>
      </header>

      {tags.isPending ? (
        <Card padding="md">
          <Skeleton lines={4} />
        </Card>
      ) : tags.isError ? (
        <ErrorState error={tags.error} onRetry={() => void tags.refetch()} />
      ) : allTags.length === 0 ? (
        <EmptyState
          icon={<Tags />}
          title={t("recipe.tags.emptyTitle")}
          description={t("recipe.tags.emptyDescription")}
          action={
            <Button onClick={() => setCreateOpen(true)} fullWidth leftIcon={<Plus className="size-4" />}>
              {t("recipe.tags.create")}
            </Button>
          }
          secondaryAction={<AppLink to="/recipe">{t("recipe.tags.toRecipeList")}</AppLink>}
        />
      ) : (
        <>
          <p className="text-sm text-fg-muted">{t("recipe.tags.kindHint")}</p>
          {showSplit ? (
            <>
              <SectionHeader title={t("recipe.tags.sectionCourses")} />
              <Card padding="none">
                <ul className="flex flex-col divide-y divide-line">
                  {courseTags.map(renderTagRow)}
                </ul>
              </Card>
              <SectionHeader title={t("recipe.tags.sectionFree")} />
              <Card padding="none">
                <ul className="flex flex-col divide-y divide-line">
                  {freeTags.map(renderTagRow)}
                </ul>
              </Card>
            </>
          ) : (
            <Card padding="none">
              <ul className="flex flex-col divide-y divide-line">
                {freeTags.map(renderTagRow)}
              </ul>
            </Card>
          )}
        </>
      )}

      <TagDialog open={createOpen} onClose={() => setCreateOpen(false)} tag={null} />
      <TagDialog open={editing !== null} onClose={() => setEditing(null)} tag={editing} />

      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        destructive
        title={t("recipe.tags.deleteConfirmTitle")}
        description={
          pendingDelete
            ? t("recipe.tags.deleteConfirmDescription", {
                name: pendingDelete.name,
                count: pendingDelete.recipeCount ?? 0,
              })
            : undefined
        }
        confirmLabel={t("household.common.delete")}
        onConfirm={async () => {
          if (!pendingDelete) return;
          try {
            await deleteTag.mutateAsync(pendingDelete.id);
            toast.success(t("recipe.tags.deletedToast"), pendingDelete.name);
          } catch (error) {
            toast.fromError(error, t("recipe.tags.deleteFailedToast"));
            throw error;
          }
        }}
      />
    </div>
  );
}

/**
 * The course↔free toggle (R41/D5): how an EXISTING library adopts the eyebrow, since
 * the migration's `DEFAULT 'free'` is deliberately the whole backfill (no name-matching
 * guess at somebody else's German content). Two `aria-pressed` pills, same pattern as
 * the colour swatches in `TagDialog` below — never a native `<select>`, which cannot
 * show both states at a glance in a dense settings row.
 */
function KindToggle({ tag, onChange }: { tag: Tag; onChange: (kind: TagKind) => void }) {
  const t = useT();
  const pillClass = (active: boolean) =>
    cn(
      "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
      active ? "bg-brand-soft text-brand-soft-fg" : "text-fg-muted hover:text-fg",
    );
  return (
    <div
      role="group"
      aria-label={t("recipe.tags.kindToggleLabel", { name: tag.name })}
      className="flex shrink-0 items-center gap-0.5 rounded-full border border-line bg-surface-2 p-0.5"
    >
      <button
        type="button"
        aria-pressed={tag.kind === "course"}
        onClick={() => onChange("course")}
        className={pillClass(tag.kind === "course")}
      >
        {t("recipe.tags.kindCourse")}
      </button>
      <button
        type="button"
        aria-pressed={tag.kind === "free"}
        onClick={() => onChange("free")}
        className={pillClass(tag.kind === "free")}
      >
        {t("recipe.tags.kindFree")}
      </button>
    </div>
  );
}

/** Create + edit in one dialog: `tag === null` means "create". */
function TagDialog({
  open,
  onClose,
  tag,
}: {
  open: boolean;
  onClose: () => void;
  tag: Tag | null;
}) {
  const t = useT();
  const { householdId } = useActiveHousehold();
  const createTag = useCreateTag(householdId);
  const updateTag = useUpdateTag(householdId);
  const toast = useToast();

  const [name, setName] = useState(tag?.name ?? "");
  const [color, setColor] = useState(tag?.color ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});
  // Re-seed when a different tag is opened.
  const [seededFor, setSeededFor] = useState<string | null>(tag?.id ?? null);
  if (open && seededFor !== (tag?.id ?? null)) {
    setSeededFor(tag?.id ?? null);
    setName(tag?.name ?? "");
    setColor(tag?.color ?? "");
    setErrors({});
  }

  const pending = createTag.isPending || updateTag.isPending;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validate(CreateTagRequestSchema, {
      name,
      ...(color.trim().length > 0 ? { color: color.trim() } : {}),
    });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    try {
      if (tag) {
        await updateTag.mutateAsync({ tagId: tag.id, ...result.data });
        toast.success(t("recipe.tags.savedToast"), result.data.name);
      } else {
        await createTag.mutateAsync(result.data);
        toast.success(t("recipe.tags.createdToast"), result.data.name);
      }
      onClose();
    } catch (error) {
      if (isApiError(error) && error.code === "tag_name_taken") {
        setErrors({ name: t("recipe.tags.nameTakenError") });
        return;
      }
      setErrors(apiFieldErrors(error));
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={tag ? t("recipe.tags.editTitle") : t("recipe.tags.createTitle")}
      size="sm"
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-3">
        {errors._form ? (
          <p role="alert" className="text-sm font-medium text-danger">
            {errors._form}
          </p>
        ) : null}
        <Input
          label={t("household.common.name")}
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("recipe.tags.namePlaceholder")}
          error={errors.name}
          disabled={pending}
          autoFocus
        />

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-fg">{t("recipe.tags.colorLegend")}</legend>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setColor("")}
              aria-pressed={color === ""}
              aria-label={t("recipe.tags.noColorAriaLabel")}
              className="tap flex items-center justify-center rounded-full border border-line bg-surface-2 px-3 text-sm text-fg-muted"
            >
              {color === "" ? <Check aria-hidden="true" className="size-4" /> : null}
              {t("recipe.tags.noColor")}
            </button>
            {PRESET_COLORS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setColor(preset)}
                aria-pressed={color.toLowerCase() === preset}
                aria-label={t("recipe.tags.colorAriaLabel", { hex: preset })}
                style={{ backgroundColor: preset }}
                className="flex size-11 items-center justify-center rounded-full text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {color.toLowerCase() === preset ? (
                  <Check aria-hidden="true" className="size-5" />
                ) : null}
              </button>
            ))}
          </div>
          <Input
            label={t("recipe.tags.customHexLabel")}
            optional
            value={color}
            onChange={(event) => setColor(event.target.value)}
            placeholder="#e11d48"
            error={errors.color}
            disabled={pending}
            autoComplete="off"
            spellCheck={false}
          />
        </fieldset>

        <div className="flex items-center gap-2">
          <span className="text-sm text-fg-muted">{t("recipe.tags.previewLabel")}</span>
          <TagChip
            tag={{
              name: name.trim().length > 0 ? name : t("recipe.tags.previewName"),
              color: color || null,
            }}
          />
        </div>

        <div className="mt-1 flex gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            fullWidth
            disabled={pending}
            leftIcon={<X className="size-4" />}
          >
            {t("household.common.cancel")}
          </Button>
          <Button type="submit" loading={pending} fullWidth>
            {tag ? t("household.common.save") : t("household.common.create")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Named export as well, for the feature barrel; the router imports the default. */
export { TagsPage };
