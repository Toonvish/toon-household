/**
 * Finance's block on `/settings` (a `settingsSections` entry, M3 decision 4, D3): the two
 * participants as slot 1 and slot 2, editable by owners and admins (PUT), and for a
 * participant their own display name (PATCH me). Writes are gated by `useCanMutate()`.
 *
 * Placeholders (ADR 0006, plan m3b decisions 6 and 7): a seat without an account carries the
 * "ohne Konto" badge and hint; a participant may rename the OTHER seat when it is a placeholder
 * (PATCH participants/:userId); owners and admins create its claim link and add a person
 * "Ohne Konto hinzufügen" (preselected for slot 2: a placeholder may only hold slot 2, so the
 * slot-1 select never lists one). A placeholder ALONE in slot 1 (an account left an empty ledger,
 * ADR 0004) renders as one seat plus the form, whose preselection seats the viewer in slot 1 and
 * the placeholder in slot 2.
 *
 * Static manifest graph: this file imports neither the module registry, nor the layout
 * components, nor the module's page header (the settings page is the card's frame).
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { FinanceParticipantResponse } from "@toon/shared";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { useCurrentUser, useActiveHousehold, useCanMutate } from "@/lib/session";
import { useT } from "@/lib/i18n";
import { householdMembersQuery } from "@/lib/queries";
import {
  assignmentBody,
  assignmentChanged,
  assignmentError,
  assignmentOptions,
  initialAssignment,
  toAssignable,
  withBadge,
  type Assignment,
} from "./lib/assignment";
import {
  useFinanceParticipants,
  useRenameFinanceParticipant,
  useUpdateFinanceParticipants,
  useUpdateMyFinanceDisplayName,
} from "./lib/queries";
import { ClaimLinkDialog } from "./ClaimLinkDialog";
import { PlaceholderForm } from "./PlaceholderForm";

export function ParticipantsSection() {
  const t = useT();
  const { householdId, hasRole } = useActiveHousehold();
  const participants = useFinanceParticipants(householdId);

  if (householdId === null) return null;
  const isAdmin = hasRole("admin");
  const items = participants.data?.items ?? [];
  const me = participants.data?.viewerSlot
    ? (items.find((item) => item.memberSlot === participants.data.viewerSlot) ?? null)
    : null;

  return (
    <Card padding="lg" className="flex flex-col gap-5">
      <CardHeader title={t("finance.participants.title")} description={t("finance.participants.description")} />
      {participants.isPending ? (
        <Skeleton lines={3} />
      ) : isAdmin ? (
        <AssignmentForm householdId={householdId} items={items} />
      ) : (
        <>
          <p className="text-sm text-fg-muted">{t("finance.participants.adminOnly")}</p>
          <ReadOnlySlots items={items} />
        </>
      )}
      <PlaceholderSeats
        householdId={householdId}
        items={items}
        canRename={participants.data?.viewerSlot != null}
        canLink={isAdmin}
      />
      {me ? <DisplayNameForm key={me.displayName} householdId={householdId} me={me} /> : null}
    </Card>
  );
}

function ReadOnlySlots({ items }: { items: readonly FinanceParticipantResponse[] }) {
  const t = useT();
  return (
    <dl className="flex flex-col gap-2 text-sm">
      {items.map((item) => (
        <div key={item.userId} className="flex items-center justify-between gap-3">
          <dt className="text-fg-muted">
            {item.memberSlot === 1 ? t("finance.participants.slot1") : t("finance.participants.slot2")}
          </dt>
          <dd className="flex min-w-0 items-center gap-2 font-medium text-fg">
            <span className="truncate">{item.displayName}</span>
            {item.hasAccount ? null : (
              <Badge size="sm" variant="warning">
                {t("finance.settings.household.placeholderBadge")}
              </Badge>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function AssignmentForm({ householdId, items }: { householdId: string; items: readonly FinanceParticipantResponse[] }) {
  const t = useT();
  const user = useCurrentUser();
  const { canMutate, reason } = useCanMutate();
  const members = useQuery(householdMembersQuery(householdId));
  const save = useUpdateFinanceParticipants(householdId);
  const [override, setOverride] = useState<Partial<Assignment>>({});

  const assignable = toAssignable(members.data?.items ?? []);
  const assignment: Assignment = { ...initialAssignment(assignable, user.id, items), ...override };
  const badge = t("finance.settings.household.placeholderBadge");
  const slot1Options = withBadge(assignmentOptions(assignable, items, 1), badge);
  const slot2Options = withBadge(assignmentOptions(assignable, items, 2), badge);
  const errorKey = assignmentError(assignment);
  const body = assignmentBody(assignment, assignable, items);

  return (
    <>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (body) save.mutate(body, { onSuccess: () => setOverride({}) });
        }}
      >
        <Select
          label={t("finance.participants.slot1")}
          value={assignment.slot1}
          options={slot1Options}
          placeholder={t("finance.common.select")}
          onChange={(event) => setOverride({ ...override, slot1: event.target.value })}
        />
        <Select
          label={t("finance.participants.slot2")}
          value={assignment.slot2}
          options={slot2Options}
          placeholder={t("finance.common.select")}
          error={errorKey ? t(errorKey) : undefined}
          onChange={(event) => setOverride({ ...override, slot2: event.target.value })}
        />
        <div>
          <Button
            type="submit"
            loading={save.isPending}
            disabled={!canMutate || body === null || !assignmentChanged(assignment, items)}
            title={reason}
          >
            {t("finance.participants.save")}
          </Button>
        </div>
      </form>
      <PlaceholderForm
        householdId={householdId}
        className="flex flex-col gap-3 border-t border-border pt-4"
        onCreated={(member) => setOverride((previous) => ({ ...previous, slot2: member.userId }))}
      />
    </>
  );
}

/**
 * The seats without an account: badge and hint, "Umbenennen" for a participant (the other seat,
 * decision 6) and the claim link for owners and admins. Nothing renders without a placeholder.
 */
function PlaceholderSeats({
  householdId,
  items,
  canRename,
  canLink,
}: {
  householdId: string;
  items: readonly FinanceParticipantResponse[];
  canRename: boolean;
  canLink: boolean;
}) {
  const t = useT();
  const { canMutate, reason } = useCanMutate();
  const rename = useRenameFinanceParticipant(householdId);
  const [renaming, setRenaming] = useState<{ userId: string; value: string } | null>(null);
  const [claiming, setClaiming] = useState<FinanceParticipantResponse | null>(null);
  const placeholders = items.filter((item) => !item.hasAccount);
  if (placeholders.length === 0) return null;

  return (
    <>
      <ul className="flex flex-col gap-3 border-t border-border pt-4">
        {placeholders.map((item) => {
          const isRenaming = renaming?.userId === item.userId;
          const value = renaming?.value.trim() ?? "";
          return (
            <li key={item.userId} className="flex flex-col gap-2">
              {isRenaming ? (
                <form
                  className="flex items-end gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (value === "") return;
                    rename.mutate({ userId: item.userId, displayName: value }, { onSuccess: () => setRenaming(null) });
                  }}
                >
                  <Input
                    containerClassName="flex-1"
                    label={t("finance.settings.household.displayName")}
                    data-autofocus
                    maxLength={80}
                    value={renaming.value}
                    onChange={(event) => setRenaming({ userId: item.userId, value: event.target.value })}
                  />
                  <Button
                    type="submit"
                    size="sm"
                    loading={rename.isPending}
                    disabled={!canMutate || value === ""}
                    title={reason}
                  >
                    {t("finance.common.save")}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(null)}>
                    {t("finance.common.cancel")}
                  </Button>
                </form>
              ) : (
                <>
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate text-sm font-medium text-fg">
                      {item.displayName}
                      <Badge size="sm" variant="warning">
                        {t("finance.settings.household.placeholderBadge")}
                      </Badge>
                    </p>
                    <p className="truncate text-xs text-fg-muted">{t("finance.settings.household.placeholderHint")}</p>
                  </div>
                  {canRename || canLink ? (
                    <div className="flex flex-wrap gap-2">
                      {canRename ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={!canMutate}
                          title={reason}
                          onClick={() => setRenaming({ userId: item.userId, value: item.displayName })}
                        >
                          {t("finance.settings.household.placeholderRename")}
                        </Button>
                      ) : null}
                      {canLink ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={!canMutate}
                          title={reason}
                          onClick={() => setClaiming(item)}
                        >
                          {t("finance.settings.household.linkAccount", { name: item.displayName })}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </>
              )}
            </li>
          );
        })}
      </ul>
      <ClaimLinkDialog householdId={householdId} participant={claiming} onClose={() => setClaiming(null)} />
    </>
  );
}

function DisplayNameForm({ householdId, me }: { householdId: string; me: FinanceParticipantResponse }) {
  const t = useT();
  const { canMutate, reason } = useCanMutate();
  const rename = useUpdateMyFinanceDisplayName(householdId);
  const [value, setValue] = useState(me.displayName);
  const trimmed = value.trim();

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed !== "" && trimmed !== me.displayName) rename.mutate({ displayName: trimmed });
      }}
    >
      <Input
        label={t("finance.settings.household.displayName")}
        value={value}
        maxLength={80}
        onChange={(event) => setValue(event.target.value)}
      />
      <div>
        <Button
          type="submit"
          variant="secondary"
          loading={rename.isPending}
          disabled={!canMutate || trimmed === "" || trimmed === me.displayName}
          title={reason}
        >
          {t("finance.common.save")}
        </Button>
      </div>
    </form>
  );
}

export default ParticipantsSection;
