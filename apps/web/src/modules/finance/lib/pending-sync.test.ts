import { describe, expect, test } from "bun:test";
import { countPendingFinanceSync, isFinanceOutboxMutation } from "./pending-sync";

describe("isFinanceOutboxMutation", () => {
  test("matches the finance transaction mutation keys", () => {
    expect(isFinanceOutboxMutation(["toon", "finance", "tx", "create"])).toBe(true);
    expect(isFinanceOutboxMutation(["toon", "finance", "tx"])).toBe(true);
  });

  test("rejects other namespaces and missing keys", () => {
    expect(isFinanceOutboxMutation(["toon", "recipe", "shopping", "add"])).toBe(false);
    expect(isFinanceOutboxMutation(["toon", "finance", "plan"])).toBe(false);
    expect(isFinanceOutboxMutation(["finance", "tx"])).toBe(false);
    expect(isFinanceOutboxMutation(undefined)).toBe(false);
    expect(isFinanceOutboxMutation([])).toBe(false);
  });
});

describe("countPendingFinanceSync", () => {
  test("counts a paused finance transaction mutation", () => {
    expect(countPendingFinanceSync([{ mutationKey: ["toon", "finance", "tx", "create"], isPaused: true }])).toBe(1);
  });

  test("does not count an unpaused one", () => {
    expect(countPendingFinanceSync([{ mutationKey: ["toon", "finance", "tx", "create"], isPaused: false }])).toBe(0);
  });

  test("does not count a paused recipe shopping mutation", () => {
    expect(countPendingFinanceSync([{ mutationKey: ["toon", "recipe", "shopping", "add"], isPaused: true }])).toBe(0);
  });

  test("an empty list is 0", () => {
    expect(countPendingFinanceSync([])).toBe(0);
  });

  test("counts only the matching entries of a mixed list", () => {
    expect(
      countPendingFinanceSync([
        { mutationKey: ["toon", "finance", "tx", "create"], isPaused: true },
        { mutationKey: ["toon", "finance", "tx", "remove"], isPaused: true },
        { mutationKey: ["toon", "finance", "tx", "update"], isPaused: false },
        { mutationKey: ["toon", "recipe", "shopping", "add"], isPaused: true },
        { isPaused: true },
      ]),
    ).toBe(2);
  });
});
