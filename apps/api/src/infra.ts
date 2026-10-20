/**
 * The infrastructure tier of the `AppLayer` (docs/EFFECT.md E5, E7; plan `docs/plans/e2-api-core-services.md` P3):
 * the services everything else stands on. `Layer.provideMerge` satisfies the left side's requirements from the
 * right side and keeps both outputs, and a sibling that needs a sibling of the same step sits in an OUTER step:
 *
 *   RateLimiter, VerifiedEmail, Uploads      (VerifiedEmail needs Mailer, Uploads needs Thumbnails)
 *     over Mailer, Thumbnails                (both need AppConfig)
 *     over Database                          (needs AppConfig)
 *     over AppConfig
 *
 * Import cycle (CLAUDE.md "API import cycle"): this file exports a hoisted function only; nothing runs at import,
 * and the service classes are read when `src/runtime.ts` builds the layer.
 */
import { Layer } from "effect";
import { AppConfig } from "./config.ts";
import { MailerService } from "./core/services/mail/index.ts";
import { RateLimiter } from "./core/services/auth/rateLimit.ts";
import { VerifiedEmail } from "./core/services/auth/verifiedEmail.ts";
import { Thumbnails } from "./core/services/media/thumbnails.ts";
import { Uploads } from "./core/services/media/uploads.ts";
import { Database } from "./db/database.ts";
import type { DatabaseError } from "./lib/errors.ts";

/** Every service `infraLayer()` provides. */
export type InfraServices = AppConfig | Database | MailerService | Thumbnails | RateLimiter | VerifiedEmail | Uploads;

export function infraLayer(): Layer.Layer<InfraServices, DatabaseError> {
  return Layer.mergeAll(RateLimiter.layer, VerifiedEmail.layer, Uploads.layer).pipe(
    Layer.provideMerge(Layer.mergeAll(MailerService.layer, Thumbnails.layer)),
    Layer.provideMerge(Database.layer),
    Layer.provideMerge(AppConfig.layer),
  );
}
