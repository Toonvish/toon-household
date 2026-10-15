/**
 * Invite panel (admins/owners only): create an invite by e-mail, copy the ready-made
 * link, and see/revoke pending invites.
 *
 * The API mails the link AND returns it: `inviteUrl` (built from WEB_ORIGIN) plus the
 * raw token, so it can also be shared through any other channel. `mailDelivery` says
 * what became of the mail, and the panel has THREE outcomes rather than two: a
 * delivered mail is a success, "no mail delivery configured" is a warning that the
 * link needs forwarding by hand, and a REFUSED delivery is an error — a configured
 * relay that rejects mail is a broken deployment, and an admin who is told it is "on
 * its way" has no reason to go and look. The invite itself is valid in all three
 * cases, which is why none of them hides the link.
 */
import { useState } from "react";
import { Copy, Link2, MailPlus, Share2, Undo2 } from "lucide-react";
import { z } from "zod";
import {
  EmailSchema,
  type HouseholdInvite,
  type HouseholdInviteResponse,
  type InvitableRole,
  InvitableRoleSchema,
  type MailDelivery,
} from "@toon/shared";
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Input,
  Select,
  Skeleton,
} from "@/components/ui";
import { useToast } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { useT, type MessageKey } from "@/lib/i18n";
import { apiFieldErrors, validate, type FieldErrors } from "@/lib/validation";
import { isApiError } from "@/lib/api";
import { copyToClipboard, shareOrCopy } from "@/lib/share";
import { ROLE_LABEL_KEYS } from "../lib/roleLabels";
import { INVITE_STATUS_LABELS, useCreateInvite, useHouseholdInvites, useRevokeInvite } from "../lib/queries";

/**
 * This panel always sends an address: `CreateInviteRequest.email` is optional only for a claim
 * invite (ADR 0006), which this form never creates. The request schema's plain-invite half,
 * with `email` required, keeps `result.data.email` a string for the toasts.
 */
const InviteFormSchema = z.object({
  email: EmailSchema,
  role: InvitableRoleSchema.default("member"),
});

export interface InvitePanelProps {
  householdId: string;
  householdName: string;
  /** Only admins/owners may list or create invites. */
  enabled: boolean;
}

/** WEB_ORIGIN can differ from where the app is served; rebuild the link defensively. */
function inviteLink(invite: HouseholdInvite, fallbackUrl?: string): string {
  if (fallbackUrl && fallbackUrl.length > 0) return fallbackUrl;
  return `${window.location.origin}/invite/${invite.token}`;
}

/**
 * The server's three outcomes plus `unknown` for one that predates `mailDelivery` —
 * an installed PWA can be running a bundle newer than the API, and the old
 * `emailSent: false` genuinely cannot say which of the two non-deliveries it was.
 */
type InviteMailOutcome = MailDelivery | "unknown";

function outcomeOf(response: HouseholdInviteResponse): InviteMailOutcome {
  if (response.mailDelivery !== undefined) return response.mailDelivery;
  return response.emailSent === true ? "sent" : "unknown";
}

/**
 * How each outcome looks. `failed` is the ONLY one in danger colours: a configured
 * relay that refuses mail is a broken deployment and somebody has to look at the
 * log, whereas the other two are working setups. None of them hides the link —
 * the invite is valid in every case, which is the whole reason the API returns it.
 *
 * Every class here is a LITERAL string on purpose: Tailwind v4 generates only what
 * its scanner finds in the source, so a class assembled at runtime (`fg + "/90"`)
 * would resolve to nothing at all. Hence the spelled-out `hintFg`.
 *
 * `titleKey`/`hintKey` are catalog keys, not rendered strings: this map is a
 * module-level const, and resolving a key at import time would freeze it at
 * whatever locale was active on first load (docs/i18n.md §10 rule 6). The
 * component resolves them with `t()` at render instead.
 */
const MAIL_OUTCOMES: Record<
  InviteMailOutcome,
  { box: string; fg: string; hintFg: string; titleKey: MessageKey; hintKey: MessageKey | null }
> = {
  sent: {
    box: "border-success/40 bg-success-soft",
    fg: "text-success-soft-fg",
    hintFg: "text-success-soft-fg/90",
    titleKey: "household.invite.outcome.sent.title",
    hintKey: null,
  },
  not_configured: {
    box: "border-warning/40 bg-warning-soft",
    fg: "text-warning-soft-fg",
    hintFg: "text-warning-soft-fg/90",
    titleKey: "household.invite.outcome.notConfigured.title",
    hintKey: "household.invite.outcome.notConfigured.hint",
  },
  failed: {
    box: "border-danger/40 bg-danger-soft",
    fg: "text-danger-soft-fg",
    hintFg: "text-danger-soft-fg/90",
    titleKey: "household.invite.outcome.failed.title",
    hintKey: "household.invite.outcome.failed.hint",
  },
  unknown: {
    box: "border-warning/40 bg-warning-soft",
    fg: "text-warning-soft-fg",
    hintFg: "text-warning-soft-fg/90",
    titleKey: "household.invite.outcome.unknown.title",
    hintKey: "household.invite.outcome.unknown.hint",
  },
};

export function InvitePanel({ householdId, householdName, enabled }: InvitePanelProps) {
  const t = useT();
  const invites = useHouseholdInvites(householdId, enabled);
  const createInvite = useCreateInvite();
  const revokeInvite = useRevokeInvite();
  const toast = useToast();

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitableRole>("member");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [lastUrl, setLastUrl] = useState<string | null>(null);
  const [lastOutcome, setLastOutcome] = useState<InviteMailOutcome>("unknown");

  const roleOptions: ReadonlyArray<{ value: InvitableRole; label: string }> = [
    { value: "member", label: t(ROLE_LABEL_KEYS.member) },
    { value: "admin", label: t(ROLE_LABEL_KEYS.admin) },
  ];

  if (!enabled) {
    return (
      <Card padding="md">
        <p className="text-sm text-fg-muted">{t("household.invite.disabledHint")}</p>
      </Card>
    );
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validate(InviteFormSchema, { email, role });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    try {
      const response = await createInvite.mutateAsync({ householdId, ...result.data });
      setErrors({});
      setEmail("");
      setLastUrl(response.inviteUrl);
      const outcome = outcomeOf(response);
      setLastOutcome(outcome);
      const copied = await copyToClipboard(response.inviteUrl);
      // Creating the invite worked in every branch — only the MAIL differs, so the
      // toast reports the mail. Reporting the "invite created" title in success green
      // while the server refused to deliver is how a broken relay stays unnoticed.
      if (outcome === "sent") {
        toast.success(
          t("household.invite.outcome.sent.title"),
          t("household.invite.sentDescription", { email: result.data.email }),
        );
      } else {
        const fallback = copied
          ? t("household.invite.copiedHint")
          : t("household.invite.copyHint");
        toast.toast({
          title:
            outcome === "failed"
              ? t("household.invite.failedToastTitle")
              : t("household.invite.createdNoMailToastTitle"),
          description:
            outcome === "failed"
              ? t("household.invite.failedToastDescription", {
                  email: result.data.email,
                  fallback,
                })
              : fallback,
          variant: outcome === "failed" ? "error" : "warning",
        });
      }
    } catch (error) {
      if (isApiError(error) && error.status === 409) {
        setErrors({ email: t("household.invite.alreadyMemberError") });
        return;
      }
      setErrors(apiFieldErrors(error));
    }
  }

  const pending = (invites.data ?? []).filter((invite) => invite.status === "pending");
  const past = (invites.data ?? []).filter((invite) => invite.status !== "pending");

  return (
    <div className="flex flex-col gap-4">
      <Card padding="md">
        <form onSubmit={submit} noValidate className="flex flex-col gap-3">
          <h3 className="font-medium text-fg">{t("household.invite.formHeading")}</h3>
          {errors._form ? (
            <p role="alert" className="text-sm font-medium text-danger">
              {errors._form}
            </p>
          ) : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
            <Input
              label={t("household.invite.emailLabel")}
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={t("household.invite.emailPlaceholder")}
              error={errors.email}
              disabled={createInvite.isPending}
            />
            <Select
              label={t("household.invite.roleLabel")}
              options={roleOptions}
              value={role}
              onChange={(event) => setRole(event.target.value as InvitableRole)}
              error={errors.role}
              disabled={createInvite.isPending}
            />
          </div>
          <Button
            type="submit"
            loading={createInvite.isPending}
            leftIcon={<MailPlus className="size-4" />}
            className="sm:self-start"
          >
            {t("household.invite.submitButton")}
          </Button>
          <p className="text-sm text-fg-muted">{t("household.invite.formHint")}</p>
        </form>

        {lastUrl ? (
          <div
            className={`mt-3 flex flex-col gap-2 rounded-xl border p-3 ${MAIL_OUTCOMES[lastOutcome].box}`}
          >
            <p className={`text-sm font-medium ${MAIL_OUTCOMES[lastOutcome].fg}`}>
              {t(MAIL_OUTCOMES[lastOutcome].titleKey)}
            </p>
            {MAIL_OUTCOMES[lastOutcome].hintKey === null ? null : (
              <p className={`text-xs ${MAIL_OUTCOMES[lastOutcome].hintFg}`}>
                {t(MAIL_OUTCOMES[lastOutcome].hintKey)}
              </p>
            )}
            <code className="block overflow-x-auto rounded-lg bg-surface p-2 text-xs text-fg">
              {lastUrl}
            </code>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<Copy className="size-4" />}
                onClick={async () => {
                  const ok = await copyToClipboard(lastUrl);
                  if (ok) toast.success(t("household.invite.linkCopiedToast"));
                  else toast.error(t("household.invite.copyFailedToast"));
                }}
              >
                {t("household.invite.copyButton")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<Share2 className="size-4" />}
                onClick={async () => {
                  const result = await shareOrCopy({
                    title: t("household.invite.shareTitle", { name: householdName }),
                    text: t("household.invite.shareText", { name: householdName }),
                    url: lastUrl,
                  });
                  if (result === "copied") toast.success(t("household.invite.linkCopiedToast"));
                }}
              >
                {t("household.invite.shareButton")}
              </Button>
            </div>
          </div>
        ) : null}
      </Card>

      <div className="flex flex-col gap-2">
        <h3 className="font-medium text-fg">{t("household.invite.pendingHeading")}</h3>
        {invites.isPending ? (
          <Skeleton lines={3} />
        ) : invites.isError ? (
          <ErrorState inline error={invites.error} onRetry={() => void invites.refetch()} />
        ) : pending.length === 0 ? (
          <p className="text-sm text-fg-muted">{t("household.invite.pendingEmpty")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {pending.map((invite) => (
              <li key={invite.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  {/* A claim invite may carry no address (ADR 0006): nothing is shown then. */}
                  {invite.email !== null ? (
                    <p className="truncate font-medium text-fg">{invite.email}</p>
                  ) : null}
                  <p className="text-sm text-fg-muted">
                    {t("household.invite.pendingMeta", {
                      role: t(ROLE_LABEL_KEYS[invite.role]),
                      date: formatDate(invite.expiresAt),
                      name: invite.invitedByName,
                    })}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<Link2 className="size-4" />}
                  onClick={async () => {
                    const ok = await copyToClipboard(inviteLink(invite));
                    if (ok) toast.success(t("household.invite.linkCopiedToast"));
                    else toast.error(t("household.invite.copyFailedToast"));
                  }}
                >
                  {t("household.invite.linkButton")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-danger"
                  leftIcon={<Undo2 className="size-4" />}
                  loading={revokeInvite.isPending}
                  onClick={async () => {
                    try {
                      await revokeInvite.mutateAsync({ householdId, inviteId: invite.id });
                      toast.success(t("household.invite.revokedToast"));
                    } catch (error) {
                      toast.fromError(error, t("household.invite.revokeFailedToast"));
                    }
                  }}
                >
                  {t("household.invite.revokeButton")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {past.length > 0 ? (
        <details className="rounded-card border border-line bg-surface p-3">
          <summary className="cursor-pointer text-sm font-medium text-fg">
            {t("household.invite.pastHeading", { count: past.length })}
          </summary>
          <ul className="mt-2 flex flex-col divide-y divide-line">
            {past.map((invite) => (
              <li key={invite.id} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm text-fg-muted">
                  {invite.email}
                </span>
                <Badge variant={invite.status === "accepted" ? "success" : "neutral"} size="sm">
                  {(() => {
                    const statusKey = INVITE_STATUS_LABELS[invite.status];
                    return statusKey ? t(statusKey) : invite.status;
                  })()}
                </Badge>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
