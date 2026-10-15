/**
 * "There is no second person yet": the one state in which the capture form cannot be shown at all.
 * A ledger with one participant has nothing to split, so every Art on `KindPicker` would be
 * meaningless and the only useful action left is the invitation (toon-finance 1715207; here the
 * invitation lives in Settings, where the participants section is).
 *
 * BOTH frames of the capture flow render it (the quick-add sheet and the `/finance/new` page), which
 * is why it is a component rather than the same `EmptyState` written out twice: the copy and the
 * destination are identical in both, and only the sheet has anything extra to do on the way out.
 */
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useT } from "@/lib/i18n";
import { AppLink } from "@/lib/nav";

export interface InviteSecondPersonProps {
  /** Called when the link is followed; the sheet uses it to close itself first. */
  onNavigate?: () => void;
  className?: string;
}

export function InviteSecondPerson({ onNavigate, className }: InviteSecondPersonProps) {
  const t = useT();
  return (
    <EmptyState
      className={className}
      icon={<UserPlus />}
      title={t("finance.nav.household")}
      description={t("finance.settings.household.invite")}
      action={
        <AppLink to="/settings" onClick={onNavigate} className="w-full">
          <Button fullWidth>{t("finance.settings.household.manage")}</Button>
        </AppLink>
      }
    />
  );
}
