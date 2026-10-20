/**
 * The `Database` service (docs/EFFECT.md E5; plan `docs/plans/e2-api-core-services.md` P6).
 *
 * It wraps a drizzle executor (the libSQL client of `src/db/client.ts` under drizzle) and gives the services
 * of `src/core/services/**` three ways in:
 *
 * - `use(f)` runs one drizzle call on the CURRENT executor; a rejection (or a synchronous throw of `f`) becomes a
 *   `DatabaseError` (outside the API error family, `src/lib/errors.ts`; the boundary answers it `500`).
 * - `transaction(effect)` replaces `withTransaction` (`src/core/services/households/support.ts`): it opens a
 *   transaction on the current executor and runs `effect` with the open transaction as the current executor; a typed
 *   failure, a defect or an interruption rolls back and surfaces UNCHANGED (same error object), success commits.
 *   Inside a transaction this service opened, a nested `transaction` runs inline (no savepoint: today's code hands
 *   `tx` down). On a handed-in executor (`withExecutor`, `layerFromExecutor`) it calls that executor's
 *   `.transaction(…)`, which is a savepoint when the executor is itself a drizzle transaction, exactly as
 *   `withTransaction(tx, …)` does. Where `transactionsSupported` is false (an explicit `:memory:` URL) `effect` runs
 *   without a transaction: same statement order, no rollback guarantee (the rule of `withTransaction`).
 * - `executor` reads the current executor itself (a Promise-based module hook gets it, plan e2 P11).
 *
 * The current executor is a `Context.Reference` read on EVERY call, never captured at layer build: inside
 * `transaction` it is the open transaction, under `Database.withExecutor(db)` the handed-in instance (the legacy
 * bridges of plan e2 P1 take the old `db` argument this way), otherwise the service's root `drizzle`.
 *
 * Layers:
 * - `Database.layer`: the process-wide instance of `src/db/client.ts` (`db`, `client`, `dbReady`). Acquire awaits
 *   the D7 pragmas (`dbReady`); release closes the client and logs `[db] database closed`, EXCEPT under
 *   `NODE_ENV=test`, where it does nothing (every test file shares one process and one client, ADR 0009).
 *   The instance itself is still created at import of `src/db/client.ts`, because recipe, finance and the scripts
 *   import `db` until E3 to E5 (ADR 0014).
 * - `Database.layerFrom(created)`: an existing `createDatabase(...)` result; never closes it.
 * - `Database.layerFromExecutor(executor)`: a bare drizzle executor (a root or an open drizzle transaction, what the
 *   module-hook call sites hold); never closes anything; `transactionsSupported` is the process-wide rule.
 * - `Database.layerFromUrl(url, authToken?)`: fully scoped, `createDatabase` + the pragmas, closed on release.
 *
 * Import cycle (CLAUDE.md "API import cycle"): the static initializers read only `effect` exports, this module's
 * own `CurrentExecutor` and the class; `AppConfig` and the shared instance are read inside the generators, at
 * layer build.
 */
import type { Client } from "@libsql/client";
import { Console, Context, Effect, Exit, Layer } from "effect";
import { AppConfig } from "../config.ts";
import { transactionsSupported as processTransactionsSupported } from "../core/services/households/support.ts";
import { DatabaseError } from "../lib/errors.ts";
import { client as sharedClient, createDatabase, type CreatedDatabase, db as sharedDb, dbReady, type DrizzleDatabase } from "./client.ts";

/** The transaction handle drizzle passes to `db.transaction(async (tx) => …)`. */
export type DrizzleTransaction = Parameters<Parameters<DrizzleDatabase["transaction"]>[0]>[0];

/** Anything that runs queries: a root drizzle instance or an open drizzle transaction (`support.ts`'s `DbLike`). */
export type DbExecutor = DrizzleDatabase | DrizzleTransaction;

/**
 * The current executor of a run. `open` is `true` only for a transaction `Database.transaction` itself opened; a
 * handed-in executor counts as a root, whatever it is.
 */
export interface CurrentExecutorValue {
  readonly executor: DbExecutor;
  readonly open: boolean;
}

/** `undefined` (the default) means: the service's own root `drizzle`. */
export const CurrentExecutor = Context.Reference<CurrentExecutorValue | undefined>(
  "toon/api/db/database/CurrentExecutor",
  { defaultValue: () => undefined },
);

/** The shape of the `Database` service. */
export interface DatabaseShape {
  /** The root executor of this service. */
  readonly drizzle: DbExecutor;
  /** The libSQL client; `undefined` only for `layerFromExecutor`. */
  readonly client: Client | undefined;
  /** The URL the client was opened with; `undefined` only for `layerFromExecutor`. */
  readonly url: string | undefined;
  /** `false` for a `:memory:` URL: `transaction` then runs its effect without a transaction. */
  readonly transactionsSupported: boolean;
  /** The current executor (the open transaction, a handed-in instance, or `drizzle`). */
  readonly executor: Effect.Effect<DbExecutor>;
  /** One drizzle call on the current executor; a rejection becomes a `DatabaseError`. */
  readonly use: <A>(f: (db: DbExecutor) => Promise<A>) => Effect.Effect<A, DatabaseError>;
  /** Runs `effect` in a transaction (inline inside an open one); a failure rolls back and surfaces unchanged. */
  readonly transaction: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E | DatabaseError, R>;
}

interface DatabaseParts {
  readonly drizzle: DbExecutor;
  readonly client: Client | undefined;
  readonly url: string | undefined;
  readonly transactionsSupported: boolean;
}

/** Thrown inside drizzle's transaction callback to make it roll back; never leaves this module. */
const ROLLBACK: unique symbol = Symbol("toon/api/db/database/rollback");

function makeDatabase(parts: DatabaseParts): DatabaseShape {
  const executor: Effect.Effect<DbExecutor> = CurrentExecutor.useSync((current) => current?.executor ?? parts.drizzle);

  const use = Effect.fnUntraced(function* <A>(f: (db: DbExecutor) => Promise<A>) {
    const db = yield* executor;
    return yield* Effect.tryPromise({ try: () => f(db), catch: (cause) => new DatabaseError({ cause }) });
  });

  const transaction = Effect.fn("Database.transaction")(function* <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ): Effect.fn.Return<A, E | DatabaseError, R> {
    const current = yield* CurrentExecutor;
    if (current?.open === true || !parts.transactionsSupported) return yield* effect;
    // A handed-in executor may be a drizzle transaction: its `.transaction` is a savepoint (as withTransaction(tx)).
    const root = (current?.executor ?? parts.drizzle) as DrizzleDatabase;
    const context = yield* Effect.context<R>();
    let exit: Exit.Exit<A, E> | undefined;
    const settled = yield* Effect.promise((signal) =>
      root
        .transaction(async (tx) => {
          const inner = Context.add(context, CurrentExecutor, { executor: tx, open: true });
          exit = await Effect.runPromiseExitWith(inner)(effect, { signal });
          if (Exit.isFailure(exit)) throw ROLLBACK;
        })
        .then(
          () => ({ ok: true as const }),
          (cause: unknown) => ({ ok: false as const, cause }),
        ),
    );
    // The effect's own outcome wins: a failure rolled back and surfaces as it was raised.
    if (exit !== undefined && Exit.isFailure(exit)) return yield* Effect.failCause(exit.cause);
    if (!settled.ok || exit === undefined) {
      return yield* new DatabaseError({ cause: settled.ok ? "transaction ended without a result" : settled.cause });
    }
    return exit.value;
  });

  return { ...parts, executor, use, transaction };
}

/**
 * The database as a service (docs/EFFECT.md E5). The drizzle TYPE of the same name lives in `src/db/client.ts`
 * (also exported as `DrizzleDatabase`); module and script files import that one until E3 to E5.
 */
export class Database extends Context.Service<Database, DatabaseShape>()("toon/api/db/database/Database") {
  /** The process-wide instance of `src/db/client.ts`: acquire awaits the pragmas, release closes (never under test). */
  static readonly layer: Layer.Layer<Database, DatabaseError, AppConfig> = Layer.effect(
    this,
    Effect.gen(function* () {
      const config = yield* AppConfig;
      yield* Effect.acquireRelease(
        Effect.tryPromise({ try: () => dbReady, catch: (cause) => new DatabaseError({ cause }) }),
        () =>
          config.isTest
            ? Effect.void
            : Effect.sync(() => sharedClient.close()).pipe(Effect.andThen(Console.log("[db] database closed"))),
      );
      return makeDatabase({
        drizzle: sharedDb,
        client: sharedClient,
        url: config.databaseUrl,
        transactionsSupported: !config.databaseUrl.includes(":memory:"),
      });
    }),
  );

  /** An existing `createDatabase(...)` result (tests; the scripts E5 moves onto layers). Never closes it. */
  static layerFrom(created: Pick<CreatedDatabase, "db" | "client" | "url">): Layer.Layer<Database> {
    return Layer.sync(Database, () =>
      makeDatabase({
        drizzle: created.db,
        client: created.client,
        url: created.url,
        transactionsSupported: !created.url.includes(":memory:"),
      }),
    );
  }

  /**
   * A bare drizzle executor (a root instance or an open drizzle transaction). Never closes anything. A `transaction`
   * inside opens a savepoint on a handed-in `tx` (as the hooks' `withTransaction(tx, …)` does today);
   * `transactionsSupported` is the process-wide rule `withTransaction` applies to any handed-in `db`.
   */
  static layerFromExecutor(executor: DbExecutor): Layer.Layer<Database> {
    return Layer.sync(Database, () =>
      makeDatabase({
        drizzle: executor,
        client: undefined,
        url: undefined,
        transactionsSupported: processTransactionsSupported,
      }),
    );
  }

  /** A database of its own (docs/EFFECT.md E10): opened with the pragmas, closed when the layer's scope closes. */
  static layerFromUrl(url: string, authToken?: string): Layer.Layer<Database, DatabaseError> {
    return Layer.effect(
      Database,
      Effect.gen(function* () {
        const created = yield* Effect.acquireRelease(
          Effect.try({
            try: () => createDatabase(authToken === undefined ? { url } : { url, authToken }),
            catch: (cause) => new DatabaseError({ cause }),
          }),
          (opened) => Effect.sync(() => opened.client.close()),
        );
        yield* Effect.tryPromise({ try: () => created.ready, catch: (cause) => new DatabaseError({ cause }) });
        return makeDatabase({
          drizzle: created.db,
          client: created.client,
          url: created.url,
          transactionsSupported: !created.url.includes(":memory:"),
        });
      }),
    );
  }

  /**
   * Runs `effect` with `db` as the current executor: the legacy bridges (plan e2 P1) honour their old `db` argument
   * through it. `db` counts as a root: a `transaction` inside calls `db.transaction(…)` (a savepoint on a `tx`).
   */
  static withExecutor(db: DbExecutor): <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R> {
    return (effect) => Effect.provideService(effect, CurrentExecutor, { executor: db, open: false });
  }
}
