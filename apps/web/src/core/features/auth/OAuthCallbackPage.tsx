import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { buttonClasses } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingBlock } from "@/components/ui/Spinner";
import { safeNextPath, useGoTo, useSearchParams } from "@/lib/navigation";
import { useSession } from "@/lib/session";
import { useT } from "@/lib/i18n";
import { AuthLayout } from "./AuthLayout";

/**
 * `/oauth/callback` — landing page after the API finished the provider round-trip.
 * The session cookie is already set at this point, so all this screen does is
 * re-run the bootstrap query and forward the user (or explain what went wrong).
 */
export function OAuthCallbackPage() {
  const t = useT();
  const search = useSearchParams();
  const next = safeNextPath(search.next);
  const goTo = useGoTo();
  const { isAuthenticated, isLoading, refetch } = useSession();
  const [timedOut, setTimedOut] = useState(false);
  const started = useRef(false);

  const errorCode = search.error;

  useEffect(() => {
    if (errorCode || started.current) return;
    started.current = true;
    void refetch();
    const timer = setTimeout(() => setTimedOut(true), 8000);
    return () => clearTimeout(timer);
  }, [errorCode, refetch]);

  useEffect(() => {
    if (!errorCode && !isLoading && isAuthenticated) goTo(next, { replace: true });
  }, [errorCode, isLoading, isAuthenticated, next, goTo]);

  if (errorCode) {
    return (
      <AuthLayout title={t("auth.oauthCallback.cancelledTitle")}>
        <ErrorState
          title={t("auth.common.somethingWentWrong")}
          description={
            errorCode === "oauth_not_configured"
              ? t("auth.oauthCallback.notConfigured")
              : t("auth.oauthCallback.incomplete")
          }
          action={
            <Link to="/login" className={buttonClasses({})}>
              {t("auth.common.backToLoginLink")}
            </Link>
          }
        />
      </AuthLayout>
    );
  }

  if (timedOut && !isAuthenticated) {
    return (
      <AuthLayout title={t("auth.oauthCallback.slowTitle")}>
        <ErrorState
          title={t("auth.oauthCallback.noSession.title")}
          description={t("auth.oauthCallback.noSession.description")}
          onRetry={() => {
            void refetch();
          }}
          action={
            <Link to="/login" className={buttonClasses({ variant: "secondary" })}>
              {t("auth.common.loginLink")}
            </Link>
          }
        />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={t("auth.oauthCallback.inProgress.title")}
      description={t("auth.oauthCallback.inProgress.description")}
    >
      <LoadingBlock label={t("auth.oauthCallback.checkingSession")} />
    </AuthLayout>
  );
}

export default OAuthCallbackPage;
