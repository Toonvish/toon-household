/**
 * The recipe module's display formatters: R `lib/format.ts` §formatMinutes and
 * §formatServingsLabel (R lines 183–201), on top of the core formatters in `@/lib/format`.
 * Their catalog keys moved from `ui.*` to the core `common.*` namespace (Table E).
 */
import { formatDuration, formatServings, type Servings } from "@toon/shared";
import { getLocale, translate } from "@/lib/i18n/store.ts";

export * from "@/lib/format";

/** "1 Std. 15 Min." ("de") / "1 hr 15 min" ("en") — thin wrapper so components don't import @toon/shared directly. */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return translate("common.common.dash");
  return formatDuration(minutes, getLocale());
}

/** "4 Portionen" */
export function formatServingsLabel(
  amount: number | null | undefined,
  unit: string | null | undefined,
): string {
  if (amount === null || amount === undefined) return translate("common.common.dash");
  const servings: Servings = {
    amount,
    unit: unit && unit.length > 0 ? unit : translate("common.servings.defaultUnit"),
  };
  return formatServings(servings);
}
