import { useEffect, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Mail, User as UserIcon, Users } from "lucide-react";
import { RegisterRequestSchema } from "@toon/shared";
import { invitePreviewQuery } from "@/lib/queries";
import { useRegister, useSession } from "@/lib/session";
import { safeNextPath, useGoTo, useSearchParams } from "@/lib/navigation";
import { apiFieldErrors, clearField, validate, type FieldErrors } from "@/lib/validation";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input, PasswordInput } from "@/components/ui/Input";
import { useT } from "@/lib/i18n";
import { AuthLayout } from "./AuthLayout";
import { AuthDivider, OAuthButtons, useHasOAuthProviders } from "./OAuthButtons";

/**
 * `/register` — creates the account. Without an invite the API also creates the
 * first household ("Meine Rezepte" or the name entered here); with `?invite=<token>`
 * the new user joins that group instead.
 */
export function RegisterPage() {
  const t = useT();
  const search = useSearchParams();
  const inviteToken = search.invite;
  const next = safeNextPath(search.next);
  const goTo = useGoTo();
  const { isAuthenticated, isLoading } = useSession();
  const register = useRegister();
  const hasOAuth = useHasOAuthProviders();

  const invite = useQuery({ ...invitePreviewQuery(inviteToken ?? ""), enabled: Boolean(inviteToken) });

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [householdName, setHouseholdName] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});

  useEffect(() => {
    if (!isLoading && isAuthenticated) goTo(next, { replace: true });
  }, [isLoading, isAuthenticated, next, goTo]);

  // Pre-fill the e-mail the invite was addressed to (only while untouched).
  const invitedEmail = invite.data?.email;
  useEffect(() => {
    if (invitedEmail) setEmail((current) => (current.length === 0 ? invitedEmail : current));
  }, [invitedEmail]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = {
      name,
      email,
      password,
      ...(inviteToken ? { inviteToken } : {}),
      ...(!inviteToken && householdName.trim().length > 0 ? { householdName: householdName.trim() } : {}),
    };
    const result = validate(RegisterRequestSchema, payload);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    register.mutate(result.data, {
      onSuccess: () => goTo(next, { replace: true }),
      onError: (error) => setErrors(apiFieldErrors(error)),
    });
  }

  return (
    <AuthLayout
      title={t("auth.register.title")}
      description={
        inviteToken ? t("auth.register.descriptionInvite") : t("auth.register.description")
      }
      footer={
        <>
          {t("auth.register.haveAccount")}{" "}
          <Link
            to="/login"
            search={next === "/" ? {} : { next }}
            className="font-semibold text-brand underline-offset-2 hover:underline"
          >
            {t("auth.common.signIn")}
          </Link>
        </>
      }
    >
      {invite.data ? (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-brand/30 bg-brand-soft p-3 text-sm text-brand-soft-fg">
          <Users className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <p>
            {t("auth.register.invitedBy", {
              name: invite.data.invitedByName,
              groupName: invite.data.householdName,
            })}
          </p>
        </div>
      ) : null}
      {inviteToken && invite.isError ? (
        <ErrorState
          inline
          className="mb-4"
          title={t("auth.register.inviteInvalid.title")}
          description={t("auth.register.inviteInvalid.description")}
        />
      ) : null}

      <OAuthButtons next={next} mode="register" disabled={register.isPending} />
      {hasOAuth ? <AuthDivider label={t("auth.oauth.orWithEmail")} /> : null}

      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {errors._form ? <ErrorState inline description={errors._form} /> : null}

        <Input
          label={t("auth.field.name.label")}
          name="name"
          autoComplete="name"
          required
          leftIcon={<UserIcon />}
          placeholder={t("auth.register.name.placeholder")}
          value={name}
          error={errors.name}
          onChange={(event) => {
            setName(event.currentTarget.value);
            setErrors((current) => clearField(current, "name"));
          }}
        />

        <Input
          label={t("auth.field.email.label")}
          type="email"
          name="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          leftIcon={<Mail />}
          placeholder={t("auth.field.email.placeholder")}
          value={email}
          error={errors.email}
          onChange={(event) => {
            setEmail(event.currentTarget.value);
            setErrors((current) => clearField(current, "email"));
          }}
        />

        <PasswordInput
          label={t("auth.field.password.label")}
          name="password"
          autoComplete="new-password"
          required
          hint={t("auth.password.minLengthHint")}
          placeholder={t("auth.field.password.placeholder")}
          value={password}
          error={errors.password}
          onChange={(event) => {
            setPassword(event.currentTarget.value);
            setErrors((current) => clearField(current, "password"));
          }}
        />

        {!inviteToken ? (
          <Input
            label={t("auth.register.householdName.label")}
            name="householdName"
            optional
            leftIcon={<Users />}
            placeholder={t("auth.register.householdName.placeholder")}
            hint={t("auth.register.householdName.hint")}
            value={householdName}
            error={errors.householdName}
            onChange={(event) => {
              setHouseholdName(event.currentTarget.value);
              setErrors((current) => clearField(current, "householdName"));
            }}
          />
        ) : null}

        <Button type="submit" size="lg" fullWidth loading={register.isPending}>
          {t("auth.register.submit")}
        </Button>
      </form>
    </AuthLayout>
  );
}

export default RegisterPage;
