import type { FinanceParticipantResponse } from "@toon/shared";
import { Card } from "@/components/ui/Card";
import { useT } from "@/lib/i18n";
import { AppLink } from "@/lib/nav";
import { useActiveHousehold } from "@/lib/session";
import { PageHeader } from "@/modules/finance/components/PageHeader";

/**
 * What a household member without a finance slot sees on every finance screen (M3 decision 3):
 * who keeps the budget, and for owners/admins the way to the participants in Settings. A
 * screen file (behind the lazy gate), so it may use the module's `PageHeader`.
 */
export function NonParticipantState({ participants }: { participants: readonly FinanceParticipantResponse[] }) {
  const t = useT();
  const { hasRole } = useActiveHousehold();
  const first = participants.find((item) => item.memberSlot === 1)?.displayName ?? "";
  const second = participants.find((item) => item.memberSlot === 2)?.displayName ?? "";

  return (
    <>
      <PageHeader title={t("finance.module.name")} />
      <Card padding="lg" className="flex flex-col gap-3">
        <h2 className="font-display text-display-md font-medium text-fg">
          {t("finance.participants.notParticipantTitle")}
        </h2>
        <p className="text-sm text-fg-muted">{t("finance.participants.notParticipantBody", { first, second })}</p>
        {hasRole("admin") ? (
          <>
            <p className="text-sm text-fg-muted">{t("finance.participants.notParticipantAdminHint")}</p>
            <AppLink to="/settings" className="text-sm font-medium text-brand hover:underline">
              {t("finance.participants.toSettings")}
            </AppLink>
          </>
        ) : null}
      </Card>
    </>
  );
}

export default NonParticipantState;
