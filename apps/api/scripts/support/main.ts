/**
 * The one script runner (docs/EFFECT.md E10, E12; plan `docs/plans/e5-scripts.md` P1).
 *
 * Every operator script under `apps/api/scripts/` (but `migrate-legacy.ts`, P10) is one Effect program run with
 * `runScript(program)` under `if (import.meta.main)`. The program provides its own layer (`Effect.provide(AppLayer)`)
 * BEFORE it is handed over, so the layer's scope (the `Database.layer` release that closes the client) has closed when
 * the teardown runs.
 *
 * Exit codes travel as values, never as `process.exit` calls inside a program:
 * - a program that succeeds with a number exits with that number; with `void`, 0;
 * - a failure exits with the squashed error's `[Runtime.errorExitCode]` (1 when it has none): a script prints its own
 *   line, then `return yield* new ScriptExit({ code })`, whose `[Runtime.errorReported]` is `false`, so `runMain` logs
 *   nothing more;
 * - an interruption (SIGINT/SIGTERM, which `BunRuntime.runMain` turns into an interrupt) exits 130.
 * The process ALWAYS ends with an explicit `process.exit(code)` after the scope closed, as the old scripts' trailing
 * `process.exit(...)` did, so a lingering handle (a detached token sweep, an SMTP socket) never keeps a finished script
 * alive. This file holds the one `process.exit(` of the scripts' Effect code (idioms rule (12), P14).
 *
 * Imports: ONLY `effect` and `@effect/platform-bun`, never a repo file: `migrate.ts` and `seed.ts` import this file
 * statically before their pre-steps (the `SESSION_SECRET` placeholder, the production refusal; P2), and a repo import
 * could load `src/db/client.ts` (which opens the database at import) ahead of them.
 */
import { BunRuntime } from "@effect/platform-bun";
import { type Effect, Exit, Predicate, Runtime, Schema } from "effect";

/**
 * A script's own exit code as a typed failure (the shape of `effect/cli`'s `ShowHelp`): the script has already printed
 * its line, so `[Runtime.errorReported]` is `false`, and the teardown exits with `code`.
 */
export class ScriptExit extends Schema.TaggedError<ScriptExit>()("ScriptExit", { code: Schema.Number }) {
  override readonly [Runtime.errorExitCode] = this.code;
  override readonly [Runtime.errorReported] = false;
}

/**
 * The teardown of `runScript` (P1): `Runtime.defaultTeardown`'s code (0 success, 130 interruption only, else the
 * squashed error's marker or 1), except that a NUMERIC success exits with that number; then `exitProcess(code)`, always.
 * `onExit` (the runner's own callback, which exits only for a non-zero code or after a signal) is called first with
 * the same code, so the `Teardown` contract holds; `exitProcess` ends the process in every case.
 */
export function makeScriptTeardown(exitProcess: (code: number) => void): Runtime.Teardown {
  return (exit, onExit) =>
    Runtime.defaultTeardown(exit, (code) => {
      const final = Exit.isSuccess(exit) && Predicate.isNumber(exit.value) ? exit.value : code;
      onExit(final);
      exitProcess(final);
    });
}

/**
 * Runs a script program as the process entry point (`BunRuntime.runMain`: SIGINT/SIGTERM interrupt it, an unreported
 * failure is logged) and ends the process with the code of `makeScriptTeardown`. The caller provides its layer first.
 */
export function runScript<E>(program: Effect.Effect<number | void, E, never>): void {
  BunRuntime.runMain(program, { teardown: makeScriptTeardown((code) => process.exit(code)) });
}
