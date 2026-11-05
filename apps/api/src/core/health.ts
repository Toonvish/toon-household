/**
 * Liveness/readiness probe, and the one place a client can ask what this
 * deployment can actually do. `modules` is the BUILD's modules (SPEC §2), not
 * what a household enabled; `features` merges what each module's
 * `healthFeatures()` reports (e.g. recipe's OCR import flags), so the web app
 * knows not to offer a capability the server was built without. It needs no
 * session and the service worker never caches `/api`, so the answer is always
 * the running server's.
 *
 * Run through the one runtime (`src/runtime.ts`) by `GET /api/health` in
 * `src/index.ts`. `AppConfig` (the database kind) and `VerifiedEmail` (the gate flag) are services read
 * INSIDE the generator (E2-T12); each module's `healthFeatures()` is an Effect over `AppConfig` (E3), run in module
 * order with `Effect.forEach` and merged after `verifiedEmailRequired`; the registry and the feature flags are read inside it too, never at module scope (CLAUDE.md "API import cycle"); the key
 * order `ok, status, version, time, database, modules, features` is the wire
 * order. `time` comes from the `Clock` (`DateTime.now`); `DateTime.formatIso` is
 * `Date#toISOString` of the UTC instant, the format the route always sent.
 */
import type { HealthResponse } from "@toon/shared";
import { DateTime, Effect } from "effect";
import { AppConfig } from "../config.ts";
import { API_MODULES } from "../modules/index.ts";
import { VerifiedEmail } from "./services/auth/verifiedEmail.ts";

export const healthResponse: Effect.Effect<HealthResponse, never, AppConfig | VerifiedEmail> = Effect.gen(function* () {
  const config = yield* AppConfig;
  const verifiedEmail = yield* VerifiedEmail;
  return {
    ok: true as const,
    status: "ok" as const,
    version: process.env.npm_package_version ?? "0.1.0",
    time: DateTime.formatIso(yield* DateTime.now),
    database: config.databaseKind,
    modules: API_MODULES.map((module) => module.id),
    features: {
      verifiedEmailRequired: yield* verifiedEmail.isRequired,
      ...(Object.assign(
        {},
        ...(yield* Effect.forEach(API_MODULES, (module) => module.healthFeatures?.() ?? Effect.succeed({}))),
      ) as Record<string, boolean>),
    },
  };
});
