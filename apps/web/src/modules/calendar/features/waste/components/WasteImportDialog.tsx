import {
  CALENDAR_LIMITS,
  WASTE_CATEGORIES,
  WASTE_PROVIDERS,
  type CalendarWasteImport,
  type CalendarWastePreview,
} from "@toon/shared";
import { useState, type ChangeEvent } from "react";
import { Button, Dialog, Input, Select, Tabs, useToast } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { WasteDot } from "@/modules/calendar/components/WasteDot";
import { formatShortDate, wasteLabel } from "@/modules/calendar/lib/format";
import { useImportWaste, usePreviewWaste, type WasteSource } from "@/modules/calendar/lib/queries";
import { wasteErrorMessage } from "../lib/errors";
import { TOURS } from "./WasteSettingsForm";

type SourceType = "url" | "file";

/**
 * Abfallkalender importieren (design §5, plan m8 P17, P20): the tour, the source (the city's URL, prefilled with the
 * provider's default or the last one used, or an uploaded PDF), "Vorschau" (counts per type and the parser's notes;
 * nothing is written), then "Importieren". Every refusal has its own sentence (`wasteErrorMessage`).
 */
export function WasteImportDialog({
  open,
  onClose,
  householdId,
  today,
  initialTour,
  initialUrl,
  imports,
}: {
  open: boolean;
  onClose: () => void;
  householdId: string;
  today: string;
  initialTour: string;
  initialUrl: string;
  imports: ReadonlyArray<CalendarWasteImport>;
}) {
  const t = useT();
  const toast = useToast();
  const preview = usePreviewWaste(householdId);
  const runImport = useImportWaste(householdId);
  const [tour, setTour] = useState(initialTour);
  const [sourceType, setSourceType] = useState<SourceType>("url");
  const [url, setUrl] = useState(initialUrl);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<CalendarWastePreview | null>(null);
  const [problem, setProblem] = useState<{ message: string; hint?: string } | null>(null);

  function reset() {
    setResult(null);
    setProblem(null);
  }

  function source(): WasteSource | null {
    const tourNumber = Number(tour);
    if (tour === "" || !Number.isInteger(tourNumber)) {
      setProblem({ message: t("calendar.waste.import.tourMissing") });
      return null;
    }
    if (sourceType === "url") return { type: "url", request: { provider: "hattingen", tour: tourNumber, url: url.trim() } };
    if (file === null) {
      setProblem({ message: t("calendar.waste.import.fileMissing") });
      return null;
    }
    if (file.size > CALENDAR_LIMITS.wastePdfMaxBytes) {
      setProblem({ message: t("calendar.waste.error.tooLarge") });
      return null;
    }
    return { type: "file", file, tour: tourNumber };
  }

  function runPreview() {
    reset();
    const next = source();
    if (next === null) return;
    preview.mutate(next, {
      onSuccess: (data) => setResult(data),
      onError: (error) => setProblem(wasteErrorMessage(error)),
    });
  }

  function runTheImport() {
    const next = source();
    if (next === null) return;
    runImport.mutate(next, {
      onSuccess: (data) => {
        toast.success(t("calendar.waste.import.done", { count: data.entryCount }));
        reset();
        setFile(null);
        onClose();
      },
      onError: (error) => setProblem(wasteErrorMessage(error)),
    });
  }

  function pickFile(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
    reset();
  }

  const total = result === null ? 0 : WASTE_CATEGORIES.reduce((sum, category) => sum + result.counts[category], 0);
  const replaces = result !== null && imports.some((item) => item.year === result.year && item.provider === result.provider);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("calendar.waste.import.title")}
      size="md"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("calendar.common.cancel")}
          </Button>
          <Button variant="secondary" loading={preview.isPending} onClick={runPreview}>
            {t("calendar.waste.import.preview")}
          </Button>
          <Button loading={runImport.isPending} disabled={result === null} onClick={runTheImport}>
            {t("calendar.waste.import.run")}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Select
          label={t("calendar.waste.settings.tour")}
          value={tour}
          placeholder={t("calendar.entries.who.pick")}
          onChange={(event) => {
            setTour(event.target.value);
            reset();
          }}
          options={TOURS.map((value) => ({ value: String(value), label: t("calendar.waste.settings.tourOption", { tour: value }) }))}
          hint={t("calendar.waste.settings.tourHint")}
        />
        <Tabs
          aria-label={t("calendar.waste.import.source")}
          value={sourceType}
          onChange={(next) => {
            setSourceType(next);
            reset();
          }}
          items={[
            { value: "url", label: t("calendar.waste.import.sourceUrl") },
            { value: "file", label: t("calendar.waste.import.sourceFile") },
          ]}
        />
        {sourceType === "url" ? (
          <Input
            label={t("calendar.waste.import.url")}
            type="url"
            inputMode="url"
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              reset();
            }}
            hint={t("calendar.waste.import.urlHint")}
          />
        ) : (
          <Input
            label={t("calendar.waste.import.file")}
            type="file"
            accept="application/pdf,.pdf"
            onChange={pickFile}
            hint={t("calendar.waste.import.fileHint")}
          />
        )}

        {problem !== null ? (
          <div role="alert" className="flex flex-col gap-1 rounded-card border border-danger/30 bg-danger-soft p-3 text-sm text-danger-soft-fg">
            <p className="font-semibold">{t("calendar.waste.error.title")}</p>
            <p>{problem.message}</p>
            {problem.hint ? <p>{problem.hint}</p> : null}
          </div>
        ) : null}

        {result !== null ? (
          <section aria-labelledby="calendar-waste-preview" className="flex flex-col gap-3 rounded-card border border-line bg-surface-2 p-3">
            <h3 id="calendar-waste-preview" className="font-semibold text-fg">
              {t("calendar.waste.import.previewTitle", { year: result.year, tour: result.tour })}
            </h3>
            <ul className="flex flex-col gap-1.5">
              {WASTE_CATEGORIES.map((category) => (
                <li key={category} className="flex items-center gap-2.5 text-sm">
                  <WasteDot category={category} />
                  <span className="min-w-0 flex-1 text-fg">{wasteLabel(category)}</span>
                  <span className="text-fg-muted tabular-nums">
                    {t("calendar.waste.import.count", { count: result.counts[category] })}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-sm text-fg">{t("calendar.waste.import.total", { count: total })}</p>
            {result.warnings.length > 0 ? (
              <div className="flex flex-col gap-1 text-sm text-warning-soft-fg">
                <p className="font-semibold">{t("calendar.waste.import.warnings")}</p>
                <ul className="flex flex-col gap-0.5">
                  {result.warnings.map((warning, index) => (
                    <li key={`${warning.code}-${warning.date ?? ""}-${index}`}>
                      {warning.date === null
                        ? t("calendar.waste.import.warning", { code: warning.code })
                        : t("calendar.waste.import.warningOn", { code: warning.code, date: formatShortDate(warning.date, today) })}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {replaces ? <p className="text-sm text-fg-muted">{t("calendar.waste.import.replaceHint")}</p> : null}
          </section>
        ) : null}
      </div>
    </Dialog>
  );
}

/** The URL the dialog starts with: the last one used, else the provider's default (design §5.1). */
export function initialWasteUrl(sourceUrl: string | null | undefined): string {
  return sourceUrl ?? WASTE_PROVIDERS.hattingen.defaultUrl;
}
