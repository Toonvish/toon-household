import type { ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import type { OAuthProvider } from "@toon/shared";
import { startOAuth } from "@/lib/api";
import { oauthProvidersQuery } from "@/lib/queries";
import { Button } from "@/components/ui/Button";
import { useT } from "@/lib/i18n";

/** Brand marks are not part of lucide, so they are inlined here. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true" className="size-5">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.34A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.94H.96a9 9 0 0 0 0 8.12l3.01-2.34Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.94l3.01 2.34C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

function GithubMark() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-5" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38l-.01-1.49c-2.23.48-2.7-1.07-2.7-1.07-.36-.93-.89-1.18-.89-1.18-.73-.5.05-.49.05-.49.8.06 1.23.83 1.23.83.72 1.23 1.87.87 2.33.67.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48l-.01 2.2c0 .21.14.46.55.38A7.99 7.99 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

export interface OAuthButtonsProps {
  /** Path the user should land on after the provider round-trip. */
  next?: string | undefined;
  /** "sign in" (default) or "sign up" — only changes the copy. */
  mode?: "login" | "register";
  disabled?: boolean;
}

const MARKS: Record<OAuthProvider, { label: string; mark: () => ReactElement }> = {
  google: { label: "Google", mark: GoogleMark },
  github: { label: "GitHub", mark: GithubMark },
};

/**
 * "Sign in with Google" / "Sign in with GitHub".
 * These are full-page navigations to `GET /api/auth/oauth/:provider` — the API
 * answers with a 302 into the provider's consent screen, so fetch is not an option.
 *
 * ONLY CONFIGURED PROVIDERS ARE RENDERED. `.env.example` ships empty client ids,
 * so on a default install both buttons used to be a dead end: the first tap left
 * the app for raw JSON on the API origin. `GET /api/auth/oauth` says which ones
 * exist; while that is loading nothing is shown, which is better than a button
 * that might not work. (The API also redirects back to /login?error=… now, so a
 * stale cache cannot strand anybody either.)
 */
export function OAuthButtons({ next, mode = "login", disabled = false }: OAuthButtonsProps) {
  const t = useT();
  const key = mode === "register" ? "auth.oauth.signUp" : "auth.oauth.signIn";
  const providers = useQuery(oauthProvidersQuery());
  const available = (providers.data?.providers ?? []).filter((entry) => entry.configured);

  if (available.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {available.map((entry) => {
        const { label, mark: Mark } = MARKS[entry.provider];
        return (
          <Button
            key={entry.provider}
            variant="outline"
            fullWidth
            size="lg"
            disabled={disabled}
            leftIcon={<Mark />}
            onClick={() => startOAuth(entry.provider, next)}
          >
            {t(key, { provider: label })}
          </Button>
        );
      })}
    </div>
  );
}

/** True when at least one provider is usable — lets a caller hide the divider. */
export function useHasOAuthProviders(): boolean {
  const providers = useQuery(oauthProvidersQuery());
  return (providers.data?.providers ?? []).some((entry) => entry.configured);
}

/** "or" divider between the OAuth block and the password form. */
export function AuthDivider({ label }: { label?: string }) {
  const t = useT();
  const text = label ?? t("auth.oauth.or");
  return (
    <div className="my-5 flex items-center gap-3" aria-hidden="true">
      <span className="h-px flex-1 bg-line" />
      <span className="eyebrow text-fg-faint">{text}</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
