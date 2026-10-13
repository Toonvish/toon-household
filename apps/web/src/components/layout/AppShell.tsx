import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { BottomTabBar } from "./BottomTabBar";
import { InstallPrompt } from "./InstallPrompt";
import { OfflineBanner } from "./OfflineBanner";
import { SideNav } from "./SideNav";
import { UnverifiedEmailBanner } from "./UnverifiedEmailBanner";
import { UpdateBanner } from "./UpdateBanner";

/**
 * The authenticated app frame (`RequireAuth` wraps it in router.tsx).
 *  - phones: fixed bottom tab bar, content padded for it (no more sticky top bar — see
 *    the note below),
 *  - >= lg: fixed sidebar + centred content column.
 *
 * `<main>` owns the page's `mx-auto max-w-content px-gutter pt-4 pb-tabbar` — a page
 * root must not re-apply any of them (a doubled `pb-tabbar` leaves a screenful of dead
 * space under the content and strands a sticky bottom bar above the tab bar).
 *
 * It is also a growing FLEX ITEM *and* a flex column itself, so a page root can say
 * `flex-1` and fill the screen — which is how the shopping list pushes its add bar down
 * to the tab bar on a short list. It has to be the flex chain: `min-h-full` on the page
 * root looks equivalent and measurably is not, because a percentage min-height needs a
 * definite parent height and a flex-grown item does not count as one (Chromium leaves
 * the root at its content height, 493px of 695 — the bar then floats mid-screen).
 *
 * `TopBar` is gone (no artboard draws a global phone top bar — each screen's own header
 * carries the household chip and its primary action instead, via `PhoneHeaderRow`), so
 * `pt-safe` moves here, onto the inner column, or a home-screen install renders the
 * first banner under the status bar. `lg:pt-0` because from `lg` the sidebar owns the
 * top edge and the inset is 0 there anyway.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-bg">
      <SideNav />
      <div className="flex min-h-dvh flex-col pt-safe lg:pl-sidebar lg:pt-0">
        <OfflineBanner />
        <UnverifiedEmailBanner />
        <UpdateBanner />
        {/*
          The wider desktop gutter is `--gutter`, NOT `lg:px-8`: the hand-written
          utilities in styles/index.css are emitted after everything Tailwind
          generates, so `.px-gutter` would win over `lg:px-8` (a media query adds no
          specificity) and desktop would quietly keep the phone gutter.
        */}
        <main className="mx-auto flex w-full max-w-content flex-1 flex-col px-gutter pt-4 pb-tabbar lg:pt-8 lg:[--gutter:2rem]">
          <InstallPrompt />
          {children}
        </main>
      </div>
      <BottomTabBar />
    </div>
  );
}

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Buttons on the right (desktop) / below the title (mobile). */
  actions?: ReactNode;
  /** Back link / breadcrumb slot above the title. */
  above?: ReactNode;
  className?: string;
}

/**
 * Consistent screen heading. Other feature agents should use this so every page
 * looks the same: `<PageHeader title="Rezepte" actions={<Button …/>} />`.
 */
export function PageHeader({ title, description, actions, above, className }: PageHeaderProps) {
  return (
    <div className={cn("mb-4 flex flex-col gap-3 sm:mb-6", className)}>
      {above}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-2xl leading-tight font-medium tracking-tight text-fg sm:text-3xl">
            {title}
          </h1>
          {description ? <p className="mt-1 text-sm text-fg-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
