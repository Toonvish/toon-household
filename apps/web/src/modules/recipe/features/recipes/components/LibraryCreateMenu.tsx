import { Plus } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { ActionMenu } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { useEmailVerificationBlock } from "@/lib/session";

/**
 * The library's `+` sheet — the only route to `/recipe/recipes/new` AND `/recipe/import` on a
 * phone (there is no sidebar below `lg`, and the tab bar's "Importieren" tab was
 * absorbed into this menu, see PLAN.md T8.7). Built on `ActionMenu` rather than a
 * second sheet implementation: Escape, the focus trap, the scroll lock and the
 * sheet-on-phone / centred-panel-from-`sm` behaviour all come from `Dialog` for
 * free.
 *
 * Hidden, not disabled, while the account is read-only (unconfirmed e-mail with a
 * mailer configured): both destinations are pure writes, so there is nothing this
 * menu could usefully open onto.
 */
export function LibraryCreateMenu() {
  const t = useT();
  const navigate = useNavigate();
  const emailVerificationBlock = useEmailVerificationBlock();

  if (emailVerificationBlock !== undefined) return null;

  return (
    <ActionMenu
      label={t("recipe.recipes.create.triggerLabel")}
      icon={<Plus />}
      triggerVariant="brand"
      triggerSize="md"
      items={[
        {
          label: t("common.sidenav.newRecipe"),
          description: t("recipe.recipes.create.newRecipeHint"),
          onSelect: () => navigate({ to: "/recipe/recipes/new" }),
        },
        {
          label: t("common.nav.import"),
          description: t("recipe.recipes.create.importHint"),
          onSelect: () => navigate({ to: "/recipe/import" }),
        },
      ]}
    />
  );
}
