/**
 * toon-household API — BunHttpServer + effect/http-api (docs/EFFECT.md E7, E8; plan `docs/plans/e7-http-api.md` P12).
 *
 * This file is the PROCESS: the boot, the server fiber and the teardown. The application itself (the global
 * middlewares, the health probe, the uploads, the core APIs, the module APIs, the static web) is one route layer,
 * `appRoutesLayer()` in `src/http/app.ts`, served by `serverLayer()` (`src/http/server.ts`). Modules add their routes
 * inside `src/modules/<id>/` and reach the app only through `src/modules/index.ts` (SPEC §2) — nobody needs to edit
 * this file to add a module route.
 *
 * `app` (re-exported) is the in-memory handler over the same layer: the tests' `app.request` (E9).
 */
import { Deferred, Duration, Effect, Fiber, Layer } from "effect";
import { env } from "./env.ts";
import { serverLayer } from "./http/server.ts";
import { API_MODULES } from "./modules/index.ts";
import { runtime } from "./runtime.ts";

export { app } from "./http/app.ts";

/** How long SIGTERM/SIGINT waits for the server fiber (and the requests in flight) before the teardown goes on. */
const SERVER_STOP_TIMEOUT = Duration.seconds(5);

if (!env.isTest) {
  /** The fiber the server runs on (forked on the one runtime below), interrupted on SIGTERM/SIGINT. */
  let serverFiber: Fiber.Fiber<never, unknown> | undefined;

  /**
   * Graceful shutdown (toon-recipe's block, generalised over the modules): the server stops taking traffic first, then
   * every build module's `shutdown()` runs — recipe's terminates its long-lived tesseract worker; without that it was
   * only ever torn down by process exit, which on a redeploy means a killed worker mid-recognition and (on some hosts)
   * a leaked child.
   *
   * Registered once, guarded so a repeated signal cannot start a second teardown, and never in tests — bun's test
   * runner owns the process there. The interrupt of the server fiber is BOUNDED (plan P12, deviation D4): the server
   * layer's `server.stop()` waits for every request in flight (a long OCR import included), so after 5 s the teardown
   * goes on without it and the module shutdowns, the dispose and the exit always run inside Docker's 10 s stop
   * timeout. A module whose shutdown fails is logged and the others still run (the hooks are Effects run on the one
   * runtime, plan e2 P11; a failure rejects with the module's own error value). After every module, the one Effect
   * runtime is disposed (runtime.ts, docs/EFFECT.md E7): that closes its layer scope; a failed dispose is logged and the
   * process still exits 0.
   */
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[api] ${signal} — stopping modules …`);
    if (serverFiber !== undefined) {
      const fiber = serverFiber;
      try {
        await runtime.runPromise(
          Fiber.interrupt(fiber).pipe(Effect.timeoutOrElse({ duration: SERVER_STOP_TIMEOUT, orElse: () => Effect.void })),
        );
      } catch (error: unknown) {
        console.error("[api] server stop failed:", error);
      }
    }
    await Promise.allSettled(
      API_MODULES.map(async (module) => {
        try {
          if (module.shutdown) await runtime.runPromise(module.shutdown());
        } catch (error: unknown) {
          console.warn(`[api] shutdown of module ${module.id} failed:`, error);
        }
      }),
    );
    try {
      await runtime.dispose();
      console.log("[api] runtime disposed");
    } catch (error: unknown) {
      console.error("[api] runtime dispose failed:", error);
    }
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  // Building the whole `AppLayer` here (configuration, the database acquire that awaits the
  // connection PRAGMAs of db/client.ts, the mailer and the rest) means a database that cannot be
  // opened at all fails at BOOT with a readable message instead of on the first request (plan e2
  // P18). Not done under `bun test`, where this module is imported for `app.request` and a
  // top-level await would serialise every test file behind it.
  await runtime.runPromise(Effect.void);
  for (const module of API_MODULES) {
    try {
      if (module.start) await runtime.runPromise(module.start());
    } catch (error) {
      console.error(`[api] start of module ${module.id} failed:`, error);
    }
  }

  // The server fiber, forked on the one runtime (plan P12, P21): `Layer.launch` builds the server layer and keeps it
  // until the fiber is interrupted. The boot waits until the server listens; a failure to bind (or to build the routes)
  // rejects here and fails the boot with exit 1.
  const listening = Deferred.makeUnsafe<void>();
  serverFiber = runtime.runFork(
    Layer.launch(serverLayer().pipe(Layer.tap(() => Deferred.succeed(listening, undefined)))),
  );
  await runtime.runPromise(Effect.raceFirst(Deferred.await(listening), Fiber.join(serverFiber)));

  console.log(
    `[api] toon-household API on http://localhost:${env.API_PORT} (db: ${env.databaseKind}, origins: ${env.webOrigins.join(", ")}, mail: ${env.mailTransport}, web: ${env.webDistDir ?? "extern"})`,
  );
}
