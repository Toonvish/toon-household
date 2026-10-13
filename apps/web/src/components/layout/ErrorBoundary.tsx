import { Component, type ErrorInfo, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { translate } from "@/lib/i18n";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Logo } from "./Logo";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional custom fallback; receives the error and a reset callback. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Global crash barrier. Renders a localized recovery screen instead of a white
 * page and never shows a stack trace to the user (it goes to the console).
 *
 * Uses `translate()`, not `useT()`: this must not depend on the very context
 * tree that may be what broke (see docs/i18n.md §7/§10 rule 6).
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[ui] Unhandled error:", error, info.componentStack);
  }

  private reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg p-4">
        <Card padding="lg" className="w-full max-w-md text-center">
          <Logo className="mx-auto size-12" />
          <h1 className="mt-4 font-display text-display-md font-medium text-fg">
            {translate("common.crash.title")}
          </h1>
          <p className="mt-2 text-sm text-fg-muted">{translate("common.crash.description")}</p>
          <div className="mt-5 flex flex-col gap-2">
            <Button onClick={this.reset} leftIcon={<RefreshCw className="size-4" />} fullWidth>
              {translate("common.crash.retry")}
            </Button>
            <Button
              variant="secondary"
              fullWidth
              onClick={() => {
                window.location.assign("/");
              }}
            >
              {translate("common.crash.home")}
            </Button>
          </div>
        </Card>
      </div>
    );
  }
}
