/**
 * HouseholdsPage — "Meine Gruppen": every household the user belongs to with their role,
 * plus creating a new one. Recipes, tags and collections belong to a GROUP, so this is
 * also where the user switches context (the active household is marked).
 */
import { useState } from "react";
import { Check, Plus, Users } from "lucide-react";
import { CreateHouseholdRequestSchema } from "@toon/shared";
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  Input,
  Skeleton,
  Textarea,
} from "@/components/ui";
import { useToast } from "@/components/ui";
import { PhoneHeaderRow } from "@/components/layout/PhoneHeaderRow";
import { useT } from "@/lib/i18n";
import { apiFieldErrors, validate, type FieldErrors } from "@/lib/validation";
import { useActiveHousehold } from "@/lib/session";
import { AppLink } from "@/lib/nav";
import { ROLE_LABEL_KEYS } from "./lib/roleLabels";
import { useCreateHousehold, useHouseholds } from "./lib/queries";

export default function HouseholdsPage() {
  const t = useT();
  const households = useHouseholds();
  const { householdId, setActiveHousehold } = useActiveHousehold();
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <PhoneHeaderRow />
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-display-2xl font-medium text-fg lg:text-display-3xl">{t("household.list.title")}</h1>
          <p className="text-sm text-fg-muted">{t("household.list.subtitle")}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} leftIcon={<Plus className="size-4" />}>
          {t("household.list.create")}
        </Button>
      </header>

      {households.isPending ? (
        <ul className="flex flex-col gap-3">
          {[0, 1, 2].map((index) => (
            <li key={index}>
              <Card padding="md" className="flex flex-col gap-2">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-56" />
              </Card>
            </li>
          ))}
        </ul>
      ) : households.isError ? (
        <ErrorState error={households.error} onRetry={() => void households.refetch()} />
      ) : (households.data ?? []).length === 0 ? (
        <EmptyState
          icon={<Users />}
          title={t("household.list.emptyTitle")}
          description={t("household.list.emptyDescription")}
          action={
            <Button onClick={() => setCreateOpen(true)} fullWidth leftIcon={<Plus className="size-4" />}>
              {t("household.list.create")}
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {(households.data ?? []).map((household) => {
            const isActive = household.id === householdId;
            return (
              <li key={household.id}>
                <Card padding="md" className="flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <AppLink
                          to="/households/$householdId"
                          params={{ householdId: household.id }}
                          className="truncate font-display text-display-sm font-medium text-fg hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        >
                          {household.name}
                        </AppLink>
                        <Badge variant={household.role === "owner" ? "brand" : "neutral"}>
                          {t(ROLE_LABEL_KEYS[household.role])}
                        </Badge>
                        {isActive ? (
                          <Badge variant="success" icon={<Check />}>
                            {t("household.badge.active")}
                          </Badge>
                        ) : null}
                      </div>
                      {household.description ? (
                        <p className="mt-1 line-clamp-2 text-sm text-fg-muted">
                          {household.description}
                        </p>
                      ) : null}
                      <p className="mt-1 text-sm text-fg-subtle">
                        {t("household.count.members", { count: household.memberCount })}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {!isActive ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setActiveHousehold(household.id)}
                      >
                        {t("household.list.activate")}
                      </Button>
                    ) : null}
                    <AppLink to="/households/$householdId" params={{ householdId: household.id }}>
                      <Button variant="ghost" size="sm">
                        {t("household.list.manage")}
                      </Button>
                    </AppLink>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <CreateHouseholdDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

function CreateHouseholdDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const createHousehold = useCreateHousehold();
  const { setActiveHousehold } = useActiveHousehold();
  const toast = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});

  function close() {
    setName("");
    setDescription("");
    setErrors({});
    onClose();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validate(CreateHouseholdRequestSchema, {
      name,
      description: description.trim().length > 0 ? description : undefined,
    });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    try {
      const household = await createHousehold.mutateAsync(result.data);
      setActiveHousehold(household.id);
      toast.success(t("household.create.successTitle"), household.name);
      close();
    } catch (error) {
      setErrors(apiFieldErrors(error));
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t("household.create.title")}
      description={t("household.create.description")}
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
          placeholder={t("household.create.namePlaceholder")}
          error={errors.name}
          disabled={createHousehold.isPending}
          autoFocus
        />
        <Textarea
          label={t("household.common.description")}
          optional
          rows={3}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder={t("household.create.descriptionPlaceholder")}
          error={errors.description}
          disabled={createHousehold.isPending}
        />
        <div className="mt-1 flex gap-2">
          <Button type="button" variant="secondary" onClick={close} fullWidth disabled={createHousehold.isPending}>
            {t("household.common.cancel")}
          </Button>
          <Button type="submit" loading={createHousehold.isPending} fullWidth>
            {t("household.common.create")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Named export as well, for the feature barrel; the router imports the default. */
export { HouseholdsPage };
