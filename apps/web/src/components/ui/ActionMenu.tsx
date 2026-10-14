import { useState, type ReactNode } from "react";
import { Check, EllipsisVertical } from "lucide-react";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { Dialog } from "./Dialog";
import { IconButton, type IconButtonSize, type IconButtonVariant } from "./IconButton";

export interface ActionMenuItem {
  label: string;
  icon?: ReactNode;
  /** Runs AFTER the menu has closed — see the note in `select` below. */
  onSelect: () => void;
  /** Second line under the label, e.g. why an action is unavailable. */
  description?: string;
  variant?: "default" | "danger";
  disabled?: boolean;
  /**
   * The entry that is already in effect (e.g. the active module in the module switcher):
   * the row gets the brand-soft treatment, `aria-current="true"` and a trailing check.
   */
  current?: boolean;
}

/** What {@link ActionMenuProps.renderTrigger} must spread onto its own trigger element. */
export interface ActionMenuTriggerProps {
  onClick: () => void;
  "aria-haspopup": "dialog";
  "aria-expanded": boolean;
}

export interface ActionMenuProps {
  /** aria-label + title of the trigger. */
  label?: string;
  /** Heading of the sheet. Omitted = no heading, just the actions. */
  title?: ReactNode;
  /**
   * Falsy entries are dropped, so a caller can write
   * `items={[share, canEdit && remove]}` without building the array by hand.
   */
  items: Array<ActionMenuItem | null | false | undefined>;
  icon?: ReactNode;
  triggerVariant?: IconButtonVariant;
  triggerSize?: IconButtonSize;
  className?: string;
  /**
   * A custom trigger in place of the default icon-only `IconButton` — for a trigger that
   * has to SAY something (the phone module chip names the active module). Spread the
   * given props onto the element; `label`, `icon`, `triggerVariant`, `triggerSize` and
   * `className` only style the default trigger and are ignored when this is set.
   */
  renderTrigger?: (trigger: ActionMenuTriggerProps) => ReactNode;
}

/**
 * Overflow menu: one icon trigger, actions in a bottom sheet (phones) / centred panel
 * (desktop). Built on `Dialog`, like `GroupSwitcher` — that gives Escape, the focus
 * trap and the scroll lock for free, and keeps one interaction model for both sizes.
 *
 * Use it whenever a header would otherwise grow a row of icon buttons: on a phone that
 * row steals width from the heading next to it and reflows as buttons appear.
 *
 * Two optional extensions (plan m4-design-pass §1 decision 5), both off by default:
 * `renderTrigger` swaps the icon trigger for the caller's own element (the phone module
 * chip), and `ActionMenuItem.current` marks the entry already in effect (the active
 * module), so a "pick one" sheet shares this one interaction model too.
 */
export function ActionMenu({
  label,
  title,
  items,
  icon,
  triggerVariant = "surface",
  triggerSize = "md",
  className,
  renderTrigger,
}: ActionMenuProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const triggerLabel = label ?? t("common.actionMenu.triggerLabel");
  const actions = items.filter((item): item is ActionMenuItem => Boolean(item));

  /**
   * Close first, act afterwards. `Dialog` renders into a portal outside the page, so an
   * action that reads the document — `window.print()` is the one here — must not run
   * until React has taken the panel out of the DOM. React flushes the state update after
   * this handler returns, hence the frame.
   */
  function select(item: ActionMenuItem) {
    setOpen(false);
    requestAnimationFrame(() => item.onSelect());
  }

  if (actions.length === 0) return null;

  const trigger: ActionMenuTriggerProps = {
    onClick: () => setOpen(true),
    "aria-haspopup": "dialog",
    "aria-expanded": open,
  };

  return (
    <>
      {renderTrigger ? (
        renderTrigger(trigger)
      ) : (
        <IconButton
          label={triggerLabel}
          icon={icon ?? <EllipsisVertical />}
          variant={triggerVariant}
          size={triggerSize}
          className={className}
          {...trigger}
        />
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        size="sm"
        // `Dialog`'s default sheet variant is `rounded-t-sheet` on a phone and
        // `sm:rounded-sheet` from `sm` up — right for the phone half (an overflow
        // sheet reads at the same radius as any other sheet), wrong for the desktop
        // half, where this is a small centred panel and reads at the card radius
        // instead. The `!` forces it: two same-specificity `rounded-*` utilities at
        // the same breakpoint otherwise resolve by generation order, not by which one
        // is written last in this className.
        className="sm:rounded-card!"
      >
        <ul className="flex flex-col gap-1 pb-2">
          {actions.map((item) => (
            <li key={item.label}>
              <button
                type="button"
                disabled={item.disabled}
                onClick={() => select(item)}
                aria-current={item.current ? "true" : undefined}
                className={cn(
                  "flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors duration-150",
                  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                  "disabled:pointer-events-none disabled:opacity-55",
                  item.current
                    ? "bg-brand-soft text-brand-soft-fg"
                    : item.variant === "danger"
                      ? "text-danger hover:bg-danger-soft"
                      : "text-fg hover:bg-surface-2",
                )}
              >
                {item.icon ? (
                  <span aria-hidden="true" className="flex shrink-0 [&_svg]:size-5">
                    {item.icon}
                  </span>
                ) : null}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-control">{item.label}</span>
                  {item.description ? (
                    <span className="mt-0.5 block truncate text-xs text-fg-muted">
                      {item.description}
                    </span>
                  ) : null}
                </span>
                {item.current ? <Check className="size-5 shrink-0" aria-hidden="true" /> : null}
              </button>
            </li>
          ))}
        </ul>
      </Dialog>
    </>
  );
}
