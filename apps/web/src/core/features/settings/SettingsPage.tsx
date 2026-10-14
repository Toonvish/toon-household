import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  Check,
  ChevronRight,
  Languages,
  Link2,
  Link2Off,
  LogOut,
  MailWarning,
  Monitor,
  Moon,
  Smartphone,
  Sun,
  Trash2,
  Users,
} from "lucide-react";
import {
  ChangePasswordRequestSchema,
  UpdateProfileRequestSchema,
  type OAuthProvider,
  type OAuthProviderStatus,
  type SessionInfo,
} from "@toon/shared";
import {
  changePassword,
  requestEmailVerification,
  revokeSession,
  startOAuthLink,
  unlinkOAuthProvider,
  updateProfile,
} from "@/lib/api";
import { formatDateTime, formatRelative, truncate } from "@/lib/format";
import { invalidate, oauthProvidersQuery, sessionsQuery } from "@/lib/queries";
import { useSearchParams } from "@/lib/navigation";
import {
  useActiveHousehold,
  useCurrentUser,
  useEmailVerificationBlock,
  useLogout,
  useSession,
} from "@/lib/session";
import { useTheme, type ThemePreference } from "@/lib/theme";
import { apiFieldErrors, validate, type FieldErrors } from "@/lib/validation";
import { PageHeader } from "@/components/layout/AppShell";
import { AppLink } from "@/lib/nav";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input, PasswordInput } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { useLocalePreference, useT, type LocalePreference, type MessageKey } from "@/lib/i18n";
import { WEB_MODULES } from "@/modules";
import { enabledWebModules } from "@/modules/enabled";

/**
 * `/settings` — profile, households, password, appearance, language, sessions, and each enabled module's settings section (SPEC §5).
 */
export function SettingsPage() {
  const t = useT();
  const user = useCurrentUser();
  const { refetch, households } = useSession();
  // `useActiveHousehold()` resolves the persisted choice; `households` is only the count.
  const { household: activeHousehold } = useActiveHousehold();
  const queryClient = useQueryClient();
  const toast = useToast();
  const logout = useLogout();
  const theme = useTheme();

  const [name, setName] = useState(user.name);
  const [profileErrors, setProfileErrors] = useState<FieldErrors>({});

  const saveProfile = useMutation({
    mutationFn: (nextName: string) => {
      const result = validate(UpdateProfileRequestSchema, { name: nextName });
      if (!result.ok)
        return Promise.reject(new Error(result.errors.name ?? t("auth.settings.account.nameInvalid")));
      return updateProfile(result.data);
    },
    onSuccess: async () => {
      setProfileErrors({});
      await Promise.all([invalidate.me(queryClient), refetch()]);
      toast.success(t("auth.settings.account.saved"));
    },
    onError: (error) => setProfileErrors(apiFieldErrors(error)),
  });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <PageHeader title={t("auth.settings.title")} description={t("auth.settings.description")} />

      <Card padding="lg">
        <CardHeader title={t("auth.settings.account.title")} description={user.email} />
        <form
          className="flex flex-col gap-4"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            saveProfile.mutate(name.trim());
          }}
        >
          <Input
            label={t("auth.field.name.label")}
            value={name}
            autoComplete="name"
            error={profileErrors.name ?? profileErrors._form}
            onChange={(event) => setName(event.currentTarget.value)}
          />
          <div className="flex justify-end">
            <Button type="submit" loading={saveProfile.isPending} disabled={name.trim() === user.name}>
              {t("auth.settings.save")}
            </Button>
          </div>
        </form>
      </Card>

      <HouseholdsCard count={households.length} activeHouseholdName={activeHousehold?.name ?? null} />

      {enabledWebModules(WEB_MODULES, activeHousehold?.modules ?? []).flatMap((module) =>
        (module.settingsSections ?? []).map((Section, index) => <Section key={`${module.id}-${index}`} />),
      )}

      <EmailVerificationCard email={user.email} verifiedAt={user.emailVerifiedAt ?? null} />

      <AppearanceCard preference={theme.preference} onChange={theme.setPreference} />

      <LanguageCard />

      <PasswordCard hasPassword={user.hasPassword} />

      <ConnectedAccountsCard hasPassword={user.hasPassword} />

      <SessionsCard />

      <Card padding="lg">
        <CardHeader title={t("auth.common.signOut")} description={t("auth.settings.logout.description")} />
        <Button
          variant="secondary"
          leftIcon={<LogOut className="size-4" />}
          loading={logout.isPending}
          onClick={() => logout.mutate()}
        >
          {t("auth.common.signOut")}
        </Button>
      </Card>
    </div>
  );
}

/**
 * "Confirm e-mail address".
 *
 * Confirming is worth something concrete — it is what makes a mailed password reset
 * trustworthy — but it is NOT a switch that re-enables OAuth auto-linking. The API
 * still answers 409 `email_taken` for a provider login on a taken address; see
 * apps/api/src/services/auth/oauthAccounts.ts for the takeover that prevents.
 */
/**
 * Entry point to household management. Deliberately a LINK, not an inlined household editor: the
 * `/households` screen already owns members, invites and roles, and duplicating it here would
 * be a second implementation of the same rules. On a phone this card is the ONLY way to reach
 * households: the sidebar that also lists them does not exist below `lg`.
 *
 * The active household is named because that is what a member actually wonders on this screen
 * ("which household am I adding recipes to?") — switching it is still the `HouseholdSwitcher` in
 * the top bar, which is where it belongs.
 */
function HouseholdsCard({
  count,
  activeHouseholdName,
}: {
  count: number;
  activeHouseholdName: string | null;
}) {
  const t = useT();
  const description =
    count === 0
      ? t("auth.settings.households.none")
      : activeHouseholdName
        ? t("auth.settings.households.countWithActive", { count, groupName: activeHouseholdName })
        : t("auth.settings.households.count", { count });
  return (
    <Card padding="lg">
      <CardHeader title={t("auth.settings.households.title")} description={description} />
      <AppLink
        to="/households"
        className="flex min-h-11 items-center gap-3 rounded-xl border border-line px-3 text-fg transition-colors duration-150 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <Users aria-hidden="true" className="size-5 shrink-0 text-fg-muted" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-medium">{t("auth.settings.households.manage")}</span>
          <span className="text-xs text-fg-muted">{t("auth.settings.households.manageHint")}</span>
        </span>
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
      </AppLink>
    </Card>
  );
}

/**
 * THE TIMESTAMP DECIDES WHAT THIS CARD SHOWS, not `user.emailVerified`.
 *
 * The boolean used to default to true for every self-registration (see the
 * takeover described in the API's services/auth/emailVerification.ts), so on any
 * deployment older than that fix EVERY legacy account reads
 * `emailVerified: true, emailVerifiedAt: null`. Those accounts are exactly the
 * ones the read-only gate holds, so branching on the boolean would show them a
 * green checkmark on the very screen they were sent to in order to fix it.
 * `emailVerified` is therefore no longer a prop — there is nothing it can
 * correctly be used for here.
 */
function EmailVerificationCard({ email, verifiedAt }: { email: string; verifiedAt: string | null }) {
  const t = useT();
  const toast = useToast();
  const blocked = useEmailVerificationBlock();
  const [sent, setSent] = useState(false);
  const verified = verifiedAt !== null;

  const requestLink = useMutation({
    mutationFn: () => requestEmailVerification(),
    /*
      A 2xx here means "the token exists", NOT "the mail is on its way": the send
      happens after the row is written and never fails the request (trySendMail).
      So the copy follows `mailDelivery` — announcing a mail that the server only
      wrote to its log, or that a relay refused, is worse than saying nothing,
      because the user then waits for it instead of asking the admin.
    */
    onSuccess: (result) => {
      if (result.mailDelivery === "sent") {
        setSent(true);
        toast.success(
          t("auth.common.emailOnTheWay"),
          t("auth.settings.email.sentToast.description", { email }),
        );
        return;
      }
      setSent(false);
      toast.toast({
        title: t("auth.settings.email.notSentToast.title"),
        description:
          result.mailDelivery === "not_configured"
            ? t("auth.settings.email.notConfigured")
            : t("auth.settings.email.deliveryFailed"),
        variant: result.mailDelivery === "not_configured" ? "warning" : "error",
      });
    },
    onError: (error) => {
      const errors = apiFieldErrors(error);
      toast.error(
        t("auth.settings.email.sendFailedTitle"),
        errors._form ?? t("auth.settings.email.sendFailedFallback"),
      );
    },
  });

  if (verified) {
    return (
      <Card padding="lg">
        <CardHeader
          title={t("auth.settings.email.title")}
          description={t("auth.settings.email.confirmedAt", { date: formatDateTime(verifiedAt) })}
        />
        <p className="flex items-center gap-2 text-sm text-success-soft-fg">
          <BadgeCheck aria-hidden className="size-4 shrink-0" />
          <span className="min-w-0 break-all">{email}</span>
        </p>
      </Card>
    );
  }

  return (
    <Card padding="lg">
      <CardHeader
        title={t("auth.settings.email.confirmTitle")}
        description={t("auth.settings.email.notConfirmed")}
      />
      <div className="flex flex-col gap-3">
        {/*
          The sentence is ONE child. Left bare, the icon, the text runs and the <strong>
          were four flex items: each got the container's gap, each wrapped on its own, and
          the address ended up in a ~60px column broken as "smoke / @toon. / test" with the
          comma orphaned on the next line. Same trap as the hint on /import.
        */}
        <p className="flex items-start gap-2 text-sm text-fg-muted">
          <MailWarning aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
          <span>{t("auth.settings.email.confirmHint", { email })}</span>
        </p>
        {/* Only where the server actually enforces it — on an install with no mail
            transport nothing is gated, and promising a restriction that is not
            there would be its own kind of wrong. */}
        {blocked !== undefined ? (
          <p className="rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning-soft-fg">
            {t("auth.settings.email.readOnlyUntilConfirmed")}
          </p>
        ) : null}
        <div className="flex justify-start">
          <Button
            variant="secondary"
            loading={requestLink.isPending}
            onClick={() => requestLink.mutate()}
          >
            {sent ? t("auth.settings.email.resend") : t("auth.settings.email.sendLink")}
          </Button>
        </div>
      </div>
    </Card>
  );
}

const themeOptions: ReadonlyArray<{
  value: ThemePreference;
  labelKey: MessageKey;
  icon: typeof Sun;
}> = [
  { value: "system", labelKey: "auth.settings.theme.system", icon: Monitor },
  { value: "light", labelKey: "auth.settings.theme.light", icon: Sun },
  { value: "dark", labelKey: "auth.settings.theme.dark", icon: Moon },
];

function AppearanceCard({
  preference,
  onChange,
}: {
  preference: ThemePreference;
  onChange: (value: ThemePreference) => void;
}) {
  const t = useT();
  return (
    <Card padding="lg">
      <CardHeader
        title={t("auth.settings.appearance.title")}
        description={t("auth.settings.appearance.description")}
      />
      <div className="grid grid-cols-3 gap-2">
        {themeOptions.map((option) => {
          const active = option.value === preference;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(option.value)}
              className={
                active
                  ? "flex min-h-20 min-w-0 flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-brand bg-brand-soft text-sm font-medium text-brand-soft-fg"
                  : "flex min-h-20 min-w-0 flex-col items-center justify-center gap-1.5 rounded-xl border border-line bg-surface text-sm text-fg-muted hover:bg-surface-2"
              }
            >
              <option.icon className="size-5" aria-hidden="true" />
              <span className="block min-w-0 max-w-full truncate px-1">{t(option.labelKey)}</span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

const languageOptions: ReadonlyArray<{
  value: LocalePreference;
  labelKey: MessageKey;
  icon: typeof Monitor;
}> = [
  { value: "system", labelKey: "auth.settings.language.system", icon: Monitor },
  { value: "de", labelKey: "auth.settings.language.de", icon: Languages },
  { value: "en", labelKey: "auth.settings.language.en", icon: Languages },
];

/**
 * Interface-language picker — the INTERFACE axis only.
 *
 * It must never be mistaken for the recipe's own `language` field: the German
 * unit vocabulary, the ingredient parser and `recipes.language` are the CONTENT
 * axis and are not affected by anything here (see CLAUDE.md's interface-vs-content
 * gotcha). Hence the card's description says so out loud.
 *
 * "System" is a real third state, not a synonym for German: it removes the stored
 * preference so the app keeps following `navigator.languages`, which is what a
 * fresh install does. The hint names the locale that currently resolves to, or a
 * user cannot tell what "System" is actually giving them.
 */
function LanguageCard() {
  const t = useT();
  const { preference, locale, setPreference } = useLocalePreference();
  return (
    <Card padding="lg">
      <CardHeader
        title={t("auth.settings.language.title")}
        description={t("auth.settings.language.description")}
      />
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-3 gap-2">
          {languageOptions.map((option) => {
            const active = option.value === preference;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                onClick={() => setPreference(option.value)}
                className={
                  active
                    ? "flex min-h-20 min-w-0 flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-brand bg-brand-soft text-sm font-medium text-brand-soft-fg"
                    : "flex min-h-20 min-w-0 flex-col items-center justify-center gap-1.5 rounded-xl border border-line bg-surface text-sm text-fg-muted hover:bg-surface-2"
                }
              >
                <option.icon className="size-5" aria-hidden="true" />
                <span className="block min-w-0 max-w-full truncate px-1">{t(option.labelKey)}</span>
              </button>
            );
          })}
        </div>
        {preference === "system" ? (
          <p className="text-xs text-fg-muted">
            {t("auth.settings.language.systemHint", {
              locale: t(locale === "de" ? "auth.settings.language.de" : "auth.settings.language.en"),
            })}
          </p>
        ) : null}
      </div>
    </Card>
  );
}

function PasswordCard({ hasPassword }: { hasPassword: boolean }) {
  const t = useT();
  const toast = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        newPassword,
        ...(hasPassword ? { currentPassword } : {}),
      };
      const result = validate(ChangePasswordRequestSchema, payload);
      if (!result.ok) {
        setErrors(result.errors);
        return Promise.reject(
          new Error(result.errors.newPassword ?? t("auth.settings.password.checkInputs")),
        );
      }
      return changePassword(result.data);
    },
    onSuccess: () => {
      setErrors({});
      setCurrentPassword("");
      setNewPassword("");
      toast.success(t("auth.settings.password.updated"));
    },
    onError: (error) => setErrors(apiFieldErrors(error)),
  });

  const titleKey = hasPassword ? "auth.settings.password.changeTitle" : "auth.settings.password.setTitle";

  return (
    <Card padding="lg">
      <CardHeader
        title={t(titleKey)}
        description={
          hasPassword
            ? t("auth.password.minLengthHint")
            : t("auth.settings.password.oauthOnlyHint")
        }
      />
      <form
        className="flex flex-col gap-4"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        {errors._form ? <ErrorState inline description={errors._form} /> : null}
        {hasPassword ? (
          <PasswordInput
            label={t("auth.settings.password.current.label")}
            autoComplete="current-password"
            value={currentPassword}
            error={errors.currentPassword}
            onChange={(event) => setCurrentPassword(event.currentTarget.value)}
          />
        ) : null}
        <PasswordInput
          label={t("auth.password.new.label")}
          autoComplete="new-password"
          value={newPassword}
          error={errors.newPassword}
          onChange={(event) => setNewPassword(event.currentTarget.value)}
        />
        <div className="flex justify-end">
          <Button type="submit" loading={save.isPending} disabled={newPassword.length === 0}>
            {t(titleKey)}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/**
 * "Link Google/GitHub".
 *
 * This is the ONLY way a password account and an OAuth identity end up on one
 * user: the API deliberately no longer links them automatically when the
 * addresses match, because self-registration cannot prove address ownership and
 * auto-linking made pre-registering someone else's e-mail a full account
 * takeover. See services/auth/oauthAccounts.ts.
 */
function ConnectedAccountsCard({ hasPassword }: { hasPassword: boolean }) {
  const t = useT();
  const queryClient = useQueryClient();
  const toast = useToast();
  const search = useSearchParams();
  const providers = useQuery(oauthProvidersQuery());
  const [pendingUnlink, setPendingUnlink] = useState<OAuthProviderStatus | null>(null);

  // The link round-trip comes back as /settings?linked=google (or ?error=…).
  const linked = search.linked;
  const linkError = search.error;
  useEffect(() => {
    if (linked) {
      toast.success(t("auth.settings.oauth.linkedToast", { provider: PROVIDER_LABELS[linked] ?? linked }));
      void invalidate.oauthProviders(queryClient);
    } else if (linkError) {
      toast.error(oauthLinkErrorMessage(t, linkError));
    }
    // Only react to the query string, not to the freshly created callbacks.
  }, [linked, linkError]);

  const unlink = useMutation({
    mutationFn: (provider: OAuthProvider) => unlinkOAuthProvider(provider),
    onSuccess: async () => {
      await invalidate.oauthProviders(queryClient);
      toast.success(t("auth.settings.oauth.unlinked"));
    },
    onError: (error) => toast.fromError(error, t("auth.settings.oauth.unlinkFailed")),
  });

  const configured = (providers.data?.providers ?? []).filter((entry) => entry.configured);
  if (providers.isPending) return null;
  if (configured.length === 0) {
    return (
      <Card padding="lg">
        <CardHeader
          title={t("auth.settings.oauth.title")}
          description={t("auth.settings.oauth.noneConfigured")}
        />
      </Card>
    );
  }

  const linkedCount = configured.filter((entry) => entry.linked).length;

  return (
    <Card padding="lg">
      <CardHeader
        title={t("auth.settings.oauth.title")}
        description={t("auth.settings.oauth.description")}
      />
      <ul className="flex flex-col divide-y divide-line">
        {configured.map((entry) => {
          // Never let the user remove their last way in.
          const isLastMethod = entry.linked && linkedCount === 1 && !hasPassword;
          return (
            <li key={entry.provider} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-medium text-fg">{PROVIDER_LABELS[entry.provider]}</p>
                <p className="truncate text-fg-muted">
                  {entry.linked
                    ? (entry.linkedEmail ?? t("auth.settings.oauth.linkedFallback"))
                    : t("auth.settings.oauth.notLinked")}
                </p>
              </div>
              {entry.linked ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isLastMethod}
                  title={isLastMethod ? t("auth.settings.oauth.setPasswordFirst") : undefined}
                  leftIcon={<Link2Off className="size-4" />}
                  onClick={() => setPendingUnlink(entry)}
                >
                  {t("auth.settings.oauth.unlink")}
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<Link2 className="size-4" />}
                  onClick={() => startOAuthLink(entry.provider)}
                >
                  {t("auth.settings.oauth.link")}
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={pendingUnlink !== null}
        onClose={() => setPendingUnlink(null)}
        title={t("auth.settings.oauth.unlinkConfirm.title")}
        description={t("auth.settings.oauth.unlinkConfirm.description")}
        confirmLabel={t("auth.settings.oauth.unlink")}
        destructive
        onConfirm={async () => {
          if (pendingUnlink) await unlink.mutateAsync(pendingUnlink.provider);
        }}
      />
    </Card>
  );
}

const PROVIDER_LABELS: Record<string, string> = { google: "Google", github: "GitHub" };

function oauthLinkErrorMessage(t: ReturnType<typeof useT>, code: string): string {
  if (code === "oauth_already_linked") {
    return t("auth.settings.oauth.error.alreadyLinked");
  }
  if (code === "oauth_not_configured") {
    return t("auth.settings.oauth.error.notConfigured");
  }
  return t("auth.settings.oauth.error.generic");
}

function SessionsCard() {
  const t = useT();
  const queryClient = useQueryClient();
  const toast = useToast();
  const sessions = useQuery(sessionsQuery());
  const [pendingRevoke, setPendingRevoke] = useState<SessionInfo | null>(null);

  const revoke = useMutation({
    mutationFn: (sessionId: string) => revokeSession(sessionId),
    onSuccess: async () => {
      await invalidate.sessions(queryClient);
      toast.success(t("auth.settings.sessions.revoked"));
    },
    onError: (error) => toast.fromError(error, t("auth.settings.sessions.revokeFailed")),
  });

  return (
    <Card padding="lg">
      <CardHeader
        title={t("auth.settings.sessions.title")}
        description={t("auth.settings.sessions.description")}
      />
      {sessions.isPending ? (
        <Skeleton lines={3} />
      ) : sessions.isError ? (
        <ErrorState
          inline
          error={sessions.error}
          onRetry={() => {
            void sessions.refetch();
          }}
        />
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {sessions.data.items.map((session) => (
            <li key={session.id} className="flex items-center gap-3 py-3">
              <span
                aria-hidden="true"
                className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-fg-muted"
              >
                <Smartphone className="size-5" />
              </span>
              <div className="min-w-0 flex-1 text-sm">
                <p className="flex items-center gap-2 font-medium text-fg">
                  {truncate(session.userAgent ?? t("auth.settings.sessions.unknownDevice"), 42)}
                  {session.current ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-xs font-semibold text-success-soft-fg">
                      <Check className="size-3" aria-hidden="true" />
                      {t("auth.settings.sessions.thisDevice")}
                    </span>
                  ) : null}
                </p>
                <p className="text-fg-muted">
                  {t("auth.settings.sessions.lastActive", {
                    relative: formatRelative(session.lastUsedAt),
                    date: formatDateTime(session.createdAt),
                  })}
                </p>
              </div>
              {!session.current ? (
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<Trash2 className="size-4" />}
                  onClick={() => setPendingRevoke(session)}
                >
                  {t("auth.common.signOut")}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={pendingRevoke !== null}
        onClose={() => setPendingRevoke(null)}
        title={t("auth.settings.sessions.revokeConfirm.title")}
        description={t("auth.settings.sessions.revokeConfirm.description")}
        confirmLabel={t("auth.common.signOut")}
        destructive
        onConfirm={async () => {
          if (pendingRevoke) await revoke.mutateAsync(pendingRevoke.id);
        }}
      />
    </Card>
  );
}

export default SettingsPage;
