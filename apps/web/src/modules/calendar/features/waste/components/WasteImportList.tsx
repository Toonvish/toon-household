import type { CalendarWasteImport } from "@toon/shared";
import { FileText, Trash2 } from "lucide-react";
import { useState } from "react";
import { Card, ConfirmDialog, IconButton, useToast } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { useDeleteWasteImport } from "@/modules/calendar/lib/queries";

/** The imports, newest year first (plan m8 P16): year and tour, the source, the number of pickups; deletable as a unit. */
export function WasteImportList({
  householdId,
  imports,
  canMutate,
}: {
  householdId: string;
  imports: ReadonlyArray<CalendarWasteImport>;
  canMutate: boolean;
}) {
  const t = useT();
  const toast = useToast();
  const remove = useDeleteWasteImport(householdId);
  const [pending, setPending] = useState<CalendarWasteImport | null>(null);

  return (
    <Card as="section" aria-labelledby="calendar-waste-imports" className="flex min-w-0 flex-col gap-3">
      <h2 id="calendar-waste-imports" className="font-display text-display-md font-medium text-fg">
        {t("calendar.waste.imports.title")}
      </h2>
      {imports.length === 0 ? (
        <p className="text-sm text-fg-muted">{t("calendar.waste.imports.empty")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {imports.map((item) => (
            <li key={item.id} className="flex min-w-0 items-center gap-3 py-2">
              <FileText aria-hidden="true" className="size-5 shrink-0 text-fg-muted" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="font-medium text-fg">{t("calendar.waste.imports.row", { year: item.year, tour: item.tour })}</span>
                <span className="text-sm break-words text-fg-muted">
                  {t("calendar.waste.imports.entries", { count: item.entryCount })}
                  {" · "}
                  {item.source === "url" ? t("calendar.waste.imports.fromUrl") : t("calendar.waste.imports.fromUpload", { name: item.sourceName })}
                  {" · "}
                  {formatDate(item.importedAt)}
                </span>
              </div>
              {canMutate ? (
                <IconButton
                  label={t("calendar.waste.imports.delete")}
                  variant="danger"
                  icon={<Trash2 />}
                  onClick={() => setPending(item)}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        onConfirm={() => {
          if (pending === null) return;
          remove.mutate(pending.id, {
            onSuccess: () => toast.success(t("calendar.waste.imports.deleted")),
            onError: (error) => toast.fromError(error),
          });
          setPending(null);
        }}
        title={t("calendar.waste.imports.deleteConfirm", { year: pending?.year ?? "" })}
        description={t("calendar.waste.imports.deleteDescription")}
        confirmLabel={t("calendar.common.delete")}
        cancelLabel={t("calendar.common.cancel")}
        destructive
      />
    </Card>
  );
}
