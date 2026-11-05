/**
 * The I/O helpers of the `migrate:legacy` library on Effect (docs/EFFECT.md E6, E7, E10; plan
 * `docs/plans/e5-scripts.md` P5, P9).
 *
 * - `legacyTry(() => client.execute(...))`: every libSQL call of the library goes through it. A rejection (or a
 *   synchronous throw of the thunk) becomes `DatabaseError({ cause })` with the RAW driver error as `cause`, so a
 *   step that recovers (the per-row retry of `writeEntries`, the schema gate's read) records exactly the text the
 *   old `catch (error)` saw, and one that does not lets it propagate.
 * - `runLegacy(effect)`: the Promise door of the library (the kept Promise bridges, the tests, and, until E5-T07,
 *   the interim calls of the steps not converted yet). The rejection is mapped once: a `DatabaseError` rejects with
 *   its `cause` (what the old Promise function rejected with), anything else with the squashed value unchanged (a
 *   `MappingError` or `LegacyInputError` is that object: `exitCode` 2 and `instanceof` hold).
 * - `liftTagged(tags, f)`: the one lift of a PURE function that throws one of the library's tagged errors
 *   synchronously (`snapshotDatabase`, the statement builders, `validateMappingOverride`, …). Inside Effect code a
 *   bare `throw` is a defect that `Effect.catchTag(s)` never sees (CLAUDE.md "Catch-all stays catch-all"), so the
 *   CLI would exit 1 instead of 2. The lift turns a thrown error carrying one of `tags` into a typed failure and
 *   rethrows anything else, which stays a defect exactly as the old code's crash was (P5).
 *
 * No module-scope code beyond imports (the CLI imports the library dynamically, after its `DATABASE_URL` redirect;
 * CLAUDE.md "The CLI never imports `src/env.ts`, and its import order is load-bearing"). Never `src/runtime.ts`.
 */
import { Effect, Predicate } from "effect";
import { DatabaseError, isDatabaseError } from "../../src/lib/errors.ts";
import type { CopyProgrammingError } from "./copy.ts";
import type { MappingError } from "./mapping.ts";
import type { LegacyInputError } from "./sources.ts";

/** The library's own tagged errors (P5): what `liftTagged` may lift. */
export type LegacyTaggedError = LegacyInputError | MappingError | CopyProgrammingError;

/** The tags of {@link LegacyTaggedError}. */
export type LegacyTag = LegacyTaggedError["_tag"];

/** A libSQL (or any Promise) call of the library: a rejection is `DatabaseError` with the raw error as `cause`. */
export function legacyTry<A>(f: () => PromiseLike<A>): Effect.Effect<A, DatabaseError> {
  return Effect.tryPromise({ try: () => f(), catch: (cause) => new DatabaseError({ cause }) });
}

/**
 * Runs a library effect as a Promise. A `DatabaseError` rejects with its `cause`, anything else (a tagged error of
 * the library, a defect) with the squashed value unchanged.
 */
export function runLegacy<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(effect).then(undefined, (error: unknown) =>
    Promise.reject(isDatabaseError(error) ? error.cause : error),
  );
}

/**
 * Calls the pure `f` inside Effect code: its result is the success value, a thrown error whose `_tag` is one of
 * `tags` is a typed failure, and any other throw is rethrown (a defect, as it was a crash before; P5).
 */
export function liftTagged<const Tag extends LegacyTag, A>(
  tags: ReadonlyArray<Tag>,
  f: () => A,
): Effect.Effect<A, Extract<LegacyTaggedError, { readonly _tag: Tag }>> {
  const isLifted = (u: unknown): u is Extract<LegacyTaggedError, { readonly _tag: Tag }> =>
    tags.some((tag) => Predicate.isTagged(u, tag));
  return Effect.suspend(() => {
    try {
      return Effect.succeed(f());
    } catch (error) {
      if (isLifted(error)) return Effect.fail(error);
      throw error;
    }
  });
}
