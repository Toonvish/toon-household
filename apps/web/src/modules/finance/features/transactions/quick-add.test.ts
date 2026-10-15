/**
 * The quick-add sheet (M3b-T03): `quick-add.tsx`'s pure parts and the source pins of the wiring that
 * a DOM-less `bun test` cannot exercise: toon-finance gotchas 62 (the unsaved-work claim is not gated
 * on the sheet being open), 65 (`/finance/new` claims the host), and the module's own rules (no FAB, no
 * "Mehr Details", the mount in `FinanceGate`).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isQuickAddShortcut, isTypingTarget, nextHostCount } from "../../lib/quick-add";

const financeRoot = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(financeRoot, rel), "utf8");
const code = (rel: string) =>
  read(rel)
    .split("\n")
    .filter((line) => !/^\s*(\*|\/\/|\/\*|\{\/\*)/.test(line))
    .join("\n");

describe("isTypingTarget", () => {
  const element = (tagName: string, extra: Record<string, unknown> = {}) =>
    ({ tagName, isContentEditable: false, closest: () => null, ...extra }) as unknown as EventTarget;

  test("form fields and rich text are typing targets", () => {
    expect(isTypingTarget(element("INPUT"))).toBe(true);
    expect(isTypingTarget(element("TEXTAREA"))).toBe(true);
    expect(isTypingTarget(element("SELECT"))).toBe(true);
    expect(isTypingTarget(element("DIV", { isContentEditable: true }))).toBe(true);
    expect(isTypingTarget(element("SPAN", { closest: (selector: string) => (selector === "[role='textbox']" ? {} : null) }))).toBe(
      true,
    );
  });

  test("a button, the body and null are not", () => {
    expect(isTypingTarget(element("BUTTON"))).toBe(false);
    expect(isTypingTarget(element("BODY"))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget({} as EventTarget)).toBe(false);
  });
});

describe("isQuickAddShortcut", () => {
  const key = (k: string, mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey", boolean>> = {}) => ({
    key: k,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    ...mods,
  });

  test("a bare n or N is the shortcut", () => {
    expect(isQuickAddShortcut(key("n"))).toBe(true);
    expect(isQuickAddShortcut(key("N"))).toBe(true);
  });

  test("a modifier or another key is not", () => {
    expect(isQuickAddShortcut(key("n", { metaKey: true }))).toBe(false);
    expect(isQuickAddShortcut(key("n", { ctrlKey: true }))).toBe(false);
    expect(isQuickAddShortcut(key("n", { altKey: true }))).toBe(false);
    expect(isQuickAddShortcut(key("m"))).toBe(false);
  });
});

describe("nextHostCount", () => {
  test("two overlapping hosts keep the sheet unavailable until both release", () => {
    let count = 0;
    count = nextHostCount(count, 1); // incoming /finance/new mounts
    count = nextHostCount(count, 1); // outgoing one still mounted for a render
    expect(count).toBe(2);
    count = nextHostCount(count, -1);
    expect(count).toBe(1);
    count = nextHostCount(count, -1);
    expect(count).toBe(0);
  });

  test("never goes below zero", () => {
    expect(nextHostCount(0, -1)).toBe(0);
  });
});

describe("wiring pins", () => {
  test("QuickAddDialog registers useUnsavedWork(form.isDirty), not gated on isOpen (gotcha 62)", () => {
    const dialog = code("features/transactions/QuickAddDialog.tsx");
    expect(dialog).toContain("useUnsavedWork(form.isDirty);");
    expect(dialog).not.toMatch(/useUnsavedWork\([^)]*isOpen/);
  });

  test("NewTransactionPage claims the host and registers its own unsaved work (gotcha 65)", () => {
    const page = code("features/transactions/NewTransactionPage.tsx");
    expect(page).toContain("useQuickAddHostedHere();");
    expect(page).toContain("useUnsavedWork(form.isDirty);");
    expect(page).toContain("useCreateTransactionForm()");
  });

  test("both frames use the one form hook and the one field set", () => {
    for (const rel of ["features/transactions/QuickAddDialog.tsx", "features/transactions/NewTransactionPage.tsx"]) {
      const source = code(rel);
      expect(source).toContain("useCreateTransactionForm");
      expect(source).toContain("<TransactionFormFields");
      expect(source).not.toContain("useCreateTransactionMutation");
    }
  });

  test("the sheet's footer submit reaches the form by id and the dialog is statically mounted by the gate", () => {
    const dialog = code("features/transactions/QuickAddDialog.tsx");
    expect(dialog).toContain("form={FORM_ID}");
    const gate = code("features/participants/FinanceGate.tsx");
    expect(gate).toMatch(/import \{ QuickAddHost \} from "@\/modules\/finance\/features\/transactions\/QuickAddDialog";/);
    expect(gate).toMatch(/<QuickAddProvider>\s*<PendingSyncNote \/>\s*<Outlet \/>\s*<QuickAddHost \/>\s*<\/QuickAddProvider>/);
  });

  test("the provider mounts in the participant branch only (after the non-participant return)", () => {
    const gate = code("features/participants/FinanceGate.tsx");
    expect(gate.indexOf("<QuickAddProvider>")).toBeGreaterThan(gate.indexOf("<NonParticipantState"));
    expect(gate.match(/<QuickAddProvider>/g)?.length).toBe(1);
  });

  test("QuickAddProvider renders the context provider only, no wrapper element (Buchen bar flex chain)", () => {
    const source = code("lib/quick-add.tsx");
    expect(source).toContain("<QuickAddContext.Provider value={value}>{children}</QuickAddContext.Provider>");
    expect(source).not.toMatch(/<div[\s>]/);
  });

  test("the transactions list opens the sheet for the first booking", () => {
    const page = code("features/transactions/TransactionsPage.tsx");
    expect(page).toContain("onCreateFirst={quickAdd.open}");
  });

  test("no FAB, no sidebar button, no Mehr Details (SPEC D6, M3b decision 10)", () => {
    expect(read("features/transactions/components/TransactionFormFields.tsx")).not.toContain("moreDetails");
    expect(read("catalogs/transactions.de.ts")).not.toContain("moreDetails");
    expect(read("catalogs/transactions.en.ts")).not.toContain("moreDetails");
    expect(code("lib/quick-add.tsx")).not.toContain("QuickAddFab");
  });

  test("the sheet's required fields and the shortlist: description and amount carry the required marker", () => {
    const fields = code("features/transactions/components/TransactionFormFields.tsx");
    expect(fields).toMatch(/<Input[\s\S]*?required\s*\/>/);
    expect(code("features/transactions/components/AmountInput.tsx")).toMatch(/<Label htmlFor=\{id\} required>/);
  });

  test("the sheet and the page never import the shell (static manifest graph stays shell-free)", () => {
    for (const rel of ["lib/quick-add.tsx", "features/transactions/QuickAddDialog.tsx", "features/transactions/lib/useCreateForm.ts"]) {
      const source = code(rel);
      expect(source).not.toMatch(/from "@\/modules"/);
      expect(source).not.toContain("use-nav-items");
    }
  });
});
