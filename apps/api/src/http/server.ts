/**
 * The HTTP server (docs/EFFECT.md E7, E8; plan `docs/plans/e7-http-api.md` P12, P21; E7-T11): `BunHttpServer` serves
 * `appRoutesLayer()` (`./app.ts`) where Bun's auto-serve of the Hono app's default export stood.
 *
 * `appServer(routes)` is `HttpRouter.serve(routes, { disableLogger: true, disableListenLog: true })`: Effect's own
 * request logger stays off (the request log is the global middleware of `./global.ts`, Hono `logger()`'s lines) and so
 * does its "Listening on" line (`src/index.ts` prints the one boot line it always printed). `serve` builds the routes
 * on a fork of the current memo map, so on the one `runtime` the `AppLayer` services are the runtime's own and the
 * router is the server's alone. What the routes require besides `HttpServer` and the platform services (`AppLayer`'s
 * services) is left open and provided by the runtime the server runs on.
 *
 * `serverLayer()` adds `BunHttpServer.layer` with the options Bun's auto-serve had: hostname `0.0.0.0` (what Bun bound
 * by default; BunHttpServer's own default `"::"` would change the bind), port `API_PORT`, `maxRequestBodySize` 20 MiB
 * (15 MB uploads plus a little slack for multipart overhead), and `gracefulShutdownTimeout` 4 s. That option bounds
 * only the serve scope's pre-emptive stop; the server layer's own `server.stop()` finalizer waits for every request in
 * flight, so `src/index.ts` bounds the interrupt of the server fiber itself (5 s, deviation D4).
 *
 * Hoisted functions (P15): nothing is read or built at import.
 */
import * as BunHttpServer from "@effect/platform-bun/BunHttpServer";
import { Duration, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { env } from "../env.ts";
import { appRoutesLayer } from "./app.ts";

/** The largest request body the server accepts: 15 MB uploads plus a little slack for multipart overhead. */
export const MAX_REQUEST_BODY_SIZE = 20 * 1024 * 1024;

/** How long the serve scope's pre-emptive stop waits for the requests in flight. */
export const GRACEFUL_SHUTDOWN_TIMEOUT = Duration.seconds(4);

/** `routes` (the application's by default) served on the `HttpServer` in the environment. */
export function appServer(routes = appRoutesLayer()) {
  return HttpRouter.serve(routes, { disableLogger: true, disableListenLog: true });
}

/** The application served by `Bun.serve` on `0.0.0.0:<API_PORT>`; launched on the one runtime by `src/index.ts`. */
export function serverLayer() {
  return appServer().pipe(
    Layer.provide(
      BunHttpServer.layer({
        hostname: "0.0.0.0",
        port: env.API_PORT,
        maxRequestBodySize: MAX_REQUEST_BODY_SIZE,
        gracefulShutdownTimeout: GRACEFUL_SHUTDOWN_TIMEOUT,
      }),
    ),
  );
}
