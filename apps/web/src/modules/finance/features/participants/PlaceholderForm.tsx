/**
 * "Ohne Konto hinzufügen" (F's InviteCard block, ADR 0006): a name field and "Person eintragen"
 * that adds a household member without an account through the core's `POST …/members` and hands
 * the new member to the caller, who preselects it for slot 2 (a placeholder may only hold slot 2).
 * Shared by the enable dialog and the participants section. It is its own `<form>` and must never
 * sit inside another one.
 *
 * Static manifest graph: no module registry, no layout components, no `@/core/features`.
 */
import { useState } from "react";
import type { HouseholdMember } from "@toon/shared";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { errorMessage } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useCanMutate } from "@/lib/session";
import { useAddPlaceholderMember } from "./lib/queries";

export interface PlaceholderFormProps {
  householdId: string;
  /** Called once the member exists and the household's members are refetched. */
  onCreated?: (member: HouseholdMember) => void;
  /** Overrides the form's layout classes. */
  className?: string;
}

export function PlaceholderForm({ householdId, onCreated, className }: PlaceholderFormProps) {
  const t = useT();
  const { canMutate, reason } = useCanMutate();
  const add = useAddPlaceholderMember(householdId);
  const [name, setName] = useState("");
  const trimmed = name.trim();

  return (
    <form
      className={className ?? "flex flex-col gap-3"}
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed === "") return;
        add.mutate(
          { displayName: trimmed },
          {
            onSuccess: (member) => {
              setName("");
              onCreated?.(member);
            },
          },
        );
      }}
    >
      <div>
        <h3 className="text-sm font-semibold text-fg">{t("finance.settings.household.placeholderTitle")}</h3>
        <p className="mt-1 text-sm text-fg-muted">{t("finance.settings.household.placeholderDescription")}</p>
      </div>
      {add.isError ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {errorMessage(add.error)}
        </p>
      ) : null}
      <Input
        label={t("finance.settings.household.displayName")}
        autoComplete="off"
        required
        maxLength={80}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <div>
        <Button
          type="submit"
          variant="secondary"
          loading={add.isPending}
          disabled={!canMutate || trimmed === ""}
          title={reason}
        >
          {t("finance.settings.household.placeholderCreate")}
        </Button>
      </div>
    </form>
  );
}

export default PlaceholderForm;
