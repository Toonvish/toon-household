import { useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, Mail } from "lucide-react";
import { ForgotPasswordRequestSchema } from "@toon/shared";
import { useMutation } from "@tanstack/react-query";
import { requestPasswordReset } from "@/lib/api";
import { apiFieldErrors, clearField, validate, type FieldErrors } from "@/lib/validation";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/Input";
import { useT } from "@/lib/i18n";
import { AuthLayout } from "./AuthLayout";

/**
 * `/forgot-password` — asks for a reset link.
 *
 * THE CONFIRMATION IS THE SAME NO MATTER WHAT. The API answers 204 for a known and
 * an unknown address alike so it cannot be used to find out who has an account
 * here, and this screen must not undo that: it shows one "If there is an account
 * with this address …" panel on success, never "E-mail not found". The only
 * failures rendered are the ones that say nothing about the account — a malformed
 * address (client-side) and a rate limit.
 */
export function ForgotPasswordPage() {
  const t = useT();
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submittedTo, setSubmittedTo] = useState<string | null>(null);

  const requestReset = useMutation({
    mutationFn: (address: string) => requestPasswordReset({ email: address }),
    onSuccess: (_data, address) => setSubmittedTo(address),
    onError: (error) => setErrors(apiFieldErrors(error)),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validate(ForgotPasswordRequestSchema, { email });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    requestReset.mutate(result.data.email);
  }

  if (submittedTo !== null) {
    return (
      <AuthLayout
        title={t("auth.forgotPassword.sent.title")}
        description={t("auth.forgotPassword.sent.description")}
        footer={
          <Link to="/login" className="font-semibold text-brand underline-offset-2 hover:underline">
            {t("auth.common.backToLoginLink")}
          </Link>
        }
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <CheckCircle2 aria-hidden className="size-10 text-success" />
          <p className="text-sm text-fg">
            {t("auth.forgotPassword.sent.lead", { email: submittedTo })}
          </p>
          <p className="text-sm text-fg-muted">{t("auth.forgotPassword.sent.hint")}</p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSubmittedTo(null);
              requestReset.reset();
            }}
          >
            {t("auth.forgotPassword.sent.useOther")}
          </Button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={t("auth.forgotPassword.title")}
      description={t("auth.forgotPassword.description")}
      footer={
        <>
          {t("auth.forgotPassword.rememberedPrompt")}{" "}
          <Link to="/login" className="font-semibold text-brand underline-offset-2 hover:underline">
            {t("auth.common.loginLink")}
          </Link>
        </>
      }
    >
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

        <Button type="submit" size="lg" fullWidth loading={requestReset.isPending}>
          {t("auth.forgotPassword.submit")}
        </Button>

        <p className="text-xs text-fg-muted">{t("auth.forgotPassword.oauthHint")}</p>
      </form>
    </AuthLayout>
  );
}

export default ForgotPasswordPage;
