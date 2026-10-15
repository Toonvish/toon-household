/**
 * The pure parts of the shared capture-form hook (M3b-T03): validation keys, dirty detection and the
 * state after a booking. The hook itself needs a DOM and the router; the source pins below read it
 * instead (the same style as `AmountInput.test.ts`).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createEmptyFormState } from "../components/TransactionFormFields";
import { emptyStateAfterSubmit, isCreateFormDirty, validateCreateForm } from "./useCreateForm";

describe("validateCreateForm", () => {
  test("an empty form fails on both required fields", () => {
    expect(validateCreateForm(createEmptyFormState())).toEqual({
      amountCents: "finance.transactions.form.amountInvalid",
      description: "finance.transactions.form.descriptionRequired",
    });
  });

  test("a zero amount has its own message", () => {
    const state = { ...createEmptyFormState(), amountCents: 0, description: "Miete" };
    expect(validateCreateForm(state)).toEqual({ amountCents: "finance.transactions.form.amountZero" });
  });

  test("a whitespace-only description is blank", () => {
    const state = { ...createEmptyFormState(), amountCents: 1250, description: "   " };
    expect(validateCreateForm(state)).toEqual({ description: "finance.transactions.form.descriptionRequired" });
  });

  test("a credit (negative amount) is valid", () => {
    const state = { ...createEmptyFormState(), amountCents: -1250, description: "Erstattung" };
    expect(validateCreateForm(state)).toEqual({});
  });
});

describe("isCreateFormDirty", () => {
  test("an empty form is clean, an amount or a description makes it dirty", () => {
    const empty = createEmptyFormState();
    expect(isCreateFormDirty(empty)).toBe(false);
    expect(isCreateFormDirty({ ...empty, amountCents: 100 })).toBe(true);
    expect(isCreateFormDirty({ ...empty, description: "Rewe" })).toBe(true);
    expect(isCreateFormDirty({ ...empty, description: "  " })).toBe(false);
  });

  test("a changed kind, category or date alone is not unsaved work", () => {
    const empty = createEmptyFormState();
    expect(isCreateFormDirty({ ...empty, kind: "FOR_THEM", tags: ["a"], dateMode: "yesterday" })).toBe(false);
  });
});

describe("emptyStateAfterSubmit", () => {
  test("clears everything but keeps the kind", () => {
    const filled = {
      ...createEmptyFormState(),
      kind: "FOR_THEM" as const,
      amountCents: 4200,
      description: "Geschenk",
      tags: ["x"],
      dateMode: "yesterday" as const,
    };
    const next = emptyStateAfterSubmit(filled);
    expect(next.kind).toBe("FOR_THEM");
    expect(next.amountCents).toBeNull();
    expect(next.description).toBe("");
    expect(next.tags).toEqual([]);
    expect(next.category).toBeNull();
    expect(next.dateMode).toBe("today");
  });
});

describe("useCreateTransactionForm source pins", () => {
  const source = readFileSync(join(import.meta.dir, "useCreateForm.ts"), "utf8");

  test("rides the one create mutation and mints the mutationId at the call site", () => {
    expect(source).toContain("useCreateTransactionMutation");
    expect(source).toMatch(/const mutationId = crypto\.randomUUID\(\);[\s\S]*createMutation\.mutate\(/);
    expect(source).not.toContain("useMutation(");
  });

  test("keeps the offline toast and the undo toast", () => {
    expect(source).toContain('"finance.transactions.toast.queued"');
    expect(source).toContain('"finance.transactions.toast.created"');
    expect(source).toContain('"finance.common.undo"');
  });
});
