import type { ReactNode } from "react";
import { Logo } from "@/components/layout/Logo";
import { Card } from "@/components/ui/Card";

export interface AuthLayoutProps {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  /** Rendered below the card (e.g. "No account yet? Sign up"). */
  footer?: ReactNode;
}

/** Centred, one-handed-friendly frame for all public auth screens. */
export function AuthLayout({ title, description, children, footer }: AuthLayoutProps) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-bg px-gutter py-8">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <Logo className="size-14" />
          <div>
            <h1 className="font-display text-display-2xl font-medium text-fg">{title}</h1>
            {description ? <p className="mt-1 text-sm text-fg-muted">{description}</p> : null}
          </div>
        </div>
        <Card padding="lg">{children}</Card>
        {footer ? <div className="mt-5 text-center text-sm text-fg-muted">{footer}</div> : null}
      </div>
    </div>
  );
}
