/**
 * Finance's block on `/settings` (a `settingsSections` entry, M3 decision 4, D3): the two
 * participants as slot 1 and slot 2, editable by owners and admins (PUT), and for a
 * participant their own display name (PATCH me). Writes are gated by `useCanMutate()`.
 *
 * Static manifest graph: this file imports neither the module registry, nor the layout
 * components, nor the module's page header (the settings page is the card's frame).
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { FinanceParticipantResponse } from "@toon/shared";
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
  type Assignment,
} from "./lib/assignment";
import { useFinanceParticipants, useUpdateFinanceParticipants, useUpdateMyFinanceDisplayName } from "./lib/queries";

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
          <dd className="min-w-0 truncate font-medium text-fg">{item.displayName}</dd>
        </div>
      ))}
    </dl>
  );
}

function AssignmentForm({
  householdId,
  items,
}: {
  householdId: string;
  items: readonly FinanceParticipantResponse[];
}) {
  const t = useT();
  const user = useCurrentUser();
  const { canMutate, reason } = useCanMutate();
  const members = useQuery(householdMembersQuery(householdId));
  const save = useUpdateFinanceParticipants(householdId);
  const [override, setOverride] = useState<Partial<Assignment>>({});

  const assignable = toAssignable(members.data?.items ?? []);
  const assignment: Assignment = { ...initialAssignment(assignable, user.id, items), ...override };
  const options = assignmentOptions(assignable, items);
  const errorKey = assignmentError(assignment);
  const body = assignmentBody(assignment);

  return (
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
        options={options}
        placeholder={t("finance.common.select")}
        onChange={(event) => setOverride({ ...override, slot1: event.target.value })}
      />
      <Select
        label={t("finance.participants.slot2")}
        value={assignment.slot2}
        options={options}
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
