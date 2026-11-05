/**
 * The request log, Hono `logger()`'s two lines as an Effect global middleware (docs/EFFECT.md E8; plan
 * `docs/plans/e7-http-api.md` P11.1): `<-- METHOD path` when a request arrives and `--> METHOD path STATUS TIME` when
 * its response is known, the format and the colouring of `hono/dist/middleware/logger/index.js`. Two differences,
 * both deliberate: the path is the PATHNAME only, never the query (a signed upload URL carries `sig`), and the time
 * comes from the `Clock`. Off under `NODE_ENV=test` (the caller decides: `http/global.ts`); Effect's own
 * `HttpMiddleware.logger` is off everywhere (`disableLogger: true`).
 */
import { Cause, Clock, Effect, Exit } from "effect";
import { HttpServerRequest } from "effect/http";
import type { GlobalMiddleware } from "../http/global.ts";
import { pathOf } from "../http/request.ts";

/** Hono's `humanize(time(start))`: milliseconds under a second, else whole seconds, thousands separated by commas. */
export function elapsedLabel(deltaMs: number): string {
  const label = deltaMs < 1000 ? `${deltaMs}ms` : `${Math.round(deltaMs / 1000)}s`;
  return label.replace(/(\d)(?=(\d\d\d)+(?!\d))/g, "$1,");
}

/** Hono's `colorStatus`: ANSI colours unless `NO_COLOR` is set. */
export function colorStatus(status: number, colorEnabled: boolean): string {
  if (!colorEnabled) return `${status}`;
  switch ((status / 100) | 0) {
    case 5:
      return `\x1B[31m${status}\x1B[0m`;
    case 4:
      return `\x1B[33m${status}\x1B[0m`;
    case 3:
      return `\x1B[36m${status}\x1B[0m`;
    case 2:
      return `\x1B[32m${status}\x1B[0m`;
    default:
      return `${status}`;
  }
}

/** The global request-log middleware; `write` is `console.log` unless a test passes its own. */
export function requestLogMiddleware(write: (line: string) => void = console.log): GlobalMiddleware {
  return (httpEffect) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const path = pathOf(request.originalUrl);
      yield* Effect.sync(() => write(`<-- ${request.method} ${path}`));
      const start = yield* Clock.currentTimeMillis;
      return yield* Effect.onExit(httpEffect, (exit) =>
        Effect.gen(function* () {
          const elapsed = (yield* Clock.currentTimeMillis) - start;
          if (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)) return;
          const status = Exit.isSuccess(exit) ? exit.value.status : 500;
          const colorEnabled = !("NO_COLOR" in process.env);
          write(`--> ${request.method} ${path} ${colorStatus(status, colorEnabled)} ${elapsedLabel(elapsed)}`);
        }),
      );
    });
}
