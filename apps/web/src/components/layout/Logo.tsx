import { cn } from "@/lib/cn";

export interface LogoProps {
  className?: string;
  /** Renders without the rounded brand tile (for use on coloured surfaces). */
  bare?: boolean;
  title?: string;
}

/**
 * App mark: a pot with steam. Inline SVG so it needs no network request and
 * follows the current text colour when `bare` is set.
 */
export function Logo({ className, bare = false, title = "Rezepte" }: LogoProps) {
  return (
    <svg
      viewBox="0 0 48 48"
      role="img"
      aria-label={title}
      className={cn("shrink-0", className)}
      xmlns="http://www.w3.org/2000/svg"
    >
      {bare ? null : <rect width="48" height="48" rx="12" fill="var(--brand)" />}
      <g
        fill="none"
        stroke={bare ? "currentColor" : "var(--brand-fg)"}
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* steam */}
        <path d="M18 16.2c1.9-1.5 1.9-3 0-4.5s-1.9-3 0-4.5" />
        <path d="M24 16.2c2.1-1.7 2.1-3.4 0-5.1s-2.1-3.4 0-5.1" />
        <path d="M30 16.2c1.9-1.5 1.9-3 0-4.5s-1.9-3 0-4.5" />
        {/* lid + pot */}
        <path d="M11.5 19.5h25" />
        <path d="M14 19.5h21l-1.7 15.2A4 4 0 0 1 29.3 38h-9.6a4 4 0 0 1-4-3.3Z" />
        <path d="M36.5 22.5h3.2a2.6 2.6 0 0 1 0 5.2h-3.7" />
        <path d="M11.5 22.5H8.3a2.6 2.6 0 0 0 0 5.2h3.7" />
      </g>
    </svg>
  );
}
