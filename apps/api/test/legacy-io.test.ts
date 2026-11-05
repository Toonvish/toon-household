/**
 * The I/O helpers of the `migrate:legacy` library on Effect (`apps/api/scripts/legacy/io.ts`; plan
 * `docs/plans/e5-scripts.md` P5, P9, E5-T06a) and the library's three tagged errors.
 *
 * (a) `runLegacy` rejects with a `DatabaseError`'s cause and with a library error unchanged.
 * (b) `legacyTry` maps a rejection (and a synchronous throw of its thunk) to `DatabaseError`.
 * (c) `liftTagged`: a thrown tagged error is a typed failure, a foreign throw stays a defect.
 * (d) `LegacyInputError`, `MappingError`, `CopyProgrammingError` keep `exitCode`, `message` and `instanceof`.
 */
import { describe, expect, test } from "bun:test";
import { Cause, Effect, Exit } from "effect";
import { DatabaseError, isDatabaseError } from "../src/lib/errors.ts";
import { CopyProgrammingError } from "../scripts/legacy/copy.ts";
import { legacyTry, liftTagged, runLegacy } from "../scripts/legacy/io.ts";
import { MappingError, validateMappingOverride } from "../scripts/legacy/mapping.ts";
import { LegacyInputError, snapshotDatabase } from "../scripts/legacy/sources.ts";

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection, the promise resolved");
}

describe("(a) runLegacy", () => {
  test("resolves with the success value", async () => {
    expect(await runLegacy(Effect.succeed(42))).toBe(42);
  });

  test("a DatabaseError rejects with its raw cause", async () => {
    const raw = new Error("SQLITE_CONSTRAINT: UNIQUE constraint failed: users.email");
    const error = await rejection(runLegacy(Effect.fail(new DatabaseError({ cause: raw }))));
    expect(error).toBe(raw);
    expect(isDatabaseError(error)).toBe(false);
  });

  test("a MappingError rejects unchanged (exitCode 2, instanceof)", async () => {
    const mapping = new MappingError({ message: "--mapping: unknown finance household id \"x\"" });
    const error = await rejection(runLegacy(Effect.fail(mapping)));
    expect(error).toBe(mapping);
    expect(error).toBeInstanceOf(MappingError);
    expect(error).toMatchObject({ exitCode: 2, message: "--mapping: unknown finance household id \"x\"" });
  });

  test("a defect rejects with the thrown value", async () => {
    const boom = new Error("boom");
    const error = await rejection(
      runLegacy(
        Effect.sync(() => {
          throw boom;
        }),
      ),
    );
    expect(error).toBe(boom);
  });
});

describe("(b) legacyTry", () => {
  test("a resolved promise is the success value", async () => {
    expect(await Effect.runPromise(legacyTry(() => Promise.resolve("rows")))).toBe("rows");
  });

  test("a rejection is a DatabaseError carrying the raw error", async () => {
    const raw = new Error("no such table: groups");
    const exit = await Effect.runPromiseExit(legacyTry(() => Promise.reject(raw)));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasFails(exit.cause)).toBe(true);
      expect(Cause.hasDies(exit.cause)).toBe(false);
      const failure = Cause.squash(exit.cause);
      expect(isDatabaseError(failure)).toBe(true);
      expect((failure as DatabaseError).cause).toBe(raw);
    }
  });

  test("a synchronous throw of the thunk is a DatabaseError too", async () => {
    const raw = new Error("client is closed");
    const recovered = await Effect.runPromise(
      legacyTry((): Promise<string> => {
        throw raw;
      }).pipe(Effect.catchTag("DatabaseError", (error) => Effect.succeed(error.cause))),
    );
    expect(recovered).toBe(raw);
  });
});

describe("(c) liftTagged", () => {
  test("returns the function's value", async () => {
    expect(await Effect.runPromise(liftTagged(["MappingError"], () => "ok"))).toBe("ok");
  });

  test("a thrown MappingError is a typed failure that catchTag sees", async () => {
    const known = { groupIds: new Set(["g1"]), financeIds: new Set(["f1"]) };
    const lifted = liftTagged(["MappingError"], () => validateMappingOverride({ nope: "new" }, known));
    const exit = await Effect.runPromiseExit(lifted);
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasFails(exit.cause)).toBe(true);
      expect(Cause.hasDies(exit.cause)).toBe(false);
      expect(Cause.squash(exit.cause)).toBeInstanceOf(MappingError);
    }
    const message = await Effect.runPromise(
      lifted.pipe(
        Effect.as("no error"),
        Effect.catchTag("MappingError", (error) => Effect.succeed(error.message)),
      ),
    );
    expect(message).toBe('--mapping: unknown finance household id "nope"');
  });

  test("a thrown LegacyInputError is a typed failure", async () => {
    const lifted = liftTagged(["LegacyInputError"], () => snapshotDatabase("/nonexistent/legacy.db", "/nonexistent/copy.db"));
    const message = await Effect.runPromise(
      lifted.pipe(
        Effect.as("no error"),
        Effect.catchTag("LegacyInputError", (error) => Effect.succeed(`${error.exitCode} ${error.message}`)),
      ),
    );
    expect(message).toBe("2 legacy database not found: /nonexistent/legacy.db");
  });

  test("a tagged error outside the listed tags stays a defect", async () => {
    const exit = await Effect.runPromiseExit(
      liftTagged(["MappingError"], () => {
        throw new CopyProgrammingError({ message: "programming error: x" });
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasDies(exit.cause)).toBe(true);
      expect(Cause.hasFails(exit.cause)).toBe(false);
    }
  });

  test("a foreign throw stays a defect (rethrown, never a typed failure)", async () => {
    const foreign = new Error("x");
    const exit = await Effect.runPromiseExit(
      liftTagged(["MappingError", "LegacyInputError", "CopyProgrammingError"], () => {
        throw foreign;
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasDies(exit.cause)).toBe(true);
      expect(Cause.hasFails(exit.cause)).toBe(false);
      expect(Cause.squash(exit.cause)).toBe(foreign);
    }
    expect(await rejection(runLegacy(liftTagged(["MappingError"], () => { throw foreign; })))).toBe(foreign);
  });

  test("the thunk runs when the effect runs, not when it is built", async () => {
    let calls = 0;
    const lifted = liftTagged(["MappingError"], () => {
      calls += 1;
      return calls;
    });
    expect(calls).toBe(0);
    expect(await Effect.runPromise(lifted)).toBe(1);
    expect(await Effect.runPromise(lifted)).toBe(2);
  });
});

describe("(d) the library's tagged errors", () => {
  test("LegacyInputError: tag, exitCode 2, message, instanceof", () => {
    const error = new LegacyInputError({ message: "legacy recipe database not found: /x" });
    expect(error._tag).toBe("LegacyInputError");
    expect(error.exitCode).toBe(2);
    expect(error.message).toBe("legacy recipe database not found: /x");
    expect(error).toBeInstanceOf(LegacyInputError);
    expect(error).toBeInstanceOf(Error);
  });

  test("MappingError: tag, exitCode 2, message, instanceof", () => {
    const error = new MappingError({ message: "--mapping: the file must hold an object" });
    expect(error._tag).toBe("MappingError");
    expect(error.exitCode).toBe(2);
    expect(error.message).toBe("--mapping: the file must hold an object");
    expect(error).toBeInstanceOf(MappingError);
    expect(error).toBeInstanceOf(Error);
  });

  test("CopyProgrammingError: tag, message, instanceof", () => {
    const error = new CopyProgrammingError({ message: "programming error: the row for users does not match its columns" });
    expect(error._tag).toBe("CopyProgrammingError");
    expect(error.message).toBe("programming error: the row for users does not match its columns");
    expect(error).toBeInstanceOf(CopyProgrammingError);
    expect(error).toBeInstanceOf(Error);
  });

  test("the pure throwers throw the tagged classes synchronously", () => {
    const thrown = (() => {
      try {
        snapshotDatabase("/nonexistent/legacy.db", "/nonexistent/copy.db");
      } catch (error) {
        return error;
      }
      return undefined;
    })();
    expect(thrown).toBeInstanceOf(LegacyInputError);
    expect((thrown as LegacyInputError).exitCode).toBe(2);
  });
});
