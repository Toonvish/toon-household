import { Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, Users } from "lucide-react";
import type { AcceptInviteResponse } from "@toon/shared";
import { acceptInvite } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { ROLE_LABEL_KEYS } from "@/core/features/households/lib/roleLabels";
import { invalidate, invitePreviewQuery } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { useGoTo } from "@/lib/navigation";
import { Button, buttonClasses } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingBlock } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/lib/i18n";
import { AuthLayout } from "./AuthLayout";

/**
 * `/invite/$token` — public landing page for an invite link.
 * Logged in: one tap to join, then the group becomes the active one.
 * Logged out: register (e-mail is pre-filled) or sign in first.
 */
export function InvitePage() {
  const t = useT();
  const params = useParams({ strict: false }) as { token?: string };
  const token = params.token ?? "";
  const queryClient = useQueryClient();
  const toast = useToast();
  const goTo = useGoTo();
  const { isAuthenticated, isLoading, setActiveHousehold } = useSession();

  const preview = useQuery({ ...invitePreviewQuery(token), enabled: token.length > 0 });

  const join = useMutation<AcceptInviteResponse, unknown, void>({
    mutationFn: () => acceptInvite({ token }),
    onSuccess: async (data) => {
      await Promise.all([invalidate.me(queryClient), invalidate.households(queryClient)]);
      setActiveHousehold(data.household.id);
      toast.success(
        t("auth.invite.joined.title"),
        t("auth.invite.joined.description", { groupName: data.household.name }),
      );
      goTo("/", { replace: true });
    },
    onError: (error) => toast.fromError(error, t("auth.invite.joinFailed")),
  });

  if (token.length === 0) {
    return (
      <AuthLayout title={t("auth.invite.title")}>
        <ErrorState
          title={t("auth.invite.missingToken.title")}
          description={t("auth.invite.missingToken.description")}
        />
      </AuthLayout>
    );
  }

  if (preview.isPending || isLoading) {
    return (
      <AuthLayout title={t("auth.invite.title")}>
        <LoadingBlock label={t("auth.invite.checking")} />
      </AuthLayout>
    );
  }

  if (preview.isError || !preview.data) {
    return (
      <AuthLayout title={t("auth.invite.title")}>
        <ErrorState
          error={preview.error}
          title={t("auth.invite.invalid.title")}
          description={t("auth.invite.invalid.description")}
          action={
            <Link to="/login" className={buttonClasses({ variant: "secondary" })}>
              {t("auth.common.loginLink")}
            </Link>
          }
        />
      </AuthLayout>
    );
  }

  const invite = preview.data;
  const usable = invite.status === "pending";

  return (
    <AuthLayout
      title={t("auth.invite.readyTitle")}
      description={t("auth.invite.invitedBy", {
        name: invite.invitedByName,
        groupName: invite.householdName,
      })}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3 rounded-xl border border-line bg-surface-2 p-3">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand-soft-fg"
          >
            <Users className="size-5" />
          </span>
          <div className="min-w-0 text-sm">
            <p className="font-display text-display-xs font-medium text-fg">{invite.householdName}</p>
            {/* A claim invite may carry no address (ADR 0006): the line is left out then. */}
            {invite.email !== null ? (
              <p className="text-fg-muted">
                {t("auth.invite.roleAndEmail", {
                  role: t(ROLE_LABEL_KEYS[invite.role]),
                  email: invite.email,
                })}
              </p>
            ) : null}
            <p className="text-fg-muted">
              {t("auth.invite.validUntil", { date: formatDate(invite.expiresAt) })}
            </p>
          </div>
        </div>

        {!usable ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning-soft p-3 text-sm text-warning-soft-fg"
          >
            <CircleAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            <p>
              {invite.status === "accepted"
                ? t("auth.invite.status.accepted")
                : invite.status === "expired"
                  ? t("auth.invite.status.expired")
                  : t("auth.invite.status.revoked")}
            </p>
          </div>
        ) : null}

        {isAuthenticated ? (
          <Button
            size="lg"
            fullWidth
            disabled={!usable}
            loading={join.isPending}
            onClick={() => join.mutate()}
          >
            {t("auth.invite.join")}
          </Button>
        ) : (
          <div className="flex flex-col gap-2">
            <Link
              to="/register"
              search={{ invite: token }}
              className={buttonClasses({ size: "lg", fullWidth: true })}
            >
              {t("auth.invite.registerAndJoin")}
            </Link>
            <Link
              to="/login"
              search={{ next: `/invite/${token}` }}
              className={buttonClasses({ variant: "secondary", size: "lg", fullWidth: true })}
            >
              {t("auth.invite.haveAccount")}
            </Link>
          </div>
        )}
      </div>
    </AuthLayout>
  );
}

export default InvitePage;
