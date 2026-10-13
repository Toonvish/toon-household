import { cn } from "@/lib/cn";
import { mediaUrl } from "@/lib/api";
import { initials } from "@/lib/format";

export interface AvatarProps {
  name: string | null | undefined;
  src?: string | null | undefined;
  size?: "2xs" | "xs" | "sm" | "md" | "lg";
  /** `circle` (default) for a person; `square` for a group avatar. */
  shape?: "circle" | "square";
  /** Ground colour for the initials fallback: `brand` (default, groups) or `accent` (the signed-in user). */
  tone?: "brand" | "accent";
  className?: string;
}

/** `sm`/`md`/`lg` keep their pre-redesign values, so no existing caller changes. */
const sizes = {
  "2xs": "size-5.5 text-[9px]",
  xs: "size-7 text-[11px]",
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-14 text-base",
} as const;

const tones = {
  brand: "bg-brand-soft text-brand-soft-fg",
  accent: "bg-accent text-brand-fg",
} as const;

/** Profile picture with an initials fallback (no layout shift, no broken image icon). */
export function Avatar({ name, src, size = "md", shape = "circle", tone = "brand", className }: AvatarProps) {
  const resolved = mediaUrl(src);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden font-semibold select-none",
        shape === "circle" ? "rounded-full" : "rounded-lg",
        tones[tone],
        sizes[size],
        className,
      )}
      aria-hidden="true"
    >
      {resolved ? (
        <img src={resolved} alt="" className="size-full object-cover" loading="lazy" />
      ) : (
        initials(name)
      )}
    </span>
  );
}
