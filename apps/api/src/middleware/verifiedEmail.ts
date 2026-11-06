/**
 * OWNER: auth agent.
 *
 * `RequireVerifiedEmailLayer` implements the tag `RequireVerifiedEmail` of `apps/api/src/http/middleware.ts` (docs/EFFECT.md
 * E8; plan `docs/plans/e7-http-api.md` P5): the third auth middleware, after `RequireSession` and `RequireHouseholdMember`.
 * It answers 403 `email_unverified` when the session's address has never been confirmed and this deployment gates writes on
 * that (see services/auth/verifiedEmail.ts for when it does, and why it follows the mailer instead of an env variable).
 *
 * IT ONLY EVER BLOCKS A WRITE. GET/HEAD/OPTIONS pass through untouched, which is what makes "read-only" true rather than
 * "locked out": an unconfirmed account browses every record in its households, and the read-only PWA keeps working. That
 * check lives HERE and not at each call site so a group can attach it once, `chain(RequireVerifiedEmail)`, and an
 * endpoint added to that group later is gated by default (the pre-E7 Hono routers mounted it with `use("*")`). Groups whose
 * writes are not uniformly gated (core household routes, where accepting an invite and leaving a household must stay
 * open) attach it per endpoint instead; attaching it to the whole group there would silently swallow the one escape hatch
 * an unconfirmed user has.
 *
 * ORDER: it requires `CurrentUser`, so `RequireSession` runs before it. Before or after `RequireHouseholdMember` is a
 * judgement call and it runs AFTER: a non-member should be told they are a non-member (404/403 `forbidden`) rather than
 * being handed a confirmation prompt for a household they cannot see anyway.
 */
import { Effect, Layer } from "effect";
import { HttpServerRequest } from "effect/http";
import { VerifiedEmail } from "../core/services/auth/verifiedEmail.ts";
import { CurrentUser } from "../http/context.ts";
import { RequireVerifiedEmail } from "../http/middleware.ts";

/** Methods that never change anything, so the gate lets them past. */
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** `RequireVerifiedEmail` (P5): 403 `email_unverified` on a write from an account with an unconfirmed address. */
export const RequireVerifiedEmailLayer = Layer.effect(
  RequireVerifiedEmail,
  Effect.gen(function* () {
    const verifiedEmail = yield* VerifiedEmail;
    return RequireVerifiedEmail.of(
      Effect.fn("RequireVerifiedEmail")(function* (httpEffect) {
        const request = yield* HttpServerRequest.HttpServerRequest;
        if (!READ_METHODS.has(request.method)) {
          yield* verifiedEmail.assertVerified(yield* CurrentUser);
        }
        return yield* httpEffect;
      }),
    );
  }),
);
