import { cn } from "@/lib/cn";

export interface LogoProps {
  className?: string;
  /** Renders without the rounded brand tile (for use on coloured surfaces). */
  bare?: boolean;
  title?: string;
}

/**
 * App mark: a house (lucide "House", ISC license) on the brand tile, the same artwork as
 * public/favicon.svg and the generated PWA icons (scripts/icons.ts). Inline SVG so it needs no
 * network request and follows the current text colour when `bare` is set.
 */
export function Logo({ className, bare = false, title = "Haushalt" }: LogoProps) {
  return (
    <svg
      viewBox="0 0 48 48"
      role="img"
      aria-label={title}
      className={cn("shrink-0", className)}
      xmlns="http://www.w3.org/2000/svg"
    >
      {bare ? null : <rect width="48" height="48" rx="11" fill="var(--brand)" />}
      <g
        transform="translate(6 6) scale(1.5)"
        fill="none"
        stroke={bare ? "currentColor" : "var(--brand-fg)"}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
        <path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      </g>
    </svg>
  );
}
