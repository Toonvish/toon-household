import { useState, type FormEvent } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { PasswordSchema } from "@toon/shared";
import { isApiError, resetPassword } from "@/lib/api";
import { useGoTo } from "@/lib/navigation";
import { apiFieldErrors, clearField, validate, type FieldErrors } from "@/lib/validation";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";
import { PasswordInput } from "@/components/ui/Input";
import { useT } from "@/lib/i18n";
import { AuthLayout } from "./AuthLayout";

/**
 * `/reset-password/$token` — sets a new password from a mailed link.
 *
 * Sends the user to `/login` afterwards rather than signing them in: the reset
 * deletes EVERY session of that account (a stolen cookie is exactly what someone
 * resets because of), so the next step is a normal login with the new password.
 *
 * A dead link (unknown, expired or already used) is one indistinguishable
 * `reset_token_invalid` from the API — this screen offers "neu anfordern" instead of
 * guessing which of the three it was.
 */
export function ResetPasswordPage() {
  const t = useT();
  const { token } = useParams({ from: "/reset-password/$token" });
  const goTo = useGoTo();

  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});

  const submitReset = useMutation({
    mutationFn: (value: string) => resetPassword({ token, password: value }),
    onSuccess: () => {
      goTo("/login?reset=1", { replace: true });
    },
    onError: (error) => setErrors(apiFieldErrors(error)),
  });

  const tokenDead =
    isApiError(submitReset.error) && submitReset.error.code === "reset_token_invalid";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validate(PasswordSchema, password);
    if (!result.ok) {
      setErrors({
        password: result.errors.password ?? result.errors._form ?? t("auth.resetPassword.passwordInvalid"),
      });
      return;
    }
    if (password !== repeat) {
      setErrors({ repeat: t("auth.resetPassword.passwordMismatch") });
      return;
    }
    setErrors({});
    submitReset.mutate(result.data);
  }

  if (tokenDead) {
    return (
      <AuthLayout
        title={t("auth.common.linkExpiredTitle")}
        description={t("auth.resetPassword.expired.description")}
      >
        <div className="flex flex-col gap-4">
          <ErrorState
            inline
            title={t("auth.resetPassword.requestNew.action")}
            description={t("auth.resetPassword.requestNew.description")}
          />
          <Link to="/forgot-password">
            <Button size="lg" fullWidth>
              {t("auth.resetPassword.requestNew.action")}
            </Button>
          </Link>
          <Link
            to="/login"
            className="text-center text-sm font-semibold text-brand underline-offset-2 hover:underline"
          >
            {t("auth.common.backToLoginLink")}
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={t("auth.resetPassword.title")}
      description={t("auth.resetPassword.description")}
      footer={
        <Link to="/login" className="font-semibold text-brand underline-offset-2 hover:underline">
          {t("auth.common.backToLoginLink")}
        </Link>
      }
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {errors._form ? <ErrorState inline description={errors._form} /> : null}

        <PasswordInput
          label={t("auth.password.new.label")}
          name="password"
          autoComplete="new-password"
          required
          placeholder={t("auth.field.password.placeholder")}
          hint={t("auth.password.minLengthHint")}
          value={password}
          error={errors.password}
          onChange={(event) => {
            setPassword(event.currentTarget.value);
            setErrors((current) => clearField(current, "password"));
          }}
        />

        <PasswordInput
          label={t("auth.resetPassword.repeat.label")}
          name="repeat"
          autoComplete="new-password"
          required
          placeholder={t("auth.field.password.placeholder")}
          value={repeat}
          error={errors.repeat}
          onChange={(event) => {
            setRepeat(event.currentTarget.value);
            setErrors((current) => clearField(current, "repeat"));
          }}
        />

        <Button type="submit" size="lg" fullWidth loading={submitReset.isPending}>
          {t("auth.resetPassword.submit")}
        </Button>

        <p className="flex items-start gap-2 text-xs text-fg-muted">
          <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t("auth.resetPassword.securityNote")}
        </p>
      </form>
    </AuthLayout>
  );
}

export default ResetPasswordPage;
