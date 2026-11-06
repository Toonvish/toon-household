/**
 * The request-scoped services of the Effect HTTP layer (docs/EFFECT.md E8; plan `docs/plans/e7-http-api.md` P5).
 *
 * The middlewares of `apps/api/src/http/middleware.ts` provide them to every handler behind them, which reads them with
 * `yield*`: `CurrentUser` and `CurrentSession` (from `RequireSession`), `MaybeSession` (from `OptionalSession`: the
 * user and the session id when a valid cookie came, both `undefined` otherwise), `CurrentMembership` (from
 * `RequireHouseholdMember` / `RequireHouseholdAdmin` / `RequireHouseholdOwner`). They replace the context
 * variables `user`, `sessionId` and `membership` of the pre-E7 Hono app.
 *
 * A LEAF (CLAUDE.md "API import cycle", plan P15): this file imports `effect` and the types of `@toon/shared` only, so
 * every `*.api.ts`, every middleware and every handler may import it at module scope.
 */
import type { HouseholdRole, User } from "@toon/shared";
import { Context } from "effect";

/** A user's membership in the household of the request (`:householdId`). */
export interface Membership {
  householdId: string;
  userId: string;
  role: HouseholdRole;
}

/** The signed-in user (`RequireSession`). */
export class CurrentUser extends Context.Service<CurrentUser, User>()("toon/api/http/context/CurrentUser") {}

/** The session id (the `toon_session` cookie value) of the request (`RequireSession`). */
export class CurrentSession extends Context.Service<CurrentSession, { readonly sessionId: string }>()(
  "toon/api/http/context/CurrentSession",
) {}

/** The optional session (`OptionalSession`): both fields set when a valid session cookie came, both `undefined` otherwise. */
export class MaybeSession extends Context.Service<
  MaybeSession,
  { readonly user: User | undefined; readonly sessionId: string | undefined }
>()("toon/api/http/context/MaybeSession") {}

/** The verified membership of the signed-in user in the household of the request (the household middlewares). */
export class CurrentMembership extends Context.Service<CurrentMembership, Membership>()(
  "toon/api/http/context/CurrentMembership",
) {}
