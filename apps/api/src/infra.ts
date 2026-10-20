/**
 * The infrastructure tier of the `AppLayer` (docs/EFFECT.md E5, E7; plan `docs/plans/e2-api-core-services.md` P3):
 * the services everything else stands on. `Layer.provideMerge` satisfies the left side's requirements from the
 * right side and keeps both outputs, so `Database` gets `AppConfig` and the runtime exposes both.
 *
 * E2-T03: `Database` over `AppConfig`. E2-T04 adds `Mailer`, `Thumbnails`, `RateLimiter`, `VerifiedEmail` and
 * `Uploads`, nested by their dependencies (P3).
 *
 * Import cycle (CLAUDE.md "API import cycle"): this file exports a hoisted function only; nothing runs at import,
 * and the service classes are read when `src/runtime.ts` builds the layer.
 */
import { Layer } from "effect";
import { AppConfig } from "./config.ts";
import { Database } from "./db/database.ts";
import type { DatabaseError } from "./lib/errors.ts";

export function infraLayer(): Layer.Layer<Database | AppConfig, DatabaseError> {
  return Database.layer.pipe(Layer.provideMerge(AppConfig.layer));
}
