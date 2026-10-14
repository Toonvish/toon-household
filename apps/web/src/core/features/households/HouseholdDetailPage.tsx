/**
 * HouseholdDetailPage — manage one household: rename/describe, members with role controls,
 * invites, leave, and delete with a typed-name confirmation.
 *
 * Every destructive or admin-only control is hidden when the role does not allow it, and
 * a 403 that slips through anyway is rendered as an inline error instead of a crash.
 */
import { useEffect, useState } from "react";
import { Save, Trash2, TriangleAlert } from "lucide-react";
import { UpdateHouseholdRequestSchema } from "@toon/shared";
import {
  Badge,
  Button,
  Card,
  Dialog,
  ErrorState,
  Input,
  LoadingBlock,
  Tabs,
  Textarea,
  buttonClasses,
} from "@/components/ui";
import { useToast } from "@/components/ui";
import { PhoneHeaderRow } from "@/components/layout/PhoneHeaderRow";
import { formatDate } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { apiFieldErrors, validate, type FieldErrors } from "@/lib/validation";
import { useCurrentUser, useSession } from "@/lib/session";
import { AppLink, useAppNavigate, useRouteParam } from "@/lib/nav";
import { hasAtLeast } from "@/lib/permissions";
import { MemberList } from "./components/MemberList";
import { InvitePanel } from "./components/InvitePanel";
import { ROLE_LABEL_KEYS } from "./lib/roleLabels";
import { useDeleteHousehold, useHouseholdDetail, useUpdateHousehold } from "./lib/queries";

type TabValue = "members" | "invites" | "settings";

export default function HouseholdDetailPage() {
  const t = useT();
  const householdId = useRouteParam("householdId");
  const user = useCurrentUser();
  const { activeHouseholdId, setActiveHousehold, households } = useSession();
  const navigate = useAppNavigate();

  const query = useHouseholdDetail(householdId);
  const [tab, setTab] = useState<TabValue>("members");

  if (query.isPending) return <LoadingBlock label={t("household.detail.loading")} />;

  if (query.isError || !query.data) {
    return (
      <ErrorState
        error={query.error}
        onRetry={() => void query.refetch()}
        action={
          <AppLink to="/households" className={buttonClasses({ variant: "secondary" })}>
            {t("household.detail.backToList")}
          </AppLink>
        }
      />
    );
  }

  const { household, members } = query.data;
  const isAdmin = hasAtLeast(household.role, "admin");
  const isOwner = household.role === "owner";

  const tabs = [
    { value: "members" as const, label: t("household.detail.tab.members"), badge: members.length },
    ...(isAdmin ? [{ value: "invites" as const, label: t("household.detail.tab.invites") }] : []),
    { value: "settings" as const, label: t("household.detail.tab.settings") },
  ];

  function afterLeaveOrDelete() {
    // Fall back to any other household the user still has, otherwise the household list.
    const next = households.find((candidate) => candidate.id !== household.id);
    if (next) setActiveHousehold(next.id);
    navigate({ to: "/households", replace: true });
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <PhoneHeaderRow />
      <header className="flex flex-col gap-2">
        <AppLink to="/households" className="text-sm text-fg-muted hover:text-fg">
          {t("household.detail.backLink")}
        </AppLink>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-display text-display-2xl font-medium text-fg lg:text-display-3xl">{household.name}</h1>
          <Badge variant={isOwner ? "brand" : "neutral"}>{t(ROLE_LABEL_KEYS[household.role])}</Badge>
          {household.id === activeHouseholdId ? (
            <Badge variant="success">{t("household.badge.active")}</Badge>
          ) : null}
        </div>
        {household.description ? <p className="text-fg-muted">{household.description}</p> : null}
        <p className="text-sm text-fg-subtle">
          {t("household.detail.meta", {
            members: t("household.count.members", { count: household.memberCount }),
            date: formatDate(household.createdAt),
          })}
        </p>
        {household.id !== activeHouseholdId ? (
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => setActiveHousehold(household.id)}
          >
            {t("household.detail.activate")}
          </Button>
        ) : null}
      </header>

      <Tabs
        items={tabs}
        value={tab}
        onChange={setTab}
        aria-label={t("household.detail.tabsAriaLabel")}
        scrollable
      />

      {tab === "members" ? (
        <Card padding="md">
          <MemberList
            householdId={household.id}
            members={members}
            myRole={household.role}
            myUserId={user.id}
            onLeft={afterLeaveOrDelete}
          />
        </Card>
      ) : null}

      {tab === "invites" ? (
        <InvitePanel householdId={household.id} householdName={household.name} enabled={isAdmin} />
      ) : null}

      {tab === "settings" ? (
        <div className="flex flex-col gap-4">
          <HouseholdSettingsForm
            householdId={household.id}
            name={household.name}
            description={household.description ?? ""}
            canEdit={isAdmin}
          />
          {isOwner ? (
            <DangerZone
              householdId={household.id}
              householdName={household.name}
              onDeleted={afterLeaveOrDelete}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function HouseholdSettingsForm({
  householdId,
  name: initialName,
  description: initialDescription,
  canEdit,
}: {
  householdId: string;
  name: string;
  description: string;
  canEdit: boolean;
}) {
  const t = useT();
  const updateHousehold = useUpdateHousehold();
  const toast = useToast();
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [errors, setErrors] = useState<FieldErrors>({});

  useEffect(() => {
    setName(initialName);
    setDescription(initialDescription);
  }, [initialName, initialDescription]);

  const dirty = name !== initialName || description !== initialDescription;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validate(UpdateHouseholdRequestSchema, {
      name,
      description: description.trim().length > 0 ? description : null,
    });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    try {
      await updateHousehold.mutateAsync({ householdId, ...result.data });
      setErrors({});
      toast.success(t("household.settings.savedToast"));
    } catch (error) {
      setErrors(apiFieldErrors(error));
    }
  }

  return (
    <Card padding="md">
      <form onSubmit={submit} noValidate className="flex flex-col gap-3">
        <h2 className="font-display text-display-md font-medium">{t("household.settings.heading")}</h2>
        {!canEdit ? (
          <p className="text-sm text-fg-muted">{t("household.settings.readonlyHint")}</p>
        ) : null}
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
          error={errors.name}
          disabled={!canEdit || updateHousehold.isPending}
        />
        <Textarea
          label={t("household.common.description")}
          optional
          rows={3}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          error={errors.description}
          disabled={!canEdit || updateHousehold.isPending}
        />
        <Button
          type="submit"
          loading={updateHousehold.isPending}
          disabled={!canEdit || !dirty}
          leftIcon={<Save className="size-4" />}
          className="sm:self-start"
        >
          {t("household.common.save")}
        </Button>
      </form>
    </Card>
  );
}

function DangerZone({
  householdId,
  householdName,
  onDeleted,
}: {
  householdId: string;
  householdName: string;
  onDeleted: () => void;
}) {
  const t = useT();
  const deleteHousehold = useDeleteHousehold();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const matches = confirmText.trim() === householdName;

  async function remove() {
    if (!matches) return;
    try {
      await deleteHousehold.mutateAsync(householdId);
      toast.success(t("household.danger.deletedToast"), householdName);
      setOpen(false);
      onDeleted();
    } catch (error) {
      toast.fromError(error, t("household.danger.deleteFailedToast"));
    }
  }

  return (
    <Card padding="md" className="border-danger/40">
      <h2 className="flex items-center gap-2 font-display text-display-md font-medium text-danger">
        <TriangleAlert aria-hidden="true" className="size-5" />
        {t("household.danger.heading")}
      </h2>
      <p className="mt-1 text-sm text-fg-muted">
        {t("household.danger.warning")}
      </p>
      <Button
        variant="danger"
        className="mt-3"
        onClick={() => {
          setConfirmText("");
          setOpen(true);
        }}
        leftIcon={<Trash2 className="size-4" />}
      >
        {t("household.danger.deleteButton")}
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        dismissable={!deleteHousehold.isPending}
        title={t("household.danger.confirmTitle")}
        description={t("household.danger.confirmDescription", { name: householdName })}
        size="sm"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setOpen(false)}
              disabled={deleteHousehold.isPending}
              fullWidth
            >
              {t("household.common.cancel")}
            </Button>
            <Button
              variant="danger"
              onClick={() => void remove()}
              disabled={!matches}
              loading={deleteHousehold.isPending}
              fullWidth
            >
              {t("household.danger.confirmButton")}
            </Button>
          </>
        }
      >
        <Input
          label={t("household.danger.nameLabel")}
          value={confirmText}
          onChange={(event) => setConfirmText(event.target.value)}
          placeholder={householdName}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          error={
            confirmText.length > 0 && !matches ? t("household.danger.nameMismatch") : undefined
          }
          disabled={deleteHousehold.isPending}
        />
      </Dialog>
    </Card>
  );
}

/** Named export as well, for the feature barrel; the router imports the default. */
export { HouseholdDetailPage };
