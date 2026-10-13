import { useEffect, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, Mail } from "lucide-react";
import { LoginRequestSchema } from "@toon/shared";
import { useLogin, useSession } from "@/lib/session";
import { safeNextPath, useGoTo, useSearchParams } from "@/lib/navigation";
import { apiFieldErrors, clearField, validate, type FieldErrors } from "@/lib/validation";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input, PasswordInput } from "@/components/ui/Input";
import { useT } from "@/lib/i18n";
import { AuthLayout } from "./AuthLayout";
import { AuthDivider, OAuthButtons, useHasOAuthProviders } from "./OAuthButtons";

/** `/login` — e-mail + password and both OAuth providers. */
export function LoginPage() {
  const t = useT();
  const search = useSearchParams();
  const next = safeNextPath(search.next);
  const goTo = useGoTo();
  const { isAuthenticated, isLoading } = useSession();
  const login = useLogin();
  const hasOAuth = useHasOAuthProviders();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});

  // Already signed in? Skip the form.
  useEffect(() => {
    if (!isLoading && isAuthenticated) goTo(next, { replace: true });
  }, [isLoading, isAuthenticated, next, goTo]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validate(LoginRequestSchema, { email, password });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    login.mutate(result.data, {
      onSuccess: () => goTo(next, { replace: true }),
      onError: (error) => setErrors(apiFieldErrors(error)),
    });
  }

  return (
    <AuthLayout
      title={t("auth.login.title")}
      description={t("auth.login.description")}
      footer={
        <>
          {t("auth.login.noAccount")}{" "}
          <Link
            to="/register"
            search={next === "/" ? {} : { next }}
            className="font-semibold text-brand underline-offset-2 hover:underline"
          >
            {t("auth.login.registerLink")}
          </Link>
        </>
      }
    >
      {search.error ? (
        <ErrorState
          inline
          className="mb-4"
          title={t("auth.login.error.title")}
          description={oauthErrorMessage(t, search.error)}
        />
      ) : null}

      {/* `?reset=1` is set by ResetPasswordPage: the reset revoked every session, so
          landing here and being asked to sign in again is the expected outcome, not
          an error. */}
      {search.reset === "1" ? (
        <p
          role="status"
          className="mb-4 flex items-start gap-2 rounded-card border border-success/30 bg-success-soft p-3 text-sm text-success-soft-fg"
        >
          <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t("auth.login.resetSuccess")}
        </p>
      ) : null}

      <OAuthButtons next={next} disabled={login.isPending} />
      {hasOAuth ? <AuthDivider label={t("auth.oauth.orWithEmail")} /> : null}

      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {errors._form ? <ErrorState inline description={errors._form} /> : null}

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

        <div className="flex flex-col gap-1.5">
          <PasswordInput
            label={t("auth.field.password.label")}
            name="password"
            autoComplete="current-password"
            required
            placeholder={t("auth.field.password.placeholder")}
            value={password}
            error={errors.password}
            onChange={(event) => {
              setPassword(event.currentTarget.value);
              setErrors((current) => clearField(current, "password"));
            }}
          />
          <Link
            to="/forgot-password"
            className="self-end text-sm font-medium text-brand underline-offset-2 hover:underline"
          >
            {t("auth.login.forgotPasswordLink")}
          </Link>
        </div>

        <Button type="submit" size="lg" fullWidth loading={login.isPending}>
          {t("auth.login.submit")}
        </Button>
      </form>
    </AuthLayout>
  );
}

function oauthErrorMessage(t: ReturnType<typeof useT>, code: string | undefined): string {
  switch (code) {
    case "oauth_not_configured":
      return t("auth.login.error.notConfigured");
    case "oauth_failed":
      return t("auth.login.error.cancelled");
    case "unauthorized":
      return t("auth.login.error.sessionExpired");
    default:
      return t("auth.login.error.generic");
  }
}

export default LoginPage;
