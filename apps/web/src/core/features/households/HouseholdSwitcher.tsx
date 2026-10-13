import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Check, ChevronDown, Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { useActiveHousehold } from "@/lib/session";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ROLE_LABEL_KEYS } from "./lib/roleLabels";

export interface HouseholdSwitcherProps {
  /**
   * `chip` = the artboards' quiet inline chip (a 22px initials tile, a truncating
   * name and a chevron, in a 44px hit target) — the top bar's default. `block` =
   * the bordered full-width button for the sidebar, with a 28px tile and the
   * two-line name/summary stack.
   */
  variant?: "chip" | "block";
  className?: string;
}

/**
 * Active-household switcher. Everything household-scoped (recipes, tags, collections,
 * imports) follows this selection, which is persisted per device.
 */
export function HouseholdSwitcher({ variant = "chip", className }: HouseholdSwitcherProps) {
  const t = useT();
  const { household, households, householdId, setActiveHousehold } = useActiveHousehold();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const label = household?.name ?? t("household.switcher.noGroup");

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          "flex min-h-11 items-center gap-2 rounded-xl px-2.5 text-left transition-colors duration-150 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          variant === "block" && "w-full border border-line bg-surface px-3 shadow-soft",
          className,
        )}
      >
        <Avatar
          name={household?.name}
          shape="square"
          tone="brand"
          size={variant === "block" ? "xs" : "2xs"}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-fg">{label}</span>
          {variant === "block" && household ? (
            <span className="block truncate text-xs text-fg-muted">
              {t("household.count.members", { count: household.memberCount })}
            </span>
          ) : null}
        </span>
        <ChevronDown className="size-4 shrink-0 text-fg-muted" aria-hidden="true" />
      </button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t("household.switcher.title")}
        description={t("household.switcher.description")}
        size="sm"
      >
        <ul className="flex flex-col gap-1 pb-2">
          {households.map((entry) => {
            const active = entry.id === householdId;
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => {
                    if (!active) setActiveHousehold(entry.id);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full min-h-14 items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors duration-150",
                    active ? "bg-brand-soft" : "hover:bg-surface-2",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium text-fg">{entry.name}</span>
                      <Badge size="sm" variant={active ? "brand" : "neutral"}>
                        {t(ROLE_LABEL_KEYS[entry.role])}
                      </Badge>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-fg-muted">
                      {t("household.count.members", { count: entry.memberCount })}
                    </span>
                  </span>
                  {active ? (
                    <Check className="size-5 shrink-0 text-brand" aria-hidden="true" />
                  ) : null}
                </button>
              </li>
            );
          })}
          {households.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-fg-muted">
              {t("household.switcher.empty")}
            </li>
          ) : null}
        </ul>

        <Button
          variant="secondary"
          fullWidth
          leftIcon={<Plus className="size-4" />}
          onClick={() => {
            setOpen(false);
            void navigate({ to: "/households" });
          }}
        >
          {t("household.switcher.manageButton")}
        </Button>
      </Dialog>
    </>
  );
}

export default HouseholdSwitcher;
