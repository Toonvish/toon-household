/**
 * RecipeHeroMobile — the phone detail screen's 300px bleed-to-edge hero (A04 §6):
 * the big image, a bottom scrim so the overlaid title stays legible, a back button
 * and the overflow trigger floating on top, and the course eyebrow + title sitting
 * in the scrim at the bottom.
 *
 * A recipe with no image keeps the SAME scrim over the existing image-less
 * fallback ground rather than collapsing to zero height — otherwise the two
 * circular controls floating on it would have nothing to sit on (A04 §5/§6 States).
 *
 * `top:50px` in the artboard is the phone frame's own status bar; in the app the
 * shell's `TopBar` already occupies that space, so the two controls sit at `top-4`
 * inside the hero itself here [RECON].
 */
import type { ReactNode } from "react";
import { ChevronLeft, UtensilsCrossed } from "lucide-react";
import type { Tag } from "@toon/shared";
import { ActionMenu, type ActionMenuItem, IconButton } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { CourseEyebrow } from "./CourseEyebrow";

export interface RecipeHeroMobileProps {
  title: string;
  /** Already resolved through `mediaUrl()` — undefined when the recipe has no image. */
  image: string | undefined;
  imageAlt: string;
  tags: ReadonlyArray<Pick<Tag, "name" | "kind">>;
  onBack: () => void;
  actionMenuItems: Array<ActionMenuItem | null | false | undefined>;
  actionMenuTitle: ReactNode;
}

export function RecipeHeroMobile({
  title,
  image,
  imageAlt,
  tags,
  onBack,
  actionMenuItems,
  actionMenuTitle,
}: RecipeHeroMobileProps) {
  const t = useT();
  return (
    <div className="bleed-gutter -mt-4 relative h-[300px] bg-surface-2">
      {image ? (
        <img src={image} alt={imageAlt} className="size-full object-cover" />
      ) : (
        <div className="flex size-full items-center justify-center text-fg-subtle">
          <UtensilsCrossed aria-hidden="true" className="size-12" />
        </div>
      )}

      {/* Keeps the overlaid title legible whether or not there is a photo underneath. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,var(--overlay)_0%,transparent_35%,transparent_55%,var(--bg)_100%)]"
      />

      <IconButton
        label={t("recipe.recipes.detail.backAriaLabel")}
        icon={<ChevronLeft />}
        variant="scrim"
        shape="circle"
        size="sm"
        data-print="hide"
        onClick={onBack}
        className="absolute top-4 left-4"
      />
      <div data-print="hide" className="contents">
        <ActionMenu
          label={t("recipe.recipes.detail.actionsMenuLabel")}
          title={actionMenuTitle}
          items={actionMenuItems}
          triggerVariant="scrim"
          triggerSize="sm"
          // ActionMenu has no `shape` prop of its own (it always renders a square
          // trigger) — `!` forces the override the same way the menu's own sheet
          // radius already does (see ActionMenu.tsx's `sm:rounded-card!` comment):
          // two same-specificity `rounded-*` utilities otherwise resolve by
          // generation order, not by which one is written last here.
          className="absolute top-4 right-4 rounded-full!"
        />
      </div>

      <div className="absolute inset-x-5 bottom-0 flex flex-col gap-2 pb-4">
        <CourseEyebrow tags={tags} className="text-accent" />
        <h1 className="font-display text-display-xl font-medium text-balance">{title}</h1>
      </div>
    </div>
  );
}
