import type { ReactElement } from "react";
import { PhoneHeaderRow } from "@/components/layout/PhoneHeaderRow";
import { type MessageKey, useT } from "@/lib/i18n";

/**
 * FOUNDATION PLACEHOLDER (M8-T03): what every calendar screen renders until the lane web (M8-T14 … M8-T17) replaces
 * it: the phone header row (ADR 0010) and the screen's title. Imported by the lazy screens only, so the layout
 * components stay out of the manifest's static import graph.
 */
export function PlaceholderScreen({ titleKey }: { titleKey: MessageKey }): ReactElement {
  const t = useT();
  return (
    <div className="mb-4 flex flex-col gap-3 sm:mb-6">
      <PhoneHeaderRow />
      <h1 className="font-display text-display-2xl font-medium text-fg lg:text-display-3xl">{t(titleKey)}</h1>
    </div>
  );
}
