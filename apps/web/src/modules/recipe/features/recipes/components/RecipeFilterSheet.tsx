/**
 * Phone filter sheet — the same `RecipeFilterFields` as `RecipeFilterRail`, mounted
 * inside a `Dialog` (bottom sheet below `sm`, centred modal from `sm`). `RecipeListPage`
 * opens it from the "Filter" text button next to the search field (`lg:hidden`, since the
 * rail is permanent from `lg` up).
 *
 * A fresh `Dialog` mount is a fresh component tree each time it opens, so `autoFocus`
 * inside `RecipeFilterFields`'s controls (none today, but see `Select`/`Input`) would be
 * safe here even though it is NOT safe against an already-mounted screen — the gotcha
 * that bit the barcode scanner's "Nummer eintippen" field does not apply to a sheet.
 */
import { Dialog } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { RecipeFilterFields, type RecipeFilterRailProps } from "./RecipeFilterRail";

export interface RecipeFilterSheetProps extends RecipeFilterRailProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RecipeFilterSheet({ open, onOpenChange, ...fieldsProps }: RecipeFilterSheetProps) {
  const t = useT();
  return (
    <Dialog
      open={open}
      onClose={() => onOpenChange(false)}
      title={t("recipe.recipes.filters.sheetTitle")}
      variant="sheet"
      size="md"
    >
      {/* The sheet keeps the old horizontal scroller for tag chips — a phone screen is
          wide enough for it and it reads closer to the pre-redesign panel than a wrap
          would, which matters here since there is no artboard to match against. */}
      <RecipeFilterFields {...fieldsProps} tagsLayout="scroll" />
    </Dialog>
  );
}
