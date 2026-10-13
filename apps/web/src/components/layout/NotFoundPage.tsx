import { Link } from "@tanstack/react-router";
import { CookingPot } from "lucide-react";
import { useT } from "@/lib/i18n";
import { buttonClasses } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

/** 404 route — reachable both inside and outside the app shell. */
export function NotFoundPage() {
  const t = useT();
  return (
    <div className="flex min-h-[70dvh] items-center justify-center p-4">
      <Card padding="lg" className="w-full max-w-md text-center">
        <span
          aria-hidden="true"
          className="mx-auto flex size-14 items-center justify-center rounded-full bg-brand-soft text-brand-soft-fg"
        >
          <CookingPot className="size-7" />
        </span>
        <p className="eyebrow mt-4 text-fg-faint">404</p>
        <h1 className="mt-1 font-display text-display-md font-medium text-fg">{t("common.notFound.title")}</h1>
        <p className="mt-2 text-sm text-fg-muted">{t("common.notFound.description")}</p>
        <Link to="/" className={buttonClasses({ fullWidth: true, className: "mt-5" })}>
          {t("common.notFound.cta")}
        </Link>
      </Card>
    </div>
  );
}

export default NotFoundPage;
