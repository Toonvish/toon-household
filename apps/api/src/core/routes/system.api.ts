/**
 * The system routes: the health probe and the signed uploads (docs/API.md "Health", "Uploads and signed URLs");
 * served at the app root, `GET /api/health` and `GET /uploads/:filename` (plan `docs/plans/e7-http-api.md` P2,
 * Table M system row). Two groups, `health` and `uploads`, of the one `SystemApi`; `coreApi` puts `ApiErrorBoundary`
 * outermost. Neither route needs a session.
 *
 * Definitions only (plan P2): the handlers live in system.ts.
 */
import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { coreApi } from "../../http/middleware.ts";

export const HealthGroup = HttpApiGroup.make("health").add(
  /** GET /api/health */
  HttpApiEndpoint.get("getApiHealth", "/api/health"),
);

export const UploadsGroup = HttpApiGroup.make("uploads").add(
  /** GET /uploads/:filename */
  HttpApiEndpoint.get("getUploadsByFilename", "/uploads/:filename", { params: { filename: Schema.String } }),
);

export const SystemApi = coreApi(HttpApi.make("system").add(HealthGroup, UploadsGroup));
