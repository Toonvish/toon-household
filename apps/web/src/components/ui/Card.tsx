import type { ElementType, HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface CardProps extends HTMLAttributes<HTMLElement> {
  /** `none` when the card contains a full-bleed image or list. */
  padding?: "none" | "sm" | "md" | "lg";
  /** Adds hover/active feedback for cards that are links or buttons. */
  interactive?: boolean;
  /**
   * The design's panels are flat — no shadow, a hairline border is the texture —
   * so this defaults to `"none"`. `"pop"` is for the two lifted phone bars that ask
   * for it explicitly (`shadow-pop`); there is no `radius` prop (R13).
   */
  shadow?: "none" | "card" | "pop";
  /** Render as another element, e.g. `as="li"` inside a list. */
  as?: "div" | "section" | "article" | "li";
}

const paddings = { none: "", sm: "p-3", md: "p-4", lg: "p-5 sm:p-6" } as const;
const shadows = { none: "", card: "shadow-card", pop: "shadow-pop" } as const;

export function Card({
  padding = "md",
  interactive = false,
  shadow = "none",
  as = "div",
  className,
  children,
  ...rest
}: CardProps) {
  const Tag = as as ElementType;
  return (
    <Tag
      className={cn(
        "rounded-card border border-line bg-surface text-fg",
        shadows[shadow],
        paddings[padding],
        interactive &&
          "transition-[transform,box-shadow,border-color] duration-150 hover:border-line-strong active:scale-[0.995]",
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-3 flex items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <h2 className="font-display text-display-md font-medium text-fg">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-fg-muted">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
