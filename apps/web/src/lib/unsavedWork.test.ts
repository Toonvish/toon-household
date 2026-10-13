/**
 * The unsaved-work registry, which is what stands between a service-worker update and
 * a half-typed recipe. Its failure mode is silent — a claim that leaks keeps the app on
 * an old version forever, and one that releases too early discards the user's edits — so
 * the counting is pinned here.
 *
 * The imperative core only; `useUnsavedWork` is a two-line `useEffect` around it.
 * `bun:test` types come from apps/web/tsconfig.test.json, which is the project that
 * type-checks this file — apps/web/tsconfig.json excludes it.
 */
import { describe, expect, test } from "bun:test";
import {
  claimUnsavedWork,
  hasUnsavedWork,
  resetUnsavedWork,
  subscribeUnsavedWork,
} from "./unsavedWork";

describe("unsaved-work registry", () => {
  test("starts clean and reports a single claim", () => {
    resetUnsavedWork();
    expect(hasUnsavedWork()).toBe(false);
    const release = claimUnsavedWork();
    expect(hasUnsavedWork()).toBe(true);
    release();
    expect(hasUnsavedWork()).toBe(false);
  });

  test("two screens can be dirty at once and the first release does not clear it", () => {
    resetUnsavedWork();
    const releaseForm = claimUnsavedWork();
    const releaseDialog = claimUnsavedWork();
    releaseDialog();
    // The form behind the dialog is still dirty.
    expect(hasUnsavedWork()).toBe(true);
    releaseForm();
    expect(hasUnsavedWork()).toBe(false);
  });

  test("releasing twice does not go negative", () => {
    resetUnsavedWork();
    const release = claimUnsavedWork();
    const other = claimUnsavedWork();
    release();
    release();
    release();
    // A double release must not cancel the OTHER claim — that would discard its edits.
    expect(hasUnsavedWork()).toBe(true);
    other();
    expect(hasUnsavedWork()).toBe(false);
  });

  test("notifies only on the transitions, which is what triggers a pending update", () => {
    resetUnsavedWork();
    const seen: boolean[] = [];
    const unsubscribe = subscribeUnsavedWork(() => seen.push(hasUnsavedWork()));

    const first = claimUnsavedWork(); // false -> true
    const second = claimUnsavedWork(); // still true, no event
    second(); // still true, no event
    first(); // true -> false

    expect(seen).toEqual([true, false]);
    unsubscribe();

    claimUnsavedWork();
    expect(seen).toHaveLength(2);
  });

  test("a listener that unsubscribes during a notification does not break the loop", () => {
    resetUnsavedWork();
    const calls: string[] = [];
    const unsubscribeA = subscribeUnsavedWork(() => {
      calls.push("a");
      unsubscribeA();
    });
    subscribeUnsavedWork(() => calls.push("b"));
    claimUnsavedWork();
    // Both run: the set is copied before iterating. Without that, removing `a` mid-loop
    // would skip `b` — and `b` is the hook that applies the pending update.
    expect(calls).toEqual(["a", "b"]);
  });
});
