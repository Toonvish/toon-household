/**
 * The migration report (plan m5 decision 15): an English plain-text rendering for stdout and a
 * JSON form for `--report <file>`. The section headings and the final line are fixed strings that
 * the tests and `docs/migration.md` rely on; change them only together.
 *
 * Money is printed as integer cents (`-1234 ct`), never as a float.
 *
 * No module-scope code beyond imports and constants (decision 5).
 */
import type { HouseholdDecision, Mode, Report, TableCount } from "./types.ts";

/** The section headings, in render order. */
export const REPORT_HEADINGS = [
  "== Inputs ==",
  "== Household mapping proposal ==",
  "== Users ==",
  "== Rows per table ==",
  "== Skipped rows ==",
  "== Not migrated by design ==",
  "== Uploads ==",
  "== Finance balance per household ==",
  "== Warnings ==",
  "== Errors ==",
] as const;

const PREFIX = "[migrate:legacy]";
const NONE = "(none)";

export function createReport(mode: Mode, target: string): Report {
  return {
    mode,
    target,
    inputs: [],
    decisions: [],
    users: { recipe: 0, finance: 0, target: 0, collisions: [] },
    counts: [],
    skipped: [],
    notMigrated: [],
    balances: [],
    warnings: [],
    errors: [],
  };
}

/**
 * Adds a finished count to the report. The same object twice is a no-op; another object for the
 * same table and source is summed into the existing entry. Call it once the count is complete
 * (`copyTable` does it itself).
 */
export function addCount(report: Report, count: TableCount): void {
  if (report.counts.includes(count)) return;
  const existing = report.counts.find((entry) => entry.table === count.table && entry.source === count.source);
  if (!existing) {
    report.counts.push(count);
    return;
  }
  existing.read += count.read;
  existing.written += count.written;
  existing.alreadyMigrated += count.alreadyMigrated;
  existing.skipped += count.skipped;
}

/** Rows written over every table (the `<n>` of the final line). */
export function totalWritten(report: Report): number {
  return report.counts.reduce((sum, count) => sum + count.written, 0);
}

/** The number of errors the final line names. */
export function errorCount(report: Report): number {
  return report.errors.length || report.skipped.filter((row) => row.error).length;
}

/** 1 when the run found errors (balance, insert, upload conflict, blocked merge), else 0. */
export function exitCodeFor(report: Report): 0 | 1 {
  return errorCount(report) > 0 ? 1 : 0;
}

function cents(value: number): string {
  return `${value} ct`;
}

/** An aligned plain-text table: header, a dashed rule, the rows. */
function renderTable(headers: readonly string[], rows: readonly (readonly string[])[]): string[] {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => (row[index] ?? "").length)),
  );
  const line = (cells: readonly string[]) =>
    cells
      .map((cell, index) => (index === cells.length - 1 ? cell : cell.padEnd(widths[index] ?? 0)))
      .join("  ")
      .trimEnd();
  return [line(headers), line(widths.map((width) => "-".repeat(width))), ...rows.map(line)];
}

function withId(name: string | undefined, id: string | undefined): string {
  if (!id) return "-";
  return name ? `${name} (${id})` : id;
}

/** The proposal table `Finance household | Members | Decision | Target household | Reason`. */
export function renderProposal(decisions: readonly HouseholdDecision[]): string {
  if (decisions.length === 0) return NONE;
  const rows = decisions.map((decision) => [
    withId(decision.financeName, decision.financeHouseholdId),
    decision.memberEmails.join(", ") || "-",
    decision.decision,
    withId(decision.targetName, decision.targetHouseholdId),
    decision.addMembers.length > 0
      ? `${decision.reason} (adds ${decision.addMembers.join(", ")})`
      : decision.reason,
  ]);
  return renderTable(["Finance household", "Members", "Decision", "Target household", "Reason"], rows).join("\n");
}

function renderInputs(report: Report): string[] {
  const lines = [`Mode: ${report.mode}`, `Target: ${report.target}`];
  if (report.inputs.length === 0) return [...lines, NONE];
  for (const input of report.inputs) {
    lines.push(`${input.source}: ${input.path} (schema ${input.schema})`);
    const tables = Object.entries(input.tables);
    if (tables.length > 0) {
      lines.push(
        ...renderTable(
          ["Table", "Rows"],
          tables.map(([table, rows]) => [table, String(rows)]),
        ).map((line) => `  ${line}`),
      );
    }
  }
  return lines;
}

function renderUsers(report: Report): string[] {
  const { users } = report;
  const lines = [
    `Recipe users: ${users.recipe}`,
    `Finance users: ${users.finance}`,
    `Target users: ${users.target}`,
    "Collisions (same e-mail in both apps):",
  ];
  if (users.collisions.length === 0) return [...lines, NONE];
  return [
    ...lines,
    ...renderTable(
      ["E-mail", "Recipe id", "Finance id", "Target id", "Password", "Note"],
      users.collisions.map((c) => [c.email, c.recipeUserId, c.financeUserId, c.targetUserId, c.passwordFrom, c.note ?? ""]),
    ),
  ];
}

function renderCounts(report: Report): string[] {
  if (report.counts.length === 0) return [NONE];
  const sum = (key: "read" | "written" | "alreadyMigrated" | "skipped") =>
    String(report.counts.reduce((total, count) => total + count[key], 0));
  return renderTable(
    ["Table", "Source", "Read", "Written", "Already migrated", "Skipped"],
    [
      ...report.counts.map((c) => [
        c.table,
        c.source,
        String(c.read),
        String(c.written),
        String(c.alreadyMigrated),
        String(c.skipped),
      ]),
      ["Total", "", sum("read"), sum("written"), sum("alreadyMigrated"), sum("skipped")],
    ],
  );
}

function renderSkipped(report: Report): string[] {
  if (report.skipped.length === 0) return [NONE];
  return renderTable(
    ["Table", "Source", "Legacy id", "Error", "Reason"],
    report.skipped.map((s) => [s.table, s.source, s.legacyId, s.error ? "yes" : "no", s.reason]),
  );
}

function renderNotMigrated(report: Report): string[] {
  if (report.notMigrated.length === 0) return [NONE];
  return renderTable(
    ["Table", "Source", "Rows", "Reason"],
    report.notMigrated.map((n) => [n.table, n.source, String(n.rows), n.reason]),
  );
}

function renderList(title: string, items: readonly string[]): string[] {
  return items.length === 0 ? [`${title}: ${NONE}`] : [`${title}:`, ...items.map((item) => `  ${item}`)];
}

function renderUploads(report: Report): string[] {
  const uploads = report.uploads;
  if (!uploads) return [NONE];
  return [
    `Source files: ${uploads.sourceFiles}`,
    report.mode === "apply" ? `Copied: ${uploads.copied}` : `Would copy: ${uploads.wouldCopy}`,
    `Already present: ${uploads.alreadyPresent}`,
    `Bytes copied: ${uploads.bytesCopied}`,
    ...renderList("Conflicts", uploads.conflicts),
    ...renderList("Referenced but missing", uploads.missingReferenced),
    ...renderList("Ignored entries", uploads.ignoredEntries),
  ];
}

function renderBalances(report: Report): string[] {
  if (report.balances.length === 0) return [NONE];
  return renderTable(
    [
      "Finance household",
      "Target household",
      "Slot 1",
      "Legacy balance",
      "Migrated balance",
      "Legacy tx",
      "Migrated tx",
      "Legacy sum",
      "Migrated sum",
      "Result",
    ],
    report.balances.map((b) => [
      withId(b.name, b.financeHouseholdId),
      b.targetHouseholdId,
      b.slot1Matches ? b.slot1Email : `${b.slot1Email} (slot 1 differs)`,
      cents(b.legacyBalanceCents),
      cents(b.migratedBalanceCents),
      String(b.legacyTransactionCount),
      String(b.migratedTransactionCount),
      cents(b.legacyAmountSumCents),
      cents(b.migratedAmountSumCents),
      b.ok ? "OK" : "FAIL",
    ]),
  );
}

function renderLines(items: readonly string[]): string[] {
  return items.length === 0 ? [NONE] : items.map((item) => `- ${item}`);
}

/**
 * The exactly-one final line of decision 15. A failed dry-run pass (alone or the first pass of
 * `--apply`) also says that nothing was written: the dry pass only ever writes its scratch copy.
 */
export function finalLine(report: Report): string {
  const errors = errorCount(report);
  if (errors > 0) {
    const tail = report.mode === "dry-run" ? " Nothing was written." : "";
    return `${PREFIX} FAILED: ${errors} error(s), see Errors above.${tail}`;
  }
  const rows = totalWritten(report);
  if (report.mode === "dry-run") {
    const files = report.uploads?.wouldCopy ?? 0;
    if (rows === 0 && files === 0) {
      return `${PREFIX} dry run complete: already migrated, nothing would be written. Nothing was written.`;
    }
    return `${PREFIX} dry run complete: ${rows} rows would be written, ${files} files would be copied. Nothing was written.`;
  }
  const files = report.uploads?.copied ?? 0;
  if (rows === 0 && files === 0) return `${PREFIX} already migrated: nothing written.`;
  return `${PREFIX} applied: ${rows} rows written, ${files} files copied.`;
}

/** The whole report as text: the ten sections of decision 15 in order, then the final line. */
export function renderReport(report: Report): string {
  const [inputs, proposal, users, counts, skipped, notMigrated, uploads, balances, warnings, errors] =
    REPORT_HEADINGS;
  const sections: [string, string[]][] = [
    [inputs, renderInputs(report)],
    [proposal, renderProposal(report.decisions).split("\n")],
    [users, renderUsers(report)],
    [counts, renderCounts(report)],
    [skipped, renderSkipped(report)],
    [notMigrated, renderNotMigrated(report)],
    [uploads, renderUploads(report)],
    [balances, renderBalances(report)],
    [warnings, renderLines(report.warnings)],
    [errors, renderLines(report.errors)],
  ];
  const lines: string[] = [];
  for (const [heading, body] of sections) lines.push(heading, ...body, "");
  lines.push(finalLine(report));
  return `${lines.join("\n")}\n`;
}

/** The JSON of `--report <file>`: the report plus the totals and the exit code it implies. */
export function reportToJson(report: Report): string {
  const files = report.mode === "apply" ? (report.uploads?.copied ?? 0) : (report.uploads?.wouldCopy ?? 0);
  return `${JSON.stringify(
    {
      ...report,
      summary: {
        rowsWritten: totalWritten(report),
        files,
        errors: errorCount(report),
        exitCode: exitCodeFor(report),
        finalLine: finalLine(report),
      },
    },
    null,
    2,
  )}\n`;
}
