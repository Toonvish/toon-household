/**
 * The middleware vocabulary of the Effect HTTP layer (docs/EFFECT.md E8; plan `docs/plans/e7-http-api.md` P5, P6, P9,
 * P14): the `HttpApiMiddleware` tags every `*.api.ts` attaches, the `ModuleId` group annotation, `chain`, the API
 * helpers `coreApi`, `householdModuleApi`, `userModuleApi`, and `UNINTERRUPTIBLE`.
 *
 * - The tags name what a middleware PROVIDES to the handlers behind it (`apps/api/src/http/context.ts`) and what it
 *   REQUIRES from the ones in front of it; their implementations are layers elsewhere (`ApiErrorBoundaryLayer` in
 *   `apps/api/src/http/response.ts`, the session, household, module and verified-e-mail layers in
 *   `apps/api/src/middleware/*.ts`, E7-T03). Every tag declares `BoundaryFailure` as its error: a middleware and a
 *   handler may fail with any member of the error family, a `Schema.SchemaError` or a `DatabaseError`, and
 *   `ApiErrorBoundary` (outermost on every API) renders each of them; HttpApi's own error encoder is never reached.
 * - Order (P6, verified in `repos/effect/packages/effect/src/http-api/HttpApiBuilder.ts` `applyMiddleware`: `for (const
 *   key of endpoint.middlewares) handler = apply(handler)`): the middleware attached FIRST is the INNERMOST, the one
 *   attached LAST runs FIRST. `chain(A, B, C)` takes the middlewares in EXECUTION order, as a Hono route listed them,
 *   and attaches them reversed, so `A` runs first. It works on an endpoint, a group and an API alike
 *   (`.pipe(chain(...))`). Endpoint chains are attached when the endpoint is defined, the group chain after the group's
 *   `.add(...)`, the API chain last (by `householdModuleApi` / `coreApi` / `userModuleApi`), so a module write runs
 *   boundary → session → member → module → the group chain → the endpoint chain → the handler.
 *
 * A LEAF (CLAUDE.md "API import cycle", plan P15): this file imports `effect`, `effect/http-api`, the types of
 * `@toon/shared`, `./context.ts` (types) and `../lib/errors.ts` (which imports neither the runtime nor a service), so every
 * `*.api.ts` imports it at module scope.
 *
 * Table R amendments (plan section 2.2; the plan file is untracked until E7-T13, so every deviation from the names
 * and call shapes of P4 to P10 is recorded HERE, and every rewrite task reads this list together with Table R):
 * - E7-T02: none. Notes for the users of the vocabulary: `rawJsonOrDie`, `queryRecord`, `rawText`, `webRequest`,
 *   `clientIp`, `requestLocale` (`apps/api/src/http/request.ts`) and `readSessionCookie`, `clearSessionCookie`,
 *   `readOAuthCookies`, `clearOAuthCookies` (`apps/api/src/http/cookies.ts`) are Effect VALUES (`yield* rawText`);
 *   `jsonBody`, `queryParams`, `queryParam`, `header`, `rawJsonOr`, `setSessionCookie`, `setOAuthCookies` are functions
 *   returning one. A cookie is keyed by its name on the Effect response: setting the same cookie twice in one request
 *   (a stale-cookie clear, then a new session) sends ONE `Set-Cookie` with the last value, where Hono appended two
 *   headers (a browser ends in the same state). `householdModuleApi` takes the `@toon/shared` `ModuleId` union as its id.
 * - E7-T03: none. Notes: the implementations are `RequireSessionLayer`, `OptionalSessionLayer`,
 *   `RequireHouseholdMemberLayer` / `AdminLayer` / `OwnerLayer`, `RequireModuleLayer`, `RequireVerifiedEmailLayer`
 *   (`apps/api/src/middleware/*.ts`), merged with `ApiErrorBoundaryLayer` by `httpMiddlewareLayer()`
 *   (`apps/api/src/http/middleware-layer.ts`); `effectBridge(api, handlers, mountedAt)` (the bridge, deleted by E7-T11)
 *   provides them itself, so a route file passes only its handler layer. `RequireModule` reads the group's `ModuleId`
 *   and treats a group without one as a defect: attach it through `householdModuleApi` only. The household tags
 *   resolve the household from `:householdId`, else `:inviteId` (no `via` option on the Effect side).
 */
import type { ModuleId as SharedModuleId } from "@toon/shared";
import { Context, Schema } from "effect";
import { HttpApi, type HttpApiEndpoint, type HttpApiGroup, HttpApiMiddleware } from "effect/http-api";
import { type ApiErrorFamily, type DatabaseError, isApiError, isDatabaseError } from "../lib/errors.ts";
import type { CurrentMembership, CurrentSession, CurrentUser, MaybeSession } from "./context.ts";

/** Everything the boundary renders as a typed failure: the error family, a schema refusal (422), a database failure (500). */
export type BoundaryFailure = ApiErrorFamily | Schema.SchemaError | DatabaseError;

/**
 * The error schema every tag declares (plan P7): a `Schema.declare` over `BoundaryFailure`, so a middleware or a
 * handler may fail with any of them type-wise. It is never encoded: `ApiErrorBoundary` answers every failure first.
 */
export const BoundaryFailure = Schema.declare<BoundaryFailure>(
  (u): u is BoundaryFailure => isApiError(u) || Schema.isSchemaError(u) || isDatabaseError(u),
);

/** Outermost on every API (P7): recovers the whole cause and renders it as the `docs/API.md` error envelope. */
export class ApiErrorBoundary extends HttpApiMiddleware.Service<ApiErrorBoundary>()("toon/api/http/ApiErrorBoundary", {
  error: BoundaryFailure,
}) {}

/** `requireSession()`: 401 `unauthorized` without a valid `toon_session` cookie; provides the user and the session id. */
export class RequireSession extends HttpApiMiddleware.Service<
  RequireSession,
  { provides: CurrentUser | CurrentSession }
>()("toon/api/http/RequireSession", { error: BoundaryFailure }) {}

/** `optionalSession()`: never refuses; provides the user and the session id when a valid cookie came. */
export class OptionalSession extends HttpApiMiddleware.Service<OptionalSession, { provides: MaybeSession }>()(
  "toon/api/http/OptionalSession",
  { error: BoundaryFailure },
) {}

/** `requireHouseholdRole("member")`: the household of `:householdId` (404, 403 `noAccess`); provides the membership. */
export class RequireHouseholdMember extends HttpApiMiddleware.Service<
  RequireHouseholdMember,
  { requires: CurrentUser; provides: CurrentMembership }
>()("toon/api/http/RequireHouseholdMember", { error: BoundaryFailure }) {}

/** `requireHouseholdRole("admin")`: as `RequireHouseholdMember`, and 403 `adminOnly` below admin. */
export class RequireHouseholdAdmin extends HttpApiMiddleware.Service<
  RequireHouseholdAdmin,
  { requires: CurrentUser; provides: CurrentMembership }
>()("toon/api/http/RequireHouseholdAdmin", { error: BoundaryFailure }) {}

/** `requireHouseholdRole("owner")`: as `RequireHouseholdMember`, and 403 `ownerOnly` below owner. */
export class RequireHouseholdOwner extends HttpApiMiddleware.Service<
  RequireHouseholdOwner,
  { requires: CurrentUser; provides: CurrentMembership }
>()("toon/api/http/RequireHouseholdOwner", { error: BoundaryFailure }) {}

/** `requireModule(id)`: 404 `module_disabled` unless the household has the module of the group's `ModuleId`. */
export class RequireModule extends HttpApiMiddleware.Service<RequireModule, { requires: CurrentMembership }>()(
  "toon/api/http/RequireModule",
  { error: BoundaryFailure },
) {}

/** `requireVerifiedEmail()`: 403 `email_unverified` for every method but GET, HEAD, OPTIONS while the gate is on. */
export class RequireVerifiedEmail extends HttpApiMiddleware.Service<RequireVerifiedEmail, { requires: CurrentUser }>()(
  "toon/api/http/RequireVerifiedEmail",
  { error: BoundaryFailure },
) {}

/**
 * The group annotation naming the module an API belongs to (P14): `householdModuleApi` puts it on every group, and
 * `RequireModule` reads it from the group it runs for (`moduleIdOf`), never from the URL.
 */
export class ModuleId extends Context.Service<ModuleId, SharedModuleId>()("toon/api/http/ModuleId") {}

/** The module id a group was annotated with by `householdModuleApi`, or `undefined` for a core or user API group. */
export function moduleIdOf(group: HttpApiGroup.Top): SharedModuleId | undefined {
  return Context.getOrUndefined(group.annotations, ModuleId);
}

/** The third argument of `handlers.handle(...)` for every handler (P9): Hono never interrupted a handler. */
export const UNINTERRUPTIBLE = { uninterruptible: true } as const;

/** A middleware tag as `.middleware(...)` takes it. */
type Tag<I extends HttpApiMiddleware.AnyId> = Context.Key<I, any>;

/** The type of `target.middleware(tag)` for an API, a group or an endpoint. */
export type Attach<T, I extends HttpApiMiddleware.AnyId> =
  T extends HttpApi.HttpApi<infer Id, infer Groups>
    ? HttpApi.HttpApi<Id, HttpApiGroup.AddMiddleware<Groups, I>>
    : T extends { readonly endpoints: unknown }
      ? HttpApiGroup.AddMiddleware<T, I>
      : HttpApiEndpoint.AddMiddleware<T, I>;

/**
 * Attaches middlewares listed in EXECUTION order (P6): `x.pipe(chain(A, B, C))` runs `A`, then `B`, then `C`, then
 * whatever `x` already had attached (an endpoint's own chain runs after its group's, a group's after its API's).
 */
export function chain<A extends HttpApiMiddleware.AnyId>(a: Tag<A>): <T>(self: T) => Attach<T, A>;
export function chain<A extends HttpApiMiddleware.AnyId, B extends HttpApiMiddleware.AnyId>(
  a: Tag<A>,
  b: Tag<B>,
): <T>(self: T) => Attach<Attach<T, B>, A>;
export function chain<
  A extends HttpApiMiddleware.AnyId,
  B extends HttpApiMiddleware.AnyId,
  C extends HttpApiMiddleware.AnyId,
>(a: Tag<A>, b: Tag<B>, c: Tag<C>): <T>(self: T) => Attach<Attach<Attach<T, C>, B>, A>;
export function chain<
  A extends HttpApiMiddleware.AnyId,
  B extends HttpApiMiddleware.AnyId,
  C extends HttpApiMiddleware.AnyId,
  D extends HttpApiMiddleware.AnyId,
>(a: Tag<A>, b: Tag<B>, c: Tag<C>, d: Tag<D>): <T>(self: T) => Attach<Attach<Attach<Attach<T, D>, C>, B>, A>;
export function chain<
  A extends HttpApiMiddleware.AnyId,
  B extends HttpApiMiddleware.AnyId,
  C extends HttpApiMiddleware.AnyId,
  D extends HttpApiMiddleware.AnyId,
  E extends HttpApiMiddleware.AnyId,
>(
  a: Tag<A>,
  b: Tag<B>,
  c: Tag<C>,
  d: Tag<D>,
  e: Tag<E>,
): <T>(self: T) => Attach<Attach<Attach<Attach<Attach<T, E>, D>, C>, B>, A>;
export function chain(...tags: ReadonlyArray<Tag<HttpApiMiddleware.AnyId>>): (self: unknown) => unknown {
  // The LAST tag is attached first (innermost), the FIRST last (outermost, runs first).
  return (self) =>
    tags.reduceRight(
      (target: { middleware: (tag: Tag<HttpApiMiddleware.AnyId>) => unknown }, tag) =>
        target.middleware(tag) as { middleware: (tag: Tag<HttpApiMiddleware.AnyId>) => unknown },
      self as { middleware: (tag: Tag<HttpApiMiddleware.AnyId>) => unknown },
    );
}

/** A core API (P14): `ApiErrorBoundary` outermost on every endpoint; paths as the API wrote them. */
export function coreApi<Id extends string, Groups extends HttpApiGroup.Constraint>(api: HttpApi.HttpApi<Id, Groups>) {
  return api.pipe(chain(ApiErrorBoundary));
}

/**
 * A module's household API (P14): every group annotated with `ModuleId` = `id`, every path prefixed with
 * `/api/households/:householdId/<id>`, and the module chain outermost: boundary → session → member → module, as
 * Hono's `mountModules` ran `requireSession()` → `requireHouseholdRole("member")` → `requireModule(id)`.
 */
export function householdModuleApi<
  const Mod extends SharedModuleId,
  Id extends string,
  Groups extends HttpApiGroup.Constraint,
>(id: Mod, api: HttpApi.HttpApi<Id, Groups>) {
  return HttpApi.make(api.identifier)
    .addHttpApi(api.annotate(ModuleId, id))
    .prefix(`/api/households/:householdId/${id}`)
    .pipe(chain(ApiErrorBoundary, RequireSession, RequireHouseholdMember, RequireModule));
}

/** A module's user API (P14): every path prefixed with `/api/<id>`, `ApiErrorBoundary` only (it runs `RequireSession` itself). */
export function userModuleApi<const Mod extends SharedModuleId, Id extends string, Groups extends HttpApiGroup.Constraint>(
  id: Mod,
  api: HttpApi.HttpApi<Id, Groups>,
) {
  return api.prefix(`/api/${id}`).pipe(chain(ApiErrorBoundary));
}
