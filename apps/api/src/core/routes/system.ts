/**
 * The system routes' handlers (docs/EFFECT.md E7, E8; plan `docs/plans/e7-http-api.md` P1, P2, Table M system row):
 * `GET /api/health` and `GET /uploads/:filename`, line for line what `src/index.ts` served inline before E7-T10.
 * Definitions in system.api.ts; `systemHandlers` holds both groups.
 *
 * Health: the payload is `healthResponse` (`src/core/health.ts`) as JSON, computed by `runtime.runPromise(healthResponse)`
 * on the one runtime, as the inline route did (E0; `apps/api/test/runtime.test.ts` (b) pins that call).
 *
 * Uploads (recipe photos, avatars, household covers) are NOT public: every URL must carry `?exp&sig` minted by the API
 * when the owning row was serialised (see lib/uploadUrls.ts for the scheme and for why a cookie check cannot work here
 * — a cross-origin `<img>` sends no credentials). An unsigned, forged or expired request is a 404, exactly like a
 * missing file, so this route never confirms that a given UUID exists. Every refusal is the JSON route-unknown `404`
 * Hono's `c.notFound()` answered (`server.error.routeUnknown` naming method and path).
 *
 * Import SOURCE scans are not reachable here at all: nothing mints a signature for them, and they are served by the
 * membership-checked `GET /api/households/:householdId/recipe/imports/:draftId/source` (M2).
 *
 * Path traversal is blocked by normalising and re-checking the prefix.
 *
 * `<name>.thumb.webp` is the list thumbnail of `<name>` and is generated here on first request (the `Thumbnails`
 * service, services/media/thumbnails.ts).
 *
 * `src/http/app.ts` serves `SystemApi` with `systemHandlers` (E7-T11), first among the APIs, where the two inline routes
 * stood in the Hono app.
 */
import { existsSync } from "node:fs";
import { join, normalize } from "node:path";
import { Effect, Layer } from "effect";
import { HttpServerRequest } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { AppConfig } from "../../config.ts";
import { UNINTERRUPTIBLE } from "../../http/middleware.ts";
import { pathOf, queryParam } from "../../http/request.ts";
import { errorResponse, fromWeb, json } from "../../http/response.ts";
import { routeUnknown } from "../../lib/errors.ts";
import { UPLOAD_EXP_PARAM, UPLOAD_SIG_PARAM, verifyUploadSignature } from "../../lib/uploadUrls.ts";
import { runtime } from "../../runtime.ts";
import { healthResponse } from "../health.ts";
import { Thumbnails } from "../services/media/thumbnails.ts";
import { SystemApi } from "./system.api.ts";

export const healthHandlers = HttpApiBuilder.group(SystemApi, "health", (handlers) =>
  handlers
    /** GET /api/health — liveness/readiness probe, the payload computed on the one runtime (core/health.ts). */
    .handle(
      "getApiHealth",
      Effect.fn("health.getApiHealth")(function* () {
        return json(yield* Effect.promise(() => runtime.runPromise(healthResponse)));
      }),
      UNINTERRUPTIBLE,
    ),
);

export const uploadsHandlers = HttpApiBuilder.group(SystemApi, "uploads", (handlers) =>
  handlers
    /** GET /uploads/:filename?exp=&sig= — a signed upload, or its `.thumb.webp` derivative built on first request. */
    .handle(
      "getUploadsByFilename",
      Effect.fn("uploads.getUploadsByFilename")(function* ({ params }) {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const notFound = errorResponse(routeUnknown(request.method, pathOf(request.originalUrl)));

        const requested = normalize(params.filename);
        if (requested.includes("..") || requested.startsWith("/")) return yield* notFound;

        const verdict = verifyUploadSignature(
          requested,
          yield* queryParam(UPLOAD_EXP_PARAM),
          yield* queryParam(UPLOAD_SIG_PARAM),
        );
        if (verdict !== "ok") return yield* notFound;

        const { uploadDir } = yield* AppConfig;
        const absolute = join(uploadDir, requested);
        if (!absolute.startsWith(uploadDir)) return yield* notFound;

        // A `<name>.thumb.webp` is DERIVED: the URL is minted from the row, which knows
        // nothing about the disk, so the first request for one builds it. If it cannot be
        // built the original is served instead — a 404 here would be a broken <img> on a
        // recipe that is perfectly fine. See services/media/thumbnails.ts.
        let path = absolute;
        let derivedFallback = false;
        if (!existsSync(absolute)) {
          const thumbnails = yield* Thumbnails;
          const resolved = yield* thumbnails.resolveThumbnail(requested);
          if (resolved === undefined) return yield* notFound;
          path = resolved.path;
          derivedFallback = resolved.fallback;
        }

        const file = Bun.file(path);
        return fromWeb(
          new Response(file, {
            headers: {
              "Content-Type": file.type || "application/octet-stream",
              // `private` because the URL is now a capability, not a public address: a
              // shared proxy must not hand one client's signed response to another. The
              // max-age stays inside the signature's own lifetime.
              //
              // The fallback is deliberately NOT immutable: it is the wrong (full-size)
              // answer, so it must expire quickly enough to heal once sharp can convert.
              "Cache-Control": derivedFallback ? "private, max-age=300" : "private, max-age=21600, immutable",
            },
          }),
        );
      }),
      UNINTERRUPTIBLE,
    ),
);

/** Both groups of `SystemApi`. */
export const systemHandlers = Layer.mergeAll(healthHandlers, uploadsHandlers);
