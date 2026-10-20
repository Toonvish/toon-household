/**
 * Schema-validated environment. Import `env` anywhere in the API — it is parsed
 * exactly once at module load and fails fast with a readable message.
 *
 * Since E2 this file re-exports `apps/api/src/config.ts` (the `AppConfig` service, plan
 * `docs/plans/e2-api-core-services.md` P5): `env` is the very object `AppConfig.layer`
 * provides, resolved here at import as before (the root `.env` / `.env.local`, the test
 * temp DB of ADR 0009, a bad environment printing its lines and exiting 1). Every variable
 * is documented in /.env.example.
 */
import { resolveProcessEnv, type Env } from "./config.ts";

export { parseEnv, REPO_ROOT, type Env, type ParsedEnv } from "./config.ts";

export const env: Env = resolveProcessEnv();
