import type { ReactNode } from "react";
import { HouseholdSwitcher } from "@/core/features/households/HouseholdSwitcher";
import { ModuleSwitcher } from "./ModuleSwitcher";

/**
 * The phone-only row above a screen's `<h1>`: the active-household chip on the left, the
 * module chip beside it (SPEC D6, §5 — renders nothing while no build module is enabled),
 * one screen-specific action on the right (artboards 1e, 1g). Hidden from `lg`, where the
 * sidebar carries both switchers.
 *
 * It scrolls with the page ON PURPOSE — no `sticky`, no `pt-safe`. `AppShell`'s inner
 * column owns the status-bar inset now that `TopBar` is gone, and a second `pt-safe`
 * here would double it.
 *
 * A `<header>`, not a `<div>`, and that is load-bearing: `print.css` hides
 * `header[data-app-shell]` — the selector `TopBar` was written for and never matched,
 * because no element ever carried the attribute. This row is that future header, so
 * the tag and the attribute together are what keep the chrome off a printed recipe.
 */
export function PhoneHeaderRow({ action }: { action?: ReactNode }) {
  return (
    <header data-app-shell className="flex items-center gap-2.5 lg:hidden">
      <HouseholdSwitcher variant="chip" className="min-w-0 flex-1" />
      <ModuleSwitcher variant="chip" className="max-w-40 shrink-0" />
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}
